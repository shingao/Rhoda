/**
 * Text normalisation for search: case- and accent-insensitive, ligatures
 * expanded (œ → oe, æ → ae, ß → ss), typographic apostrophes unified, so
 * "ete" finds "été" and "oeuvre" finds "œuvre".
 */

const SPECIAL: Record<string, string> = {
  œ: "oe",
  Œ: "oe",
  æ: "ae",
  Æ: "ae",
  ß: "ss",
  ẞ: "ss",
  ø: "o",
  Ø: "o",
  đ: "d",
  Đ: "d",
  ł: "l",
  Ł: "l",
  "’": "'",
  "‘": "'",
  ʼ: "'",
};
const SPECIAL_RE = /[œŒæÆßẞøØđĐłŁ’‘ʼ]/g;
const MARKS = /\p{M}/gu;

/** Folded form of a code point (may be empty, or longer than 1). */
function foldChar(ch: string): string {
  return SPECIAL[ch] ?? ch.normalize("NFKD").replace(MARKS, "").toLowerCase();
}

/** Folds a whole string (fast path, for indexing). Same result as `foldWithMap(s).text`. */
export function fold(s: string): string {
  return s.normalize("NFKD").replace(MARKS, "").replace(SPECIAL_RE, (c) => SPECIAL[c]!).toLowerCase();
}

/**
 * Folds `s` and keeps, for every folded character, the index of the original
 * character it comes from — to highlight matches in the original text.
 * `map` has one extra entry: `s.length`.
 */
export function foldWithMap(s: string): { text: string; map: number[] } {
  let text = "";
  const map: number[] = [];
  let i = 0;
  for (const ch of s) {
    const f = foldChar(ch);
    text += f;
    for (let k = 0; k < f.length; k++) map.push(i);
    i += ch.length;
  }
  map.push(s.length);
  return { text, map };
}

/** A letter or digit, after folding: word boundaries for prefix matching. */
export function isWordChar(c: string | undefined): boolean {
  return c !== undefined && /[\p{L}\p{N}]/u.test(c);
}

/**
 * Start offsets of `needle` in `hay` (both folded). With `wordStart`, only
 * occurrences at the start of a word count ("ete" matches "été", not "complète").
 */
export function findAll(hay: string, needle: string, wordStart: boolean): number[] {
  const out: number[] = [];
  if (!needle) return out;
  for (let i = hay.indexOf(needle); i >= 0; i = hay.indexOf(needle, i + 1)) {
    if (!wordStart || !isWordChar(hay[i - 1]) || !isWordChar(needle[0])) out.push(i);
  }
  return out;
}

/** Whether `needle` occurs in `hay` (folded), at a word start if asked. */
export function contains(hay: string, needle: string, wordStart: boolean): boolean {
  if (!wordStart) return hay.includes(needle);
  for (let i = hay.indexOf(needle); i >= 0; i = hay.indexOf(needle, i + 1)) {
    if (!isWordChar(hay[i - 1]) || !isWordChar(needle[0])) return true;
  }
  return false;
}

/**
 * Ranges `[from, to)` of the original `text` where any of the folded needles
 * occur (merged, sorted). Used for <mark> highlights.
 */
export function matchRanges(text: string, needles: Array<{ text: string; wordStart: boolean }>): Array<[number, number]> {
  if (needles.length === 0 || !text) return [];
  const { text: folded, map } = foldWithMap(text);
  const ranges: Array<[number, number]> = [];
  for (const n of needles) {
    for (const at of findAll(folded, n.text, n.wordStart)) ranges.push([map[at]!, map[at + n.text.length] ?? text.length]);
  }
  ranges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged: Array<[number, number]> = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([r[0], r[1]]);
  }
  return merged;
}
