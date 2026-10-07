import { useEffect, useLayoutEffect, useMemo, useState, type RefObject } from "react";

/** Extra height drawn above and below the visible part, in px. */
const OVERSCAN = 800;

/**
 * Heights, rendered elements and pending focus of a windowed list. Plain
 * object, outside React's state: measuring never re-renders by itself.
 */
class WindowModel {
  private heights = new Map<string, number>();
  private elements = new Map<string, HTMLElement>();
  /** One ref callback per item, kept while it is drawn: React calls a new one with null at every render. */
  private refs = new Map<string, (el: HTMLElement | null) => void>();
  private ids: readonly string[] = [];
  private offsets = new Float64Array(1);
  private gap = 0;
  private pending: string | null = null;
  private scroller: HTMLElement | null = null;
  private list: HTMLElement | null = null;
  /** The focus was moved to the list because its card left the window (its focus event is ours). */
  private parked = false;
  private frame = 0;
  /** Item being revealed: heights measured once it is drawn can move it, so it is revealed again (a few times). */
  private revealing: { index: number; tries: number } | null = null;
  private sizes: ResizeObserver | null = null;

  constructor(private readonly changed: () => void) {}

  /** Starts measuring (again: React may unmount and mount the same list in development). */
  connect(): void {
    if (this.sizes) return;
    const changed = this.changed;
    this.sizes = new ResizeObserver((entries) => {
      let moved = false;
      for (const entry of entries) {
        const el = entry.target as HTMLElement;
        const id = el.dataset.windowId;
        // Exact height (offsetHeight is rounded: errors would add up over the cards above).
        const h = entry.borderBoxSize[0]?.blockSize ?? el.getBoundingClientRect().height;
        if (id && h > 0 && this.heights.get(id) !== h) {
          this.heights.set(id, h);
          moved = true;
        }
      }
      if (moved) this.measured();
      if (moved && !this.frame) this.frame = requestAnimationFrame(() => ((this.frame = 0), changed()));
    });
    for (const el of this.elements.values()) this.sizes.observe(el);
  }

  setScroller(el: HTMLElement | null): void {
    this.scroller = el;
  }

  setList(el: HTMLElement | null): void {
    this.list = el;
  }

  /** Whether the list's focus event comes from parking (answered once). */
  takeParked(): boolean {
    const parked = this.parked;
    this.parked = false;
    return parked;
  }

  /** Top of every item (and the end), measured heights or the average of those known. */
  layout(ids: readonly string[], gap: number, estimate: number): Float64Array {
    const known = [...this.heights.values()];
    const guess = known.length ? known.reduce((a, b) => a + b, 0) / known.length : estimate;
    const out = new Float64Array(ids.length + 1);
    for (let i = 0; i < ids.length; i++) out[i + 1] = out[i]! + (this.heights.get(ids[i]!) ?? guess) + gap;
    this.ids = ids;
    this.offsets = out;
    this.gap = gap;
    return out;
  }

  /** Stable ref callback of an item. */
  refFor(id: string): (el: HTMLElement | null) => void {
    let ref = this.refs.get(id);
    if (!ref) this.refs.set(id, (ref = (el) => this.attach(id, el)));
    return ref;
  }

  /** Ref of a rendered item (null: it leaves the window). */
  private attach(id: string, el: HTMLElement | null): void {
    const old = this.elements.get(id);
    if (old && old !== el) this.sizes?.unobserve(old);
    if (!el) {
      // The focused card scrolls out of the window: the focus stays in the list, where the keys still work.
      // Checked once the commit is over (a ref can be detached and attached again without leaving).
      if (old?.contains(document.activeElement)) {
        queueMicrotask(() => {
          const list = this.list;
          if (old.isConnected || !list || (document.activeElement && document.activeElement !== document.body)) return;
          this.parked = true;
          list.focus({ preventScroll: true });
        });
      }
      this.elements.delete(id);
      this.refs.delete(id);
      return;
    }
    el.dataset.windowId = id;
    this.elements.set(id, el);
    this.sizes?.observe(el);
    if (this.pending === id) {
      this.pending = null;
      el.focus();
    }
  }

  element(id: string): HTMLElement | undefined {
    return this.elements.get(id);
  }

  /** Focuses an item, drawing it first if it is outside the window. */
  focus(id: string): void {
    const el = this.elements.get(id);
    if (el) el.focus();
    else {
      this.pending = id;
      this.reveal(this.ids.indexOf(id));
    }
  }

  /** Scrolls the least needed for an item to be fully visible. */
  reveal(index: number): void {
    this.revealing = { index, tries: 10 };
    this.scrollTo(index);
  }

  /** After a layout with new heights: the item being revealed is put back in view. */
  afterLayout(): void {
    const r = this.revealing;
    if (!r) return;
    if (--r.tries <= 0) this.revealing = null;
    this.scrollTo(r.index);
  }

  /** Heights of drawn items changed: the item being revealed may have moved. */
  private measured(): void {
    if (this.revealing) this.scrollTo(this.revealing.index);
  }

  /** The user scrolls: nothing to keep in view any more. */
  stopRevealing(): void {
    this.revealing = null;
  }

  private scrollTo(index: number): void {
    const el = this.scroller;
    if (!el || index < 0 || index >= this.ids.length) return;
    // Drawn: the browser knows exactly where it is.
    const item = this.elements.get(this.ids[index]!);
    if (item) {
      item.scrollIntoView({ block: "nearest" });
      return;
    }
    const top = this.offsets[index]!;
    const bottom = this.offsets[index + 1]! - this.gap;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (bottom > el.scrollTop + el.clientHeight) el.scrollTop = bottom - el.clientHeight;
  }

  disconnect(): void {
    this.sizes?.disconnect();
    this.sizes = null;
    cancelAnimationFrame(this.frame);
    this.frame = 0;
  }
}

export interface ListWindow {
  /** First and last (excluded) items to render. */
  start: number;
  end: number;
  /** Room left for the items not rendered, above and below. */
  before: number;
  after: number;
  /** Ref callback of a rendered item (stable per item): its height is measured and remembered. */
  refFor: (id: string) => (el: HTMLElement | null) => void;
  /** Ref of the list element (keeps the focus when the focused item leaves the window). */
  attachList: (el: HTMLElement | null) => void;
  /** Whether the list just took the focus back from an item leaving the window (answered once per focus). */
  parked: () => boolean;
  /** The rendered element of an item, if it is in the window. */
  element: (id: string) => HTMLElement | undefined;
  /** Focuses an item (scrolled to and drawn first if needed). */
  focus: (id: string) => void;
  /** Scrolls the least needed for item `index` to be fully visible. */
  reveal: (index: number) => void;
}

/**
 * Only the items near the visible part of a scroller are rendered (decision
 * P10-18): the DOM stays the same size whether the list has 50 notes or 5 000.
 * Heights are measured as items are drawn; unknown ones are estimated from the
 * measured average (`estimate` until the first measure).
 */
export function useWindow(scroller: RefObject<HTMLElement | null>, ids: readonly string[], gap: number, estimate: number): ListWindow {
  const [version, setVersion] = useState(0);
  const [model] = useState(() => new WindowModel(() => setVersion((v) => v + 1)));
  const [viewport, setViewport] = useState({ top: 0, height: 0 });

  useEffect(() => {
    const el = scroller.current;
    model.setScroller(el);
    if (!el) return;
    const update = () => setViewport({ top: el.scrollTop, height: el.clientHeight });
    update();
    el.addEventListener("scroll", update, { passive: true });
    // A wheel or a drag of the scrollbar: the user takes over.
    const stop = () => model.stopRevealing();
    el.addEventListener("wheel", stop, { passive: true });
    el.addEventListener("pointerdown", stop);
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      el.removeEventListener("wheel", stop);
      el.removeEventListener("pointerdown", stop);
      observer.disconnect();
    };
  }, [scroller, model]);
  useEffect(() => {
    model.connect();
    return () => model.disconnect();
  }, [model]);

  // `version`: heights measured since (the model holds them).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const offsets = useMemo(() => model.layout(ids, gap, estimate), [model, ids, gap, estimate, version]);
  useLayoutEffect(() => model.afterLayout(), [model, offsets]);

  /** First index whose bottom is below `y`. */
  const indexAt = (y: number) => {
    let lo = 0;
    let hi = ids.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (offsets[mid + 1]! - gap <= y) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  const start = indexAt(viewport.top - OVERSCAN);
  const end = Math.min(ids.length, indexAt(viewport.top + viewport.height + OVERSCAN) + 1);
  const total = ids.length ? offsets[ids.length]! - gap : 0;
  const drawnBottom = end > start ? offsets[end]! - gap : offsets[start]!;

  return {
    start,
    end,
    before: offsets[start]!,
    after: Math.max(0, total - drawnBottom),
    refFor: (id) => model.refFor(id),
    attachList: (el) => model.setList(el),
    parked: () => model.takeParked(),
    element: (id) => model.element(id),
    focus: (id) => model.focus(id),
    reveal: (index) => model.reveal(index),
  };
}
