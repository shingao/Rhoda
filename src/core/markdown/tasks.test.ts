import { describe, expect, it } from "vitest";
import { toggleTaskEdits, type LineEdit } from "./tasks";

/** Applies the edits to the lines, for readable expectations. */
function run(lines: string[]): string[] {
  const edits = toggleTaskEdits(lines.map((text, line) => ({ line, text })));
  return lines.map((text, line) =>
    edits
      .filter((e: LineEdit) => e.line === line)
      .sort((a, b) => b.from - a.from)
      .reduce((t, e) => t.slice(0, e.from) + e.insert + t.slice(e.to), text),
  );
}

describe("Ctrl+Shift+T", () => {
  it("ticks and unticks the task of the line", () => {
    expect(run(["- [ ] pain"])).toEqual(["- [x] pain"]);
    expect(run(["- [x] pain"])).toEqual(["- [ ] pain"]);
    expect(run(["  1. [X] imbriquée"])).toEqual(["  1. [ ] imbriquée"]);
    expect(run(["> - [ ] dans une citation"])).toEqual(["> - [x] dans une citation"]);
  });

  it("ticks every selected task if one was not, else unticks them all", () => {
    expect(run(["- [x] a", "- [ ] b", "- [x] c"])).toEqual(["- [x] a", "- [x] b", "- [x] c"]);
    expect(run(["- [x] a", "- [x] b"])).toEqual(["- [ ] a", "- [ ] b"]);
    // Lines that are not tasks are left alone when tasks are selected.
    expect(run(["Titre", "- [ ] a"])).toEqual(["Titre", "- [x] a"]);
  });

  it("turns lines into tasks when none is one", () => {
    expect(run(["- lait"])).toEqual(["- [ ] lait"]);
    expect(run(["Acheter du pain"])).toEqual(["- [ ] Acheter du pain"]);
    expect(run(["  indenté"])).toEqual(["  - [ ] indenté"]);
    expect(run(["un", "", "deux"])).toEqual(["- [ ] un", "", "- [ ] deux"]);
    expect(run([""])).toEqual(["- [ ] "]);
  });
});
