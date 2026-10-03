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
 * A small plate with two buttons, shown while the message is hovered:
 * translate (the text is swapped for the translation right in the message; again = off) and copy (what is shown now).
 * First message of a group: next to the time in the name line.
 * Following messages: one plate on the left, in place of the time (the time is written under it), and one at the end
 * of the text; which one shows depends on where the mouse is along the text (both in the middle).
 */

import { Message } from "@vencord/discord-types";
import { Tooltip, useEffect, useLayoutEffect, useRef, useState } from "@webpack/common";

import { useFlash } from "./Notify";
import { hasTranslatableText, messageState, onReplacedChange, resetMessage, translateMessage } from "./PageReplace";
import { TranslateIcon } from "./TranslateIcon";
import { cl } from "./utils";
import { t, useT } from "./i18n";

const PLATE_GAP = 8;
const PLATE_HEIGHT = 26;
/** Share of the text width (from its start) where only the left plate shows; from the end, only the right one; both in between. */
const LEFT_ZONE = 0.45;
const RIGHT_ZONE = 0.55;

interface Position {
    left: number;
    top: number;
}

interface Layout {
    /** First message of a group: one plate next to the time in the name line. */
    header?: Position;
    /** Following messages: the plate in place of the time on the left, and the time text to write under it. */
    left?: Position;
    time?: string;
    /** Following messages: the plate at the end of the text. */
    right?: Position;
}

const rowOf = (el: HTMLElement) => el.closest<HTMLElement>('[id^="chat-messages-"]');

/** All lines of the message text on screen. */
function textRects(text: HTMLElement): DOMRect[] {
    const range = document.createRange();
    range.selectNodeContents(text);
    return Array.from(range.getClientRects()).filter(r => r.width > 0 && r.height > 0);
}

/** Converts a point on screen into the coordinates of the element the plates are placed in. */
function toHolder(holder: HTMLElement, x: number, y: number): Position {
    const r = holder.getBoundingClientRect();
    return {
        left: Math.round(x - r.left - holder.clientLeft + holder.scrollLeft),
        top: Math.round(y - r.top - holder.clientTop + holder.scrollTop)
    };
}

function measure(anchor: HTMLElement, messageId: string, plateWidth: number): Layout | null {
    const row = rowOf(anchor);
    const holder = anchor.offsetParent as HTMLElement | null;
    if (!row || !holder) return null;
    const rowRect = row.getBoundingClientRect();

    const headerTime = row.querySelector<HTMLElement>("h3 time");
    if (headerTime) {
        const r = headerTime.getBoundingClientRect();
        return { header: toHolder(holder, r.right + PLATE_GAP, (r.top + r.bottom) / 2 - PLATE_HEIGHT / 2) };
    }

    const text = row.querySelector<HTMLElement>(`#message-content-${messageId}`);
    const lines = text ? textRects(text) : [];
    if (!text || !lines.length) return null;

    const first = lines[0];
    const last = lines[lines.length - 1];
    const layout: Layout = {};

    // left: centred in the empty strip before the text and on the first line (like the plate on the right); the time hangs under it
    const time = row.querySelector<HTMLElement>("time");
    const textLeft = Math.min(...lines.map(r => r.left));
    const stripCentre = (rowRect.left + textLeft) / 2;
    layout.left = toHolder(holder, stripCentre - plateWidth / 2, (first.top + first.bottom) / 2 - PLATE_HEIGHT / 2);
    // (the time holds brackets for screen readers: not shown)
    layout.time = time?.textContent?.replace(/[[\]]/g, "").trim() || undefined;

    // right: after the end of the last line, never out of the message
    const x = Math.min(last.right + PLATE_GAP, rowRect.right - plateWidth - PLATE_GAP);
    layout.right = toHolder(holder, x, (last.top + last.bottom) / 2 - PLATE_HEIGHT / 2);

    return layout;
}

export function SwapIcon(props: { width?: number; height?: number; }) {
    return (
        <svg width={props.width ?? 16} height={props.height ?? 16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 7h14l-3-3M18 7l-3 3M20 17H6l3 3M6 17l3-3" />
        </svg>
    );
}

export function CopyIcon(props: { width?: number; height?: number; }) {
    return (
        <svg width={props.width ?? 16} height={props.height ?? 16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <rect x="9" y="9" width="11" height="11" rx="2" />
            <path d="M5 15V6a2 2 0 0 1 2-2h8" />
        </svg>
    );
}

function PlateButton({ tip, active, busy, onClick, onLeave, children }: { tip: string; active?: boolean; busy?: boolean; onClick(): void; onLeave?(): void; children: React.ReactNode; }) {
    return (
        <Tooltip text={tip}>
            {({ onMouseEnter, onMouseLeave }) => (
                <button
                    type="button"
                    className={cl("plate-button", { "plate-button-active": !!active })}
                    aria-label={tip}
                    disabled={busy}
                    onMouseEnter={onMouseEnter}
                    onMouseLeave={() => {
                        onMouseLeave();
                        onLeave?.();
                    }}
                    onClick={onClick}
                >
                    {children}
                </button>
            )}
        </Tooltip>
    );
}

export function MessageButtons({ message }: { message: Message; }) {
    const t = useT();
    const ref = useRef<HTMLDivElement>(null);
    const [layout, setLayout] = useState<Layout | null>(null);
    const [zone, setZone] = useState<"left" | "right" | "both">("both");
    // notices shown in the buttons' tips for a moment
    const [translateFlash, flashTranslate, resetTranslateFlash] = useFlash();
    const [copyFlash, flashCopy, resetCopyFlash] = useFlash();
    const [state, setState] = useState<"translation" | "original" | undefined>(undefined);
    const [busy, setBusy] = useState(false);

    const enabled = !(message as any).vencordEmbeddedBy && !!(message.content || message.embeds?.length || message.messageSnapshots?.length);

    // follow the translation state of this message (it can change from the panel, hotkeys or a click on the text)
    useEffect(() => {
        const anchor = ref.current;
        if (!enabled || !anchor) return;
        const refresh = () => {
            const row = rowOf(anchor);
            setState(row ? messageState(row) : undefined);
        };
        refresh();
        return onReplacedChange(refresh);
    }, [enabled]);

    useLayoutEffect(() => {
        const anchor = ref.current;
        if (!enabled || !anchor) return;
        const row = rowOf(anchor);
        if (!row) return;

        const plateWidth = () => anchor.querySelector<HTMLElement>(`.${cl("plate")}`)?.offsetWidth || 56;
        const update = () => setLayout(measure(anchor, message.id, plateWidth()));

        // which plate shows depends on where the mouse is along the text
        const onMove = (e: MouseEvent) => {
            const text = row.querySelector<HTMLElement>(`#message-content-${message.id}`);
            const lines = text ? textRects(text) : [];
            if (!lines.length) return;
            const start = Math.min(...lines.map(r => r.left));
            const end = Math.max(...lines.map(r => r.right));
            const share = (e.clientX - start) / Math.max(1, end - start);
            const next = share < LEFT_ZONE ? "left" : share > RIGHT_ZONE ? "right" : "both";
            setZone(prev => prev === next ? prev : next);
        };

        update();
        const observer = new ResizeObserver(update);
        observer.observe(row);
        row.addEventListener("mouseenter", update);
        row.addEventListener("mousemove", onMove);
        return () => {
            observer.disconnect();
            row.removeEventListener("mouseenter", update);
            row.removeEventListener("mousemove", onMove);
        };
    }, [enabled, message.id, state]);

    // the plate on the left takes the place of the time Discord shows there on hover: hide that time while it is there
    useEffect(() => {
        const anchor = ref.current;
        const time = anchor && !layout?.header && layout?.left ? rowOf(anchor)?.querySelector<HTMLElement>("time")?.parentElement : null;
        if (!time) return;
        const leftShown = zone !== "right";
        time.style.visibility = leftShown ? "hidden" : "";
        return () => { time.style.visibility = ""; };
    }, [layout, zone]);

    if (!enabled) return <div ref={ref} style={{ display: "none" }} />;

    const withRow = (fn: (row: HTMLElement) => void) => () => {
        const row = ref.current && rowOf(ref.current);
        if (row) fn(row);
    };

    const onTranslate = withRow(async row => {
        if (state) {
            // already translated: this button turns the translation off
            resetMessage(row);
            return;
        }
        setBusy(true);
        try {
            if (!await translateMessage(row))
                flashTranslate(hasTranslatableText(row) ? t("transFail") : t("nothingToTranslate"));
        } finally {
            setBusy(false);
        }
    });

    // copies what is shown right now: the translation, or the original
    const onCopy = withRow(async row => {
        const text = row.querySelector<HTMLElement>(`#message-content-${message.id}`);
        try {
            await navigator.clipboard.writeText((text?.innerText ?? "").trim());
            flashCopy(t("copied"));
        } catch (e) {
            console.error("[TranslatePerChat] copying failed", e);
        }
    });

    const plate = (key: string, pos: Position | undefined, off: boolean, time?: string) => (
        <div
            key={key}
            className={cl("plate-holder", { "plate-off": off })}
            style={{ left: pos?.left ?? 0, top: pos?.top ?? 0, visibility: pos ? undefined : "hidden" }}
        >
            <div className={cl("plate")} style={{ height: PLATE_HEIGHT }}>
                <PlateButton tip={translateFlash ?? (state ? t("plateUntranslate") : t("tipTranslate"))} active={!!state} busy={busy} onClick={onTranslate} onLeave={resetTranslateFlash}>
                    <TranslateIcon width={16} height={16} />
                </PlateButton>
                <PlateButton tip={copyFlash ?? (state === "translation" ? t("menuCopyTranslation") : t("menuCopyOriginal"))} onClick={onCopy} onLeave={resetCopyFlash}>
                    <CopyIcon />
                </PlateButton>
            </div>
            {time && <div className={cl("plate-time")}>{time}</div>}
        </div>
    );

    return (
        <div ref={ref} className={cl("plate-anchor")}>
            {layout?.header
                ? plate("header", layout.header, false)
                : <>
                    {plate("left", layout?.left, zone === "right", layout?.time)}
                    {plate("right", layout?.right, zone === "left")}
                </>}
        </div>
    );
}
