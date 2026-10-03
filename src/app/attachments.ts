import { basename } from "../core/note/filename";
import { imageMarkdown, linkMarkdown, relativeSrc, resolveVaultPath } from "../core/markdown/embeds";
import { rememberSize } from "../editor/embeds/image";
import type { RemoteImageState } from "../editor/embeds/remoteImage";
import { editorPosAt, insertBlockLines, refreshEditor, replaceImageSrc } from "../editor/session";
import { assetsApi, type Imported } from "../services/assets";
import { errorMessage } from "../services/errors";
import { currentMessages } from "./i18n";
import { getState, showToast } from "./store";

/**
 * Images and PDFs added to the open note: pasted (a Win+Shift+S capture…),
 * dropped from the Explorer or chosen with "Insert image or PDF…". Files are
 * copied into `assets/` (identical files reused) and linked with a relative
 * path, one block per line.
 */

function openNote() {
  const { selectedId, notes } = getState();
  return selectedId ? notes[selectedId] : undefined;
}

/** Markdown lines for the imported files; refusals are explained in a toast. */
function insertImported(results: Imported[], pos?: number): void {
  const note = openNote();
  const t = currentMessages();
  if (!note) return;
  const lines: string[] = [];
  for (const r of results) {
    if (r.status === "refused") {
      showToast(t.images.refused[r.reason](r.name));
      continue;
    }
    const src = relativeSrc(note.path, r.path);
    lines.push(r.format === "pdf" ? linkMarkdown(basename(r.path), src) : imageMarkdown("", src));
  }
  insertBlockLines(note.id, lines, pos);
}

async function run(task: () => Promise<Imported[]>, pos?: number): Promise<void> {
  try {
    insertImported(await task(), pos);
  } catch (e) {
    console.warn("[ursa] attachment failed", e);
    showToast(currentMessages().images.failed(errorMessage(e)));
  }
}

/** Editor hook: files pasted or dropped on the text. */
export function attachFiles(files: File[], pos: number): boolean {
  if (!openNote()) return false;
  void run(async () => Promise.all(files.map(async (f) => assetsApi.importBytes(new Uint8Array(await f.arrayBuffer()), f.name || pastedName(f)))), pos);
  return true;
}

/** Editor hook: paste with neither text nor file in the event (screenshot in the system clipboard). */
export function pasteClipboardImage(pos: number): void {
  if (!openNote()) return;
  void run(async () => {
    const result = await assetsApi.importClipboardImage(pastedName(new File([], "", { type: "image/png" })));
    return result ? [result] : [];
  }, pos);
}

/** Name of a pasted image without one (screenshots): `capture-2026-10-03-143205`. */
function pastedName(file: File): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const ext = file.type.split("/")[1] ?? "png";
  return `capture-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.${ext}`;
}

/** "Insert image or PDF…": native picker. */
export async function insertFromDialog(): Promise<void> {
  const t = currentMessages();
  if (!openNote()) {
    showToast(t.images.noNote);
    return;
  }
  const paths = await assetsApi.pick(t.images.pickTitle).catch(() => []);
  if (paths.length) await run(() => assetsApi.importFiles(paths));
}

/** Explorer drops (Tauri gives file paths, in physical pixels). */
export function connectAttachments(): void {
  void assetsApi
    .onFileDrop((paths, position) => {
      if (!openNote()) {
        showToast(currentMessages().images.noNote);
        return;
      }
      const ratio = window.devicePixelRatio || 1;
      const pos = editorPosAt(position.x / ratio, position.y / ratio) ?? undefined;
      void run(() => assetsApi.importFiles(paths), pos);
    })
    .catch(() => undefined);
}

/** Sizes asked by the editor, read in one batch per frame from the files' headers. */
const wanted = new Map<string, string>();
const asked = new Set<string>();
let batch: ReturnType<typeof setTimeout> | undefined;

/** Editor hook: an image's size is not known yet (stable layout before it loads). */
export function wantSize(src: string, url: string): void {
  const note = openNote();
  const path = note ? resolveVaultPath(note.path, src) : null;
  if (!path || asked.has(url)) return;
  asked.add(url);
  wanted.set(path, url);
  batch ??= setTimeout(() => {
    batch = undefined;
    const entries = [...wanted];
    wanted.clear();
    void assetsApi
      .info(entries.map(([p]) => p))
      .then((infos) => {
        let any = false;
        infos.forEach((info, i) => {
          if (info?.width && info.height) {
            rememberSize(entries[i]![1], { width: info.width, height: info.height });
            any = true;
          }
        });
        if (any) refreshEditor();
      })
      .catch(() => undefined);
  }, 0);
}

/** Editor hook: URL of a file referenced by the open note. */
export function assetUrl(src: string): string | null {
  const note = openNote();
  const path = note ? resolveVaultPath(note.path, src) : null;
  return path ? assetsApi.url(path) : null;
}

/** Remote images being downloaded or that failed (by URL). */
const remoteStates = new Map<string, RemoteImageState>();

/** Editor hook: download state of a remote image. */
export function remoteImage(url: string): RemoteImageState {
  return remoteStates.get(url) ?? { status: "idle" };
}

/**
 * Editor hook: "Download locally". The Rust side fetches it with the link
 * preview's protections (no internal address, timeout, size cap), copies it
 * into assets/ (identical files reused) and the line points to it (undoable).
 */
export function downloadImage(url: string, lineFrom: number): void {
  const note = openNote();
  if (!note || remoteStates.get(url)?.status === "downloading") return;
  const t = currentMessages();
  remoteStates.set(url, { status: "downloading" });
  refreshEditor();
  void assetsApi
    .downloadImage(url)
    .then((result) => {
      if (result.status !== "ok") throw { kind: result.reason };
      remoteStates.delete(url);
      replaceImageSrc(note.id, lineFrom, relativeSrc(note.path, result.path));
    })
    .catch((e: unknown) => {
      const kind = (e as { kind?: string; message?: string })?.message ?? (e as { kind?: string })?.kind ?? "";
      const reason = /blocked/.test(kind) ? t.remote.reasons.blocked : /large|tooLarge/.test(kind) ? t.remote.reasons.tooLarge : /image|unsupported|heic/.test(kind) ? t.remote.reasons.notImage : t.remote.reasons.network;
      remoteStates.set(url, { status: "failed", reason });
    })
    .finally(refreshEditor);
}
