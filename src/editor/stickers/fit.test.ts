import { describe, expect, it } from "vitest";
import { fitInMargin } from "./layer";

// Column 100–700, visible area 0–800: right margin 100 px (minus an 8 px edge).
const g = { colLeft: 100, colWidth: 600, viewLeft: 0, viewRight: 800 };

describe("stickers in a narrow window", () => {
  it("leaves stickers that fit, and stickers on the text, where they are", () => {
    expect(fitInMargin({ x: 710, y: 0 }, 80, g, 8, 0.4)).toEqual({ x: 710, scale: 1 });
    expect(fitInMargin({ x: 400, y: 0 }, 168, g, 8, 0.4)).toEqual({ x: 400, scale: 1 });
  });

  it("lines a right-margin sticker up against the edge, smaller if the margin is too narrow", () => {
    expect(fitInMargin({ x: 760, y: 0 }, 80, g, 8, 0.4)).toEqual({ x: 712, scale: 1 });
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
    expect(leaf).toEqual({ x: 8, scale: 1 });
  });
});
