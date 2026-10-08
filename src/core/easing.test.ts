import { describe, expect, it } from "vitest";
import { cubicBezier, parseEasing } from "./easing";

describe("easing", () => {
  it("evaluates cubic-bezier like CSS", () => {
    const linear = cubicBezier(0, 0, 1, 1);
    expect(linear(0.3)).toBeCloseTo(0.3, 4);
    const ease = cubicBezier(0.25, 0.1, 0.25, 1);
    // Reference values of CSS "ease".
    expect(ease(0.25)).toBeCloseTo(0.4085, 3);
    expect(ease(0.5)).toBeCloseTo(0.8024, 3);
    expect(ease(0)).toBe(0);
    expect(ease(1)).toBe(1);
  });

  it("reads the token's value; anything else is linear", () => {
    const out = parseEasing("cubic-bezier(.2, .7, .2, 1)");
    expect(out(0.5)).toBeGreaterThan(0.8);
    const values = [0.1, 0.2, 0.4, 0.6, 0.8, 0.95].map(out);
    expect(values).toEqual([...values].sort((a, b) => a - b));
    expect(parseEasing("ease-in")(0.5)).toBeLessThan(0.5);
    expect(parseEasing("steps(4)")(0.3)).toBe(0.3);
  });
});
