import { markdown } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { EditorSelection, EditorState, type TransactionSpec } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { ursaMarkdownExtensions } from "../../core/markdown/syntax";
import { foldField, foldSpec, foldedRanges, hiddenRanges, isHidden, keepFolds, sectionHeadingAt, setFolds, unfoldHeading } from "./fold";
import { headingsIn, sectionBody } from "./headings";

const DOC = [
  "# Voyage",
  "",
  "Intro",
  "",
  "## Avant le départ",
  "- [x] Billets",
  "- [ ] Assurance",
  "",
  "```md",
  "# pas un titre",
  "```",
  "",
  "## Itinéraire",
  "### Jour 1",
  "Texte 1",
  "",
  "### Jour 2",
  "Texte 2",
  "",
  "## Pratique",
  "Fin",
].join("\n");

function create(doc = DOC): EditorState {
  const state = EditorState.create({ doc, extensions: [markdown({ extensions: ursaMarkdownExtensions }), foldField] });
  ensureSyntaxTree(state, state.doc.length, 5000);
  return state;
}

const lineStart = (state: EditorState, text: string) => state.doc.line(state.doc.toString().split("\n").indexOf(text) + 1).from;
const apply = (state: EditorState, spec: TransactionSpec) => {
  const next = state.update(spec).state;
  ensureSyntaxTree(next, next.doc.length, 5000);
  return next;
};
const fold = (state: EditorState, ...titles: string[]) => apply(state, foldSpec(state, titles.map((t) => lineStart(state, t))));
const hidden = (state: EditorState) => hiddenRanges(state).map((r) => state.sliceDoc(r.from, r.to));

describe("headings and sections", () => {
  it("ignores # inside code blocks", () => {
    expect(headingsIn(create()).map((h) => h.text)).toEqual(["Voyage", "Avant le départ", "Itinéraire", "Jour 1", "Jour 2", "Pratique"]);
  });

  it("a section ends before the next heading of the same or higher level, without trailing blank lines", () => {
    const state = create();
    const [, avant, itin] = headingsIn(state);
    expect(state.sliceDoc(...Object.values(sectionBody(state, avant!)!) as [number, number])).toBe(
      "\n- [x] Billets\n- [ ] Assurance\n\n```md\n# pas un titre\n```",
    );
    const body = sectionBody(state, itin!)!;
    expect(state.sliceDoc(body.from, body.to)).toBe("\n### Jour 1\nTexte 1\n\n### Jour 2\nTexte 2");
  });

  it("finds the section of the cursor", () => {
    const state = create();
    expect(sectionHeadingAt(state, DOC.indexOf("Texte 2"))?.text).toBe("Jour 2");
    expect(sectionHeadingAt(state, DOC.indexOf("Intro"))?.text).toBe("Voyage");
  });
});

describe("folding", () => {
  it("hides the section and keeps the heading line", () => {
    const state = fold(create(), "## Avant le départ");
    expect(hidden(state)).toEqual(["\n- [x] Billets\n- [ ] Assurance\n\n```md\n# pas un titre\n```"]);
    expect(isHidden(state, DOC.indexOf("Billets"))).toBe(true);
    expect(isHidden(state, DOC.indexOf("## Itinéraire"))).toBe(false);
  });

  it("a code line starting with # is not foldable", () => {
    const state = create();
    expect(foldedRanges(apply(state, { effects: setFolds.of([lineStart(state, "# pas un titre")]) }))).toEqual([]);
  });

  it("moves a cursor out of the folded text", () => {
    let state = create();
    state = apply(state, { selection: EditorSelection.cursor(DOC.indexOf("Assurance")) });
    state = fold(state, "## Avant le départ");
    expect(state.selection.main.head).toBe(lineStart(state, "## Avant le départ") + "## Avant le départ".length);
  });

  it("copying across a folded section copies the hidden Markdown too", () => {
    const state = fold(create(), "## Avant le départ");
    const from = lineStart(state, "Intro");
    const to = lineStart(state, "## Itinéraire") + 5;
    // CodeMirror copies `state.sliceDoc` of the selection.
    expect(state.sliceDoc(from, to)).toContain("- [ ] Assurance\n\n```md\n# pas un titre\n```\n\n## It");
  });

  it("survives edits elsewhere and the renaming of its heading", () => {
    let state = fold(create(), "### Jour 2");
    state = apply(state, { changes: { from: 0, insert: "Nouvelle ligne\n\n" } });
    const heading = lineStart(state, "### Jour 2");
    state = apply(state, { changes: { from: heading + "### Jour 2".length, insert: " — Arashiyama" } });
    expect(foldedRanges(state).map((f) => f.heading)).toEqual([heading]);
    expect(hidden(state)).toEqual(["\nTexte 2"]);
    // Changing its level keeps it too.
    state = apply(state, { changes: { from: heading, insert: "#" } });
    expect(hidden(state)).toEqual(["\nTexte 2"]);
  });

  it("unfolds when the hidden text changes (undo, replace) or the cursor lands in it", () => {
    let state = fold(create(), "## Avant le départ");
    state = apply(state, { changes: { from: DOC.indexOf("Billets"), insert: "x" } });
    expect(foldedRanges(state)).toEqual([]);

    state = fold(state, "## Avant le départ");
    state = apply(state, { selection: EditorSelection.cursor(state.doc.toString().indexOf("Assurance")) });
    expect(foldedRanges(state)).toEqual([]);
  });

  it("typing right after the badge unfolds instead of hiding the new text", () => {
    let state = fold(create(), "### Jour 2");
    const end = foldedRanges(state)[0]!.to;
    state = apply(state, { changes: { from: end, insert: "!" } });
    expect(foldedRanges(state)).toEqual([]);
  });

  it("Ursa's own rewrites inside a folded section keep it folded", () => {
    let state = fold(create(), "### Jour 2");
    state = apply(state, { changes: { from: state.doc.toString().indexOf("Texte 2"), insert: "#tag " }, annotations: keepFolds.of(true) });
    expect(hidden(state)).toEqual(["\n#tag Texte 2"]);
  });

  it("deleting the heading of a folded section shows its content, nothing lost", () => {
    let state = fold(create(), "## Avant le départ");
    const h = lineStart(state, "## Avant le départ");
    state = apply(state, { changes: { from: h, to: h + "## Avant le départ".length } });
    expect(foldedRanges(state)).toEqual([]);
    expect(state.doc.toString()).toContain("- [x] Billets\n- [ ] Assurance");

    // Joining the heading with the text line above (Backspace at its start) too.
    state = fold(create("Intro\n## A\nx\ny"), "## A");
    state = apply(state, { changes: { from: 5, to: 6 } });
    expect(state.doc.toString()).toBe("Intro## A\nx\ny");
    expect(foldedRanges(state)).toEqual([]);
  });

  it("nested folds: only the outer one hides, the inner one is remembered", () => {
    let state = fold(create(), "## Itinéraire", "### Jour 2");
    expect(hidden(state)).toHaveLength(1);
    state = apply(state, { effects: unfoldHeading.of(lineStart(state, "## Itinéraire")) });
    expect(hidden(state)).toEqual(["\nTexte 2"]);
  });

  it("a section without content cannot be folded", () => {
    const state = create("## A\n\n## B\nx");
    expect(foldedRanges(fold(state, "## A"))).toEqual([]);
    expect(foldedRanges(fold(state, "## B"))).toHaveLength(1);
  });
});
