import { EditorSelection, StateEffect, StateField, type EditorState, type Transaction } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";
import { currentMessages } from "../../app/i18n";
import { keepFolds, sectionHeadingAt } from "./fold";
import { headingAt, sectionBody, type Heading } from "./headings";

/**
 * "Isoler cette section": everything outside one section is hidden (whole
 * lines, block decorations), with a bar to show the whole note again. Like
 * folds, the section is remembered by its heading line and recomputed after
 * each change; it ends when the heading disappears, when the cursor lands in
 * hidden text (search, undo) or when a user change touches hidden text.
 */

interface Isolated {
  heading: number;
  /** Visible part: the heading line to the end of its section. */
  from: number;
  to: number;
  deco: DecorationSet;
}

export const isolateSection = StateEffect.define<number>();
export const showWholeNote = StateEffect.define<null>();

class IsolationBar extends WidgetType {
  eq(other: WidgetType): boolean {
    return other instanceof IsolationBar;
  }

  toDOM(view: EditorView): HTMLElement {
    const t = currentMessages().focus;
    const bar = document.createElement("div");
    bar.className = "cm-isolation-bar";
    const label = document.createElement("span");
    label.textContent = t.isolated;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "cm-isolation-exit";
    button.textContent = t.showAll;
    button.addEventListener("click", () => view.dispatch({ effects: showWholeNote.of(null) }));
    bar.append(label, button);
    return bar;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

function resolve(state: EditorState, heading: number): Isolated | null {
  const h: Heading | null = headingAt(state, heading);
  if (!h) return null;
  const end = sectionBody(state, h)?.to ?? h.to;
  const ranges = [Decoration.widget({ widget: new IsolationBar(), block: true, side: -1 }).range(h.from)];
  if (h.from > 0) ranges.unshift(Decoration.replace({ block: true }).range(0, h.from - 1));
  if (end < state.doc.length) ranges.push(Decoration.replace({ block: true }).range(end + 1, state.doc.length));
  return { heading: h.from, from: h.from, to: end, deco: Decoration.set(ranges) };
}

function next(value: Isolated | null, tr: Transaction): Isolated | null {
  for (const e of tr.effects) {
    if (e.is(showWholeNote)) return null;
    if (e.is(isolateSection)) return resolve(tr.state, e.value);
  }
  if (!value) return null;
  let result = value;
  if (tr.docChanged) {
    const ours = tr.annotation(keepFolds) === true || tr.isUserEvent("ursa.rewrite");
    let outside = false;
    tr.changes.iterChangedRanges((fromA, toA) => {
      if (fromA < value.from || toA > value.to + 1) outside = true;
    });
    if (outside && !ours) return null;
    const r = resolve(tr.state, tr.changes.mapPos(value.heading, -1));
    if (!r) return null;
    result = r;
  }
  if ((tr.selection || tr.docChanged) && tr.state.selection.ranges.some((r) => r.head < result.from || r.head > result.to)) return null;
  return result;
}

export const isolationField = StateField.define<Isolated | null>({
  create: () => null,
  update: next,
  provide: (f) => [
    EditorView.decorations.from(f, (v) => v?.deco ?? Decoration.none),
    EditorView.atomicRanges.of((view) => view.state.field(f)?.deco ?? Decoration.none),
  ],
});

export function isolatedSection(state: EditorState): { from: number; to: number } | null {
  const v = state.field(isolationField, false);
  return v ? { from: v.from, to: v.to } : null;
}

/** Isolates the section of the cursor, or shows the whole note again. */
export function toggleIsolation(view: EditorView): boolean {
  if (isolatedSection(view.state)) {
    view.dispatch({ effects: showWholeNote.of(null), scrollIntoView: true });
    return true;
  }
  const h = sectionHeadingAt(view.state, view.state.selection.main.head);
  if (!h) return false;
  view.dispatch({ effects: [isolateSection.of(h.from), EditorView.scrollIntoView(h.from, { y: "start" })] });
  return true;
}

/** Escape leaves the isolated section. */
export function leaveIsolation(view: EditorView): boolean {
  if (!isolatedSection(view.state)) return false;
  view.dispatch({ effects: showWholeNote.of(null), scrollIntoView: true });
  return true;
}

/** Ctrl+A inside an isolated section selects the section, not the hidden text. */
export function selectIsolated(view: EditorView): boolean {
  const s = isolatedSection(view.state);
  if (!s) return false;
  view.dispatch({ selection: EditorSelection.range(s.from, s.to) });
  return true;
}
