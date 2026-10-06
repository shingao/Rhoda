import { setStickersHidden } from "../editor/session";
import { vaultApi } from "../services/vault";
import { getState, setState } from "./store";

/**
 * Display choices per note that are not content, in `.ursa/view.json`:
 * `{ version: 1, hiddenStickers: [<note id>…] }` ("Hide stickers").
 */
const VIEW_FILE = "view.json";
const SAVE_DELAY = 500;

let timer: ReturnType<typeof setTimeout> | undefined;

export async function loadNoteView(): Promise<void> {
  let ids: string[] = [];
  try {
    const text = await vaultApi.readInternal(VIEW_FILE);
    const parsed = text ? (JSON.parse(text) as { hiddenStickers?: unknown }) : null;
    if (Array.isArray(parsed?.hiddenStickers)) ids = parsed.hiddenStickers.filter((id): id is string => typeof id === "string");
  } catch (e) {
    console.warn("[ursa] view.json ignored", e);
  }
  setState({ hiddenStickers: Object.fromEntries(ids.map((id) => [id, true as const])) });
}

/** Editor hook: stickers of this note hidden? */
export function stickersHidden(noteId: string): boolean {
  return getState().hiddenStickers[noteId] === true;
}

/** "Hide stickers" (button or shortcut) for the open note, remembered for that note. */
export function toggleStickersHidden(): void {
  const { selectedId, hiddenStickers } = getState();
  if (!selectedId) return;
  const hidden = !hiddenStickers[selectedId];
  const next = { ...hiddenStickers };
  if (hidden) next[selectedId] = true;
  else delete next[selectedId];
  setState({ hiddenStickers: next });
  setStickersHidden(selectedId, hidden);
  clearTimeout(timer);
  timer = setTimeout(() => void save(), SAVE_DELAY);
}

function save(): Promise<void> {
  timer = undefined;
  const { notes, hiddenStickers } = getState();
  const ids = Object.keys(hiddenStickers).filter((id) => notes[id]);
  return vaultApi
    .writeInternal(VIEW_FILE, JSON.stringify({ version: 1, hiddenStickers: ids }, null, 2))
    .catch((e: unknown) => console.warn("[ursa] view.json not saved", e));
}

/** Before leaving a vault: writes pending changes now and forgets them. */
export async function closeNoteView(): Promise<void> {
  if (timer !== undefined) {
    clearTimeout(timer);
    await save();
  }
  setState({ hiddenStickers: {} });
}
