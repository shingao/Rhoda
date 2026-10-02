import { markdown } from "@codemirror/lang-markdown";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import type { Extension } from "@codemirror/state";
import { tags as t } from "@lezer/highlight";
import { ursaMarkdownExtensions } from "../core/markdown/syntax";

/**
 * Colours for code inside fenced blocks [DESIGN §2.8], as CSS classes so the
 * values stay in tokens: keywords accent, literals secondary, comments faint.
 * Only code tags are listed, so Markdown itself is not coloured by this.
 */
export const codeHighlightStyle = HighlightStyle.define([
  {
    tag: [t.keyword, t.controlKeyword, t.operatorKeyword, t.definitionKeyword, t.moduleKeyword, t.modifier, t.self, t.null, t.bool],
    class: "cm-tok-keyword",
  },
  { tag: [t.string, t.special(t.string), t.regexp, t.number, t.integer, t.float, t.character], class: "cm-tok-literal" },
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], class: "cm-tok-comment" },
]);

/** Ursa's Markdown dialect + lazily loaded languages for fenced code. */
export function markdownLanguage(): Extension {
  return [
    markdown({ extensions: ursaMarkdownExtensions, codeLanguages: languages }),
    syntaxHighlighting(codeHighlightStyle),
  ];
}
