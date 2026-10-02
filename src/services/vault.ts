import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { NoteFile } from "../core/note/note";

export interface RestoreItem {
  /** Path of the copy inside the backup. */
  from: string;
  /** Where to write it back. */
  to: string;
  /** Deleted note: recreated without replacing another file. */
  create: boolean;
}

/** The only module that talks to the Rust vault commands. */
export const vaultApi = {
  defaultPath: () => invoke<string>("default_vault_path"),
  open: (path: string) => invoke<NoteFile[]>("open_vault", { path }),
  read: (path: string) => invoke<NoteFile | null>("read_note", { path }),
  write: (path: string, content: string) => invoke<number>("write_note", { path, content }),
  create: (stem: string, content: string) => invoke<NoteFile>("create_note", { stem, content }),
  rename: (from: string, stem: string) => invoke<string>("rename_note", { from, stem }),
  /** Sends the file to the system recycle bin. */
  remove: (path: string) => invoke<void>("delete_note", { path }),
  /** Files of the vault's `.ursa/` folder (tags.json…). */
  readInternal: (name: string) => invoke<string | null>("read_internal", { name }),
  writeInternal: (name: string, content: string) => invoke<void>("write_internal", { name, content }),
  /** Copies notes into `.ursa/backups/<name>/` before a bulk operation; returns the final folder name. */
  backup: (name: string, paths: string[]) => invoke<string>("backup_notes", { name, paths }),
  restore: (name: string, items: RestoreItem[]) => invoke<NoteFile[]>("restore_backup", { name, items }),
  /** Removes backups whose name sorts before `before` (a file stamp). */
  purgeBackups: (before: string) => invoke<number>("purge_backups", { before }),
  onChanged: (handler: (paths: string[]) => void): Promise<UnlistenFn> =>
    listen<string[]>("vault://changed", (e) => handler(e.payload)),
};
