import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import { ViewPlugin, type DecorationSet, type EditorView, type ViewUpdate } from "@codemirror/view";
import { cssPx } from "../../app/cssTokens";
import { tagKey } from "../../core/markdown/extract";
import { isInHeading } from "../../core/markdown/syntax";
import { openExternal } from "../../services/opener";
import { editorHooks, refreshPreview } from "../hooks";
import { buildDecorations, revealedLines, type CodeLayout, type CodeMetrics } from "./build";

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

/** Title targeted by the wiki link under `pos`, if any. */
function wikiTargetAt(state: EditorState, pos: number): string | null {
  for (let node: ReturnType<typeof syntaxTree>["topNode"] | null = syntaxTree(state).resolveInner(pos, 1); node; node = node.parent) {
    if (node.name === "WikiLink") {
      const target = node.getChild("WikiLinkTarget");
      return target ? state.sliceDoc(target.from, target.to).split("#")[0]!.trim() : null;
    }
  }
  return null;
}

/** Tag name under `pos` (outside headings), if any. */
function tagAt(state: EditorState, pos: number): string | null {
  for (let node: ReturnType<typeof syntaxTree>["topNode"] | null = syntaxTree(state).resolveInner(pos, 1); node; node = node.parent) {
    if (node.name === "Tag") {
      if (isInHeading(node)) return null;
      return state.sliceDoc(node.from, node.to).replace(/^#|#$/g, "");
    }
  }
  return null;
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
    private readonly code: CodeLayout = { measured: new Map(), blocks: [] };

    constructor(view: EditorView) {
      const lines = revealedLines(view.state, view.hasFocus);
      this.key = revealKey(lines);
      this.decorations = buildDecorations(view, lines, this.metrics, this.code);
      this.measureCode(view);
    }

    /**
     * Code lines can wrap, so a block's real height is only known on screen.
     * Measured heights of the blocks fully drawn are fed back into the next
     * build, which rounds the block to the rhythm [DESIGN §6]; it converges in
     * one extra frame and does nothing while nothing changes.
     */
    measureCode(view: EditorView) {
      if (!this.code.blocks.length) return;
      view.requestMeasure({
        key: this,
        read: (v) => {
          const { from, to } = v.viewport;
          return this.code.blocks
            .filter((b) => b.from >= from && v.state.doc.line(b.lastLine).to <= to)
            .map((b) => ({
              from: b.from,
              body: v.lineBlockAt(v.state.doc.line(b.lastLine).from).bottom - b.padding - v.lineBlockAt(v.state.doc.line(b.firstLine).from).top,
            }));
        },
        write: (results, v) => {
          let changed = false;
          for (const { from, body } of results) {
            if (Math.abs((this.code.measured.get(from) ?? -1) - body) > 0.25) {
              this.code.measured.set(from, body);
              changed = true;
            }
          }
          // Dispatching is not allowed during the measure phase.
          if (changed) setTimeout(() => v.dispatch({ effects: refreshPreview.of(null) }));
        },
      });
    }

    update(u: ViewUpdate) {
      const lines = revealedLines(u.state, u.view.hasFocus);
      const key = revealKey(lines);
      // Rebuild only when something that affects the rendering changed.
      const refreshed = u.transactions.some((tr) => tr.effects.some((e) => e.is(refreshPreview)));
      if (u.docChanged) {
        const moved = new Map<number, number>();
        for (const [from, body] of this.code.measured) moved.set(u.changes.mapPos(from), body);
        this.code.measured = moved;
      }
      if (refreshed || u.docChanged || u.viewportChanged || key !== this.key || syntaxTree(u.state) !== syntaxTree(u.startState)) {
        this.key = key;
        this.decorations = buildDecorations(u.view, lines, this.metrics, this.code);
        this.measureCode(u.view);
      } else if (u.geometryChanged) this.measureCode(u.view);
    }
  },
  {
    decorations: (v) => v.decorations,
    eventHandlers: {
      mousedown(e, view) {
        if (e.button !== 0) return false;
        const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
        if (pos === null) return false;
        // A tag pill filters the list [DESIGN §2.5]; on the line being edited it is plain text.
        const onPill = e.target instanceof Element && e.target.closest(".cm-tag") !== null;
        const lineActive = view.hasFocus && view.state.selection.ranges.some((r) => view.state.doc.lineAt(r.head).number === view.state.doc.lineAt(pos).number);
        if (onPill && (!lineActive || e.ctrlKey || e.metaKey)) {
          const tag = tagAt(view.state, pos);
          if (tag) {
            e.preventDefault();
            editorHooks().openTag(tagKey(tag));
            return true;
          }
        }
        if (!(e.ctrlKey || e.metaKey)) return false;
        const target = wikiTargetAt(view.state, pos);
        if (target) {
          e.preventDefault();
          editorHooks().openWikiLink(target);
          return true;
        }
        const url = normalizeUrl(linkUrlAt(view.state, pos) ?? "");
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
