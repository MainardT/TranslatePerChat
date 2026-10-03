/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2023 Vendicated and contributors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

/*
 * Translate a text file attached to a message (the "message.txt" style preview Discord shows inline).
 */

import { Message, MessageAttachment } from "@vencord/discord-types";
import { MessageStore, Modal, openModal, Tooltip, useLayoutEffect, useRef, useState } from "@webpack/common";

import { useFlash } from "./Notify";
import { overlapArea, Pick, PickRect, registerPickFinder } from "./Picks";
import { settings } from "./settings";
import { TranslateIcon } from "./TranslateIcon";
import { cl, translate } from "./utils";
import { t, useT } from "./i18n";

/** Height of the plate (the same as the plates next to the messages). */
const PLATE_HEIGHT = 26;
/** Air between the file card and its button. */
const BUTTON_GAP = 6;

/** A file bigger than this is not even offered for translation (the button shows the "too large" tip instead). */
const MAX_ATTACHMENT_BYTES = 10 * 1024;
/** The translator takes at most about 5000 characters at once, so longer paragraphs are sent in pieces no bigger than this. */
const MAX_PIECE_CHARS = 4500;
/** How many pieces are sent to the translator at the same time (more at once risks being refused for asking too often). */
const PARALLEL_REQUESTS = 3;

/** Files already translated during this run of Discord, so opening one again is instant. Oldest are forgotten first. */
const MAX_STORED_FILES = 30;
const storedTranslations = new Map<string, string>();

/** A stored translation belongs to one file and one language setup; another language means translating again. */
const storageKey = (a: MessageAttachment) =>
    [a.id, settings.store.service, settings.store.receivedInput, settings.store.receivedOutput].join("|");

function storeTranslation(key: string, text: string) {
    storedTranslations.delete(key);
    storedTranslations.set(key, text);
    while (storedTranslations.size > MAX_STORED_FILES) storedTranslations.delete(storedTranslations.keys().next().value!);
}

const isTextAttachment = (a: MessageAttachment) => !!a.content_type?.startsWith("text/");

/* ---------- splitting the file into pieces that are translated, and pieces that are not (code) ---------- */

interface Segment {
    /** Code is kept exactly as written, never translated. */
    code: boolean;
    lines: string[];
    /** How many empty lines separated this piece from the previous one, so the same spacing can be put back. */
    blankBefore: number;
}

const isFenceLine = (line: string) => /^\s*```/.test(line);
/** A line that is part of an (unfenced) indented code block, the way Markdown recognises one. */
const isIndentedLine = (line: string) => line.trim() !== "" && /^( {4,}|\t)/.test(line);

/** Cuts the file into paragraphs and code pieces, keeping track of the blank lines between them. */
function toSegments(lines: string[]): Segment[] {
    const segments: Segment[] = [];
    let i = 0;
    let pendingBlank = 0;

    while (i < lines.length) {
        if (lines[i].trim() === "" && !isFenceLine(lines[i])) {
            pendingBlank++;
            i++;
            continue;
        }

        if (isFenceLine(lines[i])) {
            // a fenced code block: everything up to the matching closing fence (or to the end) is kept as-is
            const start = i;
            i++;
            while (i < lines.length && !isFenceLine(lines[i])) i++;
            if (i < lines.length) i++;
            segments.push({ code: true, lines: lines.slice(start, i), blankBefore: pendingBlank });
            pendingBlank = 0;
            continue;
        }

        // a run of lines with no blank line between them: one paragraph, unless it is entirely indented code
        const start = i;
        while (i < lines.length && lines[i].trim() !== "" && !isFenceLine(lines[i])) i++;
        const unit = lines.slice(start, i);
        segments.push({ code: unit.every(isIndentedLine), lines: unit, blankBefore: pendingBlank });
        pendingBlank = 0;
    }

    return segments;
}

/** Cuts a text longer than the limit into pieces, at the end of a sentence where possible, otherwise between words. */
function cutLongText(text: string, limit: number): string[] {
    const pieces: string[] = [];
    let rest = text;
    while (rest.length > limit) {
        const window = rest.slice(0, limit);
        let cut = -1;
        const sentenceEnd = /[.!?…。！？]["'»”)]*\s/g;
        for (let m = sentenceEnd.exec(window); m; m = sentenceEnd.exec(window)) cut = m.index + m[0].length;
        if (cut < limit / 2) cut = window.lastIndexOf(" ") + 1;
        if (cut <= 0) cut = limit;
        pieces.push(rest.slice(0, cut).trim());
        rest = rest.slice(cut);
    }
    if (rest.trim()) pieces.push(rest.trim());
    return pieces;
}

/** Runs the job for every item, no more than `limit` at the same time, and keeps the results in the original order. */
export async function runLimited<T, R>(items: T[], limit: number, job: (item: T) => Promise<R>): Promise<R[]> {
    const results = new Array<R>(items.length);
    let next = 0;
    const worker = async () => {
        while (next < items.length) {
            const i = next++;
            results[i] = await job(items[i]);
        }
    };
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
    return results;
}

/** Translates the file text: paragraph by paragraph, code left untouched, the original spacing put back. */
export async function translateFileText(raw: string): Promise<string> {
    const lines = raw.replace(/\r\n?/g, "\n").split("\n");
    const segments = toSegments(lines);

    const prose = segments.filter(seg => !seg.code);
    const translated = await runLimited(prose, PARALLEL_REQUESTS, async seg => {
        const original = seg.lines.map(l => l.trim()).join(" ");
        const pieces = cutLongText(original, MAX_PIECE_CHARS);
        let failed = false;
        const parts: string[] = [];
        for (const piece of pieces) {
            try {
                parts.push((await translate("received", piece, true)).text);
            } catch {
                // this piece could not be translated: show it as it was rather than dropping it
                parts.push(piece);
                failed = true;
            }
        }
        return { text: parts.join(" "), failed };
    });

    if (prose.length && translated.every(r => r.failed)) {
        // every single paragraph failed: this is not a partial hiccup, tell the user it did not work
        throw new Error(t("fileFail"));
    }

    let next = 0;
    const out: string[] = [];
    segments.forEach(seg => {
        if (out.length) for (let k = 0; k < seg.blankBefore; k++) out.push("");
        out.push(seg.code ? seg.lines.join("\n") : translated[next++].text);
    });

    return out.join("\n");
}

/* ---------- the window with the translated file ---------- */

function openFileTranslateModal(filename: string, text: string) {
    openModal(props => (
        <Modal {...props} size="md" title={filename}>
            <div className={cl("file-modal-body")}>{text}</div>
        </Modal>
    ));
}

/* ---------- the button next to the file preview ---------- */

interface Position {
    left: number;
    top: number;
}

/**
 * The element of the file's box on the screen, wherever Discord put it. Discord keeps the file under another name than the one it
 * shows, so the name alone does not help; three ways, one after another:
 * the download link (it holds the number of the attachment), the shown name, any text ending with the same extension (in order).
 */
function findFilenameElement(row: HTMLElement, attachment: MessageAttachment, index = 0, count = 1): HTMLElement | null {
    const byLink = [...row.querySelectorAll<HTMLElement>("a[href]")].find(a => (a as HTMLAnchorElement).href.includes(`/${attachment.id}/`));
    if (byLink) return byLink;

    const loose = (name: string) => name.replace(/[^\p{L}\p{N}.]/gu, "").toLowerCase();
    const names = [attachment.filename, (attachment as { title?: string; }).title].filter((n): n is string => !!n).map(loose);
    const ext = (attachment.filename.match(/\.[^.]+$/) ?? [""])[0].toLowerCase();

    const sameExt: HTMLElement[] = [];
    const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const text = node.textContent?.trim();
        if (!text || !node.parentElement) continue;
        if (names.includes(loose(text))) return node.parentElement;
        if (ext && text.length < 150 && text.toLowerCase().endsWith(ext)) sameExt.push(node.parentElement);
    }
    // several files in one message: the same order on the screen as in the message
    return (sameExt.length === count ? sameExt[index] : sameExt[0]) ?? null;
}

/** The whole box of the file (the frame with the text preview and the name under it): the nearest frame with a border and rounded corners. */
function fileBoxRect(row: HTMLElement, nameEl: HTMLElement): DOMRect {
    let el: HTMLElement | null = nameEl.parentElement;
    for (let i = 0; el && el !== row && i < 12; i++, el = el.parentElement) {
        const style = getComputedStyle(el);
        if (parseFloat(style.borderTopWidth) > 0 && parseFloat(style.borderTopLeftRadius) > 2) return el.getBoundingClientRect();
    }
    return fileCardRect(row, nameEl);
}

/** Just right of the top right corner of the file box. */
function measure(button: HTMLElement, attachment: MessageAttachment, index: number, count: number): Position | null {
    const row = button.closest<HTMLElement>('[id^="chat-messages-"]');
    const holder = button.offsetParent as HTMLElement | null;
    if (!row || !holder) return null;

    const nameEl = findFilenameElement(row, attachment, index, count);
    if (!nameEl) return null;

    const holderRect = holder.getBoundingClientRect();
    const card = fileBoxRect(row, nameEl);
    return {
        left: Math.round(card.right + BUTTON_GAP - holderRect.left - holder.clientLeft + holder.scrollLeft),
        top: Math.round(card.top - holderRect.top - holder.clientTop + holder.scrollTop)
    };
}

function FileTranslateButton({ attachment, index, count }: { attachment: MessageAttachment; index: number; count: number; }) {
    const t = useT();
    settings.use(["service", "receivedInput", "receivedOutput"]);
    const key = storageKey(attachment);
    const [, setStoredCount] = useState(0);
    const ready = storedTranslations.has(key);
    const tooBig = attachment.size > MAX_ATTACHMENT_BYTES;

    const ref = useRef<HTMLDivElement>(null);
    const [position, setPosition] = useState<Position | null>(null);
    const [busy, setBusy] = useState(false);
    // a failure is told in the button's tip for a moment
    const [flash, flashTip, resetFlash] = useFlash();

    useLayoutEffect(() => {
        const button = ref.current;
        if (!button) return;

        const update = () => {
            const next = measure(button, attachment, index, count);
            setPosition(prev => prev && next && prev.left === next.left && prev.top === next.top ? prev : next);
        };

        update();

        const row = button.closest<HTMLElement>('[id^="chat-messages-"]');
        if (!row) return;

        // the attachment preview can change height (its own collapse/expand arrow), watch for that too
        const observer = new ResizeObserver(update);
        observer.observe(row);
        row.addEventListener("mouseenter", update);

        return () => {
            observer.disconnect();
            row.removeEventListener("mouseenter", update);
        };
    }, [attachment.filename]);

    const onClick = async () => {
        if (tooBig || busy) return;

        const stored = storedTranslations.get(key);
        if (stored !== undefined) {
            // move it to the "recently used" end so it is forgotten last
            storeTranslation(key, stored);
            openFileTranslateModal(attachment.filename, stored);
            return;
        }

        setBusy(true);
        try {
            const res = await fetch(attachment.url);
            const text = await res.text();

            const translated = await translateFileText(text);
            storeTranslation(key, translated);
            setStoredCount(storedTranslations.size);
            openFileTranslateModal(attachment.filename, translated);
        } catch (e) {
            console.error("[TranslatePerChat] file translation failed", e);
            flashTip(t("fileFail"));
        } finally {
            setBusy(false);
        }
    };

    // the same plate and button as the one next to the messages
    return (
        <div
            ref={ref}
            className={cl("plate-holder")}
            style={{ left: position?.left ?? 0, top: position?.top ?? 0, visibility: position ? undefined : "hidden" }}
        >
            <div className={cl("plate")} style={{ height: PLATE_HEIGHT }}>
                <Tooltip text={flash ?? (tooBig ? t("fileTooBig") : ready ? t("tipFileOpen") : t("tipFileTranslate"))}>
                    {({ onMouseEnter, onMouseLeave }) => (
                        <button
                            type="button"
                            className={cl("plate-button", { "plate-button-active": ready && !tooBig, "gutter-button-unavailable": tooBig })}
                            aria-label={t("ariaFileTranslate")}
                            disabled={tooBig || busy}
                            onMouseEnter={onMouseEnter}
                            onMouseLeave={() => {
                                onMouseLeave();
                                resetFlash();
                            }}
                            onClick={onClick}
                        >
                            <TranslateIcon width={16} height={16} />
                        </button>
                    )}
                </Tooltip>
            </div>
        </div>
    );
}

/* ---------- picking a file by selecting an area: the same as pressing its button ---------- */

/** The file card around the file name: the name's surroundings while they stay small (not the whole message). */
function fileCardRect(row: HTMLElement, nameEl: HTMLElement): DOMRect {
    let rect = nameEl.getBoundingClientRect();
    const rowHeight = row.getBoundingClientRect().height;
    let el: HTMLElement | null = nameEl.parentElement;
    for (let i = 0; el && el !== row && i < 4; i++, el = el.parentElement) {
        const r = el.getBoundingClientRect();
        if (r.height > 140 || r.height >= rowHeight) break;
        rect = r;
    }
    return rect;
}

/** Same as the file button: the stored translation, or fetch and translate, then the window with the result. */
async function translateAttachment(attachment: MessageAttachment, notice: (message: string) => void) {
    if (attachment.size > MAX_ATTACHMENT_BYTES) {
        notice(t("fileTooBig"));
        return;
    }

    const key = storageKey(attachment);
    const stored = storedTranslations.get(key);
    if (stored !== undefined) {
        storeTranslation(key, stored);
        openFileTranslateModal(attachment.filename, stored);
        return;
    }

    try {
        const res = await fetch(attachment.url);
        const translated = await translateFileText(await res.text());
        storeTranslation(key, translated);
        openFileTranslateModal(attachment.filename, translated);
    } catch (e) {
        console.error("[TranslatePerChat] file translation failed", e);
        notice(t("fileFail"));
    }
}

function findFilePicks(area: PickRect): Pick[] {
    const picks: Pick[] = [];
    for (const row of document.querySelectorAll<HTMLElement>('[id^="chat-messages-"]')) {
        const rr = row.getBoundingClientRect();
        if (!overlapArea(area, rr)) continue;

        const [, channelId, messageId] = row.id.match(/^chat-messages-(\d+)-(\d+)$/) ?? [];
        const message = channelId ? MessageStore.getMessage(channelId, messageId) : null;
        const textAttachments = message?.attachments?.filter(isTextAttachment) ?? [];
        for (const attachment of textAttachments) {
            const nameEl = findFilenameElement(row, attachment, textAttachments.indexOf(attachment), textAttachments.length);
            if (!nameEl) continue;
            if (overlapArea(area, fileCardRect(row, nameEl))) picks.push({ run: notice => translateAttachment(attachment, notice) });
        }
    }
    return picks;
}

let unregisterPicks: (() => void) | undefined;

export function startFilePicks() {
    unregisterPicks?.();
    unregisterPicks = registerPickFinder(findFilePicks);
}

export function stopFilePicks() {
    unregisterPicks?.();
    unregisterPicks = undefined;
}

/** One button per text-file attachment of the message. */
export function FileTranslateButtons({ message }: { message: Message; }) {
    const attachments = message.attachments?.filter(isTextAttachment) ?? [];
    if (!attachments.length) return null;

    return (
        <>
            {attachments.map((a, i) => <FileTranslateButton key={a.id} attachment={a} index={i} count={attachments.length} />)}
        </>
    );
}
