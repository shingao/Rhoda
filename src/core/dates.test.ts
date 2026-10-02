import { describe, expect, it } from "vitest";
import { formatRelative, isoLocal } from "./dates";

describe("formatRelative", () => {
  const now = new Date(2026, 9, 2, 15, 0).getTime();
  it("follows DESIGN.md §2.4", () => {
    expect(formatRelative(now - 10_000, now)).toBe("just now");
    expect(formatRelative(now - 12 * 60_000, now)).toBe("12 min ago");
    expect(formatRelative(now - 2 * 3_600_000, now)).toBe("2 h ago");
    expect(formatRelative(new Date(2026, 9, 1, 20).getTime(), now)).toBe("Yesterday");
    expect(formatRelative(new Date(2026, 8, 28).getTime(), now)).toBe("Mon");
    expect(formatRelative(new Date(2026, 7, 28).getTime(), now)).toBe("Aug 28");
    expect(formatRelative(new Date(2025, 8, 28).getTime(), now)).toBe("Sep 28, 2025");
  });

  it("formats local ISO dates", () => {
    expect(isoLocal(now)).toMatch(/^2026-10-02T15:00:00[+-]\d\d:\d\d$/);
  });
});
