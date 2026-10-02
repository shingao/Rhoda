import { EditorSelection, EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { codeClosingHeight, revealedLines } from "./build";

describe("code block rhythm", () => {
  const m = { header: 32, line: 13.5 * 1.65, padBottom: 16, rhythm: 28 };

  it("rounds every block up to a multiple of the 28 px rhythm", () => {
    for (let lines = 0; lines <= 40; lines++) {
      const closing = codeClosingHeight(m, lines * m.line);
      const total = m.header + lines * m.line + closing;
      expect(total / m.rhythm).toBeCloseTo(Math.round(total / m.rhythm), 6);
      expect(closing).toBeGreaterThanOrEqual(m.padBottom - 1e-6);
      expect(closing).toBeLessThan(m.padBottom + m.rhythm);
    }
  });
});

describe("revealed lines", () => {
  const state = EditorState.create({
    doc: "a\nb\nc\nd",
    selection: EditorSelection.create([EditorSelection.cursor(0), EditorSelection.range(4, 6)]),
    extensions: EditorState.allowMultipleSelections.of(true),
  });

  it("reveals every line touched by a cursor or a selection", () => {
    expect([...revealedLines(state, true)].sort()).toEqual([1, 3, 4]);
  });

  it("reveals nothing when the editor is not focused", () => {
    expect(revealedLines(state, false).size).toBe(0);
  });
});
