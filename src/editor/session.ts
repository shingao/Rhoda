import { isolateHistory } from "@codemirror/commands";
import { imageMarkdown, parseEmbedLine } from "../core/markdown/embeds";
import type { Compartment} from "@codemirror/state";
import { Annotation, EditorSelection, EditorState, Transaction, type Extension, type StateEffect } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { cssPx } from "../app/cssTokens";
import { foldKeys, matchFoldKeys, type FoldKey } from "../core/folds";
import { editorHooks, refreshPreview } from "./hooks";
import { foldAll, foldField, foldedRanges, setFolds, toggleFold, unfoldAll, unfoldHeading } from "./sections/fold";
import { isolatedSection, toggleIsolation } from "./sections/focus";
import { findField, findInfo, goToMatch, replaceAll, replaceCurrent, setNeedles, stepMatch } from "./find/find";
import type { Needle } from "../core/search/query";
import { headingsIn } from "./sections/headings";
import { serializeStickers, type Sticker } from "../core/stickers";
import { placeSticker, runStickerCommand, type NewSticker, type StickerCommand } from "./stickers/commands";
import { changesStickers, hideStickers, loadStickers, placeStickers, stickersField, storedStickers } from "./stickers/state";
import { commitStickerEdit } from "./stickers/layer";
import { EDITOR_COMMANDS } from "./setup";
import { alignField, alignmentAt, canAlignAt, changesAligns, loadAligns, placeAligns, storedAligns } from "./align";
import { serializeAligns, type Alignment, type BlockAlign } from "../core/align";

/** What a note carries besides its text, kept in the editor state: stickers and block alignments. */
export interface NoteExtras {
  stickers: readonly Sticker[];
  aligns: readonly BlockAlign[];
}

export const NO_EXTRAS: NoteExtras = { stickers: [], aligns: [] };
import type { ShortcutId } from "../app/shortcuts";

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
/**
 * Notes whose state (undo history, selection, scroll) is kept after leaving
 * them, most recent last (decision P10-17): memory stays flat however many
 * notes are opened. Older ones reopen from their saved text.
 */
const KEPT_STATES = 30;
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
      // Sticker changes are saved with the note's frontmatter, through the same autosave.
      const edited = (u.docChanged && !u.transactions.some((t) => t.annotation(fromDisk))) || u.transactions.some((t) => changesStickers(t) || changesAligns(t));
      if (edited && currentId) {
        onEdit(currentId, u.state.doc.toString());
      }
      if (u.startState.field(findField) !== u.state.field(findField)) editorHooks().findChanged(findInfo(u.state));
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
  if (view) commitStickerEdit(view);
  if (view && currentId) states.set(currentId, view.state);
  view?.destroy();
  view = null;
  currentId = null;
}

/** Another vault: forgets the editor state of every note (call after `showNote(null)`). */
export function resetEditor(): void {
  states.clear();
  scrolls.clear();
}

/** Shows a note instantly (no animation, DESIGN §4). */
export function showNote(id: string | null, body: string, extras: NoteExtras): void {
  if (!view || id === currentId) return;
  // A post-it being typed in belongs to the note being left.
  commitStickerEdit(view);
  if (currentId) {
    keep(currentId, view.state);
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
  view.dispatch({ effects: setNeedles.of(needles) });
  editorHooks().findChanged(findInfo(view.state));
  if (!kept && id) {
    restoreFolds(editorHooks().savedFolds(id));
    loadFromDisk(extras);
    if (editorHooks().stickersHidden(id)) view.dispatch({ effects: hideStickers.of(true), annotations: Transaction.addToHistory.of(false) });
  }
  // A kept state may show stale links or backlinks.
  refreshEditor();
}

/** Stores a note's state as the most recent one; drops the oldest beyond KEPT_STATES (never one with unsaved text). */
function keep(id: string, state: EditorState): void {
  states.delete(id);
  states.set(id, state);
  for (const old of states.keys()) {
    if (states.size <= KEPT_STATES) break;
    if (old === id || editorHooks().hasUnsavedText(old)) continue;
    states.delete(old);
    scrolls.delete(old);
  }
}

/** Redraws what depends on other notes (broken links, backlinks). */
export function refreshEditor(): void {
  view?.dispatch({ effects: refreshPreview.of(null) });
}

/** Puts the stickers and alignments read from the file in the open note (not undoable, not saved back). */
function loadFromDisk({ stickers, aligns }: NoteExtras): void {
  if (!view) return;
  const sameStickers = JSON.stringify(serializeStickers(storedStickers(view.state))) === JSON.stringify(serializeStickers(stickers));
  const sameAligns = JSON.stringify(serializeAligns(storedAligns(view.state))) === JSON.stringify(serializeAligns(aligns));
  if (sameStickers && sameAligns) return;
  view.dispatch({
    effects: [...(sameStickers ? [] : [loadStickers.of(placeStickers(stickers, view.state.doc))]), ...(sameAligns ? [] : [loadAligns.of(placeAligns(aligns, view.state.doc))])],
    annotations: [fromDisk.of(true), Transaction.addToHistory.of(false)],
  });
}

/** Applies a change made outside Ursa, keeping the cursor where it can. */
export function replaceFromDisk(id: string, body: string, extras: NoteExtras): void {
  if (id !== currentId || !view) {
    states.delete(id);
    return;
  }
  const { state } = view;
  if (state.doc.toString() === body) {
    loadFromDisk(extras);
    return;
  }
  const keys = currentFoldKeys(state);
  const clamp = (n: number) => Math.min(n, body.length);
  view.dispatch({
    changes: { from: 0, to: state.doc.length, insert: body },
    selection: EditorSelection.create(state.selection.ranges.map((r) => EditorSelection.range(clamp(r.anchor), clamp(r.head)))),
    annotations: [fromDisk.of(true)],
  });
  restoreFolds(keys);
  loadFromDisk(extras);
}

/** Block alignments of a note as they should be saved (anchors from its current text), or null if the editor does not hold it. */
export function editorAligns(id: string): BlockAlign[] | null {
  const state = id === currentId && view ? view.state : states.get(id);
  return state?.field(alignField, false) ? storedAligns(state) : null;
}

/** Alignment of the block at the cursor of the open note, and whether it can be aligned (menus, palette). */
export function alignmentHere(): { align: Alignment; available: boolean } {
  if (!view || !currentId) return { align: "left", available: false };
  return { align: alignmentAt(view.state), available: canAlignAt(view.state) };
}

/** Stickers of a note as they should be saved (anchors from its current text), or null if the editor does not hold it. */
export function editorStickers(id: string): Sticker[] | null {
  const state = id === currentId && view ? view.state : states.get(id);
  return state?.field(stickersField, false) ? storedStickers(state) : null;
}

/** Places a sticker or post-it in the open note (drawer click or drop). */
export function addSticker(noteId: string, spec: NewSticker, at?: { x: number; y: number }): string | null {
  if (!view || currentId !== noteId) return null;
  return placeSticker(view, spec, at);
}

/**
 * Removes the stickers showing a library image from a note held by the editor
 * (open or kept in memory), outside the undo history: the operation is undone
 * from its backup. False when the editor does not hold the note.
 */
export function removeStickerAsset(noteId: string, asset: string): boolean {
  const state = noteId === currentId && view ? view.state : states.get(noteId);
  const items = state?.field(stickersField, false);
  if (!state || !items) return false;
  const kept = items.filter((p) => p.asset !== asset);
  if (kept.length === items.length) return true;
  const spec = { effects: loadStickers.of(kept), annotations: [fromDisk.of(true), Transaction.addToHistory.of(false)] };
  if (noteId === currentId && view) view.dispatch(spec);
  else states.set(noteId, state.update(spec).state);
  return true;
}

/** "Hide stickers" of a note (open, or kept in memory). */
export function setStickersHidden(noteId: string, hidden: boolean): void {
  const spec = { effects: hideStickers.of(hidden), annotations: Transaction.addToHistory.of(false) };
  if (view && currentId === noteId) view.dispatch(spec);
  else {
    const kept = states.get(noteId);
    if (kept) states.set(noteId, kept.update(spec).state);
  }
}

/** A sticker of the open note (for its menu). */
export function stickerInfo(noteId: string, id: string): Sticker | null {
  if (!view || currentId !== noteId) return null;
  return view.state.field(stickersField, false)?.find((p) => p.id === id) ?? null;
}

/** Context menu of a sticker of the open note. */
export function stickerCommand(noteId: string, id: string, command: StickerCommand): void {
  if (view && currentId === noteId) runStickerCommand(view, id, command);
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

/** Types `text` at the cursor of the open note (palette › "Insert as link"); false without an open note. */
export function insertAtCursor(noteId: string, text: string): boolean {
  if (!view || currentId !== noteId) return false;
  view.dispatch(view.state.replaceSelection(text), { userEvent: "input", scrollIntoView: true });
  view.focus();
  return true;
}

/** An editor shortcut's command on the open note (command palette); false when there is none. */
export function runEditorCommand(id: ShortcutId): boolean {
  const command = EDITOR_COMMANDS[id];
  if (!view || !currentId || !command) return false;
  const done = command(view);
  view.focus();
  return done;
}

export function isSectionIsolated(): boolean {
  return view ? isolatedSection(view.state) !== null : false;
}

/** Words of the global search or of Ctrl+F, highlighted in every note shown. */
let needles: readonly Needle[] = [];

export function setFindNeedles(next: readonly Needle[]): void {
  needles = next;
  view?.dispatch({ effects: setNeedles.of(next) });
}

/** Opening a search result: shows its first occurrence (unfolding if needed). */
export function revealFirstMatch(select: boolean): void {
  if (view && view.state.field(findField).matches.length) goToMatch(view, 0, select);
}

export function findStep(direction: 1 | -1): void {
  if (view) stepMatch(view, direction);
}

export function replaceOne(replacement: string): void {
  if (view) replaceCurrent(view, replacement);
}

/** Returns the number of replacements (one undo step). */
export function replaceEvery(replacement: string): number {
  return view ? replaceAll(view, replacement) : 0;
}

/** Text selected in the open note (to start Ctrl+F from it). */
export function editorSelectionText(): string {
  if (!view) return "";
  const r = view.state.selection.main;
  return view.state.sliceDoc(r.from, r.to);
}

/**
 * Inserts block lines (images, PDF links) at the line of `pos` in the open
 * note: on that line if it is empty, otherwise right after it. Undoable.
 */
export function insertBlockLines(noteId: string, lines: string[], pos?: number): boolean {
  if (!view || currentId !== noteId || lines.length === 0) return false;
  const { state } = view;
  const line = state.doc.lineAt(Math.min(pos ?? state.selection.main.head, state.doc.length));
  const blank = line.text.trim() === "";
  // The cursor lands on the line after the blocks (one is added at the end of
  // the note), so the new image is shown rather than its Markdown.
  const last = line.number === state.doc.lines;
  const text = lines.join("\n") + (last ? "\n" : "");
  const insert = blank ? text : `\n${text}`;
  const from = blank ? line.from : line.to;
  const end = from + insert.length;
  view.dispatch({
    changes: { from, to: line.to, insert },
    selection: { anchor: last ? end : end + 1 },
    userEvent: "input.paste",
    scrollIntoView: true,
  });
  view.focus();
  return true;
}

/** Document position under a point of the window (CSS pixels), for drops. */
export function editorPosAt(x: number, y: number): number | null {
  return view?.posAtCoords({ x, y }) ?? null;
}

/** Points the image of the line starting at `lineFrom` to another file (crop, original). Undoable. */
export function replaceImageSrc(noteId: string, lineFrom: number, src: string): boolean {
  if (!view || currentId !== noteId || lineFrom > view.state.doc.length) return false;
  const line = view.state.doc.lineAt(lineFrom);
  const embed = parseEmbedLine(line.text);
  if (embed?.kind !== "image") return false;
  const indent = /^\s*/.exec(line.text)![0];
  view.dispatch({
    changes: { from: line.from, to: line.to, insert: indent + imageMarkdown(embed.alt, src, embed.width) },
    annotations: isolateHistory.of("full"),
    userEvent: "input.crop",
  });
  return true;
}

/** Replaces the text of the line starting at `lineFrom` (link card › Plain link). Undoable. */
export function setLineText(noteId: string, lineFrom: number, text: string): boolean {
  if (!view || currentId !== noteId || lineFrom > view.state.doc.length) return false;
  const line = view.state.doc.lineAt(lineFrom);
  view.dispatch({ changes: { from: line.from, to: line.to, insert: text }, annotations: isolateHistory.of("full"), userEvent: "input" });
  return true;
}
