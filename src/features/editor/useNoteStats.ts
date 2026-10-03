import { useMemo } from "react";
import { textStats, type TextStats } from "../../core/markdown/stats";
import type { Note } from "../../core/note/note";

/** Counts of a note, recomputed when its saved text changes. */
export function useNoteStats(note: Note | undefined): TextStats | null {
  const body = note?.body;
  return useMemo(() => (body === undefined ? null : textStats(body)), [body]);
}
