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
 * Where notices of the plugin are shown:
 *   1. an action of a button with a tip: the notice replaces the tip's text for a moment, then the tip comes back;
 *   2. an action inside a settings window: inside that window (the window does it itself);
 *   3. anything else: in the panel in the corner of the chat for a few seconds (the panel shows up for it if needed).
 */

import { useEffect, useRef, useState } from "@webpack/common";

import { cl } from "./utils";

export type NoticeKind = "info" | "success" | "error";

/** How long a notice stays in a tip. */
export const FLASH_MS = 2000;

/* ---------- 3. the panel in the corner (it registers itself) ---------- */

let panelNotice: ((text: string, kind: NoticeKind) => void) | null = null;
export function setPanelNoticeHandler(handler: (text: string, kind: NoticeKind) => void) {
    panelNotice = handler;
}

/** A notice with no button of its own: shown in the panel in the corner. */
export function notify(text: string, kind: NoticeKind = "info") {
    if (panelNotice) panelNotice(text, kind);
    else console.log("[TranslatePerChat]", text);
}

/* ---------- 1. tips of buttons ---------- */

/** For buttons drawn by Discord's own tips: a text shown instead of the tip for a moment. */
export function useFlash(): [string | null, (text: string) => void, () => void] {
    const [text, setText] = useState<string | null>(null);
    const timer = useRef<number>();
    useEffect(() => () => window.clearTimeout(timer.current), []);
    const flash = (next: string) => {
        window.clearTimeout(timer.current);
        setText(next);
        timer.current = window.setTimeout(() => setText(null), FLASH_MS);
    };
    // the mouse left the button: the notice is gone, the next hover shows the usual tip
    const reset = () => {
        window.clearTimeout(timer.current);
        setText(null);
    };
    return [text, flash, reset];
}

/* our own tips, for buttons that are not drawn with Discord's tools (the buttons of pictures) */

let tipEl: HTMLElement | null = null;
let tipOwner: HTMLElement | null = null;
const flashes = new WeakMap<HTMLElement, { text: string; timer: number; }>();

function tipText(button: HTMLElement) {
    return flashes.get(button)?.text ?? button.dataset.vcTip ?? "";
}

function drawTip(button: HTMLElement) {
    if (!tipEl) {
        tipEl = document.createElement("div");
        tipEl.className = cl("tip");
        tipEl.setAttribute("data-vc-screen-translate", "");
    }
    tipEl.textContent = tipText(button);
    if (!tipEl.isConnected) document.body.append(tipEl);
    const r = button.getBoundingClientRect();
    const t = tipEl.getBoundingClientRect();
    tipEl.style.left = `${Math.round(Math.max(4, Math.min(window.innerWidth - t.width - 4, r.left + r.width / 2 - t.width / 2)))}px`;
    tipEl.style.top = `${Math.round(Math.max(4, r.top - t.height - 8))}px`;
}

function hideTip(button: HTMLElement) {
    if (tipOwner !== button) return;
    tipOwner = null;
    tipEl?.remove();
}

/** Gives a button a tip like Discord's; its text is read from `data-vc-tip` (set it whenever it changes). */
export function addTip(button: HTMLElement) {
    button.addEventListener("mouseenter", () => {
        tipOwner = button;
        drawTip(button);
    });
    button.addEventListener("mouseleave", () => {
        // the mouse left the button: its notice is gone too
        const flash = flashes.get(button);
        if (flash) window.clearTimeout(flash.timer);
        flashes.delete(button);
        hideTip(button);
    });
    button.addEventListener("click", () => { if (tipOwner === button) window.setTimeout(() => tipOwner === button && drawTip(button)); });
}

/** Shows a notice in a button's tip for a moment (if the mouse leaves, the tip goes as usual). */
export function flashTip(button: HTMLElement, text: string) {
    const old = flashes.get(button);
    if (old) window.clearTimeout(old.timer);
    flashes.set(button, {
        text,
        timer: window.setTimeout(() => {
            flashes.delete(button);
            if (tipOwner === button) drawTip(button);
        }, FLASH_MS)
    });
    if (tipOwner === button) drawTip(button);
}

/** Keeps a button's own tip text in step (call when the state of the button changes). */
export function setTip(button: HTMLElement, text: string) {
    button.dataset.vcTip = text;
    button.removeAttribute("title");
    if (tipOwner === button) drawTip(button);
}

/** Draws the shown tip again at its button's place (the button may have moved with the chat). */
export function refreshTip() {
    if (tipOwner && tipOwner.isConnected) drawTip(tipOwner);
}
