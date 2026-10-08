import type * as Docx from "docx";
import { headingSlug, plainText, withoutTags, parseDocument, type Block, type Inline, type TextAlign } from "../../core/export/model";
import { alignedLinesOf } from "../../core/align";
import type { Note } from "../../core/note/note";
import { blocksOf, resolveAnchor } from "../../core/stickers";
import { editorStickers } from "../../editor/session";
import { assetsApi } from "../../services/assets";
import type { Palette } from "../../services/settings";
import { fetchBlob, vaultFile } from "./page";

/**
 * DOCX export: the note's document as Word paragraphs. Images inside, tasks
 * as ☐ / ☑, highlights shaded, code in a monospace font, tags as text,
 * wiki links to a heading of the note (bookmark) or to another exported file,
 * else text. Post-its follow their block as shaded paragraphs; stickers are
 * decorations of the page and are left out.
 */

export interface DocxOptions {
  images: boolean;
  tags: boolean;
  stickers: boolean;
  palette: Palette;
  /** Link of a wiki link to another note of the same export, or null. */
  wiki: (target: string) => string | null;
}

/** Fonts every Windows reader has (the app's fonts are not installed elsewhere). */
const FONT = "Segoe UI";
const MONO = "Consolas";
const SYMBOL = "Segoe UI Symbol";
/** Text width of an A4 page with Word's default margins, in px (96 dpi). */
const TEXT_WIDTH_PX = 600;
/** Twips per list level. */
const INDENT = 360;

type Colors = Record<"text" | "text2" | "text3" | "accent" | "highlight" | "code" | "quote" | "separator" | "postitYellow" | "postitPink" | "postitGreen" | "postitBlue", string>;

/** Colours of a palette, read from the design tokens (as RRGGBB). */
function themeColors(palette: Palette): Colors {
  const probe = document.createElement("div");
  probe.dataset.theme = palette;
  probe.hidden = true;
  document.body.appendChild(probe);
  const hex = (name: string) => {
    probe.style.color = `var(${name})`;
    const [r, g, b] = getComputedStyle(probe).color.match(/\d+(\.\d+)?/g)!.map(Number);
    return [r, g, b].map((v) => Math.round(v!).toString(16).padStart(2, "0")).join("").toUpperCase();
  };
  const colors: Colors = {
    text: hex("--text"),
    text2: hex("--text-2"),
    text3: hex("--text-3"),
    accent: hex("--accent-text"),
    highlight: hex("--highlight"),
    code: hex("--bg-code"),
    quote: hex("--bg-1"),
    separator: hex("--bg-sunken"),
    postitYellow: hex("--postit-yellow"),
    postitPink: hex("--postit-pink"),
    postitGreen: hex("--postit-green"),
    postitBlue: hex("--postit-blue"),
  };
  probe.remove();
  return colors;
}

/** Word bookmark name: letters, digits and _, 40 characters at most. */
const bookmark = (id: string) => id.replace(/[^A-Za-z0-9]/g, "_").slice(0, 40);

interface Picture {
  data: Uint8Array;
  type: "png" | "jpg" | "gif";
  width: number;
  height: number;
}

/** An image in a format Word reads (PNG, JPEG, GIF; others redrawn as PNG) and its size. */
async function picture(blob: Blob): Promise<Picture | null> {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const width = img.naturalWidth || 300;
    const height = img.naturalHeight || 200;
    const kind = blob.type === "image/jpeg" ? "jpg" : blob.type === "image/png" ? "png" : blob.type === "image/gif" ? "gif" : null;
    if (kind) return { data: new Uint8Array(await blob.arrayBuffer()), type: kind, width, height };
    // SVG, WebP: drawn once as PNG.
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    canvas.getContext("2d")!.drawImage(img, 0, 0, width, height);
    const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    return png ? { data: new Uint8Array(await png.arrayBuffer()), type: "png", width, height } : null;
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function noteDocx(note: Note, options: DocxOptions): Promise<Blob> {
  const d: typeof Docx = await import("docx");
  const c = themeColors(options.palette);
  const parsed = parseDocument(note.body, alignedLinesOf(note.aligns, note.body));
  const blocks = options.tags ? parsed : withoutTags(parsed);

  // Images first (async), then the document is built synchronously.
  const pictures = new Map<string, Picture>();
  if (options.images) {
    const srcs: string[] = [];
    const walk = (list: readonly Block[]) =>
      list.forEach((b) => {
        if (b.t === "image") srcs.push(b.src);
        else if (b.t === "quote") walk(b.blocks);
        else if (b.t === "list") b.items.forEach((i) => walk(i.blocks));
      });
    walk(blocks);
    await Promise.all(
      srcs.map(async (src) => {
        const path = vaultFile(note, src);
        const blob = path ? await fetchBlob(assetsApi.url(path)) : null;
        const pic = blob ? await picture(blob) : null;
        if (pic) pictures.set(src, pic);
      }),
    );
  }

  // Post-its, after the block they are anchored to.
  const postits = new Map<number, Array<{ text: string; color: string }>>();
  if (options.stickers) {
    const lines = note.body.split("\n");
    const anchors = blocksOf(lines);
    for (const s of editorStickers(note.id) ?? note.stickers) {
      if (s.kind !== "postit" || !s.text?.trim()) continue;
      const line = anchors[resolveAnchor(s.anchor, anchors)]?.from ?? 1;
      postits.set(line, [...(postits.get(line) ?? []), { text: s.text, color: s.color ?? "yellow" }]);
    }
  }

  const headingIds = new Map<string, string>();
  const used = new Set<string>();
  const headingId = (text: string) => {
    let id = bookmark(headingSlug(text));
    for (let n = 2; used.has(id); n++) id = bookmark(`${headingSlug(text)}_${n}`);
    used.add(id);
    if (!headingIds.has(text.trim().toLowerCase())) headingIds.set(text.trim().toLowerCase(), id);
    return id;
  };
  // Ids known before rendering, so links written above their heading work.
  const ids: string[] = [];
  const collect = (list: readonly Block[]) =>
    list.forEach((b) => {
      if (b.t === "heading") ids.push(headingId(plainText(b.children)));
      else if (b.t === "quote") collect(b.blocks);
      else if (b.t === "list") b.items.forEach((i) => collect(i.blocks));
    });
  collect(blocks);
  let nextHeading = 0;

  type Run = Docx.ParagraphChild;
  interface Style {
    bold?: boolean;
    italics?: boolean;
    strike?: boolean;
    underline?: boolean;
    highlight?: boolean;
    color?: string;
  }
  const text = (value: string, s: Style = {}, extra: Partial<Docx.IRunOptions> = {}): Docx.TextRun =>
    new d.TextRun({
      text: value,
      font: FONT,
      ...(s.bold && { bold: true }),
      ...(s.italics && { italics: true }),
      ...(s.strike && { strike: true }),
      ...(s.underline && { underline: {} }),
      ...(s.highlight && { shading: { type: d.ShadingType.CLEAR, color: "auto", fill: c.highlight } }),
      ...(s.color && { color: s.color }),
      ...extra,
    });

  const runs = (list: readonly Inline[], s: Style = {}): Run[] =>
    list.flatMap((r): Run[] => {
      switch (r.t) {
        case "text":
          return [text(r.text, s)];
        case "strong":
          return runs(r.children, { ...s, bold: true });
        case "em":
          return runs(r.children, { ...s, italics: true });
        case "strike":
          return runs(r.children, { ...s, strike: true, color: c.text3 });
        case "underline":
          return runs(r.children, { ...s, underline: true });
        case "highlight":
          return runs(r.children, { ...s, highlight: true });
        case "code":
          return [text(r.text, s, { font: MONO, color: c.accent, shading: { type: d.ShadingType.CLEAR, color: "auto", fill: c.code } })];
        case "break":
          return [new d.TextRun({ break: 1 })];
        case "tag":
          return [text(`#${r.name}`, { ...s, bold: true, color: c.accent })];
        case "image":
          return [text(r.alt, s)];
        case "link": {
          const children = runs(r.children, { ...s, color: c.accent, underline: true }) as Docx.TextRun[];
          return /^(https?:|mailto:)/i.test(r.href) ? [new d.ExternalHyperlink({ link: r.href, children })] : children;
        }
        case "wiki": {
          const label = r.label.replace(/^#/, "");
          const style = { ...s, bold: true, color: c.accent };
          if (r.target.startsWith("#")) {
            const anchor = headingIds.get(r.target.slice(1).trim().toLowerCase());
            if (anchor) return [new d.InternalHyperlink({ anchor, children: [text(label, style)] })];
          }
          const href = options.wiki(r.target);
          return href ? [new d.ExternalHyperlink({ link: href, children: [text(label, { ...style, underline: true })] })] : [text(label, style)];
        }
      }
    });

  let ordered = 0;
  const out: Docx.FileChild[] = [];
  const spacing = { after: 160 };

  const after = (line: number) => {
    for (const p of postits.get(line) ?? []) {
      const fill = { pink: c.postitPink, green: c.postitGreen, blue: c.postitBlue }[p.color] ?? c.postitYellow;
      const lines = p.text.split("\n");
      out.push(
        new d.Paragraph({
          spacing,
          indent: { left: INDENT * 2 },
          shading: { type: d.ShadingType.CLEAR, color: "auto", fill },
          children: lines.flatMap((l, i) => [...(i ? [new d.TextRun({ break: 1 })] : []), text(l, { italics: true, color: c.text })]),
        }),
      );
    }
    postits.delete(line);
  };

  /** Paragraph alignment of a block aligned in the note (left: Word's default). */
  const aligned = (a: TextAlign | undefined) =>
    a ? { alignment: a === "center" ? d.AlignmentType.CENTER : a === "right" ? d.AlignmentType.RIGHT : d.AlignmentType.BOTH } : {};

  /** `inherited`: alignment of the enclosing quote. */
  const block = (b: Block, level = 0, quote = false, inherited?: TextAlign): void => {
    const quoteStyle = quote ? { indent: { left: INDENT }, shading: { type: d.ShadingType.CLEAR, color: "auto", fill: c.quote } } : {};
    const qs: Style = quote ? { italics: true, color: c.text2 } : {};
    switch (b.t) {
      case "heading": {
        const levels = [d.HeadingLevel.HEADING_1, d.HeadingLevel.HEADING_2, d.HeadingLevel.HEADING_3, d.HeadingLevel.HEADING_4, d.HeadingLevel.HEADING_5, d.HeadingLevel.HEADING_6];
        const id = ids[nextHeading++] ?? bookmark(headingSlug(plainText(b.children)));
        out.push(new d.Paragraph({ heading: levels[b.level - 1], ...aligned(b.textAlign ?? inherited), children: [new d.Bookmark({ id, children: runs(b.children, { color: c.text }) as Docx.TextRun[] })] }));
        break;
      }
      case "paragraph":
        out.push(new d.Paragraph({ spacing, ...quoteStyle, ...aligned(b.textAlign ?? inherited), children: runs(b.children, qs) }));
        break;
      case "quote":
        b.blocks.forEach((x) => block(x, level, true, b.textAlign ?? inherited));
        break;
      case "code": {
        if (b.lang) out.push(new d.Paragraph({ children: [text(b.lang, { color: c.text3 }, { size: 16 })] }));
        const lines = b.text.split("\n");
        out.push(
          new d.Paragraph({
            spacing,
            shading: { type: d.ShadingType.CLEAR, color: "auto", fill: c.code },
            children: lines.flatMap((l, i) => [...(i ? [new d.TextRun({ break: 1 })] : []), new d.TextRun({ text: l, font: MONO, size: 19, color: c.text })]),
          }),
        );
        break;
      }
      case "rule":
        out.push(new d.Paragraph({ spacing, border: { bottom: { style: d.BorderStyle.SINGLE, size: 6, space: 1, color: c.separator } }, children: [] }));
        break;
      case "list": {
        const instance = ++ordered;
        for (const item of b.items) {
          item.blocks.forEach((x, i) => {
            if (i === 0 && x.t === "paragraph") {
              const box = item.checked === null ? [] : [new d.TextRun({ text: item.checked ? "☑ " : "☐ ", font: SYMBOL, color: c.text3 })];
              const style: Style = item.checked ? { ...qs, color: c.text3 } : qs;
              const numbering = item.checked !== null ? {} : b.ordered ? { numbering: { reference: "ursa-ordered", level: Math.min(level, 8), instance } } : { bullet: { level: Math.min(level, 8) } };
              out.push(new d.Paragraph({ ...numbering, ...(item.checked !== null && { indent: { left: INDENT * (level + 1) } }), ...aligned(item.textAlign ?? inherited), children: [...box, ...runs(x.children, style)] }));
            } else if (x.t === "list") block(x, level + 1, quote, inherited);
            else block(x, level + 1, quote, item.textAlign ?? inherited);
          });
          after(item.line);
        }
        out.push(new d.Paragraph({ spacing: { after: 0 }, children: [] }));
        break;
      }
      case "table": {
        const cell = (content: Inline[], header: boolean, i: number) =>
          new d.TableCell({
            children: [
              new d.Paragraph({
                alignment: b.align[i] === "center" ? d.AlignmentType.CENTER : b.align[i] === "right" ? d.AlignmentType.RIGHT : d.AlignmentType.LEFT,
                children: runs(content, header ? { bold: true } : {}),
              }),
            ],
          });
        const rows = [...(b.head.length ? [new d.TableRow({ tableHeader: true, children: b.head.map((h, i) => cell(h, true, i)) })] : []), ...b.rows.map((r) => new d.TableRow({ children: r.map((x, i) => cell(x, false, i)) }))];
        if (rows.length) out.push(new d.Table({ width: { size: 100, type: d.WidthType.PERCENTAGE }, rows }), new d.Paragraph({ spacing, children: [] }));
        break;
      }
      case "image": {
        const pic = pictures.get(b.src);
        if (!pic) {
          out.push(new d.Paragraph({ spacing, children: [text(b.alt || b.src, { italics: true, color: c.text3 })] }));
          break;
        }
        const width = Math.min(b.width ?? pic.width, pic.width, TEXT_WIDTH_PX);
        const height = Math.round((pic.height * width) / pic.width);
        out.push(new d.Paragraph({ spacing, children: [new d.ImageRun({ type: pic.type, data: pic.data, transformation: { width, height }, altText: { name: b.alt || "image", description: b.alt, title: b.alt } })] }));
        break;
      }
      case "pdf":
        out.push(new d.Paragraph({ spacing, children: [text("PDF  ", { bold: true, color: c.accent }), text(b.label, { bold: true })] }));
        break;
      case "url":
        out.push(new d.Paragraph({ spacing, children: /^https?:/i.test(b.url) ? [new d.ExternalHyperlink({ link: b.url, children: [text(b.url, { color: c.accent, underline: true })] })] : [text(b.url)] }));
        break;
    }
    if (b.t !== "list") after(b.line);
  };
  blocks.forEach((b) => block(b));
  // Post-its anchored past the end (the note changed since).
  for (const line of [...postits.keys()]) after(line);

  const doc = new d.Document({
    creator: "Bullshit",
    title: note.title,
    styles: { default: { document: { run: { font: FONT, size: 22, color: c.text } } } },
    numbering: {
      config: [
        {
          reference: "ursa-ordered",
          levels: Array.from({ length: 9 }, (_, level) => ({
            level,
            format: d.LevelFormat.DECIMAL,
            text: `%${level + 1}.`,
            alignment: d.AlignmentType.START,
            style: { paragraph: { indent: { left: INDENT * (level + 1), hanging: INDENT / 1.5 } } },
          })),
        },
      ],
    },
    sections: [{ children: out }],
  });
  return d.Packer.toBlob(doc);
}
