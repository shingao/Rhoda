/**
 * Persisted fold state. Positions do not survive edits made while the note is
 * closed, so a folded heading is remembered by its text, level and rank among
 * the headings, and found again by the closest match.
 */

export interface HeadingInfo {
  text: string;
  level: number;
}

export interface FoldKey extends HeadingInfo {
  /** Rank of the heading among all the headings of the note. */
  index: number;
}

const norm = (text: string) => text.normalize("NFC").trim().replace(/\s+/g, " ").toLocaleLowerCase("fr");

export function foldKeys(headings: HeadingInfo[], folded: number[]): FoldKey[] {
  return folded.flatMap((i) => {
    const h = headings[i];
    return h ? [{ text: h.text, level: h.level, index: i }] : [];
  });
}

/**
 * Indices of the headings matching saved keys: same text and level (nearest
 * rank wins), else — the title was renamed elsewhere — the heading at the same
 * rank if it has the same level and is not claimed by its own text.
 */
export function matchFoldKeys(keys: FoldKey[], headings: HeadingInfo[]): number[] {
  const used = new Set<number>();
  const byText = new Map<string, number[]>();
  headings.forEach((h, i) => {
    const k = `${h.level}\u0000${norm(h.text)}`;
    byText.set(k, [...(byText.get(k) ?? []), i]);
  });
  const claimed = new Set(keys.flatMap((k) => byText.get(`${k.level}\u0000${norm(k.text)}`) ?? []));
  const pending: FoldKey[] = [];
  for (const key of keys) {
    const candidates = (byText.get(`${key.level}\u0000${norm(key.text)}`) ?? []).filter((i) => !used.has(i));
    if (candidates.length === 0) {
      pending.push(key);
      continue;
    }
    used.add(candidates.reduce((best, i) => (Math.abs(i - key.index) < Math.abs(best - key.index) ? i : best)));
  }
  for (const key of pending) {
    const h = headings[key.index];
    if (h && h.level === key.level && !used.has(key.index) && !claimed.has(key.index)) used.add(key.index);
  }
  return [...used].sort((a, b) => a - b);
}
