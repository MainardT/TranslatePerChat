import { ChannelStore } from "@webpack/common";

import { settings } from "./settings";

export type ChatMode = "on" | "off";

/** Личная настройка чата, если она есть. Для веток, если своей настройки нет, берётся настройка родительского канала. */
export function getChatOverride(channelId: string): ChatMode | undefined {
    const overrides = settings.store.channelOverrides;
    const own = overrides[channelId];
    if (own) return own;

    const parentId = ChannelStore.getChannel(channelId)?.parent_id;
    return parentId ? overrides[parentId] : undefined;
}

export function getGuildId(channelId: string): string | undefined {
    return ChannelStore.getChannel(channelId)?.guild_id || undefined;
}

/** Настройка сервера целиком, если она есть. */
export function getServerOverride(guildId: string | undefined): ChatMode | undefined {
    return guildId ? settings.store.guildOverrides[guildId] : undefined;
}

/**
 * Итоговое решение: переводить ли мои сообщения в этом чате.
 * Порядок: личная настройка чата, затем настройка сервера; иначе не переводить.
 */
export function shouldAutoTranslate(channelId: string): boolean {
    const own = getChatOverride(channelId);
    if (own) return own === "on";

    return getServerOverride(getGuildId(channelId)) === "on";
}

/** mode = undefined возвращает чат к настройке сервера (или к общей). */
export function setChatOverride(channelId: string, mode: ChatMode | undefined) {
    const next = { ...settings.store.channelOverrides };
    if (mode) next[channelId] = mode;
    else delete next[channelId];
    settings.store.channelOverrides = next;
}

/** Включает или выключает перевод сразу во всех чатах сервера: личные настройки чатов этого сервера сбрасываются. */
export function setServerOverride(guildId: string, mode: ChatMode) {
    const chats = { ...settings.store.channelOverrides };
    for (const channelId of Object.keys(chats)) {
        if (ChannelStore.getChannel(channelId)?.guild_id === guildId)
            delete chats[channelId];
    }

    settings.store.channelOverrides = chats;
    settings.store.guildOverrides = { ...settings.store.guildOverrides, [guildId]: mode };
}

/** Language your messages are translated to in this chat: the chat's own, else the server's, else the general one. */
export function getChatTargetLanguage(channelId: string): string {
    const chats = settings.store.chatLanguages;
    const parentId = ChannelStore.getChannel(channelId)?.parent_id;

    return chats[channelId]
        || (parentId ? chats[parentId] : undefined)
        || getServerTargetLanguage(getGuildId(channelId))
        || settings.store.sentOutput;
}

/** Language your messages are translated to on this server (the general one if the server has none of its own). */
export function getServerTargetLanguage(guildId: string | undefined): string {
    return (guildId && settings.store.guildLanguages[guildId]) || settings.store.sentOutput;
}

export function setChatLanguage(channelId: string, language: string) {
    settings.store.chatLanguages = { ...settings.store.chatLanguages, [channelId]: language };
}

/** Sets the language for the whole server: languages chosen for single chats of this server are reset. */
export function setServerLanguage(guildId: string, language: string) {
    const chats = { ...settings.store.chatLanguages };
    for (const channelId of Object.keys(chats)) {
        if (ChannelStore.getChannel(channelId)?.guild_id === guildId)
            delete chats[channelId];
    }

    settings.store.chatLanguages = chats;
    settings.store.guildLanguages = { ...settings.store.guildLanguages, [guildId]: language };
}
