import { tagKey } from "../core/markdown/extract";
import type { Note } from "../core/note/note";
import { isTagWithin } from "../core/tags";

/** Fixed sections of the sidebar [DESIGN §2.2], in display order. */
export const SECTIONS = ["notes", "untagged", "todo", "today", "pinned", "archive", "trash"] as const;
export type SectionId = (typeof SECTIONS)[number];

/** Sections whose count is not shown [DESIGN §2.2]. */
export const UNCOUNTED: ReadonlySet<SectionId> = new Set(["archive", "trash"]);

/** What the note list shows: a section or a tag (with its descendants). */
export type ListFilter = { kind: "section"; section: SectionId } | { kind: "tag"; key: string };

function startOfToday(now: number): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

const active = (n: Note) => !n.trashed && !n.archived;

export function matchesFilter(note: Note, filter: ListFilter, now: number): boolean {
  if (filter.kind === "tag") {
    return active(note) && (note.syntax?.tags.some((t) => isTagWithin(tagKey(t.name), filter.key)) ?? false);
  }
  switch (filter.section) {
    case "notes":
      return active(note);
    case "untagged":
      return active(note) && note.syntax !== null && note.syntax.tags.length === 0;
    case "todo":
      return active(note) && note.syntax !== null && note.syntax.todos.done < note.syntax.todos.total;
    case "today":
      return active(note) && note.mtime >= startOfToday(now);
    case "pinned":
      return active(note) && note.pinned;
    case "archive":
      return note.archived && !note.trashed;
    case "trash":
      return note.trashed;
  }
}

export function sectionCounts(notes: Note[], now: number): Record<SectionId, number> {
  const counts = Object.fromEntries(SECTIONS.map((s) => [s, 0])) as Record<SectionId, number>;
  for (const note of notes) {
    for (const s of SECTIONS) if (matchesFilter(note, { kind: "section", section: s }, now)) counts[s]++;
  }
  return counts;
}
