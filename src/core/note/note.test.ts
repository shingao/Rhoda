import { describe, expect, it } from "vitest";
import { joinFrontmatter, patchFrontmatter, splitFrontmatter } from "./frontmatter";
import { sanitizeStem, stemMatches, stemOf } from "./filename";
import { newNoteContent, noteFromFile, serializeNote, withBody, withFrontmatter, withId } from "./note";
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
  it("sanitizes for Windows", () => {
    expect(sanitizeStem('a/b:c*?"<>|d')).toBe("a b c d");
    expect(sanitizeStem("  ..hidden. ")).toBe("hidden");
    expect(sanitizeStem("")).toBe("Untitled");
    expect(sanitizeStem("CON")).toBe("CON_");
    expect(sanitizeStem("x".repeat(200))).toHaveLength(120);
  });

  it("recognises collision suffixes", () => {
    expect(stemMatches("Note (2)", "Note")).toBe(true);
    expect(stemMatches("Note", "Note")).toBe(true);
    expect(stemMatches("note", "Note")).toBe(false);
    expect(stemMatches("Note 2", "Note")).toBe(false);
    expect(stemMatches("a.b (3)", "a.b")).toBe(true);
    expect(stemOf("sub/My note.md")).toBe("My note");
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
    const note = noteFromFile(file("# Old"), "u");
    expect(withBody(note, "# New\ntext").title).toBe("New");
    const trashed = withFrontmatter(note, { trashed: "2026-10-02" });
    expect(trashed.trashed).toBe(true);
    expect(serializeNote(trashed)).toBe("---\ntrashed: 2026-10-02\n---\n# Old");
    expect(withId(note).id).toMatch(/^[0-9a-f-]{36}$/);
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
    expect(sortNotes([a, b, c], "modified").map((n) => n.uid)).toEqual(["c", "b", "a"]);
    expect(sortNotes([a, b, c], "title").map((n) => n.uid)).toEqual(["c", "b", "a"]);
  });
});
