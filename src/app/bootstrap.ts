import { appWindow } from "../services/appWindow";
import { loadSettings, saveSettings } from "../services/settings";
import { vaultApi } from "../services/vault";
import { flushAll, handleDiskChanges, loadNotes, prepareClose } from "./notes";
import { getState, setState, useApp } from "./store";

const SETTINGS_SAVE_DELAY = 300;
let started = false;

/** Loads settings and the vault, then wires watcher, persistence and close handling. */
export async function bootstrap(): Promise<void> {
  if (started) return;
  started = true;
  try {
    const settings = await loadSettings();
    setState({ settings });
    document.documentElement.dataset.theme = settings.theme;
    document.documentElement.lang = settings.language;
    persistSettingsOnChange();

    await vaultApi.onChanged((paths) => void handleDiskChanges(paths));
    const path = settings.vaultPath ?? (await vaultApi.defaultPath());
    await loadNotes(await vaultApi.open(path));
    setState({ vault: { kind: "ready", path } });

    window.addEventListener("blur", () => void flushAll());
    await appWindow.onCloseRequested(async () => {
      if (await prepareClose()) return true;
      setState({ closePrompt: true });
      return false;
    });
  } catch (e) {
    setState({ vault: { kind: "error", message: String(e) } });
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
