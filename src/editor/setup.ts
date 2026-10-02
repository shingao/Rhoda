import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import type { Extension } from "@codemirror/state";
import { drawSelection, EditorView, keymap, placeholder } from "@codemirror/view";
import { cssMs } from "../app/cssTokens";
import { currentMessages } from "../app/i18n";

/**
 * Editor look, driven by design tokens only. Phase 1 renders raw Markdown;
 * the live preview arrives in phase 2.
 */
const ursaTheme = EditorView.theme({
  "&": {
    height: "100%",
    backgroundColor: "var(--bg-2)",
    color: "var(--text)",
    fontFamily: "var(--font-editor)",
    fontSize: "var(--editor-fs)",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": {
    fontFamily: "inherit",
    lineHeight: "var(--editor-lh)",
  },
  // Centered text column: --editor-max of text plus a --editor-pad-x gutter each side.
  ".cm-content": {
    flexGrow: "0",
    flexShrink: "1",
    flexBasis: "calc(var(--editor-max) + 2 * var(--editor-pad-x))",
    minWidth: "0",
    margin: "0 auto",
    padding: "var(--editor-pad-top) var(--editor-pad-x) var(--editor-pad-bottom)",
    caretColor: "var(--accent)",
  },
  ".cm-line": { padding: "0" },
  ".cm-cursor, .cm-dropCursor": { borderLeft: "var(--caret-w) solid var(--accent)" },
  ".cm-selectionBackground, &.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground": {
    backgroundColor: "var(--selection)",
  },
  ".cm-content ::selection": { backgroundColor: "var(--selection)" },
  ".cm-placeholder": { color: "var(--text-3)" },
});

export function editorExtensions(): Extension {
  return [
    history(),
    drawSelection({ cursorBlinkRate: cssMs("--caret-blink") }),
    EditorView.lineWrapping,
    markdown(),
    keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
    // Functions, so the texts follow the language setting.
    placeholder(() => {
      const el = document.createElement("span");
      el.textContent = currentMessages().editor.placeholder;
      return el;
    }),
    EditorView.contentAttributes.of(() => ({
      spellcheck: "true",
      autocapitalize: "sentences",
      lang: document.documentElement.lang,
      "aria-label": currentMessages().editor.textLabel,
    })),
    ursaTheme,
  ];
}
