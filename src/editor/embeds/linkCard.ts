import { WidgetType, type EditorView } from "@codemirror/view";
import { currentMessages } from "../../app/i18n";
import { openExternal } from "../../services/opener";
import { editorHooks } from "../hooks";

/** What the app knows of a link card (fetched by the Rust side). */
export type CardState = { status: "loading" } | { status: "ready"; card: CardData } | { status: "plain" };

export interface CardData {
  url: string;
  domain: string;
  title: string;
  description: string | null;
  /** URLs ready for <img> (cached files), or null. */
  image: string | null;
  icon: string | null;
}

const MENU_ICON = "M5 12h.01M12 12h.01M19 12h.01";

/**
 * Link preview card [DESIGN §2.10]: domain + favicon, title, two lines of
 * description, image on the right. Four rhythm units high [§6]. Click opens
 * the link in the browser; "…" offers Refresh and Plain link.
 */
export class LinkCardWidget extends WidgetType {
  constructor(
    readonly url: string,
    readonly state: CardState,
  ) {
    super();
  }

  eq(other: WidgetType): boolean {
    return other instanceof LinkCardWidget && other.url === this.url && JSON.stringify(other.state) === JSON.stringify(this.state);
  }

  toDOM(view: EditorView): HTMLElement {
    const t = currentMessages().cards;
    const wrap = document.createElement("div");
    wrap.className = "cm-embed cm-link-card";
    const card = document.createElement("div");
    card.className = "cm-link-card-body";
    card.setAttribute("role", "link");
    card.tabIndex = -1;
    card.title = this.url;
    if (this.state.status === "ready") {
      const { domain, title, description, image, icon } = this.state.card;
      const text = document.createElement("div");
      text.className = "cm-link-card-text";
      const site = document.createElement("div");
      site.className = "cm-link-card-domain";
      if (icon) {
        const fav = document.createElement("img");
        fav.src = icon;
        fav.alt = "";
        fav.addEventListener("error", () => fav.remove());
        site.append(fav);
      }
      site.append(domain);
      const h = document.createElement("div");
      h.className = "cm-link-card-title";
      h.textContent = title;
      text.append(site, h);
      if (description) {
        const d = document.createElement("div");
        d.className = "cm-link-card-desc";
        d.textContent = description;
        text.append(d);
      }
      card.append(text);
      if (image) {
        const img = document.createElement("img");
        img.className = "cm-link-card-thumb";
        img.src = image;
        img.alt = "";
        img.loading = "lazy";
        img.addEventListener("error", () => img.remove());
        card.append(img);
      }
    } else {
      // Loading: a still skeleton, no shimmer [§2.10].
      wrap.classList.add("is-loading");
      card.setAttribute("aria-label", t.loading);
      for (const cls of ["cm-link-card-bone short", "cm-link-card-bone", "cm-link-card-bone long"]) {
        const bone = document.createElement("span");
        bone.className = cls;
        card.append(bone);
      }
    }
    card.addEventListener("mousedown", (e) => e.preventDefault());
    card.addEventListener("click", () => void openExternal(this.url));
    wrap.append(card);

    const menu = document.createElement("button");
    menu.type = "button";
    menu.className = "cm-link-card-menu";
    menu.setAttribute("aria-label", t.menu);
    menu.title = t.menu;
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    svg.classList.add("cm-link-card-icon");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", MENU_ICON);
    svg.append(path);
    menu.append(svg);
    menu.addEventListener("mousedown", (e) => e.preventDefault());
    menu.addEventListener("click", (e) => {
      e.stopPropagation();
      const r = menu.getBoundingClientRect();
      const line = view.state.doc.lineAt(view.posAtDOM(wrap));
      editorHooks().openCardMenu(this.url, line.from, { x: r.right, y: r.bottom + 4 });
    });
    wrap.append(menu);
    return wrap;
  }

  get estimatedHeight(): number {
    return parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--rhythm")) * 4 || -1;
  }

  ignoreEvent(): boolean {
    return true;
  }
}
