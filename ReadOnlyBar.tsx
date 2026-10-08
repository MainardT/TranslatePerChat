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
 * Channels where you cannot write: Discord shows a "you cannot send messages here" bar instead of the message box,
 * and the buttons next to the box are gone with it. Our two buttons (translate a screen area, the chat window) are put
 * at the right end of that bar instead, and work the same way (the chat window has nothing about sending there).
 */

import { createRoot, SelectedChannelStore, useEffect, useRef, useState } from "@webpack/common";
import type { Root } from "react-dom/client";

import { isAutoRead } from "./AutoRead";
import { hotkeyLabel } from "./HotkeyConfig";
import { ChatTranslatePanel } from "./ChatTranslateModal";
import { chatBar } from "./PageReplace";
import { startScreenTranslate } from "./ScreenTranslate";
import { settings } from "./settings";
import { ChatTranslateIcon, ScreenTranslateIcon } from "./TranslateIcon";
import { cl } from "./utils";
import { t, useT } from "./i18n";

const CHECK_MS = 300;

let host: HTMLDivElement | null = null;
let root: Root | null = null;
let shownFor = "";
let timer: number | undefined;

function Buttons({ channelId }: { channelId: string; }) {
    const t = useT();
    settings.use(["autoReadChats"]);
    const [open, setOpen] = useState(false);
    const box = useRef<HTMLDivElement>(null);

    // a click anywhere else closes the window
    useEffect(() => {
        if (!open) return;
        const onDown = (e: MouseEvent) => {
            if (!box.current?.contains(e.target as Node)) setOpen(false);
        };
        document.addEventListener("mousedown", onDown, true);
        return () => document.removeEventListener("mousedown", onDown, true);
    }, [open]);

    return (
        <div ref={box} className={cl("ro-bar")}>
            <button type="button" className={cl("ro-button")} title={t("roAreaTip", { key: hotkeyLabel("area") })} onClick={startScreenTranslate}>
                <ScreenTranslateIcon className={cl("chat-button")} />
            </button>
            <button type="button" className={cl("ro-button")} title={t("roChat")} onClick={() => setOpen(v => !v)}>
                <ChatTranslateIcon off={!isAutoRead(channelId)} className={cl({ "auto-translate": isAutoRead(channelId), "chat-button": true })} />
            </button>
            {open && (
                <div className={cl("ro-popout")}>
                    <ChatTranslatePanel channelId={channelId} readOnly close={() => setOpen(false)} />
                </div>
            )}
        </div>
    );
}

function remove() {
    root?.unmount();
    root = null;
    host?.remove();
    host = null;
    shownFor = "";
}

/**
 * Looks along the middle of the bar, from its right end to its middle, for buttons of the page lying on it
 * (not ours, not the ones in the messages) and gives the left edge of the leftmost one (or the right end of the bar if there is none).
 */
function leftOfOtherButtons(bar: DOMRect): number {
    let left = bar.right;
    const y = bar.top + bar.height / 2;
    const middle = bar.left + bar.width / 2;
    for (let x = bar.right - 6; x > middle; x -= 12) {
        for (const el of document.elementsFromPoint(x, y)) {
            const button = el.closest('button, [role="button"]');
            if (!button || host?.contains(button) || button.closest('[data-list-id="chat-messages"]')) continue;
            left = Math.min(left, button.getBoundingClientRect().left);
        }
    }
    return left;
}

function check() {
    const channelId = SelectedChannelStore.getChannelId();
    const bar = chatBar();
    // a bar without a place to type in: the channel is read-only for you
    const readOnly = !!bar && !bar.querySelector('[role="textbox"], textarea');
    if (!channelId || !bar || !readOnly) {
        if (host) remove();
        return;
    }

    if (!host) {
        host = document.createElement("div");
        host.className = cl("ro-host");
        host.setAttribute("data-vc-screen-translate", "");
        document.body.append(host);
        root = createRoot(host);
    }
    if (shownFor !== channelId) {
        shownFor = channelId;
        root!.render(<Buttons key={channelId} channelId={channelId} />);
    }

    const r = bar.getBoundingClientRect();
    // other buttons lying on the right end of the bar (e.g. "Follow" in a forum post): our buttons stand left of them
    const gap = Math.max(12, r.right - leftOfOtherButtons(r) + 8);
    host.style.right = `${Math.round(window.innerWidth - r.right + gap)}px`;
    host.style.top = `${Math.round(r.top + r.height / 2)}px`;
}

export function startReadOnlyBar() {
    timer = window.setInterval(check, CHECK_MS);
}

export function stopReadOnlyBar() {
    window.clearInterval(timer);
    remove();
}
