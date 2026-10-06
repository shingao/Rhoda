import { ViewPlugin, runScopeHandlers, type EditorView, type PluginValue, type ViewUpdate } from "@codemirror/view";
import { currentMessages } from "../../app/i18n";
import { POSTIT_SIZE, STICKER_SIZE } from "../../core/stickers";
import { editorHooks } from "../hooks";
import { isHidden } from "../sections/visibility";
import { blockStartAt, stickerTransaction, stickersField, stickersOf, type Placed } from "./state";

/**
 * Stickers and post-its drawn above the text, in an absolute layer of the
 * scroller: it scrolls with the note, and only the stickers take the pointer,
 * so typing is never hindered [DESIGN §8]. Moving, rotating and resizing
 * update the DOM only; the result is one undoable change on release.
 */

/** Where the text column is, in the coordinates of the layer (the scrolled content). */
export interface Geometry {
  /** Viewport coordinates of the layer's origin. */
  originX: number;
  originY: number;
  docTop: number;
  colLeft: number;
  colWidth: number;
}

/** Reads the layout (call from a measure phase or in response to the user). */
export function geometryOf(view: EditorView): Geometry {
  const scroll = view.scrollDOM.getBoundingClientRect();
  const content = view.contentDOM.getBoundingClientRect();
  const style = getComputedStyle(view.contentDOM);
  const padLeft = parseFloat(style.paddingLeft) || 0;
  const padRight = parseFloat(style.paddingRight) || 0;
  const originX = scroll.left - view.scrollDOM.scrollLeft;
  const originY = scroll.top - view.scrollDOM.scrollTop;
  return {
    originX,
    originY,
    docTop: view.documentTop - originY,
    colLeft: content.left + padLeft - originX,
    colWidth: Math.max(1, content.width - padLeft - padRight),
  };
}

export interface Box {
  x: number;
  y: number;
}

type Gesture =
  | { kind: "move"; id: string; pointer: number; startX: number; startY: number; box: Box; moved: boolean }
  | { kind: "rotate"; id: string; pointer: number; cx: number; cy: number; a0: number; rotation: number; value: number }
  | { kind: "resize"; id: string; pointer: number; cx: number; cy: number; d0: number; size: number; value: number; box: Box };

/** Pixels before a press becomes a move (a click only selects). */
const DRAG_THRESHOLD = 3;
const ROTATION_STEP = 15;

const sizeRange = (p: Placed) => (p.kind === "postit" ? POSTIT_SIZE : STICKER_SIZE);
const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
const round1 = (n: number) => Math.round(n * 10) / 10;
/** Angle in (-180, 180]. */
const normalize = (deg: number) => {
  const d = ((((deg + 180) % 360) + 360) % 360) - 180;
  return d === -180 ? 180 : d;
};

const ARROWS: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

/** Placement animation for stickers added by the user (not when a note opens) [DESIGN §11]. */
export const PLACE_EVENT = "ursa.sticker.place";

/** A sticker whose top-left corner is at `box` (layer coordinates): anchored to the block under it. */
export function placedAt<T extends Placed>(view: EditorView, geometry: Geometry, p: T, box: Box): T {
  const docY = clamp(box.y - geometry.docTop, 0, Math.max(0, view.contentHeight - 1));
  const line = view.state.doc.lineAt(view.lineBlockAtHeight(docY).from).number;
  const pos = blockStartAt(view.state.doc, line);
  const anchorTop = view.lineBlockAt(pos).top;
  return { ...p, pos, dx: round1(((box.x - geometry.colLeft) / geometry.colWidth) * 100), dy: round1(box.y - geometry.docTop - anchorTop) };
}

class StickerLayer implements PluginValue {
  readonly dom: HTMLElement;
  private nodes = new Map<string, HTMLElement>();
  private items: readonly Placed[] = [];
  private geometry: Geometry = { originX: 0, originY: 0, docTop: 0, colLeft: 0, colWidth: 1 };
  /** Last drawn top-left corner of each sticker, in layer coordinates. */
  private boxes = new Map<string, Box>();
  private gesture: Gesture | null = null;
  private selected: string | null = null;

  constructor(readonly view: EditorView) {
    this.dom = document.createElement("div");
    this.dom.className = "cm-stickers";
    view.scrollDOM.appendChild(this.dom);
    this.dom.addEventListener("pointerdown", this.onPointerDown);
    this.dom.addEventListener("pointermove", this.onPointerMove);
    this.dom.addEventListener("pointerup", this.onPointerUp);
    this.dom.addEventListener("pointercancel", this.onPointerUp);
    this.dom.addEventListener("keydown", this.onKeyDown);
    this.dom.addEventListener("contextmenu", this.onContextMenu);
    this.dom.addEventListener("focusin", this.onFocus);
    this.dom.addEventListener("focusout", this.onBlur);
    this.sync(stickersOf(view.state), false);
    this.measure();
  }

  update(u: ViewUpdate): void {
    const items = u.state.field(stickersField);
    if (items !== this.items) {
      const placed = u.transactions.some((tr) => tr.isUserEvent(PLACE_EVENT));
      this.sync(items, placed);
    }
    if (items !== u.startState.field(stickersField) || u.docChanged || u.geometryChanged || u.heightChanged || u.viewportChanged) this.measure();
  }

  destroy(): void {
    this.dom.remove();
  }

  /** Creates, updates and removes sticker nodes to match the state. */
  private sync(items: readonly Placed[], animate: boolean): void {
    const t = currentMessages().stickers;
    const seen = new Set<string>();
    items.forEach((p, order) => {
      seen.add(p.id);
      let node = this.nodes.get(p.id);
      if (!node) {
        node = this.create(p);
        this.nodes.set(p.id, node);
        if (animate) {
          node.classList.add("cm-sticker-placed");
          node.addEventListener("animationend", () => node!.classList.remove("cm-sticker-placed"), { once: true });
        }
      }
      // DOM order is the stacking order (post-its above stickers).
      if (this.dom.children[order] !== node) this.dom.insertBefore(node, this.dom.children[order] ?? null);
      this.fill(node, p, t);
    });
    for (const [id, node] of this.nodes) {
      if (seen.has(id)) continue;
      node.remove();
      this.nodes.delete(id);
      this.boxes.delete(id);
      if (this.selected === id) this.selected = null;
    }
    this.items = items;
  }

  private create(p: Placed): HTMLElement {
    const node = document.createElement("div");
    node.className = p.kind === "postit" ? "cm-sticker cm-postit" : "cm-sticker";
    node.dataset.id = p.id;
    node.tabIndex = 0;
    if (p.kind === "sticker") {
      const img = document.createElement("img");
      img.className = "cm-sticker-img";
      img.draggable = false;
      img.alt = "";
      node.appendChild(img);
    } else {
      const text = document.createElement("div");
      text.className = "cm-postit-text";
      node.appendChild(text);
    }
    const frame = document.createElement("div");
    frame.className = "cm-sticker-frame";
    for (const corner of ["nw", "ne", "sw", "se"]) {
      const handle = document.createElement("div");
      handle.className = `cm-sticker-handle cm-sticker-${corner}`;
      handle.dataset.gesture = "resize";
      frame.appendChild(handle);
    }
    const rotate = document.createElement("div");
    rotate.className = "cm-sticker-rotate";
    rotate.dataset.gesture = "rotate";
    frame.appendChild(rotate);
    const badge = document.createElement("div");
    badge.className = "cm-sticker-angle";
    frame.appendChild(badge);
    node.appendChild(frame);
    return node;
  }

  /** Content, size and rotation of a node (its place is set by `measure`). */
  private fill(node: HTMLElement, p: Placed, t: ReturnType<typeof currentMessages>["stickers"]): void {
    node.style.width = `${p.size}px`;
    node.style.height = `${p.size}px`;
    node.style.setProperty("--sticker-rotation", `${p.rotation}deg`);
    if (p.kind === "sticker") {
      const img = node.querySelector<HTMLImageElement>(".cm-sticker-img")!;
      const url = p.asset ? editorHooks().stickerUrl(p.asset) : null;
      if (url && img.getAttribute("src") !== url) img.src = url;
      node.classList.toggle("cm-sticker-missing", !url);
      node.setAttribute("role", "img");
      node.setAttribute("aria-label", url ? t.sticker : t.missing);
    } else {
      const text = node.querySelector<HTMLElement>(".cm-postit-text")!;
      if (text.textContent !== (p.text ?? "")) text.textContent = p.text ?? "";
      node.dataset.color = p.color ?? "yellow";
      node.setAttribute("role", "note");
      node.setAttribute("aria-label", `${t.postit} : ${p.text ?? ""}`);
    }
  }

  /** Places every sticker next to its block (read, then write, in CodeMirror's measure cycle). */
  private measure(): void {
    this.view.requestMeasure({
      key: this,
      read: (view) => {
        const geometry = geometryOf(view);
        const tops = this.items.map((p) => (isHidden(view.state, p.pos) ? null : view.lineBlockAt(p.pos).top));
        return { geometry, tops };
      },
      write: ({ geometry, tops }) => {
        this.geometry = geometry;
        this.items.forEach((p, i) => {
          const node = this.nodes.get(p.id);
          if (!node) return;
          const top = tops[i];
          node.hidden = top === null || top === undefined;
          if (node.hidden) return;
          const box = { x: geometry.colLeft + (p.dx / 100) * geometry.colWidth, y: geometry.docTop + top! + p.dy };
          this.boxes.set(p.id, box);
          if (this.gesture?.id === p.id) return;
          node.style.left = `${box.x}px`;
          node.style.top = `${box.y}px`;
        });
      },
    });
  }

  private item(id: string): Placed | undefined {
    return this.items.find((p) => p.id === id);
  }

  private nodeOf(target: EventTarget | null): HTMLElement | null {
    return target instanceof Element ? target.closest<HTMLElement>(".cm-sticker") : null;
  }

  private movedTo(p: Placed, box: Box): Placed {
    return placedAt(this.view, this.geometry, p, box);
  }

  private commit(before: Placed, after: Placed): void {
    this.view.dispatch(stickerTransaction([{ before, after }]));
  }

  private readonly onPointerDown = (e: PointerEvent) => {
    const node = this.nodeOf(e.target);
    if (!node || e.button !== 0) return;
    const p = this.item(node.dataset.id!);
    const box = this.boxes.get(node.dataset.id!);
    if (!p || !box) return;
    e.preventDefault();
    node.focus({ preventScroll: true });
    const rect = node.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const kind = (e.target as HTMLElement).dataset.gesture;
    if (kind === "rotate") {
      this.gesture = { kind, id: p.id, pointer: e.pointerId, cx, cy, a0: Math.atan2(e.clientY - cy, e.clientX - cx), rotation: p.rotation, value: p.rotation };
      node.classList.add("cm-sticker-rotating");
    } else if (kind === "resize") {
      const d0 = Math.max(1, Math.hypot(e.clientX - cx, e.clientY - cy));
      this.gesture = { kind, id: p.id, pointer: e.pointerId, cx, cy, d0, size: p.size, value: p.size, box };
    } else {
      this.gesture = { kind: "move", id: p.id, pointer: e.pointerId, startX: e.clientX, startY: e.clientY, box, moved: false };
    }
    this.dom.setPointerCapture(e.pointerId);
  };

  private readonly onPointerMove = (e: PointerEvent) => {
    const g = this.gesture;
    if (!g || e.pointerId !== g.pointer) return;
    const node = this.nodes.get(g.id);
    const p = this.item(g.id);
    if (!node || !p) return;
    if (g.kind === "move") {
      const dx = e.clientX - g.startX;
      const dy = e.clientY - g.startY;
      if (!g.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      if (!g.moved) node.classList.add("cm-sticker-lifted");
      g.moved = true;
      node.style.left = `${g.box.x + dx}px`;
      node.style.top = `${g.box.y + dy}px`;
    } else if (g.kind === "rotate") {
      const a = Math.atan2(e.clientY - g.cy, e.clientX - g.cx);
      let deg = normalize(g.rotation + ((a - g.a0) * 180) / Math.PI);
      deg = e.shiftKey ? normalize(Math.round(deg / ROTATION_STEP) * ROTATION_STEP) : Math.round(deg);
      g.value = deg;
      node.style.setProperty("--sticker-rotation", `${deg}deg`);
      node.querySelector(".cm-sticker-angle")!.textContent = currentMessages().stickers.angle(deg);
    } else {
      const range = sizeRange(p);
      const size = Math.round(clamp((g.size * Math.hypot(e.clientX - g.cx, e.clientY - g.cy)) / g.d0, range.min, range.max));
      g.value = size;
      // The centre stays put.
      const shift = (g.size - size) / 2;
      node.style.width = `${size}px`;
      node.style.height = `${size}px`;
      node.style.left = `${g.box.x + shift}px`;
      node.style.top = `${g.box.y + shift}px`;
    }
  };

  private readonly onPointerUp = (e: PointerEvent) => {
    const g = this.gesture;
    if (!g || e.pointerId !== g.pointer) return;
    this.gesture = null;
    const node = this.nodes.get(g.id);
    node?.classList.remove("cm-sticker-lifted", "cm-sticker-rotating");
    const p = this.item(g.id);
    if (!p) return;
    if (g.kind === "move") {
      if (!g.moved) return;
      const box = { x: g.box.x + e.clientX - g.startX, y: g.box.y + e.clientY - g.startY };
      if (e.type === "pointercancel") this.measure();
      else this.commit(p, this.movedTo(p, box));
    } else if (g.kind === "rotate") {
      if (g.value !== p.rotation) this.commit(p, { ...p, rotation: g.value });
    } else if (g.value !== p.size) {
      const shift = (g.size - g.value) / 2;
      this.commit(p, { ...this.movedTo(p, { x: g.box.x + shift, y: g.box.y + shift }), size: g.value });
    }
  };

  private readonly onKeyDown = (e: KeyboardEvent) => {
    const node = this.nodeOf(e.target);
    const p = node && this.item(node.dataset.id!);
    if (!node || !p) return;
    const box = this.boxes.get(p.id);
    const arrow = ARROWS[e.key];
    let handled = true;
    if (arrow && box && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const step = e.shiftKey ? 10 : 1;
      this.commit(p, this.movedTo(p, { x: box.x + arrow[0] * step, y: box.y + arrow[1] * step }));
    } else if (e.key === "[" || e.key === "]") {
      this.commit(p, { ...p, rotation: normalize(Math.round(p.rotation) + (e.key === "]" ? 1 : -1)) });
    } else if (e.key === "Delete" || e.key === "Backspace") {
      this.view.dispatch(stickerTransaction([{ before: p, after: null }]));
      this.view.focus();
    } else if (e.key === "Escape") {
      this.view.focus();
    } else if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) {
      const r = node.getBoundingClientRect();
      editorHooks().openStickerMenu(p.id, { x: r.right, y: r.bottom });
    } else {
      // Ctrl+Z / Ctrl+Y and the rest of the editor's undo keys work from a selected sticker.
      handled = (e.ctrlKey || e.metaKey) && /^[zy]$/i.test(e.key) && runScopeHandlers(this.view, e, "editor");
    }
    if (handled) e.preventDefault();
  };

  private readonly onContextMenu = (e: MouseEvent) => {
    const node = this.nodeOf(e.target);
    if (!node) return;
    e.preventDefault();
    node.focus({ preventScroll: true });
    editorHooks().openStickerMenu(node.dataset.id!, { x: e.clientX, y: e.clientY });
  };

  private readonly onFocus = (e: FocusEvent) => {
    const node = this.nodeOf(e.target);
    if (!node) return;
    this.selected = node.dataset.id!;
    node.classList.add("cm-sticker-selected");
  };

  private readonly onBlur = (e: FocusEvent) => {
    const node = this.nodeOf(e.target);
    if (!node || node.contains(e.relatedTarget as Node | null)) return;
    if (this.selected === node.dataset.id) this.selected = null;
    node.classList.remove("cm-sticker-selected");
  };

  /** Focuses a sticker (after a menu, or to keep working on a duplicate). */
  focusSticker(id: string): void {
    this.nodes.get(id)?.focus({ preventScroll: true });
  }
}

export const stickerLayer = ViewPlugin.fromClass(StickerLayer);

/** Focuses a sticker of the open note, once drawn. */
export function focusSticker(view: EditorView, id: string): void {
  requestAnimationFrame(() => view.plugin(stickerLayer)?.focusSticker(id));
}
