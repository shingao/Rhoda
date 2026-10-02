import { Annotation, EditorSelection, StateEffect, StateField, type EditorState, type Extension, type Transaction, type TransactionSpec } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";
import { currentMessages } from "../../app/i18n";
import { headingAt, headingsIn, sectionBody, taskCounts, type Heading } from "./headings";

/**
 * Heading folds [DESIGN §2.13]. A fold is remembered by the start of its
 * heading line, mapped through every change, so it survives edits anywhere
 * and the renaming of the heading. The hidden range is recomputed from the
 * syntax tree after each change:
 * - the line is no longer a heading (deleted, joined…) → the fold goes, the
 *   content is shown again, nothing is lost;
 * - a change inside the hidden text (undo, replace…) or the cursor landing in
 *   it (search, undo) unfolds it — except rewrites made by Ursa itself
 *   (link/tag updates), marked with `keepFolds`;
 * - the hidden range is atomic for the cursor, and copying a selection that
 *   crosses it copies the whole Markdown (CodeMirror copies document text).
 */

export interface FoldedRange {
  /** Start of the heading line: the fold's identity. */
  heading: number;
  from: number;
  to: number;
}

interface FoldState {
  folds: readonly FoldedRange[];
  /** Outermost folds only (a fold inside a folded section stays remembered). */
  deco: DecorationSet;
}

export const foldHeading = StateEffect.define<number>();
export const unfoldHeading = StateEffect.define<number>();
/** Replaces every fold (restoring saved state, fold/unfold all). */
export const setFolds = StateEffect.define<readonly number[]>();
/** Changes made on the user's behalf that must not unfold anything. */
export const keepFolds = Annotation.define<boolean>();

/** Pill after a folded heading: "···" or "7 tâches · 4 faites". Click = unfold. */
class FoldBadge extends WidgetType {
  constructor(
    readonly heading: number,
    readonly label: string,
  ) {
    super();
  }

  eq(other: WidgetType): boolean {
    return other instanceof FoldBadge && other.label === this.label && other.heading === this.heading;
  }

  toDOM(view: EditorView): HTMLElement {
    // Zero-height box: the pill never makes the heading line taller (rhythm).
    const badge = document.createElement("span");
    badge.className = "cm-fold-badge";
    const pill = document.createElement("span");
    pill.className = "cm-fold-pill";
    pill.textContent = this.label;
    badge.append(pill);
    badge.title = currentMessages().folding.unfold;
    badge.setAttribute("aria-label", currentMessages().folding.unfold);
    badge.addEventListener("mousedown", (e) => {
      e.preventDefault();
      view.dispatch({ effects: unfoldHeading.of(this.heading) });
    });
    return badge;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

function badgeLabel(state: EditorState, fold: FoldedRange): string {
  const { done, total } = taskCounts(state.sliceDoc(fold.from, fold.to));
  return total > 0 ? currentMessages().folding.tasks(total, done) : "···";
}

/** Valid folds for these heading positions in `state`, sorted, without duplicates. */
function resolveFolds(state: EditorState, headings: Iterable<number>): FoldedRange[] {
  const out: FoldedRange[] = [];
  for (const pos of [...new Set(headings)].sort((a, b) => a - b)) {
    const h = headingAt(state, pos);
    const body = h && sectionBody(state, h);
    if (body) out.push({ heading: pos, ...body });
  }
  return out;
}

function decorate(state: EditorState, folds: readonly FoldedRange[]): DecorationSet {
  const ranges = [];
  let coveredTo = -1;
  for (const f of folds) {
    if (f.from < coveredTo) continue; // inside an outer fold
    ranges.push(Decoration.replace({ widget: new FoldBadge(f.heading, badgeLabel(state, f)) }).range(f.from, f.to));
    coveredTo = f.to;
  }
  return Decoration.set(ranges);
}

/** True when the change touches the hidden text (or is typed right after it). */
function touchesHidden(tr: Transaction, f: FoldedRange): boolean {
  let hit = false;
  tr.changes.iterChangedRanges((fromA, toA) => {
    if (fromA <= f.to && toA > f.from) hit = true;
  });
  return hit;
}

function nextState(value: FoldState, tr: Transaction): FoldState {
  let headings: number[] | null = null;
  if (tr.docChanged) {
    const keep = tr.annotation(keepFolds) === true || tr.isUserEvent("ursa.rewrite");
    headings = value.folds.filter((f) => keep || !touchesHidden(tr, f)).map((f) => tr.changes.mapPos(f.heading, -1));
  }
  for (const e of tr.effects) {
    if (e.is(setFolds)) headings = [...e.value];
    else if (e.is(foldHeading)) headings = [...(headings ?? value.folds.map((f) => f.heading)), e.value];
    else if (e.is(unfoldHeading)) headings = (headings ?? value.folds.map((f) => f.heading)).filter((h) => h !== e.value);
  }
  let folds = headings ? resolveFolds(tr.state, headings) : value.folds;
  // The cursor landed inside hidden text (search, undo…): show it.
  if (tr.selection || tr.docChanged) {
    const inside = (f: FoldedRange) => tr.state.selection.ranges.some((r) => r.head > f.from && r.head < f.to);
    if (folds.some(inside)) folds = folds.filter((f) => !inside(f));
  }
  if (folds === value.folds) return value;
  return { folds, deco: decorate(tr.state, folds) };
}

export const foldField = StateField.define<FoldState>({
  create: () => ({ folds: [], deco: Decoration.none }),
  update: nextState,
  provide: (f) => [EditorView.decorations.from(f, (v) => v.deco), EditorView.atomicRanges.of((view) => view.state.field(f).deco)],
});

export function foldedRanges(state: EditorState): readonly FoldedRange[] {
  return state.field(foldField, false)?.folds ?? [];
}

export function isFolded(state: EditorState, heading: number): boolean {
  return foldedRanges(state).some((f) => f.heading === heading);
}

/** Text hidden by folds (outermost ranges); see visibility.ts for the full picture. */
export function foldHiddenRanges(state: EditorState): Array<{ from: number; to: number }> {
  const out: Array<{ from: number; to: number }> = [];
  state.field(foldField, false)?.deco.between(0, state.doc.length, (from, to) => void out.push({ from, to }));
  return out;
}

/** The heading of the section the cursor is in (its own line, or the closest heading above with a section that contains it). */
export function sectionHeadingAt(state: EditorState, pos: number): Heading | null {
  const before = headingsIn(state, 0, state.doc.lineAt(pos).to).filter((h) => h.from <= pos);
  for (let i = before.length - 1; i >= 0; i--) {
    const h = before[i]!;
    if (pos <= h.to) return h;
    const body = sectionBody(state, h);
    if (body && pos <= body.to) return h;
  }
  return null;
}

/** Moves cursors out of what is about to be hidden, to the end of the heading. */
function selectionOutside(state: EditorState, folds: FoldedRange[]): EditorSelection | undefined {
  let moved = false;
  const ranges = state.selection.ranges.map((r) => {
    const f = folds.find((x) => r.head > x.from && r.head <= x.to);
    if (!f) return r;
    moved = true;
    return EditorSelection.cursor(f.from);
  });
  return moved ? EditorSelection.create(ranges, state.selection.mainIndex) : undefined;
}

/** Transaction folding exactly these headings (others unfolded), cursors moved out of hidden text. */
export function foldSpec(state: EditorState, headings: number[]): TransactionSpec {
  const folds = resolveFolds(state, headings);
  return { effects: setFolds.of(folds.map((f) => f.heading)), selection: selectionOutside(state, folds) };
}

const folded = (state: EditorState) => foldedRanges(state).map((f) => f.heading);

export function toggleFold(view: EditorView, heading: number): void {
  if (isFolded(view.state, heading)) view.dispatch({ effects: unfoldHeading.of(heading) });
  else view.dispatch(foldSpec(view.state, [...folded(view.state), heading]));
}

/** Folds the section the cursor is in. */
export function foldCurrent(view: EditorView): boolean {
  const h = sectionHeadingAt(view.state, view.state.selection.main.head);
  if (!h || isFolded(view.state, h.from)) return false;
  view.dispatch(foldSpec(view.state, [...folded(view.state), h.from]));
  return true;
}

/** Unfolds the folded section whose heading the cursor is on. */
export function unfoldCurrent(view: EditorView): boolean {
  const line = view.state.doc.lineAt(view.state.selection.main.head);
  const fold = foldedRanges(view.state).find((f) => f.heading === line.from || (line.from >= f.heading && line.from <= f.from));
  if (!fold) return false;
  view.dispatch({ effects: unfoldHeading.of(fold.heading) });
  return true;
}

export function foldAll(view: EditorView): boolean {
  view.dispatch(foldSpec(view.state, headingsIn(view.state).map((h) => h.from)));
  return true;
}

export function unfoldAll(view: EditorView): boolean {
  if (foldedRanges(view.state).length === 0) return false;
  view.dispatch({ effects: setFolds.of([]) });
  return true;
}

export const folding: Extension = foldField;
