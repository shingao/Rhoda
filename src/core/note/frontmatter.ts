import { parseDocument } from "yaml";

const FRONTMATTER = /^---[ \t]*\r?\n([\s\S]*?\r?\n)?---[ \t]*(?:\r?\n|$)/;

export interface SplitNote {
  /** Raw YAML between the fences (without them), or null if absent. */
  frontmatter: string | null;
  body: string;
}

export function splitFrontmatter(content: string): SplitNote {
  const m = FRONTMATTER.exec(content);
  if (!m) return { frontmatter: null, body: content };
  return { frontmatter: m[1] ?? "", body: content.slice(m[0].length) };
}

export function joinFrontmatter(frontmatter: string | null, body: string): string {
  if (frontmatter === null) return body;
  const fm = frontmatter.endsWith("\n") || frontmatter === "" ? frontmatter : `${frontmatter}\n`;
  return `---\n${fm}---\n${body}`;
}

export type FrontmatterData = Record<string, unknown>;

export function parseFrontmatter(frontmatter: string | null): FrontmatterData {
  if (!frontmatter) return {};
  try {
    const value: unknown = parseDocument(frontmatter).toJS();
    return value && typeof value === "object" && !Array.isArray(value) ? (value as FrontmatterData) : {};
  } catch {
    return {};
  }
}

/**
 * Applies a patch (`undefined` deletes a key) while preserving the user's
 * ordering, comments and unknown keys. Returns the input untouched when
 * nothing changes, and null when the frontmatter ends up empty.
 */
export function patchFrontmatter(frontmatter: string | null, patch: FrontmatterData): string | null {
  const doc = parseDocument(frontmatter ?? "");
  if (doc.errors.length > 0) throw new Error("Frontmatter is not valid YAML");
  const current = parseFrontmatter(frontmatter);
  let changed = false;
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) {
      if (key in current) {
        doc.delete(key);
        changed = true;
      }
    } else if (JSON.stringify(current[key]) !== JSON.stringify(value)) {
      doc.set(key, value);
      changed = true;
    }
  }
  if (!changed) return frontmatter;
  if (!doc.contents || (Array.isArray((doc.contents as { items?: unknown[] }).items) && (doc.contents as { items: unknown[] }).items.length === 0)) {
    return null;
  }
  return doc.toString({ lineWidth: 0 });
}
