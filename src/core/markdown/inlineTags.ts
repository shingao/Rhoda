/**
 * The few inline HTML tags the app writes for formatting Markdown has no
 * syntax for, kept readable in any other editor:
 * - `<u>…</u>`: underline (Ctrl+U, decision D12);
 * - `<span data-size="sm|lg">…</span>`: smaller or larger text;
 * - `<mark data-color="…">…</mark>`: highlight in another colour than `==…==`.
 * Anything else is left as written (plain HTML, shown as text).
 */

export const HIGHLIGHT_COLORS = ["yellow", "green", "blue", "pink"] as const;
export type HighlightColor = (typeof HIGHLIGHT_COLORS)[number];
export const TEXT_SIZES = ["sm", "lg"] as const;
export type TextSize = (typeof TEXT_SIZES)[number];

export type InlineTag =
  | { kind: "underline"; closing: boolean }
  | { kind: "size"; closing: boolean; size: TextSize | null }
  | { kind: "mark"; closing: boolean; color: HighlightColor | null };

const OPEN_U = /^<u>$/i;
const CLOSE_U = /^<\/u>$/i;
const OPEN_SPAN = /^<span\s+data-size\s*=\s*"(sm|lg)"\s*>$/i;
const CLOSE_SPAN = /^<\/span>$/i;
const OPEN_MARK = /^<mark(?:\s+data-color\s*=\s*"([a-z]+)")?\s*>$/i;
const CLOSE_MARK = /^<\/mark>$/i;

/** One of the app's formatting tags (opening or closing), or null. */
export function parseInlineTag(text: string): InlineTag | null {
  if (OPEN_U.test(text)) return { kind: "underline", closing: false };
  if (CLOSE_U.test(text)) return { kind: "underline", closing: true };
  const span = OPEN_SPAN.exec(text);
  if (span) return { kind: "size", closing: false, size: span[1]!.toLowerCase() as TextSize };
  if (CLOSE_SPAN.test(text)) return { kind: "size", closing: true, size: null };
  const mark = OPEN_MARK.exec(text);
  if (mark) {
    const color = (mark[1] ?? "yellow").toLowerCase();
    return { kind: "mark", closing: false, color: (HIGHLIGHT_COLORS as readonly string[]).includes(color) ? (color as HighlightColor) : "yellow" };
  }
  if (CLOSE_MARK.test(text)) return { kind: "mark", closing: true, color: null };
  return null;
}

export interface TagSpan {
  from: number;
  to: number;
  text: string;
}

export interface TagPair {
  kind: InlineTag["kind"];
  open: TagSpan;
  close: TagSpan;
  size?: TextSize;
  color?: HighlightColor;
}

/** Opening and closing tags of one inline run (a paragraph, a heading), matched like nested parentheses per kind. */
export function pairInlineTags(tags: readonly TagSpan[]): TagPair[] {
  const pairs: TagPair[] = [];
  const stacks = new Map<InlineTag["kind"], Array<{ tag: InlineTag; span: TagSpan }>>();
  for (const span of tags) {
    const tag = parseInlineTag(span.text);
    if (!tag) continue;
    const stack = stacks.get(tag.kind) ?? [];
    stacks.set(tag.kind, stack);
    if (!tag.closing) {
      stack.push({ tag, span });
      continue;
    }
    const open = stack.pop();
    if (!open) continue;
    const pair: TagPair = { kind: tag.kind, open: open.span, close: span };
    if (open.tag.kind === "size" && open.tag.size) pair.size = open.tag.size;
    if (open.tag.kind === "mark" && open.tag.color) pair.color = open.tag.color;
    pairs.push(pair);
  }
  return pairs.sort((a, b) => a.open.from - b.open.from);
}

/** The app's formatting tags in a text (any line), for the search index: the text inside them stays, the tags go. */
const ANY_TAG = /<\/?(?:u|span|mark)\b[^<>]*>/gi;

export function stripInlineTags(text: string): string {
  return text.replace(ANY_TAG, (t) => (parseInlineTag(t) ? "" : t));
}

/**
 * The text without the app's tags, and for each of its characters (plus the
 * end) the offset in the original: Ctrl+F finds "un mot" in "un <u>mot</u>".
 */
export function stripInlineTagsWithMap(text: string): { text: string; map: number[] } {
  let out = "";
  const map: number[] = [];
  let last = 0;
  const keep = (to: number) => {
    out += text.slice(last, to);
    for (let i = last; i < to; i++) map.push(i);
  };
  for (const m of text.matchAll(ANY_TAG)) {
    if (!parseInlineTag(m[0])) continue;
    keep(m.index);
    last = m.index + m[0].length;
  }
  keep(text.length);
  map.push(text.length);
  return { text: out, map };
}

/** Writing a tag. */
export function openTag(kind: InlineTag["kind"], value?: TextSize | HighlightColor): string {
  if (kind === "underline") return "<u>";
  if (kind === "size") return `<span data-size="${value ?? "lg"}">`;
  return value && value !== "yellow" ? `<mark data-color="${value}">` : "<mark>";
}

export function closeTag(kind: InlineTag["kind"]): string {
  return kind === "underline" ? "</u>" : kind === "size" ? "</span>" : "</mark>";
}
