import { isoLocal } from "../dates";
import { uuidv7 } from "../id";
import { joinFrontmatter, parseFrontmatter, patchFrontmatter, splitFrontmatter, type FrontmatterData } from "./frontmatter";
import { applyEol, detectEol, normalizeEol, previewFromBody, titleFromBody, type Eol } from "./text";

/** A note file as returned by the backend. */
export interface NoteFile {
  path: string;
  content: string;
  mtime: number;
  created: number;
}

export interface Note {
  /** Runtime identity, stable across renames; never persisted. */
  uid: string;
  /** Relative to the vault, `/`-separated. */
  path: string;
  /** Persistent id from the frontmatter (absent on notes created outside Ursa). */
  id: string | null;
  frontmatter: string | null;
  /** Body with `\n` line endings, as edited. */
  body: string;
  /** Line ending used on disk, restored on save. */
  eol: Eol;
  /** Exact file content last read from or written to disk. */
  diskContent: string;
  mtime: number;
  created: number;
  title: string;
  preview: string;
  pinned: boolean;
  archived: boolean;
  trashed: boolean;
}

function parseDate(value: unknown): number | null {
  if (typeof value !== "string" && !(value instanceof Date)) return null;
  const t = new Date(value).getTime();
  return Number.isNaN(t) ? null : t;
}

function deriveFromFrontmatter(frontmatter: string | null, file: { created: number; mtime: number }) {
  const data = parseFrontmatter(frontmatter);
  return {
    id: typeof data.id === "string" ? data.id : null,
    created: parseDate(data.created) ?? (file.created || file.mtime),
    pinned: data.pinned === true,
    archived: data.archived === true,
    trashed: data.trashed !== undefined && data.trashed !== false && data.trashed !== null,
  };
}

export function noteFromFile(file: NoteFile, uid: string): Note {
  const eol = detectEol(file.content);
  const { frontmatter, body } = splitFrontmatter(normalizeEol(file.content));
  return {
    uid,
    path: file.path,
    frontmatter,
    body,
    eol,
    diskContent: file.content,
    mtime: file.mtime,
    title: titleFromBody(body),
    preview: previewFromBody(body),
    ...deriveFromFrontmatter(frontmatter, file),
  };
}

export function serializeNote(note: Pick<Note, "frontmatter" | "body" | "eol">): string {
  return applyEol(joinFrontmatter(note.frontmatter, note.body), note.eol);
}

export function withBody(note: Note, body: string): Note {
  if (body === note.body) return note;
  return { ...note, body, title: titleFromBody(body), preview: previewFromBody(body) };
}

export function withFrontmatter(note: Note, patch: FrontmatterData): Note {
  const frontmatter = patchFrontmatter(note.frontmatter, patch);
  if (frontmatter === note.frontmatter) return note;
  return { ...note, frontmatter, ...deriveFromFrontmatter(frontmatter, note) };
}

/** Ensures the note carries a persistent id (added on first write by Ursa). */
export function withId(note: Note): Note {
  return note.id ? note : withFrontmatter(note, { id: uuidv7() });
}

/** Content of a brand new note: id + creation date, empty H1 ready for a title. */
export function newNoteContent(now: number = Date.now()): string {
  return joinFrontmatter(`id: ${uuidv7(now)}\ncreated: ${isoLocal(now)}\n`, "# ");
}
