import { assetsApi } from "../services/assets";
import { getState, setState } from "./store";

/**
 * Stickers on the app side: where their images come from (built-in Fluent
 * Emoji, or images imported into the vault) and their context menu.
 */

const BUILTIN_PREFIX = "fluent/";

const builtinFiles = import.meta.glob<string>("../assets/stickers/fluent/*.webp", { eager: true, query: "?url", import: "default" });
const builtin = new Map(Object.entries(builtinFiles).map(([path, url]) => [/([^/]+)\.webp$/.exec(path)![1]!, url]));

/** Asset reference of a built-in sticker (`fluent/<id>`). */
export const builtinAsset = (id: string) => `${BUILTIN_PREFIX}${id}`;

/** URL of a built-in sticker image. */
export function builtinUrl(id: string): string | null {
  return builtin.get(id) ?? null;
}

/** Editor hook: image of a sticker, built in or in the vault (`assets/stickers/…`). */
export function stickerUrl(asset: string): string | null {
  if (asset.startsWith(BUILTIN_PREFIX)) return builtinUrl(asset.slice(BUILTIN_PREFIX.length));
  // Vault-relative path, inside the vault only.
  if (/^[\\/]|^[a-z]:|(^|[\\/])\.\.([\\/]|$)/i.test(asset)) return null;
  return assetsApi.url(asset);
}

/** Editor hook: right-click on a sticker. */
export function openStickerMenu(id: string, at: { x: number; y: number }): void {
  const { selectedId } = getState();
  if (selectedId) setState({ stickerMenu: { noteId: selectedId, id, at } });
}
