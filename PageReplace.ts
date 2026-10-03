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
 * Screen translation of real page text (chat messages, replies, embeds, a text file preview):
 * instead of drawing patches on top, the text itself is swapped for its translation, right where it is.
 * Names, times, role tags, mentions, emoji and inline code are left untouched.
 * A click on a translated message switches it between the original and the translation; hotkeys and a small panel switch or reset all.
 */

import { HOTKEYS, HotkeyAction, hotkeyLabel } from "./HotkeyConfig";
import { originalFor, originalPieces, withoutEmoji } from "./EditOriginals";
import { isOnlyEmoticons, protectEmoticons } from "./Emoticons";
import { translateFileText, runLimited } from "./FileTranslate";
import { t, TextKey } from "./i18n";
import { settings } from "./settings";
import { cl, translate } from "./utils";

/** Places whose text is swapped for the translation. */
const TARGETS = [
    '[id^="message-content-"]',
    '[class*="repliedTextContent"]',
    '[class*="embedTitle"]',
    '[class*="embedDescription"]',
    '[class*="embedFieldName"]',
    '[class*="embedFieldValue"]',
    '[class*="codeView"]',
    // forum: titles of the posts in the list
    '[class*="postTitleText"]'
].join(",");

/** Things inside a target that are kept exactly as they are (and split the text around them into separate pieces). */
const KEEP = [
    "time",
    "img",
    "svg",
    '[class*="timestamp"]',
    '[class*="username"]',
    '[class*="mention"]',
    // role and channel mentions ("roleMention", "channelMention"...): names are never translated
    '[class*="Mention"]',
    '[data-list-item-id*="mention"]',
    '[class*="emoji"]',
    '[class*="inlineCode"]',
    '[class*="hiddenVisually"]',
    "[data-vc-screen-translate]"
].join(",");

/** Longer pieces (or ones with empty lines) are translated paragraph by paragraph, like a text file. */
const LONG_PIECE = 4500;
const PARALLEL_REQUESTS = 4;

interface Swap {
    node: Text;
    original: string;
    translated: string;
}

interface Replaced {
    swaps: Swap[];
    showing: "translation" | "original";
    /** Watches for Discord drawing the text anew, which throws our translation away. */
    observer: MutationObserver;
    /** True while we change the text ourselves (those changes are not Discord's). */
    painting: boolean;
    /** Number of the animation running on it (0 = none): while it runs, the text is ours even if it looks odd. */
    animating?: number;
}

const replaced = new Map<Element, Replaced>();

/** Same words, whatever the case, spaces and punctuation. */
const sameText = (a: string, b: string) => {
    const bare = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
    return bare(a) === bare(b);
};

const hasText = (text: string) => (text.match(/[\p{L}\p{N}]/gu) ?? []).length >= 2;

const intersects = (r: DOMRect, area: { left: number; top: number; right: number; bottom: number; }) =>
    r.width > 2 && r.height > 2 && r.right > area.left && r.left < area.right && r.bottom > area.top && r.top < area.bottom;

/** The places under the frame whose text can be swapped (a place inside another one is covered by the outer one). */
export function findReplaceTargets(area: { left: number; top: number; right: number; bottom: number; }): Element[] {
    const found = [...document.querySelectorAll(TARGETS)]
        .filter(el => !el.closest("[data-vc-screen-translate]") && intersects(el.getBoundingClientRect(), area));
    return found.filter(el => !found.some(other => other !== el && other.contains(el)));
}

/** A link that shows its own address: kept as it is. */
const isBareLink = (el: Element) => el.tagName === "A" && /^\s*https?:\/\//.test(el.textContent ?? "");

/** The text of a place cut into pieces: runs of text between the things that are kept, and between separate lines of blocks. */
function collectPieces(root: Element): Text[][] {
    const pieces: Text[][] = [];
    let current: Text[] = [];
    const flush = () => {
        if (current.length) pieces.push(current);
        current = [];
    };

    const visit = (node: Node) => {
        for (const child of Array.from(node.childNodes)) {
            if (child.nodeType === Node.TEXT_NODE) {
                current.push(child as Text);
            } else if (child instanceof Element) {
                if (child.matches(KEEP) || isBareLink(child)) {
                    flush();
                    continue;
                }
                const display = getComputedStyle(child).display;
                const isBlock = !display.startsWith("inline") && display !== "contents";
                if (isBlock) flush();
                visit(child);
                if (isBlock) flush();
            }
        }
    };

    visit(root);
    flush();
    return pieces.filter(p => {
        const text = p.map(n => n.nodeValue ?? "").join("");
        return hasText(text) && !isOnlyEmoticons(text);
    });
}

/* ---------- saving the translator's work ---------- */

/** Translations made lately (text -> translation), so a message seen again (another chat and back) costs nothing. */
const cache = new Map<string, string>();
const cacheKey = (text: string) => `${settings.store.service}|${settings.store.receivedInput}|${settings.store.receivedOutput}|${text}`;

async function translatePiece(text: string, track?: { fresh: boolean; }): Promise<string | null> {
    const key = cacheKey(text);
    const known = cache.get(key);
    if (known !== undefined) {
        // freshly used: moved to the end, so it is the last to be forgotten
        cache.delete(key);
        cache.set(key, known);
        return known;
    }
    try {
        const translated = text.length > LONG_PIECE || /\n\s*\n/.test(text)
            ? await translateFileText(text)
            : (await translate("received", text, true)).text;
        if (track) track.fresh = true;
        cache.set(key, translated);
        while (cache.size > (settings.store.translationCacheSize ?? 1000)) cache.delete(cache.keys().next().value!);
        return translated;
    } catch {
        return null;
    }
}

/** Letters of the alphabet of the language you read in, when that alphabet belongs to few languages (not Latin). */
const SCRIPTS: [RegExp, RegExp][] = [
    [/^(ru|uk|be|bg|sr|mk|kk|ky|mn|tg|tt)\b/i, /\p{Script=Cyrillic}/u],
    [/^el\b/i, /\p{Script=Greek}/u],
    [/^ko\b/i, /\p{Script=Hangul}/u],
    [/^ja\b/i, /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u],
    [/^zh/i, /\p{Script=Han}/u],
    [/^(ar|fa|ur)\b/i, /\p{Script=Arabic}/u],
    [/^(he|iw)\b/i, /\p{Script=Hebrew}/u],
    [/^th\b/i, /\p{Script=Thai}/u],
    [/^(hi|mr|ne)\b/i, /\p{Script=Devanagari}/u]
];

/** True when every letter of the text is in the alphabet of the language you read in: no need to ask the translator. */
function inReadingAlphabet(text: string): boolean {
    const script = SCRIPTS.find(([lang]) => lang.test(settings.store.receivedOutput ?? ""))?.[1];
    if (!script) return false;
    const letters = text.match(/\p{L}/gu) ?? [];
    return letters.length >= 2 && letters.every(l => script.test(l));
}

/* ---------- animation ---------- */

/** Blur-out / blur-in of a swap. */
const BLUR_MS = 350;
let animationCount = 0;

/** Puts the translation or the original into the page (does not change what the message is switched to). */
function paint(entry: Replaced, what: Replaced["showing"]) {
    entry.painting = true;
    for (const swap of entry.swaps) {
        if (swap.node.isConnected) swap.node.nodeValue = what === "translation" ? swap.translated : swap.original;
    }
    entry.painting = false;
}

/**
 * Switches a place to the translation or the original.
 * With an animation ("first" = the translation just arrived, "toggle" = switched) the text blurs away and comes back.
 */
function show(el: Element, entry: Replaced, what: Replaced["showing"], animate: "first" | "toggle" | null = null) {
    entry.showing = what;
    el.classList.toggle(cl("replaced-original"), what === "original");

    if (!animate || peeking || !el.isConnected) {
        entry.animating = 0;
        el.classList.remove(cl("swap-out"));
        paint(entry, peeking ? "original" : what);
        updatePanel();
        return;
    }

    // marked as animating before anyone looks at it (the text is still the old one for a moment)
    const token = entry.animating = ++animationCount;
    // what the text is now: if it is different when the blur ends, someone else changed it meanwhile
    const before = entry.swaps.map(s => s.node.nodeValue);
    updatePanel();
    const ms = BLUR_MS;
    (el as HTMLElement).style.setProperty("--vc-trans-swap-ms", `${ms}ms`);
    el.classList.add(cl("swap-out"));
    window.setTimeout(() => {
        if (entry.animating !== token) return;
        entry.animating = 0;
        // Discord drew the text anew while it was blurred (an edited message): painting the old translation over it
        // would bring back the old text. The place is let go instead, and gets translated again as new text.
        if (replaced.get(el) === entry && entry.swaps.some((s, i) => !s.node.isConnected || s.node.nodeValue !== before[i])) {
            forget(el);
            return;
        }
        paint(entry, peeking ? "original" : entry.showing);
        el.classList.remove(cl("swap-out"));
    }, ms);
}

function forget(el: Element) {
    const entry = replaced.get(el);
    entry?.observer.disconnect();
    if (entry) entry.animating = 0;
    el.classList.remove(cl("replaced"), cl("replaced-original"), cl("swap-out"));
    replaced.delete(el);
    updatePanel();
}

/** Discord drew the text anew (a file preview was expanded, a message edited): our text is gone, so is the mark. */
function isIntact(entry: Replaced) {
    if (entry.animating) return true;
    const expected = peeking ? "original" : entry.showing;
    return entry.swaps.every(s => s.node.isConnected && s.node.nodeValue === (expected === "translation" ? s.translated : s.original));
}

/** Checking every place costs time with many translations: done at most once per screen refresh. */
let droppedThisFrame = false;

function dropBroken() {
    if (droppedThisFrame) return;
    droppedThisFrame = true;
    requestAnimationFrame(() => { droppedThisFrame = false; });
    for (const [el, entry] of [...replaced]) {
        if (!el.isConnected || !isIntact(entry)) forget(el);
    }
}

/** Places whose translation you turned off yourself: the chat translating itself leaves them alone. */
const turnedOff = new WeakSet<Element>();
export const isTurnedOff = (el: Element) => turnedOff.has(el);

/** Puts the original text back in the messages of one chat and forgets their translations. */
export function restoreChat(channelId: string) {
    const prefix = `chat-messages-${channelId}-`;
    for (const [el, entry] of [...replaced]) {
        if (!el.closest('[id^="chat-messages-"]')?.id.startsWith(prefix)) continue;
        entry.animating = 0;
        paint(entry, "original");
        forget(el);
    }
}

/** Puts the original text back everywhere and forgets the translations. */
export function restoreAll() {
    for (const [el, entry] of [...replaced]) {
        turnedOff.add(el);
        paint(entry, "original");
        forget(el);
    }
}

/** Switches every translated place: if any shows the translation, all go to the original, otherwise all to the translation. */
export function toggleAll() {
    dropBroken();
    const anyTranslated = [...replaced.values()].some(e => e.showing === "translation");
    for (const [el, entry] of replaced) show(el, entry, anyTranslated ? "original" : "translation", "toggle");
}

let peeking = false;

/** While on, every translated place shows its original (held Alt); switching off brings back what each was showing. */
export function peekOriginal(on: boolean) {
    if (peeking === on) return;
    peeking = on;
    for (const [el, entry] of replaced) {
        entry.animating = 0;
        el.classList.remove(cl("swap-out"));
        paint(entry, on ? "original" : entry.showing);
    }
}

export const hasReplaced = () => replaced.size > 0;

/* ---------- one message (the right-click menu) ---------- */

/** The translated places inside one message row. */
function placesOf(row: Element) {
    // only the places of this message are checked, not every translation on the page
    const places = [...replaced].filter(([el]) => row.contains(el));
    const intact = places.filter(([el, entry]) => el.isConnected && isIntact(entry));
    if (intact.length !== places.length)
        for (const [el] of places) if (!intact.some(([kept]) => kept === el)) forget(el);
    return intact;
}

/** "translation" / "original" for a message that has translated text, otherwise undefined. */
export function messageState(row: Element | null): Replaced["showing"] | undefined {
    if (!row) return undefined;
    const places = placesOf(row);
    if (!places.length) return undefined;
    return places.some(([, e]) => e.showing === "translation") ? "translation" : "original";
}

/** The places of one message that get translated: its text, its embeds and the quoted reply above it. */
export function messageTargets(row: Element): Element[] {
    const found = [...row.querySelectorAll(TARGETS)];
    return found.filter(el => !found.some(other => other !== el && other.contains(el)));
}

/** True when a message has text that could be translated (not just mentions, emoji, smileys...). */
export function hasTranslatableText(row: Element): boolean {
    return messageTargets(row).some(el => collectPieces(el).length > 0);
}

/** True while this place shows (or can be switched to) a translation. */
export const isReplaced = (el: Element) => replaced.has(el);

/** Translates one message right where it is. */
export async function translateMessage(row: Element): Promise<boolean> {
    const targets = messageTargets(row);
    if (!targets.length) return false;
    return replaceInPlace(targets);
}

/** Puts the original text of one message back and forgets its translation. */
export function resetMessage(row: Element) {
    for (const [el, entry] of placesOf(row)) {
        turnedOff.add(el);
        paint(entry, "original");
        forget(el);
    }
}

export function toggleMessage(row: Element) {
    const places = placesOf(row);
    const to = places.some(([, e]) => e.showing === "translation") ? "original" : "translation";
    for (const [el, entry] of places) show(el, entry, to, "toggle");
}

/** The translated text of a message, whatever is shown at the moment. */
export function messageTranslation(row: Element): string {
    return placesOf(row).map(([el, entry]) => {
        paint(entry, "translation");
        const text = (el as HTMLElement).innerText ?? el.textContent ?? "";
        paint(entry, peeking ? "original" : entry.showing);
        return text.trim();
    }).filter(Boolean).join("\n\n");
}

/* ---------- the small panel in the corner of the chat ---------- */

let panel: HTMLElement | null = null;

/** A small clickable label on the panel (text, tip, what a click does), or nothing. */
export interface PanelLabel { text: string; title?: string; onClick?(): void; }

/** Labels at the start of the panel: "Auto" (the chat translates itself) and the direction of translation ("EN → RU"). */
let panelLabels: () => (PanelLabel | null)[] = () => [];
export function setPanelLabels(labels: () => (PanelLabel | null)[]) {
    panelLabels = labels;
    updatePanel();
}

/** The panel shows up (or goes away) when a label appears or disappears, e.g. on entering a chat that translates itself. */
export function syncPanel() {
    if (!!panel !== (replaced.size > 0 || panelLabels().some(Boolean))) updatePanelNow();
    else if (panel) refreshLabels();
}

/** What the "Configure shortcuts" button does (set by the plugin when it starts). */
let openSettings: (() => void) | null = null;
export function setOpenSettings(open: (() => void) | null) {
    openSettings = open;
}

/** While the chat window is open, the panel steps aside (they would stand on the same spot). */
let panelAway = false;
export function setPanelAway(away: boolean) {
    panelAway = away;
    panel?.classList.toggle(cl("replace-panel-away"), away);
}

/** Whether "reset all" is possible now (not in a chat that translates itself). */
let resetAllowed: () => boolean = () => true;
export function setResetAllowed(allowed: () => boolean) {
    resetAllowed = allowed;
}

let labelsHolder: HTMLElement | null = null;
let lastLabels = "";

/** Draws the labels again when they changed (also called often, so "pause" shows up by itself). */
function refreshLabels() {
    if (!labelsHolder) return;
    panel?.classList.toggle(cl("replace-panel-away"), panelAway);
    // no reset in a chat that translates itself: the cross and its shortcut are hidden
    panel?.classList.toggle(cl("replace-panel-noreset"), !resetAllowed());
    const labels = panelLabels().filter((l): l is PanelLabel => !!l);
    const key = labels.map(l => `${l.text}|${l.title ?? ""}`).join("||");
    if (key === lastLabels) return;
    lastLabels = key;
    labelsHolder.replaceChildren(...labels.map(l => {
        const el = document.createElement("button");
        el.type = "button";
        el.className = cl("replace-panel-label", { "replace-panel-label-plain": !l.onClick });
        el.textContent = l.text;
        if (l.title) el.title = l.title;
        el.addEventListener("click", e => {
            e.stopPropagation();
            l.onClick?.();
        });
        return el;
    }));
}

/**
 * The bar at the bottom of the chat: the message box, or the "you cannot send messages here" bar
 * (its middle is inside the chat: in a very narrow window it sticks out a bit).
 */
export function chatBar(rect = chatRect()): Element | undefined {
    if (!rect) return undefined;
    const inChat = (el: Element) => {
        const r = el.getBoundingClientRect();
        const middle = (r.left + r.right) / 2;
        // not the box of a message being edited (that one is inside the message list)
        return r.width > 0 && middle >= rect.left && middle <= rect.right && r.top >= rect.top
            && !el.closest('[data-list-id="chat-messages"]');
    };
    return [...document.querySelectorAll('[class*="channelTextArea"]')].find(inChat)
        ?? [...document.querySelectorAll("form")].find(inChat);
}

export function chatRect(): DOMRect | null {
    const list = document.querySelector('[data-list-id="chat-messages"]');
    const scroller = list?.closest('[class*="scroller"]') ?? list;
    return scroller?.getBoundingClientRect() ?? null;
}

/** Things that want to know when any translation appears, switches or goes away (the buttons next to a message). */
const changeListeners = new Set<() => void>();
export function onReplacedChange(listener: () => void) {
    changeListeners.add(listener);
    return () => { changeListeners.delete(listener); };
}

/** Many changes in a row (a whole batch of messages translated) update the panel and the message buttons once. */
let panelQueued = false;
function updatePanel() {
    if (panelQueued) return;
    panelQueued = true;
    requestAnimationFrame(() => {
        panelQueued = false;
        updatePanelNow();
    });
}

function updatePanelNow() {
    for (const listener of changeListeners) {
        try { listener(); } catch (e) { console.error("[TranslatePerChat]", e); }
    }

    if (!replaced.size && !panelLabels().some(Boolean)) {
        panel?.remove();
        panel = null;
        labelsHolder = null;
        fitKey = "";
        dropLifts();
        window.clearTimeout(fadeTimer);
        setChatSpace(null, 0);
        stopListening();
        return;
    }
    if (replaced.size) startListening();

    if (!panel) {
        panel = document.createElement("div");
        panel.className = cl("replace-panel");
        panel.setAttribute("data-vc-screen-translate", "");

        labelsHolder = document.createElement("span");
        labelsHolder.className = cl("replace-panel-labels");
        lastLabels = "\u0000";

        const count = document.createElement("span");
        count.className = cl("replace-panel-count");

        // keyboard sign: the list of shortcuts opens on hover and closes a second after the mouse has left it
        const keys = document.createElement("span");
        keys.className = cl("replace-panel-keys");
        keys.textContent = "\u2328";
        const sheet = document.createElement("div");
        sheet.className = cl("replace-panel-sheet");
        const line = (cls: string) => {
            const el = document.createElement("div");
            el.className = cl(cls);
            return el;
        };
        const title = line("replace-panel-sheet-title");
        sheet.append(title, line("replace-panel-sheet-line"));
        // the keys and texts are written again whenever the list opens (the keys can be changed in the settings)
        const rows: { k: HTMLElement; v: HTMLElement; action: HotkeyAction | null; text: TextKey; }[] = [];
        for (const [action, text] of [
            ...HOTKEYS.map(h => [h.id, h.textKey] as const),
            [null, "holdAltDesc"] as const
        ]) {
            const k = document.createElement("span");
            k.className = cl("replace-panel-sheet-key");
            const v = document.createElement("span");
            rows.push({ k, v, action, text });
            sheet.append(k, v);
        }
        const fillRows = () => {
            title.textContent = t("hkListTitle");
            for (const { k, v, action, text } of rows) {
                k.textContent = action ? hotkeyLabel(action) : t("holdAlt");
                v.textContent = t(text);
            }
        };
        fillRows();
        sheet.append(line("replace-panel-sheet-line"));
        const settingsButton = document.createElement("button");
        settingsButton.type = "button";
        settingsButton.className = cl("replace-panel-sheet-button");
        settingsButton.textContent = t("hkConfigure");
        settingsButton.addEventListener("click", () => {
            keys.classList.remove(cl("replace-panel-keys-open"));
            openSettings?.();
        });
        sheet.append(settingsButton);
        keys.append(sheet);
        let keysTimer: number | undefined;
        keys.addEventListener("mouseenter", () => {
            window.clearTimeout(keysTimer);
            fillRows();
            keys.classList.add(cl("replace-panel-keys-open"));
        });
        keys.addEventListener("mouseleave", () => {
            window.clearTimeout(keysTimer);
            keysTimer = window.setTimeout(() => keys.classList.remove(cl("replace-panel-keys-open")), PANEL_FADE_MS);
        });

        panel.append(count, labelsHolder, keys);

        // goes see-through a second after the mouse leaves it, solid again while the mouse is on it
        const fadedClass = cl("replace-panel-faded");
        const fadeLater = () => {
            window.clearTimeout(fadeTimer);
            fadeTimer = window.setTimeout(() => panel?.classList.add(fadedClass), PANEL_FADE_MS);
        };
        panel.addEventListener("mouseenter", () => {
            window.clearTimeout(fadeTimer);
            panel?.classList.remove(fadedClass);
        });
        panel.addEventListener("mouseleave", fadeLater);
        // always see-through, except while the mouse is on it
        panel.classList.add(fadedClass);

        document.body.append(panel);
    }

    refreshLabels();
    (panel.children[0] as HTMLElement).textContent = `${t("panelTranslated")}: ${replaced.size}`;

    placePanel();
}

/** How long after the mouse leaves the panel it turns see-through, and the gap between the panel and what it stands on. */
const PANEL_FADE_MS = 1000;
const PANEL_GAP_PX = 3;
let fadeTimer: number | undefined;

/** The empty room added under the last message so the panel never covers it. */
let spacedList: HTMLElement | null = null;
let spacedPx = 0;

function setChatSpace(list: HTMLElement | null, px: number) {
    if (spacedList && (spacedList !== list || !px)) {
        spacedList.style.removeProperty("padding-bottom");
        spacedList = null;
        spacedPx = 0;
    }
    if (!list || !px || (list === spacedList && px === spacedPx)) return;

    const scroller = list.closest('[class*="scroller"]') as HTMLElement | null;
    const atBottom = scroller ? scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 4 : false;
    list.style.setProperty("padding-bottom", `${px}px`);
    spacedList = list;
    spacedPx = px;
    // was looking at the newest message: keep looking at it
    if (scroller && atBottom) scroller.scrollTop = scroller.scrollHeight;
}

let lastPlace = "";

/** Puts the panel right above the message box (with the reply bar) or above the blue "jump to new messages" bar, right edges lined up. */
function placePanel() {
    if (!panel || document.hidden) return;
    refreshLabels();
    const list = document.querySelector('[data-list-id="chat-messages"]') as HTMLElement | null;
    const rect = chatRect();

    const boxEl = rect && chatBar(rect);
    let top: number | undefined;
    let right: number | undefined;
    if (boxEl) {
        const r = boxEl.getBoundingClientRect();
        top = r.top;
        right = r.right;
        // the "Replying to" bar and other bars stuck on top of the box
        const form = boxEl.closest("form") ?? boxEl.parentElement;
        form?.querySelectorAll('[class*="attachedBars"], [class*="stackedBars"], [class*="replyBar"]').forEach(bar => {
            const b = bar.getBoundingClientRect();
            if (b.height && b.bottom <= r.bottom) top = Math.min(top!, b.top);
        });
    } else if (rect) {
        top = rect.bottom;
        right = rect.right - 16;
    }

    // narrow chat: the panel gives up parts until it fits (hints, then the count, then the buttons)
    if (rect && right !== undefined) fitPanel(right - rect.left - 8);

    const place = top !== undefined && right !== undefined
        ? `${Math.max(8, window.innerWidth - right)}|${Math.max(8, window.innerHeight - top + PANEL_GAP_PX)}`
        : "24|24";
    if (place !== lastPlace || !panel.style.right) {
        lastPlace = place;
        const [r, b] = place.split("|");
        panel.style.right = `${r}px`;
        panel.style.bottom = `${b}px`;
    }

    // the blue "you're viewing older messages / jump to present" bar goes up above the panel; the panel stays
    if (rect && top !== undefined) liftBars(rect, top - PANEL_GAP_PX - panel.getBoundingClientRect().height);

    // room under the last message, as tall as the panel (kept as it is while the panel steps aside,
    // so the chat does not jump)
    if (replaced.size && !panelAway)
        setChatSpace(list, Math.ceil(panel.getBoundingClientRect().height) + PANEL_GAP_PX);
}

/** Blue bars moved up, and by how much. */
const lifted = new Map<HTMLElement, number>();

function liftBars(rect: DOMRect, panelTop: number) {
    for (const bar of document.querySelectorAll<HTMLElement>('[class*="jumpToPresentBar"]')) {
        const b = bar.getBoundingClientRect();
        if (!b.height || b.right < rect.left || b.left > rect.right) continue;
        const now = lifted.get(bar) ?? 0;
        // where the bar would be without our lift, and how far up it has to go to clear the panel
        const need = Math.max(0, Math.round(b.bottom + now - (panelTop - 6)));
        if (need === now) continue;
        bar.style.translate = need ? `0 -${need}px` : "";
        if (need) lifted.set(bar, need);
        else lifted.delete(bar);
    }
}

function dropLifts() {
    for (const bar of lifted.keys()) bar.style.translate = "";
    lifted.clear();
}

/** Narrow chat: the panel gives up the counter "Translated: N". */
let fitKey = "";

function fitPanel(room: number) {
    if (!panel) return;
    const key = `${Math.round(room)}|${panel.textContent}`;
    if (key === fitKey) return;
    fitKey = key;
    for (let level = 0; level <= 1; level++) {
        panel.classList.toggle(cl("replace-panel-c1"), level >= 1);
        if (Math.max(panel.getBoundingClientRect().width, panel.scrollWidth) <= room) break;
    }
}

/* ---------- the tip shown when the mouse rests on translated text ---------- */

/** How long the mouse has to rest before the tip shows, and how far below the pointer it appears. */
const TIP_DELAY_MS = 700;
const TIP_BELOW_PX = 28;

let tip: HTMLElement | null = null;
let tipTimer: number | undefined;
let tipOver: Element | null = null;
let lastMouse = { x: 0, y: 0 };

function hideTip() {
    window.clearTimeout(tipTimer);
    tipTimer = undefined;
    tip?.remove();
    tip = null;
}

function showTip() {
    hideTip();
    tip = document.createElement("div");
    tip.className = cl("replaced-tip");
    tip.setAttribute("data-vc-screen-translate", "");

    const main = document.createElement("div");
    main.textContent = t("replacedHint", { toggle: hotkeyLabel("toggle"), reset: hotkeyLabel("reset") });
    const off = document.createElement("div");
    off.className = cl("replaced-tip-off");
    off.textContent = t("tipHideHint");
    tip.append(main, off);
    document.body.append(tip);

    // below the pointer, but always inside the window
    const w = tip.offsetWidth;
    const h = tip.offsetHeight;
    const left = Math.min(Math.max(8, lastMouse.x - 12), window.innerWidth - w - 8);
    let top = lastMouse.y + TIP_BELOW_PX;
    if (top + h > window.innerHeight - 8) top = lastMouse.y - h - 12;
    Object.assign(tip.style, { left: `${left}px`, top: `${top}px` });
}

function onMouseMove(e: MouseEvent) {
    lastMouse = { x: e.clientX, y: e.clientY };
    const target = e.target as Element | null;
    const over = (settings.store.showReplacedTips !== false && target?.closest)
        ? [...replaced.keys()].find(el => el.contains(target)) ?? null
        : null;

    if (over !== tipOver) {
        tipOver = over;
        hideTip();
    }
    // the tip appears once the mouse rests; moving again restarts the wait (a shown tip stays where it is)
    if (over && !tip) {
        window.clearTimeout(tipTimer);
        tipTimer = window.setTimeout(showTip, TIP_DELAY_MS);
    }
}

const onAnyPress = () => hideTip();

/* ---------- clicks on a translated message ---------- */

let listening = false;

function onClick(e: MouseEvent) {
    const target = e.target as Element | null;
    if (!target?.closest || target.closest("a, button, [role='button'], img, video, [data-vc-screen-translate]")) return;
    // selecting text is not a click to switch
    if (!(window.getSelection()?.isCollapsed ?? true)) return;

    dropBroken();
    for (const [el, entry] of replaced) {
        if (el.contains(target)) {
            show(el, entry, entry.showing === "translation" ? "original" : "translation", "toggle");
            return;
        }
    }
}

const onResize = () => updatePanel();

/** Every second: forget messages that left the screen for good (another channel opened) so the panel count stays right. */
let checkTimer: number | undefined;
let placeTimer: number | undefined;

function startListening() {
    if (listening) return;
    listening = true;
    document.addEventListener("click", onClick, true);
    document.addEventListener("mousemove", onMouseMove, true);
    document.addEventListener("mousedown", onAnyPress, true);
    document.addEventListener("wheel", onAnyPress, { capture: true, passive: true });
    window.addEventListener("resize", onResize);
    checkTimer = window.setInterval(dropBroken, 1000);
    // follow the message box as it grows, the reply bar and the blue bar come and go
    placeTimer = window.setInterval(placePanel, 100);
}

function stopListening() {
    if (!listening) return;
    listening = false;
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("mousemove", onMouseMove, true);
    document.removeEventListener("mousedown", onAnyPress, true);
    document.removeEventListener("wheel", onAnyPress, true);
    window.removeEventListener("resize", onResize);
    window.clearInterval(placeTimer);
    hideTip();
    tipOver = null;
    window.clearInterval(checkTimer);
}

/**
 * Swaps the text of the given places for its translation.
 * Returns false when nothing at all could be translated (the caller shows a message).
 */
/* ---------- keeping links, formatting and smileys ---------- */

/** A run of text that sits in one element: plain text, or a link / bold / italic / spoiler ... */
interface Segment { nodes: Text[]; owner: Element | null; lead: string; core: string; trail: string; }

const MARK = (id: number) => `\u27E6${id}\u27E7`;
/** A line break inside a paragraph (the translator would glue the lines together): mark 0. */
const LINE = /\u27E6\s*0\s*\u27E7/g;
const PAIR = /\u27E6\s*(\d+)\s*\u27E7([\s\S]*?)\u27E6\s*\1\s*\u27E7/g;
const ANY_MARK = /\u27E6\s*\d+\s*\u27E7/g;
const HAS_MARK = /\u27E6\s*\d+\s*\u27E7/;

function segmentsOf(nodes: Text[]): Segment[] {
    const segs: Segment[] = [];
    for (const node of nodes) {
        const owner = node.parentElement;
        const last = segs[segs.length - 1];
        if (last && last.owner === owner) last.nodes.push(node);
        else segs.push({ nodes: [node], owner, lead: "", core: "", trail: "" });
    }
    for (const seg of segs) {
        const text = seg.nodes.map(n => n.nodeValue ?? "").join("");
        seg.lead = text.match(/^\s*/)![0];
        seg.trail = text.length > seg.lead.length ? text.match(/\s*$/)![0] : "";
        seg.core = text.slice(seg.lead.length, text.length - seg.trail.length);
    }
    return segs;
}

/**
 * Translates one piece of text, keeping what is inside links and formatting where it was:
 * the formatted words are wrapped in marks "⟦1⟧...⟦1⟧", the translator keeps the marks, and each part goes back
 * into its own element. Smileys are hidden from the translator. Returns the new text of every node, or null.
 */
async function translateNodes(nodes: Text[], skipUnchanged?: boolean, track?: { fresh: boolean; }): Promise<string[] | null> {
    const segs = segmentsOf(nodes);
    // the plain text is the element holding most of the letters; everything else is formatting
    const weight = new Map<Element | null, number>();
    for (const s of segs) weight.set(s.owner, (weight.get(s.owner) ?? 0) + s.core.length);
    const plainOwner = [...weight].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    const styled = segs.length > 1 ? segs.filter(s => s.owner !== plainOwner && s.core) : [];

    let built = segs.map(s => {
        const id = styled.indexOf(s);
        return id < 0 ? s.lead + s.core + s.trail : `${s.lead}${MARK(id + 1)}${s.core}${MARK(id + 1)}${s.trail}`;
    }).join("");

    const raw = nodes.map(n => n.nodeValue ?? "").join("");
    const lead = raw.match(/^\s*/)![0];
    const trail = raw.match(/\s*$/)![0];

    const smileys = protectEmoticons(built.trim());
    // single line breaks become marks (empty lines between paragraphs stay: those are translated one by one)
    built = smileys.text.replace(/ *(?<!\n)\n(?!\n) */g, ` ${MARK(0)} `);
    const lines = (built.match(LINE) ?? []).length;
    let translated = await translatePiece(built, track);
    if (translated === null) return null;
    if ((translated.match(LINE) ?? []).length !== lines) {
        // the translator lost line breaks: line by line instead
        const parts = await Promise.all(built.split(LINE).map(line => line.trim() ? translatePiece(line.trim(), track) : Promise.resolve("")));
        if (parts.some(p => p === null)) return null;
        translated = parts.join("\n");
    } else {
        translated = translated.replace(/[ \t]*\u27E6\s*0\s*\u27E7[ \t]*/g, "\n");
    }
    if (skipUnchanged && sameText(translated.replace(ANY_MARK, ""), built.replace(ANY_MARK, ""))) return null;
    translated = smileys.restore(translated);

    const texts = nodes.map(() => "");
    const put = (seg: Segment, text: string) => {
        const i = nodes.indexOf(seg.nodes[0]);
        texts[i] = seg.lead + text.trim() + seg.trail;
    };

    if (!styled.length) {
        texts[0] = lead + translated.replace(ANY_MARK, "").trim() + trail;
        return texts;
    }

    // every mark found exactly once: each formatted part goes back into its element
    const chunks = new Map<number, string>();
    let ok = true;
    const plainParts: string[] = [];
    let last = 0;
    for (const m of translated.matchAll(PAIR)) {
        const id = Number(m[1]);
        if (chunks.has(id) || id < 1 || id > styled.length) { ok = false; break; }
        chunks.set(id, m[2]);
        plainParts.push(translated.slice(last, m.index));
        last = m.index! + m[0].length;
    }
    plainParts.push(translated.slice(last));
    if (ok && chunks.size === styled.length && !plainParts.some(p => HAS_MARK.test(p))) {
        styled.forEach((s, k) => put(s, chunks.get(k + 1)!.replace(ANY_MARK, "")));
        const plain = segs.filter(s => !styled.includes(s));
        const parts = plainParts.map(p => p.trim()).filter(Boolean);
        if (plain.length) {
            plain.forEach((s, k) => {
                const mine = k < plain.length - 1 ? parts.slice(k, k + 1) : parts.slice(k);
                put(s, mine.join(" "));
            });
        } else if (parts.length) {
            // no plain text in the original: the loose words go after the first formatted part
            put(styled[0], `${chunks.get(1)} ${parts.join(" ")}`);
        }
        return texts;
    }

    // the marks got lost: the whole translation goes into the plain text, links keep their own words
    const target = segs.find(s => !s.owner?.closest("a")) ?? segs[0];
    put(target, translated.replace(ANY_MARK, ""));
    for (const s of segs) {
        if (s !== target && s.owner?.closest("a"))
            s.nodes.forEach(n => { texts[nodes.indexOf(n)] = n.nodeValue ?? ""; });
    }
    return texts;
}

/** Whether a piece of text has formatting inside it (bold, a spoiler...): such text is not rebuilt from memory. */
function hasStyledParts(nodes: Text[]): boolean {
    const segs = segmentsOf(nodes);
    if (segs.length < 2) return false;
    const weight = new Map<Element | null, number>();
    for (const s of segs) weight.set(s.owner, (weight.get(s.owner) ?? 0) + s.core.length);
    const plainOwner = [...weight].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    return segs.some(s => s.owner !== plainOwner && s.core);
}

/**
 * Your own text for the pieces of one of your messages (found by the message number, not by guessing from the text),
 * or null when the message is not remembered / has links or formatting (the translator is asked then).
 * Pieces that do not line up with the pieces of the chat: all the text goes to the first one, the rest are emptied (emoji stay).
 */
function ownTextsFor(el: Element, pieces: Text[][]): string[] | null {
    if (!el.id.startsWith("message-content-")) return null;
    const messageId = el.id.slice("message-content-".length);
    const channelId = el.closest('[id^="chat-messages-"]')?.id.match(/^chat-messages-(\d+)-/)?.[1];
    if (!channelId || pieces.some(hasStyledParts)) return null;

    const mine = originalFor(channelId, messageId);
    if (mine === null) return null;

    const parts = originalPieces(mine);
    if (parts.length === pieces.length) return parts.map(p => p.trim());
    return pieces.map((_, i) => i === 0 ? withoutEmoji(mine).trim() : "");
}

/** The new text of every text node of a piece when your own text is put in (the first node holds it all, the spaces around stay). */
function ownNodeTexts(nodes: Text[], mine: string): string[] {
    const raw = nodes.map(n => n.nodeValue ?? "").join("");
    const texts = nodes.map(() => "");
    texts[0] = raw.match(/^\s*/)![0] + mine + raw.match(/\s*$/)![0];
    return texts;
}

export async function replaceInPlace(targets: Element[], options: { skipUnchanged?: boolean; } = {}): Promise<boolean> {
    const jobs: { el: Element; pieces: Text[][]; }[] = [];

    for (const el of targets) {
        if (!options.skipUnchanged) turnedOff.delete(el);
        const already = replaced.get(el);
        if (already && el.isConnected && isIntact(already)) {
            // translated before and still in place: just show the translation again
            show(el, already, "translation", "toggle");
            continue;
        }
        if (already) forget(el);
        const pieces = collectPieces(el);
        if (pieces.length) jobs.push({ el, pieces });
    }

    const all = jobs.flatMap(job => job.pieces.map(nodes => ({ job, nodes })));
    // already in your alphabet: not even sent to the translator
    const toAsk = options.skipUnchanged
        ? all.filter(({ nodes }) => !inReadingAlphabet(nodes.map(n => n.nodeValue ?? "").join("")))
        : all;


    // your own messages that are remembered: your text, by the message number
    const own = new Map<Text[], string>();
    for (const job of jobs) ownTextsFor(job.el, job.pieces)?.forEach((text, i) => own.set(job.pieces[i], text));

    const results = await runLimited(toAsk, PARALLEL_REQUESTS, async ({ nodes }) => {
        const mine = own.get(nodes);
        if (mine !== undefined) return { nodes, texts: ownNodeTexts(nodes, mine), fresh: false };
        // already in the language you read (the translator gave the same text back): left alone
        const track = { fresh: false };
        const texts = await translateNodes(nodes, options.skipUnchanged, track);
        return texts ? { nodes, texts, fresh: track.fresh } : null;
    });


    let anything = targets.some(el => replaced.has(el));
    for (const job of jobs) {
        const swaps: Swap[] = [];
        let fresh = false;
        for (const result of results) {
            if (!result || !job.pieces.includes(result.nodes)) continue;
            if (result.fresh) fresh = true;
            // each text node gets its part: links and formatting keep their words
            result.nodes.forEach((node, i) => {
                swaps.push({ node, original: node.nodeValue ?? "", translated: result.texts[i] });
            });
        }
        if (!swaps.length) continue;

        anything = true;
        const entry: Replaced = { swaps, showing: "original", painting: false, observer: null! };
        entry.observer = new MutationObserver(() => {
            if (!entry.painting && replaced.get(job.el) === entry && !isIntact(entry)) forget(job.el);
        });
        entry.observer.observe(job.el, { childList: true, subtree: true, characterData: true });
        replaced.set(job.el, entry);
        job.el.classList.add(cl("replaced"));
        // the blur only for a translation the translator just made; a remembered one is simply put in place
        show(job.el, entry, "translation", fresh ? "first" : null);
    }

    updatePanel();
    return anything;
}
