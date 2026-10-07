import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import type { NoteFile } from "../core/note/note";
import demoNote from "../../samples/Démo éditeur.md?raw";
import longNote from "../../samples/Note longue (5000 lignes).md?raw";
import mockupNote from "../../samples/Maquette éditeur.md?raw";
import outlineNote from "../../samples/Maquette sommaire.md?raw";
import rhythmNote from "../../samples/Rythme vertical.md?raw";
import journalNote from "../../samples/Journal décoré.md?raw";
import { generateNotes } from "../dev/generateNotes";
import { setMockAssetUrl } from "./assets";

/** Words of the ticket sample (samples/assets/billet-train.png) as Windows OCR returns them. */
function fakeOcr(path: string) {
  const line = (y: number, h: number, words: Array<[string, number, number]>) => ({ words: words.map(([text, x, w]) => ({ text, x, y, w, h })) });
  const lines = path.endsWith("billet-train.png")
    ? [
        line(75, 22, [["JR", 83, 30], ["WEST", 122, 70], ["·", 202, 10], ["RESERVED", 222, 130], ["SEAT", 362, 82]]),
        line(122, 50, [["SHINKANSEN", 83, 420], ["15", 520, 62], ["APR", 600, 140]]),
        line(198, 40, [["KYOTO", 83, 167], ["→", 266, 46], ["NARA", 320, 138]]),
        line(262, 24, [["CAR", 83, 52], ["7", 144, 14], ["SEAT", 170, 62], ["12A", 244, 46], ["·", 298, 8], ["13:05", 316, 76]]),
      ]
    : [];
  const text = lines.map((l) => l.words.map((w) => w.text).join(" ")).join("\n");
  return { source: "ocr", width: 1000, height: 420, lines, text };
}

/** Sample attachments of the demo vault (samples/assets), served by Vite. */
const SAMPLE_ASSETS = import.meta.glob<string>("../../samples/assets/*", { query: "?url", import: "default", eager: true });

/** Format from the first bytes, as the Rust side does (enough for the browser). */
function sniff(b: Uint8Array): { ext: string; format: string } | "heic" | null {
  const ascii = (from: number, to: number) => String.fromCharCode(...b.slice(from, to));
  if (b[0] === 0x89 && ascii(1, 4) === "PNG") return { ext: "png", format: "png" };
  if (b[0] === 0xff && b[1] === 0xd8) return { ext: "jpg", format: "jpeg" };
  if (ascii(0, 4) === "GIF8") return { ext: "gif", format: "gif" };
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return { ext: "webp", format: "webp" };
  if (ascii(0, 5) === "%PDF-") return { ext: "pdf", format: "pdf" };
  if (ascii(4, 8) === "ftyp" && /^(hei|hev|mif1|msf1)/.test(ascii(8, 12))) return "heic";
  if (new TextDecoder().decode(b.slice(0, 2048)).includes("<svg")) return { ext: "svg", format: "svg" };
  return null;
}

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
    ["Journal décoré.md", journalNote, now - 20_000],
    ["Billets JR — scans.md", "# Billets JR — scans\n\n#voyages/japon-2026\n\nLe billet du 15 avril, scanné :\n\n![](assets/billet-train.png){width=480}\n\nÀ imprimer avant le départ.\n", now - 15_000],
    ["Rythme vertical.md", rhythmNote, now - 20_000],
    ["Lien vers le rythme.md", "# Lien vers le rythme\n\nVoir [[Rythme vertical]] pour le panneau des rétroliens.\n", now - 25_000],
    ["Note longue (5000 lignes).md", longNote, now - 30 * DAY],
    [
      "Pièces jointes.md",
      "# Pièces jointes\n\nLe devis reçu ce matin :\n\n[devis-renovation.pdf](assets/devis-renovation.pdf)\n\nÀ relire avant vendredi. Une image restée sur le web :\n\n![Photo du chantier](https://example.com/photos/chantier.jpg){width=400}\n\nUne autre, sur le réseau local :\n\n![](http://192.168.1.20/camera.jpg)\n",
      now - 5_000,
    ],
    [
      "Aperçus de liens.md",
      "# Aperçus de liens\n\nUne URL seule sur sa ligne devient une carte :\n\nhttps://example.com/articles/rythme-vertical\n\nUne adresse de l'intranet reste un lien simple, sans aucune requête :\n\nhttp://wiki.corp/accueil\n\nUn lien simple voulu :\n\n<https://example.com/articles/rythme-vertical>\n",
      now - 10_000,
    ],
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
  /** Attachments per vault: path → URL (+ bytes for imported ones, to find duplicates). */
  const assets = new Map<string, Map<string, { url: string; bytes?: Uint8Array }>>();
  const assetsOf = (vault: string) => {
    if (!assets.has(vault)) assets.set(vault, new Map());
    return assets.get(vault)!;
  };
  for (const [file, url] of Object.entries(SAMPLE_ASSETS)) assetsOf(DEFAULT_VAULT).set(`assets/${file.split("/").pop()}`, { url });
  assetsOf(DEFAULT_VAULT).set(".ursa/previews/demo/image.png", assetsOf(DEFAULT_VAULT).get("assets/paysage.png")!);
  let vaultPath = DEFAULT_VAULT;
  setMockAssetUrl((path) => assetsOf(vaultPath).get(path.replace(/^_thumb\//, ""))?.url ?? null);
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

  const ocrCache = new Map<string, unknown>();
  const assetBackups = new Map<string, Map<string, ReturnType<typeof assetsOf> extends Map<string, infer A> ? A : never>>();
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
      case "import_bytes": {
        const bytes = payload as unknown as Uint8Array;
        const kind = sniff(bytes);
        if (kind === "heic") return { status: "refused", name: "image", reason: "heic" };
        if (!kind) return { status: "refused", name: "fichier", reason: "unsupported" };
        const store = assetsOf(vaultPath);
        const same = [...store].find(([, a]) => a.bytes && a.bytes.length === bytes.length && a.bytes.every((v, i) => v === bytes[i]));
        if (same) return { status: "ok", path: same[0], format: kind.format, width: null, height: null, reused: true };
        let path = `assets/capture.${kind.ext}`;
        for (let n = 2; store.has(path); n++) path = `assets/capture-${n}.${kind.ext}`;
        const type = kind.format === "svg" ? "image/svg+xml" : kind.format === "pdf" ? "application/pdf" : `image/${kind.format}`;
        store.set(path, { url: URL.createObjectURL(new Blob([bytes.slice()], { type })), bytes: bytes.slice() });
        return { status: "ok", path, format: kind.format, width: null, height: null, reused: false };
      }
      case "link_preview": {
        // Browser only: a fake card for example.com, everything else stays a plain link.
        const url = (payload as { url: string }).url;
        if (!/^https:\/\/example\.com\//.test(url)) throw { kind: "other", message: "blocked" };
        return {
          url,
          domain: "example.com",
          title: "Le rythme vertical en typographie",
          description: "Pourquoi aligner chaque ligne sur une grille de 28 px rend une page plus calme à lire, et comment le faire avec des blocs de hauteurs variées.",
          site: "Example",
          image: ".ursa/previews/demo/image.png",
          icon: null,
          fetchedAt: Date.now(),
          stale: false,
        };
      }
      case "pdf_info": {
        const path = (payload as { path: string }).path;
        const store = assetsOf(vaultPath);
        if (!store.has(path)) throw { kind: "notFound", message: path };
        const thumb = `.ursa/thumbs/pdf-${path}.png`;
        return { bytes: 1460, thumb: store.has(thumb) ? thumb : null, pages: store.has(thumb) ? 2 : null };
      }
      case "save_pdf_preview":
        // The path header is not visible here: the demo vault has a single PDF.
        assetsOf(vaultPath).set(".ursa/thumbs/pdf-assets/devis-renovation.pdf.png", {
          url: URL.createObjectURL(new Blob([(payload as unknown as Uint8Array).slice()], { type: "image/png" })),
        });
        return null;
      case "open_attachment":
        return null;
      case "download_image": {
        // Browser only: example.com images become the sample landscape, anything else is "blocked".
        const url = (payload as { url: string }).url;
        if (!/^https:\/\/example\.com\//.test(url)) throw { kind: "other", message: "blocked: Address" };
        return { status: "ok", path: "assets/paysage.png", format: "png", width: 640, height: 360, reused: true };
      }
      case "asset_info":
        return ((payload as { paths: string[] }).paths ?? []).map(() => null);
      case "import_clipboard_image":
        return null;
      case "import_files":
      case "pick_attachments":
        return [];
      // Stickers: the picker returns the sample SVG / PNG ("ursa-dev-pick-stickers" = comma-separated sample names).
      case "pick_stickers":
        return (localStorage.getItem("ursa-dev-pick-stickers") ?? "schema.svg").split(",").map((n) => `C:\\Users\\dev\\Images\\${n}`);
      case "import_stickers": {
        const store = assetsOf(vaultPath);
        return ((payload as { paths: string[] }).paths ?? []).map((p) => {
          const name = p.split(/[\\/]/).pop()!;
          const sample = store.get(`assets/${name}`) ?? assetsOf(DEFAULT_VAULT).get(`assets/${name}`);
          const ext = name.split(".").pop()!.toLowerCase();
          if (!sample || !["png", "webp", "svg"].includes(ext)) return { status: "refused", name, reason: "unsupported" };
          const same = [...store].find(([path, a]) => path.startsWith("assets/stickers/") && a.url === sample.url);
          if (same) return { status: "ok", path: same[0], format: ext, width: null, height: null, reused: true };
          const path = `assets/stickers/${name.toLowerCase()}`;
          store.set(path, sample);
          return { status: "ok", path, format: ext, width: null, height: null, reused: false };
        });
      }
      // OCR (phase 9): canned result for the ticket sample; localStorage "ursa-dev-ocr" = "off" (no engine) or "en" (English only).
      case "ocr_status": {
        const mode = localStorage.getItem("ursa-dev-ocr");
        const languages = [{ tag: "fr-FR", name: "Français (France)" }, { tag: "en-US", name: "English (United States)" }].filter((l) => mode !== "en" || l.tag === "en-US");
        return mode === "off" ? { available: false, languages: [], maxDimension: 0 } : { available: true, languages, maxDimension: 2600 };
      }
      case "ocr_cached": {
        const { paths, langs } = payload as { paths: string[]; langs: string[] };
        return paths.map((p) => ocrCache.get(`${vaultPath}|${p}|${langs.join(",")}`) ?? null);
      }
      case "ocr_image": {
        const { path, langs } = payload as { path: string; langs: string[] };
        return new Promise((resolve) =>
          setTimeout(() => {
            const doc = { version: 1, langs, pages: [fakeOcr(path)] };
            ocrCache.set(`${vaultPath}|${path}|${langs.join(",")}`, doc);
            resolve(doc);
          }, 600),
        );
      }
      case "ocr_page":
        return { source: "ocr", width: 1000, height: 1400, lines: [], text: "Page numérisée — tampon REÇU LE 2 OCTOBRE" };
      case "ocr_store": {
        const { path, doc } = payload as { path: string; doc: { langs: string[] } };
        ocrCache.set(`${vaultPath}|${path}|${doc.langs.join(",")}`, doc);
        return null;
      }
      case "ocr_clear":
        ocrCache.clear();
        return null;
      case "list_stickers":
        return [...assetsOf(vaultPath).keys()].filter((p) => p.startsWith("assets/stickers/")).reverse();
      case "list_backups":
        return [...backups].map(([name, copies]) => ({ name, notes: copies.size })).sort((a, b) => b.name.localeCompare(a.name));
      case "read_backup": {
        const copies = backups.get(args.name!);
        if (!copies) throw { kind: "notFound", message: `No backup named ${args.name}` };
        return {
          manifest: manifests.get(`${vaultPath}|${args.name}/manifest.json`) ?? null,
          tags: manifests.get(`${vaultPath}|${args.name}/tags.json`) ?? null,
          files: [...copies].map(([path, content]) => ({ path, content, mtime: 0, created: 0 })),
        };
      }
      case "write_backup_file":
        manifests.set(`${vaultPath}|${args.name}/${args.file}`, args.content!);
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
        assetsOf(vaultPath).delete(args.path!);
        return null;
      case "backup_notes": {
        const { name, paths } = payload as { name: string; paths: string[] };
        let final = name;
        for (let n = 2; backups.has(final); n++) final = `${name}-${n}`;
        // Notes are copied as text; attachments (images, library stickers) aside.
        backups.set(final, new Map(paths.filter((p) => files.has(p)).map((p) => [p, files.get(p)!.content])));
        const store = assetsOf(vaultPath);
        assetBackups.set(final, new Map(paths.flatMap((p) => (store.has(p) ? [[p, store.get(p)!] as const] : []))));
        return final;
      }
      case "restore_backup_assets": {
        const { name, paths } = payload as { name: string; paths: string[] };
        const store = assetsOf(vaultPath);
        const kept = assetBackups.get(name);
        return paths.filter((p) => {
          if (store.has(p) || !kept?.has(p)) return false;
          store.set(p, kept.get(p)!);
          return true;
        });
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
      case "export_pick_folder":
        return localStorage.getItem("ursa-dev-export") ?? "C:\\Users\\dev\\Documents\\Exports";
      case "export_default_folder":
        return `C:\\Users\\dev\\Documents\\${args.name}`;
      case "export_folder_ok":
        return true;
      case "export_copy_assets":
        return (payload as { files: string[] }).files.map((f) => `assets/${f.split("/").pop()}`);
      case "export_reveal":
        return null;
      case "plugin:window|is_maximized":
      case "plugin:window|is_focused":
        return cmd.endsWith("is_focused");
      default:
        return null;
    }
  });
  // After mockIPC, which installs the invoke it wraps.
  installExportMock();
}

/** A file "written" by an export in the browser (no disk): kept for tests and captures. */
export interface MockExport {
  dir: string;
  name: string;
  bytes: Uint8Array;
  /** PDF: the page that WebView2 would print, and the paper size. */
  html?: string;
  page?: string;
}

/**
 * Exports send raw bytes with their destination in headers, which `mockIPC` does
 * not pass on: these commands are answered before it. Files land in
 * `window.__ursaExports` (Playwright reads them back).
 */
function installExportMock(): void {
  const exports: MockExport[] = [];
  (window as unknown as { __ursaExports: MockExport[] }).__ursaExports = exports;
  const internals = (window as unknown as { __TAURI_INTERNALS__: { invoke: (cmd: string, args: unknown, options?: { headers?: Record<string, string> }) => Promise<unknown> } }).__TAURI_INTERNALS__;
  const next = internals.invoke.bind(internals);
  internals.invoke = (cmd, args, options) => {
    if (cmd !== "export_write" && cmd !== "export_pdf") return next(cmd, args, options);
    const h = (name: string) => decodeURIComponent(options?.headers?.[name] ?? "");
    const dir = h("x-ursa-dir");
    let name = h("x-ursa-name");
    const dot = name.lastIndexOf(".");
    for (let n = 2; exports.some((e) => e.dir === dir && e.name === name); n++) name = `${h("x-ursa-name").slice(0, dot)} (${n})${h("x-ursa-name").slice(dot)}`;
    const bytes = args instanceof Uint8Array ? args : new Uint8Array();
    exports.push(cmd === "export_pdf" ? { dir, name, bytes, html: new TextDecoder().decode(bytes), page: h("x-ursa-page") } : { dir, name, bytes });
    return Promise.resolve(`${dir}\\${name}`);
  };
}
