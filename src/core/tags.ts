import { tagKey, type TagRef } from "./markdown/extract";

/** A node of the tag tree: `voyages` contains `voyages/japon-2026`. */
export interface TagNode {
  /** Lower-case full path, the identity of the tag (`voyages/japon-2026`). */
  key: string;
  /** Full path as first written (`Voyages/Japon-2026`). */
  path: string;
  /** Last segment as first written (`Japon-2026`). */
  label: string;
  depth: number;
  children: TagNode[];
  /** Notes tagged with this tag or any descendant. */
  noteIds: Set<string>;
}

export interface TagIndex {
  roots: TagNode[];
  byKey: Map<string, TagNode>;
}

export interface TaggedNote {
  id: string;
  created: number;
  tags: TagRef[];
}

const collator = new Intl.Collator("fr", { sensitivity: "base", numeric: true });

/**
 * Builds the tag tree. Tags are case-insensitive; each path segment is shown
 * as it was first written (notes taken in creation order, then text order).
 * A parent counts the notes of all its descendants.
 */
export function buildTagIndex(notes: TaggedNote[]): TagIndex {
  const byKey = new Map<string, TagNode>();
  const roots: TagNode[] = [];
  const ordered = [...notes].sort((a, b) => a.created - b.created || a.id.localeCompare(b.id));

  for (const note of ordered) {
    for (const tag of note.tags) {
      const segments = tag.name.split("/").filter(Boolean);
      let parent: TagNode | null = null;
      for (let i = 0; i < segments.length; i++) {
        const path = segments.slice(0, i + 1).join("/");
        const key = tagKey(path);
        let node = byKey.get(key);
        if (!node) {
          node = { key, path: parent ? `${parent.path}/${segments[i]}` : segments[i]!, label: segments[i]!, depth: i, children: [], noteIds: new Set() };
          byKey.set(key, node);
          (parent ? parent.children : roots).push(node);
        }
        node.noteIds.add(note.id);
        parent = node;
      }
    }
  }

  const sort = (list: TagNode[]) => {
    list.sort((a, b) => collator.compare(a.label, b.label));
    list.forEach((n) => sort(n.children));
  };
  sort(roots);
  return { roots, byKey };
}

/** True if `key` is `ancestor` or one of its descendants. */
export function isTagWithin(key: string, ancestor: string): boolean {
  return key === ancestor || key.startsWith(`${ancestor}/`);
}

/** Text of a tag as it must be written: `#name`, or `#name with spaces#`. */
export function formatTag(name: string): string {
  return /\s/.test(name) ? `#${name}#` : `#${name}`;
}

/** Normalises what the user typed as a tag name: no leading `#`, no spaces around `/`. */
export function cleanTagName(input: string): string {
  return input
    .trim()
    .replace(/^#+|#+$/g, "")
    .split("/")
    .map((s) => s.trim().replace(/\s+/g, " "))
    .filter(Boolean)
    .join("/");
}
