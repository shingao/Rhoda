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

export interface BackupInfo {
  name: string;
  /** Notes copied. */
  notes: number;
}

export interface BackupContent {
  /** `manifest.json`; null for backups made before it existed. */
  manifest: string | null;
  /** `tags.json` before a tag rename or removal. */
  tags: string | null;
  files: NoteFile[];
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
  listBackups: () => invoke<BackupInfo[]>("list_backups"),
  readBackup: (name: string) => invoke<BackupContent>("read_backup", { name }),
  /** `manifest.json` or `tags.json` next to the copies. */
  writeBackupFile: (name: string, file: "manifest.json" | "tags.json", content: string) => invoke<void>("write_backup_file", { name, file, content }),
  /** Native folder picker; null if cancelled. */
  pickFolder: (title: string, current: string | null) => invoke<string | null>("pick_vault_folder", { title, current }),
  /** Attachments of a backup copied back (binary), unless a file is there again. */
  restoreAssets: (name: string, paths: string[]) => invoke<string[]>("restore_backup_assets", { name, paths }),
  /** Removes backups whose name sorts before `before` (a file stamp). */
  purgeBackups: (before: string) => invoke<number>("purge_backups", { before }),
  onChanged: (handler: (paths: string[]) => void): Promise<UnlistenFn> =>
    listen<string[]>("vault://changed", (e) => handler(e.payload)),
};
