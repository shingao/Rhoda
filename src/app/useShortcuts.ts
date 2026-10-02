import { useEffect } from "react";
import { focusSearch } from "./commands";
import { toggleColumn } from "./layout";
import { createNote } from "./notes";

/**
 * Global shortcuts. Letters use `key` (layout-aware, works on AZERTY);
 * the backslash uses the physical key (`code`) since it needs AltGr on AZERTY.
 */
export function useShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.altKey || e.metaKey) return;
      const key = e.key.toLowerCase();
      let handled = true;
      if (key === "n" && !e.shiftKey) void createNote();
      else if (key === "k" && !e.shiftKey) focusSearch();
      else if (e.code === "Backslash") toggleColumn(e.shiftKey ? "list" : "sidebar");
      else handled = false;
      if (handled) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);
}
