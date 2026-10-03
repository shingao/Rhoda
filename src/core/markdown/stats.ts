/**
 * Counts for the note info panel and focus mode, on the text as read (without
 * Markdown markers, link targets or URLs). Words follow the French convention
 * of word processors: "l'été", "porte-monnaie" and "2026" are one word each.
 */
export interface TextStats {
  words: number;
  /** Characters of the text as read, spaces included. */
  characters: number;
  /** Same, without whitespace. */
  charactersNoSpaces: number;
  /** Minutes, rounded up (0 for an empty note). */
  readingMinutes: number;
}

/** Reading speed used for the reading time [phase 6 brief]. */
export const WORDS_PER_MINUTE = 230;

const WORD = /[\p{L}\p{N}]+(?:['’\-‐][\p{L}\p{N}]+)*/gu;

/** The text of a Markdown body as a reader sees it (approximate, cheap: one pass of regexes). */
export function readableText(markdown: string): string {
  return (
    markdown
      // Fence lines (``` / ~~~ with their language) and HTML comments.
      .replace(/^ {0,3}(```|~~~).*$/gm, "")
      .replace(/<!--[\s\S]*?-->/g, "")
      // Images keep their alt text; links their label; wiki links their alias or target.
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, "$2")
      .replace(/\[\[([^\]]*)\]\]/g, "$1")
      // Bare URLs are not words.
      .replace(/\b(?:https?:\/\/|www\.)\S+/g, "")
      // Line markers: headings, quotes, lists, tasks, rules, Setext underlines.
      .replace(/^ {0,3}#{1,6}(?=\s|$)/gm, "")
      .replace(/^(?: {0,3}>)+ ?/gm, "")
      .replace(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/gm, "")
      .replace(/^ {0,3}(?:[-*_=]\s*){3,}$/gm, "")
      // Inline markers.
      .replace(/(\*\*|__|~~|==|`+)/g, "")
      .replace(/(^|[^\p{L}\p{N}])[*_]+|[*_]+(?=[^\p{L}\p{N}]|$)/gu, "$1")
      // Tags read as their name: #voyages/japon → voyages japon.
      .replace(/(^|\s)#(?=[\p{L}\p{N}])/gu, "$1")
      .replace(/(?<=[\p{L}\p{N}])\/(?=[\p{L}\p{N}])/gu, " ")
  );
}

export function textStats(markdown: string): TextStats {
  const text = readableText(markdown);
  const words = text.match(WORD)?.length ?? 0;
  const trimmed = text.replace(/\n{2,}/g, "\n").trim();
  return {
    words,
    characters: [...trimmed].length,
    charactersNoSpaces: [...trimmed.replace(/\s+/g, "")].length,
    readingMinutes: words === 0 ? 0 : Math.ceil(words / WORDS_PER_MINUTE),
  };
}
