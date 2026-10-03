import type { CardData, CardState } from "../editor/embeds/linkCard";
import { refreshEditor } from "../editor/session";
import { assetsApi } from "../services/assets";
import { previewApi, type LinkPreview } from "../services/preview";
import { getState, setState, useApp } from "./store";

/**
 * Link cards of the open notes (setting "Link previews"): fetched once per
 * session by the Rust side (cached on disk for 30 days), shown by the editor.
 * A link that cannot be previewed (blocked, offline without cache, not a
 * page) stays a plain link.
 */

const states = new Map<string, CardState>();

function toCard(p: LinkPreview): CardData {
  return {
    url: p.url,
    domain: p.domain,
    title: p.title ?? p.site ?? p.domain,
    description: p.description,
    image: p.image ? assetsApi.url(p.image) : null,
    icon: p.icon ? assetsApi.url(p.icon) : null,
  };
}

function load(url: string, refresh: boolean): void {
  if (!refresh) states.set(url, { status: "loading" });
  previewApi
    .fetch(url, refresh)
    .then((p) => states.set(url, { status: "ready", card: toCard(p) }))
    .catch(() => {
      if (!refresh || states.get(url)?.status !== "ready") states.set(url, { status: "plain" });
    })
    .finally(refreshEditor);
}

/** Editor hook: card of a URL alone on its line, or null when previews are off. */
export function urlCard(url: string): CardState | null {
  if (!getState().settings.editor.linkPreviews) return null;
  const known = states.get(url);
  if (known) return known;
  load(url, false);
  return states.get(url)!;
}

/** Card menu › "Refresh preview". */
export function refreshCard(url: string): void {
  load(url, true);
}

/** Turning the setting on or off redraws the open note. */
export function connectPreviews(): void {
  useApp.subscribe((state, previous) => {
    if (state.settings.editor.linkPreviews !== previous.settings.editor.linkPreviews) refreshEditor();
  });
}

/** Editor hook: the "…" of a card was clicked. */
export function openCardMenu(url: string, lineFrom: number, at: { x: number; y: number }): void {
  const { selectedId } = getState();
  if (selectedId) setState({ cardMenu: { noteId: selectedId, url, lineFrom, at } });
}
