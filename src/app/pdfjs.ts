import type { PDFDocumentProxy } from "pdfjs-dist";

/** pdf.js, loaded on first use (PDF cards, PDF text for search), without eval. */
export async function openPdf(url: string): Promise<PDFDocumentProxy> {
  const pdfjs = await import("pdfjs-dist");
  const worker = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
  pdfjs.GlobalWorkerOptions.workerSrc = worker;
  return pdfjs.getDocument({ url, isEvalSupported: false }).promise;
}
