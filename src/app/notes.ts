import { isoLocal } from "../core/dates";
import { sanitizeStem, stemMatches, stemOf, UNTITLED } from "../core/note/filename";
import { newNoteContent, noteFromFile, serializeNote, withBody, withFrontmatter, withId, type Note, type NoteFile } from "../core/note/note";
import { focusEditor, forgetNote, replaceFromDisk, showNote } from "../editor/session";
import { vaultApi } from "../services/vault";
import { currentList, getState, putNote, removeNotes, setState } from "./store";

/**
 * Note lifecycle: autosave, rename-from-title, create, trash and reconciliation
 * with external changes. Every disk mutation goes through one serial queue so
 * writes, renames and watcher reloads never interleave.
 */

const SAVE_DELAY = 500;
const RENAME_DELAY = 2000;

let queue: Promise<unknown> = Promise.resolve();
function enqueue<T>(op: () => Promise<T>): Promise<T> {
  const run = queue.then(op, op);
  queue = run.catch((e: unknown) => console.error("[ursa]", e));
  return run;
}

/** Latest editor text per note, not yet written. */
const pendingBodies = new Map<string, string>();
const saveTimers = new Map<string, number>();
const renameTimers = new Map<string, number>();

const newUid = () => crypto.randomUUID();
const noteByUid = (uid: string): Note | undefined => getState().notes[uid];
const noteByPath = (path: string): Note | undefined => Object.values(getState().notes).find((n) => n.path === path);

function schedule(timers: Map<string, number>, uid: string, delay: number, run: (uid: string) => void): void {
  window.clearTimeout(timers.get(uid));
  timers.set(
    uid,
    window.setTimeout(() => {
      timers.delete(uid);
      run(uid);
    }, delay),
  );
}

function cancel(timers: Map<string, number>, uid: string): boolean {
  const had = timers.has(uid);
  window.clearTimeout(timers.get(uid));
  timers.delete(uid);
  return had;
}

/** Writes a note if its serialized content differs from disk. Runs inside the queue. */
async function persist(note: Note): Promise<Note> {
  if (serializeNote(note) === note.diskContent) {
    putNote(note);
    return note;
  }
  const withIdentity = withId(note);
  const content = serializeNote(withIdentity);
  const mtime = await vaultApi.write(withIdentity.path, content);
  const saved = { ...withIdentity, diskContent: content, mtime };
  putNote(saved);
  return saved;
}

function save(uid: string): Promise<void> {
  return enqueue(async () => {
    const body = pendingBodies.get(uid);
    const note = noteByUid(uid);
    if (body === undefined || !note) return;
    pendingBodies.delete(uid);
    await persist(withBody(note, body));
  });
}

function renameFromTitle(uid: string): Promise<void> {
  return enqueue(async () => {
    const note = noteByUid(uid);
    if (!note) return;
    const desired = sanitizeStem(note.title || UNTITLED);
    if (stemMatches(stemOf(note.path), desired)) return;
    const path = await vaultApi.rename(note.path, desired);
    const current = noteByUid(uid);
    if (current) putNote({ ...current, path });
  });
}

/** Called by the editor on every change. */
export function editNote(uid: string, body: string): void {
  pendingBodies.set(uid, body);
  schedule(saveTimers, uid, SAVE_DELAY, (u) => void save(u));
  schedule(renameTimers, uid, RENAME_DELAY, (u) => void renameFromTitle(u));
}

/** Saves now (and renames if the title changed) instead of waiting for the debounce. */
export async function flushNote(uid: string): Promise<void> {
  const needsSave = cancel(saveTimers, uid) || pendingBodies.has(uid);
  const needsRename = cancel(renameTimers, uid);
  if (needsSave) await save(uid);
  if (needsRename || needsSave) await renameFromTitle(uid);
}

export async function flushAll(): Promise<void> {
  const uids = new Set([...pendingBodies.keys(), ...saveTimers.keys(), ...renameTimers.keys()]);
  await Promise.all([...uids].map(flushNote));
}

export function selectNote(uid: string | null): void {
  const previous = getState().selectedUid;
  if (previous === uid) return;
  if (previous) void flushNote(previous);
  setState({ selectedUid: uid });
  showNote(uid, uid ? (noteByUid(uid)?.body ?? "") : "");
}

export async function createNote(): Promise<void> {
  const file = await enqueue(() => vaultApi.create(UNTITLED, newNoteContent()));
  const note = noteFromFile(file, newUid());
  putNote(note);
  selectNote(note.uid);
  focusEditor(true);
}

export async function trashNote(uid: string): Promise<void> {
  const list = currentList();
  const index = list.findIndex((n) => n.uid === uid);
  await flushNote(uid);
  await enqueue(async () => {
    const note = noteByUid(uid);
    if (note) await persist(withFrontmatter(note, { trashed: isoLocal() }));
  });
  if (getState().selectedUid === uid) {
    const next = list[index + 1] ?? list[index - 1];
    selectNote(next && next.uid !== uid ? next.uid : null);
  }
}

/** Replaces the index with the vault's notes and selects the first one. */
export function loadNotes(files: NoteFile[]): void {
  const notes: Record<string, Note> = {};
  for (const file of files) {
    const note = noteFromFile(file, newUid());
    notes[note.uid] = note;
  }
  setState({ notes });
  selectNote(currentList()[0]?.uid ?? null);
}

/**
 * Reconciles notes reported by the watcher. Our own writes come back too:
 * they match `diskContent` and are ignored. A renamed file shows up as one
 * removed path plus one new path carrying the same frontmatter id.
 */
export function handleDiskChanges(paths: string[]): Promise<void> {
  return enqueue(async () => {
    const reads = await Promise.all(paths.map(async (path) => [path, await vaultApi.read(path)] as const));
    const removed: Note[] = [];
    const added: NoteFile[] = [];

    for (const [path, file] of reads) {
      const existing = noteByPath(path);
      if (!file) {
        if (existing) removed.push(existing);
      } else if (!existing) {
        added.push(file);
      } else if (file.content !== existing.diskContent && !pendingBodies.has(existing.uid)) {
        // External edit. A note with unsaved local edits keeps them: they are written next.
        const updated = noteFromFile(file, existing.uid);
        putNote(updated);
        replaceFromDisk(existing.uid, updated.body);
      }
    }

    for (const file of added) {
      const note = noteFromFile(file, newUid());
      const moved = note.id ? removed.findIndex((r) => r.id === note.id) : -1;
      if (moved >= 0) {
        const [previous] = removed.splice(moved, 1);
        putNote({ ...note, uid: previous!.uid });
        if (previous!.body !== note.body) replaceFromDisk(previous!.uid, note.body);
      } else {
        putNote(note);
      }
    }

    const wasSelected = removed.some((n) => n.uid === getState().selectedUid);
    if (wasSelected) showNote(null, "");
    for (const note of removed) {
      forgetNote(note.uid);
      cancel(saveTimers, note.uid);
      cancel(renameTimers, note.uid);
      pendingBodies.delete(note.uid);
    }
    removeNotes(removed.map((n) => n.uid));
    if (wasSelected) selectNote(currentList()[0]?.uid ?? null);
  });
}
