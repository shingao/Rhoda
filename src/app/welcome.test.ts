import { describe, expect, it, vi } from "vitest";
import { noteFromFile } from "../core/note/note";
import { blocksOf, resolveAnchor } from "../core/stickers";
import { welcomeContent } from "./welcome";

// Only the text is tested here: no editor, no disk.
vi.mock("./notes", () => ({ addNote: vi.fn(), selectNote: vi.fn() }));

describe("welcome note", () => {
  it("is an ordinary note: lined paper, a sticker and a post-it, one tag", () => {
    const { title, content } = welcomeContent(Date.UTC(2026, 9, 7));
    const note = noteFromFile({ path: `${title}.md`, content, mtime: 0, created: 0 });
    expect(note.title).toBe("Bienvenue dans Bullshit");
    expect(note.paper).toBe("lined");
    expect(note.syntax?.tags.map((t) => t.name)).toEqual(["bullshit/bienvenue"]);
    const blocks = blocksOf(note.body.split("\n"));
    const anchors = note.stickers.map((s) => blocks[resolveAnchor(s.anchor, blocks)]!.text);
    expect(anchors).toEqual(["# Bienvenue dans Bullshit", "## Fonds de page et stickers"]);
    expect(note.stickers.map((s) => s.kind)).toEqual(["sticker", "postit"]);
    // The shortcuts are spelled out, as set today.
    expect(note.body).toContain("Créer une note avec Ctrl N");
    expect(note.body).not.toContain("undefined");
  });
});
