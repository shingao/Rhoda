import { invoke } from "@tauri-apps/api/core";

/** A recognized word and its box, in pixels of the image as displayed. */
export interface OcrWord {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface OcrPage {
  /** PDF page (from 1); absent for an image. */
  page?: number;
  /** "ocr", or "text" for a PDF text layer. */
  source: "ocr" | "text";
  width: number;
  height: number;
  lines: Array<{ words: OcrWord[] }>;
  text: string;
}

export interface OcrDoc {
  version: number;
  langs: string[];
  pages: OcrPage[];
}

export interface OcrStatus {
  available: boolean;
  languages: Array<{ tag: string; name: string }>;
  maxDimension: number;
}

/** The only module that talks to the Rust OCR commands. */
export const ocrApi = {
  status: () => invoke<OcrStatus>("ocr_status"),
  /** Cached results (null: not done yet with these languages). */
  cached: (paths: string[], langs: string[]) => invoke<Array<OcrDoc | null>>("ocr_cached", { paths, langs }),
  image: (path: string, langs: string[]) => invoke<OcrDoc>("ocr_image", { path, langs }),
  /** OCR of a PDF page drawn by pdf.js (PNG). */
  page: (png: Uint8Array, page: number, langs: string[]) =>
    invoke<OcrPage>("ocr_page", png, { headers: { "x-ursa-page": String(page), "x-ursa-langs": langs.join(",") } }),
  store: (path: string, doc: OcrDoc) => invoke<void>("ocr_store", { path, doc }),
  clear: () => invoke<void>("ocr_clear"),
};
