import type { Compartment} from "@codemirror/state";
import { Annotation, EditorSelection, EditorState, type Extension, type StateEffect } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { cssPx } from "../app/cssTokens";
import { foldKeys, matchFoldKeys, type FoldKey } from "../core/folds";
import { editorHooks, refreshPreview } from "./hooks";
import { foldAll, foldField, foldedRanges, setFolds, toggleFold, unfoldAll, unfoldHeading } from "./sections/fold";
import { isolatedSection, toggleIsolation } from "./sections/focus";
import { headingsIn } from "./sections/headings";

/**
 * Owns the single EditorView and one EditorState per note (keyed by note id),
 * so undo history and cursor position survive switching notes.
 */

/** Marks transactions that come from disk, not from typing: they must not trigger a save. */
const fromDisk = Annotation.define<boolean>();

let view: EditorView | null = null;
let currentId: string | null = null;
let extensions: Extension = [];
const states = new Map<string, EditorState>();
/** Scroll position of each note, as an anchor that survives height re-estimation. */
const scrolls = new Map<string, StateEffect<unknown>>();
/** Options that can change at runtime (typewriter mode…), re-applied to every note's state. */
const dynamic = new Map<Compartment, Extension>();

/** Delay before reporting fold changes for saving. */
const FOLD_REPORT_DELAY = 500;
let foldReport: { id: string; timer: ReturnType<typeof setTimeout> } | null = null;

/** Fold state of a note as keys that survive edits made while it is closed. */
function currentFoldKeys(state: EditorState): FoldKey[] {
  const folds = foldedRanges(state);
  if (folds.length === 0) return [];
  const headings = headingsIn(state);
  const folded = new Set(folds.map((f) => f.heading));
  return foldKeys(
    headings,
    headings.flatMap((h, i) => (folded.has(h.from) ? [i] : [])),
  );
}

function reportFolds(id: string, state: EditorState, now = false): void {
  if (foldReport) clearTimeout(foldReport.timer);
  const run = () => {
    foldReport = null;
    editorHooks().foldsChanged(id, currentFoldKeys(state));
  };
  if (now) run();
  else foldReport = { id, timer: setTimeout(run, FOLD_REPORT_DELAY) };
}

/** Folds the headings matching saved keys (note opened, or reloaded from disk). */
function restoreFolds(keys: FoldKey[]): void {
  if (!view || keys.length === 0) return;
  const headings = headingsIn(view.state);
  const folds = matchFoldKeys(keys, headings).map((i) => headings[i]!.from);
  if (folds.length) view.dispatch({ effects: setFolds.of(folds) });
}

function applyDynamic(): void {
  if (!view || dynamic.size === 0) return;
  view.dispatch({ effects: [...dynamic].map(([c, ext]) => c.reconfigure(ext)) });
}

/** Sets a runtime option, for the open note and every note shown afterwards. */
export function setEditorOption(compartment: Compartment, ext: Extension): void {
  dynamic.set(compartment, ext);
  applyDynamic();
}

/** Extensions for new states, with the current value of each runtime option. */
function stateExtensions(): Extension {
  return [extensions, [...dynamic].map(([c, ext]) => c.of(ext))];
}

export function mountEditor(parent: HTMLElement, ext: Extension, onEdit: (id: string, body: string) => void): EditorView {
  extensions = [
    ext,
    EditorView.updateListener.of((u) => {
      if (u.docChanged && currentId && !u.transactions.some((t) => t.annotation(fromDisk))) {
        onEdit(currentId, u.state.doc.toString());
      }
      const folds = u.state.field(foldField);
      if (currentId && (folds !== u.startState.field(foldField) || (u.docChanged && folds.folds.length > 0))) {
        reportFolds(currentId, u.state);
      }
    }),
  ];
  view = new EditorView({ parent, state: EditorState.create({ extensions: stateExtensions() }) });
  // Development only: lets browser tests reach the view.
  if (import.meta.env.DEV) (window as { __ursaView?: EditorView }).__ursaView = view;
  return view;
}

export function unmountEditor(): void {
  if (view && currentId) states.set(currentId, view.state);
  view?.destroy();
  view = null;
  currentId = null;
}

/** Shows a note instantly (no animation, DESIGN §4). */
export function showNote(id: string | null, body: string): void {
  if (!view || id === currentId) return;
  if (currentId) {
    states.set(currentId, view.state);
    scrolls.set(currentId, view.scrollSnapshot());
  }
  if (foldReport && view) reportFolds(foldReport.id, view.state, true);
  currentId = id;
  const kept = states.get(id ?? "");
  // Start the next note at its own position (top if new), not at the previous
  // note's pixel offset: that made CodeMirror re-measure in a loop on long notes.
  view.scrollDOM.scrollTop = 0;
  view.setState(kept ?? EditorState.create({ doc: id ? body : "", extensions: stateExtensions() }));
  const scroll = kept && id ? scrolls.get(id) : undefined;
  if (scroll) view.dispatch({ effects: scroll });
  applyDynamic();
  if (!kept && id) restoreFolds(editorHooks().savedFolds(id));
  // A kept state may show stale links or backlinks.
  refreshEditor();
}

/** Redraws what depends on other notes (broken links, backlinks). */
export function refreshEditor(): void {
  view?.dispatch({ effects: refreshPreview.of(null) });
}

/** Applies a change made outside Ursa, keeping the cursor where it can. */
export function replaceFromDisk(id: string, body: string): void {
  if (id !== currentId || !view) {
    states.delete(id);
    return;
  }
  const { state } = view;
  if (state.doc.toString() === body) return;
  const keys = currentFoldKeys(state);
  const clamp = (n: number) => Math.min(n, body.length);
  view.dispatch({
    changes: { from: 0, to: state.doc.length, insert: body },
    selection: EditorSelection.create(state.selection.ranges.map((r) => EditorSelection.range(clamp(r.anchor), clamp(r.head)))),
    annotations: [fromDisk.of(true)],
  });
  restoreFolds(keys);
}

/** Latest text of a note in the editor (open or kept in memory), or null. */
export function editorText(id: string): string | null {
  if (id === currentId && view) return view.state.doc.toString();
  return states.get(id)?.doc.toString() ?? null;
}

/**
 * Applies edits computed elsewhere (link or tag rewrites). In the open note it
 * is a normal transaction, undoable with Ctrl+Z; a note kept in memory gets the
 * same change in its saved state so its history stays consistent.
 */
export function rewriteInEditor(id: string, changes: Array<{ from: number; to: number; insert: string }>): "view" | "cached" | "none" {
  if (id === currentId && view) {
    view.dispatch({ changes, userEvent: "ursa.rewrite" });
    return "view";
  }
  const cached = states.get(id);
  if (cached) {
    states.set(id, cached.update({ changes, userEvent: "ursa.rewrite" }).state);
    return "cached";
  }
  return "none";
}

export function forgetNote(id: string): void {
  states.delete(id);
  scrolls.delete(id);
}

export function focusEditor(atEnd = false): void {
  if (!view) return;
  if (atEnd) view.dispatch({ selection: { anchor: view.state.doc.length } });
  view.focus();
}

/**
 * Contents panel: shows a heading. A folded heading, or one inside a folded
 * section, is unfolded first; then the view scrolls smoothly to it.
 */
export function scrollToHeading(heading: number): void {
  if (!view) return;
  const v = view;
  const unfold = foldedRanges(v.state).filter((f) => f.heading === heading || (heading > f.from && heading <= f.to));
  if (unfold.length) v.dispatch({ effects: unfold.map((f) => unfoldHeading.of(f.heading)) });
  v.requestMeasure({
    read: () => v.scrollDOM.scrollTop + v.documentTop + v.lineBlockAt(heading).top - v.scrollDOM.getBoundingClientRect().top,
    write: (top) => {
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      v.scrollDOM.scrollTo({ top: Math.max(0, top - cssPx("--rhythm")), behavior: reduced ? "auto" : "smooth" });
    },
  });
}

/** Contents panel chevron: same fold as the editor's chevron. */
export function toggleFoldAt(heading: number): void {
  if (view) toggleFold(view, heading);
}

export type SectionCommand = "foldAll" | "unfoldAll" | "toggleIsolation";

/** Section commands for the editor's "…" menu. */
export function runSectionCommand(command: SectionCommand): void {
  if (!view) return;
  ({ foldAll, unfoldAll, toggleIsolation })[command](view);
  view.focus();
}

export function isSectionIsolated(): boolean {
  return view ? isolatedSection(view.state) !== null : false;
}
