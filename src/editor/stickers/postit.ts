import { Minimize2, StickyNote, Trash2, createElement } from "lucide";
import type { currentMessages } from "../../app/i18n";
import { POSTIT_COLORS } from "../../core/stickers";
import type { Placed } from "./state";

/**
 * DOM of a post-it [DESIGN §9]: handwritten text, optional tape, corner
 * shading, a floating bar on hover (colours, collapse, delete) and the
 * collapsed pill. The layer handles the interactions (`data-action`).
 */

type StickerMessages = ReturnType<typeof currentMessages>["stickers"];

const icon = (node: Parameters<typeof createElement>[0]) => {
  const svg = createElement(node);
  svg.setAttribute("aria-hidden", "true");
  return svg;
};

function button(className: string, action: string, label: string): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.className = className;
  b.dataset.action = action;
  b.setAttribute("aria-label", label);
  b.title = label;
  b.tabIndex = -1;
  return b;
}

/** Some post-its get a strip of tape, tilted one way or the other, decided by their id (stable). */
function tapeOf(id: string): number | null {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) | 0;
  const n = Math.abs(h) % 4;
  return n === 0 ? -4 : n === 1 ? 3 : null;
}

export function buildPostit(node: HTMLElement, p: Placed, t: StickerMessages): void {
  const tape = tapeOf(p.id);
  if (tape !== null) {
    const strip = document.createElement("span");
    strip.className = "cm-postit-tape";
    strip.style.setProperty("--postit-tape-rotation", `${tape}deg`);
    node.appendChild(strip);
  }
  const text = document.createElement("div");
  text.className = "cm-postit-text";
  text.spellcheck = false;
  node.appendChild(text);

  const pill = document.createElement("div");
  pill.className = "cm-postit-pill";
  pill.appendChild(icon(StickyNote));
  const words = document.createElement("span");
  words.className = "cm-postit-pill-text";
  pill.appendChild(words);
  node.appendChild(pill);

  const bar = document.createElement("div");
  bar.className = "cm-postit-bar";
  for (const color of POSTIT_COLORS) {
    const dot = button("cm-postit-dot", `color:${color}`, t.colors[color]);
    dot.dataset.color = color;
    bar.appendChild(dot);
  }
  const sep = document.createElement("span");
  sep.className = "cm-postit-sep";
  bar.appendChild(sep);
  const collapse = button("cm-postit-tool", "collapse", t.collapse);
  collapse.appendChild(icon(Minimize2));
  bar.appendChild(collapse);
  const remove = button("cm-postit-tool", "delete", t.remove);
  remove.appendChild(icon(Trash2));
  bar.appendChild(remove);
  node.appendChild(bar);
}

/** First line of a post-it, for its collapsed pill. */
export const firstLine = (text: string) => text.split("\n").find((l) => l.trim())?.trim() ?? "";

export function fillPostit(node: HTMLElement, p: Placed, t: StickerMessages, editing: boolean): void {
  const text = node.querySelector<HTMLElement>(".cm-postit-text")!;
  if (!editing && text.textContent !== (p.text ?? "")) text.textContent = p.text ?? "";
  node.querySelector(".cm-postit-pill-text")!.textContent = firstLine(p.text ?? "") || t.postit;
  node.dataset.color = p.color ?? "yellow";
  node.classList.toggle("cm-postit-collapsed", Boolean(p.collapsed));
  for (const dot of node.querySelectorAll<HTMLElement>(".cm-postit-dot")) dot.classList.toggle("cm-postit-dot-on", dot.dataset.color === node.dataset.color);
  node.setAttribute("role", "note");
  node.setAttribute("aria-label", `${t.postit} : ${p.text ?? ""}`);
}
