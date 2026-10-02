import { tags } from "@lezer/highlight";
import { GFM, parser as baseParser, type DelimiterType, type InlineContext, type MarkdownConfig } from "@lezer/markdown";

/**
 * Ursa's Markdown dialect, shared by the editor (live preview) and, from
 * phase 3, by the indexer — so tags, links and todos are recognised the same
 * way everywhere. CommonMark + GFM (tables, task lists, ~~strike~~, autolinks)
 * plus three inline extensions: ==highlight==, [[wiki links]] and #tags.
 */

const Punctuation = /[\p{S}\p{P}]/u;
const Space = /\s|^$/;

const HighlightDelim: DelimiterType = { resolve: "Highlight", mark: "HighlightMark" };

/** `==highlighted text==`, delimiter rules copied from GFM strikethrough. */
export const Highlight: MarkdownConfig = {
  defineNodes: [
    { name: "Highlight", style: { "Highlight/...": tags.special(tags.content) } },
    { name: "HighlightMark", style: tags.processingInstruction },
  ],
  parseInline: [
    {
      name: "Highlight",
      parse(cx, next, pos) {
        if (next !== 61 /* = */ || cx.char(pos + 1) !== 61 || cx.char(pos + 2) === 61) return -1;
        const before = cx.slice(pos - 1, pos);
        const after = cx.slice(pos + 2, pos + 3);
        const sBefore = Space.test(before);
        const sAfter = Space.test(after);
        const pBefore = Punctuation.test(before);
        const pAfter = Punctuation.test(after);
        return cx.addDelimiter(
          HighlightDelim,
          pos,
          pos + 2,
          !sAfter && (!pAfter || sBefore || pBefore),
          !sBefore && (!pBefore || sAfter || pAfter),
        );
      },
      after: "Emphasis",
    },
  ],
};

/** `[[Target]]` or `[[Target|shown text]]`, on a single line. */
export const WikiLink: MarkdownConfig = {
  defineNodes: [
    { name: "WikiLink", style: tags.link },
    { name: "WikiLinkMark", style: tags.processingInstruction },
    { name: "WikiLinkTarget" },
    { name: "WikiLinkPipe", style: tags.processingInstruction },
    { name: "WikiLinkAlias" },
  ],
  parseInline: [
    {
      name: "WikiLink",
      parse(cx, next, pos) {
        if (next !== 91 /* [ */ || cx.char(pos + 1) !== 91) return -1;
        const rest = cx.slice(pos + 2, cx.end);
        const m = /^([^[\]|\n]+?)(?:\|([^[\]\n]+?))?\]\]/.exec(rest);
        if (!m || !m[1]!.trim()) return -1;
        const end = pos + 2 + m[0].length;
        const targetEnd = pos + 2 + m[1]!.length;
        const children = [cx.elt("WikiLinkMark", pos, pos + 2), cx.elt("WikiLinkTarget", pos + 2, targetEnd)];
        if (m[2] !== undefined) {
          children.push(cx.elt("WikiLinkPipe", targetEnd, targetEnd + 1), cx.elt("WikiLinkAlias", targetEnd + 1, end - 2));
        }
        children.push(cx.elt("WikiLinkMark", end - 2, end));
        return cx.addElement(cx.elt("WikiLink", pos, end, children));
      },
      before: "Link",
    },
  ],
};

const TAG_CHAR = String.raw`[\p{L}\p{N}_\-]`;
/** `#tag` or `#nested/tag`: letters, digits, `_`, `-`, `/` between segments; at least one letter. */
const SIMPLE_TAG = new RegExp(String.raw`^#(${TAG_CHAR}+(?:\/${TAG_CHAR}+)*)`, "u");
/**
 * `#several words#`, closed by a `#` followed by a boundary. Only tag characters,
 * spaces, `/` and apostrophes inside, so prose such as "(#idée) … C#" is not one tag.
 */
const MULTI_WORD_TAG = new RegExp(String.raw`^#(${TAG_CHAR}[\p{L}\p{N}_\-\/ '’]*?[\p{L}\p{N}_\-\/])#(?=$|[\s.,;:!?)\]])`, "u");
const HAS_LETTER = /\p{L}/u;

/**
 * Hex colour codes (3, 4, 6 or 8 hex digits) are not tags. A hex-looking word counts as a colour
 * only when it has a digit or is all upper case, so lowercase words such as
 * "cafe" stay tags.
 */
function isHexColor(name: string): boolean {
  return /^(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(name) && (/\d/.test(name) || name === name.toUpperCase());
}

function tagBoundaryBefore(cx: InlineContext, pos: number): boolean {
  if (pos === cx.offset) return true;
  return /[\s([{"'«]/.test(cx.slice(pos - 1, pos));
}

/**
 * `#tag`, `#tag/sub-tag`, `#multi word tag#`. Never inside code, URLs or
 * words (`C#`, `n°#3`). Tags inside headings are parsed but ignored by
 * `extractSyntax` and the editor (`isInHeading`).
 */
export const Tag: MarkdownConfig = {
  defineNodes: [
    { name: "Tag", style: tags.labelName },
    { name: "TagMark", style: tags.processingInstruction },
  ],
  parseInline: [
    {
      name: "Tag",
      parse(cx, next, pos) {
        if (next !== 35 /* # */ || !tagBoundaryBefore(cx, pos)) return -1;
        const rest = cx.slice(pos, cx.end);
        const multi = MULTI_WORD_TAG.exec(rest);
        if (multi && /\s/.test(multi[1]!) && HAS_LETTER.test(multi[1]!)) {
          const end = pos + multi[0].length;
          return cx.addElement(cx.elt("Tag", pos, end, [cx.elt("TagMark", pos, pos + 1), cx.elt("TagMark", end - 1, end)]));
        }
        const simple = SIMPLE_TAG.exec(rest);
        if (!simple || !HAS_LETTER.test(simple[1]!) || isHexColor(simple[1]!)) return -1;
        const end = pos + simple[0].length;
        return cx.addElement(cx.elt("Tag", pos, end, [cx.elt("TagMark", pos, pos + 1)]));
      },
      before: "Emphasis",
    },
  ],
};

export const ursaMarkdownExtensions = [GFM, Highlight, WikiLink, Tag];

/** Standalone parser (indexing, tests). The editor builds the same dialect through @codemirror/lang-markdown. */
export const ursaParser = baseParser.configure(ursaMarkdownExtensions);

const HEADINGS = new Set(["ATXHeading1", "ATXHeading2", "ATXHeading3", "ATXHeading4", "ATXHeading5", "ATXHeading6", "SetextHeading1", "SetextHeading2"]);

/** True when a node sits in a heading: tags there are plain text (titles never carry tags). */
export function isInHeading(node: { parent: { name: string; parent: unknown } | null }): boolean {
  for (let p = node.parent as { name: string; parent: unknown } | null; p; p = p.parent as typeof p) {
    if (HEADINGS.has(p.name)) return true;
  }
  return false;
}
