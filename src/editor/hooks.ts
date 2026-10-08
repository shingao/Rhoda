import { StateEffect } from "@codemirror/state";
import type { FoldKey } from "../core/folds";
import type { CardState } from "./embeds/linkCard";
import type { PdfState } from "./embeds/pdfCard";
import type { RemoteImageState } from "./embeds/remoteImage";
import type { OutlineData } from "./sections/outline";

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
  /** Whether a note still has text waiting to be written (its editor state is then never dropped). */
  hasUnsavedText(noteId: string): boolean;
  /** Folds saved for a note (`.ursa/folds.json`). */
  savedFolds(noteId: string): FoldKey[];
  /** The folds of a note changed (or its folded headings were renamed). */
  foldsChanged(noteId: string, keys: FoldKey[]): void;
  /** Headings and current section of the open note (Contents panel). */
  outlineChanged(data: OutlineData): void;
  /** Occurrences of the search in the open note ("3 / 12"). */
  findChanged(info: { count: number; current: number | null; images: number; currentImage: number | null }): void;
  /** URL to display a file referenced by the open note (relative path), or null (remote, outside the vault). */
  assetUrl(src: string): string | null;
  /** Size of an image not displayed yet is wanted (the app reads it from the file, then refreshes). */
  wantSize(src: string, url: string): void;
  /** Card of a URL alone on its line; null when link previews are off. */
  urlCard(url: string): CardState | null;
  /** Card of a PDF linked alone on its line (null: outside the vault). */
  pdfCard(src: string, label: string): PdfState | null;
  /** Click on a PDF card: open it with the default app. */
  openAttachment(path: string): void;
  /** Download state of a remote image (never loaded by itself). */
  remoteImage(url: string): RemoteImageState;
  /** "Download locally" on a remote image: copy into assets/ and rewrite the line starting at `lineFrom`. */
  downloadImage(url: string, lineFrom: number): void;
  /** "…" of a link card. */
  openCardMenu(url: string, lineFrom: number, at: { x: number; y: number }): void;
  /** "Crop" on a selected image: the app opens the crop dialog for the image line starting at `lineFrom`. */
  cropImage(src: string, lineFrom: number): void;
  /** A paste without text nor file: the image of the system clipboard, if any (screenshot). */
  pasteClipboardImage(pos: number): void;
  /** Files pasted or dropped in the editor (images, PDF); true if taken care of. */
  attachFiles(files: File[], pos: number): boolean;
  /** URL of a sticker image (`fluent/<code>` built in, or a vault path), or null if missing. */
  stickerUrl(asset: string): string | null;
  /** Zones of the search words in an image of the open note (OCR), with its size; null if none or not read yet. */
  imageMatches(src: string, needles: readonly string[]): { boxes: Array<{ x: number; y: number; w: number; h: number }>; width: number; height: number } | null;
  /** "Text" button of a selected image: shows what OCR read in it. */
  openOcrText(src: string, at: { x: number; y: number }): void;
  /** "Hide stickers" remembered for a note. */
  stickersHidden(noteId: string): boolean;
  /** Right-click (or context menu key) on a sticker or post-it. */
  openStickerMenu(id: string, at: { x: number; y: number }): void;
  /** Right-click (or context menu key) in the text: the block's menu (alignment). */
  openBlockMenu(at: { x: number; y: number }): void;
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
  hasUnsavedText: () => false,
  savedFolds: () => [],
  foldsChanged: () => undefined,
  outlineChanged: () => undefined,
  findChanged: () => undefined,
  assetUrl: () => null,
  wantSize: () => undefined,
  attachFiles: () => false,
  pasteClipboardImage: () => undefined,
  cropImage: () => undefined,
  urlCard: () => null,
  remoteImage: () => ({ status: "idle" }),
  downloadImage: () => undefined,
  pdfCard: () => null,
  openAttachment: () => undefined,
  openCardMenu: () => undefined,
  stickerUrl: () => null,
  stickersHidden: () => false,
  imageMatches: () => null,
  openOcrText: () => undefined,
  openStickerMenu: () => undefined,
  openBlockMenu: () => undefined,
};

export function setEditorHooks(next: Partial<EditorHooks>): void {
  hooks = { ...hooks, ...next };
}

export function editorHooks(): EditorHooks {
  return hooks;
}

/** Forces the live preview to redraw (e.g. a linked note was created or renamed). */
export const refreshPreview = StateEffect.define<null>();
