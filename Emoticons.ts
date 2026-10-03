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
 * Text smileys (":)", "=(", "xD", "uwu", "¯\_(ツ)_/¯" ...) are never translated: before the text goes to the translator
 * each one is hidden behind a mark, and put back exactly as it was afterwards.
 * Only an exact match that stands on its own counts (spaces or the edge of the text around it).
 * In your own messages they reach Discord untouched, so Discord turns them into emoji by its own rules as before.
 */

import { translate } from "./utils";

/** Western smileys made of eyes, an optional nose and a mouth (":)", ";-P", "=D", ":'(" ...). */
function western(): string[] {
    const eyes = [":", ";", "="];
    const noses = ["", "-", "'", "^", "o"];
    const mouths = [")", "(", "D", "P", "p", "O", "o", "/", "\\", "|", "*", "3", "]", "[", "}", "{", ">", "<", "S", "s", "$", "@", "c", "C", "x", "X", "v", "#"];
    const out: string[] = [];
    for (const e of eyes) for (const n of noses) for (const m of mouths) out.push(e + n + m);
    // mirrored ones: "(:", "):", "D:"
    for (const e of [":", ";", "="]) for (const m of ["(", ")", "D", "c", "C"]) out.push(m + e, `${m}-${e}`);
    return out;
}

const LIST: string[] = [
    ...western(),
    ":'(", ":')", ":,(", ":,)", ";'(", "='(", ":'D",
    ">:(", ">:)", ">:D", ">:P", ">:O", ">:/", ">=(", ">=)", "3:)", "O:)", "0:)", "}:)", "]:)",
    "<3", "</3", "<33", "<333", "<\\3",
    "xD", "XD", "xd", "Xd", "xDD", "XDD", "xP", "x(", "x)", "X(", "X)", "x_x", "X_X", "x.x", "X.X",
    "B)", "B-)", "8-)", "B|", "8|",
    "c:", "C:", ":c", ":C", "c;", ":^)", ":^(", ":>", ":<", ";>",
    "^^", "^_^", "^-^", "^.^", "^o^", "^O^", "^w^", "^^;", "^_^;", "^^'", "^_^'", "^3^", "^v^", "^u^",
    "-_-", "-.-", "-__-", "-_-;", "-_-'", "=_=", "¬_¬", "¬¬",
    "o_O", "O_o", "o.O", "O.o", "o_o", "O_O", "o.o", "O.O", "0_0", "0.0", "0_o", "o_0", "@_@", "*_*", "*.*",
    "T_T", "T.T", "T-T", "TT", "TwT", "TvT", ";_;", ";-;", ";.;", "Q_Q", "QQ", "QwQ", "qwq", "QAQ", "qaq", "T^T",
    ">_<", ">.<", ">w<", ">~<", ">//<", ">///<", ">////<", "><", ">u<", ">o<", ">n<", "<_<", ">_>", "<.<", ">.>",
    "uwu", "UwU", "Uwu", "uwU", "owo", "OwO", "Owo", "owO", "ovo", "OvO", "umu", "UmU", "unu", "UnU", "u_u", "U_U", "u.u",
    "n_n", "n.n", "nwn", "NwN", "ewe", "EwE", "e_e", "._.", ".-.", "._.;", "=w=", "=^=", "≧◡≦", "≧▽≦", "≧ω≦",
    ":3c", ":33", ";3", "=3", ">:3", "x3", "X3", "^w^)", "(:3", "(:", "):",
    "\\o/", "\\O/", "\\o", "o/", "\\(^o^)/", "\\(^_^)/", "\\(*o*)/",
    "¯\\_(ツ)_/¯", "¯\\(ツ)/¯", "¯\\_(シ)_/¯", "¯\\(°_o)/¯", "¯\\_( ͡° ͜ʖ ͡°)_/¯",
    "( ͡° ͜ʖ ͡°)", "( ͡~ ͜ʖ ͡°)", "( ͠° ͟ʖ ͡°)", "(ಠ_ಠ)", "ಠ_ಠ", "ಠ‿ಠ", "ಠ益ಠ", "(ಠ益ಠ)",
    "(╯°□°)╯︵ ┻━┻", "(╯°□°）╯︵ ┻━┻", "(ノಠ益ಠ)ノ彡┻━┻", "┬─┬ノ( º _ ºノ)", "┬─┬ ノ( ゜-゜ノ)", "┻━┻ ︵ヽ(`Д´)ﾉ︵ ┻━┻", "(┛◉Д◉)┛彡┻━┻",
    "(•_•)", "( •_•)>⌐■-■", "(⌐■_■)", "(☞ﾟヮﾟ)☞", "☜(ﾟヮﾟ☜)", "(ง'̀-'́)ง", "(ง •̀_•́)ง", "ᕦ(ò_óˇ)ᕤ",
    "ʕ•ᴥ•ʔ", "ʕ •ᴥ•ʔ", "ʕ·ᴥ·ʔ", "(ᵔᴥᵔ)", "ʘ‿ʘ", "(ʘ‿ʘ)", "◉_◉", "(⊙_⊙)", "⊙_⊙", "(⊙﹏⊙)", "⊙﹏⊙", "(°ロ°)", "(°o°)", "(°_°)",
    "(｡◕‿◕｡)", "(◕‿◕)", "(◕‿◕✿)", "(✿◠‿◠)", "(◠‿◠)", "(◡‿◡✿)", "(◕ᴗ◕✿)", "◕‿◕", "◠‿◠", "(づ｡◕‿‿◕｡)づ", "(っ◔◡◔)っ", "(っ˘ω˘ς )",
    "(´・ω・`)", "(・ω・)", "(｀・ω・´)", "(・_・;)", "(・_・)", "(・∀・)", "(￣▽￣)", "(￣ー￣)", "(￣～￣)", "(￣ω￣)", "(￣^￣)",
    "(^_^;)", "(^^;)", "(^_^)", "(^▽^)", "(*^▽^*)", "(＾▽＾)", "(^o^)", "(^-^)", "(^ω^)", "(^ε^)", "(^3^)", "(*^_^*)", "(*^^*)",
    "(*_*)", "(>_<)", "(T_T)", "(ToT)", "(T▽T)", "(Q_Q)", "(o_o)", "(O_O)", "(0_0)", "(o_O)", "(-_-)", "(-.-)", "(=_=)", "(¬_¬)",
    "(ಥ﹏ಥ)", "(ಥ_ಥ)", "ಥ_ಥ", "ಥ﹏ಥ", "(´；ω；`)", "(；一_一)", "(;´༎ຶД༎ຶ`)", "(╥﹏╥)", "╥﹏╥", "(╥_╥)", "(ㄒoㄒ)",
    "(≧▽≦)", "(≧∇≦)", "(≧ω≦)", "(＾ω＾)", "(°▽°)", "(ﾉ◕ヮ◕)ﾉ*:･ﾟ✧", "ヽ(°〇°)ﾉ", "ヽ(＾▽＾)ﾉ", "ヽ(´▽`)ﾉ", "ヾ(＾∇＾)", "ヾ(•ω•`)o",
    "(=^･ω･^=)", "(=^・^=)", "(=^･^=)", "ฅ^•ﻌ•^ฅ", "(=①ω①=)", "( ˘▽˘)っ♨", "( ˘ω˘ )", "(˘ω˘)", "(´∀`)", "(´ε｀ )", "(*´ω`*)",
    "(｀Д´)", "(╬ಠ益ಠ)", "(ﾟДﾟ)", "(°Д°)", "Σ(ﾟДﾟ)", "Σ(°△°)", "(゜-゜)", "(・・？)", "(◎_◎;)", "(ーー;)", "(；・∀・)",
    "(✧ω✧)", "(★ω★)", "(☆▽☆)", "(♡˙︶˙♡)", "(´｡• ᵕ •｡`)", "(っ´ω`c)", "(⁄ ⁄•⁄ω⁄•⁄ ⁄)", "(⁄ ⁄>⁄ ▽ ⁄<⁄ ⁄)", "(/ω＼)", "(/▽＼)",
    "( ´ ▽ ` )ﾉ", "(ﾉ´ヮ`)ﾉ*: ･ﾟ", "o(≧▽≦)o", "o(^▽^)o", "\\(≧▽≦)/", "٩(◕‿◕)۶", "٩(^‿^)۶", "✧*｡٩(ˊᗜˋ*)و✧*｡", "ᕕ( ᐛ )ᕗ", "ᕙ(⇀‸↼‶)ᕗ",
    "(ᗒᗣᗕ)՞", "(ó﹏ò｡)", "(｡•́︿•̀｡)", "(｡ŏ﹏ŏ)", "(｡╯︵╰｡)", "( ╥ω╥ )", "(●´ω｀●)", "(●'◡'●)", "(｡♥‿♥｡)", "♥‿♥", "(♥ω♥)",
    "<(_ _)>", "m(_ _)m", "orz", "OTZ", "Orz", "OTL", "(_ _)", "(-_-)zzz", "zzz"
];

/** Longest first, so "¯\_(ツ)_/¯" is found before the ":)" or "(" inside it. */
const SORTED = [...new Set(LIST)].sort((a, b) => b.length - a.length);
const SET = new Set(SORTED);

/** True when the whole text (spaces aside) is one smiley from the list or several. */
export function isOnlyEmoticons(text: string): boolean {
    const parts = text.trim().split(/\s+/).filter(Boolean);
    return parts.length > 0 && parts.every(p => SET.has(p)) || SET.has(text.trim());
}

const isEdgeBefore = (text: string, i: number) => i === 0 || /\s/.test(text[i - 1]);
const isEdgeAfter = (text: string, i: number) => i >= text.length || /[\s.,!?…]/.test(text[i]);

/** Marks used for hidden smileys: numbers from 100 up (smaller numbers are taken by formatting). */
export const EMOTICON_BASE = 100;

/**
 * Hides the smileys of a text behind marks "⟦100⟧", "⟦101⟧"...
 * Returns the text for the translator and a function that puts the smileys back into the translation.
 */
export function protectEmoticons(text: string, firstId = EMOTICON_BASE): { text: string; restore(translated: string): string; } {
    const found: string[] = [];
    let out = "";
    let i = 0;
    while (i < text.length) {
        let hit: string | undefined;
        if (isEdgeBefore(text, i)) hit = SORTED.find(e => text.startsWith(e, i) && isEdgeAfter(text, i + e.length));
        if (hit) {
            out += `\u27E6${firstId + found.length}\u27E7`;
            found.push(hit);
            i += hit.length;
        } else {
            out += text[i];
            i++;
        }
    }
    if (!found.length) return { text, restore: t => t };
    return {
        text: out,
        restore(translated) {
            const used = new Set<number>();
            let result = translated.replace(/\u27E6\s*(\d+)\s*\u27E7/g, (m, n) => {
                const k = Number(n) - firstId;
                if (k < 0 || k >= found.length) return m;
                used.add(k);
                return found[k];
            });
            // a mark lost by the translator: the smiley goes to the end, so nothing disappears
            const lost = found.filter((_, k) => !used.has(k));
            if (lost.length) result = `${result.trimEnd()} ${lost.join(" ")}`;
            return result;
        }
    };
}

/** Translates a text the usual way, but with its smileys left exactly as they were. */
export async function translateKeepingEmoticons(kind: "received" | "sent", text: string, silent = false, targetLang?: string) {
    const smileys = protectEmoticons(text);
    const result = await translate(kind, smileys.text, silent, targetLang);
    return { ...result, text: smileys.restore(result.text) };
}
