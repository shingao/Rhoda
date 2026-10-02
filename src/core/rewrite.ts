import { extractSyntax, tagKey, titleKey } from "./markdown/extract";
import { formatTag, isTagWithin } from "./tags";

/** Text edits computed on a note body; applied from the end so offsets stay valid. */
export interface TextChange {
  from: number;
  to: number;
  insert: string;
}

export function applyChanges(body: string, changes: TextChange[]): string {
  return [...changes].sort((a, b) => b.from - a.from).reduce((text, c) => text.slice(0, c.from) + c.insert + text.slice(c.to), body);
}

/** `[[Old]]`, `[[old#Part|text]]` → `[[New]]`, `[[New#Part|text]]` (anchor and alias kept). */
export function wikiLinkRenameChanges(body: string, oldTitle: string, newTitle: string): TextChange[] {
  const oldKey = titleKey(oldTitle);
  return extractSyntax(body)
    .links.filter((l) => l.target && titleKey(l.target) === oldKey)
    .map((l) => ({ from: l.titleFrom, to: l.titleTo, insert: newTitle }));
}

/** Renames `#old` and its descendants (`#old/x` → `#new/x`), whatever their case. */
export function tagRenameChanges(body: string, oldKey: string, newName: string): TextChange[] {
  return extractSyntax(body)
    .tags.filter((t) => isTagWithin(tagKey(t.name), oldKey))
    .map((t) => {
      const rest = t.name.slice(t.name.split("/").slice(0, oldKey.split("/").length).join("/").length);
      return { from: t.from, to: t.to, insert: formatTag(newName + rest) };
    });
}

/**
 * Removes `#tag` and its descendants with one neighbouring space. A line left
 * empty by the removal (a tag-only line) disappears entirely.
 */
export function tagRemoveChanges(body: string, key: string): TextChange[] {
  const tags = extractSyntax(body).tags.filter((t) => isTagWithin(tagKey(t.name), key));
  const changes: TextChange[] = [];
  for (const t of tags) {
    let from = t.from;
    let to = t.to;
    if (body[to] === " ") to++;
    else if (body[from - 1] === " ") from--;
    changes.push({ from, to, insert: "" });
  }
  // Drop lines that become blank because only removed tags were on them.
  const result = applyChanges(body, changes);
  const before = body.split("\n");
  const after = result.split("\n");
  if (before.length !== after.length) return changes;
  let offset = 0;
  const lineChanges: TextChange[] = [];
  for (let i = 0; i < before.length; i++) {
    const line = before[i]!;
    const lineEnd = offset + line.length;
    const touched = changes.some((c) => c.from >= offset && c.to <= lineEnd + 1);
    if (touched && line.trim() && !after[i]!.trim()) {
      lineChanges.push({ from: offset, to: Math.min(lineEnd + 1, body.length), insert: "" });
    }
    offset = lineEnd + 1;
  }
  const covered = (c: TextChange) => lineChanges.some((l) => c.from >= l.from && c.to <= l.to);
  return [...changes.filter((c) => !covered(c)), ...lineChanges];
}
