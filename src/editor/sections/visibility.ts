import type { EditorState, StateEffect } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { foldHiddenRanges, foldedRanges, unfoldHeading } from "./fold";
import { isolatedSection, showWholeNote } from "./focus";

/**
 * What the reader cannot see: folded sections and, when a section is
 * isolated, everything around it. Phase 5 (search) reveals a match with
 * `revealPosition`; phase 8 hides stickers anchored where `isHidden` is true.
 */
export function hiddenRanges(state: EditorState): Array<{ from: number; to: number }> {
  const out = foldHiddenRanges(state);
  const isolated = isolatedSection(state);
  if (isolated) {
    if (isolated.from > 0) out.push({ from: 0, to: isolated.from - 1 });
    if (isolated.to < state.doc.length) out.push({ from: isolated.to + 1, to: state.doc.length });
  }
  return out.sort((a, b) => a.from - b.from);
}

export function isHidden(state: EditorState, pos: number): boolean {
  const isolated = isolatedSection(state);
  if (isolated && (pos < isolated.from || pos > isolated.to)) return true;
  return foldHiddenRanges(state).some((r) => pos > r.from && pos <= r.to);
}

/** Shows `pos`: leaves an isolated section that does not contain it and unfolds what hides it. */
export function revealPosition(view: EditorView, pos: number): void {
  const isolated = isolatedSection(view.state);
  const effects: StateEffect<unknown>[] = foldedRanges(view.state)
    .filter((f) => pos > f.from && pos <= f.to)
    .map((f) => unfoldHeading.of(f.heading));
  if (isolated && (pos < isolated.from || pos > isolated.to)) effects.push(showWholeNote.of(null));
  if (effects.length) view.dispatch({ effects });
}
