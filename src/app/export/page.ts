import { renderHtml, type Decoration, type LinkPreviewData } from "../../core/export/html";
import { parseDocument, withoutTags, type Block } from "../../core/export/model";
import { alignedLinesOf } from "../../core/align";
import { isRemote, resolveVaultPath } from "../../core/markdown/embeds";
import type { Note, Paper } from "../../core/note/note";
import { blocksOf, resolveAnchor, type Sticker } from "../../core/stickers";
import exportCss from "../../features/export/export.css?raw";
import { editorStickers } from "../../editor/session";
import { assetsApi } from "../../services/assets";
import { previewApi } from "../../services/preview";
import type { ExportSettings } from "../../services/settings";
import componentsCss from "../../styles/tokens.components.css?raw";
import tokensCss from "../../styles/tokens.css?raw";
import { resolvePalette } from "../theme";
import { currentMessages } from "../i18n";
import { cssPx } from "../cssTokens";
import { stickerUrl } from "../stickers";
import { getState } from "../store";

/**
 * A note as a standalone page: the HTML export itself, and what the PDF and
 * image exports are drawn from. Everything is inside (styles, fonts, images,
 * stickers as data URLs): no request, no script.
 */

/** Paper sizes, in millimetres. */
export const PAGE_MM = { a4: [210, 297], letter: [215.9, 279.4] } as const;

export interface PageOptions extends Pick<ExportSettings, "images" | "tags" | "currentTheme" | "paper" | "stickers"> {
  /** PDF paper (sets the page width); none for HTML and images. */
  page?: "a4" | "letter";
  /** Link of a wiki link to another note of the same export, or null. */
  wiki: (target: string) => string | null;
}

const toDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsDataURL(blob);
  });

/** Bytes of a URL the app can load (vault files, bundled assets), or null. */
export async function fetchBlob(url: string): Promise<Blob | null> {
  try {
    const response = await fetch(url);
    return response.ok ? await response.blob() : null;
  } catch {
    return null;
  }
}

/** Vault file of an image or link of a note: its path, never a remote URL. */
export function vaultFile(note: Note, src: string): string | null {
  return isRemote(src) ? null : resolveVaultPath(note.path, src);
}

/** Whether a `unicode-range` covers Latin text (`a`) or its accented letters (`ā`). */
export function coversLatin(range: string): boolean {
  return range.split(",").some((part) => {
    const m = /U\+([0-9A-F?]+)(?:-([0-9A-F]+))?/i.exec(part.trim());
    if (!m) return false;
    const from = parseInt(m[1]!.replace(/\?/g, "0"), 16);
    const to = m[2] ? parseInt(m[2], 16) : parseInt(m[1]!.replace(/\?/g, "F"), 16);
    return [0x61, 0x101].some((c) => c >= from && c <= to);
  });
}

/** The serif editor font, embedded only when it is the chosen one. */
const SERIF_FAMILY = "Newsreader";

const fontCache = new Map<string, Promise<string>>();

/**
 * The app's fonts as `@font-face` rules with the files inside (Latin subsets:
 * the PDF embeds what it uses, the HTML stays a reasonable size), except the
 * families in `skip` (the editor font that is not chosen).
 */
export function embeddedFonts(skip: readonly string[] = []): Promise<string> {
  const key = skip.join("|");
  const cached = fontCache.get(key);
  if (cached) return cached;
  const built = (async () => {
    const rules: CSSFontFaceRule[] = [];
    for (const sheet of Array.from(document.styleSheets)) {
      let list: CSSRuleList;
      try {
        list = sheet.cssRules;
      } catch {
        continue;
      }
      for (const rule of Array.from(list)) if (rule instanceof CSSFontFaceRule) rules.push(rule);
    }
    const wanted = (rule: CSSFontFaceRule) => {
      const family = rule.style.getPropertyValue("font-family").replace(/["']/g, "").trim();
      if (skip.includes(family)) return false;
      const range = rule.style.getPropertyValue("unicode-range");
      return !range || coversLatin(range);
    };
    const out = await Promise.all(
      rules.filter(wanted).map(async (rule) => {
        const url = /url\(["']?([^"')]+)["']?\)/.exec(rule.style.getPropertyValue("src"))?.[1];
        const blob = url ? await fetchBlob(new URL(url, rule.parentStyleSheet?.href ?? location.href).href) : null;
        if (!blob) return "";
        const data = await toDataUrl(blob);
        const props = ["font-family", "font-style", "font-weight", "font-display", "unicode-range"]
          .map((p) => [p, rule.style.getPropertyValue(p)] as const)
          .filter(([, v]) => v)
          .map(([p, v]) => `${p}:${v}`);
        return `@font-face{${props.join(";")};src:url(${data}) format("woff2")}`;
      }),
    );
    return out.join("\n");
  })();
  fontCache.set(key, built);
  return built;
}

/** Data URLs of the note's images (only the files of the vault). */
async function noteImages(note: Note, blocks: readonly Block[]): Promise<Map<string, string>> {
  const srcs = new Set<string>();
  const walk = (list: readonly Block[]) => {
    for (const b of list) {
      if (b.t === "image") srcs.add(b.src);
      else if (b.t === "quote") walk(b.blocks);
      else if (b.t === "list") b.items.forEach((i) => walk(i.blocks));
    }
  };
  walk(blocks);
  // Inline images too (rare): `![…](…)` inside a paragraph.
  for (const m of note.body.matchAll(/!\[[^\]\n]*\]\(<?([^)\s>]+)>?/g)) srcs.add(m[1]!);
  const out = new Map<string, string>();
  await Promise.all(
    [...srcs].map(async (src) => {
      const path = vaultFile(note, src);
      const blob = path ? await fetchBlob(assetsApi.url(path)) : null;
      if (blob) out.set(src, await toDataUrl(blob));
    }),
  );
  return out;
}

/** Link cards known for the note's URLs (cached by the Rust side; never fetched here if previews are off). */
async function noteCards(blocks: readonly Block[]): Promise<Map<string, LinkPreviewData>> {
  const out = new Map<string, LinkPreviewData>();
  if (!getState().settings.editor.linkPreviews) return out;
  await Promise.all(
    blocks
      .filter((b) => b.t === "url")
      .map(async (b) => {
        try {
          const p = await previewApi.fetch(b.url, false);
          const image = p.image ? await fetchBlob(assetsApi.url(p.image)) : null;
          out.set(b.url, {
            title: p.title ?? p.site ?? p.domain,
            domain: p.domain,
            ...(p.description && { description: p.description }),
            ...(image && { image: await toDataUrl(image) }),
          });
        } catch {
          // A plain link.
        }
      }),
  );
  return out;
}

/** Stickers and post-its at the export width: margin stickers at most as wide as the margin. */
async function decorations(note: Note): Promise<Decoration[]> {
  const stickers: readonly Sticker[] = editorStickers(note.id) ?? note.stickers;
  if (!stickers.length || getState().hiddenStickers[note.id]) return [];
  const lines = note.body.split("\n");
  const blocks = blocksOf(lines);
  const margin = cssPx("--export-pad-x") - 2 * cssPx("--export-sticker-gap");
  const out = await Promise.all(
    [...stickers]
      .sort((a, b) => a.z - b.z)
      .map(async (s): Promise<Decoration | null> => {
        const block = blocks[resolveAnchor(s.anchor, blocks)];
        const line = block?.from ?? 1;
        const side = s.dx < 50 ? "left" : "right";
        if (s.kind === "postit") return { kind: "postit", line, text: s.text ?? "", color: s.color ?? "yellow", size: s.size, rotation: s.rotation, side };
        const url = s.asset ? stickerUrl(s.asset) : null;
        const blob = url ? await fetchBlob(url) : null;
        if (!blob) return null;
        return { kind: "sticker", line, src: await toDataUrl(blob), size: Math.min(s.size, margin), rotation: s.rotation, side, offset: Math.min(Math.max(0, s.dy), cssPx("--rhythm") * 3) };
      }),
  );
  return out.filter((d): d is Decoration => d !== null);
}

export interface ExportPage {
  html: string;
  title: string;
}

/** The standalone page of a note. */
export async function exportPage(note: Note, options: PageOptions): Promise<ExportPage> {
  const t = currentMessages();
  const { settings } = getState();
  const parsed = parseDocument(note.body, alignedLinesOf(note.aligns, note.body));
  const blocks = options.tags ? parsed : withoutTags(parsed);
  const [images, cards, decos, fonts] = await Promise.all([
    options.images ? noteImages(note, blocks) : Promise.resolve(new Map<string, string>()),
    noteCards(blocks),
    options.stickers ? decorations(note) : Promise.resolve([]),
    embeddedFonts(settings.editor.font === "serif" ? [] : [SERIF_FAMILY]),
  ]);
  const body = renderHtml(blocks, {
    image: (src) => {
      const data = images.get(src);
      return data ? { src: data } : null;
    },
    wiki: options.wiki,
    preview: (url) => cards.get(url) ?? null,
    decorations: decos,
    labels: { done: t.exportDialog.doneTask, todo: t.exportDialog.todo, pdf: "PDF" },
  });
  const palette = options.currentTheme ? resolvePalette(settings.appearance, matchMedia("(prefers-color-scheme: dark)").matches) : settings.appearance.light;
  const paper: Paper = note.paper ?? settings.editor.paper;
  const margin = note.margin ?? settings.editor.margin;
  const sheet = ["u-sheet", options.paper && paper !== "plain" && `u-paper-${paper}`, options.paper && margin && "u-margin"].filter(Boolean).join(" ");
  const e = settings.editor;
  const vars = [`--editor-fs:${e.fontSize}px`, `--editor-font-active:${e.font === "serif" ? "var(--font-editor-serif)" : "var(--font-editor)"}`];
  let pageRule = "";
  if (options.page) {
    const [w, h] = PAGE_MM[options.page];
    vars.push(`--export-page-w:${w}mm`);
    pageRule = `@page{size:${w}mm ${h}mm;margin:0}`;
  }
  const lang = settings.language;
  const html =
    `<!doctype html><html lang="${lang}" data-theme="${palette}" class="u-file" style="${vars.join(";")}"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="generator" content="Bullshit">` +
    `<title>${escapeTitle(note.title)}</title><style>${fonts}\n${tokensCss}\n${componentsCss}\n${exportCss}\n${pageRule}</style></head>` +
    `<body><main class="u-page"><div class="${sheet}" aria-hidden="true"></div><article>${body}</article></main></body></html>`;
  return { html, title: note.title };
}

const escapeTitle = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
