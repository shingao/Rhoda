import { describe, expect, it } from "vitest";
import { textHash } from "./hash";

describe("textHash", () => {
  it("is stable, fixed-width and sensitive to any change", () => {
    expect(textHash("# Note\n\nTexte")).toBe(textHash("# Note\n\nTexte"));
    expect(textHash("")).toMatch(/^[0-9a-f]{14}$/);
    expect(textHash("l'été")).not.toBe(textHash("l’été"));
    expect(textHash("a".repeat(10_000))).not.toBe(textHash("a".repeat(9_999) + "b"));
  });
});
