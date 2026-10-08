import { useEffect } from "react";
import { cssPx } from "./cssTokens";
import { focusEditor } from "../editor/session";
import { getState, setState, updateSettings, useApp } from "./store";

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

/** Showing a column leaves focus mode (the columns come back as they were). */
export function toggleColumn(column: Column): void {
  if (getState().focusMode) {
    setState({ focusMode: false });
    return;
  }
  updateSettings((s) => ({
    ...s,
    layout: {
      ...s.layout,
      [column === "sidebar" ? "sidebarCollapsed" : "listCollapsed"]:
        column === "sidebar" ? !s.layout.sidebarCollapsed : !s.layout.listCollapsed,
    },
  }));
}

/** Focus mode [§4, maquette 03]: sidebar, list and toolbars fade out; Escape or the shortcut brings them back. */
export function toggleFocusMode(): void {
  setState((s) => ({ focusMode: !s.focusMode }));
}

/**
 * Escape leaves focus mode, unless something else used it first (closing a
 * menu, the find panel, an isolated section…: those stop or prevent it).
 */
export function useEscapeLeavesFocus(): void {
  const on = useApp((st) => st.focusMode);
  useEffect(() => {
    if (!on) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || e.ctrlKey || e.shiftKey || e.altKey || e.metaKey) return;
      if (getState().settingsPage) return;
      setState({ focusMode: false });
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [on]);
}

export function toggleOutline(): void {
  updateSettings((s) => ({ ...s, layout: { ...s.layout, outlineOpen: !s.layout.outlineOpen } }));
}

/** Zones in tab order [DESIGN §5]; each container carries `data-zone`. */
const ZONES = ["titlebar", "sidebar", "list", "editor", "outline"] as const;

/** Where the keyboard lands in each zone, by preference: its current roving item, else a control. */
const ZONE_TARGETS: Record<(typeof ZONES)[number], readonly string[]> = {
  titlebar: ["input"],
  sidebar: ['[data-nav-item][tabindex="0"]', "[data-nav-item]"],
  list: ['[role="option"][tabindex="0"]', '[role="listbox"][tabindex="0"]', "button"],
  editor: [".cm-content"],
  outline: ['[tabindex="0"]', "a[href]", "button"],
};

function zoneTarget(zone: Element): HTMLElement | null {
  const name = zone.getAttribute("data-zone") as (typeof ZONES)[number];
  for (const selector of ZONE_TARGETS[name] ?? []) {
    for (const el of zone.querySelectorAll<HTMLElement>(selector)) if (el.getClientRects().length) return el;
  }
  return null;
}

/** F6 / Maj+F6: the next or previous zone that can take the focus (hidden columns are skipped). */
export function moveFocusZone(step: 1 | -1): void {
  const current = document.activeElement?.closest("[data-zone]")?.getAttribute("data-zone");
  const index = ZONES.indexOf(current as (typeof ZONES)[number]);
  // Outside every zone: F6 starts at the first one, Maj+F6 at the last.
  const from = index >= 0 ? index : step > 0 ? -1 : ZONES.length;
  for (let i = 1; i <= ZONES.length; i++) {
    const name = ZONES[(from + step * i + 2 * ZONES.length) % ZONES.length]!;
    const zone = [...document.querySelectorAll(`[data-zone="${name}"]`)].find((z) => z.getClientRects().length);
    const target = zone && zoneTarget(zone);
    if (target) {
      target.focus();
      return;
    }
  }
}

/**
 * Typewriter mode, from the "…" menu or the palette: once the menu has closed,
 * the editor gets the focus back, its cursor's line centred.
 */
export function toggleTypewriter(): void {
  updateSettings((s) => ({ ...s, editor: { ...s.editor, typewriter: !s.editor.typewriter } }));
  requestAnimationFrame(() => focusEditor());
}
