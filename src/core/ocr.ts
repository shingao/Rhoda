/**
 * OCR results on the app side (pure): which files of a note are read, the
 * text indexed for search, and where a searched word lies in an image.
 */
import { localReferences } from "./markdown/embeds";
import { fold } from "./search/fold";
import type { TextPart } from "./search/search";

export interface OcrBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface OcrWordLike extends OcrBox {
  text: string;
}

export interface OcrPageLike {
  page?: number;
  width: number;
  height: number;
  lines: Array<{ words: OcrWordLike[] }>;
  text: string;
}

/** Raster images read by OCR (SVG is vector: its text is not in pixels we read). */
const OCR_IMAGE = /\.(png|jpe?g|gif|webp)$/i;
const PDF = /\.pdf$/i;

export const isOcrImage = (path: string) => OCR_IMAGE.test(path);
export const isPdf = (path: string) => PDF.test(path);

/** Vault files of a note whose text is read: its images and PDFs. */
export function ocrFiles(notePath: string, body: string): string[] {
  return [...localReferences(notePath, body)].filter((p) => isOcrImage(p) || isPdf(p));
}

/** Text of a file for search, one part per page. */
export function ocrParts(file: string, pages: readonly OcrPageLike[]): TextPart[] {
  return pages.filter((p) => p.text.trim()).map((p) => ({ text: p.text, file, ...(p.page && { page: p.page }) }));
}

/**
 * Boxes of the occurrences of `needles` (search words or phrases) in a page:
 * one box per occurrence, spanning the words it covers, in reading order.
 */
export function matchBoxes(page: OcrPageLike, needles: readonly string[]): OcrBox[] {
  const wanted = needles.map(fold).filter(Boolean);
  if (!wanted.length) return [];
  const out: OcrBox[] = [];
  for (const line of page.lines) {
    // The line as folded text, with the span of each word.
    let text = "";
    const spans = line.words.map((w) => {
      if (text) text += " ";
      const from = text.length;
      text += fold(w.text);
      return [from, text.length] as const;
    });
    for (const needle of wanted) {
      for (let at = text.indexOf(needle); at >= 0; at = text.indexOf(needle, at + 1)) {
        const covered = line.words.filter((_, i) => spans[i]![1] > at && spans[i]![0] < at + needle.length);
        if (!covered.length) continue;
        const x = Math.min(...covered.map((w) => w.x));
        const y = Math.min(...covered.map((w) => w.y));
        out.push({ x, y, w: Math.max(...covered.map((w) => w.x + w.w)) - x, h: Math.max(...covered.map((w) => w.y + w.h)) - y });
      }
    }
  }
  return out.sort((a, b) => a.y - b.y || a.x - b.x);
}

/**
 * A square thumbnail (`object-fit: cover`) of an image `size` centred on a
 * box, for the result card: the `object-position` to use, and where the box
 * falls in it (both in %).
 */
export function coverOn(box: OcrBox, size: { width: number; height: number }): { position: { x: number; y: number }; box: OcrBox } {
  const side = Math.min(size.width, size.height);
  const clamp = (v: number, max: number) => Math.max(0, Math.min(max, v));
  const left = clamp(box.x + box.w / 2 - side / 2, size.width - side);
  const top = clamp(box.y + box.h / 2 - side / 2, size.height - side);
  const ratio = (v: number, room: number) => (room > 0 ? (v / room) * 100 : 50);
  const pct = (v: number) => clamp((v / side) * 100, 100);
  const x = pct(box.x - left);
  const y = pct(box.y - top);
  return {
    position: { x: ratio(left, size.width - side), y: ratio(top, size.height - side) },
    box: { x, y, w: pct(box.x - left + box.w) - x, h: pct(box.y - top + box.h) - y },
  };
}
