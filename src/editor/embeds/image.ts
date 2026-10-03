import { WidgetType, type EditorView } from "@codemirror/view";
import { currentMessages } from "../../app/i18n";

export interface ImageSize {
  width: number;
  height: number;
}

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

/**
 * An image alone on its line [DESIGN §2.12], shown through <img> only (SVG
 * included: never injected into the page, so it cannot run scripts).
 */
export class ImageWidget extends WidgetType {
  constructor(
    readonly url: string,
    readonly alt: string,
    readonly wanted: number | null,
    readonly label: string,
    readonly rhythm: number,
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
      other.sized === this.sized
    );
  }

  get estimatedHeight(): number {
    const size = knownSizes.get(this.url);
    if (!size || !lastColumn) return this.rhythm * 4;
    return imageBlock(size, this.wanted, lastColumn, this.rhythm).block;
  }

  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "cm-embed cm-image";
    const img = document.createElement("img");
    img.alt = this.alt;
    img.loading = "lazy";
    img.decoding = "async";
    img.draggable = false;
    const layout = () => {
      const size = knownSizes.get(this.url);
      const column = wrap.clientWidth;
      if (!column) return;
      lastColumn = column;
      if (!size) {
        wrap.style.height = `${this.rhythm * 4}px`;
        return;
      }
      const b = imageBlock(size, this.wanted, column, this.rhythm);
      img.style.width = `${b.width}px`;
      img.style.height = `${b.height}px`;
      img.style.marginTop = `${b.padTop}px`;
      wrap.style.height = `${b.block}px`;
    };
    img.addEventListener("load", () => {
      if (!img.naturalWidth) return;
      const before = knownSizes.get(this.url);
      knownSizes.set(this.url, { width: img.naturalWidth, height: img.naturalHeight });
      wrap.classList.add("is-loaded");
      if (!before || before.width !== img.naturalWidth || before.height !== img.naturalHeight) {
        layout();
        view.requestMeasure();
      }
    });
    img.addEventListener("error", () => {
      wrap.classList.add("is-missing");
      wrap.style.height = `${this.rhythm}px`;
      wrap.textContent = currentMessages().images.missing(this.label);
      view.requestMeasure();
    });
    img.src = this.url;
    wrap.append(img);
    // Column width changes (window, settings, docked outline) re-run the layout.
    const observer = new ResizeObserver(() => {
      const before = wrap.style.height;
      layout();
      if (wrap.style.height !== before) view.requestMeasure();
    });
    observer.observe(wrap);
    (wrap as HTMLElement & { ursaObserver?: ResizeObserver }).ursaObserver = observer;
    layout();
    return wrap;
  }

  destroy(dom: HTMLElement): void {
    (dom as HTMLElement & { ursaObserver?: ResizeObserver }).ursaObserver?.disconnect();
  }

  /** Clicks belong to the image (selection, handles), not to the text cursor. */
  ignoreEvent(): boolean {
    return true;
  }
}
