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

import { classNameFactory } from "@utils/css";
import { onlyOnce } from "@utils/onlyOnce";
import { PluginNative } from "@utils/types";

import { notify } from "./Notify";
import { DeeplLanguages, deeplLanguageToGoogleLanguage, GoogleLanguages, KagiLanguages } from "./languages";
import { resetLanguageDefaults, settings } from "./settings";
import { t } from "./i18n";

export const cl = classNameFactory("vc-trans-");

const Native = VencordNative.pluginHelpers.TranslatePerChat as PluginNative<typeof import("./native")>;

interface GoogleData {
    translation: string;
    sourceLanguage: string;
}

interface DeeplData {
    translations: {
        detected_source_language: string;
        text: string;
    }[];
}

interface KagiData {
    translation: string;
    detected_language: {
        label: string;
    };
}

export interface TranslationValue {
    sourceLanguage: string;
    text: string;
}

export const getLanguages = () => {
    if (IS_WEB) {
        return GoogleLanguages;
    }
    switch (settings.store.service) {
        case "google":
            return GoogleLanguages;
        case "kagi":
            return KagiLanguages;
        default:
            return DeeplLanguages;
    }
};

/* ---------- the translator not answering ---------- */

/** After a failure the translator is not asked until this moment (so a limit is not made worse); a success clears it. */
let blockedUntil = 0;
let failures = 0;
let lastNotice = 0;
let noticeShown = false;
const NOTICE_EVERY_MS = 60_000;

/** True while requests are paused after a failure. */
export const translatorBlocked = () => Date.now() < blockedUntil;
/** True from a failure until the next success. */
export const translatorDown = () => failures > 0;

/** Failures worth a pause: the limit (429), the server's trouble (5xx), no connection. A bad single text is not one. */
const isOutage = (e: unknown) => {
    const status = (e as any)?.status;
    return status === undefined ? !(typeof e === "string") : status === 429 || status >= 500;
};

function noteOutage() {
    failures++;
    blockedUntil = Date.now() + Math.min(5000 * 2 ** (failures - 1), 60_000);
    if (Date.now() - lastNotice > NOTICE_EVERY_MS) {
        lastNotice = Date.now();
        noticeShown = true;
        notify(t("translatorDown"), "error");
    }
}

function noteWorking() {
    if (!failures) return;
    failures = 0;
    blockedUntil = 0;
    if (noticeShown) {
        noticeShown = false;
        notify(t("translatorUp"), "success");
    }
}

export async function translate(kind: "received" | "sent", text: string, silent = false, targetLang?: string, sourceLang?: string): Promise<TranslationValue> {
    const translate = IS_WEB ? googleTranslate : (() => {
        switch (settings.store.service) {
            case "google":
                return googleTranslate;
            case "kagi":
                return kagiTranslate;
            default:
                return deeplTranslate;
        }
    })();

    // paused after a failure: no request at all (it would only make a limit worse)
    if (translatorBlocked()) throw new Error("Translator paused after a failure");

    try {
        const result = await translate(
            text,
            sourceLang || settings.store[`${kind}Input`],
            targetLang || settings.store[`${kind}Output`]
        );
        noteWorking();
        return result;
    } catch (e) {
        const outage = isOutage(e);
        if (outage) noteOutage();
        const userMessage = typeof e === "string"
            ? e
            : "Something went wrong. If this issue persists, please check the console or ask for help in the support server.";

        // a single failed text says its reason; when the translator is down altogether, the notice above says it once
        if (!silent && !outage) notify(t("translatorFailed", { reason: userMessage }), "error");

        throw e instanceof Error
            ? e
            : new Error(userMessage);
    }
}

async function googleTranslate(text: string, sourceLang: string, targetLang: string): Promise<TranslationValue> {
    const url = "https://translate-pa.googleapis.com/v1/translate?" + new URLSearchParams({
        "params.client": "gtx",
        "dataTypes": "TRANSLATION",
        "key": "AIzaSyDLEeFI5OtFBwYBIoK_jj5m32rZK5CkCXA", // some google API key
        "query.sourceLanguage": sourceLang,
        "query.targetLanguage": targetLang,
        "query.text": text,
    });

    const res = await fetch(url);
    if (!res.ok)
        throw Object.assign(new Error(
            `Failed to translate "${text}" (${sourceLang} -> ${targetLang})`
            + `\n${res.status} ${res.statusText}`
        ), { status: res.status });

    const { sourceLanguage, translation }: GoogleData = await res.json();

    return {
        sourceLanguage: GoogleLanguages[sourceLanguage] ?? sourceLanguage,
        text: translation
    };
}

function fallbackToGoogle(text: string, sourceLang: string, targetLang: string): Promise<TranslationValue> {
    return googleTranslate(
        text,
        deeplLanguageToGoogleLanguage(sourceLang),
        deeplLanguageToGoogleLanguage(targetLang)
    );
}

const showDeeplApiQuotaToast = onlyOnce(
    () => notify(t("deeplLimit"), "error")
);

async function deeplTranslate(text: string, sourceLang: string, targetLang: string): Promise<TranslationValue> {
    if (!settings.store.deeplApiKey) {
        notify(t("deeplNoKey"), "error");

        settings.store.service = "google";
        resetLanguageDefaults();

        return fallbackToGoogle(text, sourceLang, targetLang);
    }

    // CORS jumpscare
    const { status, data } = await Native.makeDeeplTranslateRequest(
        settings.store.service === "deepl-pro",
        settings.store.deeplApiKey,
        JSON.stringify({
            text: [text],
            target_lang: targetLang,
            source_lang: sourceLang.split("-")[0]
        })
    );

    switch (status) {
        case 200:
            break;
        case -1:
            throw "Failed to connect to DeepL API: " + data;
        case 403:
            throw "Invalid DeepL API key or version";
        case 456:
            showDeeplApiQuotaToast();
            return fallbackToGoogle(text, sourceLang, targetLang);
        default:
            throw new Error(`Failed to translate "${text}" (${sourceLang} -> ${targetLang})\n${status} ${data}`);
    }

    const { translations }: DeeplData = JSON.parse(data);
    const src = translations[0].detected_source_language;

    return {
        sourceLanguage: DeeplLanguages[src] ?? src,
        text: translations[0].text
    };
}

async function kagiTranslate(text: string, sourceLang: string, targetLang: string): Promise<TranslationValue> {
    const { status, data } = await Native.makeKagiTranslateRequest(
        settings.store.kagiSession, text, sourceLang, targetLang
    );

    switch (status) {
        case 200:
            break;
        case 401:
            throw "Invalid or expired Kagi session token";
        default:
            throw new Error(`Failed to translate "${text}" (${sourceLang} -> ${targetLang})\n${status} ${data}`);
    }

    const { detected_language, translation }: KagiData = data;

    return {
        sourceLanguage: detected_language.label,
        text: translation
    };
}
