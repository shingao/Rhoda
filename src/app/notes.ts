import { isoLocal } from "../core/dates";
import { sanitizeStem, stemOf } from "../core/note/filename";
import {
  newNoteContent,
  noteFromFile,
  serializeNote,
  withBody,
  withFrontmatter,
  withNewId,
  withStoredId,
  type Note,
  type NoteFile,
} from "../core/note/note";
import { focusEditor, forgetNote, replaceFromDisk, showNote } from "../editor/session";
import { errorKind } from "../services/errors";
import { vaultApi } from "../services/vault";
import { currentMessages } from "./i18n";
import { currentList, getState, putNote, removeNotes, setSaveError, setState } from "./store";

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

/** Writes a note (adding its id to the frontmatter if needed). Runs inside the queue; may throw. */
async function persist(note: Note): Promise<Note> {
  const toWrite = withStoredId(note);
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

function renameFromTitle(id: string): Promise<void> {
  return enqueue(async () => {
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
    return note ? [{ id, title: note.title, content: serializeNote(withStoredId(withBody(note, body))) }] : [];
  });
}

/** Before the window closes: saves everything; false if some text is still unsaved. */
export async function prepareClose(): Promise<boolean> {
  await flushAll();
  return pendingBodies.size === 0;
}

export function selectNote(id: string | null): void {
  const previous = getState().selectedId;
  if (previous === id) return;
  if (previous) void flushNote(previous);
  setState({ selectedId: id });
  showNote(id, id ? (noteById(id)?.body ?? "") : "");
}

export async function createNote(): Promise<void> {
  const note = await enqueue(async () => {
    const file = await vaultApi.create(currentMessages().untitled, newNoteContent());
    const created = noteFromFile(file);
    putNote(created);
    return created;
  });
  selectNote(note.id);
  focusEditor(true);
}

export async function trashNote(id: string): Promise<void> {
  const list = currentList();
  const index = list.findIndex((n) => n.id === id);
  await flushNote(id);
  await enqueue(async () => {
    const note = noteById(id);
    if (note) await persist(withFrontmatter(note, { trashed: isoLocal() }));
  });
  if (getState().selectedId === id) {
    const next = list[index + 1] ?? list[index - 1];
    selectNote(next && next.id !== id ? next.id : null);
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
    for (const file of ordered) {
      const note = noteFromFile(file);
      if (notes[note.id]) copies.push(note);
      else notes[note.id] = note;
    }
    setState({ notes });
    for (const copy of copies) await reidentify(copy);
  }).then(() => selectNote(currentList()[0]?.id ?? null));
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
          replaceFromDisk(existing.id, updated.body);
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
        if (holder.body !== note.body) replaceFromDisk(note.id, note.body);
      } else if (holder && (await vaultApi.read(holder.path)) === null) {
        // Moved outside Ursa, the old path being reported in another batch.
        putNote(note);
        if (holder.body !== note.body) replaceFromDisk(note.id, note.body);
      } else if (holder) {
        await reidentify(note);
      } else {
        putNote(note);
      }
    }

    const selectedVanished = vanished.has(getState().selectedId ?? "");
    if (selectedVanished) showNote(null, "");
    for (const id of vanished.keys()) {
      forgetNote(id);
      cancel(saveTimers, id);
      cancel(renameTimers, id);
      pendingBodies.delete(id);
      failures.delete(`save:${id}`);
      setSaveError(id, null);
    }
    removeNotes([...vanished.keys()]);
    if (selectedVanished) selectNote(currentList()[0]?.id ?? null);
  });
}
