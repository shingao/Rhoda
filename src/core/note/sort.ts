import type { Note } from "./note";

export type SortKey = "modified" | "created" | "title";

const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });

/** Pinned notes first, then by key (dates newest first, titles A→Z). */
export function sortNotes(notes: Note[], key: SortKey): Note[] {
  const byKey = (a: Note, b: Note): number => {
    switch (key) {
      case "modified":
        return b.mtime - a.mtime;
      case "created":
        return b.created - a.created;
      case "title":
        return collator.compare(a.title, b.title);
    }
  };
  return [...notes].sort((a, b) => Number(b.pinned) - Number(a.pinned) || byKey(a, b) || collator.compare(a.path, b.path));
}
