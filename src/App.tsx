import { useEffect } from "react";
import { bootstrap } from "./app/bootstrap";
import { focusSearch } from "./app/commands";
import { useT } from "./app/i18n";
import { toggleColumn } from "./app/layout";
import { createNote } from "./app/notes";
import { useGlobalShortcuts, type ShortcutHandlers } from "./app/shortcuts";
import { useApp } from "./app/store";
import { AppLayout } from "./features/layout/AppLayout";
import s from "./App.module.css";

const globalHandlers: ShortcutHandlers = {
  "note.new": () => void createNote(),
  "search.focus": focusSearch,
  "layout.toggleSidebar": () => toggleColumn("sidebar"),
  "layout.toggleList": () => toggleColumn("list"),
};

export function App() {
  const vault = useApp((st) => st.vault);
  const t = useT();
  useGlobalShortcuts(globalHandlers);
  useEffect(() => void bootstrap(), []);

  if (vault.kind === "error") {
    return (
      <div role="alert" className={s.error}>
        {t.errors.vaultOpen(vault.message)}
      </div>
    );
  }
  return <AppLayout />;
}
