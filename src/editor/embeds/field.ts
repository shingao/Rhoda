import { EditorSelection, Prec, StateEffect, StateField, type EditorState, type Extension, type Range } from "@codemirror/state";
import { Decoration, EditorView, keymap, type Command, type DecorationSet } from "@codemirror/view";
import { cssPx } from "../../app/cssTokens";
import { embedLines, type EmbedLine } from "../../core/markdown/embeds";
import { editorHooks, refreshPreview } from "../hooks";
import { ImageWidget, sizeOf } from "./image";

/**
 * Images, link cards and PDF cards: lines holding only one of them become a
 * block. The line under the cursor shows its Markdown above the block, so it
 * can be edited without the block jumping away [DESIGN §2.10].
 */
const focusChanged = StateEffect.define<boolean>();

interface Embeds {
  /** Embeds by line number, recomputed when the text changes. */
  lines: Map<number, EmbedLine>;
  focused: boolean;
  deco: DecorationSet;
}

function revealed(state: EditorState, focused: boolean, from: number, to: number): boolean {
  return focused && state.selection.ranges.some((r) => r.from <= to && r.to >= from);
}

function widgetFor(embed: EmbedLine, rhythm: number) {
  if (embed.kind !== "image") return null;
  const url = editorHooks().assetUrl(embed.src);
  if (!url) return null;
  if (!sizeOf(url)) editorHooks().wantSize(embed.src, url);
  return new ImageWidget(url, embed.alt, embed.width, embed.src, rhythm);
}

function decorate(state: EditorState, lines: Map<number, EmbedLine>, focused: boolean): DecorationSet {
  const rhythm = cssPx("--rhythm");
  const ranges: Range<Decoration>[] = [];
  for (const [n, embed] of lines) {
    if (n > state.doc.lines) continue;
    const widget = widgetFor(embed, rhythm);
    if (!widget) continue;
    const line = state.doc.line(n);
    if (revealed(state, focused, line.from, line.to)) ranges.push(Decoration.widget({ widget, block: true, side: 1 }).range(line.to));
    else ranges.push(Decoration.replace({ widget, block: true }).range(line.from, line.to));
  }
  return Decoration.set(ranges, true);
}

const linesOf = (state: EditorState) => embedLines(state.doc.iterLines());

const embedsField = StateField.define<Embeds>({
  create(state) {
    const lines = linesOf(state);
    return { lines, focused: false, deco: decorate(state, lines, false) };
  },
  update(value, tr) {
    let { lines, focused } = value;
    const focus = tr.effects.find((e) => e.is(focusChanged));
    if (focus) focused = focus.value;
    const refreshed = tr.effects.some((e) => e.is(refreshPreview));
    if (tr.docChanged) lines = linesOf(tr.state);
    if (!tr.docChanged && !tr.selection && !focus && !refreshed) return value;
    return { lines, focused, deco: decorate(tr.state, lines, focused) };
  },
  provide: (f) => EditorView.decorations.from(f, (v) => v.deco),
});

/**
 * ↑ / ↓ next to a block: the cursor goes onto its line (which shows its
 * Markdown) instead of jumping over it, so it can be edited from the keyboard.
 */
function stepOnto(dir: 1 | -1): Command {
  return (view) => {
    const { state } = view;
    const sel = state.selection.main;
    if (!sel.empty || state.selection.ranges.length > 1) return false;
    const line = state.doc.lineAt(sel.head);
    const n = line.number + dir;
    if (n < 1 || n > state.doc.lines || !state.field(embedsField).lines.has(n)) return false;
    const target = state.doc.line(n);
    if (!widgetFor(state.field(embedsField).lines.get(n)!, 1)) return false;
    view.dispatch({ selection: EditorSelection.cursor(dir > 0 ? target.from : target.to), scrollIntoView: true, userEvent: "select" });
    return true;
  };
}

/** Files from the clipboard or dropped on the text (in Tauri, Explorer drops arrive as paths instead, see app/attachments). */
function filesOf(data: DataTransfer | null): File[] {
  if (!data) return [];
  const files = [...data.files];
  if (files.length) return files;
  return [...data.items].filter((i) => i.kind === "file").flatMap((i) => i.getAsFile() ?? []);
}

export const embeds: Extension = [
  embedsField,
  Prec.high(keymap.of([{ key: "ArrowDown", run: stepOnto(1) }, { key: "ArrowUp", run: stepOnto(-1) }])),
  EditorView.domEventHandlers({
    paste(e, view) {
      const head = view.state.selection.main.head;
      const files = filesOf(e.clipboardData);
      if (files.length) {
        if (!editorHooks().attachFiles(files, head)) return false;
        e.preventDefault();
        return true;
      }
      // Some webviews leave images out of the paste event: ask the system clipboard.
      const types = [...(e.clipboardData?.types ?? [])];
      if (types.some((t) => t.startsWith("text/"))) return false;
      editorHooks().pasteClipboardImage(head);
      e.preventDefault();
      return true;
    },
    drop(e, view) {
      const files = filesOf(e.dataTransfer);
      if (!files.length) return false;
      const pos = view.posAtCoords({ x: e.clientX, y: e.clientY }) ?? view.state.selection.main.head;
      if (!editorHooks().attachFiles(files, pos)) return false;
      e.preventDefault();
      return true;
    },
  }),
  EditorView.focusChangeEffect.of((_state, focusing) => focusChanged.of(focusing)),
  EditorView.atomicRanges.of((view) => view.state.field(embedsField).deco),
];
