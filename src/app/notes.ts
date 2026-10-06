import { fileStamp, isoLocal } from "../core/dates";
import { textHash } from "../core/hash";
import { titleKey } from "../core/markdown/extract";
import { sanitizeStem, stemOf } from "../core/note/filename";
import {
  newNoteContent,
  noteFromFile,
  serializeNote,
  withBody,
  withFrontmatter,
  withNewId,
  withStoredId,
  withSyntax,
  type Note,
  type NoteFile,
  type Paper,
} from "../core/note/note";
import { applyChanges, wikiLinkRenameChanges, type TextChange } from "../core/rewrite";
import { restoreTagScopes } from "../core/tags";
import { localReferences } from "../core/markdown/embeds";
import { assetsApi } from "../services/assets";

/** Attachments folder of the vault (the Rust side uses the same name). */
const ASSETS_DIR = "assets";
import { editorStickers, editorText, focusEditor, forgetNote, replaceFromDisk, rewriteInEditor, showNote } from "../editor/session";
import { serializeStickers } from "../core/stickers";
import { errorKind } from "../services/errors";
import { vaultApi } from "../services/vault";
import { currentMessages } from "./i18n";
import type { ListFilter } from "./sections";
import { currentList, getState, putNote, removeNotes, setSaveError, setState, showToast, type TagSettings, type ToastAction } from "./store";

/**
 * Note lifecycle: autosave, rename-from-title, create, trash and reconciliation
 * with external changes. Every disk operation goes through one serial queue so
 * writes, renames and watcher reloads never interleave. Failures (a file locked
 * by another program) never lose anything: the text stays pending, the old
 * name is kept, and the operation is retried later. Rename failures stay
 * silent; repeated save failures show an indicator, and closing the app with
 * unsaved text asks what to do.
 */

const SAVE_DELAY = 500;
const RENAME_DELAY = 2000;
const RETRY_DELAYS = [2_000, 5_000, 15_000, 30_000, 60_000];
/** Consecutive save failures tolerated silently before the editor shows the "unsaved" indicator. */
const SILENT_SAVE_FAILURES = 2;

type Timer = ReturnType<typeof setTimeout>;

let queue: Promise<unknown> = Promise.resolve();
function enqueue<T>(op: () => Promise<T>): Promise<T> {
  const run = queue.then(op, op);
  queue = run.catch((e: unknown) => console.error("[ursa]", e));
  return run;
}

/** Latest editor text per note id, not yet written. */
const pendingBodies = new Map<string, string>();
const saveTimers = new Map<string, Timer>();
const renameTimers = new Map<string, Timer>();
/** Consecutive failures per operation, to space out retries. */
const failures = new Map<string, number>();
/** Title of each note at its last rename checkpoint: what wiki links pointed to. */
const lastTitles = new Map<string, string>();
/** Below this many notes, startup indexing runs inline; above, in background batches. */
const INLINE_INDEX_LIMIT = 50;
const INDEX_BATCH = 25;

const noteById = (id: string): Note | undefined => getState().notes[id];
const noteByPath = (path: string): Note | undefined => Object.values(getState().notes).find((n) => n.path === path);

function schedule(timers: Map<string, Timer>, id: string, delay: number, run: (id: string) => void): void {
  clearTimeout(timers.get(id));
  timers.set(
    id,
    setTimeout(() => {
      timers.delete(id);
      run(id);
    }, delay),
  );
}

function cancel(timers: Map<string, Timer>, id: string): boolean {
  const had = timers.has(id);
  clearTimeout(timers.get(id));
  timers.delete(id);
  return had;
}

function nextRetryDelay(key: string): number {
  const count = failures.get(key) ?? 0;
  failures.set(key, count + 1);
  return RETRY_DELAYS[Math.min(count, RETRY_DELAYS.length - 1)]!;
}

/** The note with the stickers of its editor state (anchors recomputed from the text). */
function withEditorStickers(note: Note): Note {
  const list = editorStickers(note.id);
  if (!list) return note;
  const next = serializeStickers(list);
  if (JSON.stringify(next) === JSON.stringify(serializeStickers(note.stickers))) return note;
  return withFrontmatter(note, { stickers: next });
}

/** Writes a note (adding its id to the frontmatter if needed). Runs inside the queue; may throw. */
async function persist(note: Note): Promise<Note> {
  const toWrite = withStoredId(withEditorStickers(note));
  const content = serializeNote(toWrite);
  if (content === toWrite.diskContent) {
    putNote(toWrite);
    return toWrite;
  }
  const mtime = await vaultApi.write(toWrite.path, content);
  const saved = { ...toWrite, diskContent: content, mtime };
  putNote(saved);
  return saved;
}

function save(id: string): Promise<void> {
  return enqueue(async () => {
    const body = pendingBodies.get(id);
    const note = noteById(id);
    if (body === undefined || !note) return;
    pendingBodies.delete(id);
    try {
      await persist(withBody(note, body));
      failures.delete(`save:${id}`);
      setSaveError(id, null);
    } catch (e) {
      // Keep the text (unless newer text arrived meanwhile) and try again later.
      if (!pendingBodies.has(id)) pendingBodies.set(id, body);
      console.warn("[ursa] save failed, will retry", note.path, e);
      const key = `save:${id}`;
      schedule(saveTimers, id, nextRetryDelay(key), (i) => void save(i));
      if ((failures.get(key) ?? 0) > SILENT_SAVE_FAILURES) setSaveError(id, errorKind(e));
    }
  });
}

/**
 * Safety copies before bulk operations (tag rename/removal, link rewrites,
 * permanent deletion, restoring a backup): the files about to change are
 * copied to `.ursa/backups/<date-time>-<operation>/` first. The toast offers
 * "Undo", and Settings › Backups lists them; both restore the copies only if
 * none of the notes was edited since (Settings asks before overriding that).
 */
export type BulkOperation = "rename-tag" | "delete-tag" | "update-links" | "delete-notes" | "empty-trash" | "restore";
export const BULK_OPERATIONS: readonly BulkOperation[] = ["rename-tag", "delete-tag", "update-links", "delete-notes", "empty-trash", "restore"];
/** Backups older than this are purged at startup. */
const BACKUP_MAX_AGE = 30 * 24 * 3_600_000;
/** Undo records kept in memory (one per recent toast). */
const UNDO_LIMIT = 10;

/** One copied note; the list is also saved as the backup's `manifest.json`. */
interface UndoItem {
  id: string;
  /** Path of the copy inside the backup = the note's path before the operation. */
  from: string;
  /** Title before the operation (shown when the note no longer exists). */
  title?: string;
  /**
   * Fingerprint (`textHash`) of the text right after the operation; `null` for
   * a note the operation deleted; `undefined` when unknown (backup without manifest).
   */
  expected?: string | null;
}
/**
 * Tag settings an operation changes (rename, removal): their state before it,
 * saved as the backup's `tags.json`, and the tags affected (old and new names).
 */
export interface TagUndo {
  scopes: string[];
  snapshot: Record<string, TagSettings>;
}
interface UndoRecord {
  items: UndoItem[];
  tags?: TagUndo;
  /** Attachments sent to the recycle bin with the notes (orphan images, PDFs), copied in the backup. */
  assets?: string[];
}
interface Manifest {
  version: 1;
  items: UndoItem[];
  tagScopes?: string[];
  assets?: string[];
}
const undoRecords = new Map<string, UndoRecord>();

/** Raised when the safety copy cannot be made: the operation is not run. */
export class BackupFailedError extends Error {}

/**
 * Writes pending text of the notes (so their files are current), then copies
 * them. Runs inside the queue; throws BackupFailedError on any failure.
 */
async function backupBefore(op: BulkOperation, ids: string[], assets: string[] = []): Promise<string> {
  try {
    for (const id of ids) {
      const body = pendingBodies.get(id);
      const note = noteById(id);
      if (body === undefined || !note) continue;
      cancel(saveTimers, id);
      pendingBodies.delete(id);
      try {
        await persist(withBody(note, body));
      } catch (e) {
        pendingBodies.set(id, body);
        throw e;
      }
    }
    const paths = [...ids.flatMap((id) => noteById(id)?.path ?? []), ...assets];
    return await vaultApi.backup(`${fileStamp()}-${op}`, paths);
  } catch (e) {
    console.warn("[ursa] backup failed, operation cancelled", op, e);
    throw new BackupFailedError(String(e));
  }
}

/** Keeps the undo record in memory and writes it next to the copies (for Settings › Backups, after a restart). */
function remember(name: string, record: UndoRecord): void {
  undoRecords.set(name, record);
  for (const key of undoRecords.keys()) {
    if (undoRecords.size <= UNDO_LIMIT) break;
    undoRecords.delete(key);
  }
  const manifest: Manifest = {
    version: 1,
    items: record.items,
    ...(record.tags && { tagScopes: record.tags.scopes }),
    ...(record.assets?.length && { assets: record.assets }),
  };
  const write = (file: "manifest.json" | "tags.json", content: unknown) =>
    vaultApi.writeBackupFile(name, file, JSON.stringify(content)).catch((e: unknown) => console.warn("[ursa] backup file not written", name, file, e));
  void write("manifest.json", manifest);
  if (record.tags) void write("tags.json", { version: 1, tags: record.tags.snapshot });
}

/** Attachments deleted with the notes come back too (never over a file that is there again). */
async function restoreAssets(name: string, assets: string[] | undefined): Promise<void> {
  if (!assets?.length) return;
  await vaultApi.restoreAssets(name, assets).catch((e: unknown) => console.warn("[ursa] attachments not restored", name, e));
}

/** Tag settings back as they were before the operation (Undo and Settings › Restore alike). */
function restoreTags(tags: TagUndo | undefined): void {
  if (!tags) return;
  setState((s) => ({ tagConfig: restoreTagScopes(s.tagConfig, tags.snapshot, tags.scopes) }));
}

/** Expected state of a note after the operation, for `UndoItem.expected`. */
const afterOperation = (text: string | null) => (text === null ? null : textHash(text));

/** Whether a note is still exactly as the operation left it. */
function untouchedSince(item: UndoItem): boolean {
  if (item.expected === undefined) return false;
  if (item.expected === null) return !noteById(item.id);
  return noteById(item.id) !== undefined && textHash(currentText(item.id)) === item.expected;
}

function parseManifest(text: string | null): UndoItem[] | null {
  try {
    const parsed = text ? (JSON.parse(text) as Partial<Manifest>) : null;
    if (!parsed || !Array.isArray(parsed.items)) return null;
    return parsed.items.filter(
      (i): i is UndoItem =>
        typeof i?.id === "string" &&
        typeof i.from === "string" &&
        (i.title === undefined || typeof i.title === "string") &&
        (i.expected === null || i.expected === undefined || typeof i.expected === "string"),
    );
  } catch {
    return null;
  }
}

function parseTagUndo(manifest: string | null, tags: string | null): TagUndo | undefined {
  try {
    const scopes = manifest ? (JSON.parse(manifest) as Partial<Manifest>).tagScopes : undefined;
    const snapshot = tags ? (JSON.parse(tags) as { tags?: unknown }).tags : undefined;
    if (!Array.isArray(scopes) || !scopes.every((s) => typeof s === "string")) return undefined;
    if (!snapshot || typeof snapshot !== "object") return undefined;
    return { scopes, snapshot: snapshot as Record<string, TagSettings> };
  } catch {
    return undefined;
  }
}

/** What a backup restores: from memory, its manifest (+ tags.json), or (older backups) the ids inside the copies. */
async function backupRecord(name: string): Promise<UndoRecord> {
  const kept = undoRecords.get(name);
  if (kept) return kept;
  const { manifest, tags, files } = await vaultApi.readBackup(name);
  const items =
    parseManifest(manifest) ??
    files.map((file) => {
      const note = noteFromFile(file);
      return { id: note.id, from: file.path, title: note.title };
    });
  let assets: string[] | undefined;
  try {
    const listed = manifest ? (JSON.parse(manifest) as Partial<Manifest>).assets : undefined;
    if (Array.isArray(listed)) assets = listed.filter((a): a is string => typeof a === "string");
  } catch {
    assets = undefined;
  }
  return { items, tags: parseTagUndo(manifest, tags), assets };
}

/** Writes the copies back and updates the index and the editor. Runs inside the queue. */
async function restoreItems(name: string, items: UndoItem[]): Promise<Note[]> {
  const targets = items.map((item) => {
    const note = noteById(item.id);
    return { from: item.from, to: note?.path ?? item.from, create: !note };
  });
  const files = await vaultApi.restore(name, targets);
  return files.map((file, i) => {
    const { id } = items[i]!;
    const existed = !targets[i]!.create;
    if (existed) {
      cancel(saveTimers, id);
      pendingBodies.delete(id);
    }
    const note = noteFromFile(file, id);
    putNote(note);
    lastTitles.set(note.id, note.title);
    if (existed) replaceFromDisk(id, note.body, note.stickers);
    return note;
  });
}

export type UndoResult = "undone" | "changed" | "failed" | "expired";

/** Toast "Undo": restores the files of a bulk operation, unless one of its notes was edited since. */
export function undoBulk(name: string): Promise<UndoResult> {
  return enqueue(async () => {
    const record = undoRecords.get(name);
    if (!record) return "expired";
    if (!record.items.every(untouchedSince)) return "changed";
    try {
      await restoreItems(name, record.items);
    } catch (e) {
      console.warn("[ursa] undo failed", name, e);
      return "failed";
    }
    undoRecords.delete(name);
    restoreTags(record.tags);
    await restoreAssets(name, record.assets);
    return "undone";
  });
}

/** Toast action that undoes a bulk operation and reports the outcome. */
export function undoAction(name: string): ToastAction {
  const t = currentMessages();
  return {
    label: t.undo.action,
    run: () => void undoBulk(name).then((result) => showToast(t.undo.results[result])),
  };
}

export interface BackupSummary {
  name: string;
  /** Local time of the operation (from the name). */
  time: number | null;
  operation: BulkOperation | null;
  notes: number;
}

/** Settings › Backups, newest first. */
export async function listBackups(): Promise<BackupSummary[]> {
  const list = await vaultApi.listBackups();
  return list.map(({ name, notes }) => ({ name, notes, ...parseBackupName(name) }));
}

/** `2026-10-02_15-04-05-rename-tag(-2)` → time and operation. */
export function parseBackupName(name: string): { time: number | null; operation: BulkOperation | null } {
  const m = /^(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})-(.+?)(?:-\d+)?$/.exec(name);
  if (!m) return { time: null, operation: null };
  const [y, mo, d, h, mi, s] = m.slice(1, 7).map(Number) as [number, number, number, number, number, number];
  const op = m[7] as BulkOperation;
  return { time: new Date(y, mo - 1, d, h, mi, s).getTime(), operation: BULK_OPERATIONS.includes(op) ? op : null };
}

export type RestoreResult =
  | { kind: "restored"; count: number; backup: string | null }
  /** Some notes were edited since (or cannot be checked): nothing done, ask first. */
  | { kind: "changed"; titles: string[] }
  | { kind: "failed" };

/**
 * Settings › Backups › "Restore": same check as Undo; with `force`, restores
 * anyway after copying the current versions (so the restore itself can be undone).
 */
export function restoreBackup(name: string, force: boolean): Promise<RestoreResult> {
  return enqueue(async (): Promise<RestoreResult> => {
    let record: UndoRecord;
    try {
      record = await backupRecord(name);
    } catch (e) {
      console.warn("[ursa] backup unreadable", name, e);
      return { kind: "failed" };
    }
    const { items } = record;
    const changed = items.filter((item) => !untouchedSince(item));
    if (changed.length && !force) {
      return { kind: "changed", titles: changed.map((item) => noteById(item.id)?.title ?? item.title ?? stemOf(item.from)) };
    }
    const existing = items.filter((item) => noteById(item.id)).map((item) => item.id);
    const safety = existing.length ? await backupBefore("restore", existing) : null;
    const before = new Map(existing.map((id) => [id, noteById(id)!.path]));
    const tagsBefore = record.tags && { scopes: record.tags.scopes, snapshot: getState().tagConfig };
    let restored: Note[];
    try {
      restored = await restoreItems(name, items);
    } catch (e) {
      console.warn("[ursa] restore failed", name, e);
      return { kind: "failed" };
    }
    restoreTags(record.tags);
    await restoreAssets(name, record.assets);
    if (safety) {
      const undo = restored.filter((n) => before.has(n.id)).map((n) => ({ id: n.id, from: before.get(n.id)!, title: n.title, expected: afterOperation(n.body) }));
      remember(safety, { items: undo, tags: tagsBefore });
    }
    undoRecords.delete(name);
    return { kind: "restored", count: restored.length, backup: safety };
  });
}

/** Startup: removes safety copies older than 30 days. */
export function purgeOldBackups(now = Date.now()): Promise<void> {
  return vaultApi
    .purgeBackups(fileStamp(now - BACKUP_MAX_AGE))
    .then(() => undefined)
    .catch((e: unknown) => console.warn("[ursa] backup purge failed", e));
}

/** Latest text of a note: the editor's if it is open or cached, else pending, else saved. */
function currentText(id: string): string {
  return editorText(id) ?? pendingBodies.get(id) ?? noteById(id)?.body ?? "";
}

export interface BulkResult {
  /** Notes changed. */
  count: number;
  /** Backup to pass to `undoAction`, or null if nothing changed. */
  backup: string | null;
}

/**
 * Applies text edits to several notes (wiki links, tags), after a safety copy.
 * The open note is changed through an editor transaction, so Ctrl+Z undoes it;
 * other notes are written directly. Runs inside the queue.
 */
async function applyRewrites(op: BulkOperation, changesById: Map<string, TextChange[]>, tags?: TagUndo): Promise<BulkResult> {
  const ids = [...changesById].filter(([id, c]) => c.length > 0 && noteById(id)).map(([id]) => id);
  if (ids.length === 0) return { count: 0, backup: null };
  const backup = await backupBefore(op, ids);
  const items: UndoItem[] = [];
  for (const id of ids) {
    const changes = changesById.get(id)!;
    const note = noteById(id)!;
    const before = currentText(id);
    const body = applyChanges(before, changes);
    items.push({ id, from: note.path, title: note.title, expected: afterOperation(body) });
    if (rewriteInEditor(id, changes) === "view") continue; // saved by the editor's own autosave
    pendingBodies.delete(id);
    cancel(saveTimers, id);
    try {
      await persist(withBody(note, body));
    } catch (e) {
      pendingBodies.set(id, body);
      schedule(saveTimers, id, nextRetryDelay(`save:${id}`), (i) => void save(i));
      console.warn("[ursa] rewrite saved later", note.path, e);
    }
  }
  remember(backup, { items, tags });
  return { count: ids.length, backup };
}

/** Notes worth re-parsing for a rewrite: the index says so, or their text is newer than the index. */
function rewriteCandidates(indexed: (note: Note) => boolean): Note[] {
  return Object.values(getState().notes).filter(
    (n) => n.syntax === null || indexed(n) || pendingBodies.has(n.id) || editorText(n.id) !== null,
  );
}

/** Public entry point for tag renames/removals: same queue, same rules. Rejects with BackupFailedError. */
export function rewriteNotes(
  op: BulkOperation,
  indexed: (note: Note) => boolean,
  compute: (text: string) => TextChange[],
  tags?: TagUndo,
): Promise<BulkResult> {
  return enqueue(async () => {
    const changes = new Map<string, TextChange[]>();
    for (const note of rewriteCandidates(indexed)) {
      const c = compute(currentText(note.id));
      if (c.length) changes.set(note.id, c);
    }
    return applyRewrites(op, changes, tags);
  });
}

/**
 * Rename checkpoint, part 1 (strategy in PROGRESS.md): links written for the
 * note's previous title are rewritten to the new one, keeping anchor and
 * alias. Skipped when the old title is ambiguous. Runs inside the queue.
 */
async function updateLinksToRetitledNote(id: string): Promise<void> {
  const note = noteById(id);
  if (!note) return;
  const previous = lastTitles.get(id);
  if (!previous || !note.title || titleKey(previous) === titleKey(note.title)) {
    lastTitles.set(id, note.title);
    return;
  }
  const others = Object.values(getState().notes).filter((n) => n.id !== id && !n.trashed);
  if (others.some((n) => n.title && titleKey(n.title) === titleKey(previous))) return;
  const changes = new Map<string, TextChange[]>();
  let links = 0;
  const oldKey = titleKey(previous);
  for (const n of rewriteCandidates((x) => x.syntax?.links.some((l) => titleKey(l.target) === oldKey) ?? false)) {
    const c = wikiLinkRenameChanges(currentText(n.id), previous, note.title);
    if (c.length) {
      changes.set(n.id, c);
      links += c.length;
    }
  }
  try {
    const { count, backup } = await applyRewrites("update-links", changes);
    lastTitles.set(id, note.title);
    if (backup) showToast(currentMessages().links.updated(links, count), undoAction(backup));
  } catch (e) {
    // Links keep the old title; retried at the next rename checkpoint.
    if (!(e instanceof BackupFailedError)) throw e;
    showToast(currentMessages().undo.linksNotUpdated);
  }
}

function renameFromTitle(id: string): Promise<void> {
  return enqueue(async () => {
    await updateLinksToRetitledNote(id);
    const note = noteById(id);
    if (!note) return;
    const desired = sanitizeStem(note.title, currentMessages().untitled);
    if (stemOf(note.path) === desired) return;
    try {
      // The backend picks the final name (collision suffix, MAX_PATH) or keeps the current one.
      const path = await vaultApi.rename(note.path, desired);
      failures.delete(`rename:${id}`);
      const current = noteById(id);
      if (current && current.path !== path) putNote({ ...current, path });
    } catch (e) {
      console.warn("[ursa] rename failed, keeping the old name for now", note.path, e);
      schedule(renameTimers, id, nextRetryDelay(`rename:${id}`), (i) => void renameFromTitle(i));
    }
  });
}

/** Called by the editor on every change. */
export function editNote(id: string, body: string): void {
  pendingBodies.set(id, body);
  schedule(saveTimers, id, SAVE_DELAY, (i) => void save(i));
  schedule(renameTimers, id, RENAME_DELAY, (i) => void renameFromTitle(i));
}

/** Saves now (and renames if the title changed) instead of waiting. Never rejects. */
export async function flushNote(id: string): Promise<void> {
  const needsSave = cancel(saveTimers, id) || pendingBodies.has(id);
  const needsRename = cancel(renameTimers, id);
  if (needsSave) await save(id);
  if (needsRename || needsSave) await renameFromTitle(id);
}

export async function flushAll(): Promise<void> {
  const ids = new Set([...pendingBodies.keys(), ...saveTimers.keys(), ...renameTimers.keys()]);
  await Promise.all([...ids].map(flushNote));
}

/** Notes whose latest text could not be written, as they would be saved. */
export function unsavedNotes(): Array<{ id: string; title: string; content: string }> {
  return [...pendingBodies].flatMap(([id, body]) => {
    const note = noteById(id);
    return note ? [{ id, title: note.title, content: serializeNote(withStoredId(withEditorStickers(withBody(note, body)))) }] : [];
  });
}

/** Before the window closes: saves everything; false if some text is still unsaved. */
export async function prepareClose(): Promise<boolean> {
  await flushAll();
  return pendingBodies.size === 0;
}

/**
 * Before opening another vault: saves everything and waits for the queue.
 * False (and nothing forgotten) if some text could not be written; otherwise
 * every note of this vault is forgotten.
 */
export async function closeVault(): Promise<boolean> {
  const selected = getState().selectedId;
  selectNote(null);
  await flushAll();
  await enqueue(async () => undefined);
  if (pendingBodies.size > 0) {
    selectNote(selected);
    return false;
  }
  for (const timer of [...saveTimers.values(), ...renameTimers.values()]) clearTimeout(timer);
  saveTimers.clear();
  renameTimers.clear();
  failures.clear();
  lastTitles.clear();
  undoRecords.clear();
  setState({ notes: {}, saveErrors: {}, stickerDrawer: false, stickerLibrary: [] });
  return true;
}

export function selectNote(id: string | null): void {
  const previous = getState().selectedId;
  if (previous === id) return;
  if (previous) void flushNote(previous);
  setState({ selectedId: id });
  const note = id ? noteById(id) : undefined;
  showNote(id, note?.body ?? "", note?.stickers ?? []);
}

/** New note, empty or with a title (e.g. from a link to a note that does not exist yet). */
export async function createNote(title?: string): Promise<void> {
  const untitled = currentMessages().untitled;
  const note = await enqueue(async () => {
    const file = await vaultApi.create(sanitizeStem(title ?? "", untitled), newNoteContent(Date.now(), title));
    const created = noteFromFile(file);
    putNote(created);
    lastTitles.set(created.id, created.title);
    return created;
  });
  // A note created from a filtered view must be visible: fall back to "Notes".
  if (!currentList().some((n) => n.id === note.id)) setState({ filter: { kind: "section", section: "notes" } });
  selectNote(note.id);
  focusEditor(true);
}

/** Keeps a sensible selection when a note leaves the current list. */
function reselectAfter(id: string, listBefore: Note[]): void {
  if (getState().selectedId !== id || currentList().some((n) => n.id === id)) return;
  const index = listBefore.findIndex((n) => n.id === id);
  const next = listBefore[index + 1] ?? listBefore[index - 1];
  selectNote(next && next.id !== id ? next.id : null);
}

async function patchFlags(id: string, patch: Record<string, unknown>): Promise<void> {
  const before = currentList();
  await flushNote(id);
  await enqueue(async () => {
    const note = noteById(id);
    if (note) await persist(withFrontmatter(note, patch));
  });
  reselectAfter(id, before);
}

export const trashNote = (id: string) => patchFlags(id, { trashed: isoLocal() });
export const restoreNote = (id: string) => patchFlags(id, { trashed: undefined });
export const setPinned = (id: string, pinned: boolean) => patchFlags(id, { pinned: pinned || undefined });
export const setArchived = (id: string, archived: boolean) => patchFlags(id, { archived: archived || undefined });
/** Page background of a note, written to its frontmatter [DESIGN §7]. */
export const setPaper = (id: string, paper: Paper, margin: boolean) => patchFlags(id, { paper, margin });

/**
 * "Delete permanently" from the trash: after a safety copy, the files go to
 * the system recycle bin. Rejects with BackupFailedError (nothing deleted).
 */
export async function deleteNotes(ids: string[], op: BulkOperation = "delete-notes"): Promise<BulkResult> {
  const before = currentList();
  const result = await enqueue(async (): Promise<BulkResult> => {
    const present = ids.filter((id) => noteById(id));
    if (present.length === 0) return { count: 0, backup: null };
    const orphans = await orphanAssets(present);
    const backup = await backupBefore(op, present, orphans);
    const items: UndoItem[] = [];
    for (const id of present) {
      const note = noteById(id)!;
      await vaultApi.remove(note.path);
      items.push({ id, from: note.path, title: note.title, expected: afterOperation(null) });
      forget(id);
      removeNotes([id]);
    }
    // Their attachments that no other note uses go to the recycle bin too.
    for (const path of orphans) await vaultApi.remove(path).catch((e: unknown) => console.warn("[ursa] attachment not deleted", path, e));
    remember(backup, { items, assets: orphans });
    return { count: items.length, backup };
  });
  for (const id of ids) reselectAfter(id, before);
  if (getState().selectedId === null) selectNote(currentList()[0]?.id ?? null);
  return result;
}

/**
 * Files of `assets/` that the notes `ids` point to and no other note does
 * (trash and archive included), and that still exist.
 */
async function orphanAssets(ids: string[]): Promise<string[]> {
  const leaving = new Set(ids);
  const theirs = new Set<string>();
  for (const id of ids) {
    const note = noteById(id)!;
    for (const path of localReferences(note.path, currentText(id))) if (path.startsWith(`${ASSETS_DIR}/`)) theirs.add(path);
  }
  if (theirs.size === 0) return [];
  for (const note of Object.values(getState().notes)) {
    if (leaving.has(note.id)) continue;
    for (const path of localReferences(note.path, currentText(note.id))) theirs.delete(path);
  }
  const candidates = [...theirs];
  const infos = await assetsApi.info(candidates).catch(() => candidates.map(() => null));
  return candidates.filter((_, i) => infos[i] !== null);
}

export function trashedNoteIds(): string[] {
  return Object.values(getState().notes)
    .filter((n) => n.trashed)
    .map((n) => n.id);
}

function forget(id: string): void {
  forgetNote(id);
  cancel(saveTimers, id);
  cancel(renameTimers, id);
  pendingBodies.delete(id);
  failures.delete(`save:${id}`);
  lastTitles.delete(id);
  setSaveError(id, null);
}

/** Shows a section or a tag; keeps the selection if it is in the new list. */
export function setFilter(filter: ListFilter): void {
  setState({ filter });
  const list = currentList();
  const selected = getState().selectedId;
  if (!selected || !list.some((n) => n.id === selected)) selectNote(list[0]?.id ?? null);
}

/** Opens a note from a link, switching to a list that contains it if needed. */
export function revealNote(id: string): void {
  const note = noteById(id);
  if (!note) return;
  if (!currentList().some((n) => n.id === id)) {
    const section = note.trashed ? "trash" : note.archived ? "archive" : "notes";
    setState({ filter: { kind: "section", section } });
  }
  selectNote(id);
}

/** Extracts tags, links and todos of notes loaded without them, in small batches. */
async function indexInBackground(): Promise<void> {
  for (;;) {
    const batch = Object.values(getState().notes)
      .filter((n) => n.syntax === null)
      .slice(0, INDEX_BATCH);
    if (batch.length === 0) return;
    setState((s) => {
      const notes = { ...s.notes };
      for (const n of batch) if (notes[n.id]) notes[n.id] = withSyntax(notes[n.id]!);
      return { notes };
    });
    await new Promise((r) => setTimeout(r, 0));
  }
}

/** Gives a copied note (same frontmatter id as another file) its own identity. */
async function reidentify(note: Note): Promise<void> {
  const fresh = withNewId(note);
  try {
    await persist(fresh);
  } catch (e) {
    // Kept in memory under its new id; the id is written with the next save.
    console.warn("[ursa] could not write the new id yet", note.path, e);
    putNote(fresh);
  }
}

/**
 * Builds the index from the vault's files and selects the first note. If two
 * files share an id (a note copied in Explorer), the older file keeps it.
 */
export function loadNotes(files: NoteFile[]): Promise<void> {
  return enqueue(async () => {
    const notes: Record<string, Note> = {};
    const copies: Note[] = [];
    const ordered = [...files].sort((a, b) => a.created - b.created || a.path.localeCompare(b.path));
    const defer = files.length > INLINE_INDEX_LIMIT;
    for (const file of ordered) {
      const note = noteFromFile(file, undefined, defer);
      lastTitles.set(note.id, note.title);
      if (notes[note.id]) copies.push(note);
      else notes[note.id] = note;
    }
    setState({ notes });
    for (const copy of copies) await reidentify(copy);
  }).then(() => {
    selectNote(currentList()[0]?.id ?? null);
    void indexInBackground();
  });
}

/**
 * Reconciles the paths reported by the watcher.
 * - Our own writes and renames come back too: the file content equals
 *   `diskContent` (or the old path is no longer in the index), so nothing
 *   changes in the store — no duplicate, no flicker.
 * - A note renamed or moved outside Ursa shows up as one vanished path plus
 *   one new path carrying the same id: it stays the same note.
 */
export function handleDiskChanges(paths: string[]): Promise<void> {
  return enqueue(async () => {
    const reads = await Promise.all(paths.map(async (path) => [path, await vaultApi.read(path)] as const));
    const vanished = new Map<string, Note>();
    const added: NoteFile[] = [];

    for (const [path, file] of reads) {
      const existing = noteByPath(path);
      if (!file) {
        if (existing) vanished.set(existing.id, existing);
      } else if (!existing) {
        added.push(file);
      } else if (file.content !== existing.diskContent && !pendingBodies.has(existing.id)) {
        // Edited outside Ursa. A note with unsaved local edits keeps them: they are written next.
        const updated = noteFromFile(file, existing.id);
        if (updated.id === existing.id) {
          putNote(updated);
          lastTitles.set(updated.id, updated.title);
          replaceFromDisk(existing.id, updated.body, updated.stickers);
        } else {
          // Its id was edited by hand: treat as a different note.
          vanished.set(existing.id, existing);
          added.push(file);
        }
      }
    }

    for (const file of added) {
      const note = noteFromFile(file);
      const holder = noteById(note.id);
      if (holder && vanished.has(note.id)) {
        vanished.delete(note.id);
        putNote(note);
        replaceFromDisk(note.id, note.body, note.stickers);
      } else if (holder && (await vaultApi.read(holder.path)) === null) {
        // Moved outside Ursa, the old path being reported in another batch.
        putNote(note);
        replaceFromDisk(note.id, note.body, note.stickers);
      } else if (holder) {
        await reidentify(note);
      } else {
        putNote(note);
      }
      lastTitles.set(note.id, note.title);
    }

    const selectedVanished = vanished.has(getState().selectedId ?? "");
    if (selectedVanished) showNote(null, "", []);
    for (const id of vanished.keys()) forget(id);
    removeNotes([...vanished.keys()]);
    if (selectedVanished) selectNote(currentList()[0]?.id ?? null);
  });
}
