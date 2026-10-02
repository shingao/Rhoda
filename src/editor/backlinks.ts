import { StateField, type EditorState, type Extension } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";
import { currentMessages } from "../app/i18n";
import { editorHooks, refreshPreview, type Backlink } from "./hooks";

/** "Mentioned in N notes" block after the last line of the note. */
class BacklinksWidget extends WidgetType {
  constructor(readonly links: Backlink[]) {
    super();
  }

  eq(other: WidgetType): boolean {
    return (
      other instanceof BacklinksWidget &&
      other.links.length === this.links.length &&
      other.links.every((l, i) => l.id === this.links[i]!.id && l.title === this.links[i]!.title && l.snippet === this.links[i]!.snippet)
    );
  }

  toDOM(): HTMLElement {
    const t = currentMessages();
    const wrap = document.createElement("section");
    wrap.className = "cm-backlinks";
    wrap.setAttribute("aria-label", t.links.backlinks(this.links.length));
    const title = document.createElement("h2");
    title.className = "cm-backlinks-title";
    title.textContent = t.links.backlinks(this.links.length);
    wrap.append(title);
    for (const link of this.links) {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "cm-backlink";
      const name = document.createElement("span");
      name.className = "cm-backlink-title";
      name.textContent = link.title || t.untitled;
      const snippet = document.createElement("span");
      snippet.className = "cm-backlink-snippet";
      snippet.textContent = link.snippet;
      item.append(name, snippet);
      item.addEventListener("click", () => editorHooks().openNote(link.id));
      wrap.append(item);
    }
    return wrap;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

function build(state: EditorState): DecorationSet {
  const links = editorHooks().backlinks();
  if (links.length === 0) return Decoration.none;
  return Decoration.set([Decoration.widget({ widget: new BacklinksWidget(links), block: true, side: 1 }).range(state.doc.length)]);
}

/** Block widgets must come from a state field, not a view plugin. */
export const backlinks: Extension = StateField.define<DecorationSet>({
  create: build,
  update(deco, tr) {
    if (tr.effects.some((e) => e.is(refreshPreview))) return build(tr.state);
    return tr.docChanged ? deco.map(tr.changes) : deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});
