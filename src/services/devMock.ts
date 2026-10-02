import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import type { NoteFile } from "../core/note/note";
import demoNote from "../../samples/Démo éditeur.md?raw";
import longNote from "../../samples/Note longue (5000 lignes).md?raw";
import mockupNote from "../../samples/Maquette éditeur.md?raw";
import outlineNote from "../../samples/Maquette sommaire.md?raw";
import rhythmNote from "../../samples/Rythme vertical.md?raw";
import { generateNotes } from "../dev/generateNotes";

/**
 * Development only: lets the frontend run in a plain browser (no Tauri) with
 * an in-memory vault, for quick UI iteration and screenshots. Never bundled
 * in production builds (dynamic import behind `import.meta.env.DEV`).
 */

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function seed(now: number): Array<[string, string, number]> {
  return [
    [
      "Voyage au Japon.md",
      "---\nid: 0192f3a8-6c1e-7b3a-9d2e-5f8a908ec703\ncreated: 2026-09-12T09:10:00+02:00\npinned: true\n---\n# Voyage au Japon\n\nIdées en vrac pour le printemps. #voyages/japon-2026\n\n- [x] Réserver les vols\n- [ ] Réserver le **ryokan** à Hakone\n- [ ] Acheter le JR Pass\n",
      now - 2 * HOUR,
    ],
    [
      "Reading list.md",
      "# Reading list\n\nBooks and long reads for the autumn, with a few notes on why each one made the cut.\n\n1. *The Overstory*\n2. A Pattern Language\n",
      now - 12 * 60_000,
    ],
    [
      "Recette — pain au levain.md",
      "# Recette — pain au levain\n\n> Hydratation 75 %, pointage long au frais.\n\n```\n500 g farine T65\n375 g eau\n```\n",
      now - DAY - HOUR,
    ],
    ["Meeting notes.md", "# Meeting notes\n\n#travail/réunions\n\nAction items: ship the beta, write the changelog, ==book the room==.\n", now - 4 * DAY],
    ["Old ideas.md", "# Old ideas\n\nA note from last year.\n", now - 400 * DAY],
    [
      "Itinéraire Kyoto.md",
      "# Itinéraire Kyoto\n\n#voyages/japon-2026/kyoto\n\nTrois jours, à relier à [[Voyage au Japon]].\n\n- [x] Fushimi Inari tôt le matin\n- [x] Arashiyama\n- [ ] Philosopher's path\n- [ ] Nishiki market\n- [x] Kiyomizu-dera\n- [x] Gion le soir\n- [ ] Daitoku-ji\n",
      now - 3 * HOUR,
    ],
    [
      "Format des métadonnées.md",
      "# Format des métadonnées\n\n#projets/ursa\n\nEn-tête YAML géré par l'app ; les clés inconnues sont préservées. Voir aussi [[Synchronisation des fichiers]].\n",
      now - 2 * DAY,
    ],
    ["Courses.md", "# Courses\n\n#maison\n\n- [ ] Farine T65\n- [x] Levure\n- [ ] Café\n", now - 5 * HOUR],
    [
      "Brouillon supprimé.md",
      "---\ntrashed: 2026-09-30T18:00:00+02:00\n---\n# Brouillon supprimé\n\nUne note dans la corbeille. #maison\n",
      now - 3 * DAY,
    ],
    ["Projet archivé.md", "---\narchived: true\n---\n# Projet archivé\n\nTerminé l'an dernier. #travail\n", now - 90 * DAY],
    ["Démo éditeur.md", demoNote, now - 60_000],
    ["Maquette éditeur.md", mockupNote, now - 90_000],
    ["Maquette sommaire.md", outlineNote, now - 30_000],
    ["Rythme vertical.md", rhythmNote, now - 20_000],
    ["Lien vers le rythme.md", "# Lien vers le rythme\n\nVoir [[Rythme vertical]] pour le panneau des rétroliens.\n", now - 25_000],
    ["Note longue (5000 lignes).md", longNote, now - 30 * DAY],
  ];
}

/** Tag settings of the demo vault (icons as in maquettes 04–09). */
const DEMO_TAGS = JSON.stringify({
  version: 1,
  tags: { voyages: { icon: "plane", pinned: true }, "projets": { icon: "folder" }, maison: { icon: "house", color: 4 }, travail: { icon: "briefcase" } },
});

const DEFAULT_VAULT = "C:\\Users\\dev\\Documents\\Ursa";
type Entry = { content: string; mtime: number; created: number };

export function installDevMock(): void {
  const now = Date.now();
  // Several vaults (Settings › Notes folder); the picker returns localStorage "ursa-dev-pick" or a second demo vault.
  const vaults = new Map<string, { files: Map<string, Entry>; backups: Map<string, Map<string, string>> }>();
  const vaultOf = (path: string) => {
    if (!vaults.has(path)) vaults.set(path, { files: new Map(), backups: new Map() });
    return vaults.get(path)!;
  };
  let vaultPath = DEFAULT_VAULT;
  let files = vaultOf(DEFAULT_VAULT).files;
  let backups = vaultOf(DEFAULT_VAULT).backups;
  for (const [path, content, mtime] of seed(now)) files.set(path, { content, mtime, created: mtime });
  vaultOf("C:\\Users\\dev\\Documents\\Notes perso").files.set("Bienvenue.md", {
    content: "# Bienvenue\n\nUn second dossier de notes. #perso\n",
    mtime: now - HOUR,
    created: now - HOUR,
  });
  /** Internal files of the default vault keep their historical keys. */
  const internalKey = (name: string) => (vaultPath === DEFAULT_VAULT ? `ursa-dev-internal:${name}` : `ursa-dev-internal:${vaultPath}|${name}`);
  const manifests = new Map<string, string>();
  // Performance tests: localStorage.setItem("ursa-dev-notes", "1000") adds generated notes.
  const extra = Number(localStorage.getItem("ursa-dev-notes") ?? 0);
  for (const n of generateNotes(extra, now)) files.set(n.path, { content: n.content, mtime: n.mtime, created: n.mtime });

  const toFile = (path: string): NoteFile => ({ path, ...files.get(path)! });
  // Same naming rules as the Rust backend: case-insensitive collisions, " 2" suffix.
  const taken = (name: string, except?: string) =>
    [...files.keys()].some((p) => p.toLowerCase() === name.toLowerCase() && p.toLowerCase() !== except?.toLowerCase());
  const unique = (stem: string, except?: string) => {
    for (let n = 1; ; n++) {
      const path = n === 1 ? `${stem}.md` : `${stem} ${n}.md`;
      if (!taken(path, except)) return path;
    }
  };

  mockWindows("main");
  mockIPC((cmd, payload) => {
    const args = (payload ?? {}) as Record<string, string>;
    switch (cmd) {
      case "default_vault_path":
        return DEFAULT_VAULT;
      case "open_vault":
        vaultPath = args.path!;
        ({ files, backups } = vaultOf(vaultPath));
        return [...files.keys()].map(toFile);
      case "pick_vault_folder":
        return localStorage.getItem("ursa-dev-pick") ?? "C:\\Users\\dev\\Documents\\Notes perso";
      case "list_backups":
        return [...backups].map(([name, copies]) => ({ name, notes: copies.size })).sort((a, b) => b.name.localeCompare(a.name));
      case "read_backup": {
        const copies = backups.get(args.name!);
        if (!copies) throw { kind: "notFound", message: `No backup named ${args.name}` };
        return {
          manifest: manifests.get(`${vaultPath}|${args.name}`) ?? null,
          files: [...copies].map(([path, content]) => ({ path, content, mtime: 0, created: 0 })),
        };
      }
      case "write_backup_manifest":
        manifests.set(`${vaultPath}|${args.name}`, args.content!);
        return null;
      case "read_note":
        return files.has(args.path!) ? toFile(args.path!) : null;
      case "write_note": {
        // Simulate a locked file: localStorage.setItem("ursa-dev-fail-writes", "locked")
        const failure = localStorage.getItem("ursa-dev-fail-writes");
        if (failure) throw { kind: failure, message: "simulated failure" };
        const mtime = Date.now();
        files.set(args.path!, { content: args.content!, mtime, created: files.get(args.path!)?.created ?? mtime });
        return mtime;
      }
      case "create_note": {
        const path = unique(args.stem!);
        files.set(path, { content: args.content!, mtime: Date.now(), created: Date.now() });
        return toFile(path);
      }
      case "rename_note": {
        const dir = args.from!.includes("/") ? args.from!.slice(0, args.from!.lastIndexOf("/") + 1) : "";
        const path = dir + unique(args.stem!, args.from);
        const file = files.get(args.from!)!;
        files.delete(args.from!);
        files.set(path, file);
        return path;
      }
      case "delete_note":
        files.delete(args.path!);
        return null;
      case "backup_notes": {
        const { name, paths } = payload as { name: string; paths: string[] };
        let final = name;
        for (let n = 2; backups.has(final); n++) final = `${name}-${n}`;
        backups.set(final, new Map(paths.map((p) => [p, files.get(p)!.content])));
        return final;
      }
      case "restore_backup": {
        const { name, items } = payload as { name: string; items: Array<{ from: string; to: string; create: boolean }> };
        return items.map(({ from, to, create }) => {
          const target = create && files.has(to) ? unique(to.replace(/\.md$/, "")) : to;
          files.set(target, { content: backups.get(name)!.get(from)!, mtime: Date.now(), created: files.get(target)?.created ?? Date.now() });
          return toFile(target);
        });
      }
      case "purge_backups":
        return 0;
      case "read_internal":
        return localStorage.getItem(internalKey(args.name!)) ?? (args.name === "tags.json" && vaultPath === DEFAULT_VAULT ? DEMO_TAGS : null);
      case "write_internal":
        localStorage.setItem(internalKey(args.name!), args.content!);
        return null;
      case "load_settings":
        return JSON.parse(localStorage.getItem("ursa-dev-settings") ?? "null") as unknown;
      case "save_settings":
        localStorage.setItem("ursa-dev-settings", JSON.stringify((payload as { value: unknown }).value));
        return null;
      case "plugin:window|is_maximized":
      case "plugin:window|is_focused":
        return cmd.endsWith("is_focused");
      default:
        return null;
    }
  });
}
