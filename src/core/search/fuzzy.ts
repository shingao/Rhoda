import { foldWithMap, isWordChar } from "./fold";

/**
 * Fuzzy matching for the command palette: the typed letters, in order, not
 * necessarily together ("expn" finds "Exporter la note"), ignoring case and
 * accents ("ete" finds "Été"). Better scores for letters that follow each
 * other, start words, or start the text.
 */

export interface FuzzyMatch {
  score: number;
  /** Matched characters of the original text, as [from, to) ranges, for highlighting. */
  ranges: Array<[number, number]>;
}

export function fuzzyMatch(query: string, text: string): FuzzyMatch | null {
  const q = foldWithMap(query.trim()).text.replace(/\s+/g, " ");
  if (!q) return { score: 0, ranges: [] };
  const { text: t, map } = foldWithMap(text);
  // Best first: a plain substring (prefix of a word if possible).
  const exact = bestSubstring(t, q);
  const positions = exact?.filter((p) => t[p] !== " ") ?? greedy(t, q);
  if (!positions) return null;
  let score = 0;
  for (let i = 0; i < positions.length; i++) {
    const p = positions[i]!;
    const wordStart = p === 0 || !isWordChar(t[p - 1]);
    score += 1;
    if (wordStart) score += 3;
    if (i > 0 && positions[i - 1] === p - 1) score += 4;
    if (i > 0) score -= Math.min(3, p - positions[i - 1]! - 1) * 0.5;
  }
  if (positions[0] === 0) score += 6;
  if (exact) score += 8;
  // Shorter texts first among equals.
  score -= t.length / 100;
  return { score, ranges: toRanges(positions.map((p) => map[p]!)) };
}

function bestSubstring(t: string, q: string): number[] | null {
  let best = -1;
  for (let i = t.indexOf(q); i >= 0; i = t.indexOf(q, i + 1)) {
    if (best < 0) best = i;
    if (i === 0 || !isWordChar(t[i - 1])) {
      best = i;
      break;
    }
  }
  return best < 0 ? null : Array.from({ length: q.length }, (_, k) => best + k);
}

/**
 * Initials-style match: the letters of `q` in runs, each run starting a word
 * and continuing letter by letter ("expn" → EXPorter la Note). Scattered
 * letters inside words do not count, so "ete" does not find "nouvelle note".
 */
function greedy(t: string, q: string): number[] | null {
  const letters = q.replace(/ /g, "");
  const wordStarts: number[] = [];
  for (let i = 0; i < t.length; i++) if (isWordChar(t[i]) && (i === 0 || !isWordChar(t[i - 1]))) wordStarts.push(i);
  // Depth-first: extend the current run, or start a new one at a later word start.
  const search = (k: number, from: number, run: number): number[] | null => {
    if (k === letters.length) return [];
    if (run >= 0 && t[run] === letters[k]) {
      const rest = search(k + 1, run + 1, run + 1);
      if (rest) return [run, ...rest];
    }
    for (const w of wordStarts) {
      if (w < from || t[w] !== letters[k]) continue;
      const rest = search(k + 1, w + 1, w + 1);
      if (rest) return [w, ...rest];
    }
    return null;
  };
  return search(0, 0, -1);
}

function toRanges(points: number[]): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  for (const p of [...new Set(points)].sort((a, b) => a - b)) {
    const last = ranges[ranges.length - 1];
    if (last && last[1] === p) last[1] = p + 1;
    else ranges.push([p, p + 1]);
  }
  return ranges;
}
