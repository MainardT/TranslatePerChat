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
 * Settings of the plugin that are not in the chat button's window: this server, all chats (grouped), shortcuts.
 * Shown in the plugin settings of Vencord and in a window opened by t("openFullSettings") in the chat button's window.
 * The pieces (language list, switch with a description that opens) are also used by the chat button's window.
 */

import { Button } from "@components/Button";
import { FormSwitch } from "@components/FormSwitch";
import { RenderModalProps } from "@vencord/discord-types";
import { ChannelStore, GuildStore, Modal, openModal, useEffect, useMemo, useRef, useState } from "@webpack/common";

import { clearRemembered } from "./EditOriginals";
import { HOTKEYS, HotkeyAction, hotkeyCode, isAllowedKey, keyName } from "./HotkeyConfig";
import {
    getGuildId,
    getServerOverride,
    getServerTargetLanguage,
    setServerLanguage,
    setServerOverride
} from "./overrides";
import { resetLanguageDefaults, settings } from "./settings";
import { cl, getLanguages } from "./utils";
import { t, uiLanguage, useT } from "./i18n";

/* ---------- language list with search ---------- */

/** Height of the open list. */
const LIST_PX = 200;

/**
 * Our own language list with search, drawn inside the window itself
 * (Discord's dropdown does not work inside the chat button's window: the window takes the click away).
 */
export function LanguageMenu({ label, value, includeAuto, disabled, onChange }: {
    label: string;
    value: string;
    includeAuto?: boolean;
    disabled?: boolean;
    onChange(language: string): void;
}) {
    const t = useT();
    const { service } = settings.use(["service"]);
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState("");
    // the list floats over the settings below; upward when there is no room below in the scrolling window
    const [up, setUp] = useState(false);
    const box = useRef<HTMLDivElement>(null);

    const openList = () => {
        const r = box.current?.getBoundingClientRect();
        let bottom = window.innerHeight;
        for (let el = box.current?.parentElement; el; el = el.parentElement) {
            const style = getComputedStyle(el);
            if (/(auto|scroll)/.test(style.overflowY)) { bottom = el.getBoundingClientRect().bottom; break; }
        }
        setUp(!!r && bottom - r.bottom < LIST_PX + 8 && r.top > LIST_PX);
        setQuery("");
        setOpen(true);
    };

    const options = useMemo(() => {
        const ru = uiLanguage() === "ru";
        let names: Intl.DisplayNames | undefined;
        try { names = ru ? new Intl.DisplayNames(["ru"], { type: "language" }) : undefined; } catch { /* English names */ }
        const nameOf = (code: string, english: string) => {
            if (code === "auto") return ru ? t("detectLanguage") : english;
            try {
                const n = names?.of(code);
                return n && n.toLowerCase() !== code.toLowerCase() ? n.charAt(0).toUpperCase() + n.slice(1) : english;
            } catch { return english; }
        };
        const list = Object.entries(getLanguages()).map(([value, label]) => ({ value, label: nameOf(value, label) }));
        // the first entry is "Detect language", which only makes sense for the language that is translated from
        if (!includeAuto) list.shift();
        return list;
    }, [includeAuto, service, t]);

    const current = options.find(o => o.value === value);
    const needle = query.trim().toLowerCase();
    const shown = needle ? options.filter(o => o.label.toLowerCase().includes(needle) || o.value.toLowerCase() === needle) : options;

    const pick = (language: string) => {
        setOpen(false);
        setQuery("");
        if (language !== value) onChange(language);
    };

    return (
        <section className={cl("menu")}>
            <div className={cl("field-title")}>{label}</div>

            <div ref={box} className={cl("lang", { "lang-open": open, "lang-up": up, "lang-disabled": !!disabled })}>
                {open
                    ? <input
                        autoFocus
                        className={cl("lang-field", "lang-search")}
                        value={query}
                        placeholder={current?.label ?? t("pickLanguage")}
                        onChange={e => setQuery(e.currentTarget.value)}
                        // clicking somewhere else closes the list; a moment later, so a choice that is under way still lands
                        onBlur={() => setTimeout(() => setOpen(false), 200)}
                        onKeyDown={e => {
                            if (e.key === "Escape") {
                                e.preventDefault();
                                e.stopPropagation();
                                setOpen(false);
                            } else if (e.key === "Enter" && shown.length) {
                                e.preventDefault();
                                pick(shown[0].value);
                            }
                        }}
                    />
                    : <button
                        type="button"
                        className={cl("lang-field", "lang-current")}
                        disabled={disabled}
                        onClick={openList}
                    >
                        <span>{current?.label ?? t("pickLanguage")}</span>
                        <span className={cl("lang-arrow")}>{"▾"}</span>
                    </button>}

                {open && (
                    <div className={cl("lang-list")}>
                        {shown.map(o => (
                            <div
                                key={o.value}
                                className={cl("lang-option", { "lang-option-selected": o.value === value })}
                                // chosen the moment the mouse button goes down: before the window can take the focus away
                                onMouseDown={e => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    pick(o.value);
                                }}
                            >
                                {o.label}
                            </div>
                        ))}
                        {!shown.length && <div className={cl("lang-empty")}>{"—"}</div>}
                    </div>
                )}
            </div>
        </section>
    );
}

/* ---------- descriptions that open and close ---------- */

/** At most this many descriptions are open at once: opening one more closes the oldest. */
const MAX_OPEN = 2;
/** Line height of descriptions; a closed one shows two and a half lines, a text of up to three lines is never closed. */
const LINE_PX = 18;
const CLOSED_PX = LINE_PX * 2.5;
const FITS_PX = LINE_PX * 3 + 2;

export interface Expand { open: string[]; toggle(id: string): void; }

/** Which descriptions of one window are open. */
export function useExpand(): Expand {
    const [open, setOpen] = useState<string[]>([]);
    return useMemo(() => ({
        open,
        toggle(id: string) {
            setOpen(list => list.includes(id) ? list.filter(x => x !== id) : [...list, id].slice(-MAX_OPEN));
        }
    }), [open]);
}

/**
 * A description: two lines, the second fading out with a small "more" button; a click opens the full text
 * (the detailed one, if given). Nothing more to show = no button.
 */
export function Desc({ id, text, detail, ex }: { id: string; text: string; detail?: string; ex: Expand; }) {
    const t = useT();
    const isOpen = ex.open.includes(id);
    const ref = useRef<HTMLDivElement>(null);
    // full height of what is shown now, and of the short text alone (measured while closed)
    const [fullPx, setFullPx] = useState(0);
    const [textPx, setTextPx] = useState(0);

    useEffect(() => {
        if (!ref.current) return;
        setFullPx(ref.current.scrollHeight);
        if (!isOpen) setTextPx(ref.current.scrollHeight);
    }, [text, detail, isOpen]);

    const clipped = textPx > FITS_PX;
    const canOpen = !!detail || clipped;

    // opened text that went below the edge of the window: scrolled into view once it has grown
    useEffect(() => {
        if (!isOpen) return;
        const timer = setTimeout(() => ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }), 220);
        return () => clearTimeout(timer);
    }, [isOpen]);

    const onClick = (e: { preventDefault(): void; stopPropagation(): void; }) => {
        // the description sits inside the switch: a click on it must not flip the switch
        e.preventDefault();
        e.stopPropagation();
        if (canOpen) ex.toggle(id);
    };

    const maxHeight = isOpen ? fullPx : clipped ? CLOSED_PX : undefined;

    return (
        <div className={cl("desc", { "desc-closed": !isOpen && clipped, "desc-clickable": canOpen })} onClick={onClick}>
            <div ref={ref} className={cl("desc-text")} style={maxHeight === undefined ? undefined : { maxHeight: `${maxHeight}px` }}>
                {isOpen && detail ? `${text} ${detail}` : text}
            </div>
            {canOpen && <span className={cl("desc-more")}>{isOpen ? t("descLess") : t("descMore")}</span>}
        </div>
    );
}

/** A switch with a name and a description that opens. */
export function Toggle({ id, title, text, detail, value, onChange, disabled, ex }: {
    id: string; title: string; text: string; detail?: string;
    value: boolean; onChange(v: boolean): void; disabled?: boolean; ex: Expand;
}) {
    return (
        <FormSwitch
            title={title}
            description={<Desc id={id} text={text} detail={detail} ex={ex} />}
            value={value}
            onChange={onChange}
            disabled={disabled}
            hideBorder
        />
    );
}

/* ---------- small pieces of the full settings ---------- */

function Section({ title, sub }: { title: string; sub?: string; }) {
    return (
        <div className={cl("section")}>
            <div className={cl("section-title")}>{title}</div>
            {sub && <div className={cl("section-sub")}>{sub}</div>}
        </div>
    );
}

/** A number chosen with a slider (steps given as a list). */
function Steps({ id, title, text, detail, value, steps, unit, onChange, ex }: {
    id: string; title: string; text: string; detail?: string;
    value: number; steps: number[]; unit: string; onChange(v: number): void; ex: Expand;
}) {
    const index = Math.max(0, steps.findIndex(s => s >= value));
    return (
        <div className={cl("row")}>
            <div className={cl("row-head")}>
                <span className={cl("row-title")}>{title}</span>
                <span className={cl("row-value")}>{String(value).replace(".", ",")} {unit}</span>
            </div>
            <input
                type="range"
                className={cl("range")}
                min={0}
                max={steps.length - 1}
                step={1}
                value={index}
                onChange={e => onChange(steps[Number(e.currentTarget.value)])}
            />
            <div className={cl("range-ticks")}>
                {steps.map((_, i) => <span key={i} className={cl(i === index ? "tick-on" : "tick")} />)}
            </div>
            <div className={cl("range-ends")}>
                <span>{String(steps[0]).replace(".", ",")} {unit}</span>
                <span>{String(steps[steps.length - 1]).replace(".", ",")} {unit}</span>
            </div>
            <Desc id={id} text={text} detail={detail} ex={ex} />
        </div>
    );
}

function TextField({ title, value, placeholder, onChange }: { title: string; value: string; placeholder: string; onChange(v: string): void; }) {
    return (
        <div className={cl("row")}>
            <div className={cl("field-title")}>{title}</div>
            <input
                type="text"
                className={cl("lang-field", "text-field")}
                value={value}
                placeholder={placeholder}
                onChange={e => onChange(e.currentTarget.value)}
            />
        </div>
    );
}

const SERVICES = [
    { value: "google", label: "Google" },
    { value: "deepl", label: "DeepL Free" },
    { value: "deepl-pro", label: "DeepL Pro" },
    { value: "kagi", label: "Kagi" }
] as const;

/** Name of the chat for the section title. */
export function chatName(channelId: string | undefined): string {
    const channel = channelId ? ChannelStore.getChannel(channelId) : undefined;
    if (!channel) return "";
    if (channel.name) return channel.guild_id ? `#${channel.name}` : channel.name;
    return t("directMessages");
}

/** "Clear remembered texts": tells it is done on the button itself for a moment. */
function ClearButton() {
    const t = useT();
    const [done, setDone] = useState(false);
    useEffect(() => {
        if (!done) return;
        const timer = setTimeout(() => setDone(false), 2000);
        return () => clearTimeout(timer);
    }, [done]);
    return (
        <Button
            onClick={async () => {
                try {
                    await clearRemembered();
                    setDone(true);
                } catch (e) {
                    console.error("[TranslatePerChat] clearing remembered texts failed", e);
                }
            }}
        >
            {done ? t("cleared") : t("clearSaved")}
        </Button>
    );
}

/* ---------- the full settings ---------- */

/** Shortcuts: Alt plus a key for each action; a click on the key, then the new key is pressed. */
function HotkeysSection() {
    const t = useT();
    const { hotkeys } = settings.use(["hotkeys"]);
    const [waiting, setWaiting] = useState<HotkeyAction | null>(null);
    const [warning, setWarning] = useState("");

    useEffect(() => {
        if (!waiting) return;
        const onKey = (e: KeyboardEvent) => {
            e.preventDefault();
            e.stopPropagation();
            if (e.code === "Escape") {
                setWaiting(null);
                setWarning("");
                return;
            }
            // Alt itself and the other modifiers are not the key being chosen
            if (/^(Alt|Control|Shift|Meta|OS)(Left|Right)?$/.test(e.code)) return;
            if (!isAllowedKey(e.code)) {
                setWarning(t("onlyLetterOrDigit"));
                return;
            }
            const taken = HOTKEYS.find(h => h.id !== waiting && hotkeyCode(h.id) === e.code);
            if (taken) {
                setWarning(t("hotkeyTaken", { key: keyName(e.code), action: t(taken.textKey) }));
                return;
            }
            settings.store.hotkeys = { ...settings.store.hotkeys, [waiting]: e.code };
            setWaiting(null);
            setWarning("");
        };
        window.addEventListener("keydown", onKey, true);
        return () => window.removeEventListener("keydown", onKey, true);
    }, [waiting]);

    const changed = Object.keys(hotkeys ?? {}).length > 0;

    return (
        <div data-vc-trans-hotkeys="">
            <Section title={t("hotkeys")} />
            {HOTKEYS.map(h => (
                <div key={h.id} className={cl("row", "hotkey-row")}>
                    <span className={cl("hotkey-text")}>{t(h.textKey)}</span>
                    <span className={cl("hotkey-keys")}>
                        Alt +
                        <button
                            type="button"
                            className={cl("hotkey-key", { "hotkey-key-wait": waiting === h.id })}
                            onClick={() => {
                                setWarning("");
                                setWaiting(waiting === h.id ? null : h.id);
                            }}
                        >
                            {waiting === h.id ? t("pressKey") : keyName(hotkeyCode(h.id))}
                        </button>
                    </span>
                </div>
            ))}
            <div className={cl("hotkey-note")}>
                {t("holdAltNote")}
            </div>
            {warning && <div className={cl("hotkey-warning")}>{warning}</div>}
            <div className={cl("row")}>
                <Button
                    variant="secondary"
                    disabled={!changed}
                    onClick={() => {
                        settings.store.hotkeys = {};
                        setWaiting(null);
                        setWarning("");
                    }}
                >
                    {t("resetHotkeys")}
                </Button>
            </div>
        </div>
    );
}

/** Settings of this menu that t("resetDefaults") puts back (the translator and its keys, and the settings of single chats and servers, stay). */
const RESET_KEYS = [
    "autoReadOwnDelay", "autoReadEnterDelay", "translationCacheSize", "sentBufferSize", "autoReadAhead", "autoReadIdle",
    "fastScrollScreens", "scrollSettleDelay", "autoReadHiddenDelay", "showAutoTranslateTooltip", "editRemember", "editBackTranslate", "imageMinTextPx",
    "screenMinFontSize", "showReplacedTips"
] as const;

/** The button at the bottom: everything in this menu back to the basic values (asks once more before doing it). */
function ResetAll() {
    const t = useT();
    const [sure, setSure] = useState(false);

    useEffect(() => {
        if (!sure) return;
        const timer = setTimeout(() => setSure(false), 4000);
        return () => clearTimeout(timer);
    }, [sure]);

    const reset = () => {
        for (const key of RESET_KEYS) (settings.store as Record<string, unknown>)[key] = (settings.def as any)[key].default;
        settings.store.sentOutput = IS_WEB || settings.store.service === "google" || settings.store.service === "kagi" ? "en" : "en-us";
        settings.store.hotkeys = {};
        setSure(false);
    };

    return (
        <div>
            <Section title={t("resetSection")} />
            <Button variant="secondary" onClick={() => sure ? reset() : setSure(true)}>
                {sure ? t("resetSure") : t("resetDefaults")}
            </Button>
        </div>
    );
}

export function FullSettings({ channelId, scrollTo }: { channelId?: string; scrollTo?: "hotkeys"; }) {
    const t = useT();
    const s = settings.use([
        "autoReadOwnDelay", "autoReadEnterDelay", "translationCacheSize", "sentBufferSize", "autoReadAhead", "autoReadIdle", "fastScrollScreens", "scrollSettleDelay", "autoReadHiddenDelay", "channelOverrides", "guildOverrides",
        "chatLanguages", "guildLanguages", "sentOutput",
        "showAutoTranslateTooltip", "editRemember", "editBackTranslate", "imageMinTextPx", "screenMinFontSize",
        "showReplacedTips", "service", "deeplApiKey", "kagiSession"
    ]);
    const ex = useExpand();

    const guildId = channelId ? getGuildId(channelId) : undefined;
    const serverOn = !!guildId && getServerOverride(guildId) === "on";
    const serverName = guildId ? GuildStore.getGuild(guildId)?.name ?? "" : "";

    // opened from the list of shortcuts: scrolled to them
    useEffect(() => {
        if (scrollTo !== "hotkeys") return;
        const timer = setTimeout(() => document.querySelector("[data-vc-trans-hotkeys]")?.scrollIntoView({ block: "start" }), 150);
        return () => clearTimeout(timer);
    }, []);

    return (
        <div className={cl("settings")}>
            <Section title={t("outgoing")} />
            <LanguageMenu
                label={t("translateMineTo")}
                value={s.sentOutput}
                onChange={language => settings.store.sentOutput = language}
            />
            <Steps
                ex={ex} id="ownDelay"
                title={t("ownDelay")}
                text={t("ownDelayDesc")}
                value={s.autoReadOwnDelay ?? 1.5}
                steps={[0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 5]}
                unit={t("unitSec")}
                onChange={v => settings.store.autoReadOwnDelay = v}
            />
            <Toggle
                ex={ex} id="sentTip"
                title={t("sentTip")}
                text={t("sentTipDesc")}
                value={s.showAutoTranslateTooltip}
                onChange={v => settings.store.showAutoTranslateTooltip = v}
            />

            {guildId && <>
                <Section title={t("thisServer")} sub={serverName} />
                <Toggle
                    ex={ex} id="serverSend"
                    title={t("serverSend")}
                    text={t("serverSendDesc")}
                    detail={t("serverSendMore")}
                    value={serverOn}
                    onChange={v => setServerOverride(guildId, v ? "on" : "off")}
                />
                <LanguageMenu
                    label={t("serverLanguage")}
                    value={getServerTargetLanguage(guildId)}
                    onChange={language => setServerLanguage(guildId, language)}
                />
            </>}

            <Section title={t("incoming")} />
            <Steps
                ex={ex} id="enterDelay"
                title={t("enterDelay")}
                text={t("enterDelayDesc")}
                detail={t("enterDelayMore")}
                value={s.autoReadEnterDelay ?? 2}
                steps={[0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 5]}
                unit={t("unitSec")}
                onChange={v => settings.store.autoReadEnterDelay = v}
            />
            <Steps
                ex={ex} id="ahead"
                title={t("ahead")}
                text={t("aheadDesc")}
                detail={t("aheadMore")}
                value={s.autoReadAhead ?? 3}
                steps={[0, 1, 2, 3, 4, 5, 6, 7, 8, 10]}
                unit={t("unitPcs")}
                onChange={v => settings.store.autoReadAhead = v}
            />
            <Steps
                ex={ex} id="fastScroll"
                title={t("fastScroll")}
                text={t("fastScrollDesc")}
                detail={t("fastScrollMore")}
                value={s.fastScrollScreens ?? 1}
                steps={[0.1, 0.2, 0.4, 0.6, 0.8, 1, 1.25, 1.5, 1.75, 2]}
                unit={t("unitScreensSec")}
                onChange={v => settings.store.fastScrollScreens = v}
            />
            <Steps
                ex={ex} id="scrollSettle"
                title={t("scrollSettle")}
                text={t("scrollSettleDesc")}
                value={s.scrollSettleDelay ?? 0.4}
                steps={[0.2, 0.4, 0.6, 0.8, 1, 1.2, 1.4, 1.6, 1.8, 2]}
                unit={t("unitSec")}
                onChange={v => settings.store.scrollSettleDelay = v}
            />
            <Steps
                ex={ex} id="idle"
                title={t("idle")}
                text={t("idleDesc")}
                value={s.autoReadIdle ?? 2}
                steps={[0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.25, 2.5]}
                unit={t("unitMin")}
                onChange={v => settings.store.autoReadIdle = v}
            />
            <Steps
                ex={ex} id="hiddenDelay"
                title={t("hiddenDelay")}
                text={t("hiddenDelayDesc")}
                value={s.autoReadHiddenDelay ?? 0}
                steps={[0, 5, 10, 15, 20, 25, 30, 40, 50, 60]}
                unit={t("unitSec")}
                onChange={v => settings.store.autoReadHiddenDelay = v}
            />

            <Section title={t("editing")} />
            <Toggle
                ex={ex} id="editRemember"
                title={t("editRemember")}
                text={t("editRememberDesc")}
                detail={t("editRememberMore")}
                value={s.editRemember}
                onChange={v => settings.store.editRemember = v}
            />
            <Toggle
                ex={ex} id="editBack"
                title={t("editBack")}
                text={t("editBackDesc")}
                detail={t("editBackMore")}
                value={s.editBackTranslate}
                onChange={v => settings.store.editBackTranslate = v}
            />
            <div className={cl("row")}>
                <ClearButton />
            </div>

            <Section title={t("memory")} />
            <Steps
                ex={ex} id="cacheSize"
                title={t("cacheSize")}
                text={t("cacheSizeDesc")}
                detail={t("cacheSizeMore")}
                value={s.translationCacheSize ?? 1000}
                steps={[200, 500, 1000, 1500, 2000, 2500, 3000, 3500, 4000, 5000]}
                unit={t("unitPcs")}
                onChange={v => settings.store.translationCacheSize = v}
            />
            <Steps
                ex={ex} id="sentSize"
                title={t("sentBuffer")}
                text={t("sentBufferDesc")}
                value={s.sentBufferSize ?? 500}
                steps={[100, 200, 300, 500, 750, 1000, 1250, 1500, 1750, 2000]}
                unit={t("unitPcs")}
                onChange={v => settings.store.sentBufferSize = v}
            />

            <Section title={t("imagesScreen")} />
            <Steps
                ex={ex} id="imageMin"
                title={t("imageMin")}
                text={t("imageMinDesc")}
                value={s.imageMinTextPx ?? 10}
                steps={[9, 10, 11, 12, 13, 14, 15, 16, 17, 18]}
                unit="px"
                onChange={v => settings.store.imageMinTextPx = v}
            />
            <Steps
                ex={ex} id="screenFont"
                title={t("screenFont")}
                text={t("screenFontDesc")}
                value={s.screenMinFontSize ?? 11}
                steps={[8, 9, 10, 11, 12, 13, 14, 15, 16, 18]}
                unit="px"
                onChange={v => settings.store.screenMinFontSize = v}
            />

            <Section title={t("interface")} />
            <Toggle
                ex={ex} id="tips"
                title={t("hoverTips")}
                text={t("hoverTipsDesc")}
                value={s.showReplacedTips}
                onChange={v => settings.store.showReplacedTips = v}
            />
            <Section title={t("translator")} />
            <div className={cl("row")}>
                <div className={cl("field-title")}>{t("service")}</div>
                <div className={cl("segments")}>
                    {SERVICES.map(o => (
                        <button
                            key={o.value}
                            type="button"
                            className={cl("segment", { "segment-on": s.service === o.value })}
                            onClick={() => {
                                if (s.service === o.value) return;
                                settings.store.service = o.value;
                                resetLanguageDefaults();
                            }}
                        >
                            {o.label}
                        </button>
                    ))}
                </div>
                <Desc
                    ex={ex} id="service"
                    text={t("serviceDesc")}
                    detail={t("serviceMore")}
                />
            </div>
            {(s.service === "deepl" || s.service === "deepl-pro") && (
                <TextField
                    title={t("deeplKey")}
                    value={s.deeplApiKey ?? ""}
                    placeholder={t("keyPlaceholder")}
                    onChange={v => settings.store.deeplApiKey = v}
                />
            )}
            {s.service === "kagi" && (
                <TextField
                    title={t("kagiToken")}
                    value={s.kagiSession ?? ""}
                    placeholder={t("tokenPlaceholder")}
                    onChange={v => settings.store.kagiSession = v}
                />
            )}

            <HotkeysSection />
            <ResetAll />
        </div>
    );
}

/** Opens the full settings in a window. */
export function openFullSettings(channelId?: string, scrollTo?: "hotkeys") {
    openModal((props: RenderModalProps) => (
        <Modal {...props} title={t("settingsTitle")}>
            <FullSettings channelId={channelId} scrollTo={scrollTo} />
        </Modal>
    ));
}
