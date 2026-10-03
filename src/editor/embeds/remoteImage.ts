import { WidgetType, type EditorView } from "@codemirror/view";
import { currentMessages } from "../../app/i18n";
import { editorHooks } from "../hooks";

/** Download of a remote image, as the app tracks it. */
export type RemoteImageState = { status: "idle" } | { status: "downloading" } | { status: "failed"; reason: string };

const IMAGE_ICON = ["M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z", "M9 9h.01", "m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"];

/**
 * An image whose source is on the web is never loaded by itself (the only
 * automatic network request of Ursa is the link preview): a card shows its
 * domain and offers to copy it into assets/, which rewrites the link.
 */
export class RemoteImageWidget extends WidgetType {
  constructor(
    readonly url: string,
    readonly state: RemoteImageState,
  ) {
    super();
  }

  eq(other: WidgetType): boolean {
    return other instanceof RemoteImageWidget && other.url === this.url && JSON.stringify(other.state) === JSON.stringify(this.state);
  }

  toDOM(view: EditorView): HTMLElement {
    const t = currentMessages().remote;
    const wrap = document.createElement("div");
    wrap.className = "cm-embed cm-remote-image";
    const card = document.createElement("div");
    card.className = "cm-remote-image-body";
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    svg.classList.add("cm-remote-image-icon");
    for (const d of IMAGE_ICON) {
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", d);
      svg.append(path);
    }
    const text = document.createElement("div");
    text.className = "cm-remote-image-text";
    const title = document.createElement("div");
    title.className = "cm-remote-image-title";
    title.textContent = t.title;
    const meta = document.createElement("div");
    meta.className = "cm-remote-image-meta";
    let domain = this.url;
    try {
      domain = new URL(this.url).hostname.replace(/^www\./, "");
    } catch {
      // keep the raw text
    }
    meta.textContent = this.state.status === "failed" ? t.failed(this.state.reason) : domain;
    meta.title = this.url;
    text.append(title, meta);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "cm-remote-image-download";
    button.textContent = this.state.status === "downloading" ? t.downloading : t.download;
    button.disabled = this.state.status === "downloading";
    button.addEventListener("mousedown", (e) => e.preventDefault());
    button.addEventListener("click", () => {
      const line = view.state.doc.lineAt(view.posAtDOM(wrap));
      editorHooks().downloadImage(this.url, line.from);
    });
    card.append(svg, text, button);
    wrap.append(card);
    return wrap;
  }

  ignoreEvent(): boolean {
    return true;
  }
}
