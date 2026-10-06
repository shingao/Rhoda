/**
 * Stickers and post-its of a note, stored in its frontmatter (`stickers:`) so
 * the Markdown stays clean. Each one is anchored to a block of the note by a
 * key that survives edits made elsewhere — the block's type, the start of its
 * text and its rank (the folding strategy) — and is placed relative to it:
 * `dx` in % of the text column width (negative = left margin, > 100 = right
 * margin), `dy` in px from the top of the block.
 */
import { parseEmbedLine } from "./markdown/embeds";

export const POSTIT_COLORS = ["yellow", "pink", "green", "blue"] as const;
export type PostitColor = (typeof POSTIT_COLORS)[number];
export type StickerKind = "sticker" | "postit";
export type BlockType = "heading" | "paragraph" | "list" | "quote" | "code" | "embed" | "table" | "rule";

export interface BlockKey {
  type: BlockType;
  /** Start of the block's text, normalized (markers removed, lowercase, 60 characters). */
  text: string;
  /** Rank of the block in the note. */
  index: number;
}

export interface Sticker {
  id: string;
  kind: StickerKind;
  /** Image of a sticker: `fluent/<code>` (built in) or a vault path (`assets/stickers/…`). */
  asset?: string;
  /** Post-it text (several lines allowed). */
  text?: string;
  color?: PostitColor;
  collapsed?: boolean;
  anchor: BlockKey;
  dx: number;
  dy: number;
  /** Degrees. */
  rotation: number;
  /** Width in px (stickers 40–200, post-its 120–240) [DESIGN §8, §9]. */
  size: number;
  /** Stacking order (post-its above stickers by default). */
  z: number;
}

export const STICKER_SIZE = { min: 40, max: 200, default: 80 } as const;
export const POSTIT_SIZE = { min: 120, max: 240, default: 168 } as const;

export interface Block {
  /** First and last line (1-based, inclusive). */
  from: number;
  to: number;
  type: BlockType;
  text: string;
}

const HEADING = /^ {0,3}#{1,6}(\s|$)/;
const LIST = /^\s*(?:[-*+]|\d+[.)])\s/;
const QUOTE = /^ {0,3}>/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const RULE = /^ {0,3}([-*_])(\s*\1){2,}\s*$/;
const TABLE = /^\s*\|/;

const blank = (line: string) => line.trim() === "";

/** The blocks of a body: what a sticker can be anchored to. */
export function blocksOf(lines: readonly string[]): Block[] {
  const blocks: Block[] = [];
  let i = 0;
  const push = (from: number, to: number, type: BlockType) =>
    blocks.push({ from: from + 1, to: to + 1, type, text: lines.slice(from, to + 1).join("\n") });
  while (i < lines.length) {
    const line = lines[i]!;
    if (blank(line)) {
      i++;
      continue;
    }
    const fence = FENCE.exec(line)?.[1];
    if (fence) {
      let end = i + 1;
      while (end < lines.length && !(lines[end]!.trim().startsWith(fence) && lines[end]!.trim().replace(/[`~]/g, "") === "")) end++;
      push(i, Math.min(end, lines.length - 1), "code");
      i = end + 1;
      continue;
    }
    if (HEADING.test(line)) {
      push(i, i, "heading");
      i++;
      continue;
    }
    if (RULE.test(line)) {
      push(i, i, "rule");
      i++;
      continue;
    }
    if (parseEmbedLine(line)) {
      push(i, i, "embed");
      i++;
      continue;
    }
    const type: BlockType = LIST.test(line) ? "list" : QUOTE.test(line) ? "quote" : TABLE.test(line) ? "table" : "paragraph";
    let end = i;
    while (end + 1 < lines.length) {
      const next = lines[end + 1]!;
      if (blank(next) || HEADING.test(next) || FENCE.test(next) || RULE.test(next) || parseEmbedLine(next)) break;
      // Each list item is its own block (a sticker next to a task follows that task).
      if (type === "list" && LIST.test(next)) break;
      if (type !== "list" && type !== "quote" && type !== "table" && (LIST.test(next) || QUOTE.test(next))) break;
      if (type === "quote" && !QUOTE.test(next)) break;
      if (type === "table" && !TABLE.test(next)) break;
      end++;
    }
    push(i, end, type);
    i = end + 1;
  }
  return blocks;
}

/** Start of a block's text as a key: markers and spacing removed, lowercase. */
export function blockText(block: Block): string {
  return block.text
    .replace(/^ {0,3}#{1,6}\s+/, "")
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/, "")
    .replace(/^(?: {0,3}>)+\s?/gm, "")
    .replace(/[*_`~=]/g, "")
    .normalize("NFC")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("fr")
    .slice(0, 60);
}

export function blockKey(blocks: readonly Block[], index: number): BlockKey {
  const block = blocks[index];
  return block ? { type: block.type, text: blockText(block), index } : { type: "paragraph", text: "", index: 0 };
}

const nearest = (candidates: number[], index: number) =>
  candidates.reduce((best, i) => (Math.abs(i - index) < Math.abs(best - index) ? i : best));

/**
 * The block a sticker belongs to now (index in `blocks`), or -1 for an empty
 * note. Never fails: same text and type (nearest rank), same text, edited
 * text (one starts the other), the block at the same rank, else the nearest one.
 */
export function resolveAnchor(key: BlockKey, blocks: readonly Block[]): number {
  if (blocks.length === 0) return -1;
  const texts = blocks.map(blockText);
  const all = blocks.map((_, i) => i);
  const exact = all.filter((i) => blocks[i]!.type === key.type && texts[i] === key.text);
  if (key.text && exact.length) return nearest(exact, key.index);
  const sameText = all.filter((i) => texts[i] === key.text);
  if (key.text && sameText.length) return nearest(sameText, key.index);
  const prefix = (a: string, b: string) => a.length >= 12 && b.length >= 12 && (a.startsWith(b.slice(0, 24)) || b.startsWith(a.slice(0, 24)));
  const edited = all.filter((i) => blocks[i]!.type === key.type && prefix(texts[i]!, key.text));
  if (edited.length) return nearest(edited, key.index);
  return Math.min(Math.max(0, key.index), blocks.length - 1);
}

const num = (v: unknown, fallback: number, min = -Infinity, max = Infinity) =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
const BLOCK_TYPES: readonly BlockType[] = ["heading", "paragraph", "list", "quote", "code", "embed", "table", "rule"];

/** Stickers read from the frontmatter; anything malformed is dropped, numbers are brought in range. */
export function parseStickers(value: unknown): Sticker[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw, n): Sticker[] => {
    if (!raw || typeof raw !== "object") return [];
    const r = raw as Record<string, unknown>;
    const kind: StickerKind = r.type === "postit" ? "postit" : "sticker";
    const a = (r.anchor && typeof r.anchor === "object" ? r.anchor : {}) as Record<string, unknown>;
    const asset = typeof r.asset === "string" ? r.asset : undefined;
    if (kind === "sticker" && !asset) return [];
    const range = kind === "postit" ? POSTIT_SIZE : STICKER_SIZE;
    return [
      {
        id: typeof r.id === "string" && r.id ? r.id : `sticker-${n}`,
        kind,
        ...(asset && { asset }),
        ...(kind === "postit" && { text: typeof r.text === "string" ? r.text : "" }),
        ...(kind === "postit" && { color: (POSTIT_COLORS as readonly unknown[]).includes(r.color) ? (r.color as PostitColor) : "yellow" }),
        ...(r.collapsed === true && { collapsed: true }),
        anchor: {
          type: BLOCK_TYPES.includes(a.block as BlockType) ? (a.block as BlockType) : "paragraph",
          text: typeof a.text === "string" ? a.text : "",
          index: num(a.index, 0, 0),
        },
        dx: num(r.dx, 105, -100, 300),
        dy: num(r.dy, 0, -2000, 20000),
        rotation: num(r.rotation, 0, -180, 180),
        size: num(r.size, range.default, range.min, range.max),
        z: num(r.z, n),
      },
    ];
  });
}

const round = (n: number) => Math.round(n * 10) / 10;

/** What goes into the frontmatter (undefined when there is none). */
export function serializeStickers(stickers: readonly Sticker[]): unknown[] | undefined {
  if (stickers.length === 0) return undefined;
  return stickers.map((s) => ({
    id: s.id,
    type: s.kind,
    ...(s.asset && { asset: s.asset }),
    ...(s.kind === "postit" && { text: s.text ?? "", color: s.color ?? "yellow" }),
    ...(s.collapsed && { collapsed: true }),
    anchor: { block: s.anchor.type, text: s.anchor.text, index: s.anchor.index },
    dx: round(s.dx),
    dy: round(s.dy),
    rotation: round(s.rotation),
    size: Math.round(s.size),
    z: s.z,
  }));
}

/** Copies for a duplicated note: same places, new ids. */
export function cloneStickers(stickers: readonly Sticker[], newId: () => string): Sticker[] {
  return stickers.map((s) => ({ ...s, id: newId(), anchor: { ...s.anchor } }));
}

/** Text of the post-its (search). */
export function postitText(stickers: readonly Sticker[]): string {
  return stickers
    .filter((s) => s.kind === "postit" && s.text)
    .map((s) => s.text)
    .join("\n");
}

/** Random rotation at placement: ±8° for stickers, ±3° for post-its [DESIGN §8, §9]. */
export function placementRotation(kind: StickerKind, random = Math.random): number {
  const max = kind === "postit" ? 3 : 8;
  return round((random() * 2 - 1) * max);
}
