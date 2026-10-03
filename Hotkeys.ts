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
 * Keyboard shortcuts of the plugin (physical keys, so they work with any keyboard layout). Alt plus a key; the keys can be
 * changed in the settings (by default):
 *   Alt+D        select an area to translate
 *   Alt+F        translate the whole visible chat
 *   Alt+C        switch every translated message: original <-> translation
 *   Alt+X        reset the translation
 *   Alt+R        turn auto-translating of this chat on / off
 *   hold Alt     peek at the original while it is held (not changeable)
 */

import { HOTKEYS, hotkeyCode, hotkeyLabel } from "./HotkeyConfig";
import { t } from "./i18n";
import { currentChatAutoRead, toggleCurrentChatAutoRead } from "./AutoRead";
import { notify } from "./Notify";
import { closeActivePicture, hasActivePicture, peekActivePicture, toggleActivePicture } from "./ImageButtons";
import { hasReplaced, peekOriginal, restoreAll, toggleAll } from "./PageReplace";
import { startScreenTranslate, translateWholeChat } from "./ScreenTranslate";

/** Alt must be held this long, with no other key, before the original is shown. */
const PEEK_DELAY_MS = 300;

let peekTimer: number | undefined;
let peeking = false;

function endPeek() {
    window.clearTimeout(peekTimer);
    peekTimer = undefined;
    if (peeking) {
        peeking = false;
        peekOriginal(false);
        peekActivePicture(false);
    }
}

function onKeyDown(e: KeyboardEvent) {
    if (e.key === "Alt") {
        if (!e.repeat && !e.ctrlKey && !e.shiftKey && !e.metaKey && (hasReplaced() || hasActivePicture())) {
            window.clearTimeout(peekTimer);
            peekTimer = window.setTimeout(() => {
                peeking = true;
                peekOriginal(true);
                peekActivePicture(true);
            }, PEEK_DELAY_MS);
        }
        return;
    }

    // any other key while Alt is held: it is a shortcut, not a peek
    endPeek();

    if (!e.altKey || e.ctrlKey || e.metaKey) return;

    let action: (() => void) | null = null;
    if (e.shiftKey) return;
    const actions = {
        area: startScreenTranslate,
        chat: translateWholeChat,
        toggle: toggleEverything,
        reset: resetAll,
        auto: toggleCurrentChatAutoRead
    };
    const pressed = HOTKEYS.find(h => hotkeyCode(h.id) === e.code);
    if (pressed) action = actions[pressed.id];
    if (!action) return;

    e.preventDefault();
    e.stopPropagation();
    action();
}

/** Alt+X: resets every translation, except in a chat that translates itself (there it only says why). */
/** Alt+C: the translated messages and the translated picture. */
function toggleEverything() {
    toggleAll();
    toggleActivePicture();
}

function resetAll() {
    // the translation of a picture is closed in any chat (pictures are not part of a chat translating itself)
    const closedPicture = closeActivePicture();
    if (currentChatAutoRead()) {
        if (closedPicture) return;
        notify(t("resetUnavailable", { key: hotkeyLabel("auto") }), "info");
        return;
    }
    restoreAll();
}

function onKeyUp(e: KeyboardEvent) {
    if (e.key === "Alt") endPeek();
}

export function startHotkeys() {
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    window.addEventListener("blur", endPeek);
}

export function stopHotkeys() {
    endPeek();
    window.removeEventListener("keydown", onKeyDown, true);
    window.removeEventListener("keyup", onKeyUp, true);
    window.removeEventListener("blur", endPeek);
}
