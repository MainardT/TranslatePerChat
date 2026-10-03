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
 * The shortcuts of the plugin: Alt plus one key. The key of each action can be changed in the settings
 * (physical keys, so they work with any keyboard layout).
 */

import type { TextKey } from "./i18n";
import { settings } from "./settings";

export type HotkeyAction = "area" | "chat" | "toggle" | "reset" | "auto";

export const HOTKEYS: { id: HotkeyAction; textKey: TextKey; code: string; }[] = [
    { id: "area", textKey: "hkArea", code: "KeyD" },
    { id: "chat", textKey: "hkChat", code: "KeyF" },
    { id: "toggle", textKey: "hkToggle", code: "KeyC" },
    { id: "reset", textKey: "hkReset", code: "KeyX" },
    { id: "auto", textKey: "hkAuto", code: "KeyR" }
];

/** The key (physical code) of an action: the chosen one, else the default. */
export function hotkeyCode(id: HotkeyAction): string {
    return settings.store.hotkeys?.[id] ?? HOTKEYS.find(h => h.id === id)!.code;
}

/** "KeyD" -> "D", "Digit5" -> "5". */
export const keyName = (code: string) => code.replace(/^Key/, "").replace(/^Digit/, "");

/** Only letters and digits can be chosen: other keys with Alt are used by Discord itself. */
export const isAllowedKey = (code: string) => /^(Key[A-Z]|Digit[0-9])$/.test(code);

export const hotkeyLabel = (id: HotkeyAction) => `Alt+${keyName(hotkeyCode(id))}`;
