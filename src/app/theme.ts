import { appWindow } from "../services/appWindow";
import type { Appearance, EditorSettings, Palette } from "../services/settings";
import { getState, useApp } from "./store";

/**
 * Applies appearance and editor settings to the document, live: palette
 * (light / dark / following Windows), editor font, size and column width.
 *
 * No flash at startup: `public/theme-boot.js` applies the last palette before
 * the CSS loads (from the `ursa-theme` cache written here), the window stays
 * hidden until the first render, and its native background follows the theme.
 */

const THEME_CACHE = "ursa-theme";
const darkQuery = () => window.matchMedia("(prefers-color-scheme: dark)");

export function resolvePalette(a: Appearance, systemDark: boolean): Palette {
  const dark = a.mode === "dark" || (a.mode === "system" && systemDark);
  return dark ? a.dark : a.light;
}

function applyAppearance(a: Appearance): void {
  const palette = resolvePalette(a, darkQuery().matches);
  const root = document.documentElement;
  if (root.dataset.theme !== palette) root.dataset.theme = palette;
  try {
    localStorage.setItem(THEME_CACHE, JSON.stringify(a));
  } catch {
    // Private mode: only the first frame can differ.
  }
  // The window itself (behind the webview, visible while resizing) takes the app background.
  const background = getComputedStyle(root).getPropertyValue("--bg-0").trim();
  if (background) void appWindow.setBackground(background).catch(() => undefined);
}

function applyEditor(e: EditorSettings): void {
  const style = document.documentElement.style;
  style.setProperty("--editor-fs", `${e.fontSize}px`);
  style.setProperty("--editor-max", `${e.columnWidth}px`);
  style.setProperty("--editor-font-active", e.font === "serif" ? "var(--font-editor-serif)" : "var(--font-editor)");
  document.documentElement.toggleAttribute("data-no-heading-markers", !e.headingMarkers);
}

/** Applies the settings now and whenever they (or Windows' light/dark setting) change. */
export function connectTheme(): void {
  const apply = () => {
    const { appearance, editor } = getState().settings;
    applyAppearance(appearance);
    applyEditor(editor);
  };
  apply();
  useApp.subscribe((state, previous) => {
    if (state.settings.appearance !== previous.settings.appearance) applyAppearance(state.settings.appearance);
    if (state.settings.editor !== previous.settings.editor) applyEditor(state.settings.editor);
  });
  darkQuery().addEventListener("change", () => {
    if (getState().settings.appearance.mode === "system") applyAppearance(getState().settings.appearance);
  });
}
