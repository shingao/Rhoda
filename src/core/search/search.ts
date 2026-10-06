import { tagKey } from "../markdown/extract";
import type { Note } from "../note/note";
import { stripInline } from "../note/text";
import { isTagWithin } from "../tags";
import { contains, findAll, fold, matchRanges } from "./fold";
import type { Needle, Operator, SearchQuery } from "./query";

/**
 * Full-text search over notes. Each note gets an index entry (folded title,
 * tags, body and extra text sources), cached per note object: a note that
 * changes (typing, watcher reload) is a new object and is re-indexed on the
 * next search, the others are reused — the index is incremental by design.
 */

/**
 * Text indexed besides the Markdown body, e.g. OCR of a note's images
 * (phase 9). Sources are registered once; `invalidateTextSources` re-reads
 * them when their content changes.
 */
export interface TextSource {
  /** Shown with the match ("Trouvé dans l'image" for "ocr"). */
  name: string;
  /** One text, or several parts telling where each comes from (an image, a PDF page). */
  text(note: Note): string | TextPart[] | null;
}

export interface TextPart {
  text: string;
  /** Vault path of the file the text was read from. */
  file?: string;
  /** PDF page (from 1). */
  page?: number;
}

const sources: TextSource[] = [];
let sourcesVersion = 0;

export function registerTextSource(source: TextSource): void {
  sources.push(source);
  sourcesVersion++;
}

export function invalidateTextSources(): void {
  sourcesVersion++;
}

interface Entry {
  version: number;
  title: string;
  /** Folded tag names, one per line. */
  tags: string;
  /** Folded tag keys, for #tag filters. */
  tagKeys: string[];
  body: string;
  extra: Array<{ name: string; raw: string; text: string; file?: string; page?: number }>;
  images: boolean;
  pdf: boolean;
}

const IMAGE = /!\[[^\]]*\]\([^)]+\)|<img\s/i;
const PDF = /\]\([^)]+\.pdf(?:[?#][^)]*)?\)/i;

const entries = new WeakMap<Note, Entry>();

function entry(note: Note): Entry {
  const cached = entries.get(note);
  if (cached && cached.version === sourcesVersion) return cached;
  const tags = note.syntax?.tags.map((t) => t.name) ?? [];
  const extra = sources.flatMap((s) => {
    const raw = s.text(note);
    if (!raw) return [];
    const parts = typeof raw === "string" ? [{ text: raw }] : raw;
    return parts.filter((p) => p.text).map((p) => ({ name: s.name, raw: p.text, text: fold(p.text), file: p.file, page: p.page }));
  });
  const e: Entry = {
    version: sourcesVersion,
    title: fold(note.title),
    tags: fold(tags.join("\n")),
    tagKeys: tags.map((t) => fold(tagKey(t))),
    body: fold(note.body),
    extra,
    images: IMAGE.test(note.body),
    pdf: PDF.test(note.body),
  };
  entries.set(note, e);
  return e;
}

/** Indexes notes ahead of the first search (the app calls it in idle time, by small batches). */
export function warmIndex(notes: Iterable<Note>): void {
  for (const note of notes) entry(note);
}

function startOfDay(now: number): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function hasOperator(note: Note, e: Entry, op: Operator, now: number): boolean {
  const todos = note.syntax?.todos;
  switch (op) {
    case "todo":
      return !!todos && todos.done < todos.total;
    case "done":
      return !!todos && todos.total > 0 && todos.done === todos.total;
    case "untagged":
      return note.syntax !== null && note.syntax.tags.length === 0;
    case "pinned":
      return note.pinned;
    case "today":
      return note.mtime >= startOfDay(now);
    case "images":
      return e.images;
    case "pdf":
      return e.pdf;
  }
}

const TITLE = 3;
const TAG = 2;
const CONTENT = 1;

/** Best place where a needle occurs (title > tag > content), 0 if nowhere. */
function needleScore(e: Entry, n: Needle): number {
  if (contains(e.title, n.text, n.wordStart)) return TITLE;
  if (contains(e.tags, n.text, n.wordStart)) return TAG;
  if (contains(e.body, n.text, n.wordStart) || e.extra.some((x) => contains(x.text, n.text, n.wordStart))) return CONTENT;
  return 0;
}

/** Folded tag keys of the query, computed once per search. */
interface Prepared {
  tags: string[];
  excludeTags: string[];
}

/** Score of a note for the query, or -1 if it does not match. */
function score(note: Note, q: SearchQuery, p: Prepared, now: number): number {
  const e = entry(note);
  for (const op of q.operators) if (!hasOperator(note, e, op, now)) return -1;
  for (const op of q.excludeOperators) if (hasOperator(note, e, op, now)) return -1;
  for (const key of p.tags) if (!e.tagKeys.some((k) => isTagWithin(k, key))) return -1;
  for (const key of p.excludeTags) if (e.tagKeys.some((k) => isTagWithin(k, key))) return -1;
  for (const n of q.exclude) if (needleScore(e, n) > 0) return -1;
  let total = 0;
  for (const n of q.include) {
    const s = needleScore(e, n);
    if (s === 0) return -1;
    total += s;
  }
  return total;
}

export interface SearchHit {
  note: Note;
  score: number;
}

/**
 * Notes matching the query: by relevance (title > tag > content, summed over
 * the words) then most recent first. Without words, `sortFallback` keeps the
 * list's own order.
 */
export function searchNotes(notes: Note[], q: SearchQuery, now: number, sortFallback: (notes: Note[]) => Note[]): Note[] {
  const hits: SearchHit[] = [];
  const prepared: Prepared = { tags: q.tags.map((t) => fold(tagKey(t))), excludeTags: q.excludeTags.map((t) => fold(tagKey(t))) };
  for (const note of notes) {
    const s = score(note, q, prepared, now);
    if (s >= 0) hits.push({ note, score: s });
  }
  if (q.include.length === 0) return sortFallback(hits.map((h) => h.note));
  hits.sort((a, b) => b.score - a.score || b.note.mtime - a.note.mtime);
  return hits.map((h) => h.note);
}

export interface Snippet {
  text: string;
  /** Highlighted ranges in `text`. */
  ranges: Array<[number, number]>;
  /** Text source of the match when it is not the note itself ("ocr"…). */
  source: string | null;
  /** File and PDF page of the match, when the source tells. */
  file?: string;
  page?: number;
}

const LIST_MARK = /^\s*(?:>\s*)*(?:[-*+]|\d+[.)])?\s*(?:\[[ xX]\]\s+)?/;
const HEADING_MARK = /^\s{0,3}#{1,6}\s+/;

/** Cuts `text` around the first highlight, at a word boundary. */
function around(text: string, ranges: Array<[number, number]>, before: number, max: number): Snippet {
  const first = ranges[0]?.[0] ?? 0;
  let start = 0;
  if (first > before) {
    start = text.lastIndexOf(" ", first - before) + 1;
    if (start <= 0 || first - start > before + 20) start = first - before;
  }
  const cut = start > 0;
  const body = text.slice(start, start + max);
  const shift = (cut ? 1 : 0) - start;
  return {
    text: (cut ? "…" : "") + body,
    ranges: ranges.filter(([a]) => a >= start && a < start + max).map(([a, b]) => [a + shift, Math.min(b, start + max) + shift]),
    source: null,
  };
}

/**
 * Plain-text excerpt around the first match in the body (or in another text
 * source), with highlights. Null when the words only match the title or the
 * tags: the card then shows its usual preview.
 */
export function snippet(note: Note, q: SearchQuery, before = 40, max = 200): Snippet | null {
  if (q.include.length === 0) return null;
  const e = entry(note);
  const needles = q.include;
  let at = -1;
  for (const n of q.include) {
    const [first] = findAll(e.body, n.text, n.wordStart);
    if (first !== undefined && (at < 0 || first < at)) at = first;
  }
  if (at >= 0) {
    const lineIndex = e.body.slice(0, at).split("\n").length - 1;
    const raw = note.body.split("\n")[lineIndex] ?? "";
    const line = stripInline(raw.replace(HEADING_MARK, "").replace(LIST_MARK, "")).trim();
    // The title line is already shown (and highlighted) above the excerpt.
    if (line && fold(line) !== e.title) {
      const ranges = matchRanges(line, needles);
      if (ranges.length) return around(line, ranges, before, max);
    }
  }
  for (const x of e.extra) {
    if (!q.include.some((n) => contains(x.text, n.text, n.wordStart))) continue;
    const text = x.raw.replace(/\s+/g, " ").trim();
    return { ...around(text, matchRanges(text, needles), before, max), source: x.name, ...(x.file && { file: x.file }), ...(x.page && { page: x.page }) };
  }
  return null;
}

/** Highlights of the query words in any text (card title, preview). */
export function highlights(text: string, q: SearchQuery): Array<[number, number]> {
  return matchRanges(text, q.include);
}
