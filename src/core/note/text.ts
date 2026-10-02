/** Plain-text helpers on a note body (frontmatter already removed). */

const HEADING = /^\s{0,3}#{1,6}\s+/;
/** A line made only of tags (`#projets/ursa #recherche`): metadata, not shown in previews (maquettes 05–09). */
const TAGS_ONLY = /^\s*(?:#[\p{L}\p{N}_\-/]*[\p{L}][\p{L}\p{N}_\-/]*\s*)+$/u;

/** Index of the first non-blank line, or -1. */
function titleLineIndex(lines: string[]): number {
  return lines.findIndex((l) => l.trim() !== "");
}

/** Strips inline Markdown so a line reads as plain text. */
export function stripInline(line: string): string {
  return line
    .replace(/!\[([^\]]*)\]\([^)]*\)(\{[^}]*\})?/g, "$1")
    .replace(/\[\[([^\]|]+)(\|([^\]]+))?\]\]/g, (_m, target: string, _p, alias?: string) => alias ?? target)
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__|==|~~)(.+?)\1/g, "$2")
    .replace(/(^|[^\w*])[*_](\S(?:.*?\S)?)[*_](?=[^\w*]|$)/g, "$1$2")
    .replace(/`([^`]+)`/g, "$1")
    .trim();
}

export function titleFromBody(body: string): string {
  const lines = body.split("\n");
  const i = titleLineIndex(lines);
  if (i < 0) return "";
  return stripInline(lines[i]!.replace(HEADING, ""));
}

/** Text shown under the title in the note list (DESIGN.md §2.4): Markdown removed. */
export function previewFromBody(body: string, maxLength = 240): string {
  const lines = body.split("\n");
  const start = titleLineIndex(lines) + 1;
  const parts: string[] = [];
  let length = 0;
  let inFence = false;
  for (const raw of lines.slice(start)) {
    if (/^\s*(```|~~~)/.test(raw)) {
      inFence = !inFence;
      continue;
    }
    let line = raw;
    if (!inFence && TAGS_ONLY.test(line)) continue;
    if (!inFence) {
      if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) continue;
      line = line
        .replace(HEADING, "")
        .replace(/^\s*>+\s?/, "")
        .replace(/^\s*([-*+]|\d+[.)])\s+(\[[ xX]\]\s+)?/, "");
      line = stripInline(line);
    } else {
      line = line.trim();
    }
    if (!line) continue;
    parts.push(line);
    length += line.length + 1;
    if (length >= maxLength) break;
  }
  return parts.join(" ").slice(0, maxLength);
}

export type Eol = "\n" | "\r\n";

/**
 * Plain-text line around the range [from, to) of `body` (a backlink's context):
 * list/quote markers and inline Markdown removed, the start cut so the range stays visible.
 */
export function snippetAround(body: string, from: number, to: number, before = 48): string {
  const start = body.lastIndexOf("\n", from - 1) + 1;
  const endIndex = body.indexOf("\n", to);
  const line = body.slice(start, endIndex < 0 ? undefined : endIndex);
  const markers = /^\s*>+\s?|^\s*([-*+]|\d+[.)])\s+(\[[ xX]\]\s+)?/;
  const text = stripInline(line.replace(markers, "")).trim();
  // Approximate position of the range in the stripped text.
  const lead = stripInline(line.slice(0, from - start).replace(markers, "")).length;
  if (lead <= before) return text;
  const cut = text.slice(lead - before);
  return `…${cut.slice(cut.indexOf(" ") + 1)}`;
}

export function detectEol(content: string): Eol {
  return content.includes("\r\n") ? "\r\n" : "\n";
}

export function normalizeEol(content: string): string {
  return content.replace(/\r\n?/g, "\n");
}

export function applyEol(content: string, eol: Eol): string {
  return eol === "\n" ? content : content.replace(/\n/g, "\r\n");
}
