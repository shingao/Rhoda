import { describe, expect, it } from "vitest";
import { chordFromEvent, chordKeys, chordProblem, chordSpec, formatChord, isStandardEditing, matchesChord, parseChord, resolveShortcuts, type KeyEventLike } from "./keys";

const ev = (over: Partial<KeyEventLike>): KeyEventLike => ({
  key: "",
  code: "",
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  metaKey: false,
  ...over,
});

/**
 * Events as a French AZERTY keyboard sends them under Windows (key, code).
 * AltGr arrives as Ctrl+Alt with the character it types.
 */
const AZERTY = {
  ctrlA: ev({ key: "a", code: "KeyQ", ctrlKey: true }),
  ctrl1: ev({ key: "&", code: "Digit1", ctrlKey: true }),
  ctrlShift1: ev({ key: "1", code: "Digit1", ctrlKey: true, shiftKey: true }),
  altGrE: ev({ key: "€", code: "KeyE", ctrlKey: true, altKey: true }),
  altGr2: ev({ key: "~", code: "Digit2", ctrlKey: true, altKey: true }),
  altGr0: ev({ key: "@", code: "Digit0", ctrlKey: true, altKey: true }),
  altGrParen: ev({ key: "]", code: "Minus", ctrlKey: true, altKey: true }),
  altGrEqual: ev({ key: "}", code: "Equal", ctrlKey: true, altKey: true }),
  ctrlAltP: ev({ key: "p", code: "KeyP", ctrlKey: true, altKey: true }),
  ctrlAltF5: ev({ key: "F5", code: "F5", ctrlKey: true, altKey: true }),
  ctrlComma: ev({ key: ",", code: "KeyM", ctrlKey: true }),
  ctrlSemicolonKey: ev({ key: ";", code: "Comma", ctrlKey: true }),
  ctrlShiftT: ev({ key: "T", code: "KeyT", ctrlKey: true, shiftKey: true }),
};

describe("keys", () => {
  it("parses chords and writes them back", () => {
    expect(parseChord("Ctrl+Shift+Backslash")).toEqual({ ctrl: true, shift: true, alt: false, key: "Backslash" });
    expect(parseChord("Ctrl+N")).toEqual({ ctrl: true, shift: false, alt: false, key: "n" });
    expect(chordSpec(parseChord("ctrl+shift+e"))).toBe("Ctrl+Shift+E");
    expect(chordSpec(parseChord("Ctrl+Alt+Digit1"))).toBe("Ctrl+Alt+Digit1");
    expect(() => parseChord("Hyper+N")).toThrow();
    expect(() => parseChord("Ctrl+€")).toThrow();
    expect(() => parseChord("")).toThrow();
  });

  it("matches letters by character (works on AZERTY)", () => {
    const newNote = parseChord("Ctrl+N");
    expect(matchesChord(newNote, ev({ key: "n", code: "KeyN", ctrlKey: true }))).toBe(true);
    expect(matchesChord(newNote, ev({ key: "N", code: "KeyN", ctrlKey: true, shiftKey: true }))).toBe(false);
    // AZERTY: "q" sits on the QWERTY "a" key.
    expect(matchesChord(parseChord("Ctrl+Q"), ev({ key: "q", code: "KeyA", ctrlKey: true }))).toBe(true);
  });

  it("matches digits and punctuation by physical key", () => {
    const sidebar = parseChord("Ctrl+Backslash");
    // AZERTY: the key left of Enter types "*" but has code Backslash.
    expect(matchesChord(sidebar, ev({ key: "*", code: "Backslash", ctrlKey: true }))).toBe(true);
    expect(matchesChord(sidebar, ev({ key: "\\", code: "Digit8", ctrlKey: true, altKey: true }))).toBe(false);
    // AZERTY "1" is Shift+& : Ctrl+1 is the key, whatever it types.
    expect(matchesChord(parseChord("Ctrl+Digit1"), AZERTY.ctrl1)).toBe(true);
  });

  it("records what is pressed on AZERTY", () => {
    expect(chordFromEvent(AZERTY.ctrlA)).toEqual(parseChord("Ctrl+A"));
    expect(chordFromEvent(AZERTY.ctrl1)).toEqual(parseChord("Ctrl+Digit1"));
    expect(chordFromEvent(AZERTY.ctrlShift1)).toEqual(parseChord("Ctrl+Shift+Digit1"));
    expect(chordFromEvent(AZERTY.ctrlShiftT)).toEqual(parseChord("Ctrl+Shift+T"));
    expect(chordFromEvent(AZERTY.altGrE)).toEqual(parseChord("Ctrl+Alt+E"));
    expect(chordFromEvent(ev({ key: "Control", code: "ControlLeft", ctrlKey: true }))).toBeNull();
    expect(chordFromEvent(ev({ key: "AltGraph", code: "AltRight", ctrlKey: true, altKey: true }))).toBeNull();
    expect(chordFromEvent(ev({ key: "F11", code: "F11" }))).toEqual(parseChord("F11"));
  });

  it("refuses every Ctrl+Alt that types a character with AltGr on AZERTY", () => {
    for (const e of [AZERTY.altGrE, AZERTY.altGr2, AZERTY.altGr0, AZERTY.altGrParen, AZERTY.altGrEqual]) {
      const chord = chordFromEvent(e)!;
      expect(chordProblem(chord, false, e), chordSpec(chord)).toBe("altgr");
      // Also when read back from the settings, without the event.
      expect(chordProblem(chord, false), chordSpec(chord)).toBe("altgr");
    }
    for (const n of [2, 3, 4, 5, 6, 7, 8, 9, 0]) expect(chordProblem(parseChord(`Ctrl+Alt+Digit${n}`), false)).toBe("altgr");
    // Ctrl+Alt+P types nothing on AZERTY; Ctrl+Alt+F5 neither.
    expect(chordProblem(chordFromEvent(AZERTY.ctrlAltP)!, false, AZERTY.ctrlAltP)).toBeNull();
    expect(chordProblem(chordFromEvent(AZERTY.ctrlAltF5)!, false, AZERTY.ctrlAltF5)).toBeNull();
    // Another layout's AltGr character, seen live.
    const altGrQ = ev({ key: "@", code: "KeyQ", ctrlKey: true, altKey: true });
    expect(chordProblem(chordFromEvent(altGrQ)!, false, altGrQ)).toBe("altgr");
  });

  it("refuses Windows shortcuts and lone typing keys", () => {
    expect(chordProblem(parseChord("Alt+F4"), false)).toBe("system");
    expect(chordProblem(parseChord("Alt+Tab"), false)).toBe("system");
    expect(chordProblem(parseChord("Ctrl+Escape"), false)).toBe("system");
    const win = ev({ key: "e", code: "KeyE", metaKey: true });
    expect(chordProblem(chordFromEvent(win)!, false, win)).toBe("system");
    expect(chordProblem(parseChord("N"), false)).toBe("needsModifier");
    expect(chordProblem(parseChord("Shift+N"), false)).toBe("needsModifier");
    expect(chordProblem(parseChord("Delete"), false)).toBe("needsModifier");
    expect(chordProblem(parseChord("F11"), false)).toBeNull();
    // In the list: Delete alone is fine, a letter or an arrow is not.
    expect(chordProblem(parseChord("Delete"), true)).toBeNull();
    expect(chordProblem(parseChord("N"), true)).toBe("needsModifier");
    expect(chordProblem(parseChord("ArrowDown"), true)).toBe("needsModifier");
  });

  it("knows the standard editing shortcuts", () => {
    expect(isStandardEditing(parseChord("Ctrl+C"))).toBe(true);
    expect(isStandardEditing(parseChord("Ctrl+S"))).toBe(true);
    expect(isStandardEditing(parseChord("Ctrl+Shift+C"))).toBe(false);
  });

  it("formats with localized key names and the user's layout", () => {
    const names = { Ctrl: "Ctrl", Shift: "Maj", Backslash: "\\", Delete: "Suppr" };
    expect(formatChord(parseChord("Ctrl+Shift+Backslash"), names)).toBe("Ctrl Maj \\");
    expect(formatChord(parseChord("Delete"), names)).toBe("Suppr");
    expect(formatChord(parseChord("Ctrl+K"), {})).toBe("Ctrl K");
    expect(chordKeys(parseChord("Ctrl+Digit1"), names)).toEqual(["Ctrl", "1"]);
    // AZERTY: the physical "Comma" key prints ";".
    const azerty = new Map([["Comma", ";"], ["Digit1", "&"]]);
    expect(chordKeys(chordFromEvent(AZERTY.ctrlSemicolonKey)!, names, azerty)).toEqual(["Ctrl", ";"]);
  });

  it("resolves the user's shortcuts, ignoring bad values", () => {
    const defaults = {
      a: { keys: "Ctrl+N", scope: "global" },
      b: { keys: "Ctrl+K", scope: "global" },
      c: { keys: "Ctrl+Shift+ArrowUp", scope: "editor" },
      d: { keys: "Delete", scope: "list" },
    };
    const plain = (scope: string) => scope === "list";
    const resolve = (o: Record<string, unknown>) => {
      const r = resolveShortcuts(defaults, o, plain);
      return Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v ? chordSpec(v) : null]));
    };
    expect(resolve({})).toEqual({ a: "Ctrl+N", b: "Ctrl+K", c: "Ctrl+Shift+ArrowUp", d: "Delete" });
    // Changed, removed, swapped.
    expect(resolve({ a: "Ctrl+Shift+N", d: "" })).toMatchObject({ a: "Ctrl+Shift+N", d: null });
    expect(resolve({ a: "Ctrl+K", b: "Ctrl+N" })).toMatchObject({ a: "Ctrl+K", b: "Ctrl+N" });
    // Unreadable, forbidden, of the wrong type, unknown: ignored.
    expect(resolve({ a: "Ctrl+€", b: "Ctrl+Alt+E", c: 42, zzz: "Ctrl+J" })).toEqual(resolve({}));
    // A collision: the change goes, the other keeps its shortcut.
    expect(resolve({ a: "Ctrl+K" })).toMatchObject({ a: "Ctrl+N", b: "Ctrl+K" });
    // Scopes that never meet may share a chord.
    expect(resolve({ d: "Ctrl+Shift+ArrowUp" })).toMatchObject({ c: "Ctrl+Shift+ArrowUp", d: "Ctrl+Shift+ArrowUp" });
  });
});
