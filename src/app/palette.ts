import { FileText, Hash, type LucideIcon } from "lucide-react";
import { formatTag } from "../core/tags";
import { fuzzyMatch } from "../core/search/fuzzy";
import { insertAtCursor } from "../editor/session";
import type { Messages } from "../i18n";
import { RECENT_COMMANDS } from "../services/settings";
import { COMMANDS, commandById, type AppCommand } from "./commandList";
import { noteIndex } from "./noteIndex";
import { revealNote, setFilter } from "./notes";
import { shortcutKeys } from "./shortcuts";
import { getState, setState, showToast, updateSettings } from "./store";

/**
 * Command palette (Ctrl+P) [DESIGN §2.16]: commands, notes and tags found by
 * fuzzy search (accents and case ignored). Recent commands first; ">" keeps
 * commands only, "#" tags only. A command that cannot run is shown greyed with
 * the reason.
 */

type Ranges = Array<[number, number]>;

export type PaletteItem =
  | { kind: "command"; key: string; label: string; icon: LucideIcon; keys: string[]; reason: string | null; ranges: Ranges }
  | { kind: "note"; key: string; label: string; icon: LucideIcon; meta: string; ranges: Ranges }
  | { kind: "tag"; key: string; label: string; icon: LucideIcon; meta: string; ranges: Ranges };

export interface PaletteGroup {
  id: "recent" | "commands" | "notes" | "tags";
  items: PaletteItem[];
}

/** Rows per group [§2.16]; ">" lists every command. */
const PER_GROUP = 8;

function commandItem(c: AppCommand, t: Messages, ranges: Ranges): PaletteItem {
  return { kind: "command", key: c.id, label: c.label(t), icon: c.icon, keys: c.shortcut ? shortcutKeys(c.shortcut, t) : [], reason: c.unavailable?.(t) ?? null, ranges };
}

const ranked = <T>(items: T[], text: (x: T) => string, query: string) =>
  items
    .map((x) => ({ x, m: fuzzyMatch(query, text(x)) }))
    .filter((r) => r.m !== null)
    .sort((a, b) => b.m!.score - a.m!.score);

export function paletteGroups(input: string, t: Messages): PaletteGroup[] {
  const commandsOnly = input.startsWith(">");
  const tagsOnly = input.startsWith("#");
  const query = commandsOnly || tagsOnly ? input.slice(1).trim() : input.trim();
  const groups: PaletteGroup[] = [];

  if (!tagsOnly) {
    const recent = getState().settings.palette.recent.map(commandById).filter((c): c is AppCommand => Boolean(c));
    if (!query) {
      if (recent.length) groups.push({ id: "recent", items: recent.map((c) => commandItem(c, t, [])) });
      const rest = COMMANDS.filter((c) => !recent.includes(c));
      groups.push({ id: "commands", items: rest.slice(0, commandsOnly ? rest.length : PER_GROUP).map((c) => commandItem(c, t, [])) });
    } else {
      // Recently used commands win ties.
      const boost = (c: AppCommand) => (recent.includes(c) ? 2 - recent.indexOf(c) / RECENT_COMMANDS : 0);
      const found = ranked([...COMMANDS], (c) => c.label(t), query).sort((a, b) => b.m!.score + boost(b.x) - (a.m!.score + boost(a.x)));
      groups.push({ id: "commands", items: found.slice(0, commandsOnly ? found.length : PER_GROUP).map((r) => commandItem(r.x, t, r.m!.ranges)) });
    }
  }
  if (commandsOnly || (!query && !tagsOnly)) return groups.filter((g) => g.items.length);

  const { notes } = getState();
  if (!tagsOnly) {
    const live = Object.values(notes).filter((n) => !n.trashed && n.title);
    groups.push({
      id: "notes",
      items: ranked(live, (n) => n.title, query)
        .slice(0, PER_GROUP)
        .map(({ x, m }) => ({ kind: "note", key: x.id, label: x.title, icon: FileText, meta: x.syntax?.tags[0] ? formatTag(x.syntax.tags[0].name) : "", ranges: m!.ranges })),
    });
  }
  const tags = [...noteIndex(notes).tags.byKey.values()];
  groups.push({
    id: "tags",
    items: ranked(tags, (n) => n.path, query)
      .slice(0, PER_GROUP)
      // The "#" is shown before the name; highlights are on the name.
      .map(({ x, m }) => ({ kind: "tag", key: x.key, label: x.path, icon: Hash, meta: t.palette.tagNotes(x.noteIds.size), ranges: m!.ranges })),
  });
  return groups.filter((g) => g.items.length);
}

export function openPalette(query = ""): void {
  setState({ palette: { query } });
}

export function closePalette(): void {
  setState({ palette: null });
}

/** Runs the chosen row; false when it cannot (a greyed command). */
export function runPaletteItem(item: PaletteItem): boolean {
  if (item.kind === "command") {
    const command = commandById(item.key);
    if (!command || item.reason) return false;
    updateSettings((s) => ({ ...s, palette: { recent: [command.id, ...s.palette.recent.filter((id) => id !== command.id)].slice(0, RECENT_COMMANDS) } }));
    closePalette();
    // After the palette gives the focus back, so the command can take it.
    setTimeout(command.run, 0);
    return true;
  }
  closePalette();
  if (item.kind === "note") setTimeout(() => revealNote(item.key), 0);
  else setTimeout(() => setFilter({ kind: "tag", key: item.key }), 0);
  return true;
}

/** Tab on a note: `[[Title]]` at the cursor of the open note. */
export function insertNoteLink(item: PaletteItem, t: Messages): boolean {
  const { selectedId } = getState();
  if (item.kind !== "note" || !selectedId) return false;
  closePalette();
  setTimeout(() => {
    if (insertAtCursor(selectedId, `[[${item.label}]]`)) showToast(t.palette.linkInserted(item.label));
  }, 0);
  return true;
}
