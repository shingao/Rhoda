import { ViewPlugin, runScopeHandlers, type EditorView, type PluginValue, type ViewUpdate } from "@codemirror/view";
import { currentMessages } from "../../app/i18n";
import { POSTIT_SIZE, STICKER_SIZE } from "../../core/stickers";
import { editorHooks } from "../hooks";
import { isHidden } from "../sections/visibility";
import { buildPostit, fillPostit } from "./postit";
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
  /** Post-it whose text is being edited. */
  private editing: string | null = null;
  /** The last press moved a sticker (its click is not a click). */
  private wasDragged = false;
  private destroyed = false;

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
    this.dom.addEventListener("click", this.onClick);
    this.dom.addEventListener("dblclick", this.onDoubleClick);
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
    // Any late focus event must not reach the next note's state.
    this.editing = null;
    this.destroyed = true;
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
      // The focused sticker went away (deleted, undone): keyboard focus goes back to the text, so Ctrl+Z keeps working.
      const hadFocus = node.contains(document.activeElement);
      node.remove();
      if (hadFocus) this.view.focus();
      this.nodes.delete(id);
      this.boxes.delete(id);
      if (this.selected === id) this.selected = null;
      if (this.editing === id) this.editing = null;
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
      buildPostit(node, p, currentMessages().stickers);
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
      fillPostit(node, p, t, this.editing === p.id);
      // A collapsed post-it is a pill sized by its content.
      if (p.collapsed) {
        node.style.width = "";
        node.style.height = "";
      }
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
    this.wasDragged = false;
    const target = e.target as Element;
    // Post-it bar buttons are plain clicks; the text being edited takes the caret.
    if (target.closest("[data-action]")) return;
    if (this.editing === p.id && target.closest(".cm-postit-text")) return;
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
    // Captured by the sticker itself, so the click that follows still targets it (pill, double-click).
    node.setPointerCapture(e.pointerId);
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
    this.wasDragged = g.kind === "move" && g.moved;
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
    if (this.editing === p.id) {
      // Typing in a post-it: Escape or Ctrl+Enter ends the edit, everything else is text.
      if (e.key === "Escape" || (e.key === "Enter" && (e.ctrlKey || e.metaKey))) {
        e.preventDefault();
        this.finishEdit(true);
      }
      return;
    }
    const box = this.boxes.get(p.id);
    const arrow = ARROWS[e.key];
    let handled = true;
    if (e.key === "Enter" && p.kind === "postit" && (e.target as Element) === node) {
      this.edit(p.id);
    } else if (arrow && box && !e.ctrlKey && !e.metaKey && !e.altKey) {
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
    if (node && this.editing === node.dataset.id && (e.target as Element).classList.contains("cm-postit-text")) this.finishEdit(false);
    if (!node || node.contains(e.relatedTarget as Node | null)) return;
    if (this.selected === node.dataset.id) this.selected = null;
    node.classList.remove("cm-sticker-selected");
  };

  /** Post-it bar (colour, collapse, delete) and the collapsed pill (click = expand). */
  private readonly onClick = (e: MouseEvent) => {
    const node = this.nodeOf(e.target);
    const p = node && this.item(node.dataset.id!);
    if (!node || !p) return;
    const action = (e.target as Element).closest<HTMLElement>("[data-action]")?.dataset.action;
    if (action === "delete") {
      this.view.dispatch(stickerTransaction([{ before: p, after: null }]));
      this.view.focus();
    } else if (action === "collapse") {
      this.commit(p, { ...p, collapsed: true });
      this.focusSticker(p.id);
    } else if (action?.startsWith("color:")) {
      const color = action.slice(6) as Placed["color"];
      if (color !== p.color) this.commit(p, { ...p, color });
      this.focusSticker(p.id);
    } else if (p.collapsed && !this.wasDragged) {
      this.commit(p, { ...p, collapsed: false });
      this.focusSticker(p.id);
    }
  };

  private readonly onDoubleClick = (e: MouseEvent) => {
    const node = this.nodeOf(e.target);
    const p = node && this.item(node.dataset.id!);
    if (p?.kind === "postit" && !p.collapsed && !(e.target as Element).closest("[data-action]")) this.edit(p.id);
  };

  /** Edits the text of a post-it in place (double-click, Enter, or a new post-it). */
  edit(id: string): void {
    const node = this.nodes.get(id);
    const p = this.item(id);
    if (!node || p?.kind !== "postit") return;
    if (p.collapsed) this.commit(p, { ...p, collapsed: false });
    const text = node.querySelector<HTMLElement>(".cm-postit-text")!;
    this.editing = id;
    node.classList.add("cm-postit-editing");
    text.contentEditable = "plaintext-only";
    text.focus({ preventScroll: true });
    const range = document.createRange();
    range.selectNodeContents(text);
    range.collapse(false);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }

  /** Ends the edit; the new text is one undo step in the note. */
  finishEdit(refocus: boolean): void {
    const id = this.editing;
    if (!id || this.destroyed) return;
    this.editing = null;
    const node = this.nodes.get(id);
    const text = node?.querySelector<HTMLElement>(".cm-postit-text");
    if (!node || !text) return;
    text.contentEditable = "false";
    node.classList.remove("cm-postit-editing");
    const value = (text.innerText ?? "").replace(/\n$/, "");
    const p = this.item(id);
    if (p && value !== (p.text ?? "")) this.commit(p, { ...p, text: value });
    if (refocus) this.focusSticker(id);
  }

  /** Focuses a sticker (after a menu, or to keep working on a duplicate). */
  focusSticker(id: string): void {
    this.nodes.get(id)?.focus({ preventScroll: true });
  }
}

export const stickerLayer = ViewPlugin.fromClass(StickerLayer);

/** Saves a post-it being edited into the open note (before another note is shown). */
export function commitStickerEdit(view: EditorView): void {
  view.plugin(stickerLayer)?.finishEdit(false);
}

/** Starts editing a post-it of the open note, once drawn. */
export function editPostit(view: EditorView, id: string): void {
  requestAnimationFrame(() => view.plugin(stickerLayer)?.edit(id));
}

/** Focuses a sticker of the open note, once drawn. */
export function focusSticker(view: EditorView, id: string): void {
  requestAnimationFrame(() => view.plugin(stickerLayer)?.focusSticker(id));
}
