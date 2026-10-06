import { history, redo, undo } from "@codemirror/commands";
import { EditorState, Transaction, type TransactionSpec } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { parseStickers } from "../../core/stickers";
import { changesStickers, loadStickers, placeStickers, stickerState, stickerTransaction, stickersOf, storedStickers, type Placed } from "./state";

const DOC = "# Journal\n\nLevé avant le jour.\n\n## Petites choses\n- [ ] Rappeler Inès\n- [x] Rempoter le basilic\n";

function setup(): { get: () => EditorState; run: (cmd: typeof undo) => void; apply: (spec: TransactionSpec) => void } {
  let state = EditorState.create({ doc: DOC, extensions: [history(), stickerState] });
  const stored = parseStickers([
    { id: "a", type: "sticker", asset: "fluent/sun", anchor: { block: "paragraph", text: "levé avant le jour.", index: 1 }, dx: 105, dy: 4 },
    { id: "b", type: "postit", text: "Terreau", anchor: { block: "list", text: "rempoter le basilic", index: 4 }, dx: 110, dy: 0 },
  ]);
  state = state.update({ effects: loadStickers.of(placeStickers(stored, state.doc)), annotations: Transaction.addToHistory.of(false) }).state;
  const apply = (spec: TransactionSpec) => {
    state = state.update(spec).state;
  };
  const run = (cmd: typeof undo) => cmd({ state, dispatch: (tr) => (state = tr.state) });
  return { get: () => state, run, apply };
}

const find = (state: EditorState, id: string) => stickersOf(state).find((p) => p.id === id);
const lineOf = (state: EditorState, p: Placed | undefined) => (p ? state.doc.lineAt(p.pos).text : null);

describe("stickers in the editor state", () => {
  it("anchors stored stickers to their block", () => {
    const { get } = setup();
    expect(lineOf(get(), find(get(), "a"))).toBe("Levé avant le jour.");
    expect(lineOf(get(), find(get(), "b"))).toBe("- [x] Rempoter le basilic");
    // Post-its above stickers.
    expect(stickersOf(get()).map((p) => p.id)).toEqual(["a", "b"]);
  });

  it("follows its block when text is inserted above or at its start", () => {
    const { get, apply } = setup();
    apply({ changes: { from: 0, insert: "# Nouveau\n\n" } });
    expect(lineOf(get(), find(get(), "a"))).toBe("Levé avant le jour.");
    const a = find(get(), "a")!;
    apply({ changes: { from: a.pos, insert: "Très tôt. " } });
    expect(lineOf(get(), find(get(), "a"))).toBe("Très tôt. Levé avant le jour.");
    expect(storedStickers(get()).find((s) => s.id === "a")!.anchor).toEqual({ type: "paragraph", text: "très tôt. levé avant le jour.", index: 2 });
  });

  it("moves to the next block when its block is deleted, never lost", () => {
    const { get, apply } = setup();
    const a = find(get(), "a")!;
    const line = get().doc.lineAt(a.pos);
    apply({ changes: { from: line.from, to: line.to + 2 } });
    expect(lineOf(get(), find(get(), "a"))).toBe("## Petites choses");
    apply({ changes: { from: 0, to: get().doc.length } });
    expect(stickersOf(get())).toHaveLength(2);
  });

  it("undoes and redoes sticker changes in the text's history", () => {
    const { get, apply, run } = setup();
    const a = find(get(), "a")!;
    const tr = get().update(stickerTransaction([{ before: a, after: { ...a, rotation: 12, dx: 50 } }]));
    expect(changesStickers(tr)).toBe(true);
    apply(stickerTransaction([{ before: a, after: { ...a, rotation: 12, dx: 50 } }]));
    apply({ changes: { from: get().doc.length, insert: "Fin\n" } });
    const b = find(get(), "b")!;
    apply(stickerTransaction([{ before: b, after: null }]));
    expect(find(get(), "b")).toBeUndefined();
    run(undo);
    expect(find(get(), "b")?.text).toBe("Terreau");
    run(undo);
    expect(get().doc.toString()).toBe(DOC);
    run(undo);
    expect(find(get(), "a")).toMatchObject({ rotation: 0, dx: 105 });
    run(redo);
    expect(find(get(), "a")).toMatchObject({ rotation: 12, dx: 50 });
    // Loading from disk is not undoable.
    apply({ effects: loadStickers.of([]), annotations: Transaction.addToHistory.of(false) });
    expect(stickersOf(get())).toHaveLength(0);
  });

  it("keeps a placed sticker's position mapped through later edits when undone", () => {
    const { get, apply, run } = setup();
    const a = find(get(), "a")!;
    apply(stickerTransaction([{ before: a, after: null }]));
    apply({ changes: { from: 0, insert: "Avant\n\n" } });
    run(undo);
    run(undo);
    expect(lineOf(get(), find(get(), "a"))).toBe("Levé avant le jour.");
  });
});
