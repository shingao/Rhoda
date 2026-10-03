/**
 * Lines rendered as blocks in the editor: an image, a PDF link or a URL alone
 * on their line. Standard Markdown with relative paths, so notes stay readable
 * elsewhere: `![alt](assets/photo.png){width=560}`, `[devis.pdf](assets/devis.pdf)`,
 * `https://example.com/article`. Paths with spaces are written `<…>`.
 */
export type EmbedLine =
  | {
      kind: "image";
      alt: string;
      /** Raw destination as written (without `<>`). */
      src: string;
      width: number | null;
      /** Offsets in the line of `{width=…}` (to replace it), or of the end of `)` (to add one). */
      attrFrom: number;
      attrTo: number;
    }
  | { kind: "pdf"; label: string; src: string }
  | { kind: "url"; url: string };

const DEST = String.raw`(<[^>\n]+>|[^\s()<>]+(?:\([^\s()]*\)[^\s()<>]*)*)`;
const TITLE = String.raw`(?:\s+"[^"\n]*")?`;
const IMAGE = new RegExp(String.raw`^(\s*!\[([^\]\n]*)\]\(${DEST}${TITLE}\))(\{\s*width\s*=\s*(\d+)\s*\})?\s*$`);
const LINK = new RegExp(String.raw`^\s*\[([^\]\n]+)\]\(${DEST}${TITLE}\)\s*$`);
/** A bare URL; written `<https://…>` it is a plain link on purpose (card menu › Plain link). */
const URL_LINE = /^\s*((?:https?:\/\/)[^\s<>]+)\s*$/i;

const unwrap = (dest: string) => (dest.startsWith("<") && dest.endsWith(">") ? dest.slice(1, -1) : dest);

export function parseEmbedLine(text: string): EmbedLine | null {
  const image = IMAGE.exec(text);
  if (image) {
    const [, head, alt, dest, attr, width] = image;
    const attrFrom = head!.length;
    return { kind: "image", alt: alt!, src: unwrap(dest!), width: width ? Number(width) : null, attrFrom, attrTo: attrFrom + (attr?.length ?? 0) };
  }
  const link = LINK.exec(text);
  if (link && /\.pdf$/i.test(decodeSrc(unwrap(link[2]!)))) return { kind: "pdf", label: link[1]!, src: unwrap(link[2]!) };
  const url = URL_LINE.exec(text);
  if (url) return { kind: "url", url: url[1]! };
  return null;
}

/** `%20` and friends decoded; malformed sequences kept as written. */
export function decodeSrc(src: string): string {
  try {
    return decodeURI(src);
  } catch {
    return src;
  }
}

export const isRemote = (src: string) => /^[a-z][a-z0-9+.-]*:/i.test(src) || src.startsWith("//");

/**
 * Vault-relative path of a destination written in the note at `notePath`, or
 * null for remote URLs, absolute paths and paths leaving the vault.
 */
export function resolveVaultPath(notePath: string, src: string): string | null {
  const path = decodeSrc(src).split(/[?#]/)[0]!;
  if (!path || isRemote(path) || path.startsWith("/") || path.startsWith("\\")) return null;
  const parts = notePath.split("/").slice(0, -1);
  for (const part of path.replace(/\\/g, "/").split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (parts.length === 0) return null;
      parts.pop();
    } else parts.push(part);
  }
  return parts.length ? parts.join("/") : null;
}

/** Destination to write in the note at `notePath` for the vault file `target`. */
export function relativeSrc(notePath: string, target: string): string {
  const from = notePath.split("/").slice(0, -1);
  const to = target.split("/");
  let common = 0;
  while (common < from.length && common < to.length - 1 && from[common] === to[common]) common++;
  const rel = [...from.slice(common).map(() => ".."), ...to.slice(common)].join("/");
  return /[\s()<>]/.test(rel) ? `<${rel}>` : rel;
}

export function imageMarkdown(alt: string, src: string, width: number | null = null): string {
  return `![${alt.replace(/[[\]]/g, "")}](${src})${width ? `{width=${width}}` : ""}`;
}

export function linkMarkdown(label: string, src: string): string {
  return `[${label.replace(/[[\]]/g, "")}](${src})`;
}

/** Embeds of a body, by 1-based line number; lines inside fenced or indented code never count. */
export function embedLines(lines: Iterable<string>): Map<number, EmbedLine> {
  const out = new Map<number, EmbedLine>();
  let fence: string | null = null;
  let n = 0;
  for (const text of lines) {
    n++;
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(text)?.[1];
    if (fence) {
      if (marker && marker[0] === fence[0] && marker.length >= fence.length && text.trim() === marker) fence = null;
      continue;
    }
    if (marker) {
      fence = marker;
      continue;
    }
    if (/^( {4}|\t)/.test(text)) continue;
    const embed = parseEmbedLine(text);
    if (embed) out.set(n, embed);
  }
  return out;
}

const LINK_DEST = new RegExp(String.raw`(!?)\[[^\]\n]*\]\(${DEST}${TITLE}\)`, "g");

/** Files of the vault a note points to with Markdown images or links (vault-relative paths). */
export function localReferences(notePath: string, body: string): Set<string> {
  const out = new Set<string>();
  for (const m of body.matchAll(LINK_DEST)) {
    const path = resolveVaultPath(notePath, unwrap(m[2]!));
    if (path) out.add(path);
  }
  return out;
}

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg)$/i;

/** First local image of a note (thumbnail of its card), or null. */
export function firstImage(notePath: string, body: string): string | null {
  for (const m of body.matchAll(LINK_DEST)) {
    if (m[1] !== "!") continue;
    const path = resolveVaultPath(notePath, unwrap(m[2]!));
    if (path && IMAGE_EXT.test(path)) return path;
  }
  return null;
}
