import { describe, expect, it } from "vitest";
import { formatChord, matchesChord, parseChord, type KeyEventLike } from "./keys";

const ev = (over: Partial<KeyEventLike>): KeyEventLike => ({
  key: "",
  code: "",
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  metaKey: false,
  ...over,
});

describe("keys", () => {
  it("parses chords", () => {
    expect(parseChord("Ctrl+Shift+Backslash")).toEqual({ ctrl: true, shift: true, alt: false, key: "Backslash" });
    expect(parseChord("Ctrl+N")).toEqual({ ctrl: true, shift: false, alt: false, key: "n" });
    expect(() => parseChord("Hyper+N")).toThrow();
  });

  it("matches letters by character (works on AZERTY)", () => {
    const newNote = parseChord("Ctrl+N");
    expect(matchesChord(newNote, ev({ key: "n", code: "KeyN", ctrlKey: true }))).toBe(true);
    expect(matchesChord(newNote, ev({ key: "N", code: "KeyN", ctrlKey: true, shiftKey: true }))).toBe(false);
    // AZERTY: "q" sits on the QWERTY "a" key.
    expect(matchesChord(parseChord("Ctrl+Q"), ev({ key: "q", code: "KeyA", ctrlKey: true }))).toBe(true);
  });

  it("matches punctuation by physical key", () => {
    const sidebar = parseChord("Ctrl+Backslash");
    // AZERTY: the key left of Enter types "*" but has code Backslash.
    expect(matchesChord(sidebar, ev({ key: "*", code: "Backslash", ctrlKey: true }))).toBe(true);
    expect(matchesChord(sidebar, ev({ key: "\\", code: "Digit8", ctrlKey: true, altKey: true }))).toBe(false);
  });

  it("formats with localized key names", () => {
    const names = { Ctrl: "Ctrl", Shift: "Maj", Backslash: "\\", Delete: "Suppr" };
    expect(formatChord(parseChord("Ctrl+Shift+Backslash"), names)).toBe("Ctrl Maj \\");
    expect(formatChord(parseChord("Delete"), names)).toBe("Suppr");
    expect(formatChord(parseChord("Ctrl+K"), {})).toBe("Ctrl K");
  });
});
