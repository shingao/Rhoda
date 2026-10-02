import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import type { Tree } from "@lezer/common";
import { stripInline } from "../../core/note/text";

/** A Markdown heading as seen by the shared grammar (so `#` in code is never one). */
export interface Heading {
  /** Start of its first line. */
  from: number;
  /** End of its last line (the underline of a Setext heading). */
  to: number;
  level: number;
  /** Plain text, without `#`, closing hashes or inline syntax. */
  text: string;
}

/** Block nodes that may contain headings; everything else is skipped without looking inside. */
const CONTAINERS = new Set(["Document", "Blockquote", "BulletList", "OrderedList", "ListItem"]);

/** Budget for parsing what is missing of a long document, in ms. */
const PARSE_BUDGET = 200;

function headingLevel(name: string): number {
  const atx = /^ATXHeading(\d)$/.exec(name);
  if (atx) return Number(atx[1]);
  if (name === "SetextHeading1") return 1;
  if (name === "SetextHeading2") return 2;
  return 0;
}

function fullTree(state: EditorState, upTo: number): Tree {
  const tree = syntaxTree(state);
  if (tree.length >= upTo) return tree;
  return ensureSyntaxTree(state, upTo, PARSE_BUDGET) ?? tree;
}

function toHeading(state: EditorState, from: number, to: number, level: number): Heading {
  const first = state.doc.lineAt(from);
  const last = state.doc.lineAt(to);
  const raw = level && /^#/.test(first.text) ? first.text.replace(/^#{1,6}\s*/, "").replace(/\s+#+\s*$/, "") : first.text;
  return { from: first.from, to: last.to, level, text: stripInline(raw).trim() };
}

/** Headings between `from` and `to` (the whole document by default), in order. */
export function headingsIn(state: EditorState, from = 0, to = state.doc.length): Heading[] {
  const out: Heading[] = [];
  fullTree(state, to).iterate({
    from,
    to,
    enter: (node) => {
      const level = headingLevel(node.name);
      if (level) out.push(toHeading(state, node.from, node.to, level));
      return CONTAINERS.has(node.name);
    },
  });
  return out;
}

/** The heading whose first line starts at `lineFrom`, if any. */
export function headingAt(state: EditorState, lineFrom: number): Heading | null {
  if (lineFrom < 0 || lineFrom > state.doc.length) return null;
  const line = state.doc.lineAt(lineFrom);
  if (line.from !== lineFrom) return null;
  for (const h of headingsIn(state, line.from, line.to)) if (h.from === line.from) return h;
  return null;
}

/**
 * Range hidden when a heading is folded: from the end of the heading to the
 * end of the last non-blank line before the next heading of the same or a
 * higher level. Trailing blank lines stay visible so spacing is unchanged.
 * Null when the section has no content.
 */
export function sectionBody(state: EditorState, heading: Heading): { from: number; to: number } | null {
  const { doc } = state;
  const nextHeading = (tree: Tree) => {
    let end = -1;
    tree.iterate({
      from: heading.to + 1,
      enter: (node) => {
        if (end >= 0) return false;
        const level = headingLevel(node.name);
        if (level && node.from > heading.to && level <= heading.level) end = node.from;
        return CONTAINERS.has(node.name);
      },
    });
    return end;
  };
  // Usually the next heading is in the parsed part; parse the rest only if needed.
  const tree = syntaxTree(state);
  let end = nextHeading(tree);
  if (end < 0 && tree.length < doc.length) end = nextHeading(fullTree(state, doc.length));
  if (end < 0) end = doc.length;
  let last = doc.lineAt(Math.max(heading.to, end - 1));
  while (last.from > heading.to && last.text.trim() === "") last = doc.line(last.number - 1);
  return last.to > heading.to ? { from: heading.to, to: last.to } : null;
}

/** "7 tasks · 4 done" counts for the badge of a folded section. */
export function taskCounts(text: string): { done: number; total: number } {
  let done = 0;
  let total = 0;
  for (const m of text.matchAll(/^\s*(?:[-*+]|\d+[.)])\s+\[([ xX])\]/gm)) {
    total++;
    if (m[1] !== " ") done++;
  }
  return { done, total };
}
