import { invoke } from "@tauri-apps/api/core";

/** Paper sizes of the PDF export. */
export type PageSize = "a4" | "letter";

const headers = (entries: Record<string, string>) => ({ headers: Object.fromEntries(Object.entries(entries).map(([k, v]) => [k, encodeURIComponent(v)])) });

/**
 * The only module that talks to the Rust export commands. Files go only to a
 * folder the user chose; an existing file is never replaced (`Name (2).pdf`).
 */
export const exportApi = {
  pickFolder: (title: string, current: string | null) => invoke<string | null>("export_pick_folder", { title, current }),
  /** `Documents\<name>`, created if needed. */
  defaultFolder: (name: string) => invoke<string>("export_default_folder", { name }),
  /** Whether the remembered folder can still be written to. */
  folderOk: (dir: string) => invoke<boolean>("export_folder_ok", { dir }),
  /** Writes a file; returns its full path (the name may get a number). */
  write: (dir: string, name: string, bytes: Uint8Array) => invoke<string>("export_write", bytes, headers({ "x-ursa-dir": dir, "x-ursa-name": name })),
  /** Copies vault files to `<dir>/assets/`; their paths relative to `dir` (null: not copied). */
  copyAssets: (dir: string, files: string[]) => invoke<Array<string | null>>("export_copy_assets", { dir, files }),
  /** PDF printed by WebView2 from a standalone page. */
  pdf: (dir: string, name: string, html: string, page: PageSize) =>
    invoke<string>("export_pdf", new TextEncoder().encode(html), headers({ "x-ursa-dir": dir, "x-ursa-name": name, "x-ursa-page": page })),
  reveal: (path: string) => invoke<void>("export_reveal", { path }),
};
