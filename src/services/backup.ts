import { invoke } from "@tauri-apps/api/core";

export interface NoteCopy {
  stem: string;
  content: string;
}

/** Opens a native dialog and writes copies there. Resolves to the destination, or null if cancelled. */
export function saveCopies(notes: NoteCopy[], title: string): Promise<string | null> {
  return invoke<string | null>("save_copies", { notes, title });
}
