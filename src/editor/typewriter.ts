import { Compartment, EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

/** Typewriter mode: the line being edited stays vertically centred. */
export const typewriterCompartment = new Compartment();

const centreOnChange = EditorState.transactionExtender.of((tr) =>
  tr.selection || tr.docChanged ? { effects: EditorView.scrollIntoView(tr.newSelection.main.head, { y: "center" }) } : null,
);

export function typewriter(enabled: boolean): Extension {
  return enabled ? [centreOnChange, EditorView.editorAttributes.of({ class: "cm-typewriter" })] : [];
}
