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
 * Notices that have no button of their own (see Notify.ts): a stack above the panel in the corner of the chat.
 * Each stays for a few seconds. The newest is on top; when the lowest one goes away, the ones above drop into its place.
 * The stack is lined up with the right edge of the panel (or of the message box, when there is no panel).
 */

import { NoticeKind, setPanelNoticeHandler } from "./Notify";
import { chatBar, chatRect } from "./PageReplace";
import { cl } from "./utils";

const NOTICE_MS = 3000;
const GAP_PX = 6;
const MAX_SHOWN = 4;

interface Item { text: string; kind: NoticeKind; el: HTMLElement; timer: number; }

const items: Item[] = [];
let holder: HTMLElement | null = null;
let followTimer: number | undefined;

/** Puts the stack right above the panel, or above the message box when there is no panel. */
function place() {
    if (!holder) return;
    const panel = document.querySelector<HTMLElement>(`.${cl("replace-panel")}`);
    const visible = panel && panel.getBoundingClientRect().height && getComputedStyle(panel).display !== "none";

    let top: number | undefined;
    let right: number | undefined;
    if (visible) {
        const r = panel!.getBoundingClientRect();
        top = r.top;
        right = r.right;
    } else {
        const rect = chatRect();
        const box = rect && chatBar(rect);
        if (box) {
            const r = box.getBoundingClientRect();
            top = r.top;
            right = r.right;
        } else if (rect) {
            top = rect.bottom;
            right = rect.right - 16;
        }
    }

    holder.style.right = `${Math.max(8, window.innerWidth - (right ?? window.innerWidth - 24))}px`;
    holder.style.bottom = `${Math.max(8, window.innerHeight - (top ?? window.innerHeight - 24) + GAP_PX)}px`;
}

function remove(item: Item) {
    window.clearTimeout(item.timer);
    item.el.remove();
    const i = items.indexOf(item);
    if (i >= 0) items.splice(i, 1);
    if (!items.length) {
        holder?.remove();
        holder = null;
        window.clearInterval(followTimer);
        followTimer = undefined;
    }
}

function show(text: string, kind: NoticeKind) {
    // the same notice again: it stays a little longer instead of showing twice
    const same = items.find(i => i.text === text && i.kind === kind);
    if (same) {
        window.clearTimeout(same.timer);
        same.timer = window.setTimeout(() => remove(same), NOTICE_MS);
        return;
    }

    if (!holder) {
        holder = document.createElement("div");
        holder.className = cl("notices");
        holder.setAttribute("data-vc-screen-translate", "");
        document.body.append(holder);
        // the panel and the message box move (a reply bar, a resized window): the stack follows them
        followTimer = window.setInterval(place, 200);
    }

    const el = document.createElement("div");
    el.className = cl("notices-item", `notices-item-${kind}`);
    el.textContent = text;
    // the stack is drawn bottom-up: the oldest first in the list is the lowest one
    holder.append(el);

    const item: Item = { text, kind, el, timer: window.setTimeout(() => remove(item), NOTICE_MS) };
    items.push(item);
    while (items.length > MAX_SHOWN) remove(items[0]);
    place();
}

/** Hooked up when the plugin starts (hooking it up while the files load could be undone by the loading order). */
export const startPanelNotices = () => setPanelNoticeHandler(show);

export function stopPanelNotices() {
    for (const item of [...items]) remove(item);
}
