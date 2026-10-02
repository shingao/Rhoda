import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NoteFile } from "../core/note/note";

/**
 * In-memory vault mimicking the Rust commands (case-insensitive collisions,
 * " 2" suffix, renames that keep the current name). Every path the app
 * touches is recorded, as the file watcher would report it.
 */
const fake = vi.hoisted(() => {
  type Entry = { content: string; mtime: number; created: number };
  const files = new Map<string, Entry>();
  const state = { clock: 1000, touched: [] as string[], lockWrites: false, lockRenames: false };
  const file = (path: string) => ({ path, ...files.get(path)! });
  const taken = (name: string, except?: string) =>
    [...files.keys()].some((p) => p.toLowerCase() === name.toLowerCase() && p.toLowerCase() !== except?.toLowerCase());
  const unique = (stem: string, except?: string) => {
    for (let n = 1; ; n++) {
      const name = n === 1 ? `${stem}.md` : `${stem} ${n}.md`;
      if (!taken(name, except)) return name;
    }
  };
  const vaultApi = {
    read: async (path: string) => (files.has(path) ? file(path) : null),
    write: async (path: string, content: string) => {
      if (state.lockWrites) throw new Error("sharing violation");
      const mtime = ++state.clock;
      files.set(path, { content, mtime, created: files.get(path)?.created ?? mtime });
      state.touched.push(path);
      return mtime;
    },
    create: async (stem: string, content: string) => {
      const path = unique(stem);
      const mtime = ++state.clock;
      files.set(path, { content, mtime, created: mtime });
      state.touched.push(path);
      return file(path);
    },
    rename: async (from: string, stem: string) => {
      if (state.lockRenames) throw new Error("sharing violation");
      const to = unique(stem, from);
      if (to !== from) {
        files.set(to, files.get(from)!);
        files.delete(from);
        state.touched.push(from, to);
      }
      return to;
    },
  };
  return { files, state, vaultApi };
});

vi.mock("../services/vault", () => ({ vaultApi: fake.vaultApi }));
vi.mock("../editor/session", () => ({
  showNote: vi.fn(),
  replaceFromDisk: vi.fn(),
  forgetNote: vi.fn(),
  focusEditor: vi.fn(),
}));

const { createNote, editNote, flushAll, handleDiskChanges, loadNotes, trashNote } = await import("./notes");
const { getState, setState, useApp } = await import("./store");
const session = await import("../editor/session");

const diskFiles = (): NoteFile[] => [...fake.files.keys()].map((path) => ({ path, ...fake.files.get(path)! }));
const notes = () => Object.values(getState().notes);
const paths = () => notes().map((n) => n.path).sort();

/** Feeds the watcher with everything touched so far and counts store updates it causes. */
async function echoWatcher(): Promise<number> {
  const touched = [...new Set(fake.state.touched)];
  fake.state.touched = [];
  let updates = 0;
  const unsubscribe = useApp.subscribe(() => updates++);
  await handleDiskChanges(touched);
  unsubscribe();
  return updates;
}

function seed(path: string, content: string, created = ++fake.state.clock): void {
  fake.files.set(path, { content, mtime: created, created });
}

beforeEach(async () => {
  vi.useFakeTimers();
  fake.files.clear();
  fake.state.touched = [];
  fake.state.lockWrites = false;
  fake.state.lockRenames = false;
  setState({ notes: {}, selectedId: null });
  vi.mocked(session.replaceFromDisk).mockClear();
});

afterEach(async () => {
  await flushAll();
  vi.useRealTimers();
});

describe("own changes echoed by the watcher", () => {
  it("ignores our own saves", async () => {
    seed("A.md", "---\nid: a\n---\n# A\n");
    await loadNotes(diskFiles());
    editNote("a", "# A\nmore text");
    await vi.advanceTimersByTimeAsync(600);
    expect(fake.files.get("A.md")!.content).toContain("more text");

    expect(await echoWatcher()).toBe(0);
    expect(notes()).toHaveLength(1);
    expect(session.replaceFromDisk).not.toHaveBeenCalled();
  });

  it("ignores our own renames: no duplicate, no flicker", async () => {
    seed("Old.md", "---\nid: n1\n---\n# Old\n");
    await loadNotes(diskFiles());
    editNote("n1", "# New title");
    await vi.advanceTimersByTimeAsync(2100);
    expect(paths()).toEqual(["New title.md"]);
    expect(fake.state.touched).toContain("Old.md");

    expect(await echoWatcher()).toBe(0);
    expect(paths()).toEqual(["New title.md"]);
    expect(getState().notes.n1?.title).toBe("New title");
  });

  it("ignores our own creations", async () => {
    await loadNotes([]);
    await createNote();
    expect(paths()).toEqual(["Sans titre.md"]);
    expect(await echoWatcher()).toBe(0);
    expect(notes()).toHaveLength(1);
  });
});

describe("file names", () => {
  it("adds a numeric suffix on case-insensitive collisions", async () => {
    seed("plan.md", "---\nid: p\n---\n# plan\n");
    seed("Untitled.md", "---\nid: u\n---\n# \n");
    await loadNotes(diskFiles());
    editNote("u", "# Plan");
    await vi.advanceTimersByTimeAsync(2100);
    expect(getState().notes.u?.path).toBe("Plan 2.md");
    expect(getState().notes.p?.path).toBe("plan.md");
  });

  it("sanitizes the title before renaming", async () => {
    seed("x.md", "---\nid: x\n---\n# x\n");
    await loadNotes(diskFiles());
    editNote("x", "# CON: a/b?");
    await vi.advanceTimersByTimeAsync(2100);
    expect(getState().notes.x?.path).toBe("CON a b.md");
    editNote("x", "# nul");
    await vi.advanceTimersByTimeAsync(2100);
    expect(getState().notes.x?.path).toBe("nul_.md");
  });

  it("keeps the old name when the file is locked, then retries", async () => {
    seed("Draft.md", "---\nid: d\n---\n# Draft\n");
    await loadNotes(diskFiles());
    fake.state.lockRenames = true;
    editNote("d", "# Final");
    await vi.advanceTimersByTimeAsync(2100);
    expect(getState().notes.d?.path).toBe("Draft.md");
    expect(fake.files.get("Draft.md")!.content).toContain("# Final");

    fake.state.lockRenames = false;
    await vi.advanceTimersByTimeAsync(2100);
    expect(getState().notes.d?.path).toBe("Final.md");
  });

  it("keeps unsaved text when a write fails, then retries", async () => {
    seed("W.md", "---\nid: w\n---\n# W\n");
    await loadNotes(diskFiles());
    fake.state.lockWrites = true;
    editNote("w", "# W\nprecious");
    await vi.advanceTimersByTimeAsync(600);
    expect(fake.files.get("W.md")!.content).not.toContain("precious");

    fake.state.lockWrites = false;
    await vi.advanceTimersByTimeAsync(2100);
    expect(fake.files.get("W.md")!.content).toContain("precious");
  });
});

describe("identity", () => {
  it("indexes notes by frontmatter id", async () => {
    seed("A.md", "---\nid: id-a\n---\n# A\n");
    await loadNotes(diskFiles());
    expect(Object.keys(getState().notes)).toEqual(["id-a"]);
  });

  it("follows a note renamed outside Ursa", async () => {
    seed("A.md", "---\nid: id-a\n---\n# A\n");
    await loadNotes(diskFiles());
    setState({ selectedId: "id-a" });
    fake.files.set("Moved.md", fake.files.get("A.md")!);
    fake.files.delete("A.md");

    await handleDiskChanges(["A.md", "Moved.md"]);
    expect(Object.keys(getState().notes)).toEqual(["id-a"]);
    expect(getState().notes["id-a"]?.path).toBe("Moved.md");
    expect(getState().selectedId).toBe("id-a");
  });

  it("gives a copied file its own id", async () => {
    seed("A.md", "---\nid: id-a\n---\n# A\n");
    await loadNotes(diskFiles());
    seed("A - Copie.md", "---\nid: id-a\n---\n# A\n");

    await handleDiskChanges(["A - Copie.md"]);
    expect(notes()).toHaveLength(2);
    expect(getState().notes["id-a"]?.path).toBe("A.md");
    const copy = notes().find((n) => n.path === "A - Copie.md")!;
    expect(copy.id).not.toBe("id-a");
    expect(fake.files.get("A - Copie.md")!.content).toContain(`id: ${copy.id}`);
  });

  it("lets the older file keep a duplicated id at startup", async () => {
    seed("Copy.md", "---\nid: same\n---\n# Copy\n", 200);
    seed("Original.md", "---\nid: same\n---\n# Original\n", 100);
    await loadNotes(diskFiles());
    expect(getState().notes.same?.path).toBe("Original.md");
    expect(notes()).toHaveLength(2);
  });

  it("stores a provisional id on the first write of an external note", async () => {
    seed("Plain.md", "# Plain\n");
    await loadNotes(diskFiles());
    const [note] = notes();
    expect(note!.idStored).toBe(false);
    await trashNote(note!.id);
    expect(fake.files.get("Plain.md")!.content).toMatch(new RegExp(`^---\\nid: ${note!.id}\\ntrashed: .+\\n---\\n# Plain\\n$`));
  });
});

describe("external edits", () => {
  it("reloads a note edited elsewhere", async () => {
    seed("A.md", "---\nid: a\n---\n# A\n");
    await loadNotes(diskFiles());
    fake.files.set("A.md", { content: "---\nid: a\n---\n# A\nfrom Notepad\n", mtime: 5000, created: 1 });
    await handleDiskChanges(["A.md"]);
    expect(getState().notes.a?.body).toContain("from Notepad");
    expect(session.replaceFromDisk).toHaveBeenCalledWith("a", "# A\nfrom Notepad\n");
  });
});
