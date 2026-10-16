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
 * The formatting bar of the translation box (under the edit field): select words and a small bar appears above them,
 * like Discord's own: bold, italic, strikethrough, quote, code, spoiler. A second press on the same button takes
 * the formatting off. The same keys as in Discord work: Ctrl+B bold, Ctrl+I italic, Ctrl+U underline, Ctrl+Shift+M code.
 * The box shows the marks themselves ("**word**"); the message shows the formatting after saving.
 */

import { t } from "./i18n";
import type { TextKey } from "./i18n";
import { cl } from "./utils";

type Action =
    | { kind: "wrap"; mark: string; }
    | { kind: "line"; start: string; };

interface Button { label: string; tip: TextKey; action: Action; style?: string; }

const MAIN: Button[] = [
    { label: "B", tip: "fmtBold", action: { kind: "wrap", mark: "**" }, style: "font-weight:700" },
    { label: "I", tip: "fmtItalic", action: { kind: "wrap", mark: "*" }, style: "font-style:italic" },
    { label: "S", tip: "fmtStrike", action: { kind: "wrap", mark: "~~" }, style: "text-decoration:line-through" },
    { label: "❝", tip: "fmtQuote", action: { kind: "line", start: "> " } },
    { label: "</>", tip: "fmtCode", action: { kind: "wrap", mark: "`" } },
    { label: "◐", tip: "fmtSpoiler", action: { kind: "wrap", mark: "||" } }
];

/* ---------- changing the text ---------- */

/** Puts text in place of the range and selects [selStart, selEnd) of the result; Ctrl+Z can take it back. */
function replaceRange(area: HTMLTextAreaElement, from: number, to: number, text: string, selStart: number, selEnd: number) {
    area.focus();
    area.setSelectionRange(from, to);
    // the browser's own typing: it keeps the undo history and tells the box it was changed
    if (!document.execCommand("insertText", false, text)) {
        area.setRangeText(text, from, to, "end");
        area.dispatchEvent(new Event("input", { bubbles: true }));
    }
    area.setSelectionRange(from + selStart, from + selEnd);
}

/** A mark of one symbol ("*") is not the half of a longer one ("**") next to it. */
function markAt(text: string, mark: string, end: boolean, pos: number): boolean {
    if (end ? !text.endsWith(mark, pos) : !text.startsWith(mark, pos)) return false;
    if (mark.length !== 1) return true;
    const outer = end ? text[pos - 2] : text[pos + 1];
    // "*" inside "**": only when it is "***" (bold and italic together)
    if (outer !== mark) return true;
    const outer2 = end ? text[pos - 3] : text[pos + 2];
    return outer2 === mark;
}

function wrap(area: HTMLTextAreaElement, mark: string) {
    const v = area.value;
    const a = area.selectionStart, b = area.selectionEnd;
    const sel = v.slice(a, b);
    const n = mark.length;

    // already formatted around the selection: taken off
    if (a >= n && markAt(v, mark, true, a) && markAt(v, mark, false, b))
        return replaceRange(area, a - n, b + n, sel, 0, sel.length);
    // the selection itself starts and ends with the marks: taken off
    if (sel.length >= 2 * n && markAt(sel, mark, false, 0) && markAt(sel, mark, true, sel.length)) {
        const inner = sel.slice(n, sel.length - n);
        return replaceRange(area, a, b, inner, 0, inner.length);
    }
    // spaces at the edges stay outside ("** word **" is not formatted by Discord)
    const lead = sel.match(/^\s*/)![0];
    const trail = sel.length > lead.length ? sel.match(/\s*$/)![0] : "";
    const core = sel.slice(lead.length, sel.length - trail.length);
    const text = lead + mark + core + mark + trail;
    replaceRange(area, a, b, text, lead.length + n, lead.length + n + core.length);
}

/** The whole lines touched by the selection. */
function lineRange(area: HTMLTextAreaElement) {
    const v = area.value;
    const from = v.lastIndexOf("\n", area.selectionStart - 1) + 1;
    let to = v.indexOf("\n", Math.max(area.selectionEnd - (area.selectionEnd > area.selectionStart && v[area.selectionEnd - 1] === "\n" ? 1 : 0), from));
    if (to < 0) to = v.length;
    return { from, to, lines: v.slice(from, to).split("\n") };
}

const LINE_STARTS = /^(?:#{1,3} |-# |> |- |\d{1,3}\. )/;

function lineStart(area: HTMLTextAreaElement, start: string) {
    const { from, to, lines } = lineRange(area);
    const filled = lines.filter(l => l.trim());
    const allHave = filled.length > 0 && filled.every(l => l.startsWith(start));
    const out = lines.map(l => {
        if (!l.trim()) return l;
        // the same start everywhere: taken off; otherwise another start of the same kind is swapped for this one
        return allHave ? l.slice(start.length) : start + l.replace(LINE_STARTS, "");
    }).join("\n");
    replaceRange(area, from, to, out, 0, out.length);
}

function run(area: HTMLTextAreaElement, action: Action) {
    if (action.kind === "wrap") wrap(area, action.mark);
    else lineStart(area, action.start);
}

/* ---------- the bar ---------- */

let bar: HTMLElement | null = null;
let barArea: HTMLTextAreaElement | null = null;

function hideBar() {
    bar?.remove();
    bar = null;
    barArea = null;
}

function makeButton(area: HTMLTextAreaElement, b: Button) {
    const el = document.createElement("button");
    el.type = "button";
    el.className = cl("fmt-btn");
    el.textContent = b.label;
    el.title = t(b.tip);
    if (b.style) el.setAttribute("style", b.style);
    el.addEventListener("click", () => {
        run(area, b.action);
        // the bar stays for the next button, over the new selection
        if (area.selectionStart === area.selectionEnd) hideBar();
    });
    return el;
}

function showBar(area: HTMLTextAreaElement, x: number, y: number) {
    hideBar();
    const root = document.createElement("div");
    root.className = cl("fmt-bar");
    root.setAttribute("data-vc-screen-translate", "");
    // a press on the bar does not take the focus (and the selection) away from the box
    root.addEventListener("mousedown", e => e.preventDefault());

    const main = document.createElement("div");
    main.className = cl("fmt-row");
    MAIN.forEach(b => main.append(makeButton(area, b)));

    root.append(main);
    document.body.append(root);
    bar = root;
    barArea = area;

    // above the place where the mouse let go, kept on the screen
    {
        const r = root.getBoundingClientRect();
        const left = Math.max(8, Math.min(x - r.width / 2, window.innerWidth - r.width - 8));
        const top = y - r.height - 10 < 8 ? y + 18 : y - r.height - 10;
        root.style.left = `${left}px`;
        root.style.top = `${top}px`;
    }
}

/** Shows the bar when words are selected in the box; returns what takes it off again. */
export function attachFormatBar(area: HTMLTextAreaElement): () => void {
    let lastX = 0, lastY = 0;
    const onUp = (e: MouseEvent) => {
        lastX = e.clientX;
        lastY = e.clientY;
        // the selection is known only after the mouse is let go
        setTimeout(() => {
            if (area.selectionStart !== area.selectionEnd) showBar(area, lastX, lastY);
            else if (barArea === area) hideBar();
        }, 0);
    };
    const onKeyUp = (e: KeyboardEvent) => {
        if (barArea !== area) {
            // selected with the keys (Shift + arrows): the bar over the box
            if (e.shiftKey && area.selectionStart !== area.selectionEnd) {
                const r = area.getBoundingClientRect();
                showBar(area, r.left + 60, r.top);
            }
            return;
        }
        if (area.selectionStart === area.selectionEnd) hideBar();
    };
    const onBlur = () => { if (barArea === area) hideBar(); };
    const onScroll = (e: Event) => {
        if (barArea === area && !(e.target instanceof Node && bar?.contains(e.target))) hideBar();
    };

    area.addEventListener("mouseup", onUp);
    area.addEventListener("keyup", onKeyUp);
    area.addEventListener("blur", onBlur);
    document.addEventListener("scroll", onScroll, true);
    return () => {
        area.removeEventListener("mouseup", onUp);
        area.removeEventListener("keyup", onKeyUp);
        area.removeEventListener("blur", onBlur);
        document.removeEventListener("scroll", onScroll, true);
        if (barArea === area) hideBar();
    };
}

/**
 * Discord's keys in the box: Ctrl+B bold, Ctrl+I italic, Ctrl+U underline, Ctrl+Shift+M code;
 * Esc closes the bar first (a second Esc cancels the edit). True when the key was used here.
 */
export function formatHotkey(e: KeyboardEvent, area: HTMLTextAreaElement): boolean {
    if (e.key === "Escape" && barArea === area) {
        hideBar();
        return true;
    }
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return false;
    // by the key itself, so it works with any keyboard layout
    const mark = e.shiftKey
        ? (e.code === "KeyM" ? "`" : null)
        : ({ KeyB: "**", KeyI: "*", KeyU: "__" } as Record<string, string>)[e.code] ?? null;
    if (!mark) return false;
    wrap(area, mark);
    return true;
}
