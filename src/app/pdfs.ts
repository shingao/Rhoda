import { formatBytes } from "../core/format";
import { basename } from "../core/note/filename";
import { decodeSrc, resolveVaultPath } from "../core/markdown/embeds";
import type { PdfState } from "../editor/embeds/pdfCard";
import { refreshEditor } from "../editor/session";
import { assetsApi } from "../services/assets";
import { currentMessages } from "./i18n";
import { openPdf } from "./pdfjs";
import { getState } from "./store";

/**
 * PDF cards: size from the file, first page drawn once by pdf.js (loaded
 * only when needed) and kept with the page count in `.ursa/thumbs/`.
 */
const states = new Map<string, PdfState>();

/** Draws page 1 to a PNG about 2× the card preview. */
async function drawFirstPage(url: string): Promise<{ png: Uint8Array; pages: number }> {
  const doc = await openPdf(url);
  try {
    const page = await doc.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: 176 / base.height });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    await page.render({ canvasContext: canvas.getContext("2d")!, viewport }).promise;
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("no preview");
    return { png: new Uint8Array(await blob.arrayBuffer()), pages: doc.numPages };
  } finally {
    void doc.destroy();
  }
}

async function load(path: string, name: string): Promise<void> {
  const t = currentMessages();
  try {
    const info = await assetsApi.pdfInfo(path);
    const ready = (thumb: string | null, pages: number | null): PdfState => ({
      status: "ready",
      name,
      path,
      pages,
      size: formatBytes(info.bytes, t.dates.locale, t.cards.units),
      thumb: thumb ? assetsApi.url(thumb) : null,
    });
    states.set(path, ready(info.thumb, info.pages));
    refreshEditor();
    if (info.thumb) return;
    const { png, pages } = await drawFirstPage(assetsApi.url(path));
    await assetsApi.savePdfPreview(path, pages, png);
    const saved = await assetsApi.pdfInfo(path);
    states.set(path, ready(saved.thumb, saved.pages ?? pages));
  } catch (e) {
    console.warn("[ursa] PDF card", path, e);
    if (states.get(path)?.status !== "ready") states.set(path, { status: "missing", name });
  }
  refreshEditor();
}

/** Editor hook: card of a PDF linked alone on its line (null: not in the vault). */
export function pdfCard(src: string, label: string): PdfState | null {
  const { selectedId, notes } = getState();
  const note = selectedId ? notes[selectedId] : undefined;
  const path = note ? resolveVaultPath(note.path, src) : null;
  if (!path) return null;
  const known = states.get(path);
  if (known) return known;
  const name = label || basename(decodeSrc(src));
  states.set(path, { status: "loading", name });
  void load(path, name);
  return states.get(path)!;
}

/** Editor hook: click on a PDF card. */
export function openAttachment(path: string): void {
  void assetsApi.openAttachment(path).catch((e: unknown) => console.warn("[ursa] cannot open", path, e));
}
