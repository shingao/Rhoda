import type { SyntaxNode } from "@lezer/common";
import { parseEmbedLine } from "../markdown/embeds";
import { ursaParser } from "../markdown/syntax";

/**
 * A note as a document, for export: blocks and inline runs read with Ursa's
 * Markdown grammar (the same as the editor and the index). Every block keeps
 * the line it starts on, so stickers anchored to it can follow it.
 */

export type Inline =
  | { t: "text"; text: string }
  | { t: "strong" | "em" | "strike" | "highlight" | "underline"; children: Inline[] }
  | { t: "code"; text: string }
  | { t: "link"; href: string; children: Inline[] }
  | { t: "image"; alt: string; src: string }
  | { t: "wiki"; target: string; label: string }
  | { t: "tag"; name: string }
  | { t: "break" };

export type Align = "left" | "center" | "right" | null;

/** Block alignment set in the note (frontmatter `align:`); left when absent. */
export type TextAlign = "center" | "right" | "justify";

export interface ListItem {
  line: number;
  textAlign?: TextAlign;
  /** null: not a task. */
  checked: boolean | null;
  blocks: Block[];
}

/** `line`: where the block starts; `gap`: a blank line before it in the note (the editor's spacing). */
export type Block = { line: number; gap?: boolean } & (
  | { t: "heading"; level: number; children: Inline[]; textAlign?: TextAlign }
  | { t: "paragraph"; children: Inline[]; textAlign?: TextAlign }
  | { t: "list"; ordered: boolean; start: number; items: ListItem[] }
  | { t: "quote"; blocks: Block[]; textAlign?: TextAlign }
  | { t: "code"; lang: string; text: string }
  | { t: "rule" }
  | { t: "table"; align: Align[]; head: Inline[][]; rows: Inline[][][] }
  | { t: "image"; alt: string; src: string; width: number | null }
  | { t: "pdf"; label: string; src: string }
  | { t: "url"; url: string }
);

const MARKS = new Set(["EmphasisMark", "CodeMark", "LinkMark", "HighlightMark", "StrikethroughMark", "QuoteMark", "HeaderMark", "TaskMarker", "TagMark", "WikiLinkMark", "ListMark"]);

class Reader {
  /** Start offset of each line (0-based line index). */
  private readonly starts: number[] = [0];

  constructor(readonly src: string) {
    for (let i = 0; i < src.length; i++) if (src.charCodeAt(i) === 10) this.starts.push(i + 1);
  }

  /** Whether the line before `line` (1-based) is blank: the block is set apart from the previous one. */
  blankBefore(line: number): boolean {
    if (line < 2) return false;
    const from = this.starts[line - 2]!;
    const to = this.starts[line - 1]! - 1;
    return this.src.slice(from, to).trim() === "";
  }

  /** 1-based line of an offset. */
  line(pos: number): number {
    let lo = 0;
    let hi = this.starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.starts[mid]! <= pos) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  }

  slice(from: number, to: number): string {
    return this.src.slice(from, to);
  }

  /** Inline runs of the range [from, to) of a node, its marks left out. */
  inlines(node: SyntaxNode, from = node.from, to = node.to): Inline[] {
    const out: Inline[] = [];
    // `<u>…</u>` (Ctrl+U, decision D12): the runs in between are underlined.
    const stack: Inline[][] = [out];
    const push = (inline: Inline) => stack[stack.length - 1]!.push(inline);
    let pos = from;
    const text = (end: number) => {
      if (end > pos) pushText(push, this.slice(pos, end));
    };
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (child.to <= from || child.from >= to) continue;
      text(child.from);
      pos = child.to;
      if (child.name === "QuoteMark") {
        while (this.src[pos] === " ") pos++;
        continue;
      }
      if (child.name === "HTMLTag") {
        const tag = this.slice(child.from, child.to).toLowerCase();
        if (tag === "<u>") {
          const children: Inline[] = [];
          push({ t: "underline", children });
          stack.push(children);
        } else if (tag === "</u>" && stack.length > 1) stack.pop();
        else push({ t: "text", text: this.slice(child.from, child.to) });
        continue;
      }
      const inline = this.inline(child);
      if (inline) push(inline);
    }
    text(to);
    return trimRuns(out);
  }

  private inline(node: SyntaxNode): Inline | null {
    const raw = () => this.slice(node.from, node.to);
    switch (node.name) {
      case "StrongEmphasis":
        return { t: "strong", children: this.inlines(node) };
      case "Emphasis":
        return { t: "em", children: this.inlines(node) };
      case "Strikethrough":
        return { t: "strike", children: this.inlines(node) };
      case "Highlight":
        return { t: "highlight", children: this.inlines(node) };
      case "InlineCode": {
        const marks = node.getChildren("CodeMark");
        const from = marks[0]?.to ?? node.from;
        const to = marks.length > 1 ? marks[marks.length - 1]!.from : node.to;
        return { t: "code", text: this.slice(from, to).replace(/^ (.*) $/s, "$1") };
      }
      case "Link": {
        const url = node.getChild("URL");
        const label = node.getChildren("LinkMark");
        const href = url ? unwrap(this.slice(url.from, url.to)) : "";
        if (!href || label.length < 2) return { t: "text", text: raw() };
        return { t: "link", href, children: this.inlines(node, label[0]!.to, label[1]!.from) };
      }
      case "Image": {
        const url = node.getChild("URL");
        const marks = node.getChildren("LinkMark");
        const alt = marks.length >= 2 ? this.slice(marks[0]!.to, marks[1]!.from) : "";
        return url ? { t: "image", alt, src: unwrap(this.slice(url.from, url.to)) } : { t: "text", text: raw() };
      }
      case "Autolink": {
        const url = node.getChild("URL");
        const href = url ? this.slice(url.from, url.to) : raw();
        return { t: "link", href, children: [{ t: "text", text: href }] };
      }
      case "URL":
        return { t: "link", href: raw(), children: [{ t: "text", text: raw() }] };
      case "WikiLink": {
        const target = node.getChild("WikiLinkTarget");
        const alias = node.getChild("WikiLinkAlias");
        const name = target ? this.slice(target.from, target.to).trim() : "";
        return { t: "wiki", target: name, label: alias ? this.slice(alias.from, alias.to).trim() : name };
      }
      case "Tag": {
        const name = raw().replace(/^#/, "").replace(/#$/, "");
        // Titles never carry tags: plain text there.
        return isInHeading(node) ? { t: "text", text: raw() } : { t: "tag", name };
      }
      case "HardBreak":
        return { t: "break" };
      case "Escape":
        return { t: "text", text: raw().slice(1) };
      case "Entity":
        return { t: "text", text: decodeEntity(raw()) };
      default:
        if (MARKS.has(node.name)) return null;
        return { t: "text", text: raw() };
    }
  }
}

const isInHeading = (node: SyntaxNode) => {
  for (let p = node.parent; p; p = p.parent) if (/Heading/.test(p.name)) return true;
  return false;
};

const unwrap = (dest: string) => (dest.startsWith("<") && dest.endsWith(">") ? dest.slice(1, -1) : dest);

function decodeEntity(entity: string): string {
  const named: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'", "&nbsp;": " " };
  if (named[entity]) return named[entity];
  const code = /^&#(x?)([0-9a-f]+);$/i.exec(entity);
  return code ? String.fromCodePoint(parseInt(code[2]!, code[1] ? 16 : 10)) : entity;
}

/** Soft line breaks become spaces; the indentation and quote marks of continuation lines go. */
function pushText(push: (i: Inline) => void, text: string): void {
  const clean = text.replace(/\n[ \t>]*/g, " ");
  if (clean) push({ t: "text", text: clean });
}

/** Adjacent text runs merged; leading and trailing spaces removed (marks often leave some). */
function trimRuns(input: Inline[]): Inline[] {
  const runs: Inline[] = [];
  for (const run of input) {
    const prev = runs[runs.length - 1];
    if (run.t === "text" && prev?.t === "text") prev.text += run.text;
    else runs.push(run);
  }
  const first = runs[0];
  if (first?.t === "text") first.text = first.text.replace(/^\s+/, "");
  const last = runs[runs.length - 1];
  if (last?.t === "text") last.text = last.text.replace(/\s+$/, "");
  return runs.filter((r) => r.t !== "text" || r.text !== "");
}

/**
 * The document of a note body (without its frontmatter). `aligned`: block
 * alignments by the line their block starts on (`alignedLinesOf`).
 */
export function parseDocument(body: string, aligned?: ReadonlyMap<number, TextAlign>): Block[] {
  const reader = new Reader(body);
  const blocks = blocksOfNode(reader, ursaParser.parse(body).topNode);
  return aligned?.size ? withAlignment(blocks, aligned) : blocks;
}

/** Headings, paragraphs, quotes and list items starting on an aligned line take its alignment. */
function withAlignment(blocks: Block[], aligned: ReadonlyMap<number, TextAlign>): Block[] {
  return blocks.map((b): Block => {
    const textAlign = aligned.get(b.line);
    switch (b.t) {
      case "heading":
      case "paragraph":
        return textAlign ? { ...b, textAlign } : b;
      case "quote":
        return { ...b, ...(textAlign && { textAlign }), blocks: withAlignment(b.blocks, aligned) };
      case "list":
        return {
          ...b,
          items: b.items.map((item) => {
            const own = aligned.get(item.line);
            return { ...item, ...(own && { textAlign: own }), blocks: withAlignment(item.blocks, aligned) };
          }),
        };
      default:
        return b;
    }
  });
}

function blocksOfNode(r: Reader, parent: SyntaxNode): Block[] {
  const out: Block[] = [];
  for (let node = parent.firstChild; node; node = node.nextSibling) out.push(...block(r, node));
  return withGaps(r, out);
}

function withGaps(r: Reader, blocks: Block[]): Block[] {
  return blocks.map((b, i) => (i > 0 && r.blankBefore(b.line) ? { ...b, gap: true } : b));
}

function block(r: Reader, node: SyntaxNode): Block[] {
  const line = r.line(node.from);
  const heading = /^(?:ATXHeading|SetextHeading)(\d)$/.exec(node.name);
  if (heading) {
    // ATX: content between the opening marks and optional closing ones.
    const marks = node.getChildren("HeaderMark");
    const from = node.name.startsWith("ATX") ? (marks[0]?.to ?? node.from) : node.from;
    const to = node.name.startsWith("ATX") && marks.length > 1 ? marks[marks.length - 1]!.from : node.name.startsWith("Setext") ? (marks[0]?.from ?? node.to) : node.to;
    return [{ t: "heading", line, level: Number(heading[1]), children: r.inlines(node, from, to) }];
  }
  switch (node.name) {
    case "Paragraph":
      return paragraph(r, node);
    case "BulletList":
    case "OrderedList": {
      const items: ListItem[] = node.getChildren("ListItem").map((item) => listItem(r, item));
      const mark = node.getChild("ListItem")?.getChild("ListMark");
      const start = mark ? parseInt(r.slice(mark.from, mark.to), 10) : 1;
      return [{ t: "list", line, ordered: node.name === "OrderedList", start: Number.isFinite(start) ? start : 1, items }];
    }
    case "Blockquote":
      return [{ t: "quote", line, blocks: blocksOfNode(r, node) }];
    case "FencedCode": {
      const info = node.getChild("CodeInfo");
      const text = node.getChild("CodeText");
      return [{ t: "code", line, lang: info ? r.slice(info.from, info.to).trim() : "", text: text ? r.slice(text.from, text.to) : "" }];
    }
    case "CodeBlock": {
      const text = r.slice(node.from, node.to).replace(/^( {4}|\t)/gm, "");
      return [{ t: "code", line, lang: "", text }];
    }
    case "HorizontalRule":
      return [{ t: "rule", line }];
    case "Table":
      return [table(r, node, line)];
    case "HTMLBlock":
    case "CommentBlock":
    case "ProcessingInstructionBlock": {
      const text = r.slice(node.from, node.to);
      // Comments are not content; other raw HTML is shown as written (never interpreted).
      return node.name === "CommentBlock" || /^\s*<!--/.test(text) ? [] : [{ t: "paragraph", line, children: [{ t: "text", text }] }];
    }
    case "LinkReference":
      return [];
    default:
      return [];
  }
}

/**
 * A paragraph; its lines that are an image, a PDF or a URL alone are blocks of
 * their own, as in the editor (`embedLines`).
 */
function paragraph(r: Reader, node: SyntaxNode): Block[] {
  const text = r.slice(node.from, node.to);
  const lines = text.split("\n");
  if (!lines.some((l) => parseEmbedLine(l))) return [{ t: "paragraph", line: r.line(node.from), children: r.inlines(node) }];
  const out: Block[] = [];
  let offset = node.from;
  let runFrom = -1;
  const flush = (end: number) => {
    if (runFrom < 0) return;
    out.push({ t: "paragraph", line: r.line(runFrom), children: r.inlines(node, runFrom, end) });
    runFrom = -1;
  };
  for (const lineText of lines) {
    const embed = parseEmbedLine(lineText);
    if (embed) {
      flush(Math.max(offset - 1, node.from));
      const line = r.line(offset);
      if (embed.kind === "image") out.push({ t: "image", line, alt: embed.alt, src: embed.src, width: embed.width });
      else if (embed.kind === "pdf") out.push({ t: "pdf", line, label: embed.label, src: embed.src });
      else out.push({ t: "url", line, url: embed.url });
    } else if (runFrom < 0) runFrom = offset;
    offset += lineText.length + 1;
  }
  flush(node.to);
  return out.filter((b) => b.t !== "paragraph" || b.children.length > 0);
}

function listItem(r: Reader, item: SyntaxNode): ListItem {
  const line = r.line(item.from);
  const task = item.getChild("Task");
  const blocks: Block[] = [];
  let checked: boolean | null = null;
  for (let child = item.firstChild; child; child = child.nextSibling) {
    if (child.name === "ListMark") continue;
    if (child.name === "Task") {
      const marker = child.getChild("TaskMarker");
      checked = marker ? /x/i.test(r.slice(marker.from, marker.to)) : false;
      blocks.push({ t: "paragraph", line, children: r.inlines(child) });
    } else blocks.push(...block(r, child));
  }
  return { line, checked: task ? checked : null, blocks: withGaps(r, blocks) };
}

function table(r: Reader, node: SyntaxNode, line: number): Block {
  const cells = (row: SyntaxNode) => row.getChildren("TableCell").map((cell) => r.inlines(cell));
  const header = node.getChild("TableHeader");
  const delimiter = node.getChildren("TableDelimiter").find((d) => /-/.test(r.slice(d.from, d.to)));
  const align: Align[] = delimiter
    ? r
        .slice(delimiter.from, delimiter.to)
        .replace(/^\s*\||\|\s*$/g, "")
        .split("|")
        .map((spec) => {
          const s = spec.trim();
          return s.startsWith(":") && s.endsWith(":") ? "center" : s.endsWith(":") ? "right" : s.startsWith(":") ? "left" : null;
        })
    : [];
  return { t: "table", line, align, head: header ? cells(header) : [], rows: node.getChildren("TableRow").map(cells) };
}

/** Plain text of runs (alt texts, titles, bookmarks). */
export function plainText(runs: readonly Inline[]): string {
  return runs
    .map((r) => {
      switch (r.t) {
        case "text":
        case "code":
          return r.text;
        case "tag":
          return `#${r.name}`;
        case "wiki":
          return r.label;
        case "image":
          return r.alt;
        case "break":
          return " ";
        default:
          return plainText(r.children);
      }
    })
    .join("");
}

/** Runs without tags (export option): spaces they leave are folded. */
export function withoutTags(blocks: readonly Block[]): Block[] {
  const strip = (runs: Inline[]): Inline[] => {
    const out = runs.flatMap((r): Inline[] => {
      if (r.t === "tag") return [];
      if ("children" in r) return [{ ...r, children: strip(r.children) }];
      return [r];
    });
    // "a #tag b" → "a b", and nothing left around the edges.
    const merged = trimRuns(out);
    for (const run of merged) if (run.t === "text") run.text = run.text.replace(/ {2,}/g, " ");
    return merged;
  };
  const walk = (list: readonly Block[]): Block[] =>
    list.flatMap((b): Block[] => {
      switch (b.t) {
        case "heading":
        case "paragraph": {
          const children = strip(b.children.map((c) => ({ ...c }) as Inline));
          return b.t === "paragraph" && children.length === 0 ? [] : [{ ...b, children }];
        }
        case "quote":
          return [{ ...b, blocks: walk(b.blocks) }];
        case "list":
          return [{ ...b, items: b.items.map((item) => ({ ...item, blocks: walk(item.blocks) })) }];
        case "table":
          return [{ ...b, head: b.head.map(strip), rows: b.rows.map((row) => row.map(strip)) }];
        default:
          return [b];
      }
    });
  return walk(blocks);
}

/** Anchor id of a heading (internal links in HTML and bookmarks in DOCX). */
export function headingSlug(text: string): string {
  return (
    "h-" +
    text
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
  );
}
