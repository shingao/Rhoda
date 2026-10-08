import { invertedEffects, isolateHistory } from "@codemirror/commands";
import { StateEffect, StateField, Transaction, type EditorState, type Extension, type Text, type TransactionSpec } from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";
import { alignedLinesOf, alignsFromLines, isAlignable, type Alignment, type BlockAlign } from "../core/align";
import { blocksOf, type Block } from "../core/stickers";
import { editorHooks } from "./hooks";
import { blockIndexAt } from "./stickers/state";

/**
 * Block alignment of the open note, in the editor state so that a change is
 * undone with Ctrl+Z like the text. In memory an alignment is anchored to the
 * start of its block's first line, which follows the text as it is edited; the
 * frontmatter key is recomputed when the note is saved (as for stickers).
 */
export type BlockAlignment = BlockAlign["align"];

export interface AlignedBlock {
  /** Start of the first line of the block. */
  pos: number;
  align: BlockAlignment;
}

/** One block's alignment changed (null = left). Its inverse swaps both. */
export interface AlignChange {
  pos: number;
  before: BlockAlignment | null;
  after: BlockAlignment | null;
}

export const changeAlign = StateEffect.define<AlignChange>({ map: (v, m) => ({ ...v, pos: m.mapPos(v.pos, 1) }) });

/** Alignments of a note opened or reloaded from disk (not part of the history, never saved back). */
export const loadAligns = StateEffect.define<readonly AlignedBlock[]>();

const lineStart = (doc: Text, pos: number) => doc.lineAt(Math.max(0, Math.min(pos, doc.length))).from;

/** One entry per position, in document order. */
function normalized(items: AlignedBlock[]): AlignedBlock[] {
  const byPos = new Map<number, BlockAlignment>();
  for (const a of items) byPos.set(a.pos, a.align);
  return [...byPos].sort((a, b) => a[0] - b[0]).map(([pos, align]) => ({ pos, align }));
}

export const alignField = StateField.define<readonly AlignedBlock[]>({
  create: () => [],
  update(items, tr) {
    let next = items;
    if (tr.docChanged && next.length) next = normalized(next.map((a) => ({ ...a, pos: lineStart(tr.state.doc, tr.changes.mapPos(a.pos, 1)) })));
    for (const e of tr.effects) {
      if (e.is(loadAligns)) next = normalized(e.value.map((a) => ({ ...a, pos: lineStart(tr.state.doc, a.pos) })));
      else if (e.is(changeAlign)) {
        const pos = lineStart(tr.state.doc, e.value.pos);
        const rest = next.filter((a) => a.pos !== pos);
        next = normalized(e.value.after ? [...rest, { pos, align: e.value.after }] : rest);
      }
    }
    return next;
  },
});

const invertAligns = invertedEffects.of((tr) =>
  tr.effects.flatMap((e) => (e.is(changeAlign) ? [changeAlign.of({ pos: e.value.pos, before: e.value.after, after: e.value.before })] : [])),
);

const blocksOfDoc = (doc: Text) => blocksOf(doc.toString().split("\n"));

/**
 * The block of each alignment, as the text is now: an alignment whose line was
 * merged into another block (blank line deleted) aligns that whole block, the
 * way it will be saved. Blocks that cannot be aligned (code, table) are left out.
 */
function alignedBlocks(state: EditorState): Array<{ block: Block; align: BlockAlignment }> {
  const items = state.field(alignField);
  if (items.length === 0) return [];
  const blocks = blocksOfDoc(state.doc);
  const byBlock = new Map<number, BlockAlignment>();
  for (const a of items) {
    const index = blockIndexAt(blocks, state.doc.lineAt(a.pos).number);
    if (index >= 0) byBlock.set(index, a.align);
  }
  return [...byBlock].flatMap(([index, align]) => {
    const block = blocks[index]!;
    return isAlignable(block.type) ? [{ block, align }] : [];
  });
}

const lineClass: Record<BlockAlignment, Decoration> = {
  center: Decoration.line({ class: "cm-align-center" }),
  right: Decoration.line({ class: "cm-align-right" }),
  justify: Decoration.line({ class: "cm-align-justify" }),
};

function decorationsOf(state: EditorState): DecorationSet {
  const ranges = alignedBlocks(state)
    .sort((a, b) => a.block.from - b.block.from)
    .flatMap(({ block, align }) => {
      const out = [];
      for (let n = block.from; n <= block.to && n <= state.doc.lines; n++) out.push(lineClass[align].range(state.doc.line(n).from));
      return out;
    });
  return Decoration.set(ranges, true);
}

const alignDecorations = StateField.define<DecorationSet>({
  create: decorationsOf,
  update: (deco, tr) => (tr.docChanged || tr.effects.some((e) => e.is(changeAlign) || e.is(loadAligns)) ? decorationsOf(tr.state) : deco),
  provide: (f) => EditorView.decorations.from(f),
});

export const alignState: Extension = [alignField, invertAligns, alignDecorations];

/** True when a transaction changed alignments on purpose (to be saved). */
export function changesAligns(tr: Transaction): boolean {
  return tr.effects.some((e) => e.is(changeAlign));
}

/** Alignments as stored in the frontmatter, keys computed from the current text. */
export function storedAligns(state: EditorState): BlockAlign[] {
  const items = alignedBlocks(state);
  if (items.length === 0) return [];
  const lines = new Map(items.map(({ block, align }) => [block.from, align] as const));
  return alignsFromLines(lines, blocksOfDoc(state.doc));
}

/** Position of each stored alignment in a body (blocks resolved like sticker anchors). */
export function placeAligns(aligns: readonly BlockAlign[], doc: Text): AlignedBlock[] {
  return [...alignedLinesOf(aligns, doc.toString())].map(([line, align]) => ({ pos: doc.line(line).from, align }));
}

/** The blocks touched by the selection (every block a range covers), alignable or not. */
function selectedBlocks(state: EditorState): Block[] {
  const blocks = blocksOfDoc(state.doc);
  const picked = new Set<number>();
  for (const range of state.selection.ranges) {
    const first = state.doc.lineAt(range.from).number;
    const last = state.doc.lineAt(range.to).number;
    blocks.forEach((b, i) => {
      if (b.to >= first && b.from <= last) picked.add(i);
    });
    // On a blank line: the block before it.
    if (![...picked].length) picked.add(blockIndexAt(blocks, first));
  }
  return [...picked].filter((i) => i >= 0).map((i) => blocks[i]!);
}

/** Alignment of the block at the cursor ("left" also for code and tables: nothing to choose there). */
export function alignmentAt(state: EditorState): Alignment {
  const block = selectedBlocks(state)[0];
  if (!block) return "left";
  const pos = state.doc.line(block.from).from;
  const items = alignedBlocks(state);
  return items.find((a) => state.doc.line(a.block.from).from === pos)?.align ?? "left";
}

/** Whether the cursor is in a block that can be aligned (not code, table, rule, image). */
export function canAlignAt(state: EditorState): boolean {
  return selectedBlocks(state).some((b) => isAlignable(b.type));
}

/** Aligns the blocks of the selection: one Ctrl+Z. False when none of them can be aligned. */
export function alignSelection(view: EditorView, align: Alignment): boolean {
  const { state } = view;
  const current = new Map(alignedBlocks(state).map(({ block, align: a }) => [block.from, a] as const));
  const after = align === "left" ? null : align;
  const changes: AlignChange[] = selectedBlocks(state)
    .filter((b) => isAlignable(b.type))
    .flatMap((b) => {
      const before = current.get(b.from) ?? null;
      return before === after ? [] : [{ pos: state.doc.line(b.from).from, before, after }];
    });
  if (!canAlignAt(state)) return false;
  if (changes.length) view.dispatch(alignTransaction(changes));
  return true;
}

export function alignTransaction(changes: AlignChange[]): TransactionSpec {
  return { effects: changes.map((c) => changeAlign.of(c)), annotations: [isolateHistory.of("full"), Transaction.userEvent.of("ursa.align")] };
}

export const alignCommand = (align: Alignment) => (view: EditorView) => alignSelection(view, align);

/**
 * Right-click in the text (or the context menu key): the block's menu, for its
 * alignment, the cursor moved to the clicked block first. With text selected,
 * or Shift held, the system menu (clipboard, spelling suggestions) opens instead.
 */
export const blockMenuHandlers = EditorView.domEventHandlers({
  contextmenu(e, view) {
    if (e.shiftKey || !view.state.selection.main.empty) return false;
    const target = e.target as Element | null;
    // Images, cards, stickers and widgets have their own menus.
    if (!target?.closest(".cm-line") || target.closest(".cm-embed, .cm-widget, [contenteditable=false]")) return false;
    const keyboard = e.button !== 2 || (e.clientX === 0 && e.clientY === 0);
    let at = { x: e.clientX, y: e.clientY };
    if (!keyboard) {
      const pos = view.posAtCoords(at);
      if (pos !== null) view.dispatch({ selection: { anchor: pos }, userEvent: "select.pointer" });
    } else {
      const c = view.coordsAtPos(view.state.selection.main.head);
      if (c) at = { x: c.left, y: c.bottom };
    }
    // Code, tables: nothing to align, the system menu opens.
    if (!canAlignAt(view.state)) return false;
    e.preventDefault();
    editorHooks().openBlockMenu(at);
    return true;
  },
});
