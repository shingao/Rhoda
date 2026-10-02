import { RangeSetBuilder } from "@codemirror/state";
import { Decoration, ViewPlugin, WidgetType, type DecorationSet, type EditorView, type ViewUpdate } from "@codemirror/view";
import { ChevronDown, createElement } from "lucide";
import { currentMessages } from "../../app/i18n";
import { foldField, isFolded, toggleFold } from "./fold";
import { headingsIn, sectionBody } from "./headings";

/** Chevron 22 px left of the column on foldable headings [DESIGN §2.13]. */
class FoldChevron extends WidgetType {
  constructor(
    readonly heading: number,
    readonly folded: boolean,
  ) {
    super();
  }

  eq(other: WidgetType): boolean {
    return other instanceof FoldChevron && other.heading === this.heading && other.folded === this.folded;
  }

  toDOM(view: EditorView): HTMLElement {
    // A zero-width box as tall as the first line, so the chevron centres on it.
    const anchor = document.createElement("span");
    anchor.className = "cm-fold-anchor";
    const button = document.createElement("span");
    button.className = `cm-fold-chevron${this.folded ? " is-folded" : ""}`;
    button.setAttribute("aria-hidden", "true");
    button.title = this.folded ? currentMessages().folding.unfold : currentMessages().folding.fold;
    const svg = createElement(ChevronDown);
    svg.setAttribute("aria-hidden", "true");
    button.append(svg);
    button.addEventListener("mousedown", (e) => {
      e.preventDefault();
      toggleFold(view, this.heading);
    });
    anchor.append(button);
    return anchor;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

function build(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const { state } = view;
  for (const { from, to } of view.visibleRanges) {
    for (const h of headingsIn(state, from, to)) {
      if (h.from < from || !sectionBody(state, h)) continue;
      builder.add(h.from, h.from, Decoration.widget({ widget: new FoldChevron(h.from, isFolded(state, h.from)), side: -1 }));
    }
  }
  return builder.finish();
}

export const foldChevrons = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = build(view);
    }

    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged || u.startState.field(foldField) !== u.state.field(foldField)) this.decorations = build(u.view);
    }
  },
  { decorations: (v) => v.decorations },
);
