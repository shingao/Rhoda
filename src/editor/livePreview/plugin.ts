import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import { ViewPlugin, type DecorationSet, type EditorView, type ViewUpdate } from "@codemirror/view";
import { cssPx } from "../../app/cssTokens";
import { openExternal } from "../../services/opener";
import { buildDecorations, revealedLines, type CodeMetrics } from "./build";

function readMetrics(): CodeMetrics {
  return {
    header: cssPx("--code-header-h"),
    line: cssPx("--code-fs") * cssPx("--code-lh"),
    padBottom: cssPx("--code-pad-bottom"),
    rhythm: cssPx("--rhythm"),
  };
}

function revealKey(lines: Set<number>): string {
  return [...lines].join(",");
}

/** URL under `pos` for Ctrl+click: [text](url), <url> or a bare URL. */
function linkUrlAt(state: EditorState, pos: number): string | null {
  for (let node: ReturnType<typeof syntaxTree>["topNode"] | null = syntaxTree(state).resolveInner(pos, 1); node; node = node.parent) {
    if (node.name === "URL") return state.sliceDoc(node.from, node.to);
    if (node.name === "Link" || node.name === "Autolink") {
      const url = node.getChild("URL");
      return url ? state.sliceDoc(url.from, url.to) : null;
    }
  }
  return null;
}

function normalizeUrl(url: string): string | null {
  if (/^(https?:|mailto:)/i.test(url)) return url;
  if (/^www\./i.test(url)) return `https://${url}`;
  return null;
}

/** Marks the code block header under the pointer so its copy button shows [DESIGN §2.8]. */
function codeHeadAt(view: EditorView, e: MouseEvent): HTMLElement | null {
  const pos = view.posAtCoords({ x: e.clientX, y: e.clientY }, false);
  for (let node: ReturnType<typeof syntaxTree>["topNode"] | null = syntaxTree(view.state).resolveInner(pos, 1); node; node = node.parent) {
    if (node.name === "FencedCode") {
      const { node: dom } = view.domAtPos(view.state.doc.lineAt(node.from).from);
      const el = dom instanceof HTMLElement ? dom : dom.parentElement;
      return el?.closest(".cm-code-head") ?? null;
    }
  }
  return null;
}

export const livePreview = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    private key: string;
    private readonly metrics = readMetrics();
    hoveredHead: HTMLElement | null = null;

    constructor(view: EditorView) {
      const lines = revealedLines(view.state, view.hasFocus);
      this.key = revealKey(lines);
      this.decorations = buildDecorations(view, lines, this.metrics);
    }

    update(u: ViewUpdate) {
      const lines = revealedLines(u.state, u.view.hasFocus);
      const key = revealKey(lines);
      // Rebuild only when something that affects the rendering changed.
      if (u.docChanged || u.viewportChanged || key !== this.key || syntaxTree(u.state) !== syntaxTree(u.startState)) {
        this.key = key;
        this.decorations = buildDecorations(u.view, lines, this.metrics);
      }
    }
  },
  {
    decorations: (v) => v.decorations,
    eventHandlers: {
      mousedown(e, view) {
        if (e.button !== 0 || !(e.ctrlKey || e.metaKey)) return false;
        const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
        const url = pos === null ? null : normalizeUrl(linkUrlAt(view.state, pos) ?? "");
        if (!url) return false;
        e.preventDefault();
        void openExternal(url);
        return true;
      },
      mousemove(e, view) {
        const head = codeHeadAt(view, e);
        if (head === this.hoveredHead) return;
        this.hoveredHead?.classList.remove("is-hovered");
        head?.classList.add("is-hovered");
        this.hoveredHead = head;
      },
      mouseleave() {
        this.hoveredHead?.classList.remove("is-hovered");
        this.hoveredHead = null;
      },
    },
  },
);
