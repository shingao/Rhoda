import { describe, expect, it } from "vitest";
import { en } from "../i18n/en";
import { fr } from "../i18n/fr";
import { fileStamp, formatRelative, isoLocal } from "./dates";

const now = new Date(2026, 9, 2, 15, 0).getTime();
const cases = (labels: typeof fr.dates) => [
  formatRelative(now - 10_000, now, labels),
  formatRelative(now - 12 * 60_000, now, labels),
  formatRelative(now - 2 * 3_600_000, now, labels),
  formatRelative(new Date(2026, 9, 1, 20).getTime(), now, labels),
  formatRelative(new Date(2026, 8, 28).getTime(), now, labels),
  formatRelative(new Date(2026, 7, 28).getTime(), now, labels),
  formatRelative(new Date(2025, 8, 28).getTime(), now, labels),
];

describe("formatRelative", () => {
  it("speaks French by default", () => {
    expect(cases(fr.dates)).toEqual(["à l'instant", "il y a 12 min", "il y a 2 h", "hier", "lun.", "28 août", "28 sept. 2025"]);
  });

  it("speaks English (DESIGN.md §2.4)", () => {
    expect(cases(en.dates)).toEqual(["just now", "12 min ago", "2 h ago", "Yesterday", "Mon", "Aug 28", "Sep 28, 2025"]);
  });

  it("formats local ISO dates", () => {
    expect(isoLocal(now)).toMatch(/^2026-10-02T15:00:00[+-]\d\d:\d\d$/);
  });
});

describe("fileStamp", () => {
  it("is local, zero-padded and sorts chronologically as text", () => {
    expect(fileStamp(new Date(2026, 0, 5, 9, 3, 7).getTime())).toBe("2026-01-05_09-03-07");
    expect(fileStamp(new Date(2026, 8, 30).getTime()) < fileStamp(new Date(2026, 9, 1).getTime())).toBe(true);
  });
});
