import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { NoteFile } from "../core/note/note";

/** The only module that talks to the Rust vault commands. */
export const vaultApi = {
  defaultPath: () => invoke<string>("default_vault_path"),
  open: (path: string) => invoke<NoteFile[]>("open_vault", { path }),
  read: (path: string) => invoke<NoteFile | null>("read_note", { path }),
  write: (path: string, content: string) => invoke<number>("write_note", { path, content }),
  create: (stem: string, content: string) => invoke<NoteFile>("create_note", { stem, content }),
  rename: (from: string, stem: string) => invoke<string>("rename_note", { from, stem }),
  onChanged: (handler: (paths: string[]) => void): Promise<UnlistenFn> =>
    listen<string[]>("vault://changed", (e) => handler(e.payload)),
};
