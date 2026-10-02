import { Annotation, EditorSelection, EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

/**
 * Owns the single EditorView and one EditorState per note, so undo history and
 * cursor position survive switching notes.
 */

/** Marks transactions that come from disk, not from typing: they must not trigger a save. */
const fromDisk = Annotation.define<boolean>();

let view: EditorView | null = null;
let currentUid: string | null = null;
let extensions: Extension = [];
const states = new Map<string, EditorState>();

export function mountEditor(parent: HTMLElement, ext: Extension, onEdit: (uid: string, body: string) => void): EditorView {
  extensions = [
    ext,
    EditorView.updateListener.of((u) => {
      if (u.docChanged && currentUid && !u.transactions.some((t) => t.annotation(fromDisk))) {
        onEdit(currentUid, u.state.doc.toString());
      }
    }),
  ];
  view = new EditorView({ parent, state: EditorState.create({ extensions }) });
  return view;
}

export function unmountEditor(): void {
  if (view && currentUid) states.set(currentUid, view.state);
  view?.destroy();
  view = null;
  currentUid = null;
}

/** Shows a note instantly (no animation, DESIGN §4). */
export function showNote(uid: string | null, body: string): void {
  if (!view || uid === currentUid) return;
  if (currentUid) states.set(currentUid, view.state);
  currentUid = uid;
  view.setState(states.get(uid ?? "") ?? EditorState.create({ doc: uid ? body : "", extensions }));
}

/** Applies a change made outside Ursa, keeping the cursor where it can. */
export function replaceFromDisk(uid: string, body: string): void {
  if (uid !== currentUid || !view) {
    states.delete(uid);
    return;
  }
  const { state } = view;
  if (state.doc.toString() === body) return;
  const clamp = (n: number) => Math.min(n, body.length);
  view.dispatch({
    changes: { from: 0, to: state.doc.length, insert: body },
    selection: EditorSelection.create(state.selection.ranges.map((r) => EditorSelection.range(clamp(r.anchor), clamp(r.head)))),
    annotations: [fromDisk.of(true)],
  });
}

export function forgetNote(uid: string): void {
  states.delete(uid);
}

export function focusEditor(atEnd = false): void {
  if (!view) return;
  if (atEnd) view.dispatch({ selection: { anchor: view.state.doc.length } });
  view.focus();
}
