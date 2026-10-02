import type { OutlineData } from "../editor/sections/outline";
import { create } from "zustand";
import type { Note } from "../core/note/note";
import { sortNotes, type SortKey } from "../core/note/sort";
import type { VaultErrorKind } from "../services/errors";
import { matchesFilter, type ListFilter } from "./sections";
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
  /** Section or tag shown in the note list. */
  filter: ListFilter;
  /** Per-tag settings from `.ursa/tags.json` (icon, colour, pinned, collapsed), keyed by tag key. */
  tagConfig: Record<string, TagSettings>;
  /** Short, non-blocking message ("3 liens mis à jour"). */
  toast: { id: number; text: string; action?: ToastAction } | null;
  /** Headings of the open note for the Contents panel, reported by the editor. */
  outline: OutlineData;
}

export interface TagSettings {
  icon?: string;
  /** Index in the tag colour palette (1–8); absent = default colour. */
  color?: number;
  pinned?: boolean;
  collapsed?: boolean;
}

export const useApp = create<AppState>()(() => ({
  vault: { kind: "loading" },
  notes: {},
  selectedId: null,
  settings: DEFAULT_SETTINGS,
  resizing: false,
  saveErrors: {},
  closePrompt: false,
  filter: { kind: "section", section: "notes" },
  tagConfig: {},
  toast: null,
  outline: { items: [], current: null },
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

export function listedNotes(notes: Record<string, Note>, sort: SortKey, filter: ListFilter, now: number = Date.now()): Note[] {
  return sortNotes(
    Object.values(notes).filter((n) => matchesFilter(n, filter, now)),
    sort,
  );
}

/** The note list as currently displayed. */
export function currentList(): Note[] {
  const { notes, settings, filter } = getState();
  return listedNotes(notes, settings.sort, filter);
}

/** Button of a toast ("Annuler"). */
export interface ToastAction {
  label: string;
  run: () => void;
}

let toastId = 0;
/** Shows a toast; the Toast component hides it after --toast-duration (longer with an action). */
export function showToast(text: string, action?: ToastAction): void {
  setState({ toast: { id: ++toastId, text, action } });
}
