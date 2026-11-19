import { syntaxTree } from "@codemirror/language";
import { EditorSelection, type ChangeSpec, type EditorState, type SelectionRange } from "@codemirror/state";
import { ViewPlugin, type Command, type EditorView, type ViewUpdate } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import { blockStyleOf, listKindOf, setBlockStyleEdits, setListEdits, type BlockStyle, type LineEdit, type ListKind } from "../core/markdown/blockFormat";
import { closeTag, openTag, pairInlineTags, type HighlightColor, type TagPair, type TagSpan, type TextSize } from "../core/markdown/inlineTags";
import { alignField, alignmentAt, canAlignAt, alignSelection } from "./align";
import { editorHooks } from "./hooks";
import type { Alignment } from "../core/align";

/**
 * Formatting commands of the toolbar and its shortcuts. Everything is written
 * as plain Markdown (or the app's few inline tags, see inlineTags.ts), in one
 * transaction per command: Ctrl+Z undoes it with the text.
 */

export type InlineMark = "bold" | "italic" | "strike" | "underline";
export type BlockChoice = BlockStyle | "code";

/** What the toolbar shows for the selection. */
export interface FormatState {
  block: BlockChoice;
  list: ListKind | null;
  marks: Record<InlineMark, boolean>;
  /** null: not highlighted. */
  highlight: HighlightColor | null;
  size: TextSize | "normal";
  align: Alignment;
  canAlign: boolean;
  /** In a code block: inline formatting does not apply. */
  inCode: boolean;
}

const NODE: Record<"bold" | "italic" | "strike", { node: string; mark: string; text: string }> = {
  bold: { node: "StrongEmphasis", mark: "EmphasisMark", text: "**" },
  italic: { node: "Emphasis", mark: "EmphasisMark", text: "*" },
  strike: { node: "Strikethrough", mark: "StrikethroughMark", text: "~~" },
};

const INLINE_CONTAINERS = /^(Paragraph|ATXHeading\d|SetextHeading\d|TableCell)$/;

function ancestors(state: EditorState, pos: number, side: -1 | 1 = 1): SyntaxNode[] {
  const out: SyntaxNode[] = [];
  for (let n: SyntaxNode | null = syntaxTree(state).resolveInner(pos, side); n; n = n.parent) out.push(n);
  return out;
}

function inCode(state: EditorState, pos: number): boolean {
  return ancestors(state, pos).some((n) => n.name === "FencedCode" || n.name === "CodeBlock" || n.name === "InlineCode");
}

/** The paragraph or heading holding `pos`, if any. */
function container(state: EditorState, pos: number): SyntaxNode | null {
  return ancestors(state, pos).find((n) => INLINE_CONTAINERS.test(n.name)) ?? null;
}

/** The app's inline tags of the paragraph holding `pos`, paired. */
function tagPairs(state: EditorState, pos: number): TagPair[] {
  const node = container(state, pos);
  if (!node) return [];
  const tags: TagSpan[] = [];
  const cursor = node.cursor();
  while (cursor.next() && cursor.from < node.to) {
    if (cursor.name === "HTMLTag") tags.push({ from: cursor.from, to: cursor.to, text: state.doc.sliceString(cursor.from, cursor.to) });
  }
  return pairInlineTags(tags);
}

/** A node of that name around [from, to] (its content holds the range). */
function enclosing(state: EditorState, from: number, to: number, name: string): SyntaxNode | null {
  for (const n of ancestors(state, from)) {
    if (n.name === name && n.from <= from && n.to >= to) return n;
    if (INLINE_CONTAINERS.test(n.name)) break;
  }
  return null;
}

function enclosingPair(state: EditorState, from: number, to: number, kind: TagPair["kind"]): TagPair | null {
  const pairs = tagPairs(state, from).filter((p) => p.kind === kind && p.open.from <= from && p.close.to >= to);
  // The innermost one.
  return pairs.sort((a, b) => b.open.from - a.open.from)[0] ?? null;
}

/** Marks to remove so that a node's syntax goes and its text stays. */
function unwrapNode(node: SyntaxNode, markName: string): ChangeSpec[] {
  return node.getChildren(markName).map((m) => ({ from: m.from, to: m.to }));
}

const unwrapPair = (p: TagPair): ChangeSpec[] => [
  { from: p.open.from, to: p.open.to },
  { from: p.close.from, to: p.close.to },
];

function dispatch(view: EditorView, changes: ChangeSpec[], selection?: EditorSelection | SelectionRange): void {
  view.dispatch({ changes, ...(selection && { selection }), userEvent: "input.format", scrollIntoView: true });
}

/**
 * Wraps the selection in `open`…`close`, or the word at the cursor; with an
 * empty selection in no word, inserts the pair with the cursor between.
 */
function wrap(view: EditorView, open: string, close: string): void {
  const { state } = view;
  const range = state.selection.main;
  let { from, to } = range;
  if (from === to) {
    const word = state.wordAt(from);
    if (word) ({ from, to } = word);
  }
  const selection = from === to ? EditorSelection.cursor(from + open.length) : EditorSelection.range(from + open.length, to + open.length);
  dispatch(view, [{ from, insert: open }, { from: to, insert: close }], selection);
}

/** Bold, italic, strike: removed if the selection is in one, else added. Underline is a tag (<u>). */
export function toggleMark(view: EditorView, mark: InlineMark): boolean {
  const { state } = view;
  const { from, to } = state.selection.main;
  if (inCode(state, from)) return false;
  if (mark === "underline") {
    const pair = enclosingPair(state, from, to, "underline");
    if (pair) dispatch(view, unwrapPair(pair));
    else wrap(view, openTag("underline"), closeTag("underline"));
    return true;
  }
  const spec = NODE[mark];
  const node = enclosing(state, from, to, spec.node);
  if (node) dispatch(view, unwrapNode(node, spec.mark));
  else wrap(view, spec.text, spec.text);
  return true;
}

/** Highlight in a colour (yellow = `==…==`, the default), or none. Replaces the current one. */
export function setHighlight(view: EditorView, color: HighlightColor | null): boolean {
  const { state } = view;
  const { from, to } = state.selection.main;
  if (inCode(state, from)) return false;
  const node = enclosing(state, from, to, "Highlight");
  const pair = enclosingPair(state, from, to, "mark");
  const current = pair?.color ?? (node ? "yellow" : null);
  if (current === color) return true;
  const removal: ChangeSpec[] = node ? unwrapNode(node, "HighlightMark") : pair ? unwrapPair(pair) : [];
  if (removal.length) {
    if (color === null) {
      dispatch(view, removal);
      return true;
    }
    // Swap the markers in place: one transaction, the text untouched.
    const [open, close] = node ? [node.getChildren("HighlightMark")[0]!, node.getChildren("HighlightMark")[1]!] : [pair!.open, pair!.close];
    const [o, c] = color === "yellow" ? ["==", "=="] : [openTag("mark", color), closeTag("mark")];
    dispatch(view, [
      { from: open.from, to: open.to, insert: o },
      { from: close.from, to: close.to, insert: c },
    ]);
    return true;
  }
  if (color === null) return true;
  if (color === "yellow") wrap(view, "==", "==");
  else wrap(view, openTag("mark", color), closeTag("mark"));
  return true;
}

/** Relative size of the selection: small, normal or large (three steps, never nested). */
export function setTextSize(view: EditorView, size: TextSize | "normal"): boolean {
  const { state } = view;
  const { from, to } = state.selection.main;
  if (inCode(state, from)) return false;
  const pair = enclosingPair(state, from, to, "size");
  if ((pair?.size ?? "normal") === size) return true;
  if (pair && size === "normal") dispatch(view, unwrapPair(pair));
  else if (pair) dispatch(view, [{ from: pair.open.from, to: pair.open.to, insert: openTag("size", size as TextSize) }]);
  else wrap(view, openTag("size", size as TextSize), closeTag("size"));
  return true;
}

/** One step larger (sm → normal → lg) or smaller. */
export function stepTextSize(view: EditorView, step: 1 | -1): boolean {
  const order: Array<TextSize | "normal"> = ["sm", "normal", "lg"];
  const current = formatStateOf(view.state).size;
  const next = order[Math.max(0, Math.min(2, order.indexOf(current) + step))]!;
  return next === current ? true : setTextSize(view, next);
}

/** Removes bold, italic, strike, highlight, underline and sizes in the selection (the word at the cursor without one). */
export const clearFormatting: Command = (view) => {
  const { state } = view;
  let { from, to } = state.selection.main;
  if (from === to) {
    const word = state.wordAt(from);
    if (word) ({ from, to } = word);
  }
  const removals: Array<{ from: number; to: number }> = [];
  const touches = (a: number, b: number) => a <= to && b >= from;
  syntaxTree(state).iterate({
    from,
    to,
    enter: (n) => {
      if (n.name === "FencedCode" || n.name === "CodeBlock" || n.name === "InlineCode") return false;
      if (["StrongEmphasis", "Emphasis", "Strikethrough", "Highlight"].includes(n.name) && touches(n.from, n.to)) {
        for (let c = n.node.firstChild; c; c = c.nextSibling) if (/Mark$/.test(c.name)) removals.push({ from: c.from, to: c.to });
      }
      return undefined;
    },
  });
  const seen = new Set<number>();
  for (let pos = from; pos <= to; ) {
    const node = container(state, pos);
    if (!node) {
      pos = state.doc.lineAt(pos).to + 1;
      continue;
    }
    if (!seen.has(node.from)) {
      seen.add(node.from);
      for (const p of tagPairs(state, pos)) if (touches(p.open.from, p.close.to)) removals.push({ from: p.open.from, to: p.open.to }, { from: p.close.from, to: p.close.to });
    }
    pos = node.to + 1;
  }
  if (removals.length === 0) return true;
  const unique = [...new Map(removals.map((r) => [`${r.from}-${r.to}`, r])).values()].sort((a, b) => a.from - b.from);
  dispatch(view, unique);
  return true;
};

/** Lines of the selection (a selection ending at a line start does not take that line). */
function selectedLines(state: EditorState): Array<{ line: number; text: string }> {
  const out = new Map<number, string>();
  for (const r of state.selection.ranges) {
    const first = state.doc.lineAt(r.from).number;
    const last = state.doc.lineAt(r.to).number;
    for (let n = first; n <= last; n++) {
      const line = state.doc.line(n);
      if (n === last && n > first && r.to === line.from) continue;
      out.set(n, line.text);
    }
  }
  return [...out].sort((a, b) => a[0] - b[0]).map(([line, text]) => ({ line, text }));
}

function applyLineEdits(view: EditorView, edits: LineEdit[]): void {
  if (edits.length === 0) return;
  const { doc } = view.state;
  dispatch(
    view,
    edits.map((e) => {
      const at = doc.line(e.line).from;
      return { from: at + e.from, to: at + e.to, insert: e.insert };
    }),
  );
}

const codeBlockAt = (state: EditorState, pos: number) => ancestors(state, pos).find((n) => n.name === "FencedCode") ?? null;

/** Block style of the selected lines; "code" wraps them in a fenced block, or unwraps the block they are in. */
export function setBlockStyle(view: EditorView, style: BlockChoice): boolean {
  const { state } = view;
  const fence = codeBlockAt(state, state.selection.main.from);
  if (fence) {
    if (style === "code") return true;
    // Out of the code block: its fences go, its lines become text.
    const marks = fence.getChildren("CodeMark");
    const first = state.doc.lineAt(fence.from);
    const last = state.doc.lineAt(fence.to);
    const changes: ChangeSpec[] = [{ from: first.from, to: Math.min(first.to + 1, state.doc.length) }];
    if (marks.length > 1 && last.number > first.number) changes.push({ from: last.from - 1, to: last.to });
    dispatch(view, changes);
    return true;
  }
  const lines = selectedLines(state).filter((l) => !inCode(state, state.doc.line(l.line).from));
  if (lines.length === 0) return false;
  if (style === "code") {
    const from = state.doc.line(lines[0]!.line).from;
    const to = state.doc.line(lines[lines.length - 1]!.line).to;
    dispatch(view, [{ from, insert: "```\n" }, { from: to, insert: "\n```" }], EditorSelection.cursor(from + 4));
    return true;
  }
  applyLineEdits(view, setBlockStyleEdits(lines, style));
  return true;
}

/** Bullets, numbers or tasks for the selected lines (toggle when they all are already). */
export function toggleList(view: EditorView, kind: ListKind): boolean {
  const { state } = view;
  const lines = selectedLines(state).filter((l) => !inCode(state, state.doc.line(l.line).from));
  if (lines.length === 0) return false;
  applyLineEdits(view, setListEdits(lines, kind));
  return true;
}

const URL_LIKE = /^(https?:\/\/|mailto:|www\.)\S+$/i;

/** `[text](url)`: the selection becomes the text (or the URL when it is one); the cursor waits where something is missing. */
export const insertLink: Command = (view) => {
  const { state } = view;
  const { from, to } = state.selection.main;
  if (inCode(state, from)) return false;
  const text = state.sliceDoc(from, to);
  if (URL_LIKE.test(text)) {
    dispatch(view, [{ from, to, insert: `[](${text})` }], EditorSelection.cursor(from + 1));
  } else {
    const insert = `[${text}]()`;
    dispatch(view, [{ from, to, insert }], EditorSelection.cursor(from + insert.length - 1));
  }
  return true;
};

/** A horizontal rule on its own line after the current one (a blank line before it: never a Setext title). */
export const insertRule: Command = (view) => {
  const { state } = view;
  const line = state.doc.lineAt(state.selection.main.head);
  const before = line.text.trim() === "" ? "" : "\n\n";
  const insert = `${before}---\n`;
  dispatch(view, [{ from: line.to, insert }], EditorSelection.cursor(line.to + insert.length));
  return true;
};

/** What the toolbar shows, for the main selection. */
export function formatStateOf(state: EditorState): FormatState {
  const { from, to } = state.selection.main;
  const line = state.doc.lineAt(from);
  const code = codeBlockAt(state, from) !== null || ancestors(state, from).some((n) => n.name === "CodeBlock");
  const marks: Record<InlineMark, boolean> = {
    bold: enclosing(state, from, to, "StrongEmphasis") !== null,
    italic: enclosing(state, from, to, "Emphasis") !== null,
    strike: enclosing(state, from, to, "Strikethrough") !== null,
    underline: enclosingPair(state, from, to, "underline") !== null,
  };
  const markPair = enclosingPair(state, from, to, "mark");
  const highlight = markPair?.color ?? (enclosing(state, from, to, "Highlight") ? "yellow" : null);
  return {
    block: code ? "code" : blockStyleOf(line.text),
    list: code ? null : listKindOf(line.text),
    marks,
    highlight,
    size: enclosingPair(state, from, to, "size")?.size ?? "normal",
    align: alignmentAt(state),
    canAlign: canAlignAt(state),
    inCode: code || inCode(state, from),
  };
}

export const markCommand = (mark: InlineMark): Command => (view) => toggleMark(view, mark);
export const listCommand = (kind: ListKind): Command => (view) => toggleList(view, kind);
export const sizeStepCommand = (step: 1 | -1): Command => (view) => stepTextSize(view, step);
/** The shortcut highlights in yellow, or removes the highlight there is. */
export const highlightCommand: Command = (view) => setHighlight(view, formatStateOf(view.state).highlight ? null : "yellow");

/** A toolbar action on the selection of the open note. */
export type FormatAction =
  | { kind: "mark"; mark: InlineMark }
  | { kind: "highlight"; color: HighlightColor | null }
  | { kind: "size"; size: TextSize | "normal" }
  | { kind: "block"; style: BlockChoice }
  | { kind: "list"; list: ListKind }
  | { kind: "align"; align: Alignment }
  | { kind: "link" }
  | { kind: "rule" }
  | { kind: "clear" };

export function runFormat(view: EditorView, action: FormatAction): boolean {
  switch (action.kind) {
    case "mark":
      return toggleMark(view, action.mark);
    case "highlight":
      return setHighlight(view, action.color);
    case "size":
      return setTextSize(view, action.size);
    case "block":
      return setBlockStyle(view, action.style);
    case "list":
      return toggleList(view, action.list);
    case "align":
      return alignSelection(view, action.align);
    case "link":
      return insertLink(view);
    case "rule":
      return insertRule(view);
    case "clear":
      return clearFormatting(view);
  }
}

const sameFormat = (a: FormatState, b: FormatState) =>
  a.block === b.block &&
  a.list === b.list &&
  a.highlight === b.highlight &&
  a.size === b.size &&
  a.align === b.align &&
  a.canAlign === b.canAlign &&
  a.inCode === b.inCode &&
  (Object.keys(a.marks) as InlineMark[]).every((k) => a.marks[k] === b.marks[k]);

/** Reports the formatting at the cursor to the app when it changes (toolbar buttons). */
export const formatReporter = ViewPlugin.fromClass(
  class {
    last: FormatState | null = null;
    constructor(view: EditorView) {
      this.report(view.state);
    }
    update(u: ViewUpdate) {
      if (u.selectionSet || u.docChanged || syntaxTree(u.startState) !== syntaxTree(u.state) || u.startState.field(alignField, false) !== u.state.field(alignField, false)) {
        this.report(u.state);
      }
    }
    report(state: EditorState) {
      const next = formatStateOf(state);
      if (this.last && sameFormat(this.last, next)) return;
      this.last = next;
      editorHooks().formatChanged(next);
    }
  },
);
