import { fold } from "../core/search/fold";
import { warmIndex } from "../core/search/search";
import type { Needle } from "../core/search/query";
import { focusEditor, revealFirstMatch, setFindNeedles } from "../editor/session";
import { createNote, selectNote } from "./notes";
import { activeQuery, currentList, getState, setState, useApp, type FindState, type SearchInput } from "./store";

/** Global search (titlebar) and find in note (Ctrl+F): state changes and wiring to the editor. */

export function setSearch(search: SearchInput): void {
  setState({ search });
}

export function clearSearch(): void {
  setState({ search: { chips: [], text: "" } });
}

/** Enter in the search field: opens the selected result (or the first one) at its first occurrence. */
export function openSearchResult(): boolean {
  const list = currentList();
  const selected = getState().selectedId;
  const target = list.find((n) => n.id === selected) ?? list[0];
  if (!target) return false;
  selectNote(target.id);
  focusEditor();
  revealFirstMatch(true);
  return true;
}

/** ↑ / ↓ in the search field: previous / next result. */
export function stepSearchResult(direction: 1 | -1): void {
  const list = currentList();
  if (!list.length) return;
  const index = list.findIndex((n) => n.id === getState().selectedId);
  const next = index < 0 ? (direction === 1 ? 0 : list.length - 1) : Math.max(0, Math.min(list.length - 1, index + direction));
  selectNote(list[next]!.id);
}

/** "Créer la note « … »" when nothing matches: the search is cleared, the note opened. */
export async function createFromSearch(title: string): Promise<void> {
  clearSearch();
  await createNote(title);
}

export function setFind(patch: Partial<FindState>): void {
  setState((s) => ({ find: { ...s.find, ...patch } }));
}

export function openFind(replace: boolean): void {
  setFind({ open: true, replace: replace || getState().find.replace });
}

export function closeFind(): void {
  setFind({ open: false, replace: false });
  focusEditor();
}

/** What the open note highlights: the Ctrl+F text, else the words of the global search. */
function currentNeedles(): Needle[] {
  const { find, search } = getState();
  if (find.open) {
    const text = fold(find.query);
    return text ? [{ text, wordStart: false }] : [];
  }
  return activeQuery(search)?.include ?? [];
}

const WARM_BATCH = 50;
type IdleWindow = Window & { requestIdleCallback?: (cb: () => void) => number };

/** Builds the search index in idle time, so the first keystroke is as fast as the others. */
function warmUp(): void {
  const idle = (cb: () => void) => ((window as IdleWindow).requestIdleCallback ?? ((f: () => void) => setTimeout(f, 50)))(cb);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const run = () => {
    const notes = Object.values(getState().notes);
    let i = 0;
    const step = () => {
      warmIndex(notes.slice(i, i + WARM_BATCH));
      i += WARM_BATCH;
      if (i < notes.length) idle(step);
    };
    idle(step);
  };
  // Again after startup indexing (tags, todos) has replaced the notes, once things are quiet.
  useApp.subscribe((state, previous) => {
    if (state.notes === previous.notes) return;
    clearTimeout(timer);
    timer = setTimeout(run, 1000);
  });
  run();
}

/** Keeps the editor's highlights in sync; a result opened during a search shows its first occurrence. */
export function connectSearch(): void {
  warmUp();
  let last = "";
  useApp.subscribe((state, previous) => {
    if (state.find === previous.find && state.search === previous.search && state.selectedId === previous.selectedId) return;
    const needles = currentNeedles();
    const key = JSON.stringify(needles);
    if (key !== last) {
      last = key;
      setFindNeedles(needles);
    }
    // After the editor has switched to the newly selected note.
    if (state.selectedId !== previous.selectedId && needles.length && !state.find.open) queueMicrotask(() => revealFirstMatch(false));
  });
}
