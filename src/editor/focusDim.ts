import { Compartment, RangeSetBuilder, type EditorState, type Extension } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from "@codemirror/view";

/** Focus mode (maquette 03): the paragraph being written stays in full ink, the others fade. */
export const focusDimCompartment = new Compartment();

const dimmed = Decoration.line({ class: "cm-dimmed" });
const HEADING = /^ {0,3}#{1,6}(\s|$)/;
const blank = (text: string) => text.trim() === "";

/** Lines of the block (run of non-blank lines) holding the cursor. */
function currentBlock(state: EditorState): { from: number; to: number } {
  const { doc } = state;
  const line = doc.lineAt(state.selection.main.head);
  if (blank(line.text) || HEADING.test(line.text)) return { from: line.number, to: line.number };
  let from = line.number;
  let to = line.number;
  while (from > 1 && !blank(doc.line(from - 1).text) && !HEADING.test(doc.line(from).text)) from--;
  while (to < doc.lines && !blank(doc.line(to + 1).text) && !HEADING.test(doc.line(to + 1).text)) to++;
  return { from, to };
}

function build(view: EditorView): DecorationSet {
  const { state } = view;
  const block = currentBlock(state);
  const builder = new RangeSetBuilder<Decoration>();
  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to; ) {
      const line = state.doc.lineAt(pos);
      // Headings keep their ink: they are the note's landmarks.
      const inBlock = line.number >= block.from && line.number <= block.to;
      if (!inBlock && !HEADING.test(line.text)) builder.add(line.from, line.from, dimmed);
      pos = line.to + 1;
    }
  }
  return builder.finish();
}

const plugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = build(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.selectionSet || u.viewportChanged) this.decorations = build(u.view);
    }
  },
  { decorations: (v) => v.decorations },
);

export function focusDim(enabled: boolean): Extension {
  return enabled ? [plugin, EditorView.editorAttributes.of({ class: "cm-focus-mode" })] : [];
}
