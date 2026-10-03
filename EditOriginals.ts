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
 * Editing your translated messages in your own language.
 *   - When a message of yours is translated before sending, what you wrote is remembered (last 500, on this computer only,
 *     in a local store that is never synced to the Vencord cloud).
 *   - "Edit" on such a message opens what you wrote instead of the translation; saving translates it again.
 *   - For a message with nothing remembered (sent earlier or from the phone), the translation can be translated back instead.
 *   - While editing, a second box under the edit field shows the translation that will be sent. It follows what you type
 *     above; type in it yourself and it stays as you wrote it (never translated back, your text above is kept as it was).
 */

import * as DataStore from "@api/DataStore";
import { FluxDispatcher, MessageStore, UserStore } from "@webpack/common";

import { notify } from "./Notify";
import { translateKeepingEmoticons } from "./Emoticons";
import { getChatTargetLanguage, shouldAutoTranslate } from "./overrides";
import { settings } from "./settings";
import { cl } from "./utils";
import { t } from "./i18n";

const STORE_KEY = "TranslatePerChat_editOriginals";

/** A sent translation waits this long for Discord to confirm the message (and give it its number). */
const PENDING_MS = 60_000;

interface Saved {
    /** chat */
    c: string;
    /** what you wrote */
    o: string;
    /** what was sent */
    t: string;
}

/** Message number -> what you wrote. Oldest first. */
let saved = new Map<string, Saved>();
let loaded = false;

async function load() {
    try {
        const data = await DataStore.get<[string, Saved][]>(STORE_KEY);
        // anything saved while loading stays (it is newer)
        saved = new Map([...(data ?? []), ...saved]);
        loaded = true;
    } catch (e) {
        console.error("[TranslatePerChat] reading remembered texts failed", e);
    }
}

let writeTimer: number | undefined;
function write() {
    window.clearTimeout(writeTimer);
    writeTimer = window.setTimeout(() => {
        if (!loaded) return;
        DataStore.set(STORE_KEY, [...saved]).catch(e => console.error("[TranslatePerChat] saving remembered texts failed", e));
    }, 500);
}

function remember(messageId: string, entry: Saved) {
    saved.delete(messageId);
    saved.set(messageId, entry);
    while (saved.size > (settings.store.sentBufferSize ?? 500)) saved.delete(saved.keys().next().value!);
    write();
}

export async function clearRemembered() {
    saved.clear();
    pending.length = 0;
    await DataStore.del(STORE_KEY);
}

/* ---------- remembering what was sent ---------- */

/** Translations sent a moment ago, waiting for their message number. */
const pending: { channelId: string; original: string; translated: string; at: number; }[] = [];

const same = (a: string, b: string) => a.trim() === b.trim();

/** Nearly the same text: spaces, invisible characters and emoji do not count (the editor may redraw them a little differently). */
const plain = (s: string) => s.replace(/[\s​️]/g, "").replace(/\p{Extended_Pictographic}/gu, "");
const alike = (a: string, b: string) => plain(a) === plain(b);

/** Called right after a message is translated before sending. */
export function noteSent(channelId: string, original: string, translated: string) {
    if (!settings.store.editRemember || same(original, translated)) return;
    pending.push({ channelId, original, translated, at: Date.now() });
}

function onMessageCreate(action: any) {
    const message = action?.message;
    if (!pending.length || action?.optimistic || !message?.id) return;
    if (message.author?.id !== UserStore.getCurrentUser()?.id) return;

    const now = Date.now();
    for (let i = pending.length - 1; i >= 0; i--)
        if (now - pending[i].at > PENDING_MS) pending.splice(i, 1);

    const channelId = message.channel_id ?? action.channelId;
    const i = pending.findIndex(p => p.channelId === channelId && same(p.translated, message.content ?? ""));
    if (i < 0) return;
    const [p] = pending.splice(i, 1);
    remember(message.id, { c: channelId, o: p.original, t: p.translated });
}

function onMessageDelete(action: any) {
    let changed = false;
    for (const id of action?.ids ?? [action?.id]) changed = saved.delete(id) || changed;
    if (changed) {
        write();
    }
}

/* ---------- your text under your own messages: taken from the memory by the message number ---------- */

/** Emoji of every kind: they stay in the chat as pictures, so the text is cut at them (like the page text is). */
const EMOJI = /<a?:\w+:\d+>|\p{Extended_Pictographic}(?:[\ufe0f\u200d\u{1F3FB}-\u{1F3FF}]|\p{Extended_Pictographic})*|\p{Regional_Indicator}{2}/gu;
const hasLetters = (s: string) => (s.match(/[\p{L}\p{N}]/gu) ?? []).length >= 2;

/** The pieces of your text between emoji that hold words (the chat keeps its text in the same kind of pieces). */
export const originalPieces = (s: string) => s.split(EMOJI).filter(hasLetters);
/** All of your text without the emoji (they stay in the chat as they are). */
export const withoutEmoji = (s: string) => s.replace(EMOJI, "");

/** Links, mentions, timestamps and formatting stay in the chat as separate things: text with them is left to the translator. */
const KEPT_APART = /https?:\/\/|<[@#]|<t:\d|[*_~|]{2}|`|^\s*(>|#{1,3}\s)/m;

/**
 * Your own text for one of your messages that was translated before sending and is remembered, found by the message number.
 * Null when it is not remembered, was changed since (on another device), or has links / formatting: the translator is asked then.
 */
export function originalFor(channelId: string, messageId: string, quiet = false): string | null {
    const entry = saved.get(messageId);
    if (!entry) return null;

    const message: any = MessageStore.getMessage(channelId, messageId);
    if (!message || !alike(entry.t, message.content ?? "")) {
        return null;
    }
    if (KEPT_APART.test(entry.o)) {
        return null;
    }
    return entry.o;
}

function onMessageUpdate(action: any) {
    const message = action?.message;
    if (!message?.content || message.author?.id !== UserStore.getCurrentUser()?.id) return;
}

/* ---------- opening the edit ---------- */

/**
 * An edit opened in your language: a second box under the edit field shows the translation that will be sent.
 * It follows what you type above (a moment after you stop); once you type in it yourself, it is yours and stays as it is.
 */
interface EditSession {
    channelId: string;
    messageId: string;
    /** The translation that goes with a text of yours: a text translated once is not translated again. */
    cache: { from: string; to: string; };
    /** What the translation box holds. */
    lowerText: string;
    /** The translation box was typed in by hand: no new translation overwrites it. */
    lowerEdited: boolean;
    /** Counts the translations asked for: only the answer to the last one counts. */
    asked: number;
    timer?: number;
    twin?: Twin;
    /** The edit field being watched for typing. */
    watched?: HTMLElement;
    observer?: MutationObserver;
}

const sessions = new Map<string, EditSession>();

function startSession(action: any, ownText: string, sent: string) {
    sessions.set(action.messageId, {
        channelId: action.channelId,
        messageId: action.messageId,
        cache: { from: ownText, to: sent },
        lowerText: sent,
        lowerEdited: false,
        asked: 0
    });
    startTwinLoop();
}

function endSession(messageId: string) {
    const s = sessions.get(messageId);
    if (!s) return;
    window.clearTimeout(s.timer);
    dropTwin(s);
    sessions.delete(messageId);
}

/** Language to translate back to: the language you write in, or the one you read in if that is "detect". */
function ownLanguage() {
    const lang = settings.store.sentInput;
    return lang && lang !== "auto" ? lang : settings.store.receivedOutput;
}

/**
 * Runs before Discord opens the edit of a message. Returning true stops it (it is opened a moment later,
 * with the text translated back).
 */
function interceptor(action: any): boolean {
    if (action?.type !== "MESSAGE_START_EDIT" || action.__tpcDone) return false;
    const { messageId, channelId } = action;
    const content: string = action.content ?? "";
    // an older edit of this message that was cancelled must not linger
    endSession(messageId);

    const entry = saved.get(messageId);
    if (entry && same(entry.t, content)) {
        action.content = entry.o;
        startSession({ ...action }, entry.o, content);
        return false;
    }

    // nothing remembered: translate the sent text back, then open the edit
    if (!settings.store.editBackTranslate || !content.trim() || !shouldAutoTranslate(channelId)) return false;

    void (async () => {
        let text = content;
        try {
            const back = (await translateKeepingEmoticons("sent", content, true, ownLanguage())).text;
            if (back && !same(back, content)) {
                text = back;
                startSession({ ...action }, back, content);
            }
        } catch (e) {
            console.error("[TranslatePerChat] translating back for editing failed", e);
        }
        FluxDispatcher.dispatch({ ...action, content: text, __tpcDone: true });
    })();
    return true;
}

/* ---------- saving the edit ---------- */

/** Before an edit is saved: what goes to the chat is the translation box (if you typed in it) or a fresh translation of your text. */
export async function onBeforeEdit(channelId: string, messageId: string, messageObj: { content: string; }) {
    const s = sessions.get(messageId);
    if (!s) return;
    window.clearTimeout(s.timer);

    // your text, as it is in the edit field
    const mine = messageObj.content;
    try {
        if (!mine.trim()) return;

        let sent: string;
        if (s.lowerEdited && s.lowerText.trim()) sent = s.lowerText;
        else if (alike(mine, s.cache.from)) sent = s.cache.to;
        else sent = (await translateKeepingEmoticons("sent", mine, false, getChatTargetLanguage(channelId))).text;

        messageObj.content = sent;
        // your text stays remembered as you wrote it, whatever was typed into the translation
        if (settings.store.editRemember && !same(mine, sent)) remember(messageId, { c: channelId, o: mine, t: sent });
    } catch (e) {
        console.error("[TranslatePerChat] translating the edit failed", e);
        notify(t("editFailSave"), "error");
        return { cancel: true };
    } finally {
        endSession(messageId);
    }
}

/* ---------- the translation box under the edit field ---------- */

interface Twin {
    root: HTMLElement;
    area: HTMLTextAreaElement;
    again: HTMLButtonElement;
    /** The caption above the edit field ("Оригинальный текст сообщения"). */
    caption: HTMLElement;
}

/** How long after you stop typing the translation is made. */
const TWIN_DELAY_MS = 1000;

const rowOf = (s: EditSession) => document.getElementById(`chat-messages-${s.channelId}-${s.messageId}`);
const boxOf = (row: Element | null) => row?.querySelector<HTMLElement>('[role="textbox"]') ?? null;

/** The text of a piece of the field: letters as typed, an emoji as its own character (not the hidden ":name:" caption). */
function pieceText(node: Node): string {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
    if (!(node instanceof HTMLElement)) return "";
    if (node.hasAttribute("data-slate-zero-width")) return "";
    if (node instanceof HTMLImageElement) return node.alt || "";
    // an emoji (a void piece of the editor, or a wrapper with a picture and no typed letters): its character, never the hidden caption
    const img = node.querySelector("img");
    if (img && (node.getAttribute("data-slate-void") === "true" || !node.querySelector("[data-slate-string]"))) return img.alt || "";
    return [...node.childNodes].map(pieceText).join("");
}

/** What is typed in the edit field: one line per paragraph of the editor, emoji as characters. */
function readField(box: HTMLElement) {
    const lines = [...box.querySelectorAll(':scope > [data-slate-node="element"]')];
    const text = lines.length
        ? lines.map(line => pieceText(line)).join("\n")
        : box.innerText;
    return text.replace(/​/g, "").replace(/\n+$/, "");
}

const fit = (area: HTMLTextAreaElement) => {
    area.style.height = "auto";
    area.style.height = `${area.scrollHeight}px`;
};

/**
 * The same as pressing Enter in the edit field (Discord saves what is there; the translation box is read when it saves).
 * If the edit is still open a moment later, the "save" link under the field is pressed instead.
 */
function pressSave(s: EditSession) {
    const box = boxOf(rowOf(s));
    if (!box) return;
    box.focus();
    box.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true }));

    window.setTimeout(() => {
        const row = rowOf(s);
        if (!row || !boxOf(row)) return;
        const link = [...row.querySelectorAll<HTMLElement>("*")]
            .find(el => !el.children.length && /^(сохранить|save)$/i.test((el.textContent ?? "").trim()));
        if (link) link.click();
        else notify(t("editFailBox"), "error");
    }, 400);
}

function makeTwin(s: EditSession): Twin {
    const root = document.createElement("div");
    root.className = cl("twin");
    root.setAttribute("data-vc-screen-translate", "");

    const head = document.createElement("div");
    head.className = cl("twin-head");
    const label = document.createElement("span");
    label.textContent = t("editLowerLabel");
    const again = document.createElement("button");
    again.type = "button";
    again.className = cl("twin-again");
    again.textContent = t("editRetranslate");
    again.style.display = s.lowerEdited ? "" : "none";
    head.append(label, again);

    const area = document.createElement("textarea");
    area.className = cl("twin-area");
    area.rows = 1;
    area.spellcheck = false;
    area.value = s.lowerText;
    // our own "esc / enter" line (Discord's one is hidden): the same words, and they work
    const hint = document.createElement("div");
    hint.className = cl("twin-hint");
    const link = (text: string, action: () => void) => {
        const a = document.createElement("span");
        a.className = cl("twin-link");
        a.textContent = text;
        a.addEventListener("click", action);
        return a;
    };
    hint.append(
        `${t("editHintEsc")} `,
        link(t("editHintCancel"), () => FluxDispatcher.dispatch({ type: "MESSAGE_END_EDIT", channelId: s.channelId, messageId: s.messageId })),
        ` ${t("editHintEnter")} `,
        link(t("editHintSave"), () => pressSave(s))
    );
    root.append(head, area, hint);

    area.addEventListener("input", () => {
        s.lowerEdited = true;
        s.lowerText = area.value;
        again.style.display = "";
        fit(area);
    });
    // keys typed here are not for Discord: Enter saves, Esc cancels
    area.addEventListener("keydown", e => {
        e.stopPropagation();
        if (e.isComposing) return;
        if (e.key === "Escape") {
            e.preventDefault();
            FluxDispatcher.dispatch({ type: "MESSAGE_END_EDIT", channelId: s.channelId, messageId: s.messageId });
        } else if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            pressSave(s);
        }
    });
    area.addEventListener("keyup", e => e.stopPropagation());
    again.addEventListener("click", () => {
        s.lowerEdited = false;
        again.style.display = "none";
        void refreshTwin(s, true);
    });

    const caption = document.createElement("div");
    caption.className = cl("twin-caption");
    caption.setAttribute("data-vc-screen-translate", "");
    caption.textContent = t("editUpperLabel");

    requestAnimationFrame(() => fit(area));
    return { root, area, again, caption };
}

function dropTwin(s: EditSession) {
    s.twin?.caption.remove();
    s.twin?.root.remove();
    s.twin = undefined;
    s.observer?.disconnect();
    s.observer = undefined;
    s.watched = undefined;
}

/**
 * Puts everything in its place: the caption above the edit field, the translation box right under it,
 * and Discord's "esc / enter" line under the translation box. Done again whenever Discord redraws the message.
 */
function layoutTwin(s: EditSession, box: HTMLElement) {
    const twin = s.twin;
    const anchor = box.closest("form") ?? box.closest('[class*="channelTextArea"]')?.parentElement ?? box.parentElement;
    const parent = anchor?.parentElement;
    if (!twin || !anchor || !parent) return;

    if (twin.caption.nextElementSibling !== anchor) anchor.insertAdjacentElement("beforebegin", twin.caption);
    if (twin.root.previousElementSibling !== anchor) anchor.insertAdjacentElement("afterend", twin.root);

    // Discord's own "esc / enter" line is hidden (ours stands under the translation box)
    hideDiscordHint(parent);
}

/** Hides Discord's "esc to cancel • enter to save" line (the smallest piece of the edit area with those words). */
function hideDiscordHint(scope: Element) {
    const found = [...scope.querySelectorAll<HTMLElement>("*")].filter(el => {
        const text = el.textContent ?? "";
        return text.length < 120 && /esc/i.test(text) && /enter/i.test(text)
            && !el.closest("[data-vc-screen-translate]") && !el.querySelector('[role="textbox"]');
    });
    for (const el of found) {
        if (found.some(other => other !== el && el.contains(other))) continue;
        if (el.style.display !== "none") el.style.display = "none";
    }
}

/** The translation of your text, a moment after you stopped typing (not over a translation you typed yourself). */
async function refreshTwin(s: EditSession, force = false) {
    if (s.lowerEdited && !force) return;
    const box = boxOf(rowOf(s));
    if (!box) return;
    const mine = readField(box);
    if (!mine.trim()) return;

    const ask = ++s.asked;
    let to: string;
    if (!force && alike(mine, s.cache.from)) {
        to = s.cache.to;
    } else {
        s.twin?.root.classList.add(cl("twin-busy"));
        try {
            to = (await translateKeepingEmoticons("sent", mine, false, getChatTargetLanguage(s.channelId))).text;
        } catch (e) {
            console.error("[TranslatePerChat] translating the edit failed", e);
            notify(t("editFailText"), "error");
            return;
        } finally {
            if (ask === s.asked) s.twin?.root.classList.remove(cl("twin-busy"));
        }
        if (ask !== s.asked) return;
        s.cache = { from: mine, to };
    }
    // typed into the box meanwhile: yours stays
    if (s.lowerEdited && !force) return;
    s.lowerText = to;
    if (s.twin) {
        s.twin.area.value = to;
        fit(s.twin.area);
    }
}

function scheduleTwin(s: EditSession) {
    window.clearTimeout(s.timer);
    s.timer = window.setTimeout(() => void refreshTwin(s), TWIN_DELAY_MS);
}

let twinTimer: number | undefined;

/** While an edit is open: keeps the translation box in place (Discord may redraw the message) and watches the edit field. */
function twinTick() {
    if (!sessions.size) {
        stopTwinLoop();
        return;
    }
    for (const s of sessions.values()) {
        const box = boxOf(rowOf(s));
        if (!box) {
            if (s.twin) dropTwin(s);
            continue;
        }
        if (s.watched !== box) {
            s.observer?.disconnect();
            s.observer = new MutationObserver(() => scheduleTwin(s));
            s.observer.observe(box, { subtree: true, childList: true, characterData: true });
            s.watched = box;
        }
        s.twin ??= makeTwin(s);
        layoutTwin(s, box);
    }
}

function startTwinLoop() {
    if (twinTimer === undefined) twinTimer = window.setInterval(twinTick, 250);
    twinTick();
}

function stopTwinLoop() {
    window.clearInterval(twinTimer);
    twinTimer = undefined;
}

/** An edit ended (saved or cancelled): its record is forgotten a little later (saving still needs it for a moment). */
function onEndEdit(action: any) {
    const id = action?.messageId;
    const s = id && sessions.get(id);
    if (s) {
        dropTwin(s);
        window.setTimeout(() => { if (sessions.get(id) === s) endSession(id); }, 5000);
    }
}

/* ---------- start / stop ---------- */

const interceptors = () => (FluxDispatcher as any)._interceptors as ((action: any) => boolean)[] | undefined;

export function startEditOriginals() {
    void load();
    const list = interceptors();
    if (list) list.unshift(interceptor);
    else if (typeof (FluxDispatcher as any).addInterceptor === "function") (FluxDispatcher as any).addInterceptor(interceptor);
    else console.warn("[TranslatePerChat] cannot catch the opening of an edit: editing in your language is off");
    FluxDispatcher.subscribe("MESSAGE_END_EDIT", onEndEdit);
    FluxDispatcher.subscribe("MESSAGE_UPDATE", onMessageUpdate);
    FluxDispatcher.subscribe("MESSAGE_CREATE", onMessageCreate);
    FluxDispatcher.subscribe("MESSAGE_DELETE", onMessageDelete);
    FluxDispatcher.subscribe("MESSAGE_DELETE_BULK", onMessageDelete);
}

export function stopEditOriginals() {
    const list = interceptors();
    const i = list?.indexOf(interceptor) ?? -1;
    if (i >= 0) list!.splice(i, 1);
    for (const id of [...sessions.keys()]) endSession(id);
    stopTwinLoop();
    FluxDispatcher.unsubscribe("MESSAGE_END_EDIT", onEndEdit);
    FluxDispatcher.unsubscribe("MESSAGE_UPDATE", onMessageUpdate);
    FluxDispatcher.unsubscribe("MESSAGE_CREATE", onMessageCreate);
    FluxDispatcher.unsubscribe("MESSAGE_DELETE", onMessageDelete);
    FluxDispatcher.unsubscribe("MESSAGE_DELETE_BULK", onMessageDelete);
}
