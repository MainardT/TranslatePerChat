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

import { ChatBarButton, ChatBarButtonFactory } from "@api/ChatButtons";
import { TooltipContainer } from "@components/TooltipContainer";
import { classes } from "@utils/misc";
import { IconComponent } from "@utils/types";
import { Popout, useEffect, useRef, useState } from "@webpack/common";

import { ChatTranslatePanel } from "./ChatTranslateModal";
import { useT } from "./i18n";
import { shouldAutoTranslate } from "./overrides";
import { startScreenTranslate } from "./ScreenTranslate";
import { settings } from "./settings";
import { cl } from "./utils";

export const TranslateIcon: IconComponent = ({ height = 20, width = 20, className }) => {
    return (
        <svg
            viewBox="0 96 960 960"
            height={height}
            width={width}
            className={classes(cl("icon"), className)}
        >
            <path fill="currentColor" d="m475 976 181-480h82l186 480h-87l-41-126H604l-47 126h-82Zm151-196h142l-70-194h-2l-70 194Zm-466 76-55-55 204-204q-38-44-67.5-88.5T190 416h87q17 33 37.5 62.5T361 539q45-47 75-97.5T487 336H40v-80h280v-80h80v80h280v80H567q-22 69-58.5 135.5T419 598l98 99-30 81-127-122-200 200Z" />
        </svg>
    );
};

/** Chat bubble with two-way arrows. When `off` is set, a slash is drawn over it. */
export const ChatTranslateIcon = ({ height = 20, width = 20, className, off }: { height?: number; width?: number; className?: string; off?: boolean; }) => {
    return (
        <svg
            viewBox="0 0 24 24"
            height={height}
            width={width}
            className={classes(cl("icon"), className)}
        >
            <path fill="currentColor" d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z" />
            <g transform="translate(6 4) scale(0.5)">
                <path fill="currentColor" d="M6.99 11L3 15l3.99 4v-3H14v-2H6.99v-3zM21 9l-3.99-4v3H10v2h7.01v3L21 9z" />
            </g>
            {off && <path d="M3 3L21 21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />}
        </svg>
    );
};

/** Frame with a "T" inside: translate a piece of the screen. */
export const ScreenTranslateIcon = ({ height = 20, width = 20, className }: { height?: number; width?: number; className?: string; }) => {
    return (
        <svg
            viewBox="0 0 24 24"
            height={height}
            width={width}
            className={classes(cl("icon"), className)}
        >
            <path fill="currentColor" d="M3 5v4h2V5h4V3H5c-1.1 0-2 .9-2 2zm2 10H3v4c0 1.1.9 2 2 2h4v-2H5v-4zm14 4h-4v2h4c1.1 0 2-.9 2-2v-4h-2v4zm0-16h-4v2h4v4h2V5c0-1.1-.9-2-2-2z" />
            <path fill="currentColor" d="M8.5 8h7v1.8h-2.6V16h-1.8V9.8H8.5z" />
        </svg>
    );
};

export let setShouldShowTranslateEnabledTooltip: undefined | ((show: boolean) => void);

/** First button: pick a piece of the screen and translate the text in it. */
function TranslateScreenButton() {
    const t = useT();

    return (
        <ChatBarButton
            tooltip={t("tipScreen")}
            onClick={startScreenTranslate}
        >
            <ScreenTranslateIcon className={cl("chat-button")} />
        </ChatBarButton>
    );
}

/** Second button: shows whether your messages are translated in this chat and opens the window with all the translation settings. */
function TranslateChatToggleButton({ channelId }: { channelId: string; }) {
    // re-render when the chat's own setting, the server setting or the general default changes
    settings.use(["channelOverrides", "guildOverrides"]);
    const enabled = shouldAutoTranslate(channelId);
    const t = useT();

    const [shouldShowTooltip, setter] = useState(false);
    useEffect(() => {
        setShouldShowTranslateEnabledTooltip = setter;
        return () => setShouldShowTranslateEnabledTooltip = undefined;
    }, []);

    const anchorRef = useRef<HTMLDivElement>(null);
    const [showPopout, setShowPopout] = useState(false);

    const button = (
        <ChatBarButton
            tooltip={enabled ? t("tipChatOn") : t("tipChatOff")}
            onClick={() => setShowPopout(v => !v)}
            buttonProps={{
                "aria-haspopup": "dialog"
            }}
        >
            <ChatTranslateIcon
                off={!enabled}
                className={cl({ "auto-translate": enabled, "chat-button": true })}
            />
        </ChatBarButton>
    );

    const content = shouldShowTooltip && settings.store.showAutoTranslateTooltip
        ? (
            <TooltipContainer text={t("tipAutoEnabled")} forceOpen>
                {button}
            </TooltipContainer>
        )
        : button;

    return (
        <Popout
            position="top"
            align="right"
            animation={Popout.Animation.NONE}
            shouldShow={showPopout}
            onRequestClose={() => setShowPopout(false)}
            targetElementRef={anchorRef}
            renderPopout={() => <ChatTranslatePanel channelId={channelId} close={() => setShowPopout(false)} />}
        >
            {() => (
                <div ref={anchorRef} className={cl("button-anchor")}>
                    {content}
                </div>
            )}
        </Popout>
    );
}

export const TranslateChatBarButtons: ChatBarButtonFactory = ({ isAnyChat, channel }) => {
    // the main chat and the chat of a side panel (a thread or forum post opened next to the channel)
    if (!isAnyChat) return null;

    return (
        <>
            <TranslateScreenButton />
            <TranslateChatToggleButton channelId={channel.id} />
        </>
    );
};
