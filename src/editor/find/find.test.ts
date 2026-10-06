import { history, undo } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { ursaMarkdownExtensions } from "../../core/markdown/syntax";
import { fold } from "../../core/search/fold";
import { foldField, foldSpec, foldedRanges } from "../sections/fold";
import { setEditorHooks } from "../hooks";
import { findField, findInfo, findMatches, ordered, replaceAllSpec, setNeedles } from "./find";

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

  it("adds the occurrences read in the note's images, walked in document order", () => {
    setEditorHooks({
      imageMatches: (src, needles) =>
        src === "assets/billet.png" && needles.includes("nara")
          ? { boxes: [{ x: 320, y: 198, w: 138, h: 40 }, { x: 10, y: 300, w: 100, h: 40 }], width: 1000, height: 420 }
          : null,
    });
    const doc = "# Nara\n\n![](assets/billet.png)\n\nRetour de Nara le soir.";
    const state = create(doc).update({ effects: setNeedles.of(needle("nara")) }).state;
    const f = state.field(findField);
    expect(findInfo(state)).toEqual({ count: 2, current: null, images: 2, currentImage: null });
    expect(f.images[0]!.zone).toEqual({ x: 0.32, y: 198 / 420, w: 0.138, h: 40 / 420 });
    // Title, then the two zones of the image, then the last line.
    expect(ordered(f).map((o) => (o.image ? `image ${o.index}` : `text ${o.index}`))).toEqual(["text 0", "image 0", "image 1", "text 1"]);
    setEditorHooks({ imageMatches: () => null });
  });
});
