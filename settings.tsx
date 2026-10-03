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

import { definePluginSettings } from "@api/Settings";
import { OptionType } from "@utils/types";
import { SelectedChannelStore } from "@webpack/common";

import { FullSettings } from "./SettingsPanel";

export const settings = definePluginSettings({
    receivedInput: {
        type: OptionType.STRING,
        description: "Language incoming messages are translated from",
        default: "auto",
        hidden: true
    },
    receivedOutput: {
        type: OptionType.STRING,
        description: "Language incoming messages are translated to",
        default: "en",
        hidden: true
    },
    sentInput: {
        type: OptionType.STRING,
        description: "Language your messages are translated from",
        default: "auto",
        hidden: true
    },
    sentOutput: {
        type: OptionType.STRING,
        description: "Language your messages are translated to",
        default: "en",
        hidden: true
    },
    service: {
        type: OptionType.SELECT,
        description: IS_WEB ? "Translation provider (not available on web)" : "Translation provider",
        hidden: true,
        options: [
            { label: "Google Translate", value: "google", default: true },
            { label: "DeepL Free — API key required", value: "deepl" },
            { label: "DeepL Pro — API key required", value: "deepl-pro" },
            { label: "Kagi Translate — API key required", value: "kagi" }
        ] as const,
        onChange: resetLanguageDefaults
    },
    deeplApiKey: {
        type: OptionType.STRING,
        displayName: "DeepL API Key",
        description: "Your DeepL API key (from deepl.com/your-account)",
        default: "",
        hidden: true
    },
    kagiSession: {
        type: OptionType.STRING,
        description: "Your Kagi session token (from kagi.com/settings?p=user_details)",
        default: "",
        hidden: true
    },
    autoTranslate: {
        type: OptionType.BOOLEAN,
        description: "Translate incoming messages automatically in the chats where it is turned on",
        default: false,
        hidden: true
    },
    channelOverrides: {
        type: OptionType.CUSTOM,
        default: {} as Record<string, "on" | "off">,
        hidden: true
    },
    guildOverrides: {
        type: OptionType.CUSTOM,
        default: {} as Record<string, "on" | "off">,
        hidden: true
    },
    chatLanguages: {
        type: OptionType.CUSTOM,
        default: {} as Record<string, string>,
        hidden: true
    },
    guildLanguages: {
        type: OptionType.CUSTOM,
        default: {} as Record<string, string>,
        hidden: true
    },
    /** Chats that translate their messages by themselves (the switch in the chat button's window). */
    autoReadChats: {
        type: OptionType.CUSTOM,
        default: {} as Record<string, boolean>,
        hidden: true
    },
    /** Chats where you turned off «Show originals of my messages» (on by default while your messages are translated). */
    ownOriginalsOff: {
        type: OptionType.CUSTOM,
        default: {} as Record<string, boolean>,
        hidden: true
    },
    /** Remember what you wrote in translated messages, to edit them in your own language. */
    editRemember: {
        type: OptionType.BOOLEAN,
        description: "Remember what you wrote in translated messages, to edit them in your language",
        default: true,
        hidden: true
    },
    editBackTranslate: {
        type: OptionType.BOOLEAN,
        description: "Editing a translated message with nothing remembered: translate it back into your language",
        default: true,
        hidden: true
    },
    autoReadOwnDelay: {
        type: OptionType.SLIDER,
        description: "Chats that translate themselves: how many seconds your freshly sent message stays as sent before it is translated back for you",
        markers: [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 5],
        default: 1.5,
        stickToMarkers: true,
        hidden: true
    },
    autoReadEnterDelay: {
        type: OptionType.SLIDER,
        description: "Chats that translate themselves: how many seconds to wait after entering a chat before translating it",
        markers: [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 5],
        default: 2,
        stickToMarkers: true,
        hidden: true
    },
    translationCacheSize: {
        type: OptionType.SLIDER,
        description: "How many translated texts are remembered, so messages seen again appear at once",
        markers: [200, 500, 1000, 1500, 2000, 2500, 3000, 3500, 4000, 5000],
        default: 1000,
        stickToMarkers: true,
        hidden: true
    },
    sentBufferSize: {
        type: OptionType.SLIDER,
        description: "How many of your sent messages are remembered (for editing)",
        markers: [100, 200, 300, 500, 750, 1000, 1250, 1500, 1750, 2000],
        default: 500,
        stickToMarkers: true,
        hidden: true
    },
    autoReadAhead: {
        type: OptionType.SLIDER,
        description: "Chats that translate themselves: how many messages beyond the screen are translated",
        markers: [0, 1, 2, 3, 4, 5, 6, 7, 8, 10],
        default: 3,
        stickToMarkers: true,
        hidden: true
    },
    autoReadIdle: {
        type: OptionType.SLIDER,
        description: "Minutes without mouse or keyboard after which auto-translating pauses",
        markers: [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.25, 2.5],
        default: 2,
        stickToMarkers: true,
        hidden: true
    },
    autoReadHiddenDelay: {
        type: OptionType.SLIDER,
        description: "Seconds after Discord is minimized when auto-translating pauses",
        markers: [0, 5, 10, 15, 20, 25, 30, 40, 50, 60],
        default: 0,
        stickToMarkers: true,
        hidden: true
    },
    showReplacedTips: {
        type: OptionType.BOOLEAN,
        description: "Show tips on translated messages (the hint that appears when the mouse rests on translated text)",
        default: true,
        hidden: true
    },
    /** Keys of the shortcuts (Alt + key), only those changed from the defaults. */
    hotkeys: {
        type: OptionType.CUSTOM,
        default: {} as Record<string, string>,
        hidden: true
    },
    gutterBoldness: {
        type: OptionType.SLIDER,
        description: "Boldness of the translated text in the gutter line",
        markers: [0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2],
        default: 0.5,
        stickToMarkers: true,
        hidden: true
    },
    imageMinTextPx: {
        type: OptionType.NUMBER,
        description: "Picture translation: if the text on a small picture in the chat would be lower than this (in pixels), the picture opens large and the translation is shown there. 0 = never",
        default: 10,
        hidden: true
    },
    screenMinFontSize: {
        type: OptionType.SLIDER,
        description: "Smallest font size of the translation on translated pictures",
        markers: [8, 9, 10, 11, 12, 13, 14, 15, 16, 18],
        default: 11,
        stickToMarkers: true,
        hidden: true
    },
    showAutoTranslateTooltip: {
        type: OptionType.BOOLEAN,
        description: "Show a tooltip on the chat bar button when a message is auto-translated",
        default: true,
        hidden: true
    },
    /** All settings of the plugin, grouped (our own block: sections, Russian texts, descriptions that open). */
    panel: {
        type: OptionType.COMPONENT,
        component: () => <FullSettings channelId={SelectedChannelStore.getChannelId() ?? undefined} />
    }
}).withPrivateSettings<{
    dismissedAutoTranslateAlert?: boolean;
    /** The «translate chat to» language was set from the Discord language once. */
    discordLanguageApplied?: boolean;
    /** Our texts translated into other languages, saved so they work offline and load instantly next time. */
    uiTranslations?: Record<string, Record<string, { s: string; t: string; }>>;
}>();

export function resetLanguageDefaults() {
    // language codes differ between services, so languages chosen for single chats and servers would no longer fit
    settings.store.chatLanguages = {};
    settings.store.guildLanguages = {};

    if (IS_WEB || settings.store.service === "google" || settings.store.service === "kagi") {
        settings.store.receivedInput = "auto";
        settings.store.receivedOutput = "en";
        settings.store.sentInput = "auto";
        settings.store.sentOutput = "en";
    } else {
        settings.store.receivedInput = "";
        settings.store.receivedOutput = "en-us";
        settings.store.sentInput = "";
        settings.store.sentOutput = "en-us";
    }
}
