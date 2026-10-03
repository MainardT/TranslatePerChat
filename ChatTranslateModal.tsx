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
 * The small window above the chat button: only what is used often. Everything else is in the full settings ("All settings").
 */

import { Button } from "@components/Button";
import { useEffect, useLayoutEffect, useRef } from "@webpack/common";

import { isAutoRead, refreshChat, setAutoRead, setShowOwnOriginals, showsOwnOriginals } from "./AutoRead";
import { setPanelAway } from "./PageReplace";
import { getChatTargetLanguage, setChatLanguage, setChatOverride, shouldAutoTranslate } from "./overrides";
import { settings } from "./settings";
import { chatName, LanguageMenu, openFullSettings, Toggle, useExpand } from "./SettingsPanel";
import { cl } from "./utils";
import { t, useT } from "./i18n";

export function ChatTranslatePanel({ channelId, close, readOnly }: { channelId: string; close?(): void; readOnly?: boolean; }) {
    const t = useT();
    // drawn again whenever any of the involved settings change
    const { receivedInput, receivedOutput, sentInput } = settings.use([
        "autoReadChats", "channelOverrides", "guildOverrides", "chatLanguages", "guildLanguages", "ownOriginalsOff",
        "sentInput", "sentOutput", "receivedInput", "receivedOutput"
    ]);
    const ex = useExpand();
    const sending = shouldAutoTranslate(channelId);

    // the height is fixed when the window opens (at most 70% of the screen): opening a description or a list
    // scrolls inside it instead of making the window grow and jump
    const root = useRef<HTMLDivElement>(null);
    // the panel in the corner steps aside while this window is open
    useEffect(() => {
        setPanelAway(true);
        return () => setPanelAway(false);
    }, []);
    useLayoutEffect(() => {
        const el = root.current;
        if (!el) return;
        el.style.maxHeight = `${Math.round(window.innerHeight * 0.7)}px`;
        // a moment later, once the descriptions have closed to their short size
        const timer = setTimeout(() => {
            el.style.height = `${Math.min(el.getBoundingClientRect().height, window.innerHeight * 0.7)}px`;
        }, 80);
        return () => clearTimeout(timer);
    }, []);

    return (
        <div ref={root} className={cl("popout")}>
            <div className={cl("popout-head")}>{chatName(channelId) || t("modalFallbackTitle")}</div>

            <div className={cl("group-title")}>{t("incoming")}</div>
            <Toggle
                ex={ex} id="autoRead"
                title={t("autoRead")}
                text={t("autoReadDesc")}
                detail={t("autoReadMore")}
                value={isAutoRead(channelId)}
                onChange={v => setAutoRead(channelId, v)}
            />
            <LanguageMenu
                label={t("chatLanguage")}
                value={receivedInput}
                includeAuto
                onChange={language => {
                    settings.store.receivedInput = language;
                    refreshChat(channelId);
                }}
            />
            <LanguageMenu
                label={t("translateChatTo")}
                value={receivedOutput}
                onChange={language => {
                    settings.store.receivedOutput = language;
                    refreshChat(channelId);
                }}
            />

            {/* nothing to send in a chat where you cannot write */}
            {!readOnly && <>
            <div className={cl("group-title", "group-title-line")}>{t("outgoing")}</div>
            <Toggle
                ex={ex} id="chatSend"
                title={t("translateMine")}
                text={t("translateMineDesc")}
                value={sending}
                onChange={v => {
                    setChatOverride(channelId, v ? "on" : "off");
                    // switched on: the originals of your messages are shown again (they are on by default)
                    if (v && settings.store.ownOriginalsOff[channelId]) setShowOwnOriginals(channelId, true);
                    else refreshChat(channelId);
                }}
            />
            <Toggle
                ex={ex} id="chatOwnOriginals"
                title={t("originalMine")}
                text={t("originalMineDesc")}
                detail={t("originalMineMore")}
                value={showsOwnOriginals(channelId)}
                disabled={!sending}
                onChange={v => setShowOwnOriginals(channelId, v)}
            />
            <LanguageMenu
                label={t("myLanguage")}
                value={sentInput}
                includeAuto
                disabled={!sending}
                onChange={language => settings.store.sentInput = language}
            />
            <LanguageMenu
                label={t("translateMineTo")}
                value={getChatTargetLanguage(channelId)}
                disabled={!sending}
                onChange={language => setChatLanguage(channelId, language)}
            />
            </>}

            <div className={cl("popout-footer")}>
                <Button
                    variant="secondary"
                    onClick={() => {
                        close?.();
                        openFullSettings(channelId);
                    }}
                >
                    {t("openFullSettings")}
                </Button>
            </div>
        </div>
    );
}
