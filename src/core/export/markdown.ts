import { isInHeading, ursaParser } from "../markdown/syntax";
import { parseEmbedLine, resolveVaultPath } from "../markdown/embeds";

/**
 * Markdown export: the note as written, without what only Ursa reads, with
 * its images and files next to it (`assets/`), readable in any editor.
 */

/** Frontmatter keys managed by Ursa (identity, flags, page, stickers): not exported. */
export const URSA_KEYS = ["id", "created", "pinned", "archived", "trashed", "paper", "margin", "page", "column", "stickers", "align"] as const;

const DEST = String.raw`(<[^>\n]+>|[^\s()<>]+(?:\([^\s()]*\)[^\s()<>]*)*)`;
const LINK = new RegExp(String.raw`(!?\[[^\]\n]*\]\()${DEST}((?:\s+"[^"\n]*")?\))`, "g");

const unwrap = (dest: string) => (dest.startsWith("<") && dest.endsWith(">") ? dest.slice(1, -1) : dest);
const wrap = (dest: string) => (/[\s()<>]/.test(dest) ? `<${dest}>` : dest);

/** Ranges of fenced and indented code: never rewritten. */
function codeRanges(body: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  ursaParser.parse(body).iterate({
    enter: (n) => {
      if (n.name === "FencedCode" || n.name === "CodeBlock" || n.name === "InlineCode") {
        ranges.push([n.from, n.to]);
        return false;
      }
      return undefined;
    },
  });
  return ranges;
}

const inside = (ranges: Array<[number, number]>, pos: number) => ranges.some(([a, b]) => pos >= a && pos < b);

/** Vault files the note's links and images point to. */
export function linkedFiles(notePath: string, body: string): string[] {
  const code = codeRanges(body);
  const out = new Set<string>();
  for (const m of body.matchAll(LINK)) {
    if (inside(code, m.index)) continue;
    const path = resolveVaultPath(notePath, unwrap(m[2]!));
    if (path) out.add(path);
  }
  return [...out];
}

/** Links and images pointed at their copies (`copies`: vault path → path relative to the exported file). */
export function rewriteLinks(notePath: string, body: string, copies: ReadonlyMap<string, string>): string {
  const code = codeRanges(body);
  return body.replace(LINK, (all: string, head: string, dest: string, tail: string, offset: number) => {
    if (inside(code, offset)) return all;
    const path = resolveVaultPath(notePath, unwrap(dest));
    const copy = path ? copies.get(path) : undefined;
    return copy ? `${head}${wrap(copy)}${tail}` : all;
  });
}

/** Without images: image lines removed, inline images reduced to their text. */
export function removeImages(body: string): string {
  const code = codeRanges(body);
  let offset = 0;
  const lines = body.split("\n").filter((line) => {
    const start = offset;
    offset += line.length + 1;
    return inside(code, start) || parseEmbedLine(line)?.kind !== "image";
  });
  const kept = lines.join("\n");
  const keptCode = codeRanges(kept);
  return kept.replace(/!\[([^\]\n]*)\]\([^)\n]*\)(\{[^}\n]*\})?/g, (all: string, alt: string, _attr: string, at: number) => (inside(keptCode, at) ? all : alt));
}

/** Without tags (outside titles and code), and the spaces they leave. */
export function removeTags(body: string): string {
  const ranges: Array<[number, number]> = [];
  ursaParser.parse(body).iterate({
    enter: (n) => {
      if (n.name === "Tag" && !isInHeading(n.node)) ranges.push([n.from, n.to]);
    },
  });
  let out = body;
  for (const [from, to] of ranges.reverse()) {
    const before = out.slice(0, from);
    const after = out.slice(to);
    // One space goes with the tag; a line left empty keeps no spaces.
    out = before.endsWith(" ") && (after.startsWith(" ") || after.startsWith("\n") || after === "") ? before.slice(0, -1) + after : before + after.replace(/^ /, "");
  }
  return out.replace(/^[ \t]+$/gm, "").replace(/\n{3,}/g, "\n\n");
}
