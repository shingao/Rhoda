import { create } from "zustand";
import type { Note } from "../core/note/note";
import { sortNotes, type SortKey } from "../core/note/sort";
import type { VaultErrorKind } from "../services/errors";
import { DEFAULT_SETTINGS, type Settings } from "../services/settings";

export type VaultStatus = { kind: "loading" } | { kind: "ready"; path: string } | { kind: "error"; message: string };

interface AppState {
  vault: VaultStatus;
  /** The note index, keyed by note id (frontmatter `id`), never by path. */
  notes: Record<string, Note>;
  selectedId: string | null;
  settings: Settings;
  /** True while a column is being resized: disables width transitions. */
  resizing: boolean;
  /** Notes whose save failed more than twice in a row, with the last reason. */
  saveErrors: Record<string, VaultErrorKind>;
  /** Shown when the window is closing with unsaved content. */
  closePrompt: boolean;
}

export const useApp = create<AppState>()(() => ({
  vault: { kind: "loading" },
  notes: {},
  selectedId: null,
  settings: DEFAULT_SETTINGS,
  resizing: false,
  saveErrors: {},
  closePrompt: false,
}));

export const getState = useApp.getState;
export const setState = useApp.setState;

export function putNote(note: Note): void {
  setState((s) => ({ notes: { ...s.notes, [note.id]: note } }));
}

export function removeNotes(ids: string[]): void {
  if (ids.length === 0) return;
  setState((s) => {
    const notes = { ...s.notes };
    for (const id of ids) delete notes[id];
    return { notes, selectedId: s.selectedId && ids.includes(s.selectedId) ? null : s.selectedId };
  });
}

export function setSaveError(id: string, kind: VaultErrorKind | null): void {
  setState((s) => {
    if (kind === null && !(id in s.saveErrors)) return s;
    if (kind !== null && s.saveErrors[id] === kind) return s;
    const saveErrors = { ...s.saveErrors };
    if (kind === null) delete saveErrors[id];
    else saveErrors[id] = kind;
    return { saveErrors };
  });
}

export function updateSettings(patch: (s: Settings) => Settings): void {
  setState((s) => ({ settings: patch(s.settings) }));
}

/** Notes shown in the "Notes" section: not archived, not in the trash. */
export function isListed(note: Note): boolean {
  return !note.trashed && !note.archived;
}

export function listedNotes(notes: Record<string, Note>, sort: SortKey): Note[] {
  return sortNotes(Object.values(notes).filter(isListed), sort);
}

/** The "Notes" list as currently displayed. */
export function currentList(): Note[] {
  const { notes, settings } = getState();
  return listedNotes(notes, settings.sort);
}
