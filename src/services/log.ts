import { invoke } from "@tauri-apps/api/core";

export type LogLevel = "error" | "warn" | "info";

/** The error journal (`%LOCALAPPDATA%\com.ursa.notes\logs`, see src-tauri/src/log.rs). */
export const logApi = {
  write: (level: LogLevel, source: string, message: string) => invoke<void>("log_write", { level, source, message }),
  openFolder: () => invoke<void>("log_open_folder"),
};
