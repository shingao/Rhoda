import { EditorSelection, Prec, StateEffect, StateField, type EditorState, type Extension, type Range } from "@codemirror/state";
import { isolateHistory } from "@codemirror/commands";
import { Decoration, EditorView, keymap, type Command, type DecorationSet } from "@codemirror/view";
import { cssPx } from "../../app/cssTokens";
import { decodeSrc, embedLines, parseEmbedLine, type EmbedLine } from "../../core/markdown/embeds";
import { editorHooks, refreshPreview } from "../hooks";
import { ImageWidget, sizeOf, type ImageActions } from "./image";
import { LinkCardWidget } from "./linkCard";

/**
 * Images, link cards and PDF cards: lines holding only one of them become a
 * block. The line under the cursor shows its Markdown above the block, so it
 * can be edited without the block jumping away [DESIGN §2.10].
 */
const focusChanged = StateEffect.define<boolean>();
/** Selects the image block starting at this position (null: none). */
const selectImage = StateEffect.define<number | null>();

interface Embeds {
  /** Embeds by line number, recomputed when the text changes. */
  lines: Map<number, EmbedLine>;
  focused: boolean;
  /** Start of the line of the selected image (ring, handles, bar), or null. */
  selected: number | null;
  deco: DecorationSet;
}

/** Image line of a block's DOM node. */
function imageLineOf(view: EditorView, dom: HTMLElement) {
  const line = view.state.doc.lineAt(view.posAtDOM(dom));
  const embed = parseEmbedLine(line.text);
  return embed?.kind === "image" ? { line, embed } : null;
}

const actions: ImageActions = {
  select(view, dom) {
    const found = imageLineOf(view, dom);
    if (!found) return;
    // The cursor goes to the image's line (so Ctrl+Z after a resize stays here); a selected image keeps its Markdown hidden.
    view.dispatch({ selection: { anchor: found.line.from }, effects: selectImage.of(found.line.from) });
    view.focus();
  },
  resize(view, dom, width) {
    const found = imageLineOf(view, dom);
    if (!found) return;
    const { line, embed } = found;
    if (embed.width === width) return;
    view.dispatch({
      changes: { from: line.from + embed.attrFrom, to: line.from + embed.attrTo, insert: width ? `{width=${width}}` : "" },
      effects: selectImage.of(line.from),
      // One drag or one click of the bar = one Ctrl+Z.
      annotations: isolateHistory.of("full"),
      userEvent: "input.resize",
    });
  },
  crop(view, dom) {
    const found = imageLineOf(view, dom);
    if (found) editorHooks().cropImage(found.embed.src, found.line.from);
  },
};

/** Cropping makes a new PNG / JPG / WebP; GIF (animation) and SVG (vector) are left alone. */
const croppable = (src: string) => /\.(png|jpe?g|webp)$/i.test(decodeSrc(src).split(/[?#]/)[0]!);

function revealed(state: EditorState, focused: boolean, from: number, to: number): boolean {
  return focused && state.selection.ranges.some((r) => r.from <= to && r.to >= from);
}

function widgetFor(embed: EmbedLine, rhythm: number, selected = false) {
  if (embed.kind === "url") {
    const state = editorHooks().urlCard(embed.url);
    // Off, or the link cannot be previewed: it stays a plain link.
    return state && state.status !== "plain" ? new LinkCardWidget(embed.url, state) : null;
  }
  if (embed.kind !== "image") return null;
  const url = editorHooks().assetUrl(embed.src);
  if (!url) return null;
  if (!sizeOf(url)) editorHooks().wantSize(embed.src, url);
  return new ImageWidget(url, embed.alt, embed.width, embed.src, rhythm, selected, croppable(embed.src), actions);
}

function decorate(state: EditorState, lines: Map<number, EmbedLine>, focused: boolean, selected: number | null): DecorationSet {
  const rhythm = cssPx("--rhythm");
  const ranges: Range<Decoration>[] = [];
  for (const [n, embed] of lines) {
    if (n > state.doc.lines) continue;
    const line = state.doc.line(n);
    const widget = widgetFor(embed, rhythm, selected === line.from);
    if (!widget) continue;
    if (selected !== line.from && revealed(state, focused, line.from, line.to)) ranges.push(Decoration.widget({ widget, block: true, side: 1 }).range(line.to));
    else ranges.push(Decoration.replace({ widget, block: true }).range(line.from, line.to));
  }
  return Decoration.set(ranges, true);
}

const linesOf = (state: EditorState) => embedLines(state.doc.iterLines());

const embedsField = StateField.define<Embeds>({
  create(state) {
    const lines = linesOf(state);
    return { lines, focused: false, selected: null, deco: decorate(state, lines, false, null) };
  },
  update(value, tr) {
    let { lines, focused, selected } = value;
    const focus = tr.effects.find((e) => e.is(focusChanged));
    if (focus) focused = focus.value;
    const refreshed = tr.effects.some((e) => e.is(refreshPreview));
    const select = tr.effects.find((e) => e.is(selectImage));
    if (tr.docChanged) lines = linesOf(tr.state);
    if (selected !== null && tr.docChanged) selected = tr.changes.mapPos(selected);
    // Moving the cursor deselects; so does losing the image line.
    if (select) selected = select.value;
    else if (tr.selection) selected = null;
    if (selected !== null && !lines.has(tr.state.doc.lineAt(selected).number)) selected = null;
    if (!tr.docChanged && !tr.selection && !focus && !refreshed && selected === value.selected) return value;
    return { lines, focused, selected, deco: decorate(tr.state, lines, focused, selected) };
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

/** Keys on a selected image: Escape deselects, Delete / Backspace remove it, Enter edits its Markdown. */
function onSelected(run: (view: EditorView, line: { from: number; to: number }) => void): Command {
  return (view) => {
    const selected = view.state.field(embedsField).selected;
    if (selected === null) return false;
    run(view, view.state.doc.lineAt(selected));
    return true;
  };
}

const removeLine = onSelected((view, line) => {
  const { doc } = view.state;
  const to = line.to < doc.length ? line.to + 1 : line.to;
  const from = line.to < doc.length || line.from === 0 ? line.from : line.from - 1;
  view.dispatch({ changes: { from, to }, selection: { anchor: from }, effects: selectImage.of(null), userEvent: "delete" });
});

export const embeds: Extension = [
  embedsField,
  Prec.high(
    keymap.of([
      { key: "ArrowDown", run: stepOnto(1) },
      { key: "ArrowUp", run: stepOnto(-1) },
      { key: "Escape", run: onSelected((view) => view.dispatch({ effects: selectImage.of(null) })) },
      { key: "Delete", run: removeLine },
      { key: "Backspace", run: removeLine },
      { key: "Enter", run: onSelected((view, line) => view.dispatch({ selection: { anchor: line.to }, effects: selectImage.of(null) })) },
    ]),
  ),
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
