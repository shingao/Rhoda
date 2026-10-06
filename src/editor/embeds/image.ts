import { WidgetType, type EditorView } from "@codemirror/view";
import { ScanText, createElement } from "lucide";
import { currentMessages } from "../../app/i18n";

export interface ImageSize {
  width: number;
  height: number;
}

/** What an image block can ask of the editor (implemented by the embeds field). */
export interface ImageActions {
  select(view: EditorView, dom: HTMLElement): void;
  /** New `{width=…}` (null = none: full natural width up to the column). One undoable change. */
  resize(view: EditorView, dom: HTMLElement, width: number | null): void;
  crop(view: EditorView, dom: HTMLElement): void;
  /** "Text": what OCR read in the image. */
  ocrText(view: EditorView, dom: HTMLElement, at: { x: number; y: number }): void;
}

/** A zone found by OCR (fractions of the image), the current one ringed. */
export interface ImageZone {
  x: number;
  y: number;
  w: number;
  h: number;
  current: boolean;
}

const zonesKey = (zones: readonly ImageZone[]) => zones.map((z) => `${z.x},${z.y},${z.w},${z.h},${z.current}`).join(";");

/** Natural sizes seen so far (by URL), so a note reopens without layout jumps. */
const knownSizes = new Map<string, ImageSize>();
/** Last measured column width, for height estimates of images not drawn yet. */
let lastColumn = 0;

export function rememberSize(url: string, size: ImageSize): void {
  knownSizes.set(url, size);
}

export function sizeOf(url: string): ImageSize | undefined {
  return knownSizes.get(url);
}

/**
 * Height of the block for an image shown `width` px wide: the image keeps its
 * proportions, and the block is rounded up to the next multiple of the rhythm
 * with the extra space split above and below [DESIGN §6].
 */
export function imageBlock(size: ImageSize, wanted: number | null, column: number, rhythm: number) {
  const width = Math.max(1, Math.min(wanted ?? size.width, column));
  const height = (width * size.height) / size.width;
  const block = Math.max(rhythm, Math.ceil(height / rhythm - 1e-6) * rhythm);
  return { width, height, block, padTop: (block - height) / 2 };
}

/** Zones of search occurrences on the image (OCR) [DESIGN §2.3]: `--match`, the current one ringed. */
function drawZones(wrap: HTMLElement, zones: readonly ImageZone[]): void {
  const frame = wrap.querySelector(".cm-image-frame");
  if (!frame) return;
  frame.querySelectorAll(".cm-image-zone").forEach((z) => z.remove());
  for (const z of zones) {
    const el = document.createElement("span");
    el.className = z.current ? "cm-image-zone is-current" : "cm-image-zone";
    el.style.left = `${z.x * 100}%`;
    el.style.top = `${z.y * 100}%`;
    el.style.width = `${z.w * 100}%`;
    el.style.height = `${z.h * 100}%`;
    frame.append(el);
  }
}

/** S / M / L of the bar [§2.12]: a third, half and three quarters of the column; Full = no width. */
export const PRESETS = [
  { id: "s", share: 1 / 3 },
  { id: "m", share: 1 / 2 },
  { id: "l", share: 3 / 4 },
] as const;

const SVG_NS = "http://www.w3.org/2000/svg";
/** `crop` icon (Lucide, ISC), drawn here because widgets are plain DOM. */
function cropIcon(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("cm-image-icon");
  for (const d of ["M6 2v14a2 2 0 0 0 2 2h14", "M18 22V8a2 2 0 0 0-2-2H2"]) {
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", d);
    svg.append(path);
  }
  return svg;
}

type ImageDom = HTMLElement & { ursa?: { observer: ResizeObserver; layout: () => void; widget: ImageWidget } };

/**
 * An image alone on its line [DESIGN §2.12], shown through <img> only (SVG
 * included: never injected into the page, so it cannot run scripts). A click
 * selects it: ring, handles, size badge and the S / M / L / Full bar.
 */
export class ImageWidget extends WidgetType {
  constructor(
    readonly url: string,
    readonly alt: string,
    readonly wanted: number | null,
    readonly label: string,
    readonly rhythm: number,
    readonly selected: boolean,
    readonly croppable: boolean,
    readonly actions: ImageActions,
    /** Search occurrences read by OCR in this image. */
    readonly zones: readonly ImageZone[] = [],
    /** Whether the size was known when built: once it is, the block is drawn again at its final height. */
    readonly sized = knownSizes.has(url),
  ) {
    super();
  }

  eq(other: WidgetType): boolean {
    return (
      other instanceof ImageWidget &&
      other.url === this.url &&
      other.alt === this.alt &&
      other.wanted === this.wanted &&
      other.rhythm === this.rhythm &&
      other.selected === this.selected &&
      other.sized === this.sized &&
      zonesKey(other.zones) === zonesKey(this.zones)
    );
  }

  /** Selection and width changes keep the same <img> (no reload, no flash). */
  updateDOM(dom: HTMLElement): boolean {
    const d = dom as ImageDom;
    if (!d.ursa || d.ursa.widget.url !== this.url || d.ursa.widget.alt !== this.alt) return false;
    d.ursa.widget = this;
    dom.classList.toggle("is-selected", this.selected);
    drawZones(dom, this.zones);
    d.ursa.layout();
    return true;
  }

  get estimatedHeight(): number {
    const size = knownSizes.get(this.url);
    if (!size || !lastColumn) return this.rhythm * 4;
    return imageBlock(size, this.wanted, lastColumn, this.rhythm).block;
  }

  toDOM(view: EditorView): HTMLElement {
    const t = currentMessages().images;
    const wrap = document.createElement("div") as ImageDom;
    wrap.className = "cm-embed cm-image";
    wrap.classList.toggle("is-selected", this.selected);
    const frame = document.createElement("div");
    frame.className = "cm-image-frame";
    const img = document.createElement("img");
    img.alt = this.alt;
    img.loading = "lazy";
    img.decoding = "async";
    img.draggable = false;
    // Served by the vault: protocol with CORS, so the crop dialog can read the pixels.
    img.crossOrigin = "anonymous";
    const badge = document.createElement("span");
    badge.className = "cm-image-badge";
    frame.append(img, badge);

    // Handles: 4 corners and 2 sides; all resize proportionally (the width is what is stored).
    for (const pos of ["nw", "ne", "sw", "se", "w", "e"]) {
      const h = document.createElement("span");
      h.className = `cm-image-handle cm-image-handle-${pos}`;
      h.dataset.handle = pos;
      frame.append(h);
    }

    const bar = document.createElement("div");
    bar.className = "cm-image-bar";
    bar.setAttribute("role", "toolbar");
    bar.setAttribute("aria-label", t.toolbar);
    const presetButtons: Array<[HTMLButtonElement, () => number | null]> = [];
    const column = () => wrap.clientWidth || lastColumn;
    for (const p of PRESETS) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = t.sizes[p.id];
      b.title = t.sizesHint[p.id];
      presetButtons.push([b, () => Math.round(column() * p.share)]);
    }
    const full = document.createElement("button");
    full.type = "button";
    full.textContent = t.sizes.full;
    full.title = t.sizesHint.full;
    presetButtons.push([full, () => null]);
    for (const [b, width] of presetButtons) {
      b.addEventListener("mousedown", (e) => e.preventDefault());
      b.addEventListener("click", () => this.current(wrap).actions.resize(view, wrap, width()));
      bar.append(b);
    }
    if (this.croppable) {
      const crop = document.createElement("button");
      crop.type = "button";
      crop.className = "cm-image-crop";
      crop.title = t.crop;
      crop.setAttribute("aria-label", t.crop);
      crop.append(cropIcon());
      crop.addEventListener("mousedown", (e) => e.preventDefault());
      crop.addEventListener("click", () => this.current(wrap).actions.crop(view, wrap));
      bar.append(crop);
    }
    const text = document.createElement("button");
    text.type = "button";
    text.className = "cm-image-text";
    text.title = t.ocrText;
    text.setAttribute("aria-label", t.ocrText);
    const scan = createElement(ScanText);
    scan.classList.add("cm-image-icon");
    text.append(scan);
    text.addEventListener("mousedown", (e) => e.preventDefault());
    text.addEventListener("click", () => {
      const r = text.getBoundingClientRect();
      this.current(wrap).actions.ocrText(view, wrap, { x: r.left, y: r.bottom + 4 });
    });
    bar.append(text);
    wrap.append(bar, frame);
    drawZones(wrap, this.zones);

    let dragWidth: number | null = null;
    const layout = () => {
      const w = this.current(wrap);
      const size = knownSizes.get(w.url);
      const col = wrap.clientWidth;
      if (!col) return;
      lastColumn = col;
      if (!size) {
        wrap.style.height = `${w.rhythm * 4}px`;
        return;
      }
      const b = imageBlock(size, dragWidth ?? w.wanted, col, w.rhythm);
      img.style.width = `${b.width}px`;
      img.style.height = `${b.height}px`;
      frame.style.width = `${b.width}px`;
      frame.style.marginTop = `${b.padTop}px`;
      wrap.style.height = `${b.block}px`;
      badge.textContent = t.badge(Math.round(b.width), Math.round(b.height), b.block / w.rhythm);
      const wanted = dragWidth ?? w.wanted;
      const active = (presetWidth: number | null) =>
        presetWidth === null ? wanted === null || wanted >= Math.min(size.width, col) : wanted !== null && Math.abs(presetWidth - b.width) <= 2;
      for (const [button, width] of presetButtons) button.setAttribute("aria-pressed", String(active(width())));
    };

    img.addEventListener("load", () => {
      if (!img.naturalWidth) return;
      const url = this.current(wrap).url;
      const before = knownSizes.get(url);
      knownSizes.set(url, { width: img.naturalWidth, height: img.naturalHeight });
      wrap.classList.add("is-loaded");
      if (!before || before.width !== img.naturalWidth || before.height !== img.naturalHeight) {
        layout();
        view.requestMeasure();
      }
    });
    img.addEventListener("error", () => {
      wrap.classList.add("is-missing");
      wrap.style.height = `${this.rhythm}px`;
      wrap.replaceChildren(t.missing(this.label));
      view.requestMeasure();
    });

    // Click selects; dragging a handle resizes, committed once on release.
    frame.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const handle = (e.target as HTMLElement).dataset.handle;
      const w = this.current(wrap);
      if (!handle || !w.selected) {
        w.actions.select(view, wrap);
        return;
      }
      const size = knownSizes.get(w.url);
      if (!size) return;
      const startX = e.clientX;
      const start = imageBlock(size, w.wanted, wrap.clientWidth, w.rhythm).width;
      const dir = handle.includes("w") ? -1 : 1;
      const min = parseFloat(getComputedStyle(wrap).getPropertyValue("--image-min-w")) || 1;
      wrap.classList.add("is-resizing");
      const move = (ev: MouseEvent) => {
        dragWidth = Math.round(Math.min(wrap.clientWidth, Math.max(min, start + dir * (ev.clientX - startX))));
        layout();
        view.requestMeasure();
      };
      const up = () => {
        window.removeEventListener("mousemove", move);
        window.removeEventListener("mouseup", up);
        wrap.classList.remove("is-resizing");
        const width = dragWidth;
        dragWidth = null;
        if (width !== null && width !== Math.round(start)) this.current(wrap).actions.resize(view, wrap, width);
        else layout();
      };
      window.addEventListener("mousemove", move);
      window.addEventListener("mouseup", up);
    });

    img.src = this.url;
    // Column width changes (window, settings, docked outline) re-run the layout.
    let lastWidth = -1;
    const observer = new ResizeObserver(() => {
      // Only width changes matter (the height is ours): no resize loop.
      if (wrap.clientWidth === lastWidth) return;
      lastWidth = wrap.clientWidth;
      // Resizing inside the callback would loop: next frame.
      requestAnimationFrame(() => {
        const before = wrap.style.height;
        layout();
        if (wrap.style.height !== before) view.requestMeasure();
      });
    });
    observer.observe(wrap);
    wrap.ursa = { observer, layout, widget: this };
    layout();
    return wrap;
  }

  /** The widget currently attached to `dom` (updateDOM swaps it). */
  private current(dom: HTMLElement): ImageWidget {
    return (dom as ImageDom).ursa?.widget ?? this;
  }

  destroy(dom: HTMLElement): void {
    (dom as ImageDom).ursa?.observer.disconnect();
  }

  /** Clicks belong to the image (selection, handles, bar), not to the text cursor. */
  ignoreEvent(): boolean {
    return true;
  }
}
