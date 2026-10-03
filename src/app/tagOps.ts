import { tagKey } from "../core/markdown/extract";
import type { Note } from "../core/note/note";
import { tagRemoveChanges, tagRenameChanges } from "../core/rewrite";
import { cleanTagName, isTagWithin } from "../core/tags";
import { vaultApi } from "../services/vault";
import { rewriteNotes, setFilter, type BulkResult } from "./notes";
import { getState, setState, useApp, type TagSettings } from "./store";

const TAGS_FILE = "tags.json";
const SAVE_DELAY = 300;

const hasTag = (key: string) => (n: Note) => n.syntax?.tags.some((t) => isTagWithin(tagKey(t.name), key)) ?? false;

/** Notes (trash included) that a rename or removal of `key` would modify. */
export function notesWithTag(key: string): number {
  return Object.values(getState().notes).filter(hasTag(key)).length;
}

/** Moves the settings of `key` and its descendants under a new key. */
function moveConfig(oldKey: string, newKey: string | null): void {
  setState((s) => {
    const tagConfig: Record<string, TagSettings> = {};
    for (const [k, v] of Object.entries(s.tagConfig)) {
      if (!isTagWithin(k, oldKey)) tagConfig[k] = { ...tagConfig[k], ...v };
      else if (newKey !== null) {
        const moved = newKey + k.slice(oldKey.length);
        tagConfig[moved] = { ...s.tagConfig[moved], ...v };
      }
    }
    return { tagConfig };
  });
}

/**
 * Renames `#old` (and `#old/…`) to `newName` in every note, after a safety copy
 * (rejects with BackupFailedError if it fails). Undo (toast or Settings › Backups)
 * also puts the tag settings back, from the backup's tags.json.
 */
export async function renameTag(oldKey: string, newName: string): Promise<BulkResult> {
  const name = cleanTagName(newName);
  if (!name) return { count: 0, backup: null };
  const newKey = tagKey(name);
  const result = await rewriteNotes("rename-tag", hasTag(oldKey), (text) => tagRenameChanges(text, oldKey, name), {
    scopes: [oldKey, newKey],
    snapshot: getState().tagConfig,
  });
  moveConfig(oldKey, newKey);
  const { filter } = getState();
  if (filter.kind === "tag" && isTagWithin(filter.key, oldKey)) setFilter({ kind: "tag", key: newKey + filter.key.slice(oldKey.length) });
  return result;
}

/** Removes `#tag` (and `#tag/…`) from every note; the text around it stays. Undo restores its settings too. */
export async function deleteTag(key: string): Promise<BulkResult> {
  const result = await rewriteNotes("delete-tag", hasTag(key), (text) => tagRemoveChanges(text, key), {
    scopes: [key],
    snapshot: getState().tagConfig,
  });
  moveConfig(key, null);
  const { filter } = getState();
  if (filter.kind === "tag" && isTagWithin(filter.key, key)) setFilter({ kind: "section", section: "notes" });
  return result;
}

export function updateTagSettings(key: string, patch: Partial<TagSettings>): void {
  setState((s) => {
    const next = { ...s.tagConfig[key], ...patch };
    for (const k of Object.keys(next) as Array<keyof TagSettings>) if (next[k] === undefined || next[k] === false) delete next[k];
    const tagConfig = { ...s.tagConfig };
    if (Object.keys(next).length) tagConfig[key] = next;
    else delete tagConfig[key];
    return { tagConfig };
  });
}

/** False while another vault is being opened: nothing is saved until its tags.json is read. */
let loaded = false;
let saveTimer: ReturnType<typeof setTimeout> | undefined;

function saveTagConfig(): Promise<void> {
  saveTimer = undefined;
  const content = JSON.stringify({ version: 1, tags: getState().tagConfig }, null, 2);
  return vaultApi.writeInternal(TAGS_FILE, content).catch((e: unknown) => console.warn("[ursa] tags.json not saved", e));
}

/** Saves `.ursa/tags.json` whenever the tag settings change (once, at startup). */
export function connectTagConfig(): void {
  useApp.subscribe((state, previous) => {
    if (state.tagConfig === previous.tagConfig || !loaded) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void saveTagConfig(), SAVE_DELAY);
  });
}

/** Reads `.ursa/tags.json` of the open vault. */
export async function loadTagConfig(): Promise<void> {
  loaded = false;
  let tagConfig: Record<string, TagSettings> = {};
  try {
    const text = await vaultApi.readInternal(TAGS_FILE);
    const parsed: unknown = text ? JSON.parse(text) : null;
    const tags = parsed && typeof parsed === "object" && "tags" in parsed ? (parsed as { tags: unknown }).tags : null;
    if (tags && typeof tags === "object") tagConfig = tags as Record<string, TagSettings>;
  } catch (e) {
    console.warn("[ursa] tags.json ignored", e);
  }
  setState({ tagConfig });
  loaded = true;
}

/** Before leaving a vault: writes pending changes now, then stops saving until the next load. */
export async function closeTagConfig(): Promise<void> {
  if (saveTimer !== undefined) {
    clearTimeout(saveTimer);
    await saveTagConfig();
  }
  loaded = false;
}
