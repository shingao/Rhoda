import { isolateHistory } from "@codemirror/commands";
import { EditorSelection, StateEffect, StateField, type EditorState, type Text, type TransactionSpec } from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";
import { findAll, foldWithMap } from "../../core/search/fold";
import type { Needle } from "../../core/search/query";
import { keepFolds } from "../sections/fold";
import { revealPosition } from "../sections/visibility";

/**
 * Occurrences in the open note [DESIGN §2.3]: the words of the global search
 * or the Ctrl+F query, with the same rules (case and accents ignored).
 * Current occurrence = `--match` + accent ring, others `--match`.
 */

export type Match = readonly [from: number, to: number];

interface FindState {
  needles: readonly Needle[];
  matches: readonly Match[];
  /** Index of the current occurrence in `matches`. */
  current: number | null;
  deco: DecorationSet;
}

export const setNeedles = StateEffect.define<readonly Needle[]>();
export const setCurrent = StateEffect.define<number | null>();

const folded = new WeakMap<Text, { text: string; map: number[] }>();

/** Every occurrence of the needles in the document, in order, not overlapping. */
export function findMatches(doc: Text, needles: readonly Needle[]): Match[] {
  if (needles.length === 0) return [];
  let f = folded.get(doc);
  if (!f) folded.set(doc, (f = foldWithMap(doc.toString())));
  const { text, map } = f;
  const raw: Match[] = [];
  for (const n of needles) for (const at of findAll(text, n.text, n.wordStart)) raw.push([map[at]!, map[at + n.text.length] ?? doc.length]);
  raw.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  const out: Match[] = [];
  for (const m of raw) if (!out.length || m[0] >= out[out.length - 1]![1]) out.push(m);
  return out;
}

const matchMark = Decoration.mark({ class: "cm-find-match" });
const currentMark = Decoration.mark({ class: "cm-find-match cm-find-current" });

function decorate(matches: readonly Match[], current: number | null): DecorationSet {
  return Decoration.set(matches.filter(([a, b]) => b > a).map(([a, b], i) => (i === current ? currentMark : matchMark).range(a, b)));
}

export const findField = StateField.define<FindState>({
  create: () => ({ needles: [], matches: [], current: null, deco: Decoration.none }),
  update(value, tr) {
    let { needles, matches, current } = value;
    let changed = false;
    for (const e of tr.effects) {
      if (e.is(setNeedles)) {
        needles = e.value;
        matches = findMatches(tr.state.doc, needles);
        current = null;
        changed = true;
      } else if (e.is(setCurrent)) {
        current = e.value;
        changed = true;
      }
    }
    if (tr.docChanged && needles.length && !changed) {
      matches = findMatches(tr.state.doc, needles);
      if (current !== null) current = matches.length ? Math.min(current, matches.length - 1) : null;
      changed = true;
    }
    if (!changed) return value;
    return { needles, matches, current, deco: decorate(matches, current) };
  },
  provide: (f) => EditorView.decorations.from(f, (v) => v.deco),
});

export function findInfo(state: EditorState): { count: number; current: number | null } {
  const f = state.field(findField, false);
  return { count: f?.matches.length ?? 0, current: f?.current ?? null };
}

/** Selects occurrence `index`: unfolds what hides it, scrolls it to the middle. */
export function goToMatch(view: EditorView, index: number, select = true): void {
  const { matches } = view.state.field(findField);
  const m = matches[index];
  if (!m) return;
  revealPosition(view, m[0]);
  view.dispatch({
    effects: [setCurrent.of(index), EditorView.scrollIntoView(m[0], { y: "center" })],
    selection: select ? EditorSelection.range(m[0], m[1]) : undefined,
  });
}

/** Next (or previous) occurrence after the current one, or after the cursor. */
export function stepMatch(view: EditorView, direction: 1 | -1): boolean {
  const { matches, current } = view.state.field(findField);
  if (!matches.length) return false;
  let index: number;
  if (current !== null) index = (current + direction + matches.length) % matches.length;
  else {
    // From the start of the selection, so typing more letters refines the same occurrence.
    const head = view.state.selection.main.from;
    const after = matches.findIndex(([a]) => a >= head);
    index = direction === 1 ? (after < 0 ? 0 : after) : (after <= 0 ? matches.length : after) - 1;
  }
  goToMatch(view, index);
  return true;
}

/** Replaces the current occurrence and moves to the next one. */
export function replaceCurrent(view: EditorView, replacement: string): boolean {
  const { matches, current } = view.state.field(findField);
  const m = current !== null ? matches[current] : undefined;
  if (!m) return stepMatch(view, 1);
  view.dispatch({ changes: { from: m[0], to: m[1], insert: replacement }, userEvent: "input.replace" });
  const next = view.state.field(findField).matches.findIndex(([a]) => a >= m[0] + replacement.length);
  if (next >= 0) goToMatch(view, next);
  else view.dispatch({ effects: setCurrent.of(null) });
  return true;
}

/** One transaction replacing every occurrence: its own undo step, a single Ctrl+Z undoes it. */
export function replaceAllSpec(state: EditorState, replacement: string): TransactionSpec | null {
  const { matches } = state.field(findField);
  if (!matches.length) return null;
  return {
    changes: matches.map(([from, to]) => ({ from, to, insert: replacement })),
    userEvent: "input.replace.all",
    // Replacing inside folded sections does not unfold them all.
    annotations: [keepFolds.of(true), isolateHistory.of("full")],
  };
}

/** Replaces every occurrence. Returns the count. */
export function replaceAll(view: EditorView, replacement: string): number {
  const spec = replaceAllSpec(view.state, replacement);
  if (!spec) return 0;
  const count = view.state.field(findField).matches.length;
  view.dispatch(spec);
  return count;
}
