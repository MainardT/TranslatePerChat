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
 * Chats that translate themselves: in a chat with the switch on, every message that comes onto the screen
 * (already there, newly arrived, or reached by scrolling) is swapped for its translation, like the "Translate" button does.
 * Messages already in the language you read are left alone. Your own ones are shown in your language ("Show originals of my
 * messages" in the chat window): in chats that translate themselves also by the translator, in other chats only from
 * what was remembered when sending (a freshly sent one waits a moment first, so you see it went out translated).
 * Paused while Discord is minimized / hidden, or after a while without mouse or keyboard.
 */

import { MessageStore, SelectedChannelStore, UserStore } from "@webpack/common";

import { originalFor } from "./EditOriginals";
import { shouldAutoTranslate } from "./overrides";
import { isReplaced, isTurnedOff, messageTargets, PanelLabel, replaceInPlace, restoreChat, setOpenSettings, setPanelLabels, setResetAllowed, syncPanel } from "./PageReplace";
import { notify } from "./Notify";
import { settings } from "./settings";
import { translatorBlocked, translatorDown } from "./utils";
import { openFullSettings } from "./SettingsPanel";
import { t } from "./i18n";

/** How often the screen is looked at, how far beyond the visible part messages are translated ahead, and how many places go in one round. */
const CHECK_MS = 700;
const MAX_PER_ROUND = 40;
/** Your message counts as freshly sent (and waits before being translated) for this long after sending. */
const FRESH_MS = 60_000;

let lastInput = Date.now();
const onInput = () => { lastInput = Date.now(); };
/** When Discord was minimized (0 = it is not). */
let hiddenSince = document.hidden ? Date.now() : 0;
/** Paused: minimized for longer than the set time, or no mouse or keyboard for the set time. */
const paused = () => {
    if (document.hidden && Date.now() - hiddenSince >= (settings.store.autoReadHiddenDelay ?? 0) * 1000) return true;
    return Date.now() - lastInput > (settings.store.autoReadIdle ?? 2) * 60_000;
};

/** When a message was sent, read from its number. */
const sentAt = (messageId: string) => {
    try { return Number((BigInt(messageId) >> 22n) + 1420070400000n); } catch { return 0; }
};
/** When each of your fresh messages was first seen on the screen. */
const firstSeen = new Map<string, number>();

/** The chat that was entered last and when; the wait before translating it starts from then. */
let enteredId: string | null = null;
let enteredAt = 0;
let waitSkipped = false;
/** Messages translated before: when they come back on screen they need no waiting (the translator remembers them). */
const done = new Set<string>();
const DONE_MAX = 3000;

const noteEntered = () => {
    const id = SelectedChannelStore.getChannelId() ?? null;
    if (id !== enteredId) {
        enteredId = id;
        enteredAt = Date.now();
        waitSkipped = false;
        leftChat = cursorX < 0 || !insideChat(cursorX, cursorY);
    }
    return id;
};
/** True while a chat that translates itself is open and its entering delay has not passed yet. */
const waiting = () => {
    const id = noteEntered();
    const delay = (settings.store.autoReadEnterDelay ?? 2) * 1000;
    return !!id && isAutoRead(id) && delay > 0 && !waitSkipped && Date.now() - enteredAt < delay;
};

export const isAutoRead = (channelId: string | undefined | null) => !!channelId && !!settings.store.autoReadChats[channelId];

export function setAutoRead(channelId: string, on: boolean) {
    const next = { ...settings.store.autoReadChats };
    if (on) next[channelId] = true;
    else delete next[channelId];
    settings.store.autoReadChats = next;
    round++;
    setPanelLabels(labels);
    if (on) void check();
    // turned off: the chat goes back to the originals
    else restoreChat(channelId);
}

/** Whether your own messages in this chat are shown in your language: needs «Translate my messages», on by default with it. */
export const showsOwnOriginals = (channelId: string | undefined | null) =>
    !!channelId && shouldAutoTranslate(channelId) && !settings.store.ownOriginalsOff[channelId];

export function setShowOwnOriginals(channelId: string, on: boolean) {
    const next = { ...settings.store.ownOriginalsOff };
    if (on) delete next[channelId];
    else next[channelId] = true;
    settings.store.ownOriginalsOff = next;
    refreshChat(channelId);
}

/** The chat is translated again from the start (after a change of languages or of what is shown). */
export function refreshChat(channelId: string) {
    round++;
    restoreChat(channelId);
    void check();
}

const code = (language: string | undefined) => !language || language === "auto" ? t("autoLabel") : language.split("-")[0].toUpperCase();

/** The label on the panel in the corner: "Auto → RU" (a click turns it off), "Auto → Pause", "Auto → No connection". */
function labels(): (PanelLabel | null)[] {
    const channelId = SelectedChannelStore.getChannelId();
    if (!isAutoRead(channelId)) return [];
    if (translatorDown()) return [{ text: t("autoNoConnection"), title: t("autoNoConnectionTip") }];
    if (waiting() || paused()) return [{ text: t("autoPaused"), title: t("autoPausedTip") }];
    return [{
        text: t("autoActive", { lang: code(settings.store.receivedOutput) }),
        title: t("autoActiveTip"),
        onClick: () => channelId && setAutoRead(channelId, false)
    }];
}

/** Alt+R: turns auto-translating of the open chat on or off. */
export function toggleCurrentChatAutoRead() {
    const channelId = SelectedChannelStore.getChannelId();
    if (!channelId) return;
    const on = !isAutoRead(channelId);
    setAutoRead(channelId, on);
    notify(on ? t("autoOnNote") : t("autoOffNote"), "success");
}

/**
 * The text each place had when it was last tried. A place is not tried again while its text stays the same
 * (translated, switched back to the original by hand, reset, or already in your language), only after it is edited.
 */
const tried = new WeakMap<Element, string>();
/** Goes up each time the chat translating itself is switched on or off: everything is tried again then. */
let round = 0;

let busy = false;
let timer: number | undefined;

/**
 * One look at the screen. The quick look ("fast") only handles messages translated before: it is made right when
 * Discord draws messages, before the picture appears, so the original never flashes.
 */
let fastBusy = false;
async function check(fast = false) {
    // the panel follows the open chat (it appears in a chat that translates itself, goes away in another)
    syncPanel();
    // the translator is resting after a failure: not asked until the pause is over
    if (translatorBlocked()) return;
    if ((fast ? fastBusy : busy) || paused()) return;
    // nothing to do when no chat translates itself and in none of them your messages are translated
    if (!Object.keys(settings.store.autoReadChats).length
        && !Object.values(settings.store.channelOverrides).includes("on")
        && !Object.values(settings.store.guildOverrides).includes("on")) return;

    const me = UserStore.getCurrentUser()?.id;
    const holding = waiting();
    const current = SelectedChannelStore.getChannelId();
    const targets: Element[] = [];

    for (const list of document.querySelectorAll('[data-list-id="chat-messages"]')) {
        const view = (list.closest('[class*="scroller"]') ?? list).getBoundingClientRect();
        if (!view.height) continue;

        // the messages on the screen, plus the set number of them above and below
        const rows = [...list.querySelectorAll('li[id^="chat-messages-"]')];
        const seen = rows.map(row => {
            const r = row.getBoundingClientRect();
            return !!r.height && r.bottom >= view.top && r.top <= view.bottom;
        });
        const first = seen.indexOf(true);
        const last = seen.lastIndexOf(true);
        if (first < 0) continue;
        const ahead = settings.store.autoReadAhead ?? 3;

        for (let i = Math.max(0, first - ahead); i <= Math.min(rows.length - 1, last + ahead); i++) {
            const row = rows[i];
            const [, channelId, messageId] = row.id.match(/^chat-messages-(\d+)-(\d+)$/) ?? [];
            const auto = isAutoRead(channelId);
            const own = showsOwnOriginals(channelId);
            if (!auto && !own) continue;

            const mine = !!me && MessageStore.getMessage(channelId, messageId)?.author?.id === me;
            // other people's messages: only in chats that translate themselves; yours: where their originals are shown
            if (mine ? !own : !auto) continue;
            // in other chats your messages are put back only from what was remembered (the translator is not asked)
            const fromMemoryOnly = mine && !auto;
            if (fromMemoryOnly && originalFor(channelId, messageId, true) === null) continue;

            // just entered the chat: wait, except for messages translated before
            if (fast && !done.has(messageId) && !fromMemoryOnly) continue;
            if (holding && channelId === current && !done.has(messageId)) continue;
            // your freshly sent message: shown as sent for a moment, then translated
            if (mine && Date.now() - sentAt(messageId) < FRESH_MS) {
                const seen = firstSeen.get(messageId) ?? Date.now();
                firstSeen.set(messageId, seen);
                if (Date.now() - seen < (settings.store.autoReadOwnDelay ?? 1.5) * 1000) continue;
            }

            for (const el of messageTargets(row)) {
                const text = el.textContent ?? "";
                const mark = `${round}|${text}`;
                if (isReplaced(el) || isTurnedOff(el) || tried.get(el) === mark) continue;
                if (targets.length >= MAX_PER_ROUND) break;
                tried.set(el, mark);
                targets.push(el);
                done.add(messageId);
                if (done.size > DONE_MAX) done.delete(done.values().next().value!);
            }
        }
    }

    // forget old notes about fresh messages
    for (const [id, seen] of firstSeen) if (Date.now() - seen > FRESH_MS) firstSeen.delete(id);

    if (!targets.length) return;
    if (fast) fastBusy = true; else busy = true;
    try {
        await replaceInPlace(targets, { skipUnchanged: true });
        // it failed meanwhile: these places are tried again when it is back
        if (translatorDown()) round++;
    } catch (e) {
        console.error("[TranslatePerChat] chat translating itself failed", e);
    } finally {
        if (fast) fastBusy = false; else busy = false;
    }
}

/** True when the open chat translates itself. */
export const currentChatAutoRead = () => isAutoRead(SelectedChannelStore.getChannelId());

/** Where the cursor is, and whether it has been outside the chat since the chat was entered (e.g. over the list of chats). */
let cursorX = -1, cursorY = -1;
let leftChat = true;
const insideChat = (x: number, y: number) => {
    for (const list of document.querySelectorAll('[data-list-id="chat-messages"]')) {
        const r = (list.closest('[class*="scroller"]') ?? list).getBoundingClientRect();
        if (r.height && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return true;
    }
    return false;
};
const onMouse = (e: MouseEvent) => {
    cursorX = e.clientX;
    cursorY = e.clientY;
    const now = insideChat(cursorX, cursorY);
    // the cursor came from outside (the list of chats) into the chat: no more waiting
    if (now && leftChat && waiting()) {
        waitSkipped = true;
        void check();
    }
    if (!now) leftChat = true;
    else if (!waiting()) leftChat = false;
};

/** Discord drew new messages: the ones translated before are swapped right away. */
let frame = 0;
let watcher: MutationObserver | undefined;
const isRow = (n: Node) => n.nodeType === 1 && ((n as Element).matches('li[id^="chat-messages-"]') || !!(n as Element).querySelector('li[id^="chat-messages-"]'));
const onDrawn = (records: MutationRecord[]) => {
    if (frame || !Object.keys(settings.store.autoReadChats).length) return;
    if (!records.some(r => [...r.addedNodes].some(isRow))) return;
    frame = requestAnimationFrame(() => { frame = 0; void check(true); });
};

export function startAutoRead() {
    window.addEventListener("mousemove", onMouse, { capture: true, passive: true });
    watcher = new MutationObserver(onDrawn);
    watcher.observe(document.body, { childList: true, subtree: true });
    setResetAllowed(() => !currentChatAutoRead());
    setOpenSettings(() => openFullSettings(SelectedChannelStore.getChannelId() ?? undefined, "hotkeys"));
    setPanelLabels(labels);
    lastInput = Date.now();
    for (const type of ["mousemove", "keydown", "wheel", "mousedown"]) window.addEventListener(type, onInput, { capture: true, passive: true });
    // back to the window: the screen is looked at right away
    document.addEventListener("visibilitychange", onVisible);
    noteEntered();
    timer = window.setInterval(() => void check(), CHECK_MS);
}

const onVisible = () => {
    if (document.hidden) {
        hiddenSince = Date.now();
        return;
    }
    hiddenSince = 0;
    onInput();
    void check();
};

export function stopAutoRead() {
    window.removeEventListener("mousemove", onMouse, true);
    watcher?.disconnect();
    watcher = undefined;
    cancelAnimationFrame(frame);
    frame = 0;
    for (const type of ["mousemove", "keydown", "wheel", "mousedown"]) window.removeEventListener(type, onInput, true);
    document.removeEventListener("visibilitychange", onVisible);
    window.clearInterval(timer);
    timer = undefined;
    setPanelLabels(() => []);
    setOpenSettings(null);
}
