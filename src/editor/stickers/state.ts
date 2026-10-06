import { invertedEffects, isolateHistory } from "@codemirror/commands";
import { StateEffect, StateField, Transaction, type EditorState, type Text, type TransactionSpec } from "@codemirror/state";
import { blockKey, blocksOf, resolveAnchor, type Block, type Sticker } from "../../core/stickers";

/**
 * Stickers and post-its of the open note, kept in the editor state so that
 * placing, moving, rotating, resizing, deleting a sticker or editing a post-it
 * is undone with Ctrl+Z in the same history as the text.
 *
 * In memory a sticker is anchored to a position (start of its block's first
 * line) that follows the text as it is edited; the frontmatter key (type, text
 * and rank of the block) is recomputed when the note is saved.
 */
export interface Placed extends Sticker {
  /** Start of the first line of the anchor block. */
  pos: number;
}

/** One sticker replaced: added (`before` null), removed (`after` null) or changed. Its inverse swaps both. */
export interface StickerChange {
  before: Placed | null;
  after: Placed | null;
}

const mapPlaced = (p: Placed | null, map: (pos: number) => number): Placed | null => (p ? { ...p, pos: map(p.pos) } : null);

export const changeSticker = StateEffect.define<StickerChange>({
  map: (v, mapping) => ({ before: mapPlaced(v.before, (n) => mapping.mapPos(n, 1)), after: mapPlaced(v.after, (n) => mapping.mapPos(n, 1)) }),
});

/** Stickers of a note opened or reloaded from disk (not part of the history, never saved back). */
export const loadStickers = StateEffect.define<readonly Placed[]>();

/** Post-its are always above stickers; then by stacking order [DESIGN §8]. */
function ordered(items: Placed[]): Placed[] {
  return items.sort((a, b) => (a.kind === b.kind ? a.z - b.z : a.kind === "postit" ? 1 : -1));
}

/** Snaps a position to the start of its line (an anchor is always a line start). */
const lineStart = (doc: Text, pos: number) => doc.lineAt(Math.max(0, Math.min(pos, doc.length))).from;

export const stickersField = StateField.define<readonly Placed[]>({
  create: () => [],
  update(items, tr) {
    let next = items;
    if (tr.docChanged && next.length) {
      // Typing at the start of the anchor line keeps the sticker on it; a deleted block hands it to the next one.
      next = next.map((p) => ({ ...p, pos: lineStart(tr.state.doc, tr.changes.mapPos(p.pos, 1)) }));
    }
    for (const e of tr.effects) {
      if (e.is(loadStickers)) next = ordered(e.value.map((p) => ({ ...p, pos: lineStart(tr.state.doc, p.pos) })));
      else if (e.is(changeSticker)) {
        const { before, after } = e.value;
        const id = after?.id ?? before?.id;
        const rest = next.filter((p) => p.id !== id);
        next = ordered(after ? [...rest, { ...after, pos: lineStart(tr.state.doc, after.pos) }] : rest);
      }
    }
    return next;
  },
});

/** Undo / redo of sticker changes, with the text's history. */
const invertStickers = invertedEffects.of((tr) =>
  tr.effects.flatMap((e) => (e.is(changeSticker) ? [changeSticker.of({ before: e.value.after, after: e.value.before })] : [])),
);

export const stickerState = [stickersField, invertStickers];

export function stickersOf(state: EditorState): readonly Placed[] {
  return state.field(stickersField, false) ?? [];
}

export function stickerById(state: EditorState, id: string): Placed | undefined {
  return stickersOf(state).find((p) => p.id === id);
}

/** True when a transaction changed stickers on purpose (to be saved). */
export function changesStickers(tr: Transaction): boolean {
  return tr.effects.some((e) => e.is(changeSticker));
}

/** A transaction applying sticker changes: one Ctrl+Z each. */
export function stickerTransaction(changes: StickerChange[], userEvent = "ursa.sticker"): TransactionSpec {
  return { effects: changes.map((c) => changeSticker.of(c)), annotations: [isolateHistory.of("full"), Transaction.userEvent.of(userEvent)] };
}

const linesOf = (doc: Text) => doc.toString().split("\n");

/** Position of the anchor of each stored sticker in a body (never lost: the nearest block). */
export function placeStickers(stickers: readonly Sticker[], doc: Text): Placed[] {
  if (stickers.length === 0) return [];
  const blocks = blocksOf(linesOf(doc));
  return stickers.map((s) => {
    const index = resolveAnchor(s.anchor, blocks);
    return { ...s, pos: index < 0 ? 0 : doc.line(blocks[index]!.from).from };
  });
}

/** Index of the block holding line `n` (1-based), else the one before it, else the first one; -1 without blocks. */
export function blockIndexAt(blocks: readonly Block[], n: number): number {
  if (blocks.length === 0) return -1;
  let lo = 0;
  let hi = blocks.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (blocks[mid]!.from <= n) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return Math.max(0, found);
}

/** Start of the block at line `n`: where a sticker dropped on that line is anchored. */
export function blockStartAt(doc: Text, n: number): number {
  const blocks = blocksOf(linesOf(doc));
  const index = blockIndexAt(blocks, n);
  return index < 0 ? 0 : doc.line(blocks[index]!.from).from;
}

/** Stickers as stored in the frontmatter, with anchor keys computed from the current text. */
export function storedStickers(state: EditorState): Sticker[] {
  const items = stickersOf(state);
  if (items.length === 0) return [];
  const blocks = blocksOf(linesOf(state.doc));
  return items.map(({ pos, ...sticker }) => ({ ...sticker, anchor: blockKey(blocks, blockIndexAt(blocks, state.doc.lineAt(pos).number)) }));
}
