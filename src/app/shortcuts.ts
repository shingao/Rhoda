import { useEffect } from "react";
import { formatChord, matchesChord, parseChord, type KeyChord, type KeyEventLike } from "../core/keys";
import type { Messages } from "../i18n";

/**
 * Every keyboard shortcut of the app, in one place. Phase 10 will let users
 * override `keys` from the settings; components only refer to shortcut ids.
 *
 * Not listed on purpose: navigation keys fixed by accessibility conventions
 * (arrows, Home/End, Enter, Escape, Tab inside lists and menus) and the
 * editor's own text-editing keys (CodeMirror defaults).
 */
export const SHORTCUTS = {
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
  // Folding: no [ ] \ (AltGr on AZERTY); arrows and page keys are the same on every layout.
  "fold.section": { keys: "Ctrl+Shift+ArrowUp", scope: "editor" },
  "unfold.section": { keys: "Ctrl+Shift+ArrowDown", scope: "editor" },
  "fold.all": { keys: "Ctrl+Shift+PageUp", scope: "editor" },
  "unfold.all": { keys: "Ctrl+Shift+PageDown", scope: "editor" },
  "section.isolate": { keys: "Ctrl+Shift+Enter", scope: "editor" },
  // Physical key: "," is the same key on AZERTY and QWERTY.
  "settings.open": { keys: "Ctrl+Comma", scope: "global" },
  // Maquette 03: Ctrl Maj F or F11; Escape also leaves it (see App).
  "focus.toggle": { keys: "Ctrl+Shift+F", scope: "global" },
  "focus.toggleKey": { keys: "F11", scope: "global" },
  // Sticker drawer [DESIGN §10]; S is the same key on AZERTY and QWERTY.
  "stickers.drawer": { keys: "Ctrl+Shift+S", scope: "global" },
} as const satisfies Record<string, { keys: string; scope: ShortcutScope }>;

/** "editor" shortcuts run inside CodeMirror (see `editorKey`). */
export type ShortcutScope = "global" | "list" | "editor" | "find";
export type ShortcutId = keyof typeof SHORTCUTS;

const chords = Object.fromEntries(
  Object.entries(SHORTCUTS).map(([id, def]) => [id, parseChord(def.keys)]),
) as Record<ShortcutId, KeyChord>;

/** The shortcut of `scope` triggered by this key event, if any. */
export function matchShortcut(e: KeyEventLike, scope: ShortcutScope): ShortcutId | null {
  for (const id of Object.keys(SHORTCUTS) as ShortcutId[]) {
    if (SHORTCUTS[id].scope === scope && matchesChord(chords[id], e)) return id;
  }
  return null;
}

/** Label shown in tooltips and menus, e.g. "Ctrl Maj \". */
export function shortcutLabel(id: ShortcutId, messages: Messages): string {
  return formatChord(chords[id], messages.keys);
}

/** CodeMirror key name of an editor shortcut, e.g. "Ctrl-Shift-ArrowUp". */
export function editorKey(id: ShortcutId): string {
  const c = chords[id];
  return [c.ctrl && "Ctrl", c.shift && "Shift", c.alt && "Alt", c.key].filter(Boolean).join("-");
}

export type ShortcutHandlers = Partial<Record<ShortcutId, () => void>>;

/** Runs the global shortcuts (capture phase, so they work from inside the editor too). */
export function useGlobalShortcuts(handlers: ShortcutHandlers): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
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
