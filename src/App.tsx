import { useEffect } from "react";
import { bootstrap } from "./app/bootstrap";
import { useApp } from "./app/store";
import { useShortcuts } from "./app/useShortcuts";
import { AppLayout } from "./features/layout/AppLayout";

export function App() {
  const vault = useApp((s) => s.vault);
  useShortcuts();
  useEffect(() => void bootstrap(), []);

  if (vault.kind === "error") {
    return (
      <div role="alert" style={{ padding: "var(--sp-6)", color: "var(--chrome-text)" }}>
        Could not open the notes folder: {vault.message}
      </div>
    );
  }
  return <AppLayout />;
}
