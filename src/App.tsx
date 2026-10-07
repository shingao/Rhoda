import { useEffect } from "react";
import { bootstrap } from "./app/bootstrap";
import { globalHandlers } from "./app/commandList";
import { currentMessages, useT } from "./app/i18n";
import { useEscapeLeavesFocus } from "./app/layout";
import { useGlobalShortcuts } from "./app/shortcuts";
import { useApp } from "./app/store";
import { changeVaultFolder } from "./app/vault";
import { Button } from "./components/Button";
import { AppLayout } from "./features/layout/AppLayout";
import s from "./App.module.css";

/** Global shortcuts run the commands of the palette (one list, see commandList). */
const handlers = globalHandlers(currentMessages);

export function App() {
  const vault = useApp((st) => st.vault);
  const t = useT();
  useGlobalShortcuts(handlers);
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
