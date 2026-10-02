import { tagKey } from "../core/markdown/extract";
import type { Note } from "../core/note/note";
import { tagRemoveChanges, tagRenameChanges } from "../core/rewrite";
import { cleanTagName, isTagWithin } from "../core/tags";
import { vaultApi } from "../services/vault";
import { rewriteNotes, setFilter } from "./notes";
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

/** Renames `#old` (and `#old/…`) to `newName` in every note. Returns the number of notes changed. */
export async function renameTag(oldKey: string, newName: string): Promise<number> {
  const name = cleanTagName(newName);
  if (!name) return 0;
  const count = await rewriteNotes(hasTag(oldKey), (text) => tagRenameChanges(text, oldKey, name));
  const newKey = tagKey(name);
  moveConfig(oldKey, newKey);
  const { filter } = getState();
  if (filter.kind === "tag" && isTagWithin(filter.key, oldKey)) setFilter({ kind: "tag", key: newKey + filter.key.slice(oldKey.length) });
  return count;
}

/** Removes `#tag` (and `#tag/…`) from every note; the text around it stays. */
export async function deleteTag(key: string): Promise<number> {
  const count = await rewriteNotes(hasTag(key), (text) => tagRemoveChanges(text, key));
  moveConfig(key, null);
  const { filter } = getState();
  if (filter.kind === "tag" && isTagWithin(filter.key, key)) setFilter({ kind: "section", section: "notes" });
  return count;
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

/** Loads `.ursa/tags.json` and saves it again whenever the settings change. */
export async function loadTagConfig(): Promise<void> {
  try {
    const text = await vaultApi.readInternal(TAGS_FILE);
    const parsed: unknown = text ? JSON.parse(text) : null;
    const tags = parsed && typeof parsed === "object" && "tags" in parsed ? (parsed as { tags: unknown }).tags : null;
    if (tags && typeof tags === "object") setState({ tagConfig: tags as Record<string, TagSettings> });
  } catch (e) {
    console.warn("[ursa] tags.json ignored", e);
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  useApp.subscribe((state, previous) => {
    if (state.tagConfig === previous.tagConfig) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      const content = JSON.stringify({ version: 1, tags: getState().tagConfig }, null, 2);
      void vaultApi.writeInternal(TAGS_FILE, content).catch((e: unknown) => console.warn("[ursa] tags.json not saved", e));
    }, SAVE_DELAY);
  });
}
