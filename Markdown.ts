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
 * Translating a text written with Discord formatting (your own messages before sending, and their edits):
 * the structure and the formatting come out exactly as they were written.
 *   - Lines stay lines; list marks ("- ", "* ", "1. "), quotes ("> ") and headings ("# ") are kept and never translated.
 *   - Bold, italic, underline, strikethrough, spoilers and `code` keep their marks around the translated words.
 *   - Code is not translated: ```blocks``` with a language or looking like code, `pieces` that look like code,
 *     and a single `word` among other text. A `phrase` of ordinary words is translated (the marks stay).
 *   - Links, mentions, emoji (pictures and ":names:"), timestamps and text smileys are kept as they are.
 * Everything kept is hidden from the translator behind marks "⟦n⟧" and put back afterwards.
 * If the translator loses marks, the text is translated line by line, and at worst piece by piece between the marks,
 * so nothing is ever lost or moved to another line.
 */

import { protectEmoticons } from "./Emoticons";
import { translate, TranslationValue } from "./utils";

type Kind = "received" | "sent";

const MARK = (id: number) => `\u27E6${id}\u27E7`;
const ANY_MARK = /\u27E6\s*(\d+)\s*\u27E7/g;
const LINE_ID = 0;
const EMOTICON_ID = 1000;
const ATOM_ID = 2000;

const hasLetters = (s: string) => /[\p{L}\p{N}]/u.test(s.replace(ANY_MARK, ""));

/* ---------- is it code? ---------- */

const CODE_WORDS = /\b(function|return|const|let|var|if|else|elif|for|while|class|def|import|from|export|public|private|static|void|null|undefined|true|false|print|console|async|await|new|this|self|int|string|bool|float|lambda|switch|case|break|continue|try|catch|except|struct|enum|fn|func|package|include)\b/;
const CODE_SIGNS = /[{};=<>[\]\\$&|^~]|=>|::|->|!=|==/g;

/** A guess whether a text is code (true) or ordinary words (false). */
export function looksLikeCode(text: string): boolean {
    const s = text.trim();
    if (!s) return false;
    const nonSpace = s.replace(/\s+/g, "").length;
    const signs = (s.match(CODE_SIGNS) ?? []).length;
    const words = s.split(/\s+/);
    // letters of a living language other than Latin (Russian, Japanese...): code is almost always written in Latin
    const otherAlphabet = /[\p{L}]/u.test(s.replace(/[\p{Script=Latin}\d_]/gu, "").replace(/[^\p{L}]/gu, ""));

    if (/^\s{2,}\S/m.test(text) && signs >= 2) return true; // indented lines with code signs
    if (/[;{}]\s*$/m.test(s) && signs >= 2 && !otherAlphabet) return true; // lines ending in ";", "{", "}"
    if (CODE_WORDS.test(s) && signs >= 2 && !otherAlphabet) return true;
    if (!otherAlphabet && nonSpace > 0 && signs / nonSpace > 0.1) return true;
    // one "word" glued from parts: playerScore, max_speed, a.b.c, C:\path, file.ext, call()
    if (words.length === 1 && !otherAlphabet
        && /[a-z][A-Z]|\w_\w|\w\.\w|[\\/]|\(\)|^[A-Z0-9_]{3,}$/.test(s)) return true;
    return false;
}

/* ---------- hiding things from the translator ---------- */

interface Hidden {
    /** Text for the translator, with marks. */
    text: string;
    /** Mark id -> what it stands for: a kept thing, or the two halves around translated words. */
    atoms: Map<number, string>;
    pairs: Map<number, { open: string; close: string; }>;
}

/** Things kept exactly as written. */
const ATOMS = [
    /<a?:\w+:\d+>/g, // custom emoji
    /<(?:@[!&]?|#)\d+>|<\/[\w -]+:\d+>|<t:-?\d+(?::[tTdDfFR])?>|<id:\w+>/g, // mentions, channels, commands, timestamps
    /<https?:\/\/[^>\s]+>/g, // link without a preview
    /https?:\/\/[^\s<>()]+(?:\([^\s<>()]*\)[^\s<>()]*)*/g, // links
    /@(?:everyone|here)\b/g,
    /:[\w+-]{2,}:/g, // emoji by name
    /\p{Extended_Pictographic}(?:[\ufe0f\u200d\u{1F3FB}-\u{1F3FF}]|\p{Extended_Pictographic})*|\p{Regional_Indicator}{2}/gu // emoji
];

/** Formatting around words: the words are translated, the marks stay. Order matters (longer marks first). */
const PAIRS: { re: RegExp; open: string; close: string; }[] = [
    { re: /\|\|([\s\S]+?)\|\|/g, open: "||", close: "||" },
    { re: /~~([\s\S]+?)~~/g, open: "~~", close: "~~" },
    { re: /\*\*\*([\s\S]+?)\*\*\*/g, open: "***", close: "***" },
    { re: /\*\*([\s\S]+?)\*\*/g, open: "**", close: "**" },
    { re: /__([\s\S]+?)__/g, open: "__", close: "__" },
    { re: /(?<![*\w\\])\*(?![\s*])([^\n*]+?)(?<![\s\\])\*(?![*\w])/g, open: "*", close: "*" },
    { re: /(?<![\w\\])_(?![\s_])([^\n_]+?)(?<![\s\\])_(?![\w])/g, open: "_", close: "_" }
];

/** Start of a line: indents, quotes, headings, small text, list marks. Kept and never translated. */
const LINE_START = /^(?:\s*(?:>>> |> |#{1,3} |-# |[-*+] |\d{1,3}[.)] ))*\s*/;

function hide(text: string, wholeMessage: string): Hidden {
    const atoms = new Map<number, string>();
    const pairs = new Map<number, { open: string; close: string; }>();
    let nextAtom = ATOM_ID;
    let nextPair = 1;
    const atom = (value: string) => {
        atoms.set(nextAtom, value);
        return MARK(nextAtom++);
    };
    const pair = (open: string, inner: string, close: string) => {
        const id = nextPair++;
        pairs.set(id, { open, close });
        return `${MARK(id)}${inner}${MARK(id)}`;
    };

    // `code`: kept when it is code or a single word among other text; ordinary words inside are translated
    let out = text.replace(/(`{1,2})(?!`)([\s\S]+?)\1(?!`)/g, (all, ticks: string, inner: string) => {
        const alone = wholeMessage.trim() === all.trim();
        const oneWord = !/\s/.test(inner.trim());
        if (looksLikeCode(inner) || (oneWord && !alone) || !hasLetters(inner)) return atom(all);
        return pair(ticks, inner, ticks);
    });

    // [words](link): the words are translated, the link stays
    out = out.replace(/\[([^\]\n]+)\]\((<?https?:\/\/[^)\s]+>?)\)/g, (_, words: string, link: string) => pair("[", words, `](${link})`));

    for (const re of ATOMS) out = out.replace(re, m => atom(m));
    // backslash escapes ("\*") stay as they are
    out = out.replace(/\\[\\*_~|`>#\-[\]()]/g, m => atom(m));

    return { text: out, atoms, pairs };
}

/* ---------- asking the translator ---------- */

const countMarks = (s: string) => {
    const counts = new Map<number, number>();
    for (const m of s.matchAll(ANY_MARK)) counts.set(Number(m[1]), (counts.get(Number(m[1])) ?? 0) + 1);
    return counts;
};

const sameMarks = (a: string, b: string) => {
    const x = countMarks(a), y = countMarks(b);
    if (x.size !== y.size) return false;
    for (const [id, n] of x) if (y.get(id) !== n) return false;
    return true;
};

/** Translates text piece by piece between the marks: the marks never move. */
async function bySegments(text: string, ask: (s: string) => Promise<string>): Promise<string> {
    const parts = text.split(/(\u27E6\s*\d+\s*\u27E7)/);
    const out = await Promise.all(parts.map(async p => {
        if (/^\u27E6/.test(p) || !hasLetters(p)) return p;
        const lead = p.match(/^\s*/)![0];
        const trail = p.match(/\s*$/)![0];
        return lead + (await ask(p.trim())).trim() + trail;
    }));
    return out.join("");
}

/** One line: whole, or between the marks if the translator lost some. */
async function oneLine(line: string, ask: (s: string) => Promise<string>): Promise<string> {
    if (!hasLetters(line)) return line;
    const got = await ask(line);
    return sameMarks(got, line) ? got : bySegments(line, ask);
}

/* ---------- putting things back ---------- */

function restorePairs(text: string, hidden: Hidden): string {
    // each pair mark appears twice: the first becomes the opening half, the second the closing one;
    // spaces just inside the marks go outside (Discord wants "**word**", not "** word **")
    const tokens = text.split(/(\u27E6\s*\d+\s*\u27E7)/);
    const seen = new Set<number>();
    for (let i = 1; i < tokens.length; i += 2) {
        const id = Number(tokens[i].replace(/\D/g, ""));
        const p = hidden.pairs.get(id);
        if (!p) continue;
        if (!seen.has(id)) {
            seen.add(id);
            const spaces = tokens[i + 1].match(/^[ \t]*/)![0];
            tokens[i + 1] = tokens[i + 1].slice(spaces.length);
            tokens[i] = spaces + p.open;
        } else {
            const spaces = tokens[i - 1].match(/[ \t]*$/)![0];
            tokens[i - 1] = tokens[i - 1].slice(0, tokens[i - 1].length - spaces.length);
            tokens[i] = p.close + spaces;
        }
    }
    return tokens.join("");
}

const restoreAtoms = (text: string, hidden: Hidden) => text.replace(ANY_MARK, (m, n: string) => hidden.atoms.get(Number(n)) ?? m);

/* ---------- the whole text ---------- */

/** A text without ```blocks```: lines, line starts, formatting and kept things. */
async function translateFlow(text: string, wholeMessage: string, ask: (s: string) => Promise<string>): Promise<string> {
    if (!hasLetters(text)) return text;
    const lead = text.match(/^\s*/)![0];
    const trail = text.length > lead.length ? text.match(/\s*$/)![0] : "";
    const core = text.slice(lead.length, text.length - trail.length);

    const hidden = hide(core, wholeMessage);
    const smileys = protectEmoticons(hidden.text, EMOTICON_ID);

    // each line: its start is kept aside, its words go to the translator
    const starts: string[] = [];
    const bodies = smileys.text.split("\n").map(line => {
        const start = line.match(LINE_START)![0];
        starts.push(start);
        return line.slice(start.length).trimEnd();
    });

    // formatting around words (after the line starts are aside, so "* " of a list is not taken for italics)
    let joined = bodies.join("\n");
    for (const { re, open, close } of PAIRS) {
        joined = joined.replace(re, (all, inner: string) => {
            if (!inner.trim()) return all;
            const id = hidden.pairs.size + 1;
            hidden.pairs.set(id, { open, close });
            return `${MARK(id)}${inner}${MARK(id)}`;
        });
    }
    const lines = joined.split("\n");

    // first the whole text at once (best translation); if the translator lost a line or a mark: line by line
    let result: string[];
    const asOne = lines.join(` ${MARK(LINE_ID)} `);
    const got = hasLetters(asOne) ? await ask(asOne) : asOne;
    const gotLines = got.split(/[ \t]*\u27E6\s*0\s*\u27E7[ \t]*/);
    if (gotLines.length === lines.length && gotLines.every((l, i) => sameMarks(l, lines[i]))) {
        result = gotLines.map((l, i) => hasLetters(lines[i]) ? l.trim() : lines[i]);
    } else {
        result = await Promise.all(lines.map(l => oneLine(l, ask).then(s => s.trim())));
    }

    // formatting back; then the extra spaces a translator puts around marks are tidied (the line starts stay as they were)
    const withPairs = restorePairs(result.map((l, i) => starts[i] + l).join("\n"), hidden).split("\n");
    const tidy = withPairs.map((l, i) => starts[i] + l.slice(starts[i].length).replace(/[ \t]{2,}/g, " ").trim()).join("\n");
    return lead + smileys.restore(restoreAtoms(tidy, hidden)) + trail;
}

/**
 * Translates a text written with Discord formatting, keeping its lines, formatting, code, links, emoji and smileys.
 */
export async function translateFormatted(kind: Kind, text: string, silent = false, targetLang?: string): Promise<TranslationValue> {
    let sourceLanguage = "";
    const ask = async (s: string) => {
        const r = await translate(kind, s, silent, targetLang);
        if (!sourceLanguage) sourceLanguage = r.sourceLanguage;
        return r.text;
    };

    // ```blocks``` are separate: code stays, ordinary words inside are translated
    const parts = text.split(/(```[\s\S]*?```)/);
    const out = await Promise.all(parts.map(async part => {
        const block = part.match(/^```([^\n`]*\n)?([\s\S]*?)```$/);
        if (!block) return translateFlow(part, text, ask);
        const lang = block[1] ?? "";
        const inner = block[2];
        if (lang.trim() || looksLikeCode(inner) || !hasLetters(inner)) return part;
        return "```" + lang + await translateFlow(inner, text, ask) + "```";
    }));

    return { sourceLanguage, text: out.join("") };
}
