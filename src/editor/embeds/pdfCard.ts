import { WidgetType, type EditorView } from "@codemirror/view";
import { currentMessages } from "../../app/i18n";
import { editorHooks } from "../hooks";

/** What the app knows of a PDF attachment. */
export type PdfState =
  | { status: "loading"; name: string }
  | { status: "ready"; name: string; path: string; pages: number | null; size: string; thumb: string | null }
  | { status: "missing"; name: string };

const OPEN_ICON = ["M15 3h6v6", "M10 14 21 3", "M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"];

/**
 * PDF card [DESIGN §2.11]: first page with a "PDF" badge, name, "12 pages ·
 * 1,4 Mo", open button. Three rhythm units high [§6]. A click selects the
 * card; Ctrl+click (as for links), a double-click or the button opens the
 * file with the default app.
 */
export class PdfCardWidget extends WidgetType {
  constructor(
    readonly state: PdfState,
    readonly selected: boolean,
    readonly select: (view: EditorView, dom: HTMLElement) => void,
  ) {
    super();
  }

  eq(other: WidgetType): boolean {
    return other instanceof PdfCardWidget && other.selected === this.selected && JSON.stringify(other.state) === JSON.stringify(this.state);
  }

  toDOM(view: EditorView): HTMLElement {
    const t = currentMessages().cards;
    const s = this.state;
    const wrap = document.createElement("div");
    wrap.className = "cm-embed cm-pdf-card";
    wrap.classList.toggle("is-selected", this.selected);
    const card = document.createElement("div");
    card.className = "cm-pdf-card-body";
    const preview = document.createElement("div");
    preview.className = "cm-pdf-preview";
    if (s.status === "ready" && s.thumb) {
      const img = document.createElement("img");
      img.src = s.thumb;
      img.alt = "";
      preview.append(img);
    }
    const badge = document.createElement("span");
    badge.className = "cm-pdf-badge";
    badge.textContent = "PDF";
    preview.append(badge);
    const text = document.createElement("div");
    text.className = "cm-pdf-text";
    const name = document.createElement("div");
    name.className = "cm-pdf-name";
    name.textContent = s.name;
    const meta = document.createElement("div");
    meta.className = "cm-pdf-meta";
    meta.textContent = s.status === "ready" ? t.pdfMeta(s.pages, s.size) : s.status === "missing" ? t.pdfMissing(s.name) : "";
    text.append(name, meta);
    card.append(preview, text);
    if (s.status === "ready") {
      const open = document.createElement("button");
      open.type = "button";
      open.className = "cm-pdf-open";
      open.title = t.pdfOpen;
      open.setAttribute("aria-label", t.pdfOpen);
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("viewBox", "0 0 24 24");
      svg.setAttribute("aria-hidden", "true");
      svg.classList.add("cm-pdf-icon");
      for (const d of OPEN_ICON) {
        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        path.setAttribute("d", d);
        svg.append(path);
      }
      open.append(svg);
      card.append(open);
      open.addEventListener("mousedown", (e) => e.stopPropagation());
      open.addEventListener("click", () => editorHooks().openAttachment(s.path));
      card.addEventListener("dblclick", () => editorHooks().openAttachment(s.path));
    } else wrap.classList.add(s.status === "missing" ? "is-missing" : "is-loading");
    card.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      if ((e.ctrlKey || e.metaKey) && s.status === "ready") editorHooks().openAttachment(s.path);
      else this.select(view, wrap);
    });
    wrap.append(card);
    return wrap;
  }

  ignoreEvent(): boolean {
    return true;
  }
}
