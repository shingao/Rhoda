import { titleKey, type WikiLinkRef } from "../core/markdown/extract";
import type { Note } from "../core/note/note";
import { buildTagIndex, type TagIndex } from "../core/tags";

/** Indexes derived from the notes, rebuilt only when the notes object changes. */
export interface NoteIndex {
  tags: TagIndex;
  /** titleKey → ids of the (non-trashed) notes with that title. */
  titles: Map<string, string[]>;
  /** note id → the links pointing to it, with their source note. */
  backlinks: Map<string, Array<{ sourceId: string; link: WikiLinkRef }>>;
}

let cacheKey: Record<string, Note> | null = null;
let cache: NoteIndex | null = null;

export function noteIndex(notes: Record<string, Note>): NoteIndex {
  if (cacheKey === notes && cache) return cache;
  const all = Object.values(notes);
  const live = all.filter((n) => !n.trashed);
  const titles = new Map<string, string[]>();
  for (const n of live) {
    if (!n.title) continue;
    const key = titleKey(n.title);
    titles.set(key, [...(titles.get(key) ?? []), n.id]);
  }
  const backlinks: NoteIndex["backlinks"] = new Map();
  for (const n of live) {
    for (const link of n.syntax?.links ?? []) {
      const target = resolveTitle(titles, notes, link.target);
      if (!target || target === n.id) continue;
      backlinks.set(target, [...(backlinks.get(target) ?? []), { sourceId: n.id, link }]);
    }
  }
  const tags = buildTagIndex(
    all.filter((n) => !n.trashed && !n.archived).map((n) => ({ id: n.id, created: n.created, tags: n.syntax?.tags ?? [] })),
  );
  cacheKey = notes;
  cache = { tags, titles, backlinks };
  return cache;
}

/** The note a `[[target]]` points to: same title (any case); the most recently modified wins a tie. */
export function resolveTitle(titles: Map<string, string[]>, notes: Record<string, Note>, target: string): string | null {
  const ids = titles.get(titleKey(target));
  if (!ids?.length) return null;
  return ids.reduce((best, id) => ((notes[id]?.mtime ?? 0) > (notes[best]?.mtime ?? 0) ? id : best));
}
