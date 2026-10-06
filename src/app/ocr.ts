import { isPdf, matchBoxes, ocrFiles, ocrParts, type OcrBox } from "../core/ocr";
import { invalidateTextSources, registerTextSource } from "../core/search/search";
import { assetsApi } from "../services/assets";
import { errorMessage } from "../services/errors";
import { ocrApi, type OcrDoc, type OcrPage, type OcrStatus } from "../services/ocr";
import { openPdf } from "./pdfjs";
import { getState, setState, useApp } from "./store";

/**
 * Text of the notes' images and PDFs, for search. A background queue reads
 * the files the notes use, one at a time, never while the user types; results
 * come from `.ursa/ocr/` when the file did not change. PDFs: text layer by
 * pdf.js, OCR only for pages without one, up to a set number of pages.
 */

/** Results by vault path, for the current languages. */
const results = new Map<string, OcrDoc>();
/** Files that could not be read (not retried until the next reindex or launch). */
const failed = new Set<string>();
let queue: string[] = [];
let running = false;
let status: OcrStatus | null = null;
let lastKey = 0;
/** Bumped by "Reindex" and language changes: work started before is dropped. */
let generation = 0;

/** A key pressed less than this ago pauses the queue (typing). */
const TYPING_PAUSE = 1500;
/** A PDF page with less text than this is a scan: OCR. */
const TEXT_LAYER_MIN = 20;
/** Longest side of a PDF page drawn for OCR. */
const PDF_RENDER = 2000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Languages used: the chosen ones still installed, else French and English when present. */
export function ocrLanguages(): string[] {
  const installed = status?.languages.map((l) => l.tag) ?? [];
  const chosen = getState().settings.ocr.languages?.filter((t) => installed.includes(t));
  if (chosen?.length) return chosen;
  const pick = (prefix: string) => installed.find((t) => t.toLowerCase().startsWith(prefix));
  const defaults = [pick("fr"), pick("en")].filter((t): t is string => Boolean(t));
  return defaults.length ? defaults : installed.slice(0, 1);
}

const canOcr = () => Boolean(status?.available) && ocrLanguages().length > 0;

/** Every file used by a note (trash and archive included). */
function referencedFiles(): Set<string> {
  const files = new Set<string>();
  for (const note of Object.values(getState().notes)) for (const f of ocrFiles(note.path, note.body)) files.add(f);
  return files;
}

function publish(): void {
  setState((s) => ({ ocr: { ...s.ocr, remaining: queue.length + (running ? 1 : 0), version: s.ocr.version + 1 } }));
}

function setResult(path: string, doc: OcrDoc): void {
  results.set(path, doc);
  invalidateTextSources();
}

/** Finds what is new, takes cached results, queues the rest. */
async function sync(): Promise<void> {
  const { enabled } = getState().settings.ocr;
  if (!enabled || !status) {
    queue = [];
    publish();
    return;
  }
  const wanted = referencedFiles();
  queue = queue.filter((p) => wanted.has(p));
  const fresh = [...wanted].filter((p) => !results.has(p) && !failed.has(p) && !queue.includes(p));
  // Images need the OCR engine; PDFs at least give their text layer.
  const todo = fresh.filter((p) => isPdf(p) || canOcr());
  if (todo.length) {
    const gen = generation;
    const cached = await ocrApi.cached(todo, ocrLanguages()).catch(() => todo.map(() => null));
    if (gen !== generation) return;
    todo.forEach((p, i) => {
      const doc = cached[i];
      if (doc) setResult(p, doc);
      else if (!queue.includes(p)) queue.push(p);
    });
  }
  publish();
  void pump();
}

async function whileTyping(): Promise<void> {
  while (Date.now() - lastKey < TYPING_PAUSE || !getState().settings.ocr.enabled) await sleep(500);
}

class Cancelled extends Error {}

async function pump(): Promise<void> {
  if (running) return;
  running = true;
  try {
    while (queue.length) {
      await whileTyping();
      const path = queue.shift()!;
      const gen = generation;
      publish();
      // The note or the image went away meanwhile: nothing to do.
      if (!referencedFiles().has(path)) continue;
      try {
        const doc = isPdf(path) ? await readPdf(path, gen) : await ocrApi.image(path, ocrLanguages());
        if (gen === generation) setResult(path, doc);
      } catch (e) {
        if (!(e instanceof Cancelled)) {
          console.warn("[ursa] OCR failed", path, errorMessage(e));
          failed.add(path);
        }
      }
    }
  } finally {
    running = false;
    publish();
  }
}

/** Text of a PDF: its text layer page by page; OCR of the pages without one (when available). */
async function readPdf(path: string, gen: number): Promise<OcrDoc> {
  const langs = canOcr() ? ocrLanguages() : [];
  const pdf = await openPdf(assetsApi.url(path));
  try {
    const count = Math.min(pdf.numPages, getState().settings.ocr.pdfPages);
    const pages: OcrPage[] = [];
    for (let n = 1; n <= count; n++) {
      await whileTyping();
      if (gen !== generation || !referencedFiles().has(path)) throw new Cancelled();
      const page = await pdf.getPage(n);
      const content = await page.getTextContent();
      const text = content.items
        .map((item) => ("str" in item ? item.str + (item.hasEOL ? "\n" : " ") : ""))
        .join("")
        .replace(/[ \t]+\n/g, "\n")
        .trim();
      const base = page.getViewport({ scale: 1 });
      if (text.replace(/\s/g, "").length >= TEXT_LAYER_MIN || !langs.length) {
        pages.push({ page: n, source: "text", width: Math.round(base.width), height: Math.round(base.height), lines: [], text });
        continue;
      }
      // A scanned page: drawn large enough for small print, then OCR.
      const viewport = page.getViewport({ scale: PDF_RENDER / Math.max(base.width, base.height) });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      await page.render({ canvasContext: canvas.getContext("2d")!, viewport }).promise;
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!blob) continue;
      pages.push(await ocrApi.page(new Uint8Array(await blob.arrayBuffer()), n, langs));
    }
    const doc: OcrDoc = { version: 1, langs, pages };
    await ocrApi.store(path, doc);
    return doc;
  } finally {
    void pdf.destroy();
  }
}

/** Settings › OCR › "Reindex": every file read again. */
export async function reindexOcr(): Promise<void> {
  generation++;
  results.clear();
  failed.clear();
  queue = [];
  invalidateTextSources();
  await ocrApi.clear().catch((e: unknown) => console.warn("[ursa] OCR cache not cleared", e));
  publish();
  await sync();
}

/** OCR result of a file of the vault (cached or just read), if any. */
export function ocrResult(path: string): OcrDoc | undefined {
  return results.get(path);
}

/** Zones of the search words in an image (first page), with the image size, for highlights. */
export function ocrMatches(path: string, needles: readonly string[]): { boxes: OcrBox[]; width: number; height: number } | null {
  const page = results.get(path)?.pages[0];
  if (!page) return null;
  const boxes = matchBoxes(page, needles);
  return boxes.length ? { boxes, width: page.width, height: page.height } : null;
}

/** Starts the background reading once the vault is open; follows notes and settings. */
export function connectOcr(): void {
  registerTextSource({
    name: "ocr",
    text: (note) => {
      const parts = ocrFiles(note.path, note.body).flatMap((f) => {
        const doc = results.get(f);
        return doc ? ocrParts(f, doc.pages) : [];
      });
      return parts.length ? parts : null;
    },
  });
  window.addEventListener("keydown", () => (lastKey = Date.now()), true);
  void ocrApi
    .status()
    .catch((): OcrStatus => ({ available: false, languages: [], maxDimension: 0 }))
    .then((s) => {
      status = s;
      setState((st) => ({ ocr: { ...st.ocr, status: s } }));
      void sync();
    });
  let timer: ReturnType<typeof setTimeout> | undefined;
  useApp.subscribe((state, previous) => {
    const settingsChanged = state.settings.ocr !== previous.settings.ocr;
    if (settingsChanged && JSON.stringify(state.settings.ocr.languages) !== JSON.stringify(previous.settings.ocr.languages)) {
      // Other languages: other results (cached separately).
      generation++;
      results.clear();
      failed.clear();
      queue = [];
      invalidateTextSources();
    }
    if (state.notes === previous.notes && !settingsChanged) return;
    clearTimeout(timer);
    timer = setTimeout(() => void sync(), 500);
  });
}

/** Leaving a vault: results belong to it. */
export function closeOcr(): void {
  generation++;
  results.clear();
  failed.clear();
  queue = [];
  invalidateTextSources();
  publish();
}
