import { localReferences } from "./markdown/embeds";

/**
 * Drawings (Excalidraw, decision P12-5): `assets/dessins/<id>.excalidraw` is
 * the source, `<id>.svg` its picture. A note only links the picture, as an
 * image any Markdown editor shows: `![Dessin](assets/dessins/<id>.svg)`.
 */

export const DRAWINGS_DIR = "assets/dessins";

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const SVG_PATH = new RegExp(`^${DRAWINGS_DIR}/([A-Za-z0-9_-]{1,64})\\.svg$`);

export const isDrawingId = (id: string): boolean => ID.test(id);

/** The drawing a vault path is the picture of, or null. */
export function drawingIdOf(vaultPath: string): string | null {
  return SVG_PATH.exec(vaultPath)?.[1] ?? null;
}

/** Whether an image link of a note points to a drawing's picture (any relative path to it). */
export const isDrawingSrc = (src: string): boolean => /(^|\/)assets\/dessins\/[A-Za-z0-9_-]{1,64}\.svg$/.test(src.split(/[?#]/)[0]!);

export const drawingSvgPath = (id: string): string => `${DRAWINGS_DIR}/${id}.svg`;
export const drawingSourcePath = (id: string): string => `${DRAWINGS_DIR}/${id}.excalidraw`;

/** Drawings a note shows (in the order of its text). */
export function drawingsIn(notePath: string, body: string): string[] {
  return [...localReferences(notePath, body)].flatMap((path) => drawingIdOf(path) ?? []);
}

/** The words written in a drawing (its text elements), for search. Empty for anything unreadable. */
export function drawingText(source: string): string {
  try {
    const scene = JSON.parse(source) as { elements?: unknown };
    if (!Array.isArray(scene.elements)) return "";
    return scene.elements
      .flatMap((e: unknown) => {
        if (!e || typeof e !== "object") return [];
        const el = e as { type?: unknown; isDeleted?: unknown; text?: unknown; originalText?: unknown };
        if (el.type !== "text" || el.isDeleted === true) return [];
        const text = typeof el.originalText === "string" ? el.originalText : el.text;
        return typeof text === "string" && text.trim() ? [text.trim()] : [];
      })
      .join("\n");
  } catch {
    return "";
  }
}

/** A note's text with its drawing links pointed to other drawings (duplicated note). */
export function replaceDrawingIds(body: string, ids: ReadonlyMap<string, string>): string {
  if (ids.size === 0) return body;
  return body.replace(new RegExp(`(${DRAWINGS_DIR.replace("/", "\\/")}\\/)([A-Za-z0-9_-]{1,64})(\\.svg)`, "g"), (all, dir: string, id: string, ext: string) => {
    const next = ids.get(id);
    return next ? `${dir}${next}${ext}` : all;
  });
}
