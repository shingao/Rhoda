import { invoke } from "@tauri-apps/api/core";
import type { SortKey } from "../core/note/sort";
import { DEFAULT_LANGUAGE, isLanguage, type Language } from "../i18n";

export interface Settings {
  /** Absolute path of the notes folder; null = default (Documents/Ursa). */
  vaultPath: string | null;
  /** UI language (French by default). */
  language: Language;
  theme: "coral";
  sort: SortKey;
  editor: {
    typewriter: boolean;
  };
  layout: {
    /** Widths in px; null = default from DESIGN tokens. */
    sidebarWidth: number | null;
    listWidth: number | null;
    sidebarCollapsed: boolean;
    listCollapsed: boolean;
    /** Contents panel open (remembered globally) [DESIGN §2.15]. */
    outlineOpen: boolean;
  };
}

export const DEFAULT_SETTINGS: Settings = {
  vaultPath: null,
  language: DEFAULT_LANGUAGE,
  theme: "coral",
  sort: "modified",
  editor: { typewriter: false },
  layout: { sidebarWidth: null, listWidth: null, sidebarCollapsed: false, listCollapsed: false, outlineOpen: false },
};

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Deep-merges stored values over defaults, ignoring anything of the wrong type. */
function merge<T>(defaults: T, stored: unknown): T {
  if (!isObject(defaults) || !isObject(stored)) return defaults;
  const out: Record<string, unknown> = { ...defaults };
  for (const [key, def] of Object.entries(defaults)) {
    const value = stored[key];
    if (value === undefined) continue;
    if (isObject(def)) out[key] = merge(def, value);
    else if (def === null || typeof value === typeof def) out[key] = value;
  }
  return out as T;
}

export async function loadSettings(): Promise<Settings> {
  try {
    const settings = merge(DEFAULT_SETTINGS, await invoke<unknown>("load_settings"));
    return isLanguage(settings.language) ? settings : { ...settings, language: DEFAULT_LANGUAGE };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: Settings): Promise<void> {
  return invoke("save_settings", { value: settings });
}
