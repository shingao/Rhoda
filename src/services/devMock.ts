import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import type { NoteFile } from "../core/note/note";

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
    ["Meeting notes.md", "# Meeting notes\n\nAction items: ship the beta, write the changelog, ==book the room==.\n", now - 4 * DAY],
    ["Old ideas.md", "# Old ideas\n\nA note from last year.\n", now - 400 * DAY],
  ];
}

export function installDevMock(): void {
  const now = Date.now();
  const files = new Map<string, { content: string; mtime: number; created: number }>();
  for (const [path, content, mtime] of seed(now)) files.set(path, { content, mtime, created: mtime });

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
        return "C:\\Users\\dev\\Documents\\Ursa";
      case "open_vault":
        return [...files.keys()].map(toFile);
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
