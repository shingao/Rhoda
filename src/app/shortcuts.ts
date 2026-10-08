import { useEffect } from "react";
import { chordKeys, chordProblem, chordSpec, formatChord, isStandardEditing, matchesChord, parseChord, resolveShortcuts, sameChord, scopesOverlap, type ChordProblem, type KeyChord, type KeyEventLike } from "../core/keys";
import type { Messages } from "../i18n";
import { getState, setState, updateSettings, useApp } from "./store";

/**
 * Every keyboard shortcut of the app, in one place, with its default keys.
 * Users change them in Settings › Shortcuts (`settings.shortcuts`, applied
 * live); components only refer to shortcut ids, so tooltips, menus and the
 * command palette always show the keys in force.
 *
 * Not listed on purpose: navigation keys fixed by accessibility conventions
 * (arrows, Home/End, Enter, Escape, Tab inside lists and menus) and the
 * editor's own text-editing keys (CodeMirror defaults).
 */
export const SHORTCUTS = {
  "palette.open": { keys: "Ctrl+P", scope: "global" },
  "note.new": { keys: "Ctrl+N", scope: "global" },
  "search.focus": { keys: "Ctrl+K", scope: "global" },
  "layout.toggleSidebar": { keys: "Ctrl+Backslash", scope: "global" },
  "layout.toggleList": { keys: "Ctrl+Shift+Backslash", scope: "global" },
  "note.trash": { keys: "Delete", scope: "list" },
  "outline.toggle": { keys: "Ctrl+Shift+O", scope: "global" },
  "find.open": { keys: "Ctrl+F", scope: "global" },
  "find.replace": { keys: "Ctrl+H", scope: "global" },
  "find.next": { keys: "Enter", scope: "find" },
  "find.previous": { keys: "Shift+Enter", scope: "find" },
  // Tasks [DESIGN §2.7]: the line's task (or every selected line's), from the keyboard.
  "task.toggle": { keys: "Ctrl+Shift+T", scope: "editor" },
  // Folding: no [ ] \ (AltGr on AZERTY); arrows and page keys are the same on every layout.
  "fold.section": { keys: "Ctrl+Shift+ArrowUp", scope: "editor" },
  "unfold.section": { keys: "Ctrl+Shift+ArrowDown", scope: "editor" },
  "fold.all": { keys: "Ctrl+Shift+PageUp", scope: "editor" },
  "unfold.all": { keys: "Ctrl+Shift+PageDown", scope: "editor" },
  "section.isolate": { keys: "Ctrl+Shift+Enter", scope: "editor" },
  // Alignment of the blocks of the selection: digits by physical key (AZERTY: no Shift needed to reach them).
  "align.left": { keys: "Ctrl+Shift+Digit1", scope: "editor" },
  "align.center": { keys: "Ctrl+Shift+Digit2", scope: "editor" },
  "align.right": { keys: "Ctrl+Shift+Digit3", scope: "editor" },
  "align.justify": { keys: "Ctrl+Shift+Digit4", scope: "editor" },
  // Physical key: the key right of M on QWERTY (it prints ";" on AZERTY, shown as such).
  "settings.open": { keys: "Ctrl+Comma", scope: "global" },
  // Maquette 03: Ctrl Maj F or F11; Escape also leaves it (see App).
  "focus.toggle": { keys: "Ctrl+Shift+F", scope: "global" },
  "focus.toggleKey": { keys: "F11", scope: "global" },
  // Next / previous zone: titlebar, sidebar, list, editor, outline [DESIGN §5].
  "zone.next": { keys: "F6", scope: "global" },
  "zone.previous": { keys: "Shift+F6", scope: "global" },
  // Sticker drawer [DESIGN §10].
  "stickers.drawer": { keys: "Ctrl+Shift+S", scope: "global" },
  // "Hide stickers" of the open note.
  "stickers.hide": { keys: "Ctrl+Shift+H", scope: "global" },
  // Export dialog of the open note [DESIGN §2.17].
  "export.open": { keys: "Ctrl+Shift+E", scope: "global" },
} as const satisfies Record<string, { keys: string; scope: ShortcutScope }>;

/** "editor" shortcuts run inside CodeMirror; "list" and "find" where those have focus. */
export type ShortcutScope = "global" | "list" | "editor" | "find";
export type ShortcutId = keyof typeof SHORTCUTS;
export const SHORTCUT_IDS = Object.keys(SHORTCUTS) as ShortcutId[];

/** Scopes where a key alone (Delete, Enter) is allowed: they have no text to type into. */
export const plainKeysAllowed = (scope: string) => scope === "list" || scope === "find";

let chords = resolveShortcuts(SHORTCUTS, {}, plainKeysAllowed);
/** The user's keyboard layout (code → printed character), when the browser tells it. */
let layout: ReadonlyMap<string, string> | undefined;

/** The keys of a shortcut now (null: none). */
export function shortcutChord(id: ShortcutId): KeyChord | null {
  return chords[id];
}

/** The shortcut of `scope` triggered by this key event, if any. */
export function matchShortcut(e: KeyEventLike, scope: ShortcutScope): ShortcutId | null {
  for (const id of SHORTCUT_IDS) {
    const chord = chords[id];
    if (chord && SHORTCUTS[id].scope === scope && matchesChord(chord, e)) return id;
  }
  return null;
}

/** Label shown in tooltips and menus, e.g. "Ctrl Maj \" ("" when the shortcut was removed). */
export function shortcutLabel(id: ShortcutId, messages: Messages): string {
  const chord = chords[id];
  return chord ? formatChord(chord, messages.keys, layout) : "";
}

/** One label per key, for `kbd` chips (palette, settings). */
export function shortcutKeys(id: ShortcutId, messages: Messages): string[] {
  const chord = chords[id];
  return chord ? chordKeys(chord, messages.keys, layout) : [];
}

/** Keys of a chord being recorded, as chips. */
export function chordLabels(chord: KeyChord, messages: Messages): string[] {
  return chordKeys(chord, messages.keys, layout);
}

/** Whether the keys in force differ from the default ones. */
export function isCustomized(id: ShortcutId): boolean {
  const chord = chords[id];
  return chord === null || !sameChord(chord, parseChord(SHORTCUTS[id].keys));
}

/** Default keys of a shortcut. */
export const defaultChord = (id: ShortcutId): KeyChord => parseChord(SHORTCUTS[id].keys);

function apply(overrides: Record<string, string>): void {
  chords = resolveShortcuts(SHORTCUTS, overrides, plainKeysAllowed);
  // Components showing shortcuts re-render (see `useT`).
  setState((s) => ({ shortcutsVersion: s.shortcutsVersion + 1 }));
}

/** Applies the user's shortcuts now and whenever the settings change; reads the keyboard layout. */
export function connectShortcuts(): void {
  apply(getState().settings.shortcuts);
  useApp.subscribe((state, previous) => {
    if (state.settings.shortcuts !== previous.settings.shortcuts) apply(state.settings.shortcuts);
  });
  const keyboard = (navigator as Navigator & { keyboard?: { getLayoutMap?: () => Promise<ReadonlyMap<string, string>> } }).keyboard;
  void keyboard
    ?.getLayoutMap?.()
    .then((map) => {
      layout = map;
      setState((s) => ({ shortcutsVersion: s.shortcutsVersion + 1 }));
    })
    .catch(() => undefined);
}

/** What giving `chord` to `id` would mean (Settings › Shortcuts). */
export type ShortcutCheck =
  | { kind: "ok" }
  | { kind: "problem"; problem: ChordProblem }
  /** Already the keys of `other`: replace it (it loses its shortcut) or cancel. */
  | { kind: "conflict"; other: ShortcutId }
  /** Ctrl+C, Ctrl+Z…: allowed after a warning. */
  | { kind: "standard" };

export function checkShortcut(id: ShortcutId, chord: KeyChord, pressed?: KeyEventLike & { altGraph?: boolean }): ShortcutCheck {
  const problem = chordProblem(chord, plainKeysAllowed(SHORTCUTS[id].scope), pressed);
  if (problem) return { kind: "problem", problem };
  const other = SHORTCUT_IDS.find((o) => o !== id && chords[o] && sameChord(chords[o]!, chord) && scopesOverlap(SHORTCUTS[o].scope, SHORTCUTS[id].scope));
  if (other) return { kind: "conflict", other };
  if (isStandardEditing(chord)) return { kind: "standard" };
  return { kind: "ok" };
}

/**
 * Gives `chord` to `id` (null: no shortcut); `displaced` loses its own. Only
 * differences from the defaults are stored.
 */
export function setShortcut(id: ShortcutId, chord: KeyChord | null, displaced?: ShortcutId): void {
  updateSettings((s) => {
    const next = { ...s.shortcuts };
    if (chord && sameChord(chord, defaultChord(id))) delete next[id];
    else next[id] = chord ? chordSpec(chord) : "";
    if (displaced) next[displaced] = "";
    return { ...s, shortcuts: next };
  });
}

/** "Reset": the default keys back, unless another shortcut uses them now (returned, to ask). */
export function resetShortcut(id: ShortcutId, force = false): ShortcutId | null {
  const def = defaultChord(id);
  const other = SHORTCUT_IDS.find((o) => o !== id && chords[o] && sameChord(chords[o]!, def) && scopesOverlap(SHORTCUTS[o].scope, SHORTCUTS[id].scope));
  if (other && !force) return other;
  setShortcut(id, def, other);
  return null;
}

export function resetAllShortcuts(): void {
  updateSettings((s) => ({ ...s, shortcuts: {} }));
}

export type ShortcutHandlers = Partial<Record<ShortcutId, () => void>>;

/** Runs the global shortcuts (capture phase, so they work from inside the editor too). */
export function useGlobalShortcuts(handlers: ShortcutHandlers): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Recording a shortcut in the settings: keys are not commands.
      if (getState().recordingShortcut) return;
      const id = matchShortcut(e, "global");
      const run = id && handlers[id];
      if (!run) return;
      e.preventDefault();
      e.stopPropagation();
      run();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [handlers]);
}
