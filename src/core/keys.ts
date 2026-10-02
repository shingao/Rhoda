/** Keyboard chords: parsing ("Ctrl+Shift+Backslash"), matching and display. */

export interface KeyChord {
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  /** A single character ("n"), a key name ("Delete", "F2") or a physical code token ("Backslash"). */
  key: string;
}

/** Event fields needed for matching (a subset of KeyboardEvent). */
export type KeyEventLike = Pick<KeyboardEvent, "key" | "code" | "ctrlKey" | "shiftKey" | "altKey" | "metaKey">;

/**
 * Punctuation keys are matched by physical position (`KeyboardEvent.code`):
 * on AZERTY "\" needs AltGr, so Ctrl+\ is the key at the US "\" position.
 */
const PHYSICAL_KEYS = new Set(["Backslash", "BracketLeft", "BracketRight", "Slash", "Period", "Comma", "Semicolon", "Quote", "Backquote", "Minus", "Equal"]);

export function parseChord(spec: string): KeyChord {
  const parts = spec.split("+").map((p) => p.trim());
  const key = parts.pop();
  if (!key) throw new Error(`Invalid shortcut: ${spec}`);
  const mods = new Set(parts.map((p) => p.toLowerCase()));
  for (const m of mods) if (!["ctrl", "shift", "alt"].includes(m)) throw new Error(`Unknown modifier "${m}" in ${spec}`);
  return { ctrl: mods.has("ctrl"), shift: mods.has("shift"), alt: mods.has("alt"), key: key.length === 1 ? key.toLowerCase() : key };
}

export function matchesChord(chord: KeyChord, e: KeyEventLike): boolean {
  if (e.metaKey || e.ctrlKey !== chord.ctrl || e.shiftKey !== chord.shift || e.altKey !== chord.alt) return false;
  if (PHYSICAL_KEYS.has(chord.key)) return e.code === chord.key;
  if (chord.key.length === 1) return e.key.toLowerCase() === chord.key;
  return e.key === chord.key;
}

/** Display form, e.g. "Ctrl Maj \" — key names come from the active language. */
export function formatChord(chord: KeyChord, names: Record<string, string>): string {
  const parts: string[] = [];
  if (chord.ctrl) parts.push(names.Ctrl ?? "Ctrl");
  if (chord.shift) parts.push(names.Shift ?? "Shift");
  if (chord.alt) parts.push(names.Alt ?? "Alt");
  parts.push(names[chord.key] ?? (chord.key.length === 1 ? chord.key.toUpperCase() : chord.key));
  return parts.join(" ");
}
