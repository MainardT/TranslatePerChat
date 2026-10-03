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

import "./styles.css";

import { findGroupChildrenByChildId, NavContextMenuPatchCallback } from "@api/ContextMenu";
import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";
import { Message } from "@vencord/discord-types";
import { Menu } from "@webpack/common";

import { notify } from "./Notify";
import { FileTranslateButtons, startFilePicks, stopFilePicks } from "./FileTranslate";
import { CopyIcon, MessageButtons, SwapIcon } from "./MessageButtons";
import { startAutoRead, stopAutoRead } from "./AutoRead";
import { startReadOnlyBar, stopReadOnlyBar } from "./ReadOnlyBar";
import { translateKeepingEmoticons } from "./Emoticons";
import { noteSent, onBeforeEdit, startEditOriginals, stopEditOriginals } from "./EditOriginals";
import { startHotkeys, stopHotkeys } from "./Hotkeys";
import { startImageButtons, stopImageButtons } from "./ImageButtons";
import { startI18n, t } from "./i18n";
import { getChatTargetLanguage, shouldAutoTranslate } from "./overrides";
import { startPanelNotices, stopPanelNotices } from "./Notices";
import { messageState, messageTranslation, restoreAll, toggleMessage, translateMessage } from "./PageReplace";
import { settings } from "./settings";
import { setShouldShowTranslateEnabledTooltip, TranslateChatBarButtons, TranslateIcon } from "./TranslateIcon";
import { handleTranslate, TranslationAccessory } from "./TranslationAccessory";
import { getLanguages, translate } from "./utils";

const messageCtxPatch: NavContextMenuPatchCallback = (children, { message }: { message: Message; }) => {
    const group = findGroupChildrenByChildId("copy-text", children);
    if (!group) return;

    // a message whose text was swapped for its translation (screen translation): switch it back and forth, copy the translation
    const row = document.getElementById(`chat-messages-${message.channel_id}-${message.id}`);
    const state = messageState(row);
    if (row && state) {
        group.splice(group.findIndex(c => c?.props?.id === "copy-text") + 1, 0,
            <Menu.MenuItem
                id="vc-trans-toggle"
                label={state === "translation" ? t("menuShowOriginal") : t("menuShowTranslation")}
                icon={SwapIcon}
                leadingAccessory={{ type: "icon", icon: SwapIcon }}
                action={() => toggleMessage(row)}
            />,
            <Menu.MenuItem
                id="vc-trans-copy"
                label={t("menuCopyTranslation")}
                icon={CopyIcon}
                leadingAccessory={{ type: "icon", icon: CopyIcon }}
                action={async () => {
                    try {
                        await navigator.clipboard.writeText(messageTranslation(row));
                        notify(t("translationCopied"), "success");
                    } catch (e) {
                        console.error("[TranslatePerChat] copying the translation failed", e);
                    }
                }}
            />
        );
    }

    const content = getMessageContent(message);
    if (!content) return;

    group.splice(group.findIndex(c => c?.props?.id === "copy-text") + 1, 0, (
        <Menu.MenuItem
            id="vc-trans"
            label={t("tipTranslate")}
            icon={TranslateIcon}
            leadingAccessory={{ type: "icon", icon: TranslateIcon }}
            action={() => translateInPlace(message, content)}
        />
    ));
};


/**
 * Translates a message right where it is (its text is swapped for the translation).
 * If the message is not on screen, the translation is shown under it the old way.
 */
export async function translateInPlace(message: Message, content: string) {
    const row = document.getElementById(`chat-messages-${message.channel_id}-${message.id}`);
    if (row && await translateMessage(row)) return;
    if (!content) return;
    const trans = await translate("received", content);
    handleTranslate(message.id, trans);
}

function getMessageContent(message: Message) {
    // Message snapshots is an array, which allows for nested snapshots, which Discord does not do yet.
    // no point collecting content or rewriting this to render in a certain way that makes sense
    // for something currently impossible.
    return message.content
        || message.messageSnapshots?.[0]?.message.content
        || message.embeds?.find(embed => embed.type === "auto_moderation_message")?.rawDescription || "";
}

let tooltipTimeout: any;

/**
 * Once: the language chats are translated to is the language of Discord (if it is still the plugin's default and the translator knows it).
 */
function applyDiscordLanguage() {
    if (settings.store.discordLanguageApplied) return;
    settings.store.discordLanguageApplied = true;

    const def = settings.store.service.startsWith("deepl") && !IS_WEB ? "en-us" : "en";
    if (settings.store.receivedOutput !== def) return;

    const lang = (document.documentElement.lang || navigator.language || "").toLowerCase();
    const codes = Object.keys(getLanguages());
    const found = codes.find(c => c.toLowerCase() === lang) ?? codes.find(c => c.toLowerCase() === lang.split("-")[0]);
    if (found) settings.store.receivedOutput = found;
}

export default definePlugin({
    name: "TranslatePerChat",
    description: "Translate with per-chat auto-translate and a translate button at the start of every message. Based on the built-in Translate plugin (turn that one off).",
    tags: ["Chat", "Utility"],
    authors: [Devs.Ven, Devs.AshtonMemer, Devs.koish1, { name: "Mainard", id: 0n }],
    settings,
    contextMenus: {
        "message": messageCtxPatch
    },
    // not used, just here in case some other plugin wants it or w/e
    translate,

    start() {
        applyDiscordLanguage();
        startI18n();
        startPanelNotices();
        startHotkeys();
        startImageButtons();
        startFilePicks();
        startAutoRead();
        startEditOriginals();
        startReadOnlyBar();
    },

    stop() {
        stopHotkeys();
        stopImageButtons();
        stopFilePicks();
        stopAutoRead();
        stopEditOriginals();
        stopReadOnlyBar();
        stopPanelNotices();
        restoreAll();
    },

    renderMessageAccessory: props => (
        <>
            <TranslationAccessory message={props.message} />
            <MessageButtons message={props.message} />
            <FileTranslateButtons message={props.message} />
        </>
    ),

    chatBarButton: {
        icon: TranslateIcon,
        render: TranslateChatBarButtons
    },

    async onBeforeMessageSend(channelId, message) {
        if (!shouldAutoTranslate(channelId)) return;
        if (!message.content) return;

        setShouldShowTranslateEnabledTooltip?.(true);
        clearTimeout(tooltipTimeout);
        tooltipTimeout = setTimeout(() => setShouldShowTranslateEnabledTooltip?.(false), 2000);

        const original = message.content;
        // smileys like "=)" stay as written, so Discord turns them into emoji by its own rules
        const trans = await translateKeepingEmoticons("sent", original, false, getChatTargetLanguage(channelId));
        message.content = trans.text;
        noteSent(channelId, original, trans.text);
    },

    onBeforeMessageEdit: onBeforeEdit
});
