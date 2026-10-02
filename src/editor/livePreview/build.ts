import { syntaxTree } from "@codemirror/language";
import type { EditorState, Range } from "@codemirror/state";
import { Decoration, type DecorationSet, type EditorView } from "@codemirror/view";
import type { SyntaxNode, SyntaxNodeRef } from "@lezer/common";
import { isInHeading } from "../../core/markdown/syntax";
import { editorHooks } from "../hooks";
import { BulletWidget, CheckboxWidget, CopyCodeWidget, NumberWidget } from "./widgets";

/**
 * Live Markdown rendering [DESIGN §3]. Syntax is hidden outside the lines that
 * hold the cursor or a selection, and shown faded on them. Only the visible
 * ranges are walked, so the cost does not grow with the note's length.
 */

/** Heights used to keep code blocks on the vertical rhythm, read from tokens. */
export interface CodeMetrics {
  header: number;
  line: number;
  padBottom: number;
  rhythm: number;
}

/**
 * Height of a code block's closing line so the whole block is a multiple of
 * the rhythm [DESIGN §6]. `body` = height of the code lines, measured on screen
 * (a long line wraps) or estimated from their count before the first measure.
 */
export function codeClosingHeight(m: CodeMetrics, body: number): number {
  const total = Math.ceil((m.header + body + m.padBottom) / m.rhythm - 1e-6) * m.rhythm;
  return total - m.header - body;
}

/** Bottom padding of an indented code block's last line, for the same rounding. */
export function indentedTailPadding(m: CodeMetrics, body: number): number {
  return Math.ceil((body + m.padBottom) / m.rhythm - 1e-6) * m.rhythm - body;
}

/**
 * Code blocks drawn in the last build, and the height of their code lines as
 * measured on screen (keyed by the block's start), fed back into the next build.
 */
export interface CodeLayout {
  measured: Map<number, number>;
  blocks: Array<{ from: number; firstLine: number; lastLine: number; padding: number }>;
}

const hidden = Decoration.replace({});
const marks = new Map<string, Decoration>();
function mark(cls: string): Decoration {
  let d = marks.get(cls);
  if (!d) marks.set(cls, (d = Decoration.mark({ class: cls })));
  return d;
}
const lineDecos = new Map<string, Decoration>();
function lineDeco(cls: string, style?: string): Decoration {
  const key = `${cls}|${style ?? ""}`;
  let d = lineDecos.get(key);
  if (!d) lineDecos.set(key, (d = Decoration.line({ class: cls, attributes: style ? { style } : {} })));
  return d;
}
const headingDecos = Array.from({ length: 7 }, (_, level) =>
  Decoration.line({ class: `cm-h cm-h${level}`, attributes: { "data-heading": `H${level}` } }),
);

const LIST_TYPES = new Set(["BulletList", "OrderedList"]);
/** Leading blockquote markers, which belong to the quote rather than to the list item. */
const QUOTE_PREFIX = /^(?:[ \t]*>[ \t]?)*/;

function ancestors(node: SyntaxNode, names: Set<string> | string): number {
  let count = 0;
  for (let p: SyntaxNode | null = node.parent; p; p = p.parent) {
    if (typeof names === "string" ? p.name === names : names.has(p.name)) count++;
  }
  return count;
}

export function buildDecorations(view: EditorView, revealed: ReadonlySet<number>, metrics: CodeMetrics, code?: CodeLayout): DecorationSet {
  if (code) code.blocks = [];
  const { state } = view;
  const doc = state.doc;
  const out: Range<Decoration>[] = [];
  const replaced: Range<Decoration>[] = [];
  const seen = new Set<string>();

  const lineOf = (pos: number) => doc.lineAt(pos);
  const isRevealed = (pos: number) => revealed.has(lineOf(pos).number);
  const blockRevealed = (fromLine: number, toLine: number) => {
    for (const n of revealed) if (n >= fromLine && n <= toLine) return true;
    return false;
  };

  const addMark = (cls: string, from: number, to: number) => {
    if (to > from) out.push(mark(cls).range(from, to));
  };
  const addLine = (pos: number, deco: Decoration) => {
    const key = `${pos}|${deco.spec.class as string}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(deco.range(pos));
  };
  const replace = (from: number, to: number, deco: Decoration = hidden) => {
    if (to > from) replaced.push(deco.range(from, to));
  };
  /** Syntax characters: faded on a revealed line, hidden elsewhere. */
  const syntax = (from: number, to: number, reveal: boolean, extra = "") => {
    if (to <= from) return;
    if (reveal) addMark(extra ? `cm-syntax ${extra}` : "cm-syntax", from, to);
    else replace(from, to);
  };
  /** End of a marker plus the single space that follows it, if any. */
  const withSpace = (to: number) => (doc.sliceString(to, to + 1) === " " ? to + 1 : to);

  const visibleLines = (from: number, to: number, rangeFrom: number, rangeTo: number) => {
    const first = lineOf(Math.max(from, rangeFrom)).number;
    const last = lineOf(Math.min(to, rangeTo)).number;
    return { first, last };
  };

  /**
   * CodeMirror estimates the height of lines it has not drawn from one short
   * plain-text line it finds on screen. A code line (22.3 px) or a Setext title
   * picked as that sample made the whole estimate swing by 20 % and the view
   * re-measure in a loop on long notes. A mark makes such lines ineligible.
   */
  function notASample(from: number, to: number) {
    if (to > from) addMark("cm-unsampled", from, to);
  }

  function heading(node: SyntaxNode, level: number) {
    const line = lineOf(node.from);
    addLine(line.from, headingDecos[level]!);
    const reveal = revealed.has(line.number);
    for (let c = node.firstChild; c; c = c.nextSibling) {
      if (c.name !== "HeaderMark") continue;
      if (c.from === node.from) syntax(c.from, withSpace(c.to), reveal, "cm-heading-mark");
      else {
        // Optional closing hashes: hide them with the spaces before them.
        let start = c.from;
        while (start > line.from && doc.sliceString(start - 1, start) === " ") start--;
        syntax(start, c.to, reveal, "cm-heading-mark");
      }
    }
  }

  function setextHeading(node: SyntaxNode, level: number) {
    const underline = node.getChild("HeaderMark");
    const last = underline ? lineOf(underline.from).number - 1 : lineOf(node.to).number;
    for (let n = lineOf(node.from).number; n <= last; n++) {
      addLine(doc.line(n).from, headingDecos[level]!);
      notASample(doc.line(n).from, doc.line(n).to);
    }
    if (underline) addMark("cm-syntax", underline.from, underline.to);
  }

  function link(node: SyntaxNode) {
    const linkMarks = node.getChildren("LinkMark");
    const open = linkMarks[0];
    const close = linkMarks[1];
    if (!open || !close) return;
    const reveal = isRevealed(node.from);
    syntax(open.from, open.to, reveal);
    // With its syntax visible, the link loses its underline (maquette 02b).
    addMark(reveal ? "cm-link cm-link-revealed" : "cm-link", open.to, close.from);
    syntax(close.from, node.to, reveal);
  }

  function wikiLink(node: SyntaxNode) {
    const reveal = isRevealed(node.from);
    const [open, close] = node.getChildren("WikiLinkMark");
    const target = node.getChild("WikiLinkTarget");
    const alias = node.getChild("WikiLinkAlias");
    if (!open || !close || !target) return;
    syntax(open.from, open.to, reveal);
    syntax(close.from, close.to, reveal);
    const title = doc.sliceString(target.from, target.to).split("#")[0]!.trim();
    const broken = title !== "" && !editorHooks().linkExists(title);
    const cls = `cm-wikilink${broken ? " cm-wikilink-broken" : ""}${reveal ? " cm-wikilink-revealed" : ""}`;
    if (alias) {
      syntax(target.from, alias.from, reveal);
      addMark(cls, alias.from, alias.to);
    } else {
      addMark(cls, target.from, target.to);
    }
  }

  function listItem(node: SyntaxNode, rangeFrom: number, rangeTo: number) {
    const listMark = node.getChild("ListMark");
    if (!listMark) return;
    const level = ancestors(node, LIST_TYPES);
    const line = lineOf(node.from);
    const task = node.getChild("Task");
    const taskMarker = task?.getChild("TaskMarker") ?? null;
    const isTask = taskMarker !== null;
    const style = `--list-level:${level}`;
    const prefix = QUOTE_PREFIX.exec(line.text)?.[0].length ?? 0;
    const start = line.from + prefix;
    const end = withSpace((taskMarker ?? listMark).to);

    if (line.from >= rangeFrom && line.from <= rangeTo) {
      addLine(line.from, lineDeco(isTask ? "cm-list-line cm-task-line" : "cm-list-line", style));
      if (revealed.has(line.number)) {
        addMark(isTask ? "cm-syntax cm-list-raw cm-task-raw" : "cm-syntax cm-list-raw", start, end);
      } else {
        const ordered = node.parent?.name === "OrderedList";
        const widget = isTask
          ? new CheckboxWidget(/x/i.test(doc.sliceString(taskMarker.from, taskMarker.to)))
          : ordered
            ? new NumberWidget(doc.sliceString(listMark.from, listMark.to))
            : new BulletWidget();
        replace(start, end, Decoration.replace({ widget }));
      }
      if (isTask && /x/i.test(doc.sliceString(taskMarker.from, taskMarker.to))) addMark("cm-task-done", end, task!.to);
    }

    // Continuation lines of the item (not those of nested lists) keep the item's indent.
    const lastLine = lineOf(node.to).number;
    if (lastLine === line.number) return;
    // Line numbers of nested lists (a nested list starts after its line's indentation).
    const nested: Array<[number, number]> = [];
    for (let c = node.firstChild; c; c = c.nextSibling) {
      if (LIST_TYPES.has(c.name)) nested.push([lineOf(c.from).number, lineOf(c.to).number]);
    }
    const { first, last } = visibleLines(node.from, node.to, rangeFrom, rangeTo);
    for (let n = Math.max(first, line.number + 1); n <= Math.min(last, lastLine); n++) {
      if (nested.some(([f, t]) => n >= f && n <= t)) continue;
      const l = doc.line(n);
      addLine(l.from, lineDeco(isTask ? "cm-list-cont cm-task-cont" : "cm-list-cont", style));
      const indent = /^[ \t]*/.exec(l.text.slice(prefix))![0].length;
      if (indent > 0 && !revealed.has(n)) replace(l.from + prefix, l.from + prefix + indent);
    }
  }

  function blockquote(node: SyntaxNode, rangeFrom: number, rangeTo: number) {
    const nested = ancestors(node, "Blockquote") > 0;
    const firstLine = lineOf(node.from).number;
    const lastLine = lineOf(node.to).number;
    const { first, last } = visibleLines(node.from, node.to, rangeFrom, rangeTo);
    for (let n = first; n <= last; n++) {
      let cls = nested ? "cm-quote cm-quote-nested" : "cm-quote";
      if (n === firstLine) cls += " cm-quote-first";
      if (n === lastLine) cls += " cm-quote-last";
      addLine(doc.line(n).from, lineDeco(cls));
    }
  }

  function fencedCode(node: SyntaxNode, rangeFrom: number, rangeTo: number) {
    const startLine = lineOf(node.from);
    const endLine = lineOf(node.to);
    const codeMarks = node.getChildren("CodeMark");
    const open = codeMarks[0];
    const lastMark = codeMarks[codeMarks.length - 1];
    const close = lastMark && lastMark !== open && lineOf(lastMark.from).number > startLine.number ? lastMark : null;
    const info = node.getChild("CodeInfo");
    const reveal = blockRevealed(startLine.number, endLine.number);
    const lastCodeLine = close ? endLine.number - 1 : endLine.number;
    const codeLines = Math.max(0, lastCodeLine - startLine.number);
    const revealCls = reveal ? " cm-code-revealed" : "";
    const { first, last } = visibleLines(node.from, node.to, rangeFrom, rangeTo);

    for (let n = first; n <= last; n++) {
      const line = doc.line(n);
      if (n === startLine.number) {
        addLine(line.from, lineDeco(`cm-code cm-code-head${revealCls}`));
        if (open) {
          if (reveal) addMark("cm-syntax", open.from, info?.to ?? open.to);
          else {
            replace(open.from, info ? info.from : open.to);
            if (info) addMark("cm-code-lang", info.from, info.to);
          }
        }
        const body = codeLines > 0 ? doc.sliceString(doc.line(startLine.number + 1).from, doc.line(lastCodeLine).to) : "";
        out.push(Decoration.widget({ widget: new CopyCodeWidget(body), side: 1 }).range(line.to));
      } else if (close && n === endLine.number) {
        const h = codeClosingHeight(metrics, code?.measured.get(node.from) ?? codeLines * metrics.line);
        addLine(line.from, lineDeco(`cm-code cm-code-close${revealCls}`, `height:${h}px;line-height:${h}px`));
        syntax(close.from, close.to, reveal);
      } else {
        const tail = !close && n === endLine.number ? " cm-code-tail" : "";
        addLine(line.from, lineDeco(`cm-code cm-code-line${tail}${revealCls}`));
        notASample(line.from, line.to);
      }
    }
    if (code && codeLines > 0) {
      code.blocks.push({ from: node.from, firstLine: startLine.number + 1, lastLine: lastCodeLine, padding: 0 });
    }
  }

  function indentedCode(node: SyntaxNode, rangeFrom: number, rangeTo: number) {
    const firstLine = lineOf(node.from).number;
    const lastLine = lineOf(node.to).number;
    const { first, last } = visibleLines(node.from, node.to, rangeFrom, rangeTo);
    for (let n = first; n <= last; n++) {
      let cls = "cm-code cm-code-line cm-code-indented";
      if (n === firstLine) cls += " cm-code-first";
      if (n === lastLine) cls += " cm-code-tail";
      const padding = n === lastLine ? indentedTailPadding(metrics, code?.measured.get(node.from) ?? (lastLine - firstLine + 1) * metrics.line) : 0;
      addLine(doc.line(n).from, lineDeco(cls, padding ? `padding-bottom:${padding}px` : undefined));
      if (n === lastLine && code) code.blocks.push({ from: node.from, firstLine, lastLine, padding });
      notASample(doc.line(n).from, doc.line(n).to);
    }
  }

  function enter(ref: SyntaxNodeRef, rangeFrom: number, rangeTo: number): boolean {
    const name = ref.name;
    const atx = /^ATXHeading(\d)$/.exec(name);
    if (atx) {
      heading(ref.node, Number(atx[1]));
      return true;
    }
    switch (name) {
      case "SetextHeading1":
      case "SetextHeading2":
        setextHeading(ref.node, name === "SetextHeading1" ? 1 : 2);
        return true;
      case "Emphasis":
        addMark("cm-em", ref.from, ref.to);
        return true;
      case "StrongEmphasis":
        addMark("cm-strong", ref.from, ref.to);
        return true;
      case "Strikethrough":
        addMark("cm-strike", ref.from, ref.to);
        return true;
      case "Highlight":
        addMark("cm-highlight", ref.from, ref.to);
        return true;
      case "EmphasisMark":
      case "StrikethroughMark":
      case "HighlightMark":
        syntax(ref.from, ref.to, isRevealed(ref.from));
        return false;
      case "InlineCode": {
        // The pill wraps the code only; backticks sit outside it, faded and monospace (maquette 02b).
        const [open, close] = ref.node.getChildren("CodeMark");
        const reveal = isRevealed(ref.from);
        if (open) syntax(open.from, open.to, reveal, "cm-syntax-mono");
        if (close && close !== open) syntax(close.from, close.to, reveal, "cm-syntax-mono");
        addMark("cm-inline-code", open?.to ?? ref.from, close && close !== open ? close.from : ref.to);
        return false;
      }
      case "Escape":
        syntax(ref.from, ref.from + 1, isRevealed(ref.from));
        return false;
      case "Link":
        link(ref.node);
        return true;
      case "Autolink": {
        const url = ref.node.getChild("URL");
        if (url) addMark("cm-link", url.from, url.to);
        const reveal = isRevealed(ref.from);
        for (const m of ref.node.getChildren("LinkMark")) syntax(m.from, m.to, reveal);
        return false;
      }
      case "URL":
        // Bare URLs (GFM autolinks); URLs of [text](url) are handled by link().
        if (ref.node.parent?.name !== "Link" && ref.node.parent?.name !== "Image") addMark("cm-link", ref.from, ref.to);
        return false;
      case "WikiLink":
        wikiLink(ref.node);
        return false;
      case "Tag":
        // Titles never carry tags: there it is plain text.
        if (!isInHeading(ref.node)) addMark("cm-tag", ref.from, ref.to);
        return false;
      case "HorizontalRule": {
        const line = lineOf(ref.from);
        const reveal = revealed.has(line.number);
        addLine(line.from, lineDeco(reveal ? "cm-hr cm-hr-revealed" : "cm-hr"));
        syntax(ref.from, ref.to, reveal);
        return false;
      }
      case "Blockquote":
        blockquote(ref.node, rangeFrom, rangeTo);
        return true;
      case "QuoteMark":
        syntax(ref.from, withSpace(ref.to), isRevealed(ref.from));
        return false;
      case "ListItem":
        listItem(ref.node, rangeFrom, rangeTo);
        return true;
      case "FencedCode":
        fencedCode(ref.node, rangeFrom, rangeTo);
        return false;
      case "CodeBlock":
        indentedCode(ref.node, rangeFrom, rangeTo);
        return false;
      // Rendered in later phases (images: phase 7) or kept as plain text.
      case "Image":
      case "Table":
      case "HTMLBlock":
      case "CommentBlock":
      case "LinkReference":
        return false;
      default:
        return true;
    }
  }

  const tree = syntaxTree(state);
  for (const { from, to } of view.visibleRanges) {
    tree.iterate({ from, to, enter: (ref) => enter(ref, from, to) });
  }

  // Hidden ranges and widgets must never overlap: keep the first of any overlapping pair.
  replaced.sort((a, b) => a.from - b.from || a.to - b.to);
  let lastEnd = -1;
  for (const r of replaced) {
    if (r.from < lastEnd) continue;
    out.push(r);
    lastEnd = r.to;
  }
  return Decoration.set(out, true);
}

/** Lines touched by the selection, only while the editor has focus. */
export function revealedLines(state: EditorState, hasFocus: boolean): Set<number> {
  const lines = new Set<number>();
  if (!hasFocus) return lines;
  for (const r of state.selection.ranges) {
    const first = state.doc.lineAt(r.from).number;
    const last = state.doc.lineAt(r.to).number;
    for (let n = first; n <= last; n++) lines.add(n);
  }
  return lines;
}
