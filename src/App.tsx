import { useEffect } from "react";
import { bootstrap } from "./app/bootstrap";
import { focusSearch } from "./app/commands";
import { useT } from "./app/i18n";
import { toggleColumn, toggleFocusMode, toggleOutline, useEscapeLeavesFocus } from "./app/layout";
import { createNote } from "./app/notes";
import { openFindFromSelection } from "./app/search";
import { useGlobalShortcuts, type ShortcutHandlers } from "./app/shortcuts";
import { getState, setState, useApp } from "./app/store";
import { toggleStickerDrawer } from "./app/stickers";
import { changeVaultFolder } from "./app/vault";
import { Button } from "./components/Button";
import { AppLayout } from "./features/layout/AppLayout";
import s from "./App.module.css";

const globalHandlers: ShortcutHandlers = {
  "note.new": () => void createNote(),
  "search.focus": focusSearch,
  "layout.toggleSidebar": () => toggleColumn("sidebar"),
  "layout.toggleList": () => toggleColumn("list"),
  "outline.toggle": toggleOutline,
  "find.open": () => openFindFromSelection(false),
  "find.replace": () => openFindFromSelection(true),
  "settings.open": () => setState({ settingsPage: getState().settingsPage ?? "general" }),
  "focus.toggle": toggleFocusMode,
  "focus.toggleKey": toggleFocusMode,
  "stickers.drawer": () => toggleStickerDrawer(),
};

export function App() {
  const vault = useApp((st) => st.vault);
  const t = useT();
  useGlobalShortcuts(globalHandlers);
  useEscapeLeavesFocus();
  useEffect(() => void bootstrap(), []);

  if (vault.kind === "error") {
    return (
      <div className={s.error}>
        <p role="alert">{t.errors.vaultOpen(vault.message)}</p>
        <Button onClick={() => void changeVaultFolder()}>{t.errors.chooseOtherFolder}</Button>
      </div>
    );
  }
  return <AppLayout />;
}
