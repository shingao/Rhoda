import { invertedEffects } from "@codemirror/commands";
import { StateEffect, StateField, type EditorState, type Extension, type Transaction } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { NoteFont } from "../core/note/note";

/**
 * Font and size of the whole note (frontmatter `font:`, `size:`, decision
 * P12-4), in the editor state so that a change from the toolbar is undone with
 * Ctrl+Z like the text. The editor applies them to itself (CSS variables on
 * `.cm-editor`); the frontmatter is written when the note is saved.
 */
export interface NoteLook {
  /** null: the default setting. */
  font: NoteFont | null;
  size: number | null;
}

export const NO_LOOK: NoteLook = { font: null, size: null };

const FONT_VARS: Record<NoteFont, string> = {
  sans: "var(--font-editor)",
  serif: "var(--font-editor-serif)",
  mono: "var(--font-mono)",
  hand: "var(--font-hand)",
};

/** Value of `--editor-font-active` for a font of the text (setting, or a note's `font:`). */
export const editorFontVar = (font: NoteFont): string => FONT_VARS[font];

const changeLook = StateEffect.define<{ before: NoteLook; after: NoteLook }>();
/** The look of a note opened or reloaded from disk (not part of the history, never saved back). */
export const loadLook = StateEffect.define<NoteLook>();

export const lookField = StateField.define<NoteLook>({
  create: () => NO_LOOK,
  update(look, tr) {
    for (const e of tr.effects) {
      if (e.is(loadLook)) look = e.value;
      else if (e.is(changeLook)) look = e.value.after;
    }
    return look;
  },
  provide: (field) =>
    EditorView.editorAttributes.from(field, (look): Record<string, string> => {
      const vars = [look.font && `--editor-font-active: ${editorFontVar(look.font)}`, look.size !== null && `--editor-fs: ${look.size}px`].filter(Boolean);
      return vars.length ? { style: vars.join("; ") } : {};
    }),
});

const invertLook = invertedEffects.of((tr) => tr.effects.flatMap((e) => (e.is(changeLook) ? [changeLook.of({ before: e.value.after, after: e.value.before })] : [])));

export const noteLookState: Extension = [lookField, invertLook];

export const changesLook = (tr: Transaction): boolean => tr.effects.some((e) => e.is(changeLook));

export const sameLook = (a: NoteLook, b: NoteLook) => a.font === b.font && a.size === b.size;

export const lookOf = (state: EditorState): NoteLook => state.field(lookField, false) ?? NO_LOOK;

/** Changes the note's font and/or size (null: back to the default setting); one undo step. */
export function setNoteLook(view: EditorView, patch: Partial<NoteLook>): boolean {
  const before = lookOf(view.state);
  const after = { ...before, ...patch };
  if (sameLook(before, after)) return true;
  view.dispatch({ effects: changeLook.of({ before, after }), userEvent: "input.format" });
  return true;
}
