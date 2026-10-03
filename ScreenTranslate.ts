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

import { PluginNative } from "@utils/types";
import { MessageStore } from "@webpack/common";

import { isOnlyEmoticons, translateKeepingEmoticons } from "./Emoticons";
import { runLimited } from "./FileTranslate";
import { t } from "./i18n";
import { findReplaceTargets, replaceInPlace } from "./PageReplace";
import { findPicks } from "./Picks";
import { settings } from "./settings";
import { cl } from "./utils";

/*
 * Translate a piece of the screen.
 *   1. The user drags a frame over the screen.
 *   2. If there is real text under the frame (a message, a label...), it is read straight from the page.
 *   3. Otherwise (a picture) the area is photographed and the text is recognised by an OCR engine (Tesseract).
 *   4. The text goes to the usual translator and the result is shown next to the frame.
 */

const Native = VencordNative.pluginHelpers.TranslatePerChat as PluginNative<typeof import("./native")>;

/** Marks our own elements so the page-text reader ignores them. */
const MARK = "data-vc-screen-translate";

/** Language of the text in pictures. For now English only; more languages can be added here later ("eng+rus+jpn"). */
const OCR_LANGUAGE = "eng";

const TESSERACT_URL = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";
/** Places where the recognition data for OCR_LANGUAGE can be downloaded from (the second one is a backup). */
/** The exact reading data (heavier) and the light one (2-3 times less work, a bit worse on hard pictures). */
const OCR_DATA_PATHS = {
    best: [
        "https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng/4.0.0_best_int",
        "https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng/4.0.0"
    ],
    fast: [
        "https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng/4.0.0_fast",
        "https://tessdata.projectnaptha.com/4.0.0_fast"
    ]
};
type OcrKind = keyof typeof OCR_DATA_PATHS;

/** Lines read with less certainty than this are left out (mostly noise). */
const MIN_LINE_CONFIDENCE = 60;
/** The light reading counts as poor (the exact one is run then) when it found nothing, below this average certainty, ... */
const POOR_CONFIDENCE = 75;
/** ... or when this share of the lines are scraps of up to SCRAP_CHARS letters (icons, faces, bits of patterns read as letters). */
const POOR_SCRAPS_SHARE = 0.35;
const SCRAP_CHARS = 3;

interface Rect {
    left: number;
    top: number;
    right: number;
    bottom: number;
}

/** A piece of text and the place it occupies on the screen. */
interface Block {
    text: string;
    rect: Rect;
    /** How the lines of the original are lined up (only known for text read from a picture). */
    align?: "left" | "center" | "single";
    /** Height of one line of the original, in pixels (only known for text read from a picture). */
    lineHeight?: number;
    /**
     * Which paragraph the reader itself put this line in, and which single reading pass said so
     * (paragraph numbers from different passes do not mean anything next to each other).
     * Used to stop two paragraphs from being joined even when they happen to sit close together.
     */
    paragraphId?: number;
    /** The patch may grow downwards into the empty space under it instead of making the text smaller (text read from the page). */
    canGrow?: boolean;
    /** The text as it was read, kept when `text` holds the translation (for copying the original). */
    original?: string;
    paragraphSource?: string;
}

/** Anything we put on the screen that can be closed. */
interface Closable {
    closed: boolean;
    /** `reason` is written to the console (for finding out why something disappeared). */
    close(reason?: string): void;
}

/** The translation shown on a picture, driven by the buttons next to the picture. */
export interface PictureResult extends Closable {
    /** Switches between the translation and the original (the patches hidden). */
    toggle(): void;
    showingOriginal(): boolean;
    /** What is shown now as text: the translation, or the text read from the picture. */
    shownText(): string;
    onClose(listener: () => void): void;
}

/* ---------- things drawn over the chat follow what they belong to ---------- */

/**
 * Keeps elements drawn on the screen on the thing they belong to (a picture, a message) while the chat moves
 * (a new message, scrolling): they are shifted with it, and hidden while it is out of the chat's view.
 */
function follow(nodes: HTMLElement[], anchor: Element | null | undefined, isClosed: () => boolean) {
    if (!anchor) return;
    const start = anchor.getBoundingClientRect();
    const step = () => {
        if (isClosed()) return;
        if (anchor.isConnected) {
            const r = anchor.getBoundingClientRect();
            const view = anchor.closest('[class*="scroller"]')?.getBoundingClientRect();
            const out = !!view && (r.bottom < view.top || r.top > view.bottom);
            for (const n of nodes) {
                n.style.translate = `${Math.round(r.left - start.left)}px ${Math.round(r.top - start.top)}px`;
                n.style.visibility = out ? "hidden" : "";
            }
        }
        requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
}

/** The message under the middle of an area (to follow it), if the area is on the chat. */
function messageUnder(area: Rect): Element | null {
    const x = (area.left + area.right) / 2;
    const y = (area.top + area.bottom) / 2;
    for (const el of document.elementsFromPoint(x, y)) {
        const row = el.closest('[id^="chat-messages-"]');
        if (row) return row;
    }
    return null;
}

/* ---------- result bubble ---------- */

interface Bubble extends Closable {
    setText(text: string, loading?: boolean): void;
    /** Called once when the window closes; `reason` is set when it was cancelled (cross, Esc, another window). */
    onClose(listener: (reason?: string) => void): void;
}

let currentBubble: Closable | null = null;

function openBubble(area: Rect, text: string, onPicture?: Element): Bubble {
    currentBubble?.close("replaced by a new window");

    const frame = document.createElement("div");
    // on a picture: no frame around it, the text sits in its middle
    frame.className = cl("screen-frame", { "screen-frame-plain": !!onPicture });
    frame.setAttribute(MARK, "");
    Object.assign(frame.style, {
        left: `${area.left}px`,
        top: `${area.top}px`,
        width: `${area.right - area.left}px`,
        height: `${area.bottom - area.top}px`
    });

    const box = document.createElement("div");
    box.className = cl("screen-bubble", { "screen-bubble-picture": !!onPicture });
    box.setAttribute(MARK, "");

    const body = document.createElement("div");
    body.className = cl("screen-bubble-text");

    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.className = cl("screen-bubble-close");
    closeButton.textContent = "×";

    box.append(body, closeButton);
    document.body.append(frame, box);

    const place = () => {
        const margin = 8;
        const width = box.offsetWidth;
        const height = box.offsetHeight;
        if (onPicture) {
            box.style.left = `${Math.round((area.left + area.right - width) / 2)}px`;
            box.style.top = `${Math.round((area.top + area.bottom - height) / 2)}px`;
            return;
        }

        let left = Math.min(Math.max(area.left, margin), window.innerWidth - width - margin);
        left = Math.max(left, margin);

        // below the frame if there is room, otherwise above it
        let top = area.bottom + margin;
        if (top + height > window.innerHeight - margin) {
            const above = area.top - margin - height;
            top = above >= margin ? above : Math.max(margin, window.innerHeight - height - margin);
        }

        box.style.left = `${left}px`;
        box.style.top = `${top}px`;
    };

    // while it works, only the cross and Esc stop it (a stray click must not cancel the reading)
    const onKeyDown = (e: KeyboardEvent) => {
        if (e.key !== "Escape") return;
        // Esc must not go on to Discord (it would scroll the chat to the newest messages)
        e.preventDefault();
        e.stopPropagation();
        bubble.close("Esc");
    };

    const closeListeners: ((reason?: string) => void)[] = [];
    const bubble: Bubble = {
        closed: false,
        onClose(listener) {
            if (!bubble.closed) closeListeners.push(listener);
        },
        setText(value, loading = false) {
            if (bubble.closed) return;
            body.textContent = value;
            box.classList.toggle(cl("screen-bubble-loading"), loading);
            place();
        },
        close(reason) {
            if (bubble.closed) return;
            bubble.closed = true;
            window.removeEventListener("keydown", onKeyDown, true);
            frame.remove();
            box.remove();
            if (currentBubble === bubble) currentBubble = null;
            for (const listener of closeListeners) {
                try { listener(reason); } catch (e) { console.error("[TranslatePerChat]", e); }
            }
        }
    };

    closeButton.addEventListener("click", () => bubble.close("cross"));
    window.addEventListener("keydown", onKeyDown, true);

    currentBubble = bubble;
    bubble.setText(text, true);
    follow([frame, box], onPicture, () => bubble.closed);
    return bubble;
}

/* ---------- reading text straight from the page ---------- */

const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA"]);
const MAX_CHARS_CHECKED = 60000;

/** The closest ancestor that is a block of text (not just a piece of a line), so a whole message is translated together. */
function blockOf(element: Element): Element {
    let current: Element = element;
    while (current.parentElement && current !== document.body) {
        const display = getComputedStyle(current).display;
        if (!display.startsWith("inline") && display !== "contents") return current;
        current = current.parentElement;
    }
    return current;
}

/** Reads the text lying under the frame straight from the page, together with the place it occupies. */
function readPageBlocks(area: Rect): Block[] {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
            const parent = node.parentElement;
            if (!parent || !node.nodeValue) return NodeFilter.FILTER_REJECT;
            // empty space is only of interest when it holds line breaks (it may separate paragraphs)
            if (!node.nodeValue.trim() && !node.nodeValue.includes("\n")) return NodeFilter.FILTER_REJECT;
            if (SKIP_TAGS.has(parent.tagName) || parent.closest(`[${MARK}]`)) return NodeFilter.FILTER_REJECT;
            return NodeFilter.FILTER_ACCEPT;
        }
    });

    const range = document.createRange();
    // whether an element is actually visible on top (not hidden behind a window or a picture viewer)
    const visibleCache = new Map<string, boolean>();
    const elementIds = new Map<Element, number>();
    /** Text hidden on purpose (for screen readers only): squeezed into a box of a pixel or so. */
    const hiddenCache = new Map<Element, boolean>();
    const isHiddenOnPurpose = (el: Element) => {
        let hidden = hiddenCache.get(el);
        if (hidden === undefined) {
            hidden = false;
            for (let cur: Element | null = el, depth = 0; cur && depth < 4; cur = cur.parentElement, depth++) {
                const box = cur.getBoundingClientRect();
                if (box.width > 2 && box.height > 2) continue;
                // tiny AND cutting off what sticks out: that is hiding on purpose (a tiny wrapper that lets text spill out is not)
                const style = getComputedStyle(cur);
                if (/hidden|clip/.test(style.overflow) || (style.clip && style.clip !== "auto") || style.clipPath !== "none") {
                    hidden = true;
                    break;
                }
            }
            hiddenCache.set(el, hidden);
        }
        return hidden;
    };
    const blockCache = new Map<Element, Element>();
    /**
     * Text found in each block. A block that keeps the line breaks of its text (a text file preview, a code block)
     * is cut into paragraphs at empty lines, and every paragraph gets its own patch in its own place.
     */
    const found = new Map<Element, { block: Element; keepsLines: boolean; lineHeight?: number; breaks: number; parts: { text: string; rect: Rect; }[]; }>();
    let checked = 0;

    const grow = (a: Rect | null, b: Rect): Rect => a
        ? { left: Math.min(a.left, b.left), top: Math.min(a.top, b.top), right: Math.max(a.right, b.right), bottom: Math.max(a.bottom, b.bottom) }
        : { left: b.left, top: b.top, right: b.right, bottom: b.bottom };

    for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
        if (checked > MAX_CHARS_CHECKED) break;

        // a piece holding nothing but line breaks: only counted inside a block that keeps its lines and is already being read
        if (!node.nodeValue!.trim()) {
            if (!found.size) continue;
            const owner = found.get(blockCache.get(node.parentElement!) ?? blockOf(node.parentElement!));
            if (owner?.keepsLines) owner.breaks += node.nodeValue!.split("\n").length - 1;
            continue;
        }

        range.selectNodeContents(node);
        const whole = range.getBoundingClientRect();
        if (!whole.width || !whole.height) continue;
        if (whole.right < area.left || whole.left > area.right || whole.bottom < area.top || whole.top > area.bottom) continue;

        const parent = node.parentElement!;
        const value = node.nodeValue!;
        if (isHiddenOnPurpose(parent)) continue;
        if (!elementIds.has(parent)) elementIds.set(parent, elementIds.size);

        let block = blockCache.get(parent);
        if (!block) {
            block = blockOf(parent);
            blockCache.set(parent, block);
        }

        let entry = found.get(block);
        if (!entry) {
            const style = getComputedStyle(block);
            const keepsLines = /^(pre|pre-wrap|pre-line|break-spaces)$/.test(style.whiteSpace);
            const fontSize = parseFloat(style.fontSize);
            entry = { block, keepsLines, lineHeight: keepsLines && fontSize > 0 ? fontSize : undefined, breaks: 0, parts: [] };
            found.set(block, entry);
        }

        let current = entry.parts[entry.parts.length - 1] as { text: string; rect: Rect | null; } | undefined;

        for (let i = 0; i < value.length; i++) {
            checked++;
            const ch = value[i];

            if (entry.keepsLines) {
                // count line breaks since the last letter: two or more in a row mean an empty line, the end of a paragraph
                if (ch === "\n") {
                    entry.breaks++;
                    continue;
                }
                if (ch.trim() && entry.breaks >= 2 && current?.text.trim()) current = undefined;
            }
            // a single line break inside a paragraph becomes a space between words
            const afterBreak = entry.keepsLines && entry.breaks === 1;
            if (ch.trim()) entry.breaks = 0;

            range.setStart(node, i);
            range.setEnd(node, i + 1);
            const r = range.getBoundingClientRect();
            if (!r.width && !r.height) continue;

            const cx = r.left + r.width / 2;
            const cy = r.top + r.height / 2;
            if (cx < area.left || cx > area.right || cy < area.top || cy > area.bottom) continue;

            // checked once per line: part of a text can be hidden (scrolled under a panel) while the rest is visible
            const lineKey = `${elementIds.get(parent)}:${Math.round(r.top)}`;
            let visible = visibleCache.get(lineKey);
            if (visible === undefined) {
                const top = document.elementFromPoint(cx, cy);
                visible = !top || parent.contains(top) || top.contains(parent);
                visibleCache.set(lineKey, visible);
            }
            if (!visible) continue;

            // spaces at the start of a paragraph neither start it nor widen its place
            if (!current && !ch.trim()) continue;
            if (!current) {
                current = { text: "", rect: null };
                entry.parts.push(current as { text: string; rect: Rect; });
            }

            current.text += afterBreak && ch.trim() ? " " + ch : ch;
            if (ch.trim()) current.rect = grow(current.rect, r);
        }
    }

    const blocks: Block[] = [];
    for (const entry of found.values()) {
        for (const part of entry.parts) {
            const text = part.text.replace(/\s+/g, " ").trim();
            if (text && part.rect) blocks.push({ text, rect: part.rect, lineHeight: entry.lineHeight, canGrow: entry.keepsLines || undefined });
        }
    }
    return blocks;
}

/* ---------- reading text from pictures (OCR) ---------- */

let tesseractLoading: Promise<any> | null = null;

function loadTesseract(): Promise<any> {
    const existing = (window as any).Tesseract;
    if (existing) return Promise.resolve(existing);

    tesseractLoading ??= new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = TESSERACT_URL;
        script.onload = () => resolve((window as any).Tesseract);
        script.onerror = () => {
            tesseractLoading = null;
            script.remove();
            reject(new Error("Could not load the text recognition engine"));
        };
        document.head.append(script);
    });

    return tesseractLoading;
}

const workerPromises: Partial<Record<OcrKind, Promise<any>>> = {};
/** The light data could not be loaded: only the exact one is used. */
let fastUnavailable = false;

function getWorker(kind: OcrKind = "best"): Promise<any> {
    workerPromises[kind] ??= (async () => {
        const Tesseract = await loadTesseract();

        let lastError: unknown;
        for (const langPath of OCR_DATA_PATHS[kind]) {
            try {
                const worker = await Tesseract.createWorker(OCR_LANGUAGE, 1, { langPath });
                // "sparse text" mode: look for separate pieces of text scattered over the picture instead of reading it like a page
                await worker.setParameters({ tessedit_pageseg_mode: "11" });
                return worker;
            } catch (e) {
                lastError = e;
            }
        }
        throw lastError;
    })().catch(e => {
        delete workerPromises[kind];
        throw e;
    });
    return workerPromises[kind]!;
}

const nextPaint = () => new Promise<void>(resolve => requestAnimationFrame(() => setTimeout(resolve, 60)));

/** The Discord window as a picture, and where the selected area lies in it. */
interface Picture {
    image: HTMLImageElement;
    /** picture pixels per page pixel (depends on screen scaling and zoom) */
    scale: number;
    sx: number;
    sy: number;
    sw: number;
    sh: number;
}

async function grabPicture(area: Rect): Promise<Picture> {
    // our own notices and buttons must not get onto the photo of the screen: hidden for that moment
    document.body.classList.add(cl("capturing"));
    let dataUrl: string;
    try {
        await nextPaint();
        dataUrl = await Native.captureWindow();
    } finally {
        document.body.classList.remove(cl("capturing"));
    }

    const image = new Image();
    image.src = dataUrl;
    await image.decode();

    const scale = image.naturalWidth / window.innerWidth;
    const sx = Math.max(0, Math.round(area.left * scale));
    const sy = Math.max(0, Math.round(area.top * scale));
    const sw = Math.min(image.naturalWidth - sx, Math.round((area.right - area.left) * scale));
    const sh = Math.min(image.naturalHeight - sy, Math.round((area.bottom - area.top) * scale));
    if (sw < 4 || sh < 4) throw new Error("Selected area is empty");

    return { image, scale, sx, sy, sw, sh };
}

/** Widest picture given to the built-in reader (bigger ones are made smaller first). */
const OCR_MAX_WIDTH = 2000;
/** The inverted second reading is skipped when the first one already found this much text. */
const ENOUGH_LINES = 3;
const ENOUGH_CHARS = 30;

/** Enlarges the selected area and makes two versions of it: as it is and with inverted colours. */
function prepareVersions(picture: Picture, area: Rect): { normal: HTMLCanvasElement; inverted: HTMLCanvasElement; fx: number; fy: number; } {
    const { image, scale, sx, sy, sw, sh } = picture;

    // small text is read much better when enlarged; very big pictures are made smaller (text stays readable,
    // and reading takes far less work: the fans stay quiet)
    let zoom = scale >= 2 ? 1 : 2;
    zoom = Math.min(zoom, OCR_MAX_WIDTH / sw, 4000 / sh);

    const makeCanvas = () => {
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(sw * zoom));
        canvas.height = Math.max(1, Math.round(sh * zoom));
        const ctx = canvas.getContext("2d")!;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(image, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
        return { canvas, ctx };
    };

    const normal = makeCanvas();
    // dark text on a light background is read best, light text on a dark one needs inverting.
    // A picture can have both, so both versions are read.
    const inverted = makeCanvas();
    inverted.ctx.globalCompositeOperation = "difference";
    inverted.ctx.fillStyle = "#fff";
    inverted.ctx.fillRect(0, 0, inverted.canvas.width, inverted.canvas.height);

    // picture pixels per page pixel, to turn positions in the picture back into positions on the screen
    return {
        normal: normal.canvas,
        inverted: inverted.canvas,
        fx: normal.canvas.width / (area.right - area.left),
        fy: normal.canvas.height / (area.bottom - area.top)
    };
}

/** A reading failure whose message is meant to be shown to the user. */
class OcrError extends Error { }

const cleanRecognized = (text: string) => text
    .replace(/\r/g, "")
    .replace(/\s*\n\s*/g, " ")
    .trim();

/** Joins lines that stand right under each other (one sentence broken over several lines) into one piece. */
function groupLines(lines: Block[]): Block[] {
    const sorted = [...lines].sort((a, b) => a.rect.top - b.rect.top || a.rect.left - b.rect.left);
    const groups: { block: Block; last: Rect; rects: Rect[]; }[] = [];

    for (const line of sorted) {
        const height = line.rect.bottom - line.rect.top;
        const width = line.rect.right - line.rect.left;

        const target = groups.find(({ last, block }) => {
            // the reader itself already said these two lines are different paragraphs: never join them,
            // whatever the gap between them looks like (only meaningful within the same reading pass)
            if (block.paragraphSource && block.paragraphSource === line.paragraphSource && block.paragraphId !== line.paragraphId)
                return false;

            const lastHeight = last.bottom - last.top;
            const gap = line.rect.top - last.bottom;
            const overlap = Math.min(last.right, line.rect.right) - Math.max(last.left, line.rect.left);
            const sameSize = height / lastHeight > 0.6 && height / lastHeight < 1.6;
            return sameSize
                && gap > -height * 0.3 && gap < height * 0.7
                && overlap > Math.min(width, last.right - last.left) * 0.3;
        });

        if (target) {
            const r = target.block.rect;
            target.block.text += " " + line.text;
            target.block.rect = {
                left: Math.min(r.left, line.rect.left),
                top: Math.min(r.top, line.rect.top),
                right: Math.max(r.right, line.rect.right),
                bottom: Math.max(r.bottom, line.rect.bottom)
            };
            target.last = line.rect;
            target.rects.push(line.rect);
        } else {
            groups.push({
                block: { text: line.text, rect: { ...line.rect }, paragraphId: line.paragraphId, paragraphSource: line.paragraphSource },
                last: line.rect,
                rects: [line.rect]
            });
        }
    }

    return groups.map(({ block, rects }) => {
        block.lineHeight = rects.reduce((sum, r) => sum + (r.bottom - r.top), 0) / rects.length;
        block.align = alignmentOf(rects);
        return block;
    });
}

/**
 * How the lines of one piece are lined up. Several lines are centred only if their middles match
 * while their left edges do not, otherwise left.
 */
function alignmentOf(rects: Rect[]): "left" | "center" | "single" {
    // one line cannot tell by itself, see resolveAlignments
    if (rects.length < 2) return "single";

    const lefts = rects.map(r => r.left);
    const centers = rects.map(r => (r.left + r.right) / 2);
    const spread = (values: number[]) => Math.max(...values) - Math.min(...values);
    const width = Math.max(...rects.map(r => r.right)) - Math.min(...lefts);

    if (spread(lefts) <= width * 0.06) return "left";
    return spread(centers) <= width * 0.06 ? "center" : "left";
}

interface ScoredLine extends Block {
    confidence: number;
}

const countChars = (text: string) => (text.match(/[\p{L}\p{N}]/gu) ?? []).length;

/** Marks that start a list item (bullets, dashes, arrows...) and are not part of the text. */
const isMarkWord = (word: string) => word.trim() !== "" && !/[\p{L}\p{N}]/u.test(word);

/**
 * List marks at the start of a line ("*", "•", ">") are dropped, together with the room they take,
 * so that the place of the line is the place of its text only.
 */
function withoutLeadingMarks(line: any): { text: string; bbox: { x0: number; y0: number; x1: number; y1: number; }; } {
    const words: any[] = Array.isArray(line.words) ? line.words.filter((w: any) => w?.bbox) : [];
    let skip = 0;
    while (skip < words.length - 1 && isMarkWord(words[skip].text ?? "")) skip++;

    if (!skip) return { text: line.text ?? "", bbox: line.bbox };

    const rest = words.slice(skip);
    return {
        text: rest.map(w => String(w.text ?? "").trim()).join(" "),
        bbox: {
            x0: Math.min(...rest.map(w => w.bbox.x0)),
            y0: Math.min(...rest.map(w => w.bbox.y0)),
            x1: Math.max(...rest.map(w => w.bbox.x1)),
            y1: Math.max(...rest.map(w => w.bbox.y1))
        }
    };
}

/**
 * Lines of text found by the engine, with their places on the screen. Lines it is not sure about are left out.
 * `pass` names this one reading (for example "normal" or "inverted"): paragraph numbers only mean anything
 * when compared within the same pass.
 */
function extractLines(data: any, area: Rect, fx: number, fy: number, pass: string): ScoredLine[] {
    // the reader's own paragraph grouping is trusted over guessing paragraphs from bare pixel gaps ourselves,
    // since it can use signals (indentation, spacing) that a plain gap between two lines cannot show
    const paragraphs: any[] | null = data?.paragraphs ?? data?.blocks?.flatMap((b: any) => b.paragraphs ?? []) ?? null;
    const byParagraph: { line: any; paragraphId?: number; }[] = paragraphs
        // a "paragraph" of a single line says nothing (in the sparse text mode every line is one): only real multi-line
        // paragraphs keep their number, so single lines are joined by the gap between them as usual
        ? paragraphs.flatMap((p: any, i: number) => {
            const lines: any[] = p.lines ?? [];
            return lines.map(line => ({ line, paragraphId: lines.length > 1 ? i : undefined }));
        })
        : [];
    const plain: { line: any; paragraphId?: number; }[] = (data?.lines ?? []).map((line: any) => ({ line }));
    // the paragraph grouping is only used when it holds every line; otherwise nothing would be lost by ignoring it
    const lines = byParagraph.length && byParagraph.length >= plain.length ? byParagraph : plain;

    return lines
        // lines the reader is unsure about are mostly noise read off the picture ("Wh ANN"): left out
        .filter(({ line: l }) => l?.bbox && (typeof l.confidence !== "number" || l.confidence >= MIN_LINE_CONFIDENCE))
        .map(({ line, paragraphId }) => {
            const { text, bbox } = withoutLeadingMarks(line);
            return {
                text: cleanRecognized(text),
                confidence: typeof line.confidence === "number" ? line.confidence : 50,
                paragraphId,
                paragraphSource: paragraphId !== undefined ? pass : undefined,
                rect: {
                    left: area.left + bbox.x0 / fx,
                    top: area.top + bbox.y0 / fy,
                    right: area.left + bbox.x1 / fx,
                    bottom: area.top + bbox.y1 / fy
                }
            };
        })
        .filter(l => hasText(l.text))
        // very short readings must be confident: pictures (avatars, icons) often turn into two unsure letters
        .filter(l => countChars(l.text) > SHORT_LINE_CHARS || l.confidence >= SHORT_LINE_MIN_CONFIDENCE);
}

/** A line of this many letters or fewer counts as "very short". */
const SHORT_LINE_CHARS = 3;
/** How sure the reader must be about a very short line (0-100). */
const SHORT_LINE_MIN_CONFIDENCE = 60;
/** A very short line whose frame is this many times higher than the typical line is a picture, not text. */
const PICTURE_HEIGHT_RATIO = 2.5;

/** Drops very short "lines" whose frame is much taller than the real text lines around them (avatars, icons). */
function dropPictures<T extends Block>(lines: T[]): { kept: T[]; dropped: T[]; } {
    const heights = lines
        .filter(l => countChars(l.text) > SHORT_LINE_CHARS)
        .map(l => l.rect.bottom - l.rect.top)
        .sort((a, b) => a - b);

    // nothing to compare with
    if (!heights.length) return { kept: lines, dropped: [] };

    const typical = heights[Math.floor(heights.length / 2)];
    const isPicture = (l: T) => countChars(l.text) <= SHORT_LINE_CHARS
        && (l.rect.bottom - l.rect.top) > typical * PICTURE_HEIGHT_RATIO;

    return { kept: lines.filter(l => !isPicture(l)), dropped: lines.filter(isPicture) };
}

/** A single line has nothing to compare with, so its alignment is guessed from the other pieces and from the frame. */
function resolveAlignments(blocks: Block[], area: Rect) {
    const tolerance = Math.max(6, (area.right - area.left) * 0.03);
    const middle = (b: Block) => (b.rect.left + b.rect.right) / 2;
    const frameMiddle = (area.left + area.right) / 2;

    for (const block of blocks) {
        if (block.align !== "single") continue;

        // another piece has the same middle but a different left edge: they hang on a common centre line
        const sameAxis = blocks.some(other => other !== block
            && Math.abs(middle(other) - middle(block)) <= tolerance
            && Math.abs(other.rect.left - block.rect.left) > tolerance);

        block.align = sameAxis || Math.abs(middle(block) - frameMiddle) <= tolerance ? "center" : "left";
    }
}

function overlapShare(a: Rect, b: Rect): number {
    const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
    const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
    if (w <= 0 || h <= 0) return 0;

    const smaller = Math.min((a.right - a.left) * (a.bottom - a.top), (b.right - b.left) * (b.bottom - b.top));
    return smaller > 0 ? (w * h) / smaller : 0;
}

const normalizeText = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

/** The same text found twice (in two versions of the picture, or twice by one reader). */
function isTwin(a: Block, b: Block): boolean {
    if (overlapShare(a.rect, b.rect) > 0.5) return true;

    const textA = normalizeText(a.text);
    if (!textA || textA !== normalizeText(b.text)) return false;

    // same words and practically on the same place
    const height = Math.max(a.rect.bottom - a.rect.top, b.rect.bottom - b.rect.top);
    const apart = Math.abs((a.rect.top + a.rect.bottom) / 2 - (b.rect.top + b.rect.bottom) / 2);
    const across = Math.min(a.rect.right, b.rect.right) - Math.max(a.rect.left, b.rect.left);
    const narrower = Math.min(a.rect.right - a.rect.left, b.rect.right - b.rect.left);
    return apart <= height * 0.8 && across > narrower * 0.3;
}

/** Keeps one line of every pair of twins: the one the reader is surer about. */
function mergeTwins(lines: ScoredLine[]): ScoredLine[] {
    const result: ScoredLine[] = [];
    for (const line of lines) {
        const twin = result.findIndex(r => isTwin(r, line));
        if (twin === -1) result.push(line);
        else if (line.confidence > result[twin].confidence) result[twin] = line;
    }
    return result;
}

/* ---------- text reader built into Windows ---------- */

/** Switch for the Windows text reader. When on, it reads together with Tesseract and adds what Tesseract did not find. */
const USE_WINDOWS_OCR = true;

/** Language wanted from the Windows text reader. If it is not installed, the languages of the user's Windows are used. */
const WINDOWS_OCR_LANGUAGE = "en-US";
/** How many times the selected area is enlarged for the Windows text reader (relative to what is seen on screen). */
const WINDOWS_OCR_ENLARGE = 4;
/** The Windows text reader refuses pictures bigger than this (in pixels, per side). */
const WINDOWS_OCR_MAX_SIDE = 2500;

const dataUrlOf = (canvas: HTMLCanvasElement) => canvas.toDataURL("image/png");

/**
 * Reads the text with Windows' own text reader (very good with screenshots, works offline).
 * Returns null when it cannot be used (not Windows, language missing...).
 */
async function readWithWindows(picture: Picture, area: Rect): Promise<ScoredLine[] | null> {
    try {
        const { image, scale, sx, sy, sw, sh } = picture;

        // enlarge so that one page pixel becomes several picture pixels (small text is read more reliably), within the size limit
        const zoom = Math.min(WINDOWS_OCR_ENLARGE / scale, WINDOWS_OCR_MAX_SIDE / sw, WINDOWS_OCR_MAX_SIDE / sh);
        const width = Math.max(1, Math.round(sw * zoom));
        const height = Math.max(1, Math.round(sh * zoom));

        const normal = document.createElement("canvas");
        normal.width = width;
        normal.height = height;
        const ctx = normal.getContext("2d")!;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(image, sx, sy, sw, sh, 0, 0, width, height);

        // the same picture with inverted colours: some light-on-dark text is only found this way
        const inverted = document.createElement("canvas");
        inverted.width = width;
        inverted.height = height;
        const invertedCtx = inverted.getContext("2d")!;
        invertedCtx.drawImage(normal, 0, 0);
        invertedCtx.globalCompositeOperation = "difference";
        invertedCtx.fillStyle = "#fff";
        invertedCtx.fillRect(0, 0, width, height);

        const answer = await Native.windowsOcr([dataUrlOf(normal), dataUrlOf(inverted)], WINDOWS_OCR_LANGUAGE);
        if (!answer.ok) {
            console.warn("[TranslatePerChat] Windows text reader is not available:", answer.error);
            return null;
        }

        const fx = width / (area.right - area.left);
        const fy = height / (area.bottom - area.top);

        const found: ScoredLine[] = [];
        for (const line of answer.images.flat()) {
            // a leading list mark is not text
            const text = cleanRecognized(line.text).replace(/^[*•·●○◦▪■□>»›\-–—]+\s*/u, "");
            if (!hasText(text)) continue;
            // this reader gives no confidence, so very short readings (usually faces, icons) are not trusted
            if (countChars(text) <= SHORT_LINE_CHARS) continue;

            const candidate: ScoredLine = {
                text,
                confidence: 50,
                rect: {
                    left: area.left + line.x / fx,
                    top: area.top + line.y / fy,
                    right: area.left + (line.x + line.w) / fx,
                    bottom: area.top + (line.y + line.h) / fy
                }
            };

            // the same text found in both versions: keep the longer reading
            const twin = found.findIndex(f => overlapShare(f.rect, candidate.rect) > 0.5);
            if (twin === -1) found.push(candidate);
            else if (countChars(candidate.text) > countChars(found[twin].text)) found[twin] = candidate;
        }

        return found;
    } catch (e) {
        console.warn("[TranslatePerChat] Windows text reader failed:", e);
        return null;
    }
}

/** One reading with one set of data: the picture as it is, and inverted when that found little. */
async function readPass(worker: any, normal: HTMLCanvasElement, inverted: HTMLCanvasElement, area: Rect, fx: number, fy: number): Promise<ScoredLine[]> {
    const first = await worker.recognize(normal);
    const firstLines = extractLines(first.data, area, fx, fy, "normal");
    // the first reading found plenty: the second (inverted) one is skipped, it would mostly find the same again
    const plenty = firstLines.length >= ENOUGH_LINES && firstLines.reduce((n, l) => n + countChars(l.text), 0) >= ENOUGH_CHARS;
    const second = plenty ? null : await worker.recognize(inverted);

    // the same text found in both versions (or twice in one): keep the one the engine is surer about
    const found = mergeTwins([...firstLines, ...(second ? extractLines(second.data, area, fx, fy, "inverted") : [])]);
    if (found.length) return found;

    // the engine found text but gave no usable positions: treat everything as one piece covering the frame
    const rawLines = (first.data?.lines?.length ?? 0) + (second?.data?.lines?.length ?? 0);
    const raw = (first.data?.text ?? "").trim();
    return !rawLines && raw ? [{ text: cleanRecognized(raw), confidence: 50, rect: area }] : [];
}

/** Why a light reading is not good enough (empty = good enough). */
function poorReason(lines: ScoredLine[]): string {
    if (!lines.length) return "nothing found";
    const average = lines.reduce((n, l) => n + l.confidence, 0) / lines.length;
    if (average < POOR_CONFIDENCE) return `low certainty ${Math.round(average)}%`;
    const scraps = lines.filter(l => countChars(l.text) <= SCRAP_CHARS).length / lines.length;
    if (scraps >= POOR_SCRAPS_SHARE) return `${Math.round(scraps * 100)}% scraps`;
    return "";
}

/**
 * Reads the text with the built-in engine (Tesseract): first with the light data; only when that reading looks poor,
 * once more with the exact (heavier) data.
 */
async function readWithTesseract(picture: Picture, area: Rect, bubble: Bubble): Promise<ScoredLine[]> {
    const { normal, inverted, fx, fy } = prepareVersions(picture, area);

    if (!fastUnavailable) {
        if (!workerPromises.fast) bubble.setText(t("screenDownloading"), true);
        const fast = await getWorker("fast").catch(e => {
            fastUnavailable = true;
            console.warn("[TranslatePerChat] light reading data could not be loaded, only the exact one is used:", e);
            return null;
        });
        bubble.setText(t("screenWorking"), true);
        if (fast) {
            const lines = await readPass(fast, normal, inverted, area, fx, fy);
            const reason = poorReason(lines);
            if (!reason || bubble.closed) return lines;
        }
    }

    if (!workerPromises.best) bubble.setText(t("screenDownloading"), true);
    const best = await getWorker("best");
    bubble.setText(t("screenWorking"), true);
    return readPass(best, normal, inverted, area, fx, fy);
}

/**
 * Reads the text of the area with both readers at the same time. Tesseract is the main one;
 * whatever the Windows reader found on places where Tesseract found nothing is added.
 */
async function recognize(area: Rect, bubble: Bubble, given?: Picture): Promise<Block[]> {
    try {
        const picture = given ?? await grabPicture(area);

        // one reader after the other (not both at once): half the load at any moment, the fans stay calmer
        const fromWindows = USE_WINDOWS_OCR ? await readWithWindows(picture, area) : null;
        if (bubble.closed) return [];
        const fromTesseract = await readWithTesseract(picture, area, bubble).catch(e => {
            console.warn("[TranslatePerChat] Tesseract failed:", e);
            return null;
        });

        // neither reader could work
        if (!fromWindows && !fromTesseract) throw new Error("No text reader is available");

        const lines = [...(fromTesseract ?? [])];
        const addedByWindows: ScoredLine[] = [];
        for (const line of fromWindows ?? []) {
            if (!lines.some(l => isTwin(l, line))) {
                lines.push(line);
                addedByWindows.push(line);
            }
        }

        const exact = (l: ScoredLine) => [l.rect.left, l.rect.top, l.rect.right, l.rect.bottom].map(n => Number(n.toFixed(1))).join(" ");
        const show = (who: string, l: ScoredLine) => ({
            who,
            text: l.text,
            confidence: Math.round(l.confidence),
            size: `${Math.round(l.rect.right - l.rect.left)}x${Math.round(l.rect.bottom - l.rect.top)}`,
            at: `${Math.round(l.rect.left)},${Math.round(l.rect.top)}`,
            rect: exact(l),
            paragraph: l.paragraphSource ? `${l.paragraphSource}:${l.paragraphId}` : undefined
        });

        // safety net: the same text must never stay in the list twice, whatever reader it came from
        const unique = mergeTwins(lines);
        if (unique.length !== lines.length) {
        }

        const { kept, dropped } = dropPictures(unique);

        return kept.length ? groupLines(kept) : [];
    } catch (e) {
        console.error("[TranslatePerChat] text recognition failed", e);
        throw new OcrError(t("screenOcrFail"));
    }
}

/* ---------- translation shown on top of the original ---------- */

const MAX_BLOCKS = 100;
const PATCH_PADDING = 3;

/** At least two letters or digits, and not just a smiley (those are left as they are). */
const hasText = (text: string) => (text.match(/[\p{L}\p{N}]/gu) ?? []).length >= 2 && !isOnlyEmoticons(text);

/** Translates every piece separately (in parallel). A piece that fails is left out. */
async function translateBlocks(blocks: Block[]): Promise<(string | null)[]> {
    // a few at a time: a hundred requests at once could be refused for asking too often
    const results = await runLimited(blocks, 4, async block => {
        try {
            return (await translateKeepingEmoticons("received", block.text, true)).text;
        } catch {
            return null;
        }
    });

    if (results.every(r => r === null)) {
        // show the real reason to the user (the translator reports it in a message)
        try {
            await translateKeepingEmoticons("received", blocks[0].text);
        } catch { /* already shown */ }
    }

    return results;
}

/** Text size tried first when the size of the original is not known, and the largest size ever used. */
const DEFAULT_FONT_SIZE = 26;
const MAX_FONT_SIZE = 72;

/** Smallest text size used on the patches (a plugin setting). */
const minFontSize = () => {
    const value = Number(settings.store.screenMinFontSize);
    return Number.isFinite(value) && value >= 6 ? Math.min(value, MAX_FONT_SIZE) : 11;
};

/** Short labels (a name, a word or two) are kept on one line instead of being broken up. */
const isShortLabel = (text: string) => text.trim().split(/\s+/).length <= 2;

/** Space taken by the padding of a patch (see styles.css), left+right and top+bottom. */
const PATCH_INNER_X = 8;
const PATCH_INNER_Y = 4;

/** Width of the longest word at the current text size (a word is never broken if it can be helped). */
function longestWordWidth(patch: HTMLElement, text: HTMLElement): number {
    const probe = document.createElement("span");
    probe.style.cssText = "position:absolute;visibility:hidden;white-space:nowrap;";
    patch.append(probe);

    let widest = 0;
    for (const word of (text.textContent ?? "").split(/\s+/)) {
        probe.textContent = word;
        widest = Math.max(widest, probe.offsetWidth);
    }

    probe.remove();
    return widest;
}

/**
 * Picks the biggest text size at which the translation still fits into the place of the original,
 * but not bigger than the original text itself (when its size is known).
 * Words are never broken if it can be helped: first the text gets smaller, then the patch gets wider
 * (to the right, or on both sides for centred text, but never out of the frame), and only then a word is broken.
 * A name or a word or two is kept on one line.
 */
function fitText(patch: HTMLElement, text: HTMLElement, height: number, frameWidth: number, lineHeight: number | undefined, centered: boolean, maxHeight = height) {
    patch.style.height = `${height}px`;
    /** When the patch may grow downwards: make it as tall as its text needs (but not taller than allowed). */
    const grown = () => {
        if (maxHeight > height) patch.style.height = `${Math.max(height, Math.min(maxHeight, text.offsetHeight + PATCH_INNER_Y))}px`;
    };

    const min = minFontSize();
    const start = lineHeight ? Math.min(MAX_FONT_SIZE, Math.max(min, Math.round(lineHeight))) : DEFAULT_FONT_SIZE;

    const fits = () => text.offsetHeight <= maxHeight - PATCH_INNER_Y + 1 && text.scrollWidth <= text.clientWidth + 1;
    const tryFit = () => {
        for (let size = start; size >= min; size--) {
            patch.style.fontSize = `${size}px`;
            if (fits()) return true;
        }
        return false;
    };

    /** Makes the patch wider if the frame has room for it. */
    const widenTo = (needed: number) => {
        const width = patch.offsetWidth;
        if (needed <= width) return true;
        if (needed > frameWidth) return false;

        const left = parseFloat(patch.style.left) || 0;
        const wanted = centered ? left - (needed - width) / 2 : left;
        patch.style.left = `${Math.min(Math.max(wanted, 0), frameWidth - needed)}px`;
        patch.style.width = `${needed}px`;
        return true;
    };

    if (isShortLabel(text.textContent ?? "")) {
        patch.style.whiteSpace = "nowrap";
        if (tryFit()) return grown();

        patch.style.fontSize = `${min}px`;
        if (widenTo(text.scrollWidth + PATCH_INNER_X + 1) && tryFit()) return grown();
        patch.style.whiteSpace = "";
    }

    // line breaks between words
    if (tryFit()) return grown();

    // still no: maybe one word is wider than the patch
    patch.style.fontSize = `${min}px`;
    const widened = widenTo(longestWordWidth(patch, text) + PATCH_INNER_X + 1);
    if (widened && tryFit()) return grown();

    // last resort: break inside a word
    if (!widened) {
        patch.style.wordBreak = "break-word";
        if (tryFit()) return grown();
    }

    // does not fit even at the smallest size: let it grow downwards instead of cutting the text
    patch.style.height = "auto";
}

/** A short message in the middle of the selected frame (nothing found, reading failed). It goes away by itself. */
function showNotice(area: Rect, message: string, onPicture?: Element): Closable {
    currentBubble?.close("replaced by a new window");

    const root = document.createElement("div");
    // on a picture: no frame, just the text in the middle (it moves with the picture)
    root.className = cl("screen-notice", { "screen-notice-plain": !!onPicture });
    root.setAttribute(MARK, "");
    Object.assign(root.style, {
        left: `${area.left}px`,
        top: `${area.top}px`,
        width: `${area.right - area.left}px`,
        height: `${area.bottom - area.top}px`
    });

    const text = document.createElement("div");
    text.className = cl("screen-notice-text");
    text.textContent = message;
    root.append(text);
    document.body.append(root);

    const onDismiss = () => notice.close("click");
    const onKeyDown = (e: KeyboardEvent) => {
        if (e.key !== "Escape") return;
        e.preventDefault();
        e.stopPropagation();
        notice.close("Esc");
    };
    const timer = window.setTimeout(() => notice.close("time is up"), 5000);

    const notice: Closable = {
        closed: false,
        close(reason) {
            if (notice.closed) return;
            notice.closed = true;
            window.clearTimeout(timer);
            window.removeEventListener("mousedown", onDismiss, true);
            window.removeEventListener("keydown", onKeyDown, true);
            root.remove();
            if (currentBubble === notice) currentBubble = null;
        }
    };

    window.addEventListener("mousedown", onDismiss, true);
    window.addEventListener("keydown", onKeyDown, true);

    currentBubble = notice;
    follow([root], onPicture, () => notice.closed);
    return notice;
}

/** Closing of a shown translation: ignore everything in the first moments, and small scrolls and drags after that. */
const CLOSE_GRACE_MS = 600;
const WHEEL_CLOSE_DISTANCE = 60;
const CLICK_MAX_MOVE = 6;

/** Puts the translated pieces on top of the frame, each one on the place of its original. */
function showResult(area: Rect, items: Block[], passThrough = false, picture = false, anchor?: Element | null): PictureResult {
    currentBubble?.close("replaced by a new window");

    const root = document.createElement("div");
    // on a picture: no dashed frame around it (it stays on a selected area)
    root.className = cl("screen-result", { "screen-result-picture": picture });
    root.setAttribute(MARK, "");
    root.title = t("screenToggleHint");
    Object.assign(root.style, {
        left: `${area.left}px`,
        top: `${area.top}px`,
        width: `${area.right - area.left}px`,
        height: `${area.bottom - area.top}px`
    });

    const patches: { el: HTMLElement; text: HTMLElement; height: number; maxHeight: number; lineHeight?: number; centered: boolean; }[] = [];

    /** Empty space under a piece: down to the next piece below it (that overlaps it sideways) or to the bottom of the frame. */
    const roomBelow = (item: Block) => {
        let limit = area.bottom;
        for (const other of items) {
            if (other === item || other.rect.top < item.rect.bottom) continue;
            if (other.rect.right <= item.rect.left || other.rect.left >= item.rect.right) continue;
            limit = Math.min(limit, other.rect.top);
        }
        return Math.max(0, limit - item.rect.bottom - PATCH_PADDING * 2 - 2);
    };
    for (const item of items) {
        const el = document.createElement("div");
        el.className = cl("screen-patch");

        // the text sits in its own element so that it can be centred (up-down) and lined up (left or centre)
        const text = document.createElement("div");
        text.className = cl("screen-patch-text");
        text.style.textAlign = item.align === "center" ? "center" : "left";
        text.textContent = item.text;
        el.append(text);

        const width = item.rect.right - item.rect.left + PATCH_PADDING * 2;
        const height = item.rect.bottom - item.rect.top + PATCH_PADDING * 2;
        const left = item.rect.left - area.left - PATCH_PADDING;
        Object.assign(el.style, {
            left: `${left}px`,
            top: `${item.rect.top - area.top - PATCH_PADDING}px`,
            width: `${Math.max(width, 24)}px`
        });

        root.append(el);
        const fixedHeight = Math.max(height, 14);
        patches.push({ el, text, height: fixedHeight, maxHeight: item.canGrow ? fixedHeight + roomBelow(item) : fixedHeight, lineHeight: item.lineHeight, centered: item.align === "center" });
    }

    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.className = cl("screen-result-close");
    closeButton.textContent = "\u00d7";
    root.append(closeButton);

    // on a picture: no cross (the translate button next to the picture closes it), and every click goes to the picture
    // itself (so it still opens large)
    if (picture) {
        closeButton.style.display = "none";
        root.style.pointerEvents = "none";
        root.removeAttribute("title");
    } else if (passThrough) {
        // clicks go through the empty parts of the frame to what is under it (only the patches and the cross catch them)
        root.style.pointerEvents = "none";
        closeButton.style.pointerEvents = "auto";
        for (const { el } of patches) el.style.pointerEvents = "auto";
    }

    document.body.append(root);
    // the size can only be measured once the pieces are on the page
    const frameWidth = area.right - area.left;
    for (const { el, text, height, maxHeight, lineHeight, centered } of patches) fitText(el, text, height, frameWidth, lineHeight, centered, maxHeight);

    // a patch that had to grow downwards must not cover the next one: the patches under it move down
    const placed = patches.map(p => p.el).sort((a, b) => a.offsetTop - b.offsetTop);
    for (let i = 0; i < placed.length; i++) {
        const upper = placed[i];
        const bottom = upper.offsetTop + upper.offsetHeight + 2;
        for (let j = i + 1; j < placed.length; j++) {
            const lower = placed[j];
            const sideways = Math.min(upper.offsetLeft + upper.offsetWidth, lower.offsetLeft + lower.offsetWidth) - Math.max(upper.offsetLeft, lower.offsetLeft);
            if (sideways > 0 && lower.offsetTop < bottom && lower.offsetTop >= upper.offsetTop) lower.style.top = `${bottom}px`;
        }
    }

    // things that must not close the translation by accident: the first moments (touchpad inertia, the click that
    // finished the selection), a slight scroll, the end of a drag
    const shownAt = Date.now();
    const settled = () => Date.now() - shownAt > CLOSE_GRACE_MS;
    let pressAt: { x: number; y: number; } | null = null;
    let scrolled = 0;
    let lastWheel = 0;

    const onMouseDown = (e: MouseEvent) => {
        // the buttons of the plugin (for example the ones next to a picture) are not "outside"
        const target = e.target as Element | null;
        pressAt = root.contains(target) || target?.closest?.(`[${MARK}]`) ? null : { x: e.clientX, y: e.clientY };
    };
    const onMouseUp = (e: MouseEvent) => {
        // only a plain click outside closes it, not the end of a drag (for example selecting text next to it)
        if (pressAt && settled() && Math.hypot(e.clientX - pressAt.x, e.clientY - pressAt.y) < CLICK_MAX_MOVE)
            result.close("click outside");
        pressAt = null;
    };
    const onKeyDown = (e: KeyboardEvent) => {
        if (e.key !== "Escape") return;
        e.preventDefault();
        e.stopPropagation();
        result.close("Esc");
    };
    // the picture would move away from under the translation, so close it once it has really moved
    const onWheel = (e: WheelEvent) => {
        // following a picture or a message: it moves together with it instead
        if (anchor || !settled()) return;
        const now = Date.now();
        if (now - lastWheel > 500) scrolled = 0;
        lastWheel = now;
        scrolled += Math.abs(e.deltaY) + Math.abs(e.deltaX);
        if (scrolled >= WHEEL_CLOSE_DISTANCE) result.close("scroll");
    };
    const onResize = () => {
        if (!anchor && settled()) result.close("window resize");
    };

    const closeListeners: (() => void)[] = [];
    const originals = items.map(i => i.original ?? "");
    const result: PictureResult = {
        closed: false,
        toggle() {
            root.classList.toggle(cl("screen-result-original"));
        },
        showingOriginal() {
            return root.classList.contains(cl("screen-result-original"));
        },
        shownText() {
            return (result.showingOriginal() ? originals : items.map(i => i.text)).filter(Boolean).join("\n");
        },
        onClose(listener) {
            closeListeners.push(listener);
        },
        close(reason) {
            if (result.closed) return;
            result.closed = true;
            for (const listener of closeListeners) {
                try { listener(); } catch (e) { console.error("[TranslatePerChat]", e); }
            }
            window.removeEventListener("mousedown", onMouseDown, true);
            window.removeEventListener("mouseup", onMouseUp, true);
            window.removeEventListener("keydown", onKeyDown, true);
            window.removeEventListener("wheel", onWheel, true);
            window.removeEventListener("resize", onResize, true);
            root.remove();
            if (currentBubble === result) currentBubble = null;
        }
    };

    // a click shows the original for a moment and back (not on pictures: there the click opens the picture)
    if (!picture) root.addEventListener("click", e => {
        if (e.target === closeButton) return;
        root.classList.toggle(cl("screen-result-original"));
    });
    closeButton.addEventListener("click", () => result.close("cross"));

    window.addEventListener("mousedown", onMouseDown, true);
    window.addEventListener("mouseup", onMouseUp, true);
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("wheel", onWheel, { capture: true, passive: true });
    window.addEventListener("resize", onResize, true);

    currentBubble = result;
    follow([root], anchor, () => result.closed);
    return result;
}

/* ---------- running everything ---------- */

/**
 * The picture file itself in full size (much better for small text than a photo of the screen).
 * `area` is where the picture is shown on the screen (it may go beyond the window).
 */
/**
 * Address of the picture's file in full size. The chat shows a smaller copy; the original is taken from the message itself
 * (Discord keeps the address of every attachment there), else from the link around the picture, else the copy's address
 * without its size limits.
 */
function originalUrl(img: HTMLImageElement): string {
    const src = img.currentSrc || img.src;
    const path = (u?: string) => { try { return u ? new URL(u).pathname : ""; } catch { return ""; } };
    const unlimited = (u: string) => {
        try {
            const url = new URL(u);
            url.searchParams.delete("width");
            url.searchParams.delete("height");
            return url.href;
        } catch { return u; }
    };

    const row = img.closest('[id^="chat-messages-"]');
    const [, channelId, messageId] = row?.id.match(/^chat-messages-(\d+)-(\d+)$/) ?? [];
    const message: any = channelId ? MessageStore.getMessage(channelId, messageId) : null;
    if (message) {
        const mine = path(src);
        for (const a of message.attachments ?? []) {
            if (path(a.proxy_url) === mine || path(a.url) === mine) return unlimited(a.proxy_url || a.url);
        }
        for (const e of message.embeds ?? []) {
            for (const m of [e.image, e.thumbnail, ...(e.images ?? [])]) {
                if (!m) continue;
                const proxy = m.proxyURL ?? m.proxy_url;
                if (path(proxy) === mine || path(m.url) === mine) return unlimited(proxy || m.url);
            }
        }
    }

    const link = img.closest("a")?.href;
    if (link && /\.(png|jpe?g|webp|gif|bmp)(\?|$)/i.test(link)) return link;
    return unlimited(src);
}

async function loadFullPicture(img: HTMLImageElement, area: Rect): Promise<Picture> {
    const url = originalUrl(img);

    const response = await fetch(url);
    if (!response.ok) throw new Error(`picture could not be downloaded (${response.status})`);
    const blobUrl = URL.createObjectURL(await response.blob());
    try {
        const image = new Image();
        image.src = blobUrl;
        await image.decode();
        // not bigger than what the chat shows: the original was not found (small text may not be read)
        if (image.naturalWidth <= (area.right - area.left) * 1.1)
            console.warn("[TranslatePerChat] the picture file is not bigger than on the screen:", image.naturalWidth, "px wide,", url);
        return {
            image,
            scale: image.naturalWidth / Math.max(1, area.right - area.left),
            sx: 0,
            sy: 0,
            sw: image.naturalWidth,
            sh: image.naturalHeight
        };
    } finally {
        // the picture is already decoded, the link is not needed any more
        setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
    }
}

/** Moves pieces found on a picture shown in one place to the same picture shown in another place (and size). */
function moveBlocks(blocks: Block[], from: Rect, to: Rect): Block[] {
    const kx = (to.right - to.left) / Math.max(1, from.right - from.left);
    const ky = (to.bottom - to.top) / Math.max(1, from.bottom - from.top);
    return blocks.map(b => ({
        ...b,
        lineHeight: b.lineHeight !== undefined ? b.lineHeight * ky : undefined,
        rect: {
            left: to.left + (b.rect.left - from.left) * kx,
            top: to.top + (b.rect.top - from.top) * ky,
            right: to.left + (b.rect.right - from.left) * kx,
            bottom: to.top + (b.rect.bottom - from.top) * ky
        }
    }));
}

const rectOf = (el: Element): Rect => {
    const r = el.getBoundingClientRect();
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
};

/** Opens the picture in Discord's large view (like a click on it) and waits until the large picture stands still. */
async function openLarge(img: HTMLImageElement): Promise<HTMLImageElement | null> {
    const r = img.getBoundingClientRect();
    const clickable = document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2) as HTMLElement | null;
    (clickable ?? img).click();

    let last = "";
    for (let i = 0; i < 40; i++) {
        await new Promise(res => setTimeout(res, 100));
        const large = [...document.querySelectorAll("img")]
            .filter(el => el !== img && !el.closest('[id^="chat-messages-"]') && el.closest('[role="dialog"], [class*="layer"]'))
            .map(el => ({ el, r: el.getBoundingClientRect() }))
            .filter(x => x.r.width > r.width && x.r.height > 40)
            .sort((a, b) => b.r.width * b.r.height - a.r.width * a.r.height)[0];
        if (!large || !large.el.complete) continue;
        // wait for the opening animation to end: the same place twice in a row
        const now = [large.r.left, large.r.top, large.r.width, large.r.height].map(Math.round).join(",");
        if (now === last) return large.el;
        last = now;
    }
    return null;
}

/**
 * Reads and translates the text on one picture (the button next to pictures), with patches on top of it.
 * If the text would be too small on a small picture in the chat, the picture is opened large and the translation is shown there.
 * Gives the shown translation (and the picture it lies on), or null.
 */
/** Pictures read and translated lately: the same picture again costs nothing (no reading, no translator). */
const PICTURE_CACHE_SIZE = 30;
const pictureCache = new Map<string, { blocks: Block[]; area: Rect; translated: string[]; fromFile: boolean; }>();

/**
 * Translates the text on a picture. Cancelled with the cross / Esc: the answer comes at once (nothing), so the button
 * is free again; the work already started finishes quietly and its result is thrown away (the translator is not asked).
 */
export function translateImage(img: HTMLImageElement, onFail?: (message: string) => void): Promise<{ result: PictureResult; img: HTMLImageElement; } | null> {
    let cancel: (() => void) | undefined;
    const cancelled = new Promise<null>(resolve => { cancel = () => resolve(null); });
    return Promise.race([translateImageWork(img, onFail, bubble => bubble.onClose(reason => { if (reason) cancel?.(); })), cancelled]);
}

async function translateImageWork(img: HTMLImageElement, onFail: ((message: string) => void) | undefined, watch: (bubble: Bubble) => void): Promise<{ result: PictureResult; img: HTMLImageElement; } | null> {
    const whole = rectOf(img);
    const visible: Rect = {
        left: Math.max(0, whole.left),
        top: Math.max(0, whole.top),
        right: Math.min(window.innerWidth, whole.right),
        bottom: Math.min(window.innerHeight, whole.bottom)
    };
    if (visible.right - visible.left < 8 || visible.bottom - visible.top < 8) return null;

    const bubble = openBubble(visible, t("screenWorking"), img);
    watch(bubble);
    try {
        let area = whole;
        let picture: Picture | undefined;
        let fromFile = false;
        let blocks: Block[];
        let translated: string[];

        // translated before (same file, same languages): nothing is read or translated again
        const key = `${originalUrl(img)}|${settings.store.service}|${settings.store.receivedInput}|${settings.store.receivedOutput}`;
        const known = pictureCache.get(key);
        if (known) {
            blocks = moveBlocks(known.blocks, known.area, whole);
            translated = known.translated;
            fromFile = known.fromFile;
        } else {
            // the file in full size if it can be downloaded, otherwise a photo of the visible part of the screen
            try {
                picture = await loadFullPicture(img, whole);
                fromFile = true;
            } catch (e) {
                console.warn("[TranslatePerChat] using a photo of the screen instead of the picture file:", e);
                area = visible;
            }
            if (bubble.closed) return null;

            blocks = (await recognize(area, bubble, picture)).filter(b => hasText(b.text)).slice(0, MAX_BLOCKS);
            if (bubble.closed) return null;
            if (!blocks.length) {
                bubble.close();
                if (onFail) onFail(t("textNotFound"));
                else showNotice(visible, t("textNotFound"), img);
                return null;
            }

            resolveAlignments(blocks, area);
            translated = await translateBlocks(blocks);
            if (bubble.closed) return null;
            // only a reading of the whole file is remembered (a photo of the screen depends on what was visible)
            if (fromFile) {
                pictureCache.set(key, { blocks, area, translated, fromFile });
                while (pictureCache.size > PICTURE_CACHE_SIZE) pictureCache.delete(pictureCache.keys().next().value!);
            }
        }
        bubble.close();

        // too small to read here: show it on the large picture instead
        let target = img;
        const minText = Number(settings.store.imageMinTextPx ?? 10);
        const heights = blocks.map(b => b.lineHeight ?? b.rect.bottom - b.rect.top).sort((x, y) => x - y);
        const typical = heights[Math.floor(heights.length / 2)];
        if (minText > 0 && typical < minText && img.closest('[id^="chat-messages-"]') && fromFile) {
            const large = await openLarge(img);
            if (large) {
                const to = rectOf(large);
                blocks = moveBlocks(blocks, area, to);
                area = to;
                target = large;
            }
        }

        const items = blocks
            .map((b, i) => ({ ...b, original: b.text, text: translated[i] ?? "" }))
            .filter(b => b.text);
        if (!items.length) return null;
        return { result: showResult(area, items, false, true, target), img: target };
    } catch (e) {
        if (!(e instanceof OcrError)) console.error("[TranslatePerChat] picture translation failed", e);
        const wasClosed = bubble.closed;
        bubble.close();
        if (!wasClosed) {
            const message = e instanceof OcrError ? t("ocrFail") : t("transFail");
            if (onFail) onFail(message);
            else showNotice(visible, e instanceof OcrError ? e.message : message, img);
        }
        return null;
    }
}

/** Translates every message visible in the chat, without selecting an area. */
export function translateWholeChat() {
    const list = document.querySelector('[data-list-id="chat-messages"]');
    const scroller = list?.closest('[class*="scroller"]') ?? list;
    if (!scroller) return;

    const r = scroller.getBoundingClientRect();
    const area: Rect = {
        left: Math.max(0, r.left),
        top: Math.max(0, r.top),
        right: Math.min(window.innerWidth, r.right),
        bottom: Math.min(window.innerHeight, r.bottom)
    };
    if (area.right - area.left < 8 || area.bottom - area.top < 8) return;
    void translateArea(area, true);
}

async function translateArea(area: Rect, onlyPageText = false) {
    // pictures, files and other things with a button of their own: the selection does what their button does
    if (!onlyPageText) {
        const picks = findPicks(area);
        if (picks.length) {
            for (const pick of picks) void pick.run(message => showNotice(area, message));
            // text lying under the same area is still swapped in place below; without any, we are done
            if (!findReplaceTargets(area).length) return;
        }
    }

    // the translation moves with the chat if the area is on a message
    const anchor = messageUnder(area);
    // the bubble only tells that we are working
    const bubble = openBubble(area, t("screenWorking"));

    try {
        // let the selection frame disappear from the screen before looking at it
        await nextPaint();

        // real text of messages, replies, embeds or a text file: swap it for the translation right where it is
        const targets = findReplaceTargets(area);
        if (targets.length) {
            const done = await replaceInPlace(targets);
            if (bubble.closed) return;

            bubble.close();
            if (!done) showNotice(area, t("screenNoText"));
            return;
        }
        if (onlyPageText) {
            bubble.close();
            showNotice(area, t("screenNoText"));
            return;
        }

        let blocks = readPageBlocks(area);
        if (!blocks.length) blocks = await recognize(area, bubble);

        // fewer than two letters or digits is noise, not text
        blocks = blocks.filter(b => hasText(b.text)).slice(0, MAX_BLOCKS);
        if (bubble.closed) return;
        if (!blocks.length) {
            bubble.close();
            showNotice(area, t("screenNoText"));
            return;
        }

        resolveAlignments(blocks, area);

        const translated = await translateBlocks(blocks);
        if (bubble.closed) return;

        const items = blocks
            .map((b, i) => ({ ...b, text: translated[i] ?? "" }))
            .filter(b => b.text);
        bubble.close();
        if (items.length) showResult(area, items, false, false, anchor);
    } catch (e) {
        // a reading failure is told in the middle of the frame; other failures have been reported by the translator
        if (!(e instanceof OcrError)) console.error("[TranslatePerChat] screen translation failed", e);
        const wasClosed = bubble.closed;
        bubble.close();
        if (e instanceof OcrError && !wasClosed) showNotice(area, e.message);
    }
}

/* ---------- selecting the area ---------- */

let selecting = false;

export function startScreenTranslate() {
    if (selecting) return;
    selecting = true;
    currentBubble?.close("replaced by a new window");

    const overlay = document.createElement("div");
    overlay.className = cl("screen-overlay");
    overlay.setAttribute(MARK, "");

    const box = document.createElement("div");
    box.className = cl("screen-box");
    box.style.display = "none";

    const hint = document.createElement("div");
    hint.className = cl("screen-hint");
    hint.textContent = t("screenHint");

    overlay.append(box, hint);
    document.body.append(overlay);

    let start: { x: number; y: number; } | null = null;

    const rectFrom = (e: MouseEvent): Rect => ({
        left: Math.min(start!.x, e.clientX),
        top: Math.min(start!.y, e.clientY),
        right: Math.max(start!.x, e.clientX),
        bottom: Math.max(start!.y, e.clientY)
    });

    const stop = () => {
        selecting = false;
        overlay.remove();
        window.removeEventListener("mousemove", onMove, true);
        window.removeEventListener("mouseup", onUp, true);
        window.removeEventListener("keydown", onKey, true);
        window.removeEventListener("contextmenu", onContext, true);
    };

    const onDown = (e: MouseEvent) => {
        if (e.button !== 0) return;
        e.preventDefault();
        start = { x: e.clientX, y: e.clientY };
        overlay.classList.add(cl("screen-overlay-selecting"));
        hint.style.display = "none";
        box.style.display = "";
        onMove(e);
    };

    function onMove(e: MouseEvent) {
        if (!start) return;
        const r = rectFrom(e);
        Object.assign(box.style, {
            left: `${r.left}px`,
            top: `${r.top}px`,
            width: `${r.right - r.left}px`,
            height: `${r.bottom - r.top}px`
        });
    }

    function onUp(e: MouseEvent) {
        if (!start || e.button !== 0) return;
        const area = rectFrom(e);
        stop();

        // a simple click without dragging cancels
        if (area.right - area.left < 8 || area.bottom - area.top < 8) return;
        void translateArea(area);
    }

    function onKey(e: KeyboardEvent) {
        if (e.key !== "Escape") return;
        e.preventDefault();
        e.stopPropagation();
        stop();
    }

    function onContext(e: MouseEvent) {
        e.preventDefault();
        stop();
    }

    overlay.addEventListener("mousedown", onDown);
    window.addEventListener("mousemove", onMove, true);
    window.addEventListener("mouseup", onUp, true);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("contextmenu", onContext, true);
}
