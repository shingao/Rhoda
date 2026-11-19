import { describe, expect, it } from "vitest";
import { closeTag, openTag, pairInlineTags, parseInlineTag, stripInlineTags, type TagSpan } from "./inlineTags";

const spans = (text: string): TagSpan[] => [...text.matchAll(/<[^<>]+>/g)].map((m) => ({ from: m.index, to: m.index + m[0].length, text: m[0] }));

describe("inline tags", () => {
  it("reads the app's tags only", () => {
    expect(parseInlineTag("<u>")).toEqual({ kind: "underline", closing: false });
    expect(parseInlineTag('<span data-size="lg">')).toEqual({ kind: "size", closing: false, size: "lg" });
    expect(parseInlineTag('<mark data-color="green">')).toEqual({ kind: "mark", closing: false, color: "green" });
    expect(parseInlineTag("<mark>")).toEqual({ kind: "mark", closing: false, color: "yellow" });
    expect(parseInlineTag('<mark data-color="mauve">')).toEqual({ kind: "mark", closing: false, color: "yellow" });
    expect(parseInlineTag('<span class="x">')).toBeNull();
    expect(parseInlineTag("<b>")).toBeNull();
  });

  it("pairs nested tags per kind", () => {
    const text = '<u>a <mark data-color="blue">b <u>c</u></mark></u>';
    const pairs = pairInlineTags(spans(text));
    expect(pairs.map((p) => [p.kind, text.slice(p.open.to, p.close.from)])).toEqual([
      ["underline", 'a <mark data-color="blue">b <u>c</u></mark>'],
      ["mark", "b <u>c</u>"],
      ["underline", "c"],
    ]);
    expect(pairs[1]!.color).toBe("blue");
    // A lone closing tag pairs with nothing.
    expect(pairInlineTags(spans("a</u> <u>b</u>"))).toHaveLength(1);
  });

  it("strips them for search, leaving other HTML", () => {
    expect(stripInlineTags('Un <u>mot</u> <span data-size="sm">petit</span> et <mark data-color="pink">rose</mark> <b>gras</b>')).toBe("Un mot petit et rose <b>gras</b>");
  });

  it("writes them", () => {
    expect([openTag("underline"), closeTag("underline")]).toEqual(["<u>", "</u>"]);
    expect(openTag("size", "sm")).toBe('<span data-size="sm">');
    expect([openTag("mark", "yellow"), openTag("mark", "pink"), closeTag("mark")]).toEqual(["<mark>", '<mark data-color="pink">', "</mark>"]);
  });
});
