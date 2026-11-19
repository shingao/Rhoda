import { invoke } from "@tauri-apps/api/core";

/** The only module that talks to the Rust drawing commands (`assets/dessins/`). */
export const drawingsApi = {
  /** The scene (Excalidraw JSON) of a drawing, or null if it has none. */
  read: (id: string) => invoke<string | null>("read_drawing", { id }),
  /** Writes the scene, then its SVG picture (each whole). */
  save: (id: string, source: string, svg: string) => invoke<void>("save_drawing", { id, source, svg }),
  /** Copies a drawing under another id; false when it does not exist. */
  copy: (from: string, to: string) => invoke<boolean>("copy_drawing", { from, to }),
};
