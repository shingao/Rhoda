import { describe, expect, it } from "vitest";
import { foldKeys, matchFoldKeys, type HeadingInfo } from "./folds";

const h = (spec: string): HeadingInfo[] =>
  spec.split("|").map((s) => {
    const [level, text] = s.split(":");
    return { level: Number(level), text: text! };
  });

describe("fold keys", () => {
  const headings = h("1:Voyage|2:Avant le départ|2:Itinéraire|3:Jour 1|3:Jour 2|2:Pratique");

  it("round-trips on the same headings", () => {
    expect(matchFoldKeys(foldKeys(headings, [1, 4]), headings)).toEqual([1, 4]);
  });

  it("follows a heading moved by inserted headings", () => {
    const keys = foldKeys(headings, [4]);
    const after = h("1:Voyage|2:Intro|2:Avant le départ|2:Itinéraire|3:Jour 1|3:Jour 2|2:Pratique");
    expect(matchFoldKeys(keys, after)).toEqual([5]);
  });

  it("is case-insensitive and picks the nearest duplicate", () => {
    const dup = h("2:Notes|2:Autre|2:Notes|2:Notes");
    expect(matchFoldKeys([{ text: "NOTES", level: 2, index: 3 }], dup)).toEqual([3]);
  });

  it("falls back to the rank when the title was renamed elsewhere", () => {
    const keys = foldKeys(headings, [4]);
    const renamed = h("1:Voyage|2:Avant le départ|2:Itinéraire|3:Jour 1|3:Jour 2 — Arashiyama|2:Pratique");
    expect(matchFoldKeys(keys, renamed)).toEqual([4]);
  });

  it("does not steal a heading another key matches by text, nor change level", () => {
    const keys = [
      { text: "Supprimé", level: 2, index: 1 },
      { text: "Pratique", level: 2, index: 5 },
    ];
    expect(matchFoldKeys(keys, h("1:Voyage|2:Pratique"))).toEqual([1]);
    expect(matchFoldKeys([{ text: "Disparu", level: 3, index: 1 }], h("1:Voyage|2:Pratique"))).toEqual([]);
  });
});
