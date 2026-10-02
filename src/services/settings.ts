import { invoke } from "@tauri-apps/api/core";
import { PAPERS, type Paper } from "../core/note/note";
import type { SortKey } from "../core/note/sort";
import { DEFAULT_LANGUAGE, isLanguage, type Language } from "../i18n";

export interface Settings {
  /** Absolute path of the notes folder; null = default (Documents/Ursa). */
  vaultPath: string | null;
  /** UI language (French by default). */
  language: Language;
  appearance: Appearance;
  sort: SortKey;
  editor: EditorSettings;
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

export const LIGHT_PALETTES = ["coral", "sage", "ink", "kraft"] as const;
export const DARK_PALETTES = ["graphite", "blue"] as const;
export type LightPalette = (typeof LIGHT_PALETTES)[number];
export type DarkPalette = (typeof DARK_PALETTES)[number];
export type Palette = LightPalette | DarkPalette;
export type ThemeMode = "light" | "dark" | "system";
export { PAPERS, type Paper };

export interface Appearance {
  mode: ThemeMode;
  light: LightPalette;
  dark: DarkPalette;
}

export interface EditorSettings {
  typewriter: boolean;
  font: "sans" | "serif";
  /** px, 14–20 by 0.5 [DESIGN §6]. */
  fontSize: number;
  /** Text column, px, 560–860 by 20 [DESIGN Layout]. */
  columnWidth: number;
  /** H1–H6 markers in the margin [DESIGN §2.14]. */
  headingMarkers: boolean;
  /** Default page background of notes without their own [DESIGN §7]. */
  paper: Paper;
  margin: boolean;
  /** Link preview cards (phase 7): the only network request of the app. */
  linkPreviews: boolean;
}

export const FONT_SIZE = { min: 14, max: 20, step: 0.5, default: 16.5 } as const;
export const COLUMN_WIDTH = { min: 560, max: 860, step: 20, default: 660 } as const;

export const DEFAULT_SETTINGS: Settings = {
  vaultPath: null,
  language: DEFAULT_LANGUAGE,
  appearance: { mode: "light", light: "coral", dark: "graphite" },
  sort: "modified",
  editor: {
    typewriter: false,
    font: "sans",
    fontSize: FONT_SIZE.default,
    columnWidth: COLUMN_WIDTH.default,
    headingMarkers: true,
    paper: "plain",
    margin: false,
    linkPreviews: true,
  },
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

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const oneOf = <T extends string>(v: string, values: readonly T[], fallback: T): T => ((values as readonly string[]).includes(v) ? (v as T) : fallback);

/** Values of the right type but out of range (edited by hand) are brought back in range. */
export function sanitizeSettings(s: Settings): Settings {
  const a = s.appearance;
  const e = s.editor;
  return {
    ...s,
    language: isLanguage(s.language) ? s.language : DEFAULT_LANGUAGE,
    appearance: {
      mode: oneOf(a.mode, ["light", "dark", "system"], "light"),
      light: oneOf(a.light, LIGHT_PALETTES, "coral"),
      dark: oneOf(a.dark, DARK_PALETTES, "graphite"),
    },
    editor: {
      ...e,
      font: oneOf(e.font, ["sans", "serif"], "sans"),
      fontSize: Math.round(clamp(e.fontSize, FONT_SIZE.min, FONT_SIZE.max) / FONT_SIZE.step) * FONT_SIZE.step,
      columnWidth: Math.round(clamp(e.columnWidth, COLUMN_WIDTH.min, COLUMN_WIDTH.max) / COLUMN_WIDTH.step) * COLUMN_WIDTH.step,
      paper: oneOf(e.paper, PAPERS, "plain"),
    },
  };
}

export async function loadSettings(): Promise<Settings> {
  try {
    return sanitizeSettings(merge(DEFAULT_SETTINGS, await invoke<unknown>("load_settings")));
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: Settings): Promise<void> {
  return invoke("save_settings", { value: settings });
}
