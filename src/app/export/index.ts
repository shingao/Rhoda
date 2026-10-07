import { joinFrontmatter, patchFrontmatter } from "../../core/note/frontmatter";
import { sanitizeStem } from "../../core/note/filename";
import type { Note } from "../../core/note/note";
import { linkedFiles, removeImages, removeTags, rewriteLinks, URSA_KEYS } from "../../core/export/markdown";
import { editorText } from "../../editor/session";
import { errorMessage } from "../../services/errors";
import { exportApi } from "../../services/export";
import type { ExportFormat, ExportSettings } from "../../services/settings";
import { currentMessages } from "../i18n";
import { noteIndex, resolveTitle } from "../noteIndex";
import { flushAll } from "../notes";
import { resolvePalette } from "../theme";
import { getState, setState, showToast, updateSettings } from "../store";
import { exportPage } from "./page";

/**
 * Export of one or several notes (MD, HTML, PDF, DOCX, JPG/PNG) to a folder the
 * user chose. Each note is one file named after its title (cleaned like note
 * file names); wiki links between notes of the same export point to each other.
 */

export const EXTENSIONS: Record<ExportFormat, string> = { md: "md", html: "html", pdf: "pdf", docx: "docx", image: "png" };

/** Opens the export dialog for some notes (default: the open one). */
export function openExport(noteIds?: string[], subtitle?: string): void {
  const { selectedId, notes } = getState();
  const ids = noteIds ?? (selectedId ? [selectedId] : []);
  if (!ids.length) return;
  const t = currentMessages();
  setState({ exportDialog: { noteIds: ids, subtitle: subtitle ?? (ids.length === 1 ? notes[ids[0]!]?.title || t.untitled : t.exportDialog.notes(ids.length)) } });
}

export function closeExport(): void {
  setState({ exportDialog: null });
}

/** The folder to export to: the last one if it is still there, else `Documents\Exports Bullshit`. */
export async function exportFolder(): Promise<string> {
  const remembered = getState().settings.export.folder;
  if (remembered && (await exportApi.folderOk(remembered).catch(() => false))) return remembered;
  return exportApi.defaultFolder(currentMessages().exportDialog.defaultFolder);
}

/** Export › "Change…". */
export async function chooseExportFolder(current: string | null): Promise<string | null> {
  const picked = await exportApi.pickFolder(currentMessages().exportDialog.chooseFolder, current).catch(() => null);
  if (picked) updateSettings((s) => ({ ...s, export: { ...s.export, folder: picked } }));
  return picked;
}

/** The note as Markdown readable anywhere: Ursa's keys out, files copied to `assets/`. */
async function noteMarkdown(note: Note, options: ExportSettings, dir: string): Promise<string> {
  let body = editorText(note.id) ?? note.body;
  if (!options.tags) body = removeTags(body);
  if (!options.images) body = removeImages(body);
  const files = linkedFiles(note.path, body);
  if (files.length) {
    const copied = await exportApi.copyAssets(dir, files);
    const copies = new Map(files.flatMap((f, i) => (copied[i] ? [[f, copied[i]] as const] : [])));
    body = rewriteLinks(note.path, body, copies);
  }
  const patch = Object.fromEntries(URSA_KEYS.map((k) => [k, undefined]));
  let frontmatter: string | null = null;
  try {
    frontmatter = patchFrontmatter(note.frontmatter, patch);
  } catch {
    // Invalid YAML: left out rather than exported broken.
  }
  return joinFrontmatter(frontmatter?.trim() ? frontmatter : null, body);
}

export interface ExportResult {
  /** Files written (full paths). */
  paths: string[];
  /** Notes that could not be exported. */
  failed: Array<{ title: string; message: string }>;
  /** Image exports cut into several images. */
  split: number;
}

/** Exports `ids` to `dir` in `format`; progress through `onProgress(done, total)`. */
export async function runExport(ids: string[], format: ExportFormat, options: ExportSettings, dir: string, onProgress?: (done: number, total: number) => void): Promise<ExportResult> {
  await flushAll();
  const t = currentMessages();
  const { notes, settings } = getState();
  const list = ids.map((id) => notes[id]).filter((n): n is Note => Boolean(n));
  const ext = format === "image" ? options.image : EXTENSIONS[format];
  const stems = new Map(list.map((n) => [n.id, sanitizeStem(n.title, t.untitled)]));
  // Wiki links to another note of this export point to its file.
  const index = noteIndex(notes);
  const wiki = (target: string) => {
    const id = resolveTitle(index.titles, notes, target.split("#")[0]!.trim());
    return id && id !== undefined && stems.has(id) ? `${encodeURI(stems.get(id)!)}.${ext}` : null;
  };
  const result: ExportResult = { paths: [], failed: [], split: 0 };
  for (const [n, note] of list.entries()) {
    onProgress?.(n, list.length);
    const name = `${stems.get(note.id)}.${ext}`;
    try {
      const fresh = { ...note, body: editorText(note.id) ?? note.body };
      switch (format) {
        case "md":
          result.paths.push(await exportApi.write(dir, name, new TextEncoder().encode(await noteMarkdown(fresh, options, dir))));
          break;
        case "html": {
          const page = await exportPage(fresh, { ...options, wiki });
          result.paths.push(await exportApi.write(dir, name, new TextEncoder().encode(page.html)));
          break;
        }
        case "pdf": {
          const page = await exportPage(fresh, { ...options, wiki, page: options.page });
          result.paths.push(await exportApi.pdf(dir, name, page.html, options.page));
          break;
        }
        case "docx": {
          const { noteDocx } = await import("./docx");
          const palette = options.currentTheme ? resolvePalette(settings.appearance, matchMedia("(prefers-color-scheme: dark)").matches) : settings.appearance.light;
          const blob = await noteDocx(fresh, { ...options, palette, wiki });
          result.paths.push(await exportApi.write(dir, name, new Uint8Array(await blob.arrayBuffer())));
          break;
        }
        case "image": {
          const { rasterize } = await import("./raster");
          const page = await exportPage(fresh, { ...options, wiki: () => null });
          const images = await rasterize(page.html, options.image);
          if (images.length > 1) result.split++;
          for (const [i, blob] of images.entries()) {
            const part = images.length > 1 ? `${stems.get(note.id)} (${i + 1}-${images.length}).${ext}` : name;
            result.paths.push(await exportApi.write(dir, part, new Uint8Array(await blob.arrayBuffer())));
          }
          break;
        }
      }
    } catch (e) {
      console.warn("[ursa] export failed", note.path, e);
      result.failed.push({ title: note.title || t.untitled, message: errorMessage(e) });
    }
  }
  onProgress?.(list.length, list.length);
  return result;
}

/** What the toast says, with "Show in folder" for the last file. */
export function reportExport(result: ExportResult): void {
  const t = currentMessages().exportDialog;
  const last = result.paths[result.paths.length - 1];
  const reveal = last ? { label: t.reveal, run: () => void exportApi.reveal(last).catch(() => undefined) } : undefined;
  if (result.failed.length) showToast(t.failed(result.failed[0]!.title, result.failed[0]!.message, result.failed.length), reveal);
  else if (result.split) showToast(t.split(result.paths.length), reveal);
  else showToast(t.done(result.paths.length), reveal);
}
