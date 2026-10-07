/**
 * Keyboard chords: parsing ("Ctrl+Shift+Backslash"), matching, display, and
 * the rules for a chord the user records in Settings › Shortcuts.
 */

export interface KeyChord {
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  /**
   * A letter ("n", matched by character, so it follows the layout), a physical
   * key code ("Digit1", "Comma", "Backslash": same place on every layout) or a
   * key name ("Delete", "F2", "ArrowUp").
   */
  key: string;
}

/** Event fields needed for matching (a subset of KeyboardEvent). */
export type KeyEventLike = Pick<KeyboardEvent, "key" | "code" | "ctrlKey" | "shiftKey" | "altKey" | "metaKey">;

/**
 * Keys matched by physical position (`KeyboardEvent.code`): digits and
 * punctuation type different characters per layout (AZERTY "1" needs Shift,
 * "\" needs AltGr), the key itself is always there.
 */
const PHYSICAL = /^(Digit\d|Backslash|BracketLeft|BracketRight|Slash|Period|Comma|Semicolon|Quote|Backquote|Minus|Equal|IntlBackslash)$/;

/** Named keys a chord may use (besides letters and physical keys). */
const NAMED = /^(F([1-9]|1\d|2[0-4])|Enter|Delete|Backspace|Insert|Home|End|PageUp|PageDown|ArrowUp|ArrowDown|ArrowLeft|ArrowRight|Escape|Tab|Space)$/;

export function parseChord(spec: string): KeyChord {
  const parts = spec.split("+").map((p) => p.trim());
  const key = parts.pop();
  if (!key) throw new Error(`Invalid shortcut: ${spec}`);
  const mods = new Set(parts.map((p) => p.toLowerCase()));
  for (const m of mods) if (!["ctrl", "shift", "alt"].includes(m)) throw new Error(`Unknown modifier "${m}" in ${spec}`);
  const normalized = /^[a-z]$/i.test(key) ? key.toLowerCase() : key;
  if (!/^[a-z]$/.test(normalized) && !PHYSICAL.test(normalized) && !NAMED.test(normalized)) throw new Error(`Unknown key "${key}" in ${spec}`);
  return { ctrl: mods.has("ctrl"), shift: mods.has("shift"), alt: mods.has("alt"), key: normalized };
}

/** Stored form, e.g. "Ctrl+Shift+E" (what `parseChord` reads back). */
export function chordSpec(chord: KeyChord): string {
  const key = /^[a-z]$/.test(chord.key) ? chord.key.toUpperCase() : chord.key;
  return [chord.ctrl && "Ctrl", chord.shift && "Shift", chord.alt && "Alt", key].filter(Boolean).join("+");
}

export const sameChord = (a: KeyChord, b: KeyChord) => a.ctrl === b.ctrl && a.shift === b.shift && a.alt === b.alt && a.key === b.key;

export function matchesChord(chord: KeyChord, e: KeyEventLike): boolean {
  if (e.metaKey || e.ctrlKey !== chord.ctrl || e.shiftKey !== chord.shift || e.altKey !== chord.alt) return false;
  if (PHYSICAL.test(chord.key)) return e.code === chord.key;
  if (chord.key.length === 1) return e.key.toLowerCase() === chord.key;
  if (chord.key === "Space") return e.key === " ";
  return e.key === chord.key;
}

/** What the user pressed, as a chord to record; null while only modifiers are down. */
export function chordFromEvent(e: KeyEventLike): KeyChord | null {
  if (["Control", "Shift", "Alt", "AltGraph", "Meta", "OS", "CapsLock", "Dead", "Unidentified"].includes(e.key)) return null;
  const mods = { ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey };
  // A plain Latin letter: kept as a letter, so the shortcut follows the layout (Ctrl+A where the A is).
  if (/^[a-z]$/i.test(e.key) && /^Key[A-Z]$/.test(e.code)) return { ...mods, key: e.key.toLowerCase() };
  if (PHYSICAL.test(e.code)) return { ...mods, key: e.code };
  // A letter key typing something else (AltGr+E → €, a dead key): its position.
  if (/^Key[A-Z]$/.test(e.code)) return { ...mods, key: e.code.slice(3).toLowerCase() };
  if (e.key === " ") return { ...mods, key: "Space" };
  if (NAMED.test(e.key)) return { ...mods, key: e.key };
  return null;
}

/**
 * Ctrl+Alt is AltGr on Windows: on a French AZERTY keyboard these keys type a
 * character with it (2 ~, 3 #, 4 {, 5 [, 6 |, 7 `, 8 \, 9 ^, 0 @, ) ], = }, E €, $ ¤).
 */
const ALTGR_AZERTY = new Set(["Digit2", "Digit3", "Digit4", "Digit5", "Digit6", "Digit7", "Digit8", "Digit9", "Digit0", "Minus", "Equal", "BracketRight", "e"]);

/** Taken by Windows: they never reach the app (or must not be overridden). */
const SYSTEM = ["Alt+F4", "Alt+Tab", "Alt+Shift+Tab", "Alt+Escape", "Ctrl+Escape", "Alt+Space", "Ctrl+Alt+Delete", "Ctrl+Shift+Escape", "Ctrl+Alt+Tab", "Alt+Enter"].map(parseChord);

/** Editing shortcuts every Windows user knows: allowed, after a warning. */
const STANDARD_EDITING = ["Ctrl+C", "Ctrl+V", "Ctrl+X", "Ctrl+Z", "Ctrl+Y", "Ctrl+A", "Ctrl+S", "Ctrl+Shift+Z"].map(parseChord);

/** Keys that move through lists and fields: never alone. */
const NAVIGATION = /^(Tab|Escape|ArrowUp|ArrowDown|ArrowLeft|ArrowRight|Home|End|PageUp|PageDown|Backspace|Space)$/;

export type ChordProblem =
  /** Ctrl+Alt+a key that AltGr turns into a character (AZERTY). */
  | "altgr"
  /** Windows' own shortcuts, or the Windows key. */
  | "system"
  /** A key that would type text or break navigation without Ctrl or Alt. */
  | "needsModifier";

/**
 * Whether a chord may be used. `plainKeys`: the scope accepts a key alone
 * (lists, find field: Delete, Enter, F-keys), not a typing area.
 * `pressed`: the event, when recording (AltGr seen live on any layout).
 */
export function chordProblem(chord: KeyChord, plainKeys: boolean, pressed?: KeyEventLike & { altGraph?: boolean }): ChordProblem | null {
  if (pressed?.metaKey || SYSTEM.some((s) => sameChord(s, chord))) return "system";
  if (chord.ctrl && chord.alt) {
    if (ALTGR_AZERTY.has(chord.key)) return "altgr";
    // Any layout: the key typed a character other than its own letter or digit.
    if (pressed && (pressed.altGraph || (pressed.key.length === 1 && !/^[a-z0-9]$/i.test(pressed.key)))) return "altgr";
  }
  const modified = chord.ctrl || chord.alt;
  const fKey = /^F\d+$/.test(chord.key);
  if (!modified && !fKey) {
    if (!plainKeys) return "needsModifier";
    // Lists and fields: only keys that type nothing and move nowhere.
    if (chord.key.length === 1 || PHYSICAL.test(chord.key) || NAVIGATION.test(chord.key)) return "needsModifier";
  }
  return null;
}

/** Replacing Ctrl+C, Ctrl+Z…: asks first. */
export const isStandardEditing = (chord: KeyChord) => STANDARD_EDITING.some((s) => sameChord(s, chord));

/** Display names of physical keys on a US layout (used when the real layout is unknown). */
const US_KEYS: Record<string, string> = {
  Backslash: "\\",
  BracketLeft: "[",
  BracketRight: "]",
  Slash: "/",
  Period: ".",
  Comma: ",",
  Semicolon: ";",
  Quote: "'",
  Backquote: "`",
  Minus: "-",
  Equal: "=",
  IntlBackslash: "<",
};

/**
 * One label per key, e.g. ["Ctrl", "Maj", "E"]: modifier and key names from
 * the active language, physical keys as the user's layout prints them
 * (`layout`: code → character, from the browser's keyboard map).
 */
export function chordKeys(chord: KeyChord, names: Record<string, string>, layout?: ReadonlyMap<string, string>): string[] {
  const parts: string[] = [];
  if (chord.ctrl) parts.push(names.Ctrl ?? "Ctrl");
  if (chord.shift) parts.push(names.Shift ?? "Shift");
  if (chord.alt) parts.push(names.Alt ?? "Alt");
  const k = chord.key;
  let label: string;
  if (names[k]) label = names[k];
  else if (k.length === 1) label = k.toUpperCase();
  else if (PHYSICAL.test(k)) label = (layout?.get(k) ?? (k.startsWith("Digit") ? k.slice(5) : US_KEYS[k]) ?? k).toUpperCase();
  else label = k;
  parts.push(label);
  return parts;
}

/** Display form, e.g. "Ctrl Maj \". */
export function formatChord(chord: KeyChord, names: Record<string, string>, layout?: ReadonlyMap<string, string>): string {
  return chordKeys(chord, names, layout).join(" ");
}

/** Scopes where a key is handled: a chord must be unique where scopes meet. */
export function scopesOverlap(a: string, b: string): boolean {
  return a === b || a === "global" || b === "global";
}

export interface ShortcutDef {
  keys: string;
  scope: string;
}

/**
 * Chords in force: the defaults with the user's changes (`""` = no shortcut).
 * A change that cannot be read, is not allowed, or collides with another
 * shortcut of an overlapping scope is ignored (the default stays): settings
 * edited by hand never break the keyboard.
 */
export function resolveShortcuts<Id extends string>(
  defaults: Readonly<Record<Id, ShortcutDef>>,
  overrides: Readonly<Record<string, unknown>>,
  plainKeys: (scope: string) => boolean,
): Record<Id, KeyChord | null> {
  const ids = Object.keys(defaults) as Id[];
  const base = Object.fromEntries(ids.map((id) => [id, parseChord(defaults[id].keys)])) as Record<Id, KeyChord | null>;
  const wanted = new Map<Id, KeyChord | null>();
  for (const id of ids) {
    const value = overrides[id];
    if (value === "") wanted.set(id, null);
    else if (typeof value === "string") {
      try {
        const chord = parseChord(value);
        if (!chordProblem(chord, plainKeys(defaults[id].scope))) wanted.set(id, chord);
      } catch {
        // Unreadable: the default stays.
      }
    }
  }
  // Drop changes that collide, until none does.
  for (;;) {
    const current = { ...base };
    for (const [id, chord] of wanted) current[id] = chord;
    const clash = ids.find((a) =>
      ids.some((b) => a !== b && current[a] && current[b] && sameChord(current[a]!, current[b]!) && scopesOverlap(defaults[a].scope, defaults[b].scope)),
    );
    if (!clash) return current;
    const partner = ids.find((b) => b !== clash && current[b] && sameChord(current[clash]!, current[b]!) && scopesOverlap(defaults[clash].scope, defaults[b].scope))!;
    // The changed one goes (if both changed, the second).
    const drop = wanted.has(partner) ? partner : wanted.has(clash) ? clash : partner;
    if (!wanted.has(drop)) return current;
    wanted.delete(drop);
  }
}
