/**
 * Line-level formatting from the toolbar: block style (text, headings,
 * quote) and lists (bullets, numbers, tasks). Pure edits on line texts, in
 * the Markdown anyone else can read. Code blocks are handled by the editor
 * (it knows the fences); these functions never see their lines.
 */

export type BlockStyle = "text" | "h1" | "h2" | "h3" | "quote";
export type ListKind = "bullet" | "ordered" | "task";

export interface LineEdit {
  /** 1-based line number. */
  line: number;
  /** Range in the line's text, and its replacement. */
  from: number;
  to: number;
  insert: string;
}

interface Parts {
  /** Indentation and quote markers kept in front (`  > `). */
  quote: string;
  indent: string;
  heading: string;
  list: string;
  rest: string;
}

const QUOTE = /^((?:[ \t]{0,3}>[ \t]?)*)/;
const INDENT = /^([ \t]*)/;
const HEADING = /^(#{1,6})(?:[ \t]+|$)/;
const LIST = /^((?:[-*+]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?)/;

function split(text: string): Parts {
  const quote = QUOTE.exec(text)![1]!;
  let rest = text.slice(quote.length);
  const indent = INDENT.exec(rest)![1]!;
  rest = rest.slice(indent.length);
  const heading = HEADING.exec(rest)?.[0] ?? "";
  rest = rest.slice(heading.length);
  const list = heading ? "" : (LIST.exec(rest)?.[1] ?? "");
  rest = rest.slice(list.length);
  return { quote, indent, heading, list, rest };
}

const levelOf = (heading: string) => heading.replace(/[ \t]+$/, "").length;

/** Current block style of a line (what the toolbar shows). */
export function blockStyleOf(text: string): BlockStyle {
  const p = split(text);
  const level = levelOf(p.heading);
  if (level >= 1 && level <= 3) return `h${level}` as BlockStyle;
  if (p.quote.includes(">")) return "quote";
  return "text";
}

function edit(line: number, text: string, next: string): LineEdit[] {
  if (next === text) return [];
  // Smallest change: the common prefix and suffix are kept (the cursor stays in place).
  let start = 0;
  while (start < text.length && start < next.length && text[start] === next[start]) start++;
  let end = 0;
  while (end < text.length - start && end < next.length - start && text[text.length - 1 - end] === next[next.length - 1 - end]) end++;
  return [{ line, from: start, to: text.length - end, insert: next.slice(start, next.length - end) }];
}

/** Gives every line the block style (a heading or text drops its quote marker; a quote keeps the heading out). */
export function setBlockStyleEdits(lines: ReadonlyArray<{ line: number; text: string }>, style: BlockStyle): LineEdit[] {
  return lines.flatMap(({ line, text }) => {
    const p = split(text);
    if (p.rest.trim() === "" && !p.heading && !p.list && style !== "quote" && !p.quote.includes(">")) return [];
    const body = `${p.indent}${p.list}${p.rest}`;
    let next: string;
    if (style === "quote") next = `${p.quote.includes(">") ? p.quote : `${p.quote}> `}${body}`;
    else {
      const outside = p.quote.replace(/>[ \t]?/g, "");
      next = style === "text" ? `${outside}${body}` : `${outside}${"#".repeat(Number(style[1]))} ${p.indent}${p.rest}`;
    }
    return edit(line, text, next);
  });
}

const kindOf = (list: string): ListKind | null => (!list ? null : /\[[ xX]\]/.test(list) ? "task" : /^\d/.test(list) ? "ordered" : "bullet");

/** List kind of a line, or null. */
export function listKindOf(text: string): ListKind | null {
  return kindOf(split(text).list);
}

/**
 * Turns the lines into a list of that kind, or back into text when they all
 * are one already (a toggle). Numbers follow each other from 1; a task keeps
 * whether it was done.
 */
export function setListEdits(lines: ReadonlyArray<{ line: number; text: string }>, kind: ListKind): LineEdit[] {
  const parts = lines.map((l) => ({ ...l, p: split(l.text) }));
  const nonEmpty = parts.filter(({ p }) => p.rest.trim() !== "" || p.list);
  const remove = nonEmpty.length > 0 && nonEmpty.every(({ p }) => kindOf(p.list) === kind);
  let n = 0;
  return parts.flatMap(({ line, text, p }) => {
    if (p.rest.trim() === "" && !p.list) return [];
    let marker = "";
    if (!remove) {
      n++;
      const done = /\[[xX]\]/.test(p.list);
      marker = kind === "bullet" ? "- " : kind === "ordered" ? `${n}. ` : `- [${done ? "x" : " "}] `;
    }
    // A heading becomes a list item's text.
    return edit(line, text, `${p.quote}${p.indent}${marker}${p.rest}`);
  });
}
