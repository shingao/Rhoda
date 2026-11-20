import { invoke } from "@tauri-apps/api/core";

/** The only module that talks to the Rust commands of the drawings' CJK font (decision P12-11). */
export const cjkFontApi = {
  /** How many of these files are on the machine, intact. */
  present: (files: ReadonlyArray<{ name: string; sha256: string }>) => invoke<number>("cjk_font_present", { files: files.map(({ name, sha256 }) => ({ name, sha256 })) }),
  /** Downloads one file (link-preview protections, checked against its SHA-256). */
  fetch: (name: string, sha256: string) => invoke<void>("cjk_font_fetch", { name, sha256 }),
  remove: () => invoke<void>("cjk_font_remove"),
};
