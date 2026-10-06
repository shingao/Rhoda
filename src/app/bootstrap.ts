import { appWindow } from "../services/appWindow";
import { errorMessage } from "../services/errors";
import { loadSettings, saveSettings } from "../services/settings";
import { vaultApi } from "../services/vault";
import { connectEditor } from "./editorBridge";
import { connectTheme } from "./theme";
import { connectSearch } from "./search";
import { flushAll, handleDiskChanges, prepareClose } from "./notes";
import { getState, setState, useApp } from "./store";
import { connectAttachments } from "./attachments";
import { connectOcr } from "./ocr";
import { connectPreviews } from "./previews";
import { connectTagConfig } from "./tagOps";
import { openVault } from "./vault";

const SETTINGS_SAVE_DELAY = 300;
let started = false;

/** Loads settings and the vault, then wires watcher, persistence and close handling. */
export async function bootstrap(): Promise<void> {
  if (started) return;
  started = true;
  try {
    const settings = await loadSettings();
    setState({ settings });
    connectTheme();
    document.documentElement.lang = settings.language;
    // Shown once themed (React has already rendered). Not via requestAnimationFrame:
    // a hidden window never gets animation frames.
    setTimeout(() => void appWindow.show().catch(() => undefined), 0);
    persistSettingsOnChange();
    connectEditor();
    connectSearch();
    connectTagConfig();
    connectAttachments();
    connectOcr();
    connectPreviews();

    await vaultApi.onChanged((paths) => void handleDiskChanges(paths));
    const path = settings.vaultPath ?? (await vaultApi.defaultPath());
    await openVault(path);

    window.addEventListener("blur", () => void flushAll());
    await appWindow.onCloseRequested(async () => {
      if (await prepareClose()) return true;
      setState({ closePrompt: true });
      return false;
    });
  } catch (e) {
    void appWindow.show().catch(() => undefined);
    console.error("[ursa] startup failed", e);
    setState({ vault: { kind: "error", message: errorMessage(e) } });
  }
}

function persistSettingsOnChange(): void {
  let timer: number | undefined;
  useApp.subscribe((state, previous) => {
    if (state.settings === previous.settings) return;
    window.clearTimeout(timer);
    timer = window.setTimeout(() => void saveSettings(getState().settings).catch(console.error), SETTINGS_SAVE_DELAY);
  });
}
