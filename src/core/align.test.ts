import { describe, expect, it } from "vitest";
import { alignedLines, alignedLinesOf, alignsFromLines, parseAligns, serializeAligns } from "./align";
import { renderHtml } from "./export/html";
import { URSA_KEYS } from "./export/markdown";
import { parseDocument } from "./export/model";
import { blocksOf } from "./stickers";

const body = ["# Titre", "", "Premier paragraphe.", "", "> Une citation", "", "- un", "- deux", "", "```", "code", "```", "", "| a | b |", "|---|---|", "| 1 | 2 |"].join("\n");
const blocks = blocksOf(body.split("\n"));

describe("block alignment", () => {
  it("round-trips through the frontmatter, left never stored", () => {
    const lines = new Map([
      [1, "center"],
      [3, "justify"],
      [5, "right"],
      [8, "center"],
    ] as const);
    const aligns = alignsFromLines(lines, blocks);
    expect(aligns.map((a) => [a.anchor.type, a.align])).toEqual([
      ["heading", "center"],
      ["paragraph", "justify"],
      ["quote", "right"],
      ["list", "center"],
    ]);
    const stored = serializeAligns(aligns);
    expect(stored?.[0]).toEqual({ block: "heading", text: "titre", index: 0, align: "center" });
    expect(parseAligns(stored)).toEqual(aligns);
    expect(serializeAligns([])).toBeUndefined();
  });

  it("never aligns code blocks, tables, nor left; drops malformed entries", () => {
    expect(alignsFromLines(new Map([[10, "center"], [14, "right"]]), blocks)).toEqual([]);
    expect(parseAligns([{ block: "code", text: "code", index: 4, align: "center" }, { block: "paragraph", text: "x", align: "left" }, { block: "paragraph", align: "sideways" }, "nope", null])).toEqual([]);
    expect(parseAligns("center")).toEqual([]);
  });

  it("follows its block when the text above changes", () => {
    const aligns = alignsFromLines(new Map([[3, "center"]]), blocks);
    const edited = ["# Titre", "", "Un ajout au-dessus.", "", "Premier paragraphe.", "", "> Une citation"].join("\n");
    expect([...alignedLinesOf(aligns, edited)]).toEqual([[5, "center"]]);
  });

  it("export: classes on aligned blocks, list items and quotes; nothing in Markdown", () => {
    const aligned = alignedLines(alignsFromLines(new Map([[1, "center"], [3, "justify"], [5, "right"], [8, "center"]]), blocks), blocks);
    const doc = parseDocument(body, aligned);
    const html = renderHtml(doc, { image: () => null, wiki: () => null, labels: { done: "fait", todo: "à faire", pdf: "PDF" } });
    expect(html).toMatch(/<h1 id="[^"]*" class="u-align-center"/);
    expect(html).toMatch(/<p class="u-align-justify" data-line="3"/);
    expect(html).toMatch(/<blockquote class="u-align-right"/);
    expect(html).toMatch(/<li class="u-align-center" data-line="8"/);
    expect(html).toMatch(/<li data-line="7"/);
    expect(html).not.toMatch(/u-code[^>]*u-align/);
    // Markdown export: the app's frontmatter keys are left out (the text stays as written).
    expect(URSA_KEYS).toEqual(expect.arrayContaining(["align", "column"]));
  });
});
