import type { FoldKey } from "../core/folds";
import { vaultApi } from "../services/vault";
import { getState } from "./store";

/**
 * Folded headings per note, in `.ursa/folds.json` (never in the Markdown):
 * `{ version: 1, notes: { <note id>: FoldKey[] } }`.
 */
const FOLDS_FILE = "folds.json";
const SAVE_DELAY = 500;

let folds: Record<string, FoldKey[]> = {};
let timer: ReturnType<typeof setTimeout> | undefined;

function isFoldKey(v: unknown): v is FoldKey {
  const k = v as FoldKey;
  return typeof k === "object" && k !== null && typeof k.text === "string" && typeof k.level === "number" && typeof k.index === "number";
}

export async function loadFolds(): Promise<void> {
  try {
    const text = await vaultApi.readInternal(FOLDS_FILE);
    const parsed = text ? (JSON.parse(text) as { notes?: unknown }) : null;
    const notes = parsed && typeof parsed.notes === "object" && parsed.notes !== null ? (parsed.notes as Record<string, unknown>) : {};
    folds = Object.fromEntries(
      Object.entries(notes).flatMap(([id, keys]) => (Array.isArray(keys) && keys.every(isFoldKey) ? [[id, keys]] : [])),
    );
  } catch (e) {
    console.warn("[ursa] folds.json ignored", e);
    folds = {};
  }
}

export function savedFolds(noteId: string): FoldKey[] {
  return folds[noteId] ?? [];
}

export function rememberFolds(noteId: string, keys: FoldKey[]): void {
  const before = JSON.stringify(folds[noteId] ?? []);
  if (before === JSON.stringify(keys)) return;
  if (keys.length) folds[noteId] = keys;
  else delete folds[noteId];
  clearTimeout(timer);
  timer = setTimeout(() => void save(), SAVE_DELAY);
}

function save(): Promise<void> {
  timer = undefined;
  // Notes deleted since are dropped.
  const { notes } = getState();
  const kept = Object.fromEntries(Object.entries(folds).filter(([id]) => notes[id]));
  return vaultApi
    .writeInternal(FOLDS_FILE, JSON.stringify({ version: 1, notes: kept }, null, 2))
    .catch((e: unknown) => console.warn("[ursa] folds.json not saved", e));
}

/** Before leaving a vault: writes pending changes now and forgets them. */
export async function closeFolds(): Promise<void> {
  if (timer !== undefined) {
    clearTimeout(timer);
    await save();
  }
  folds = {};
}
