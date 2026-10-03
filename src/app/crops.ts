import { basename } from "../core/note/filename";
import { relativeSrc, resolveVaultPath } from "../core/markdown/embeds";
import { replaceImageSrc } from "../editor/session";
import { assetsApi } from "../services/assets";
import { errorMessage } from "../services/errors";
import { vaultApi } from "../services/vault";
import { currentMessages } from "./i18n";
import { getState, setState, showToast } from "./store";

/**
 * Non-destructive crop: the original stays in `assets/`, the cropped version
 * is saved next to it (`photo-recadre.png`) and the note points to it.
 * `.ursa/crops.json` remembers which original and which rectangle, so a new
 * crop starts from the original and "Restore original" is always possible.
 */
const CROPS_FILE = "crops.json";

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}
interface CropRecord {
  original: string;
  rect: CropRect;
}
export interface CropRequest {
  noteId: string;
  /** Destination as written in the note. */
  src: string;
  lineFrom: number;
}

async function readCrops(): Promise<Record<string, CropRecord>> {
  try {
    const text = await vaultApi.readInternal(CROPS_FILE);
    const parsed = text ? (JSON.parse(text) as { crops?: Record<string, CropRecord> }) : null;
    return parsed?.crops && typeof parsed.crops === "object" ? parsed.crops : {};
  } catch {
    return {};
  }
}

/** Editor hook: "Crop…" on a selected image. */
export function openCrop(src: string, lineFrom: number): void {
  const { selectedId } = getState();
  if (selectedId) setState({ crop: { noteId: selectedId, src, lineFrom } });
}

export function closeCrop(): void {
  setState({ crop: null });
}

/** What the dialog shows: the original (and the previous rectangle) when the image is already a crop. */
export async function cropSource(req: CropRequest): Promise<{ path: string; url: string; rect: CropRect | null; cropped: boolean } | null> {
  const note = getState().notes[req.noteId];
  const path = note ? resolveVaultPath(note.path, req.src) : null;
  if (!path) return null;
  const record = (await readCrops())[path];
  const source = record?.original ?? path;
  return { path: source, url: assetsApi.url(source), rect: record?.rect ?? null, cropped: record !== undefined };
}

const stemOfFile = (path: string) => basename(path).replace(/\.[^.]+$/, "");

/** Saves the cropped pixels next to the original and points the note to them (one Ctrl+Z). */
export async function applyCrop(req: CropRequest, original: string, rect: CropRect, bytes: Uint8Array, ext: string): Promise<void> {
  const t = currentMessages();
  try {
    const result = await assetsApi.importBytes(bytes, `${stemOfFile(original)}-recadre.${ext}`);
    if (result.status !== "ok") throw new Error(result.reason);
    const crops = await readCrops();
    crops[result.path] = { original, rect };
    await vaultApi.writeInternal(CROPS_FILE, JSON.stringify({ version: 1, crops }, null, 2));
    pointTo(req, result.path);
    closeCrop();
  } catch (e) {
    console.warn("[ursa] crop failed", e);
    showToast(t.crop.failed(errorMessage(e)));
  }
}

/** "Restore original": the note points to the original again; the cropped file stays. */
export function restoreOriginal(req: CropRequest, original: string): void {
  pointTo(req, original);
  closeCrop();
}

function pointTo(req: CropRequest, path: string): void {
  const note = getState().notes[req.noteId];
  if (note) replaceImageSrc(req.noteId, req.lineFrom, relativeSrc(note.path, path));
}
