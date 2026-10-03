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

import { useEffect } from "@webpack/common";

import { settings } from "./settings";
import { TEXTS, TextKey } from "./texts";
import { getLanguages, translate } from "./utils";

export type { TextKey };

/**
 * Language of the Discord interface, as the translator knows it ("ru", "en", "uk", ...). Russian and English texts are written
 * by hand; for any other language the English texts are translated once by the translator and remembered.
 */
export function uiLanguage(): string {
    try {
        const raw = (document.documentElement.lang || navigator.language || "en").toLowerCase();
        const primary = raw.split("-")[0];
        if (primary === "ru" || primary === "en") return primary;

        const codes = Object.keys(getLanguages());
        return codes.find(c => c.toLowerCase() === raw) ?? codes.find(c => c.toLowerCase() === primary) ?? "en";
    } catch {
        // settings are not available yet
        return "en";
    }
}

/** The text in the language of Discord (English until the translation of a rarer language is ready). {name} places are filled from `vars`. */
export function t(key: TextKey, vars?: Record<string, string | number>): string {
    const lang = uiLanguage();
    const base = TEXTS[key];
    let text: string = base.en;

    if (lang === "ru") text = base.ru;
    else if (lang !== "en") {
        try {
            const saved = settings.store.uiTranslations?.[lang]?.[key];
            // a saved translation only counts if the English text it was made from has not changed since
            if (saved && saved.s === base.en) text = saved.t;
        } catch {
            // settings are not available yet
        }
    }

    return vars ? text.replace(/\{(\w+)\}/g, (whole, name) => name in vars ? String(vars[name]) : whole) : text;
}

const places = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join();
const inProgress = new Set<string>();

/** Translates the texts that have no up-to-date translation yet, and remembers the result. */
async function ensureUiTranslations(lang: string) {
    if (lang === "ru" || lang === "en" || inProgress.has(lang)) return;

    const saved = settings.store.uiTranslations?.[lang] ?? {};
    const missing = Object.entries(TEXTS).filter(([key, text]) => saved[key]?.s !== text.en);
    if (!missing.length) return;

    inProgress.add(lang);
    let done: Record<string, { s: string; t: string; }> = {};

    const save = () => {
        if (!Object.keys(done).length) return;
        // a plain copy of what is stored: the stored objects are live views, and Vencord cannot save those to disk
        const stored = JSON.parse(JSON.stringify(settings.store.uiTranslations ?? {}));
        settings.store.uiTranslations = { ...stored, [lang]: { ...stored[lang], ...done } };
        done = {};
    };

    try {
        for (const [key, text] of missing) {
            // the language was changed while we were working, stop
            if (uiLanguage() !== lang) break;
            const translated = (await translate("received", text.en, true, lang, "en")).text;
            // the translator may spoil the {places}: then the English text stays
            done[key] = { s: text.en, t: places(translated) === places(text.en) ? translated : text.en };
            if (Object.keys(done).length >= 20) save();
        }
    } catch {
        // keep showing English for the rest, we will try again after the next restart
    } finally {
        inProgress.delete(lang);
        if (uiLanguage() === lang) save();
    }
}

/** Called when the plugin starts: prepares the translations for the language of Discord. */
export function startI18n() {
    void ensureUiTranslations(uiLanguage());
}

/** Use inside components: gives the text function and draws the component again when new translations arrive. */
export function useT() {
    settings.use(["uiTranslations"]);
    useEffect(() => {
        void ensureUiTranslations(uiLanguage());
    }, []);
    return t;
}
