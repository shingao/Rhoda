import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/hanken-grotesk/400.css";
import "@fontsource/hanken-grotesk/400-italic.css";
import "@fontsource/hanken-grotesk/500.css";
import "@fontsource/hanken-grotesk/600.css";
import "@fontsource/hanken-grotesk/700.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "./styles/tokens.css";
import "./styles/tokens.components.css";
import "./styles/global.css";
import { App } from "./App";

async function start() {
  // Outside Tauri (plain browser during development), serve an in-memory vault.
  // VITE_URSA_MOCK=1 does the same in a production build, to measure performance.
  if ((import.meta.env.DEV || import.meta.env.VITE_URSA_MOCK === "1") && !("__TAURI_INTERNALS__" in window)) {
    const { installDevMock } = await import("./services/devMock");
    installDevMock();
  }
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void start();
