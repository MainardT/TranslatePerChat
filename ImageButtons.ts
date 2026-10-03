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
 * Buttons next to a picture in the chat (or in the large view): to the right of it, along its top edge
 * (above its right corner when there is no room on the right), shown while the mouse is anywhere on the message
 * (every picture of it gets its own), and the whole time the large view is open.
 * Translate (stays in the same place, and removes the translation again, like a cross); once translated, to its right:
 * original/translation and copy (what is shown). The text is read from the picture file in full size when possible.
 */


import { addTip, flashTip, refreshTip, setTip } from "./Notify";
import { t } from "./i18n";
import { overlapArea, Pick, PickRect, registerPickFinder } from "./Picks";
import { PictureResult, translateImage } from "./ScreenTranslate";
import { cl } from "./utils";

/** Smaller pictures are avatars, emoji, icons. */
const MIN_WIDTH = 100;
const MIN_HEIGHT = 60;
/** Gap between the picture and the buttons. */
const GAP = 6;
/** The buttons go right away when the mouse leaves the message (they stand inside its row, so they can still be reached). */
const HIDE_DELAY_MS = 0;

/** Material Design "translate" icon (Apache License 2.0). */
const TRANSLATE_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12.87 15.07l-2.54-2.51.03-.03c1.74-1.94 2.98-4.17 3.71-6.53H17V4h-7V2H8v2H1v1.99h11.17C11.5 7.92 10.44 9.75 9 11.35 8.07 10.32 7.3 9.19 6.69 8h-2c.73 1.63 1.73 3.17 2.98 4.56l-5.09 5.02L4 19l5-5 3.11 3.11.76-2.04zM18.5 10h-2L12 22h2l1.12-3h4.75L21 22h2l-4.5-12zm-2.62 7l1.62-4.33L19.12 17h-3.24z"/></svg>';
const SWAP_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h14l-3-3M18 7l-3 3M20 17H6l3 3M6 17l3-3"/></svg>';
const COPY_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h8"/></svg>';

interface Plate { holder: HTMLElement; copy: HTMLButtonElement; swap: HTMLButtonElement; translate: HTMLButtonElement; }

/** Buttons of each picture shown now. */
const plates = new Map<HTMLImageElement, Plate>();
/** The pictures whose buttons are shown: those of the message the mouse is on, or of the large view. */
let current: HTMLImageElement[] = [];
/** The picture that has a translation on it now, and that translation. */
let active: { img: HTMLImageElement; result: PictureResult; } | null = null;
let busy: HTMLImageElement | null = null;
let hideTimer: number | undefined;
let frame = 0;

function isTranslatable(el: Element): el is HTMLImageElement {
    if (!(el instanceof HTMLImageElement)) return false;
    // a picture in a message, or the large view of a picture
    const inChat = !!el.closest('[id^="chat-messages-"]');
    const inLargeView = !inChat && !!el.closest('[role="dialog"], [class*="layer"], [class*="modal"], [class*="Modal"], [class*="carousel"], [class*="mediaViewer"]');
    if (!inChat && !inLargeView) return false;
    if (el.closest('[data-vc-screen-translate], [class*="avatar"], [class*="emoji"], [class*="sticker"], [class*="reaction"]')) return false;
    // the blurred stand-in Discord keeps under a picture while it loads: built into the page, or tiny and stretched
    const src = el.currentSrc || el.src;
    if (!src || src.startsWith("data:") || src.startsWith("blob:")) return false;
    if (el.complete && el.naturalWidth > 0 && el.naturalWidth < 64) return false;
    const r = el.getBoundingClientRect();
    return r.width >= MIN_WIDTH && r.height >= MIN_HEIGHT;
}

/** Pictures lying on top of each other (a stand-in under the real one): only the one on top counts. */
function withoutHidden(imgs: HTMLImageElement[]): HTMLImageElement[] {
    return imgs.filter(img => {
        const r = img.getBoundingClientRect();
        const top = document.elementsFromPoint(r.left + r.width / 2, r.top + r.height / 2).find(el => el instanceof HTMLImageElement);
        return !top || top === img || !imgs.includes(top as HTMLImageElement);
    });
}

function makeButton(icon: string, onClick: () => void): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = cl("plate-button");
    button.innerHTML = icon;
    button.addEventListener("click", e => {
        e.preventDefault();
        e.stopPropagation();
        onClick();
    });
    return button;
}

function makePlate(img: HTMLImageElement): Plate {
    const holder = document.createElement("div");
    holder.className = cl("image-plate");
    holder.setAttribute("data-vc-screen-translate", "");

    const plate = document.createElement("div");
    plate.className = cl("plate");

    const p: Plate = {
        holder,
        translate: makeButton(TRANSLATE_ICON, () => onTranslate(img)),
        swap: makeButton(SWAP_ICON, () => { if (active?.img === img) active.result.toggle(); refresh(); }),
        copy: makeButton(COPY_ICON, () => onCopy())
    };
    // translate is the first one: it keeps its place, the others appear to its right
    plate.append(p.translate, p.swap, p.copy);
    for (const b of [p.translate, p.swap, p.copy]) addTip(b);
    holder.append(plate);
    holder.addEventListener("mouseenter", () => window.clearTimeout(hideTimer));
    holder.addEventListener("mouseleave", scheduleHide);
    return p;
}

/** While buttons are shown, they move with their pictures every screen refresh (a new message moves the chat). */
let followFrame = 0;
function followPictures() {
    followFrame = 0;
    if (!plates.size) return;
    for (const [img, p] of plates) {
        if (!img.isConnected) continue;
        place(img, p);
        const r = img.getBoundingClientRect();
        const view = img.closest('[class*="scroller"]')?.getBoundingClientRect();
        p.holder.style.visibility = view && (r.bottom < view.top || r.top > view.bottom) ? "hidden" : "";
    }
    refreshTip();
    followFrame = requestAnimationFrame(followPictures);
}

/** Puts the buttons next to the shown pictures and shows the right ones for each picture's state. */
function refresh() {
    const shown = new Set(current.filter(img => img.isConnected));
    if (active && !active.result.closed && active.img.isConnected) shown.add(active.img);

    for (const [img, p] of plates) {
        if (!shown.has(img)) {
            p.holder.remove();
            plates.delete(img);
        }
    }

    for (const img of shown) {
        let p = plates.get(img);
        if (!p) {
            p = makePlate(img);
            plates.set(img, p);
        }
        if (!p.holder.isConnected) document.body.append(p.holder);
        place(img, p);
    }
    if (plates.size && !followFrame) followFrame = requestAnimationFrame(followPictures);
}

function place(img: HTMLImageElement, p: Plate) {
    const h = p.holder;
    const translated = !!active && active.img === img && !active.result.closed;
    p.copy.style.display = translated ? "" : "none";
    p.swap.style.display = translated ? "" : "none";
    p.translate.classList.toggle(cl("plate-button-active"), translated);
    p.translate.disabled = busy === img;
    setTip(p.translate, translated ? t("tipImageClose") : t("tipImageTranslate"));
    setTip(p.swap, translated && active!.result.showingOriginal() ? t("menuShowTranslation") : t("menuShowOriginal"));
    setTip(p.copy, translated && active!.result.showingOriginal() ? t("menuCopyOriginal") : t("menuCopyTranslation"));

    // the large view gets a solid plate with a light outline, so it is seen on any background
    const inChat = !!img.closest('[id^="chat-messages-"]');
    h.classList.toggle(cl("image-plate-large"), !inChat);

    const r = img.getBoundingClientRect();
    const width = h.getBoundingClientRect().width;
    // room to the right of the picture: up to the edge of the chat, or of the window in the large view
    const edge = inChat
        ? (img.closest('[class*="scroller"]')?.getBoundingClientRect().right ?? window.innerWidth)
        : window.innerWidth;

    if (r.right + GAP + width <= edge - 4) {
        // to the right, along the top edge (anchored by the left edge, so translate keeps its place)
        Object.assign(h.style, { left: `${Math.round(r.right + GAP)}px`, right: "", top: `${Math.round(Math.max(r.top, 0))}px` });
    } else {
        // no room: above the right corner of the picture
        Object.assign(h.style, {
            left: `${Math.round(Math.max(4, r.right - width))}px`,
            right: "",
            top: `${Math.round(Math.max(4, r.top - GAP - h.getBoundingClientRect().height))}px`
        });
    }
}

async function onTranslate(img: HTMLImageElement) {
    if (active && active.img === img && !active.result.closed) {
        active.result.close("translate button");
        return;
    }
    if (busy) return;

    busy = img;
    refresh();
    try {
        // a failure is told in the middle of the picture (the mouse may have left the button by then)
        const done = await translateImage(img);
        if (done) {
            active?.result.close("another picture translated");
            active = done;
            // on a small picture with small text the translation may be on the large view: the buttons go there too
            if (done.img !== img) current = [done.img];
            done.result.onClose(() => {
                if (active === done) active = null;
                refresh();
            });
        }
    } finally {
        busy = null;
        refresh();
    }
}

async function onCopy() {
    if (!active) return;
    try {
        await navigator.clipboard.writeText(active.result.shownText());
        const p = plates.get(active.img);
        if (p) flashTip(p.copy, t("copied"));
    } catch (e) {
        console.error("[TranslatePerChat] copying failed", e);
    }
}

function show(imgs: HTMLImageElement[]) {
    window.clearTimeout(hideTimer);
    if (imgs.length !== current.length || imgs.some((img, i) => img !== current[i])) current = imgs;
    refresh();
}

function hide() {
    window.clearTimeout(hideTimer);
    // a picture with a translation on it keeps its buttons (they close the translation)
    current = [];
    refresh();
}

function scheduleHide() {
    window.clearTimeout(hideTimer);
    hideTimer = window.setTimeout(hide, HIDE_DELAY_MS);
}

/** The pictures of the large view, if it is open. */
function largeViewPictures(): HTMLImageElement[] {
    return [...document.querySelectorAll('[class*="mediaViewer"] img, [class*="carousel"] img, [class*="imageModal"] img')]
        .filter(isTranslatable)
        .filter(img => !img.closest('[id^="chat-messages-"]'));
}

function onMouseMove(e: MouseEvent) {
    if (frame) return;
    const { clientX: x, clientY: y } = e;
    // checked once per screen refresh at most
    frame = requestAnimationFrame(() => {
        frame = 0;
        const under = document.elementFromPoint(x, y);
        if ([...plates.values()].some(p => p.holder.contains(under))) return;

        // the large view is open: its picture keeps its buttons the whole time
        const large = largeViewPictures();
        if (large.length) {
            show(large);
            return;
        }

        // the mouse is anywhere on a message: the buttons of all its pictures
        const row = under?.closest('[id^="chat-messages-"]');
        let imgs = row ? withoutHidden([...row.querySelectorAll("img")].filter(isTranslatable)) : [];
        // a large picture somewhere else (a view this plugin does not know): its buttons while the mouse is on it
        if (!imgs.length) imgs = document.elementsFromPoint(x, y).filter(isTranslatable).slice(0, 1);
        if (imgs.length) show(imgs);
        else if (current.length) scheduleHide();
    });
}

/** Scrolling moves the pictures away from under the buttons: they follow (or go, when the mouse left the message). */
const onScroll = () => {
    window.clearTimeout(hideTimer);
    current = [];
    refresh();
};

/* ---------- the shortcuts work on the translated picture too ---------- */

export const hasActivePicture = () => !!active && !active.result.closed;

/** Alt+C: original <-> translation on the translated picture. */
export function toggleActivePicture() {
    if (!hasActivePicture()) return false;
    active!.result.toggle();
    refresh();
    return true;
}

/** Alt+X: the translation of the picture is closed (pictures are not part of a chat translating itself). */
export function closeActivePicture() {
    if (!hasActivePicture()) return false;
    active!.result.close("Alt+X");
    return true;
}

let peekFlipped = false;
/** Held Alt: the original is shown on the picture while it is held. */
export function peekActivePicture(on: boolean) {
    if (on) {
        if (hasActivePicture() && !active!.result.showingOriginal()) {
            active!.result.toggle();
            peekFlipped = true;
        }
    } else if (peekFlipped) {
        peekFlipped = false;
        if (hasActivePicture() && active!.result.showingOriginal()) active!.result.toggle();
    }
}

/* ---------- picking a picture by selecting an area: the same as pressing its button ---------- */

let unregisterPicks: (() => void) | undefined;

/** The picture the selected area is mostly on (or that is mostly inside the area): translated like the button does. */
function findPicturePicks(area: PickRect): Pick[] {
    const areaSize = (area.right - area.left) * (area.bottom - area.top);
    const all = [...document.querySelectorAll('[id^="chat-messages-"] img')].filter(isTranslatable);
    const imgs = withoutHidden([...all, ...largeViewPictures()]);

    let best: HTMLImageElement | null = null;
    let bestShare = 0;
    for (const img of imgs) {
        const r = img.getBoundingClientRect();
        const common = overlapArea(area, r);
        if (!common) continue;
        // at least half of the smaller one lies on the other
        const share = common / Math.max(1, Math.min(areaSize, r.width * r.height));
        if (share >= 0.5 && share > bestShare) {
            best = img;
            bestShare = share;
        }
    }
    if (!best) return [];

    const img = best;
    return [{
        run: () => {
            // already translated: nothing to do (the cross on its buttons removes the translation)
            if (active && active.img === img && !active.result.closed) return;
            return onTranslate(img);
        }
    }];
}

export function startImageButtons() {
    unregisterPicks?.();
    unregisterPicks = registerPickFinder(findPicturePicks);
    document.addEventListener("mousemove", onMouseMove, true);
    document.addEventListener("wheel", onScroll, { capture: true, passive: true });
}

export function stopImageButtons() {
    unregisterPicks?.();
    unregisterPicks = undefined;
    document.removeEventListener("mousemove", onMouseMove, true);
    document.removeEventListener("wheel", onScroll, true);
    cancelAnimationFrame(frame);
    frame = 0;
    active?.result.close("plugin stopped");
    active = null;
    current = [];
    refresh();
}
