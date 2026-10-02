import type { EditorView} from "@codemirror/view";
import { WidgetType } from "@codemirror/view";
import { Check, Copy, createElement } from "lucide";
import { cssMs } from "../../app/cssTokens";
import { currentMessages } from "../../app/i18n";

function icon(node: typeof Check): SVGElement {
  const svg = createElement(node);
  svg.setAttribute("aria-hidden", "true");
  return svg;
}

/** Rendered bullet of an unordered list item. */
export class BulletWidget extends WidgetType {
  eq(other: WidgetType): boolean {
    return other instanceof BulletWidget;
  }

  toDOM(): HTMLElement {
    const el = document.createElement("span");
    el.className = "cm-list-marker cm-list-bullet";
    el.setAttribute("aria-hidden", "true");
    return el;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

/** Rendered number of an ordered list item ("1."). */
export class NumberWidget extends WidgetType {
  constructor(readonly label: string) {
    super();
  }

  eq(other: WidgetType): boolean {
    return other instanceof NumberWidget && other.label === this.label;
  }

  toDOM(): HTMLElement {
    const el = document.createElement("span");
    el.className = "cm-list-marker cm-list-number";
    el.textContent = this.label;
    return el;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

/** Flips `[ ]` ↔ `[x]` on the task line that contains `pos`. */
export function toggleTaskAt(view: EditorView, pos: number): boolean {
  const line = view.state.doc.lineAt(pos);
  const m = /^(?:\s*>\s?)*\s*(?:[-*+]|\d+[.)])\s+\[([ xX])\]/.exec(line.text);
  if (!m) return false;
  const at = line.from + m[0].length - 2;
  view.dispatch({ changes: { from: at, to: at + 1, insert: m[1] === " " ? "x" : " " }, userEvent: "input.toggle" });
  return true;
}

/** Clickable todo circle [DESIGN §2.7]. Only the box toggles, never the text. */
export class CheckboxWidget extends WidgetType {
  constructor(readonly checked: boolean) {
    super();
  }

  eq(other: WidgetType): boolean {
    return other instanceof CheckboxWidget && other.checked === this.checked;
  }

  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement("span");
    wrap.className = "cm-list-marker cm-task-marker";
    const box = document.createElement("span");
    box.className = "cm-checkbox";
    box.setAttribute("role", "checkbox");
    box.setAttribute("aria-checked", String(this.checked));
    if (this.checked) box.append(icon(Check));
    box.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      toggleTaskAt(view, view.posAtDOM(wrap));
    });
    wrap.append(box);
    return wrap;
  }

  ignoreEvent(e: Event): boolean {
    // Clicks on the box are ours; elsewhere in the gutter the editor places the cursor.
    return e.target instanceof Element && e.target.closest(".cm-checkbox") !== null;
  }
}

/** Copy button in a code block header [DESIGN §2.8]: shows a check for 1.2 s once copied. */
export class CopyCodeWidget extends WidgetType {
  constructor(readonly code: string) {
    super();
  }

  eq(other: WidgetType): boolean {
    return other instanceof CopyCodeWidget && other.code === this.code;
  }

  toDOM(): HTMLElement {
    const t = currentMessages().editor;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "cm-code-copy";
    button.setAttribute("aria-label", t.copyCode);
    button.title = t.copyCode;
    button.append(icon(Copy));
    button.addEventListener("mousedown", (e) => e.preventDefault());
    button.addEventListener("click", () => {
      void navigator.clipboard.writeText(this.code).then(() => {
        button.replaceChildren(icon(Check));
        button.classList.add("is-copied");
        button.setAttribute("aria-label", t.copied);
        setTimeout(() => {
          button.replaceChildren(icon(Copy));
          button.classList.remove("is-copied");
          button.setAttribute("aria-label", t.copyCode);
        }, cssMs("--code-copied-ms"));
      });
    });
    return button;
  }

  ignoreEvent(): boolean {
    return true;
  }
}
