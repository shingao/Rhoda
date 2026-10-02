import { history, undo } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { ursaMarkdownExtensions } from "../../core/markdown/syntax";
import { fold } from "../../core/search/fold";
import { foldField, foldSpec, foldedRanges } from "../sections/fold";
import { findField, findMatches, replaceAllSpec, setNeedles } from "./find";

const DOC = "# Été à Nîmes\n\nUn ÉTÉ chaud, une œuvre.\n\n## Plus tard\nL'été revient. Été !";
const needle = (s: string) => [{ text: fold(s), wordStart: false }];

function create(doc = DOC): EditorState {
  return EditorState.create({ doc, extensions: [history(), markdown({ extensions: ursaMarkdownExtensions }), foldField, findField] });
}

describe("find in note", () => {
  it("ignores case and accents, maps back to the real text", () => {
    const state = create();
    const matches = findMatches(state.doc, needle("ete"));
    expect(matches.map(([a, b]) => state.sliceDoc(a, b))).toEqual(["Été", "ÉTÉ", "été", "Été"]);
    expect(findMatches(state.doc, needle("oeuvre")).map(([a, b]) => state.sliceDoc(a, b))).toEqual(["œuvre"]);
  });

  it("follows edits", () => {
    let state = create().update({ effects: setNeedles.of(needle("ete")) }).state;
    expect(state.field(findField).matches).toHaveLength(4);
    state = state.update({ changes: { from: state.doc.length, insert: " Et un été de plus." } }).state;
    expect(state.field(findField).matches).toHaveLength(5);
  });

  it("replace all is a single undo step and keeps folds", () => {
    let state = create().update({ effects: setNeedles.of(needle("ete")) }).state;
    const heading = state.doc.toString().indexOf("## Plus tard");
    state = state.update(foldSpec(state, [heading])).state;
    state = state.update(replaceAllSpec(state, "hiver")!).state;
    expect(state.doc.toString()).toBe("# hiver à Nîmes\n\nUn hiver chaud, une œuvre.\n\n## Plus tard\nL'hiver revient. hiver !");
    expect(foldedRanges(state)).toHaveLength(1);
    let undone = state;
    undo({ state, dispatch: (tr) => (undone = tr.state) });
    expect(undone.doc.toString()).toBe(DOC);
  });
});
