import { invoke } from "@tauri-apps/api/core";

export interface DrawingVersion {
  name: string;
  /** When it was replaced (ms). */
  savedAt: number;
  bytes: number;
}

/** The only module that talks to the Rust drawing commands (`assets/dessins/`). */
export const drawingsApi = {
  /** The scene (Excalidraw JSON) of a drawing, or null if it has none. */
  read: (id: string) => invoke<string | null>("read_drawing", { id }),
  /** Writes the scene, then its SVG picture (each whole). */
  save: (id: string, source: string, svg: string) => invoke<void>("save_drawing", { id, source, svg }),
  /** Previous versions kept before each save of a modified drawing, newest first (5 at most). */
  versions: (id: string) => invoke<DrawingVersion[]>("drawing_versions", { id }),
  readVersion: (id: string, name: string) => invoke<string>("read_drawing_version", { id, name }),
  /** Copies a drawing under another id; false when it does not exist. */
  copy: (from: string, to: string) => invoke<boolean>("copy_drawing", { from, to }),
};
