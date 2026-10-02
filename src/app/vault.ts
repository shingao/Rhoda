import { resetEditor } from "../editor/session";
import { errorMessage } from "../services/errors";
import { vaultApi } from "../services/vault";
import { closeFolds, loadFolds } from "./folds";
import { currentMessages } from "./i18n";
import { closeVault, loadNotes, purgeOldBackups } from "./notes";
import { getState, setState, showToast, updateSettings } from "./store";
import { closeTagConfig, loadTagConfig } from "./tagOps";

/** Opens a vault: notes, tag settings, folds; old backups purged. */
export async function openVault(path: string): Promise<void> {
  const files = await vaultApi.open(path);
  await loadNotes(files);
  await loadTagConfig();
  await loadFolds();
  void purgeOldBackups();
  setState({ vault: { kind: "ready", path } });
}

const samePath = (a: string, b: string | null) => b !== null && a.replace(/[\\/]+$/, "").toLowerCase() === b.replace(/[\\/]+$/, "").toLowerCase();

/** Settings › Notes folder › "Change…": native folder picker, then a clean switch. */
export async function changeVaultFolder(): Promise<void> {
  const t = currentMessages();
  const { vault } = getState();
  const current = vault.kind === "ready" ? vault.path : null;
  let picked: string | null;
  try {
    picked = await vaultApi.pickFolder(t.settings.chooseFolder, current);
  } catch (e) {
    console.warn("[ursa] folder picker failed", e);
    return;
  }
  if (picked && !samePath(picked, current)) await switchVault(picked);
}

/**
 * Leaves the open vault (everything saved first, pending tag and fold settings
 * written to it) and opens `path`. If the new folder cannot be opened, the
 * previous one is reopened.
 */
export async function switchVault(path: string): Promise<void> {
  const t = currentMessages();
  const { vault } = getState();
  const previous = vault.kind === "ready" ? vault.path : null;
  if (!(await closeVault())) {
    showToast(t.settings.unsavedBlocksSwitch);
    return;
  }
  await Promise.all([closeTagConfig(), closeFolds()]);
  resetEditor();
  setState({
    vault: { kind: "loading" },
    filter: { kind: "section", section: "notes" },
    search: { chips: [], text: "" },
    find: { ...getState().find, open: false, query: "", count: 0, current: null },
  });
  try {
    await openVault(path);
  } catch (e) {
    console.warn("[ursa] cannot open vault", path, e);
    showToast(t.settings.openFailed(errorMessage(e)));
    if (previous) {
      await openVault(previous).catch((err: unknown) => setState({ vault: { kind: "error", message: errorMessage(err) } }));
    } else {
      setState({ vault: { kind: "error", message: errorMessage(e) } });
    }
    return;
  }
  updateSettings((s) => ({ ...s, vaultPath: path }));
  showToast(t.settings.switched(Object.keys(getState().notes).length));
}
