import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import type { Extension } from "@codemirror/state";
import { drawSelection, EditorView, keymap, placeholder } from "@codemirror/view";
import { cssMs } from "../app/cssTokens";
import { currentMessages } from "../app/i18n";
import { backlinks } from "./backlinks";
import { completions } from "./completion";
import { markdownLanguage } from "./language";
import { linkPreview } from "./linkPreview";
import { foldChevrons } from "./sections/chevrons";
import { outlineReporter } from "./sections/outline";
import { findField } from "./find/find";
import { isolationField, leaveIsolation, selectIsolated, toggleIsolation } from "./sections/focus";
import { folding, foldAll, foldCurrent, unfoldAll, unfoldCurrent } from "./sections/fold";
import { editorKey } from "../app/shortcuts";
import { livePreview } from "./livePreview/plugin";
import "./editor.css";

/** Editor frame, driven by design tokens only. Markdown rendering lives in livePreview/ and editor.css. */
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
  // Above the text, so selections stay visible on lines with a background (code, quotes, pills).
  ".cm-selectionLayer": { zIndex: "1" },
});

/** Development only: localStorage "ursa-dev-raw" shows plain Markdown, for before/after comparisons. */
const rawMarkdown = import.meta.env.DEV && localStorage.getItem("ursa-dev-raw") !== null;

export function editorExtensions(): Extension {
  return [
    history(),
    drawSelection({ cursorBlinkRate: cssMs("--caret-blink") }),
    EditorView.lineWrapping,
    markdownLanguage(),
    rawMarkdown ? [] : livePreview,
    rawMarkdown ? [] : [linkPreview(), backlinks],
    completions(),
    folding,
    isolationField,
    findField,
    foldChevrons,
    outlineReporter,
    keymap.of([
      { key: editorKey("fold.section"), run: foldCurrent },
      { key: editorKey("unfold.section"), run: unfoldCurrent },
      { key: editorKey("fold.all"), run: foldAll },
      { key: editorKey("unfold.all"), run: unfoldAll },
      { key: editorKey("section.isolate"), run: toggleIsolation },
      { key: "Escape", run: leaveIsolation },
      { key: "Mod-a", run: selectIsolated },
    ]),
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
