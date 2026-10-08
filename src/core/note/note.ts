import { isoLocal } from "../dates";
import { uuidv7 } from "../id";
import { joinFrontmatter, parseFrontmatter, patchFrontmatter, splitFrontmatter, type FrontmatterData } from "./frontmatter";
import { applyEol, detectEol, normalizeEol, previewFromBody, titleFromBody, type Eol } from "./text";
import { extractSyntax, type NoteSyntax } from "../markdown/extract";
import { parseStickers, type Sticker } from "../stickers";
import { parseAligns, type BlockAlign } from "../align";

/** A note file as returned by the backend. */
export interface NoteFile {
  path: string;
  content: string;
  mtime: number;
  created: number;
}

export interface Note {
  /**
   * Identity of the note and key of the index: the frontmatter `id`. A note
   * created outside Ursa gets a provisional id, written to its frontmatter the
   * first time Ursa writes the file (`idStored` tells which).
   */
  id: string;
  idStored: boolean;
  /** Relative to the vault, `/`-separated. Changes on rename; never used as identity. */
  path: string;
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
  /** Page background and red margin from the frontmatter; null = default setting. */
  paper: Paper | null;
  margin: boolean | null;
  /** Text column on the page (`column: left | center`); null = default setting. */
  column: ColumnPosition | null;
  /** Stickers and post-its from the frontmatter (`stickers:`), in place order. */
  stickers: Sticker[];
  /** Blocks not aligned left (`align:`), anchored like stickers. */
  aligns: BlockAlign[];
  /** Tags, wiki links and todos; null until indexed (done in the background at startup). */
  syntax: NoteSyntax | null;
}

function parseDate(value: unknown): number | null {
  if (typeof value !== "string" && !(value instanceof Date)) return null;
  const t = new Date(value).getTime();
  return Number.isNaN(t) ? null : t;
}

/** The frontmatter id, if usable (strings, or numbers some tools write). */
function readStoredId(data: FrontmatterData): string | null {
  const id = data.id;
  if (typeof id === "string" && id.trim()) return id.trim();
  if (typeof id === "number") return String(id);
  return null;
}

/** Where the text column sits on the page: centred (default) or against the left. */
export const COLUMN_POSITIONS = ["center", "left"] as const;
export type ColumnPosition = (typeof COLUMN_POSITIONS)[number];

/** Page background of a note [DESIGN §7]. */
export const PAPERS = ["plain", "lined", "grid", "dots"] as const;
export type Paper = (typeof PAPERS)[number];

/**
 * `paper` + `margin` (decision D1); DESIGN's `page: ruled | ruled-margin | …`
 * is read too. Null = the default from the settings.
 */
function readPaper(data: FrontmatterData): { paper: Paper | null; margin: boolean | null } {
  const margin = typeof data.margin === "boolean" ? data.margin : null;
  if (typeof data.paper === "string" && (PAPERS as readonly string[]).includes(data.paper)) return { paper: data.paper as Paper, margin };
  if (typeof data.page === "string") {
    const page = { plain: "plain", ruled: "lined", "ruled-margin": "lined", grid: "grid", dots: "dots" }[data.page] as Paper | undefined;
    if (page) return { paper: page, margin: margin ?? (data.page === "ruled-margin" ? true : null) };
  }
  return { paper: null, margin };
}

function deriveFromFrontmatter(frontmatter: string | null, file: { created: number; mtime: number }) {
  const data = parseFrontmatter(frontmatter);
  return {
    ...readPaper(data),
    storedId: readStoredId(data),
    created: parseDate(data.created) ?? (file.created || file.mtime),
    pinned: data.pinned === true,
    archived: data.archived === true,
    trashed: data.trashed !== undefined && data.trashed !== false && data.trashed !== null,
    column: (COLUMN_POSITIONS as readonly unknown[]).includes(data.column) ? (data.column as ColumnPosition) : null,
    stickers: parseStickers(data.stickers),
    aligns: parseAligns(data.align),
  };
}

/**
 * Builds a note from a file. `provisionalId` is used only when the file has no
 * id. `deferSyntax` leaves the (costlier) syntax extraction for later.
 */
export function noteFromFile(file: NoteFile, provisionalId: string = uuidv7(), deferSyntax = false): Note {
  const eol = detectEol(file.content);
  const { frontmatter, body } = splitFrontmatter(normalizeEol(file.content));
  const { storedId: id, ...flags } = deriveFromFrontmatter(frontmatter, file);
  return {
    id: id ?? provisionalId,
    idStored: id !== null,
    path: file.path,
    frontmatter,
    body,
    eol,
    diskContent: file.content,
    mtime: file.mtime,
    title: titleFromBody(body),
    preview: previewFromBody(body),
    ...flags,
    syntax: deferSyntax ? null : extractSyntax(body),
  };
}

export function withSyntax(note: Note): Note {
  return note.syntax ? note : { ...note, syntax: extractSyntax(note.body) };
}

export function serializeNote(note: Pick<Note, "frontmatter" | "body" | "eol">): string {
  return applyEol(joinFrontmatter(note.frontmatter, note.body), note.eol);
}

export function withBody(note: Note, body: string): Note {
  if (body === note.body) return note;
  return { ...note, body, title: titleFromBody(body), preview: previewFromBody(body), syntax: extractSyntax(body) };
}

/** Patches frontmatter flags. The note keeps its identity (use `withNewId` to change it). */
export function withFrontmatter(note: Note, patch: FrontmatterData): Note {
  const frontmatter = patchFrontmatter(note.frontmatter, patch);
  if (frontmatter === note.frontmatter) return note;
  const { storedId, ...flags } = deriveFromFrontmatter(frontmatter, note);
  return { ...note, frontmatter, ...flags };
}

/** Writes the (possibly provisional) id into the frontmatter so it survives restarts and renames. */
export function withStoredId(note: Note): Note {
  if (note.idStored) return note;
  const block = note.frontmatter?.trim() ?? "";
  // Put the id first, as in notes created by Ursa (flow-style YAML goes through the patcher).
  if (block.startsWith("{")) return { ...withFrontmatter(note, { id: note.id }), idStored: true };
  return { ...note, frontmatter: `id: ${note.id}\n${note.frontmatter ?? ""}`, idStored: true };
}

/** Gives the note a fresh id (a copied file carrying another note's id). */
export function withNewId(note: Note, id: string = uuidv7()): Note {
  return { ...withFrontmatter(note, { id }), id, idStored: true };
}

/** Content of a brand new note: id + creation date, H1 with the title (empty, ready to type). */
export function newNoteContent(now: number = Date.now(), title = ""): string {
  return joinFrontmatter(`id: ${uuidv7(now)}\ncreated: ${isoLocal(now)}\n`, title ? `# ${title}\n\n` : "# ");
}
