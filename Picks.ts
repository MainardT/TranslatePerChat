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
 * The list of things that can be translated by selecting an area (the picker button).
 * Every kind of thing (pictures, files, ...) registers a finder: given the selected area, it tells what it found there
 * and how to translate it - the same way its own button does. A new kind of thing only has to register here
 * and the area selection works with it at once.
 */

export interface PickRect {
    left: number;
    top: number;
    right: number;
    bottom: number;
}

export interface Pick {
    /** Does the same as the button of this kind of thing. `notice` tells the user a short message (a failure) on the selected area. */
    run(notice: (message: string) => void): void | Promise<void>;
}

export type PickFinder = (area: PickRect) => Pick[];

const finders = new Set<PickFinder>();

/** Gives back the function that removes the finder again. */
export function registerPickFinder(finder: PickFinder): () => void {
    finders.add(finder);
    return () => { finders.delete(finder); };
}

export function findPicks(area: PickRect): Pick[] {
    const out: Pick[] = [];
    for (const finder of finders) {
        try {
            out.push(...finder(area));
        } catch (e) {
            console.error("[TranslatePerChat] looking for things to translate failed", e);
        }
    }
    return out;
}

/** The size of the shared part of two rectangles (0 when they do not touch). */
export function overlapArea(a: PickRect, b: PickRect): number {
    const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
    const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
    return w > 0 && h > 0 ? w * h : 0;
}
