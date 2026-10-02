import { StateEffect } from "@codemirror/state";

/**
 * What the editor needs from the rest of the app, injected at startup so the
 * editor layer never reads the store directly.
 */
export interface EditorHooks {
  /** Whether `[[target]]` points to an existing note. */
  linkExists(target: string): boolean;
  /** Ctrl+click on a wiki link (existing or not). */
  openWikiLink(target: string): void;
  /** Click on a tag pill. */
  openTag(name: string): void;
  /** Click on a backlink. */
  openNote(id: string): void;
  /** Data for autocompletion. */
  completions(): { tags: string[]; titles: string[] };
  /** Notes linking to the open note, shown at its end. */
  backlinks(): Backlink[];
  /** Floating preview of a linked note (hover). */
  linkPreview(target: string): { title: string; text: string } | null;
}

export interface Backlink {
  id: string;
  title: string;
  /** The line of the source note that holds the link. */
  snippet: string;
}

let hooks: EditorHooks = {
  linkExists: () => true,
  openWikiLink: () => undefined,
  openTag: () => undefined,
  openNote: () => undefined,
  completions: () => ({ tags: [], titles: [] }),
  backlinks: () => [],
  linkPreview: () => null,
};

export function setEditorHooks(next: Partial<EditorHooks>): void {
  hooks = { ...hooks, ...next };
}

export function editorHooks(): EditorHooks {
  return hooks;
}

/** Forces the live preview to redraw (e.g. a linked note was created or renamed). */
export const refreshPreview = StateEffect.define<null>();
