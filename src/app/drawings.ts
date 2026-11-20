import { drawingIdOf, drawingsIn, drawingSvgPath, drawingText } from "../core/drawings";
import { uuidv7 } from "../core/id";
import { imageMarkdown, relativeSrc, resolveVaultPath } from "../core/markdown/embeds";
import { invalidateTextSources, registerTextSource } from "../core/search/search";
import { insertBlockLines, refreshEditor } from "../editor/session";
import { assetsApi } from "../services/assets";
import { drawingsApi } from "../services/drawings";
import { errorMessage } from "../services/errors";
import { currentMessages } from "./i18n";
import { getState, setState, showToast, useApp } from "./store";

/**
 * Drawings of the notes (Excalidraw, decision P12-5): opening one in the
 * full-screen editor, saving it (scene + SVG picture in `assets/dessins/`),
 * inserting a new one, and the words written in them for search.
 */

/** The drawing open in the editor; `scene` null for a new one. */
export interface DrawingRequest {
  id: string;
  noteId: string;
  scene: string | null;
  /** A previous version opened to be restored (saving it makes it current): when it was replaced. */
  restoredAt?: number;
}

/** Pictures rewritten during this session: a new URL each time, past the webview's cache. */
const versions = new Map<string, number>();
/** Words of each drawing (by id), read once from its scene. */
const texts = new Map<string, string>();
const reading = new Set<string>();

export const pictureVersion = (vaultPath: string): number => versions.get(vaultPath) ?? 0;

function openNote() {
  const { selectedId, notes } = getState();
  return selectedId ? notes[selectedId] : undefined;
}

/** "Insert › Drawing": an empty drawing for the open note. */
export function newDrawing(): void {
  const note = openNote();
  if (!note || note.trashed) return;
  setState({ drawing: { id: uuidv7(), noteId: note.id, scene: null } });
}

/** Editor hook: is this image a drawing (its picture in `assets/dessins/`)? */
export function isDrawing(src: string): boolean {
  const note = openNote();
  const path = note ? resolveVaultPath(note.path, src) : null;
  return path !== null && drawingIdOf(path) !== null;
}

function drawingOf(src: string): { id: string; noteId: string } | null {
  const note = openNote();
  const path = note ? resolveVaultPath(note.path, src) : null;
  const id = path ? drawingIdOf(path) : null;
  return note && id && !note.trashed ? { id, noteId: note.id } : null;
}

/** "Previous versions…" of a drawing (its menu in the note, or the drawing editor). */
export function openDrawingVersions(target: string | { id: string; noteId: string }): void {
  const drawing = typeof target === "string" ? drawingOf(target) : target;
  if (drawing) setState({ drawingVersions: drawing });
}

/** Opens a previous version in the drawing editor: saving it makes it the current one (the current one is kept as a version). */
export async function openDrawingVersion(id: string, noteId: string, name: string, savedAt: number): Promise<void> {
  try {
    const scene = await drawingsApi.readVersion(id, name);
    setState({ drawingVersions: null, drawing: { id, noteId, scene, restoredAt: savedAt } });
  } catch (e) {
    console.warn("[ursa] drawing version not read", id, e);
    showToast(currentMessages().drawings.readFailed(errorMessage(e)));
  }
}

/** Editor hook (double-click or Ctrl+click on a drawing): opens its scene in the editor. */
export async function openDrawing(src: string): Promise<void> {
  const note = openNote();
  const path = note ? resolveVaultPath(note.path, src) : null;
  const id = path ? drawingIdOf(path) : null;
  if (!note || !id || note.trashed) return;
  const t = currentMessages().drawings;
  try {
    const scene = await drawingsApi.read(id);
    if (scene === null) showToast(t.missing);
    else setState({ drawing: { id, noteId: note.id, scene } });
  } catch (e) {
    console.warn("[ursa] drawing not read", id, e);
    showToast(t.readFailed(errorMessage(e)));
  }
}

/**
 * Writes the scene and its picture; a new drawing is then placed in its note
 * (one undoable insertion), an edited one redrawn. False if it could not be
 * written: the editor stays open, nothing is lost.
 */
export async function saveDrawing(request: DrawingRequest, source: string, svg: string): Promise<boolean> {
  const t = currentMessages().drawings;
  try {
    await drawingsApi.save(request.id, source, svg);
  } catch (e) {
    console.error("[ursa] drawing not saved", request.id, e);
    showToast(t.saveFailed(errorMessage(e)));
    return false;
  }
  const picture = drawingSvgPath(request.id);
  versions.set(picture, pictureVersion(picture) + 1);
  learn(request.id, source);
  const note = getState().notes[request.noteId];
  if (request.scene === null && note) insertBlockLines(note.id, [imageMarkdown(t.alt, relativeSrc(note.path, picture))]);
  else refreshEditor();
  if (request.restoredAt !== undefined) showToast(t.restored);
  return true;
}

function learn(id: string, source: string): void {
  texts.set(id, drawingText(source));
  invalidateTextSources();
  setState((s) => ({ drawingTexts: s.drawingTexts + 1 }));
}

/** Reads the words of drawings not read yet (in the background, one at a time). */
async function readTexts(ids: Iterable<string>): Promise<void> {
  for (const id of ids) {
    if (texts.has(id) || reading.has(id)) continue;
    reading.add(id);
    try {
      const scene = await drawingsApi.read(id);
      if (scene !== null) learn(id, scene);
    } catch (e) {
      console.warn("[ursa] drawing text not read", id, e);
    } finally {
      reading.delete(id);
    }
  }
}

/**
 * Where Excalidraw takes its fonts: the app itself (scripts/vite-excalidraw-fonts.ts).
 * Excalidraw reads it once, when its code is first loaded: set at startup.
 */
export function setDrawingAssetPath(): void {
  // The app's fonts first, then the CJK font if downloaded (Settings › Drawings).
  const fonts = assetsApi.fontsBase();
  const app = new URL("excalidraw/", document.baseURI).href;
  (window as { EXCALIDRAW_ASSET_PATH?: string | string[] }).EXCALIDRAW_ASSET_PATH = fonts ? [app, fonts] : app;
}

/** Search source "drawing", fed as notes link drawings; forgets everything with the vault. */
export function connectDrawings(): void {
  setDrawingAssetPath();
  registerTextSource({
    name: "drawing",
    text: (note) => {
      const parts = drawingsIn(note.path, note.body).flatMap((id) => {
        const text = texts.get(id);
        return text ? [{ text, file: drawingSvgPath(id) }] : [];
      });
      return parts.length ? parts : null;
    },
  });
  useApp.subscribe((state, previous) => {
    if (state.vault !== previous.vault) {
      texts.clear();
      versions.clear();
    }
    if (state.vault.kind !== "ready" || (state.notes === previous.notes && state.vault === previous.vault)) return;
    const wanted = new Set<string>();
    for (const [id, note] of Object.entries(state.notes)) {
      if (previous.notes[id] === note && state.vault === previous.vault) continue;
      for (const drawing of drawingsIn(note.path, note.body)) wanted.add(drawing);
    }
    if (wanted.size) void readTexts(wanted);
  });
}
