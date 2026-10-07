/**
 * JPG / PNG export: the standalone page laid out in an offscreen frame at its
 * width, then drawn on a canvas through an SVG `foreignObject` (everything is
 * inside the page, so the canvas stays readable). A note taller than one
 * image allows is cut between blocks into numbered images.
 */

/** Pixels per CSS pixel: sharp text on high-density screens and in documents. */
const SCALE = 2;
/**
 * Tallest image, in device pixels. Chromium refuses canvases above 32 767 px
 * per side; staying well below keeps memory reasonable in WebView2.
 */
export const MAX_IMAGE_PX = 16000;

export interface Slice {
  top: number;
  height: number;
}

/**
 * Where to cut a page of `height` px into images of at most `max` px, between
 * blocks (`cuts`: tops of the blocks, ascending). A block taller than `max` is cut.
 */
export function slicePage(height: number, cuts: readonly number[], max: number): Slice[] {
  const slices: Slice[] = [];
  let top = 0;
  while (height - top > max) {
    const limit = top + max;
    const cut = [...cuts].reverse().find((c) => c > top && c <= limit) ?? limit;
    slices.push({ top, height: cut - top });
    top = cut;
  }
  slices.push({ top, height: height - top });
  return slices;
}

async function layout(html: string): Promise<{ frame: HTMLIFrameElement; doc: Document }> {
  const frame = document.createElement("iframe");
  // Laid out (not display: none) but out of sight; no script runs in it.
  frame.setAttribute("sandbox", "allow-same-origin");
  frame.setAttribute("aria-hidden", "true");
  frame.tabIndex = -1;
  frame.style.cssText = "position:fixed;left:-100000px;top:0;border:0;opacity:0;pointer-events:none";
  frame.style.width = "var(--export-page-w)";
  frame.style.height = "100px";
  document.body.appendChild(frame);
  await new Promise<void>((resolve) => {
    frame.onload = () => resolve();
    frame.srcdoc = html;
  });
  const doc = frame.contentDocument!;
  await doc.fonts.ready;
  await Promise.all(Array.from(doc.images).map((img) => img.decode().catch(() => undefined)));
  return { frame, doc };
}

const loadImage = (url: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("page could not be drawn"));
    img.src = url;
  });

/** Images of a page (one, or several when it is too tall). */
export async function rasterize(html: string, type: "png" | "jpg"): Promise<Blob[]> {
  const { frame, doc } = await layout(html);
  try {
    const page = doc.querySelector<HTMLElement>(".u-page")!;
    const width = Math.ceil(page.getBoundingClientRect().width);
    const height = Math.ceil(page.scrollHeight);
    const article = page.querySelector("article")!;
    const cuts = Array.from(article.children)
      .map((el) => Math.floor((el as HTMLElement).getBoundingClientRect().top - page.getBoundingClientRect().top))
      .filter((y) => y > 0);
    frame.style.height = `${height}px`;
    const xhtml = new XMLSerializer().serializeToString(doc.documentElement);
    const blobs: Blob[] = [];
    for (const slice of slicePage(height, cuts, Math.floor(MAX_IMAGE_PX / SCALE))) {
      const svg =
        `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${slice.height}" viewBox="0 ${slice.top} ${width} ${slice.height}">` +
        `<foreignObject x="0" y="0" width="${width}" height="${height}">${xhtml}</foreignObject></svg>`;
      const img = await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
      const canvas = document.createElement("canvas");
      canvas.width = width * SCALE;
      canvas.height = slice.height * SCALE;
      const ctx = canvas.getContext("2d")!;
      ctx.scale(SCALE, SCALE);
      ctx.drawImage(img, 0, 0, width, slice.height);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type === "jpg" ? "image/jpeg" : "image/png", 0.92));
      if (!blob) throw new Error("image too large");
      blobs.push(blob);
    }
    return blobs;
  } finally {
    frame.remove();
  }
}
