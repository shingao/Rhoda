import { openUrl } from "@tauri-apps/plugin-opener";

/** Opens a web or mail link in the system's default app. */
export function openExternal(url: string): Promise<void> {
  return openUrl(url);
}
