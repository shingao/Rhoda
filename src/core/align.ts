/**
 * Text alignment of blocks (paragraph, heading, quote, list item), stored in
 * the frontmatter (`align:`) so the Markdown stays clean. Each entry is
 * anchored to its block by the same key as stickers and folds (type, start of
 * the text, rank), which survives edits made elsewhere. Left is the default
 * and is never stored. Code blocks, tables, rules and embeds are not aligned.
 */
import { blockKey, blocksOf, resolveAnchor, type Block, type BlockKey, type BlockType } from "./stickers";

export const ALIGNMENTS = ["left", "center", "right", "justify"] as const;
export type Alignment = (typeof ALIGNMENTS)[number];

export interface BlockAlign {
  anchor: BlockKey;
  align: Exclude<Alignment, "left">;
}

const ALIGNABLE: readonly BlockType[] = ["paragraph", "heading", "quote", "list"];

export function isAlignable(type: BlockType): boolean {
  return ALIGNABLE.includes(type);
}

export function isAlignment(value: unknown): value is Alignment {
  return (ALIGNMENTS as readonly unknown[]).includes(value);
}

/** Alignments read from the frontmatter; anything malformed, or left, is dropped. */
export function parseAligns(value: unknown): BlockAlign[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw): BlockAlign[] => {
    if (!raw || typeof raw !== "object") return [];
    const r = raw as Record<string, unknown>;
    if (!isAlignment(r.align) || r.align === "left" || !isAlignable(r.block as BlockType)) return [];
    const index = typeof r.index === "number" && Number.isFinite(r.index) ? Math.max(0, Math.round(r.index)) : 0;
    return [{ anchor: { type: r.block as BlockType, text: typeof r.text === "string" ? r.text : "", index }, align: r.align }];
  });
}

/** What goes into the frontmatter (undefined when every block is left-aligned). */
export function serializeAligns(aligns: readonly BlockAlign[]): unknown[] | undefined {
  if (aligns.length === 0) return undefined;
  return aligns.map((a) => ({ block: a.anchor.type, text: a.anchor.text, index: a.anchor.index, align: a.align }));
}

/**
 * Alignment of each block of a body, by first line (1-based): stored keys
 * resolved against the text as it is now. Two keys landing on the same block:
 * the last one wins. A key resolved to a block that cannot be aligned is dropped.
 */
export function alignedLines(aligns: readonly BlockAlign[], blocks: readonly Block[]): Map<number, BlockAlign["align"]> {
  const out = new Map<number, BlockAlign["align"]>();
  for (const a of aligns) {
    const index = resolveAnchor(a.anchor, blocks);
    const block = blocks[index];
    if (block && isAlignable(block.type)) out.set(block.from, a.align);
  }
  return out;
}

/** Keys for the frontmatter from the first lines of aligned blocks (blocks that moved or vanished are dropped). */
export function alignsFromLines(lines: ReadonlyMap<number, BlockAlign["align"]>, blocks: readonly Block[]): BlockAlign[] {
  const out: BlockAlign[] = [];
  blocks.forEach((block, i) => {
    const align = lines.get(block.from);
    if (align && isAlignable(block.type)) out.push({ anchor: blockKey(blocks, i), align });
  });
  return out;
}

/** Shortcut for a body: resolved alignments by first line. */
export function alignedLinesOf(aligns: readonly BlockAlign[], body: string): Map<number, BlockAlign["align"]> {
  return aligns.length ? alignedLines(aligns, blocksOf(body.split("\n"))) : new Map();
}
