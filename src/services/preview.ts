import { invoke } from "@tauri-apps/api/core";

/** A link card, as fetched and cached by the Rust side (`.ursa/previews/`). */
export interface LinkPreview {
  url: string;
  domain: string;
  title: string | null;
  description: string | null;
  site: string | null;
  /** Vault-relative paths of the cached image and favicon (vault: protocol). */
  image: string | null;
  icon: string | null;
  fetchedAt: number;
  /** Over 30 days old and could not be refreshed (offline). */
  stale: boolean;
}

export const previewApi = {
  /** Rejects when the link must stay plain: blocked (local network…), unreachable, not a page. */
  fetch: (url: string, refresh = false) => invoke<LinkPreview>("link_preview", { url, refresh }),
};
