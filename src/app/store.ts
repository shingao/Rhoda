import { create } from "zustand";
import type { Note } from "../core/note/note";
import { sortNotes, type SortKey } from "../core/note/sort";
import { DEFAULT_SETTINGS, type Settings } from "../services/settings";

export type VaultStatus = { kind: "loading" } | { kind: "ready"; path: string } | { kind: "error"; message: string };

interface AppState {
  vault: VaultStatus;
  notes: Record<string, Note>;
  selectedUid: string | null;
  settings: Settings;
  /** True while a column is being resized: disables width transitions. */
  resizing: boolean;
}

export const useApp = create<AppState>()(() => ({
  vault: { kind: "loading" },
  notes: {},
  selectedUid: null,
  settings: DEFAULT_SETTINGS,
  resizing: false,
}));

export const getState = useApp.getState;
export const setState = useApp.setState;

export function putNote(note: Note): void {
  setState((s) => ({ notes: { ...s.notes, [note.uid]: note } }));
}

export function removeNotes(uids: string[]): void {
  if (uids.length === 0) return;
  setState((s) => {
    const notes = { ...s.notes };
    for (const uid of uids) delete notes[uid];
    return { notes, selectedUid: s.selectedUid && uids.includes(s.selectedUid) ? null : s.selectedUid };
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
