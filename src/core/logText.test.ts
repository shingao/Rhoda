import { describe as group, expect, it } from "vitest";
import { describe, logLine, scrub } from "./logText";

const ctx = { vault: "C:\\Users\\Ana\\Documents\\Ursa" };

group("error journal lines", () => {
  it("hides note names under the notes folder", () => {
    expect(scrub('cannot write "C:\\Users\\Ana\\Documents\\Ursa\\Journal intime.md": locked', ctx)).toBe('cannot write "<vault>\\….md": locked');
    expect(scrub("c:/users/ana/documents/ursa/assets/photo.png not found", ctx)).toBe("<vault>\\….png not found");
    expect(scrub("open C:\\Users\\Ana\\Documents\\Ursa", ctx)).toBe("open <vault>");
  });

  it("never keeps note text passed as a value", () => {
    const line = logLine(["[ursa] rename failed, keeping the old name for now", "Lettre à Marie.md", { secret: "x" }], ctx);
    expect(line).toBe("[ursa] rename failed, keeping the old name for now <text 17> <object>");
  });

  it("keeps only the first line of error messages", () => {
    const e = new SyntaxError("Nested mappings are not allowed at line 3\n\n  titre: mon secret\n  ^^^");
    e.stack = "SyntaxError: Nested…\n  titre: mon secret\n    at parse (yaml.js:10:5)\n    at loadNote (notes.ts:42:7)";
    expect(describe(e, ctx)).toBe("SyntaxError: Nested mappings are not allowed at line 3 | at parse (yaml.js:10:5) | at loadNote (notes.ts:42:7)");
  });

  it("describes backend errors and plain values", () => {
    expect(describe({ kind: "locked", message: "C:\\Users\\Ana\\Documents\\Ursa\\A.md is used by another process" }, ctx)).toBe(
      "locked: <vault>\\….md is used by another process",
    );
    expect(describe(42, ctx)).toBe("42");
    expect(describe(undefined, ctx)).toBe("undefined");
    expect(describe("x".repeat(1000), ctx, true)).toHaveLength(301);
  });
});
