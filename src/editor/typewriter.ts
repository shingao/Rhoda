import { Compartment, type Extension, type Transaction } from "@codemirror/state";
import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { cssMs } from "../app/cssTokens";
import { parseEasing } from "../core/easing";

/**
 * Typewriter mode: the line being written stays vertically centred.
 *
 * Only writing and moving the cursor from line to line with the keyboard
 * recentre it, with a smooth scroll. A click, a selection made with the mouse
 * or a scroll never moves the text: the reader scrolls freely, and the next
 * keystroke brings the line back to the centre. Switching the mode on centres
 * the cursor (the last position in the note when the editor is not focused).
 */
export const typewriterCompartment = new Compartment();

/** Typing, deleting, pasting, undoing: anything that writes (a text dragged with the mouse does not count). */
function writes(tr: Transaction): boolean {
  return tr.docChanged && ["input", "delete", "undo", "redo"].some((e) => tr.isUserEvent(e));
}

/** Keys that move the cursor from line to line: up and down arrows, pages, start and end of the note. */
function isLineKey(e: KeyboardEvent): boolean {
  if (e.key === "ArrowUp" || e.key === "ArrowDown" || e.key === "PageUp" || e.key === "PageDown") return true;
  return (e.key === "Home" || e.key === "End") && (e.ctrlKey || e.metaKey);
}

/**
 * Screen box of the cursor's visual line, read from the DOM: scroll handlers
 * run while the editor updates, when its own layout queries are not allowed.
 */
function caretBox(view: EditorView, pos: number): { top: number; bottom: number } | null {
  const { node, offset } = view.domAtPos(pos);
  if (node.nodeType === Node.TEXT_NODE) {
    const range = document.createRange();
    range.setStart(node, offset);
    range.setEnd(node, offset);
    const rect = range.getClientRects()[0];
    if (rect && rect.height > 0) return rect;
  }
  const element = node instanceof Element ? node : node.parentElement;
  const line = element?.closest(".cm-line") ?? element;
  return line ? line.getBoundingClientRect() : null;
}

/** Vertical distance from the centre of the scroller to the middle of the cursor's line. */
function offsetFromCentre(view: EditorView, pos: number): number {
  const scroller = view.scrollDOM;
  const box = scroller.getBoundingClientRect();
  const centre = box.top + scroller.clientHeight / 2;
  const rect = caretBox(view, pos);
  return rect ? (rect.top + rect.bottom) / 2 - centre : 0;
}

/**
 * Smooth scroll of the editor to `top`, timed by the design tokens (--dur-slow,
 * --ease-out; 0 with reduced motion: a jump). Driven here rather than by the
 * browser's smooth scrolling, which Windows turns off with its animation
 * setting. The user takes over at once (wheel, click); a new target restarts
 * from where the scroll is.
 */
function glide(scroller: HTMLElement, top: number, animate: boolean): void {
  gliding?.stop();
  const duration = animate ? cssMs("--dur-slow") : 0;
  if (duration <= 0) {
    scroller.scrollTop = top;
    return;
  }
  const ease = parseEasing(getComputedStyle(document.documentElement).getPropertyValue("--ease-out"));
  const from = scroller.scrollTop;
  const start = performance.now();
  let frame = 0;
  const stop = () => {
    cancelAnimationFrame(frame);
    scroller.removeEventListener("wheel", stop);
    scroller.removeEventListener("pointerdown", stop);
    if (gliding?.stop === stop) gliding = null;
  };
  const step = (now: number) => {
    const t = Math.min(1, (now - start) / duration);
    scroller.scrollTop = from + (top - from) * ease(t);
    if (t < 1) frame = requestAnimationFrame(step);
    else stop();
  };
  scroller.addEventListener("wheel", stop, { passive: true });
  scroller.addEventListener("pointerdown", stop);
  frame = requestAnimationFrame(step);
  gliding = { stop };
}

let gliding: { stop: () => void } | null = null;

class Typewriter {
  /** How the next scroll request of the editor is answered: centred (smoothly or at once), or left to CodeMirror. */
  recentre: "smooth" | "instant" | null = "instant";

  constructor(readonly view: EditorView) {
    // Switched on: the cursor's line goes to the centre once the padding is in place.
    queueMicrotask(() => {
      if (!view.dom.isConnected || !view.plugin(typewriterPlugin)) return;
      view.dispatch({ effects: EditorView.scrollIntoView(view.state.selection.main.head, { y: "center" }) });
    });
  }

  /** A line key was pressed: the selection change it makes recentres. */
  private lineKey = false;

  keydown(e: KeyboardEvent): void {
    this.lineKey = isLineKey(e);
  }

  update(u: ViewUpdate): void {
    const keyMove = this.lineKey && u.transactions.some((tr) => tr.selection && tr.isUserEvent("select") && !tr.isUserEvent("select.pointer"));
    if (keyMove) this.lineKey = false;
    if (keyMove || u.transactions.some(writes)) this.recentre = "smooth";
    else if (this.recentre === "smooth" && u.transactions.some((tr) => tr.selection)) this.recentre = null;
  }

  /** Answers a scroll request: true when handled here. */
  scroll(pos: number): boolean {
    const mode = this.recentre;
    if (!mode) return false;
    this.recentre = null;
    const scroller = this.view.scrollDOM;
    const delta = offsetFromCentre(this.view, pos);
    if (Math.abs(delta) >= 1) glide(scroller, scroller.scrollTop + delta, mode === "smooth");
    return true;
  }

  /** Switched off: the padding above the text goes, the scroll follows, the cursor's line stays where it is on screen. */
  destroy(): void {
    const view = this.view;
    if (!view.dom.isConnected) return;
    const padding = () => parseFloat(getComputedStyle(view.contentDOM).paddingTop) || 0;
    const before = padding();
    view.requestMeasure({
      read: padding,
      write: (after) => {
        view.scrollDOM.scrollTop += after - before;
      },
    });
  }
}

const typewriterPlugin = ViewPlugin.fromClass(Typewriter, {
  eventObservers: {
    keydown(e) {
      this.keydown(e);
    },
  },
});

const centreOnRequest = EditorView.scrollHandler.of((view, range) => view.plugin(typewriterPlugin)?.scroll(range.head) ?? false);

export function typewriter(enabled: boolean): Extension {
  return enabled ? [typewriterPlugin, centreOnRequest, EditorView.editorAttributes.of({ class: "cm-typewriter" })] : [];
}
