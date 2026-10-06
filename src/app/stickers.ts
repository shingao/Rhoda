import type { PostitColor } from "../core/stickers";
import { addSticker, focusEditor } from "../editor/session";
import { assetsApi, type Imported } from "../services/assets";
import { errorMessage } from "../services/errors";
import { RECENT_STICKERS } from "../services/settings";
import { currentMessages } from "./i18n";
import { getState, setState, showToast, updateSettings } from "./store";

/**
 * Stickers on the app side: where their images come from (built-in Fluent
 * Emoji, or images imported into the vault's `assets/stickers/`), the drawer
 * and its "Recent" list, and the context menu.
 */

const BUILTIN_PREFIX = "fluent/";

const builtinFiles = import.meta.glob<string>("../assets/stickers/fluent/*.webp", { eager: true, query: "?url", import: "default" });
const builtin = new Map(Object.entries(builtinFiles).map(([path, url]) => [/([^/]+)\.webp$/.exec(path)![1]!, url]));

/** Asset reference of a built-in sticker (`fluent/<id>`). */
export const builtinAsset = (id: string) => `${BUILTIN_PREFIX}${id}`;
export const isBuiltin = (asset: string) => asset.startsWith(BUILTIN_PREFIX);

/** Editor hook: image of a sticker, built in or in the vault (`assets/stickers/…`). */
export function stickerUrl(asset: string): string | null {
  if (isBuiltin(asset)) return builtin.get(asset.slice(BUILTIN_PREFIX.length)) ?? null;
  // Vault-relative path, inside the vault only.
  if (/^[\\/]|^[a-z]:|(^|[\\/])\.\.([\\/]|$)/i.test(asset)) return null;
  return assetsApi.url(asset);
}

/** Editor hook: right-click on a sticker. */
export function openStickerMenu(id: string, at: { x: number; y: number }): void {
  const { selectedId } = getState();
  if (selectedId) setState({ stickerMenu: { noteId: selectedId, id, at } });
}

/** Imported stickers of the vault ("Mine"), newest first. */
export async function refreshStickerLibrary(): Promise<void> {
  try {
    setState({ stickerLibrary: await assetsApi.listStickers() });
  } catch {
    setState({ stickerLibrary: [] });
  }
}

export function toggleStickerDrawer(open = !getState().stickerDrawer): void {
  setState({ stickerDrawer: open });
  if (open) void refreshStickerLibrary();
  else focusEditor();
}

/** What a drawer cell places. */
export type DrawerItem = { kind: "sticker"; asset: string } | { kind: "postit"; color: PostitColor };

function rememberRecent(asset: string): void {
  updateSettings((s) => ({ ...s, stickers: { ...s.stickers, recent: [asset, ...s.stickers.recent.filter((a) => a !== asset)].slice(0, RECENT_STICKERS) } }));
}

/**
 * Click on a cell (middle of the visible part of the note) or drop of a cell
 * at a point of the window. Undoable in the note.
 */
export function placeFromDrawer(item: DrawerItem, at?: { x: number; y: number }): void {
  const { selectedId } = getState();
  if (!selectedId) {
    showToast(currentMessages().stickers.noNote);
    return;
  }
  const placed = addSticker(selectedId, item.kind === "sticker" ? { kind: "sticker", asset: item.asset } : { kind: "postit", color: item.color }, at);
  if (placed && item.kind === "sticker") rememberRecent(item.asset);
}

/** Imports images as stickers, reports refusals; the vault paths of the imported ones. */
async function importStickers(paths: string[]): Promise<string[]> {
  const t = currentMessages().stickers;
  let results: Imported[];
  try {
    results = await assetsApi.importStickers(paths);
  } catch (e) {
    showToast(t.failed(errorMessage(e)));
    return [];
  }
  const refused = results.find((r) => r.status === "refused");
  const ok = results.flatMap((r) => (r.status === "ok" ? [r.path] : []));
  await refreshStickerLibrary();
  if (refused?.status === "refused") showToast(t.refused(refused.name));
  else if (ok.length) showToast(t.imported(ok.length));
  return ok;
}

/** Drawer › "Import image…": the images join "Mine". */
export async function importStickerImages(): Promise<string[]> {
  const paths = await assetsApi.pickStickers(currentMessages().stickers.pickTitle).catch(() => []);
  return paths.length ? importStickers(paths) : [];
}

/** Files dropped from the Explorer on the note while the drawer is open: imported and placed there. */
export async function dropStickerFiles(paths: string[], at: { x: number; y: number }): Promise<void> {
  const imported = await importStickers(paths);
  imported.forEach((asset, i) => placeFromDrawer({ kind: "sticker", asset }, { x: at.x + i * 24, y: at.y + i * 24 }));
}
