import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NoteFile } from "../core/note/note";
import type { Sticker } from "../core/stickers";

/**
 * In-memory vault mimicking the Rust commands (case-insensitive collisions,
 * " 2" suffix, renames that keep the current name). Every path the app
 * touches is recorded, as the file watcher would report it.
 */
const fake = vi.hoisted(() => {
  type Entry = { content: string; mtime: number; created: number };
  const files = new Map<string, Entry>();
  const state = { clock: 1000, touched: [] as string[], lockWrites: false, lockRenames: false, failBackups: false };
  /** `.ursa/backups/<name>/`: path → content at backup time. */
  const backups = new Map<string, Map<string, string>>();
  /** `manifest.json` / `tags.json` of each backup, keyed `<name>/<file>`. */
  const manifests = new Map<string, string>();
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
      if (state.lockWrites) throw { kind: "locked", message: "sharing violation" };
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
    remove: async (path: string) => {
      files.delete(path);
      state.touched.push(path);
    },
    backup: async (name: string, paths: string[]) => {
      if (state.failBackups) throw { kind: "diskFull", message: "no space left" };
      let final = name;
      for (let n = 2; backups.has(final); n++) final = `${name}-${n}`;
      backups.set(final, new Map(paths.map((p) => [p, files.get(p)!.content])));
      return final;
    },
    restore: async (name: string, items: Array<{ from: string; to: string; create: boolean }>) =>
      items.map(({ from, to, create }) => {
        const target = create && files.has(to) ? unique(to.replace(/\.md$/, "")) : to;
        const mtime = ++state.clock;
        files.set(target, { content: backups.get(name)!.get(from)!, mtime, created: files.get(target)?.created ?? mtime });
        state.touched.push(target);
        return file(target);
      }),
    purgeBackups: async (before: string) => {
      const old = [...backups.keys()].filter((k) => k < before);
      old.forEach((k) => backups.delete(k));
      return old.length;
    },
    listBackups: async () => [...backups].map(([name, copies]) => ({ name, notes: copies.size })).sort((a, b) => b.name.localeCompare(a.name)),
    readBackup: async (name: string) => ({
      manifest: manifests.get(`${name}/manifest.json`) ?? null,
      tags: manifests.get(`${name}/tags.json`) ?? null,
      files: [...backups.get(name)!].map(([path, content]) => ({ path, content, mtime: 0, created: 0 })),
    }),
    writeBackupFile: async (name: string, file: string, content: string) => void manifests.set(`${name}/${file}`, content),
    restoreAssets: async (name: string, paths: string[]) =>
      paths.filter((p) => {
        if (files.has(p)) return false;
        const mtime = ++state.clock;
        files.set(p, { content: backups.get(name)!.get(p)!, mtime, created: mtime });
        return true;
      }),
    readInternal: async () => null,
    writeInternal: async () => undefined,
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
  return { files, backups, manifests, state, vaultApi };
});

vi.mock("../services/vault", () => ({ vaultApi: fake.vaultApi }));
vi.mock("../services/assets", () => ({
  assetsApi: { info: async (paths: string[]) => paths.map((p) => (fake.files.has(p) ? { width: 1, height: 1, bytes: 1 } : null)) },
}));
/** Stand-in for the editor: one "open" note whose text lives here, as in CodeMirror. */
const editor = vi.hoisted(() => ({
  openId: null as string | null,
  text: "",
  rewrites: [] as Array<{ id: string; changes: unknown }>,
  stickers: null as Sticker[] | null,
}));
vi.mock("../editor/session", () => ({
  showNote: vi.fn(),
  replaceFromDisk: vi.fn(),
  forgetNote: vi.fn(),
  focusEditor: vi.fn(),
  editorText: (id: string) => (id === editor.openId ? editor.text : null),
  editorStickers: (id: string) => (id === editor.openId ? editor.stickers : null),
  rewriteInEditor: (id: string, changes: Array<{ from: number; to: number; insert: string }>) => {
    if (id !== editor.openId) return "none";
    editor.rewrites.push({ id, changes });
    editor.text = [...changes].sort((a, b) => b.from - a.from).reduce((t, c) => t.slice(0, c.from) + c.insert + t.slice(c.to), editor.text);
    return "view";
  },
}));

const {
  BackupFailedError,
  createNote,
  deleteNotes,
  editNote,
  flushAll,
  handleDiskChanges,
  listBackups,
  loadNotes,
  parseBackupName,
  prepareClose,
  restoreBackup,
  purgeOldBackups,
  restoreNote,
  setFilter,
  trashNote,
  undoBulk,
  unsavedNotes,
} = await import("./notes");
const { deleteTag, notesWithTag, renameTag, updateTagSettings } = await import("./tagOps");
const { getState, setState, useApp } = await import("./store");
const session = await import("../editor/session");

/** Notes on disk (attachments are not notes, as in the Rust scan). */
const diskFiles = (): NoteFile[] => [...fake.files.keys()].filter((p) => p.endsWith(".md")).map((path) => ({ path, ...fake.files.get(path)! }));
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
  fake.state.failBackups = false;
  fake.backups.clear();
  fake.manifests.clear();
  setState({ notes: {}, selectedId: null, saveErrors: {}, filter: { kind: "section", section: "notes" }, tagConfig: {} });
  editor.openId = null;
  editor.text = "";
  editor.rewrites = [];
  editor.stickers = null;
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

describe("stickers", () => {
  it("saves the editor's stickers in the frontmatter, keeping other keys", async () => {
    seed("J.md", "---\nid: j\nmood: calme\n---\n# Journal\n\nTexte.\n");
    await loadNotes(diskFiles());
    editor.openId = "j";
    editor.text = "# Journal\n\nTexte.\n";
    editor.stickers = [
      { id: "s1", kind: "postit", text: 'Dit : "oui"\n2e ligne 🌻', color: "pink", anchor: { type: "paragraph", text: "texte.", index: 1 }, dx: 105, dy: 0, rotation: -2, size: 168, z: 0 },
    ];
    editNote("j", editor.text);
    await vi.advanceTimersByTimeAsync(600);
    const content = fake.files.get("J.md")!.content;
    expect(content).toContain("mood: calme");
    expect(getState().notes.j?.stickers[0]?.text).toBe('Dit : "oui"\n2e ligne 🌻');
    expect(content.endsWith("# Journal\n\nTexte.\n")).toBe(true);
    // Removing the last sticker removes the key.
    editor.stickers = [];
    editNote("j", editor.text);
    await vi.advanceTimersByTimeAsync(600);
    expect(fake.files.get("J.md")!.content).not.toContain("stickers");
    expect(await echoWatcher()).toBe(0);
  });

  it("passes stickers edited elsewhere to the editor", async () => {
    seed("K.md", "---\nid: k\n---\n# K\n");
    await loadNotes(diskFiles());
    fake.files.set("K.md", { ...fake.files.get("K.md")!, content: "---\nid: k\nstickers:\n  - { id: x, type: sticker, asset: fluent/sun, anchor: { block: heading, text: k, index: 0 } }\n---\n# K\n" });
    await handleDiskChanges(["K.md"]);
    expect(session.replaceFromDisk).toHaveBeenCalledWith("k", "# K\n", [expect.objectContaining({ id: "x", asset: "fluent/sun" })]);
  });
});

describe("duplicate", () => {
  it("copies text, frontmatter and stickers with new ids", async () => {
    seed("Journal.md", "---\nid: j\npinned: true\nmood: calme\nstickers:\n  - { id: a1, type: postit, text: Bonjour, anchor: { block: heading, text: journal, index: 0 } }\n---\n# Journal\n\nTexte.\n");
    await loadNotes(diskFiles());
    const { duplicateNote } = await import("./notes");
    await duplicateNote("j");
    const copy = notes().find((n) => n.id !== "j")!;
    expect(copy.path).toBe("Journal 2.md");
    expect(copy.title).toBe("Journal");
    expect(copy.body).toBe("# Journal\n\nTexte.\n");
    expect(copy.pinned).toBe(false);
    expect(copy.stickers).toHaveLength(1);
    expect(copy.stickers[0]).toMatchObject({ kind: "postit", text: "Bonjour" });
    expect(copy.stickers[0]!.id).not.toBe("a1");
    expect(fake.files.get("Journal 2.md")!.content).toContain("mood: calme");
    expect(getState().selectedId).toBe(copy.id);
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

describe("save failures", () => {
  it("stays silent for two failures, then flags the note with the reason", async () => {
    seed("L.md", "---\nid: l\n---\n# L\n");
    await loadNotes(diskFiles());
    fake.state.lockWrites = true;
    editNote("l", "# L\nnew");
    await vi.advanceTimersByTimeAsync(600); // 1st failure
    await vi.advanceTimersByTimeAsync(2_000); // 2nd
    expect(getState().saveErrors).toEqual({});
    await vi.advanceTimersByTimeAsync(5_000); // 3rd
    expect(getState().saveErrors).toEqual({ l: "locked" });

    fake.state.lockWrites = false;
    await vi.advanceTimersByTimeAsync(15_000);
    expect(getState().saveErrors).toEqual({});
    expect(fake.files.get("L.md")!.content).toContain("new");
  });

  it("reports unsaved text when closing, and lets a retry succeed", async () => {
    seed("C.md", "---\nid: c\n---\n# C\n");
    await loadNotes(diskFiles());
    fake.state.lockWrites = true;
    editNote("c", "# C\nunsaved words");
    expect(await prepareClose()).toBe(false);
    expect(unsavedNotes()).toEqual([{ id: "c", title: "C", content: "---\nid: c\n---\n# C\nunsaved words" }]);

    fake.state.lockWrites = false;
    expect(await prepareClose()).toBe(true);
    expect(unsavedNotes()).toEqual([]);
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
    expect(session.replaceFromDisk).toHaveBeenCalledWith("a", "# A\nfrom Notepad\n", []);
  });
});

describe("wiki links follow a renamed note", () => {
  it("rewrites links in 3 notes, the open one through the editor (undoable)", async () => {
    seed("Voyage.md", "---\nid: v\n---\n# Voyage\n");
    seed("B.md", "---\nid: b\n---\n# B\nVoir [[Voyage]] et [[voyage#Budget|le budget]].\n");
    seed("C.md", "---\nid: c\n---\n# C\n- [ ] relire [[Voyage]]\n`[[Voyage]]` reste du code\n");
    seed("D.md", "---\nid: d\n---\n# D\nOuvert : [[Voyage|ici]]\n");
    seed("E.md", "---\nid: e\n---\n# E\n[[Voyages]] est une autre note\n");
    await loadNotes(diskFiles());

    // The title of "Voyage" is edited, then the user opens D before the 2 s checkpoint.
    editNote("v", "# Voyage au Japon\n");
    editor.openId = "d";
    editor.text = getState().notes.d!.body;
    await vi.advanceTimersByTimeAsync(2100);

    expect(fake.files.get("B.md")!.content).toContain("Voir [[Voyage au Japon]] et [[Voyage au Japon#Budget|le budget]].");
    expect(fake.files.get("C.md")!.content).toContain("relire [[Voyage au Japon]]\n`[[Voyage]]` reste du code");
    expect(fake.files.get("E.md")!.content).toContain("[[Voyages]]");
    // D is open: changed through the editor (one undoable transaction), not written behind its back.
    expect(editor.rewrites).toHaveLength(1);
    expect(editor.text).toContain("Ouvert : [[Voyage au Japon|ici]]");
    expect(fake.files.get("D.md")!.content).not.toContain("Japon");
    expect(getState().toast?.text).toBe("4 liens mis à jour dans 3 notes");
    expect(getState().notes.v!.path).toBe("Voyage au Japon.md");
  });

  it("leaves links alone when the old title was ambiguous", async () => {
    seed("A.md", "---\nid: a\n---\n# Doublon\n");
    seed("A2.md", "---\nid: a2\n---\n# Doublon\n");
    seed("L.md", "---\nid: l\n---\n# L\n[[Doublon]]\n");
    await loadNotes(diskFiles());
    editNote("a", "# Unique\n");
    await vi.advanceTimersByTimeAsync(2100);
    expect(fake.files.get("L.md")!.content).toContain("[[Doublon]]");
  });
});

describe("tag operations", () => {
  beforeEach(async () => {
    seed("1.md", "---\nid: n1\n---\n# Un\n#Voyages/Japon et #idée\n");
    seed("2.md", "---\nid: n2\n---\n# Deux\nPlan #voyages\n");
    seed("3.md", "---\nid: n3\n---\n# Trois\nRien ici, même pas `#voyages`\n");
    await loadNotes(diskFiles());
  });

  it("counts the notes a rename would touch, children included", () => {
    expect(notesWithTag("voyages")).toBe(2);
    expect(notesWithTag("voyages/japon")).toBe(1);
  });

  it("renames a tag and its children everywhere", async () => {
    expect((await renameTag("voyages", "trips")).count).toBe(2);
    expect(fake.files.get("1.md")!.content).toContain("#trips/Japon et #idée");
    expect(fake.files.get("2.md")!.content).toContain("Plan #trips");
    expect(fake.files.get("3.md")!.content).toContain("`#voyages`");
  });

  it("removes a tag everywhere", async () => {
    expect((await deleteTag("voyages")).count).toBe(2);
    expect(fake.files.get("1.md")!.content).toContain("# Un\net #idée");
    expect(fake.files.get("2.md")!.content).toContain("Plan\n");
  });

  it("filters the list by tag, with descendants", () => {
    setFilter({ kind: "tag", key: "voyages" });
    expect(notes().filter((n) => n.syntax?.tags.length).length).toBe(2);
    expect(getState().selectedId).not.toBe("n3");
  });
});

describe("trash", () => {
  it("restores a note and deletes it permanently through the recycle bin", async () => {
    seed("T.md", "---\nid: t\n---\n# T\n");
    await loadNotes(diskFiles());
    await trashNote("t");
    expect(getState().notes.t!.trashed).toBe(true);
    await restoreNote("t");
    expect(getState().notes.t!.trashed).toBe(false);
    expect(fake.files.get("T.md")!.content).not.toContain("trashed");
    await trashNote("t");
    await deleteNotes(["t"]);
    expect(fake.files.has("T.md")).toBe(false);
    expect(getState().notes.t).toBeUndefined();
  });

  it("creates a note from a missing link title", async () => {
    await loadNotes([]);
    await createNote("Idées de voyage");
    expect(fake.files.get("Idées de voyage.md")!.content).toContain("# Idées de voyage\n");
  });
});

describe("safety backups before bulk operations", () => {
  const content = (path: string) => fake.files.get(path)!.content;

  beforeEach(async () => {
    seed("1.md", "---\nid: n1\n---\n# Un\n#voyages/japon et #idée\n");
    seed("2.md", "---\nid: n2\n---\n# Deux\nPlan #voyages\n");
    seed("3.md", "---\nid: n3\n---\n# Trois\nSans tag\n");
    await loadNotes(diskFiles());
  });

  it("copies only the files about to change, as they were, in <date-time>-<operation>", async () => {
    const before1 = content("1.md");
    const { backup } = await renameTag("voyages", "trips");
    expect(backup).toMatch(/^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}-rename-tag$/);
    const copy = fake.backups.get(backup!)!;
    expect([...copy.keys()].sort()).toEqual(["1.md", "2.md"]);
    expect(copy.get("1.md")).toBe(before1);
  });

  it("writes unsaved text before copying, so the copy is the real previous state", async () => {
    editNote("n2", "# Deux\nPlan #voyages modifié\n");
    const { backup } = await renameTag("voyages", "trips");
    expect(fake.backups.get(backup!)!.get("2.md")).toContain("Plan #voyages modifié");
    expect(content("2.md")).toContain("Plan #trips modifié");
  });

  it("does nothing if the copy fails", async () => {
    fake.state.failBackups = true;
    const before = [content("1.md"), content("2.md")];
    await expect(renameTag("voyages", "trips")).rejects.toBeInstanceOf(BackupFailedError);
    expect([content("1.md"), content("2.md")]).toEqual(before);
    await expect(deleteNotes(["n3"])).rejects.toBeInstanceOf(BackupFailedError);
    expect(fake.files.has("3.md")).toBe(true);
  });

  it("undo restores the files, the index and the tag settings", async () => {
    setState({ tagConfig: { voyages: { icon: "plane" } } });
    const before = [content("1.md"), content("2.md")];
    const { backup } = await renameTag("voyages", "trips");
    expect(getState().tagConfig.trips?.icon).toBe("plane");
    expect(await undoBulk(backup!)).toBe("undone");
    expect([content("1.md"), content("2.md")]).toEqual(before);
    expect(getState().notes.n2!.syntax!.tags.map((t) => t.name)).toEqual(["voyages"]);
    expect(getState().tagConfig.voyages?.icon).toBe("plane");
    expect(getState().tagConfig.trips).toBeUndefined();
    // The restored files echo through the watcher without changing anything.
    expect(await echoWatcher()).toBe(0);
    // Only once.
    expect(await undoBulk(backup!)).toBe("expired");
  });

  it("undo is refused once one of the notes was edited", async () => {
    const { backup } = await deleteTag("voyages");
    editNote("n2", "# Deux\nPlan revu\n");
    expect(await undoBulk(backup!)).toBe("changed");
    await flushAll();
    expect(content(getState().notes.n2!.path)).toContain("Plan revu");
    expect(content("1.md")).not.toContain("#voyages");
  });

  it("undo of a link update restores the open note through the editor", async () => {
    seed("V.md", "---\nid: v\n---\n# Voyage\n");
    seed("L.md", "---\nid: l\n---\n# L\nVoir [[Voyage]]\n");
    await loadNotes(diskFiles());
    editor.openId = "l";
    editor.text = getState().notes.l!.body;
    editNote("v", "# Voyage au Japon\n");
    await vi.advanceTimersByTimeAsync(2100);
    expect(editor.text).toContain("[[Voyage au Japon]]");
    const toast = getState().toast!;
    expect(toast.action?.label).toBe("Annuler");
    const backup = [...fake.backups.keys()].find((k) => k.endsWith("-update-links"))!;
    expect(await undoBulk(backup)).toBe("undone");
    expect(session.replaceFromDisk).toHaveBeenCalledWith("l", "# L\nVoir [[Voyage]]\n", []);
  });

  it("emptying the trash can be undone: the notes come back, in the trash", async () => {
    await trashNote("n3");
    const { backup, count } = await deleteNotes(["n3"], "empty-trash");
    expect(count).toBe(1);
    expect(backup).toMatch(/-empty-trash$/);
    expect(fake.files.has("3.md")).toBe(false);
    expect(await undoBulk(backup!)).toBe("undone");
    expect(fake.files.has("3.md")).toBe(true);
    expect(getState().notes.n3!.trashed).toBe(true);
  });

  it("lists backups with their date, operation and number of notes", async () => {
    await renameTag("voyages", "trips");
    await deleteNotes(["n3"]);
    const list = await listBackups();
    expect(list.map((b) => [b.operation, b.notes])).toEqual(
      expect.arrayContaining([
        ["rename-tag", 2],
        ["delete-notes", 1],
      ]),
    );
    expect(parseBackupName("2026-10-02_15-04-05-rename-tag-2")).toEqual({ time: new Date(2026, 9, 2, 15, 4, 5).getTime(), operation: "rename-tag" });
    expect(parseBackupName("n'importe quoi")).toEqual({ time: null, operation: null });
  });

  it("restores from Settings with the same check as Undo, after a restart too", async () => {
    const before = [content("1.md"), content("2.md")];
    const { backup } = await renameTag("voyages", "trips");
    // As after a restart: only the files and their manifest are left.
    const copy = "2026-10-02_09-00-00-rename-tag";
    fake.backups.set(copy, fake.backups.get(backup!)!);
    fake.manifests.set(`${copy}/manifest.json`, fake.manifests.get(`${backup!}/manifest.json`)!);
    expect(await restoreBackup(copy, false)).toEqual({ kind: "restored", count: 2, backup: expect.stringMatching(/-restore$/) });
    expect([content("1.md"), content("2.md")]).toEqual(before);
    expect(getState().notes.n1!.syntax!.tags.map((t) => t.name)).toContain("voyages/japon");
  });

  it("restores tag settings from Settings exactly like Undo, after a restart too", async () => {
    setState({ tagConfig: { voyages: { icon: "plane" }, "voyages/japon": { color: 3 }, maison: { icon: "house" } } });
    const { backup } = await renameTag("voyages", "trips");
    expect(getState().tagConfig.trips?.icon).toBe("plane");
    // As after a restart: the copies, manifest.json and tags.json only.
    const copy = "2026-10-02_09-00-00-rename-tag";
    fake.backups.set(copy, fake.backups.get(backup!)!);
    for (const f of ["manifest.json", "tags.json"]) fake.manifests.set(`${copy}/${f}`, fake.manifests.get(`${backup!}/${f}`)!);
    expect(JSON.parse(fake.manifests.get(`${copy}/tags.json`)!).tags.voyages.icon).toBe("plane");
    updateTagSettings("maison", { icon: "home" });
    expect(await restoreBackup(copy, false)).toMatchObject({ kind: "restored" });
    expect(getState().tagConfig).toEqual({ voyages: { icon: "plane" }, "voyages/japon": { color: 3 }, maison: { icon: "home" } });
  });

  it("asks before restoring over notes edited since, and keeps a copy of them", async () => {
    const { backup } = await deleteTag("voyages");
    editNote("n2", "# Deux\nPlan revu\n");
    expect(await restoreBackup(backup!, false)).toEqual({ kind: "changed", titles: ["Deux"] });
    expect(content("1.md")).not.toContain("#voyages");
    const result = await restoreBackup(backup!, true);
    expect(result).toMatchObject({ kind: "restored", count: 2 });
    expect(content("2.md")).toContain("Plan #voyages");
    // The edited text is in the safety copy, and the restore can be undone.
    const safety = (result as { backup: string }).backup;
    expect(fake.backups.get(safety)!.get("2.md")).toContain("Plan revu");
    expect(await undoBulk(safety)).toBe("undone");
    expect(content("2.md")).toContain("Plan revu");
  });

  it("restores a deleted note and an old backup without manifest (after confirmation)", async () => {
    const { backup } = await deleteNotes(["n3"]);
    fake.manifests.delete(`${backup!}/manifest.json`);
    const copy = "2026-09-01_09-00-00-delete-notes";
    fake.backups.set(copy, fake.backups.get(backup!)!);
    // Without manifest nothing can be checked: always ask.
    expect(await restoreBackup(copy, false)).toEqual({ kind: "changed", titles: ["Trois"] });
    expect(await restoreBackup(copy, true)).toMatchObject({ kind: "restored", count: 1, backup: null });
    expect(fake.files.has("3.md")).toBe(true);
    expect(getState().notes.n3!.title).toBe("Trois");
  });

  it("sends the images only the deleted note used to the recycle bin, and Undo brings them back", async () => {
    seed("assets/seule.png", "PNG-A");
    seed("assets/commune.png", "PNG-B");
    seed("I.md", "---\nid: img\n---\n# Images\n![](assets/seule.png)\n![](assets/commune.png)\n![](assets/absente.png)\n");
    seed("J.md", "---\nid: other\n---\n# Autre\n![](assets/commune.png)\n");
    await loadNotes(diskFiles());
    await trashNote("img");
    const { backup } = await deleteNotes(["img"], "empty-trash");
    expect(fake.files.has("assets/seule.png")).toBe(false);
    expect(fake.files.has("assets/commune.png")).toBe(true);
    expect([...fake.backups.get(backup!)!.keys()].sort()).toEqual(["I.md", "assets/seule.png"]);
    expect(JSON.parse(fake.manifests.get(`${backup!}/manifest.json`)!).assets).toEqual(["assets/seule.png"]);
    expect(await undoBulk(backup!)).toBe("undone");
    expect(fake.files.get("assets/seule.png")?.content).toBe("PNG-A");
    expect(getState().notes.img).toBeDefined();
  });

  it("treats imported stickers like images: orphans to the recycle bin, kept if another note uses them", async () => {
    seed("assets/stickers/chat.png", "PNG-CHAT");
    seed("assets/stickers/etoile.svg", "SVG");
    const sticker = (asset: string) => `  - { id: s-${asset.length}, type: sticker, asset: ${asset}, anchor: { block: heading, text: x, index: 0 } }`;
    seed("S.md", `---\nid: s\nstickers:\n${sticker("assets/stickers/chat.png")}\n${sticker("assets/stickers/etoile.svg")}\n  - { id: f, type: sticker, asset: fluent/sun, anchor: { block: heading, text: x, index: 0 } }\n---\n# S\n`);
    seed("T.md", `---\nid: t\nstickers:\n${sticker("assets/stickers/etoile.svg")}\n---\n# T\n`);
    await loadNotes(diskFiles());
    const { backup } = await deleteNotes(["s"]);
    expect(fake.files.has("assets/stickers/chat.png")).toBe(false);
    expect(fake.files.has("assets/stickers/etoile.svg")).toBe(true);
    expect([...fake.backups.get(backup!)!.keys()].sort()).toEqual(["S.md", "assets/stickers/chat.png"]);
    expect(await undoBulk(backup!)).toBe("undone");
    expect(fake.files.get("assets/stickers/chat.png")?.content).toBe("PNG-CHAT");
  });

  it("purges backups older than 30 days", async () => {
    for (const name of ["2026-08-01_10-00-00-delete-tag", "2026-09-20_10-00-00-rename-tag"]) fake.backups.set(name, new Map());
    await purgeOldBackups(new Date(2026, 9, 2, 12).getTime());
    expect([...fake.backups.keys()]).toEqual(["2026-09-20_10-00-00-rename-tag"]);
  });
});
