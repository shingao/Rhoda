import { describe, expect, it } from "vitest";
import { joinFrontmatter, patchFrontmatter, splitFrontmatter } from "./frontmatter";
import { MAX_STEM_LENGTH, sanitizeStem, stemOf } from "./filename";
import { newNoteContent, noteFromFile, serializeNote, withBody, withFrontmatter, withNewId, withStoredId } from "./note";
import { previewFromBody, titleFromBody } from "./text";
import { sortNotes } from "./sort";

const file = (content: string, path = "a.md") => ({ path, content, mtime: 2000, created: 1000 });

describe("frontmatter", () => {
  it("splits and joins without changing bytes", () => {
    const raw = "---\nid: x\n# comment\nfoo: [1, 2]\n---\n# Title\nbody";
    const { frontmatter, body } = splitFrontmatter(raw);
    expect(frontmatter).toBe("id: x\n# comment\nfoo: [1, 2]\n");
    expect(body).toBe("# Title\nbody");
    expect(joinFrontmatter(frontmatter, body)).toBe(raw);
  });

  it("handles notes without frontmatter", () => {
    expect(splitFrontmatter("# Hi\n---\n")).toEqual({ frontmatter: null, body: "# Hi\n---\n" });
  });

  it("patches while preserving comments and unknown keys", () => {
    const fm = "id: x\n# keep me\ncustom: 1\n";
    const out = patchFrontmatter(fm, { pinned: true });
    expect(out).toContain("# keep me");
    expect(out).toContain("custom: 1");
    expect(out).toContain("pinned: true");
    expect(patchFrontmatter(fm, { custom: 1 })).toBe(fm);
    expect(patchFrontmatter("pinned: true\n", { pinned: undefined })).toBeNull();
  });
});

describe("text", () => {
  it("derives the title from the first line", () => {
    expect(titleFromBody("\n# **Voyage** au _Japon_\nx")).toBe("Voyage au Japon");
    expect(titleFromBody("Plain first line")).toBe("Plain first line");
    expect(titleFromBody("# ")).toBe("");
  });

  it("builds a plain preview", () => {
    const body = "# T\n\n- [ ] Buy **milk**\n> quoted [link](http://x)\n```js\ncode()\n```\n---\n1. last";
    expect(previewFromBody(body)).toBe("Buy milk quoted link code() last");
  });
});

describe("filename", () => {
  const stem = (title: string) => sanitizeStem(title, "Sans titre");

  it("replaces every forbidden character", () => {
    expect(stem('a<b>c:d"e/f\\g|h?i*j')).toBe("a b c d e f g h i j");
    expect(stem("Plan: Q4 / goals?")).toBe("Plan Q4 goals");
  });

  it("removes control characters", () => {
    expect(stem("tab\there\u0000nul\u001fend\u007f")).toBe("tab here nul end");
    expect(stem("line\nbreak")).toBe("line break");
  });

  it("handles reserved device names, with or without extension", () => {
    expect(stem("CON")).toBe("CON_");
    expect(stem("nul")).toBe("nul_");
    expect(stem("Com1")).toBe("Com1_");
    expect(stem("LPT9")).toBe("LPT9_");
    expect(stem("COM¹")).toBe("COM¹_");
    expect(stem("CON.txt")).toBe("CON_.txt");
    expect(stem("aux .notes")).toBe("aux_.notes");
    expect(stem("CONIN$")).toBe("CONIN$_");
    // Not reserved:
    expect(stem("Console")).toBe("Console");
    expect(stem("COM10")).toBe("COM10");
    expect(stem("Auxiliaire")).toBe("Auxiliaire");
  });

  it("trims leading dots and trailing dots or spaces", () => {
    expect(stem("  ..hidden. ")).toBe("hidden");
    expect(stem("Fin...")).toBe("Fin");
    expect(stem("Fin . . .")).toBe("Fin");
  });

  it("falls back when nothing is left", () => {
    expect(stem("")).toBe("Sans titre");
    expect(stem(" ? * . ")).toBe("Sans titre");
    expect(sanitizeStem("", "Untitled")).toBe("Untitled");
  });

  it("caps the length without splitting characters or ending on a space", () => {
    expect(stem("x".repeat(300))).toHaveLength(MAX_STEM_LENGTH);
    const emoji = stem("a" + "😀".repeat(100));
    expect(emoji.length).toBeLessThanOrEqual(MAX_STEM_LENGTH);
    expect(emoji.endsWith("\ud83d")).toBe(false);
    expect(stem("y".repeat(119) + " z")).toBe("y".repeat(119));
    expect(sanitizeStem("abcdef", "x", 3)).toBe("abc");
  });

  it("keeps accents and normalizes them", () => {
    expect(stem("Re\u0301sume\u0301 — e\u0301te\u0301")).toBe("Résumé — été");
  });

  it("extracts the stem of a path", () => {
    expect(stemOf("sub/My note.md")).toBe("My note");
    expect(stemOf("Note 2.MD")).toBe("Note 2");
  });
});

describe("note", () => {
  it("round-trips CRLF files", () => {
    const content = "---\r\nid: x\r\n---\r\n# Title\r\nLine";
    const note = noteFromFile(file(content), "u");
    expect(note.body).toBe("# Title\nLine");
    expect(note.title).toBe("Title");
    expect(serializeNote(note)).toBe(content);
  });

  it("reads flags and dates from the frontmatter", () => {
    const note = noteFromFile(file("---\npinned: true\ntrashed: 2026-01-01\ncreated: 2025-05-01T10:00:00Z\n---\nx"), "u");
    expect(note.pinned).toBe(true);
    expect(note.trashed).toBe(true);
    expect(note.archived).toBe(false);
    expect(note.created).toBe(Date.parse("2025-05-01T10:00:00Z"));
    expect(noteFromFile(file("x"), "u").created).toBe(1000);
  });

  it("updates title and frontmatter", () => {
    const note = noteFromFile(file("---\nid: abc\n---\n# Old"), "u");
    expect(withBody(note, "# New\ntext").title).toBe("New");
    const trashed = withFrontmatter(note, { trashed: "2026-10-02" });
    expect(trashed.trashed).toBe(true);
    expect(trashed.id).toBe("abc");
    expect(serializeNote(trashed)).toBe("---\nid: abc\ntrashed: 2026-10-02\n---\n# Old");
  });

  it("is identified by the frontmatter id, not the path", () => {
    const a = noteFromFile(file("---\nid: abc\n---\n# A", "one.md"), "provisional");
    const moved = noteFromFile(file("---\nid: abc\n---\n# A", "sub/two.md"), "other");
    expect(a.id).toBe("abc");
    expect(moved.id).toBe(a.id);
    expect(a.idStored).toBe(true);
    expect(noteFromFile(file("---\nid: 42\n---\nx"), "p").id).toBe("42");
  });

  it("gives external notes a provisional id, stored on first write", () => {
    const external = noteFromFile(file("# Plain markdown"), "prov-1");
    expect(external.id).toBe("prov-1");
    expect(external.idStored).toBe(false);
    const stored = withStoredId(external);
    expect(stored.id).toBe("prov-1");
    expect(stored.idStored).toBe(true);
    expect(serializeNote(stored)).toBe("---\nid: prov-1\n---\n# Plain markdown");
    expect(withStoredId(stored)).toBe(stored);
    const flagged = withStoredId(noteFromFile(file("---\npinned: true\n---\nx"), "p2"));
    expect(serializeNote(flagged)).toBe("---\nid: p2\npinned: true\n---\nx");
  });

  it("re-identifies a copied note", () => {
    const copy = noteFromFile(file("---\nid: abc\ncustom: 1\n---\nx"), "u");
    const fresh = withNewId(copy, "new-id");
    expect(fresh.id).toBe("new-id");
    expect(serializeNote(fresh)).toBe("---\nid: new-id\ncustom: 1\n---\nx");
  });

  it("creates new notes with an id and an empty title", () => {
    const note = noteFromFile(file(newNoteContent(Date.UTC(2026, 9, 2))), "u");
    expect(note.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/);
    expect(note.title).toBe("");
    expect(note.body).toBe("# ");
  });

  it("sorts pinned notes first", () => {
    const a = { ...noteFromFile(file("# B"), "a"), mtime: 1 };
    const b = { ...noteFromFile(file("# A"), "b"), mtime: 3 };
    const c = { ...noteFromFile(file("---\npinned: true\n---\n# C"), "c"), mtime: 2 };
    expect(sortNotes([a, b, c], "modified").map((n) => n.id)).toEqual(["c", "b", "a"]);
    expect(sortNotes([a, b, c], "title").map((n) => n.id)).toEqual(["c", "b", "a"]);
  });
});
