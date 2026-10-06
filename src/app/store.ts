import type { OutlineData } from "../editor/sections/outline";
import type { CropRequest } from "./crops";
import { create } from "zustand";
import type { Note } from "../core/note/note";
import { sortNotes, type SortKey } from "../core/note/sort";
import { isEmptyQuery, parseQuery, type SearchQuery } from "../core/search/query";
import { searchNotes } from "../core/search/search";
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
  /** Global search: completed operators/tags shown as chips, then free text. */
  search: SearchInput;
  /** Find in the note (Ctrl+F / Ctrl+H) and the occurrences in the open note. */
  find: FindState;
  /** Focus mode (Ctrl+Shift+F): only the editor, the rest of the chrome fades out. Not persisted. */
  focusMode: boolean;
  /** Settings dialog and its current page; null = closed. */
  settingsPage: SettingsPage | null;
  /** Menu of a link card (Refresh, Plain link). */
  cardMenu: { noteId: string; url: string; lineFrom: number; at: { x: number; y: number } } | null;
  /** Crop dialog of an image of the open note. */
  crop: CropRequest | null;
  /** Sticker drawer open (not persisted) and the vault's imported stickers ("Mine"). */
  stickerDrawer: boolean;
  stickerLibrary: string[];
  /** Context menu of a sticker or post-it of the open note. */
  stickerMenu: { noteId: string; id: string; at: { x: number; y: number } } | null;
}

export type SettingsPage = "general" | "editor" | "backups";

export interface SearchInput {
  chips: string[];
  text: string;
}

export interface FindState {
  open: boolean;
  /** Bumped to focus the find field again (Ctrl+F while it is open). */
  focusToken: number;
  replace: boolean;
  query: string;
  count: number;
  current: number | null;
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
  search: { chips: [], text: "" },
  find: { open: false, focusToken: 0, replace: false, query: "", count: 0, current: null },
  settingsPage: null,
  crop: null,
  cardMenu: null,
  stickerMenu: null,
  stickerDrawer: false,
  stickerLibrary: [],
  focusMode: false,
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

/** The raw query typed in the search field. */
export function searchText(search: SearchInput): string {
  return [...search.chips, search.text].join(" ").trim();
}

let parsedFor = "";
let parsed: SearchQuery = parseQuery("");
/** Parsed search query (memoized on the raw text); null when there is no search. */
export function activeQuery(search: SearchInput): SearchQuery | null {
  const raw = searchText(search);
  if (raw !== parsedFor) {
    parsedFor = raw;
    parsed = parseQuery(raw);
  }
  return isEmptyQuery(parsed) ? null : parsed;
}

/**
 * Notes of the list. With a search, the whole vault is searched (archived
 * notes included, marked on their card) — except in the trash view, which
 * searches the trash only.
 */
let listCache: { args: unknown[]; result: Note[] } | null = null;

export function listedNotes(
  notes: Record<string, Note>,
  sort: SortKey,
  filter: ListFilter,
  now: number = Date.now(),
  query: SearchQuery | null = null,
): Note[] {
  // The field (count) and the column ask for the same list: compute it once.
  const args = [notes, sort, filter, Math.floor(now / 60_000), query];
  if (listCache && listCache.args.every((a, i) => a === args[i])) return listCache.result;
  const result = computeList(notes, sort, filter, now, query);
  listCache = { args, result };
  return result;
}

function computeList(notes: Record<string, Note>, sort: SortKey, filter: ListFilter, now: number, query: SearchQuery | null): Note[] {
  if (query) {
    const inTrash = filter.kind === "section" && filter.section === "trash";
    const scope = Object.values(notes).filter((n) => n.trashed === inTrash);
    return searchNotes(scope, query, now, (list) => sortNotes(list, sort));
  }
  return sortNotes(
    Object.values(notes).filter((n) => matchesFilter(n, filter, now)),
    sort,
  );
}

/** The note list as currently displayed. */
export function currentList(): Note[] {
  const { notes, settings, filter, search } = getState();
  return listedNotes(notes, settings.sort, filter, Date.now(), activeQuery(search));
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
