import { describe, expect, it } from "vitest";
import { blockStyleOf, listKindOf, setBlockStyleEdits, setListEdits, type LineEdit } from "./blockFormat";

const apply = (lines: string[], edits: LineEdit[]) =>
  lines.map((text, i) => {
    const e = edits.find((x) => x.line === i + 1);
    return e ? text.slice(0, e.from) + e.insert + text.slice(e.to) : text;
  });
const numbered = (lines: string[]) => lines.map((text, i) => ({ line: i + 1, text }));

describe("block style", () => {
  it("reads the style of a line", () => {
    expect(["Texte", "# Un", "## Deux", "### Trois", "#### Quatre", "> Citation", "- puce"].map(blockStyleOf)).toEqual(["text", "h1", "h2", "h3", "text", "quote", "text"]);
  });

  it("turns lines into headings, quote or text", () => {
    const lines = ["Un paragraphe", "## Titre", "> Citée"];
    expect(apply(lines, setBlockStyleEdits(numbered(lines), "h1"))).toEqual(["# Un paragraphe", "# Titre", "# Citée"]);
    expect(apply(lines, setBlockStyleEdits(numbered(lines), "quote"))).toEqual(["> Un paragraphe", "> Titre", "> Citée"]);
    expect(apply(lines, setBlockStyleEdits(numbered(lines), "text"))).toEqual(["Un paragraphe", "Titre", "Citée"]);
  });

  it("changes only what differs (the cursor stays put)", () => {
    expect(setBlockStyleEdits([{ line: 1, text: "## Titre" }], "h3")).toEqual([{ line: 1, from: 2, to: 2, insert: "#" }]);
    expect(setBlockStyleEdits([{ line: 1, text: "Texte" }], "text")).toEqual([]);
    expect(setBlockStyleEdits([{ line: 1, text: "" }], "h2")).toEqual([]);
  });
});

describe("lists", () => {
  it("makes bullets, numbers and tasks, keeping indentation and quotes", () => {
    const lines = ["Un", "  Deux", "> Trois"];
    expect(apply(lines, setListEdits(numbered(lines), "bullet"))).toEqual(["- Un", "  - Deux", "> - Trois"]);
    expect(apply(lines, setListEdits(numbered(lines), "ordered"))).toEqual(["1. Un", "  2. Deux", "> 3. Trois"]);
    expect(apply(lines, setListEdits(numbered(lines), "task"))).toEqual(["- [ ] Un", "  - [ ] Deux", "> - [ ] Trois"]);
  });

  it("switches kinds, keeps done tasks done, and toggles back to text", () => {
    const tasks = ["- [x] Fait", "- [ ] À faire"];
    expect(apply(tasks, setListEdits(numbered(tasks), "ordered"))).toEqual(["1. Fait", "2. À faire"]);
    expect(apply(tasks, setListEdits(numbered(tasks), "task"))).toEqual(["Fait", "À faire"]);
    const bullets = ["- a", "", "- b"];
    expect(apply(bullets, setListEdits(numbered(bullets), "bullet"))).toEqual(["a", "", "b"]);
    expect(listKindOf("12) douze")).toBe("ordered");
    expect(listKindOf("Texte")).toBeNull();
  });
});
