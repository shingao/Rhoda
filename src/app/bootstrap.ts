import { appWindow } from "../services/appWindow";
import { errorMessage } from "../services/errors";
import { loadSettings, saveSettings } from "../services/settings";
import { vaultApi } from "../services/vault";
import { connectEditor } from "./editorBridge";
import { connectTheme } from "./theme";
import { connectShortcuts } from "./shortcuts";
import { connectSearch } from "./search";
import { flushAll, handleDiskChanges, prepareClose } from "./notes";
import { getState, setState, updateSettings, useApp } from "./store";
import { connectAttachments } from "./attachments";
import { connectOcr } from "./ocr";
import { connectPreviews } from "./previews";
import { connectTagConfig } from "./tagOps";
import { openVault } from "./vault";
import { welcomeOnFirstLaunch } from "./welcome";

const SETTINGS_SAVE_DELAY = 300;
/** A close during startup waits this long for the vault to open (a slow or missing drive never blocks it). */
const STARTUP_WAIT = 5000;
let started = false;

/** Loads settings and the vault, then wires watcher, persistence and close handling. */
export async function bootstrap(): Promise<void> {
  if (started) return;
  started = true;
  // Startup measurements (scripts/perf.mjs): boot → vault ready → first frame.
  performance.mark("ursa:boot");
  let startupDone: () => void = () => undefined;
  const startup = new Promise<void>((resolve) => (startupDone = resolve));
  try {
    const settings = await loadSettings();
    setState({ settings });
    connectTheme();
    connectShortcuts();
    document.documentElement.lang = settings.language;
    // Shown once themed (React has already rendered). Not via requestAnimationFrame:
    // a hidden window never gets animation frames.
    setTimeout(() => void appWindow.show().catch(() => undefined), 0);
    const flushSettings = persistSettingsOnChange();
    // From the moment the window can be seen: a close during startup waits for the
    // vault and the welcome note (at most STARTUP_WAIT), then writes everything.
    await appWindow.onCloseRequested(async () => {
      await Promise.race([startup, new Promise((resolve) => setTimeout(resolve, STARTUP_WAIT))]);
      const saved = await prepareClose();
      await flushSettings();
      if (saved) return true;
      setState({ closePrompt: true });
      return false;
    });
    connectEditor();
    connectSearch();
    connectTagConfig();
    connectAttachments();
    connectOcr();
    connectPreviews();

    await vaultApi.onChanged((paths) => void handleDiskChanges(paths));
    // Chosen explicitly before 1.0 as Documents\Ursa: it is the default folder, moved to Documents\Bullshit.
    if (settings.vaultPath && (await vaultApi.isOldDefault(settings.vaultPath).catch(() => false))) {
      updateSettings((s) => ({ ...s, vaultPath: null }));
    }
    const path = getState().settings.vaultPath ?? (await vaultApi.defaultPath());
    await openVault(path);
    await welcomeOnFirstLaunch();
    startupDone();
    performance.mark("ursa:ready");
    requestAnimationFrame(() => requestAnimationFrame(() => performance.mark("ursa:interactive")));

    window.addEventListener("blur", () => void flushAll());
  } catch (e) {
    startupDone();
    void appWindow.show().catch(() => undefined);
    console.error("[ursa] startup failed", e);
    setState({ vault: { kind: "error", message: errorMessage(e) } });
  }
}

/** Saves the settings shortly after each change; returns a flush for the close (a change not saved yet is written at once). */
function persistSettingsOnChange(): () => Promise<void> {
  let timer: number | undefined;
  useApp.subscribe((state, previous) => {
    if (state.settings === previous.settings) return;
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      timer = undefined;
      void saveSettings(getState().settings).catch(console.error);
    }, SETTINGS_SAVE_DELAY);
  });
  return async () => {
    if (timer === undefined) return;
    window.clearTimeout(timer);
    timer = undefined;
    await saveSettings(getState().settings).catch(console.error);
  };
}
