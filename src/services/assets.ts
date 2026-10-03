import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";

export type AttachmentFormat = "png" | "jpeg" | "gif" | "webp" | "svg" | "pdf";
export type Refusal = "heic" | "unsupported" | "tooLarge";

/** Result of an import into `<vault>/assets/`. */
export type Imported =
  | { status: "ok"; path: string; format: AttachmentFormat; width: number | null; height: number | null; reused: boolean }
  | { status: "refused"; name: string; reason: Refusal };

export interface AssetInfo {
  width: number | null;
  height: number | null;
  bytes: number;
}

/** Development (browser) only: the in-memory vault serves its files itself. */
let mockUrl: ((path: string) => string | null) | null = null;
export function setMockAssetUrl(resolve: (path: string) => string | null): void {
  mockUrl = resolve;
}

/** The only module that talks to the Rust attachment commands. */
export const assetsApi = {
  /** Files dropped on the window or picked in the dialog (absolute paths). */
  importFiles: (paths: string[]) => invoke<Imported[]>("import_files", { paths }),
  /** Pasted bytes (clipboard), sent raw. */
  importBytes: (bytes: Uint8Array, name: string) => invoke<Imported>("import_bytes", bytes, { headers: { "x-ursa-name": encodeURIComponent(name) } }),
  /** Image of the system clipboard as PNG, or null if it holds none. */
  importClipboardImage: (name: string) => invoke<Imported | null>("import_clipboard_image", { name }),
  pick: (title: string) => invoke<string[]>("pick_attachments", { title }),
  info: (paths: string[]) => invoke<Array<AssetInfo | null>>("asset_info", { paths }),
  /** URL for <img> / pdf.js of a vault-relative file, served by the `vault:` protocol. */
  url: (path: string): string => mockUrl?.(path) ?? convertFileSrc(path, "vault"),
  /** Files dropped from the Explorer (Tauri delivers paths; `position` in physical pixels). */
  onFileDrop: (handler: (paths: string[], position: { x: number; y: number }) => void): Promise<UnlistenFn> =>
    getCurrentWebview().onDragDropEvent((e) => {
      if (e.payload.type === "drop") handler(e.payload.paths, e.payload.position);
    }),
};
