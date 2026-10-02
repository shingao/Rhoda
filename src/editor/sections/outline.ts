import { ViewPlugin, type EditorView, type ViewUpdate } from "@codemirror/view";
import { cssPx } from "../../app/cssTokens";
import { editorHooks } from "../hooks";
import { foldField, foldedRanges } from "./fold";
import { headingsIn, sectionBody } from "./headings";

/** One heading of the Contents panel [DESIGN §2.15]. */
export interface OutlineItem {
  /** Start of the heading line (its identity for scrolling and folding). */
  from: number;
  level: number;
  text: string;
  foldable: boolean;
  folded: boolean;
  /** Inside a folded section: not listed. */
  hidden: boolean;
}

export interface OutlineData {
  items: OutlineItem[];
  /** Heading of the section at the top of the viewport (scroll-spy). */
  current: number | null;
}

/** Recomputing every heading is debounced while typing (5 000-line notes). */
const OUTLINE_DELAY = 150;

function outlineItems(view: EditorView): OutlineItem[] {
  const { state } = view;
  const folds = foldedRanges(state);
  return headingsIn(state).map((h) => ({
    from: h.from,
    level: h.level,
    text: h.text,
    foldable: sectionBody(state, h) !== null,
    folded: folds.some((f) => f.heading === h.from),
    hidden: folds.some((f) => h.from > f.from && h.from <= f.to),
  }));
}

/** Last visible heading at or above the top of the viewport. */
function currentHeading(view: EditorView, items: OutlineItem[]): number | null {
  const scrollerTop = view.scrollDOM.getBoundingClientRect().top;
  const pos = view.lineBlockAtHeight(scrollerTop - view.documentTop + cssPx("--rhythm") * 2).from;
  let current: number | null = null;
  for (const item of items) {
    if (item.from > pos) break;
    if (!item.hidden) current = item.from;
  }
  return current ?? items.find((i) => !i.hidden)?.from ?? null;
}

/** Reports headings and the current section to the app (Contents panel). */
export const outlineReporter = ViewPlugin.fromClass(
  class {
    private items: OutlineItem[] = [];
    private current: number | null = null;
    /** Headings recomputed but not reported yet. */
    private itemsChanged = false;
    private timer: ReturnType<typeof setTimeout> | undefined;
    private frame = 0;
    private readonly onScroll = () => {
      cancelAnimationFrame(this.frame);
      this.frame = requestAnimationFrame(() => this.report(false));
    };

    constructor(readonly view: EditorView) {
      view.scrollDOM.addEventListener("scroll", this.onScroll, { passive: true });
      this.report(true);
    }

    update(u: ViewUpdate) {
      if (u.startState.field(foldField) !== u.state.field(foldField)) this.report(true);
      else if (u.docChanged) {
        clearTimeout(this.timer);
        this.timer = setTimeout(() => this.report(true), OUTLINE_DELAY);
      } else if (u.geometryChanged) this.onScroll();
    }

    /** Headings are read now; the current section in the measure phase (layout reads are not allowed during updates). */
    report(recompute: boolean) {
      if (recompute) {
        this.items = outlineItems(this.view);
        this.itemsChanged = true;
      }
      this.view.requestMeasure({
        key: this,
        read: (view) => currentHeading(view, this.items),
        write: (current) => {
          if (!this.itemsChanged && current === this.current) return;
          this.current = current;
          this.itemsChanged = false;
          editorHooks().outlineChanged({ items: this.items, current });
        },
      });
    }

    destroy() {
      clearTimeout(this.timer);
      cancelAnimationFrame(this.frame);
      this.view.scrollDOM.removeEventListener("scroll", this.onScroll);
    }
  },
);
