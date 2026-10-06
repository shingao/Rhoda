import { describe, expect, it } from "vitest";
import { fitInMargin, postitInMargin } from "./layer";

// Column 100–700, visible area 0–800: right margin 100 px (minus an 8 px edge).
const g = { colLeft: 100, colWidth: 600, viewLeft: 0, viewRight: 800 };

describe("stickers in a narrow window", () => {
  it("leaves stickers that fit, and stickers on the text, where they are", () => {
    expect(fitInMargin({ x: 710, y: 0 }, 80, g, 8, 0.4)).toMatchObject({ x: 710, scale: 1, side: null });
    expect(fitInMargin({ x: 400, y: 0 }, 168, g, 8, 0.4)).toMatchObject({ x: 400, scale: 1, side: null });
  });

  it("lines a right-margin sticker up against the edge, smaller if the margin is too narrow", () => {
    expect(fitInMargin({ x: 760, y: 0 }, 80, g, 8, 0.4)).toMatchObject({ x: 712, scale: 1, side: "right", room: 92 });
    const postit = fitInMargin({ x: 750, y: 0 }, 168, g, 8, 0.4);
    expect(postit.scale).toBeCloseTo(92 / 168);
    // Its drawn box ends at the edge and starts right after the column.
    expect(postit.x + 84 + 84 * postit.scale).toBeCloseTo(792);
    expect(postit.x + 84 - 84 * postit.scale).toBeCloseTo(700);
    // Never below the minimum size.
    expect(fitInMargin({ x: 750, y: 0 }, 240, { ...g, viewRight: 760 }, 8, 0.4).scale).toBe(0.4);
  });

  it("does the same in the left margin", () => {
    const leaf = fitInMargin({ x: -30, y: 0 }, 64, g, 8, 0.4);
    expect(leaf).toMatchObject({ x: 8, scale: 1, side: "left" });
  });

  it("turns a post-it that would shrink below 70 % into a pill, opened whole on demand", () => {
    const pill = { min: 28, max: 188 };
    // 92 px of room for 168 px: 55 % → pill as wide as the room, against the edge.
    const fit = fitInMargin({ x: 750, y: 0 }, 168, g, 8, 0.4);
    expect(postitInMargin(fit, 168, 0.7, pill, false)).toEqual({ x: 700, scale: 1, pill: 92 });
    // Opened: whole, ending at the edge (over the text).
    expect(postitInMargin(fit, 168, 0.7, pill, true)).toEqual({ x: 792 - 168, scale: 1, pill: null });
    // A wider margin (75 %): only shrunk.
    const wide = fitInMargin({ x: 750, y: 0 }, 168, { ...g, viewRight: 834 }, 8, 0.4);
    expect(postitInMargin(wide, 168, 0.7, pill, false).pill).toBeNull();
  });
});
