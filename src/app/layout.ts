import { cssPx } from "./cssTokens";
import { getState, updateSettings } from "./store";

type Column = "sidebar" | "list";

const tokens = {
  sidebar: { def: "--sidebar-w", min: "--sidebar-min", max: "--sidebar-max" },
  list: { def: "--list-w", min: "--list-min", max: "--list-max" },
} as const;

export function defaultWidth(column: Column): number {
  return cssPx(tokens[column].def);
}

export function columnWidth(column: Column): number {
  const { layout } = getState().settings;
  return (column === "sidebar" ? layout.sidebarWidth : layout.listWidth) ?? defaultWidth(column);
}

/** Clamps to the column's token bounds and keeps the editor at least --editor-min wide. */
export function clampWidth(column: Column, width: number): number {
  const { layout } = getState().settings;
  const other =
    column === "sidebar"
      ? layout.listCollapsed
        ? 0
        : columnWidth("list")
      : layout.sidebarCollapsed
        ? 0
        : columnWidth("sidebar");
  const room = window.innerWidth - other - cssPx("--editor-min");
  const max = Math.min(cssPx(tokens[column].max), room);
  return Math.round(Math.max(cssPx(tokens[column].min), Math.min(width, max)));
}

export function setColumnWidth(column: Column, width: number | null): void {
  const value = width === null ? null : clampWidth(column, width);
  updateSettings((s) => ({
    ...s,
    layout: { ...s.layout, [column === "sidebar" ? "sidebarWidth" : "listWidth"]: value },
  }));
}

export function toggleColumn(column: Column): void {
  updateSettings((s) => ({
    ...s,
    layout: {
      ...s.layout,
      [column === "sidebar" ? "sidebarCollapsed" : "listCollapsed"]:
        column === "sidebar" ? !s.layout.sidebarCollapsed : !s.layout.listCollapsed,
    },
  }));
}
