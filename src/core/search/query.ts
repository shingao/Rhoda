import { fold } from "./fold";

/**
 * Search syntax, combinable [DESIGN §2.3]:
 * - words (all required, matched at word starts, accents and case ignored);
 * - "exact phrase";
 * - -word, -"phrase", -#tag, -@op to exclude;
 * - #tag (a parent tag includes its sub-tags);
 * - @todo @done @untagged @pinned @today @images @pdf.
 */
export const OPERATORS = ["todo", "done", "untagged", "pinned", "today", "images", "pdf"] as const;
export type Operator = (typeof OPERATORS)[number];

export interface Needle {
  /** Folded text. */
  text: string;
  /** Words match at a word start; phrases anywhere. */
  wordStart: boolean;
}

export interface SearchQuery {
  include: Needle[];
  exclude: Needle[];
  /** Tag names as typed (keys are derived by the matcher). */
  tags: string[];
  excludeTags: string[];
  operators: Operator[];
  excludeOperators: Operator[];
  /** Free text (words and phrases) as typed, for "Create a note named…". */
  text: string;
}

export interface QueryToken {
  kind: "word" | "phrase" | "tag" | "operator";
  value: string;
  negated: boolean;
  /** Offsets in the raw query. */
  from: number;
  to: number;
}

const isOperator = (v: string): v is Operator => (OPERATORS as readonly string[]).includes(v);

/** Splits a raw query into tokens (unterminated quotes run to the end). */
export function tokenize(raw: string): QueryToken[] {
  const tokens: QueryToken[] = [];
  let i = 0;
  while (i < raw.length) {
    if (/\s/.test(raw[i]!)) {
      i++;
      continue;
    }
    const from = i;
    let negated = false;
    if (raw[i] === "-" && i + 1 < raw.length && !/\s/.test(raw[i + 1]!)) {
      negated = true;
      i++;
    }
    if (raw[i] === '"') {
      const close = raw.indexOf('"', i + 1);
      const end = close < 0 ? raw.length : close;
      const value = raw.slice(i + 1, end);
      i = close < 0 ? raw.length : close + 1;
      if (value.trim()) tokens.push({ kind: "phrase", value, negated, from, to: i });
      continue;
    }
    let end = i;
    while (end < raw.length && !/\s/.test(raw[end]!)) end++;
    const word = raw.slice(i, end);
    i = end;
    if (word.startsWith("#") && word.length > 1) tokens.push({ kind: "tag", value: word.slice(1).replace(/#$/, ""), negated, from, to: end });
    else if (word.startsWith("@") && isOperator(word.slice(1).toLowerCase())) {
      tokens.push({ kind: "operator", value: word.slice(1).toLowerCase(), negated, from, to: end });
    } else tokens.push({ kind: "word", value: word, negated, from, to: end });
  }
  return tokens;
}

export function parseQuery(raw: string): SearchQuery {
  const q: SearchQuery = { include: [], exclude: [], tags: [], excludeTags: [], operators: [], excludeOperators: [], text: "" };
  const text: string[] = [];
  for (const t of tokenize(raw)) {
    if (t.kind === "tag") (t.negated ? q.excludeTags : q.tags).push(t.value);
    else if (t.kind === "operator") (t.negated ? q.excludeOperators : q.operators).push(t.value as Operator);
    else {
      const folded = fold(t.value.trim());
      if (!folded) continue;
      (t.negated ? q.exclude : q.include).push({ text: folded, wordStart: t.kind === "word" });
      if (!t.negated) text.push(t.value.trim());
    }
  }
  q.text = text.join(" ");
  return q;
}

export function isEmptyQuery(q: SearchQuery): boolean {
  return !q.include.length && !q.exclude.length && !q.tags.length && !q.excludeTags.length && !q.operators.length && !q.excludeOperators.length;
}
