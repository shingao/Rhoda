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
  const positions = exact ?? greedy(t, q);
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
  return { score, ranges: toRanges(positions.filter((p) => q[positions.indexOf(p)] !== " ").map((p) => map[p]!)) };
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

/** Each letter of `q` at its earliest place after the previous one, preferring word starts. */
function greedy(t: string, q: string): number[] | null {
  const out: number[] = [];
  let from = 0;
  for (const ch of q) {
    if (ch === " ") continue;
    let at = -1;
    // A word start within reach is better than the next occurrence.
    for (let i = t.indexOf(ch, from); i >= 0; i = t.indexOf(ch, i + 1)) {
      if (at < 0) at = i;
      if (i === 0 || !isWordChar(t[i - 1])) {
        if (out.length === 0 || i - from < 12) at = i;
        break;
      }
    }
    if (at < 0) return null;
    out.push(at);
    from = at + 1;
  }
  return out;
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
