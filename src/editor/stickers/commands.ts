import type { EditorView } from "@codemirror/view";
import { placementRotation, POSTIT_SIZE, STICKER_SIZE, stickerId, type PostitColor, type StickerKind } from "../../core/stickers";
import { editPostit, focusSticker, geometryOf, placedAt, PLACE_EVENT } from "./layer";
import { stickerById, stickersOf, stickerTransaction, type Placed } from "./state";

/** What to place: a sticker image or a post-it. */
export interface NewSticker {
  kind: StickerKind;
  asset?: string;
  color?: PostitColor;
  text?: string;
}

/** Offset of a duplicate from its original. */
const DUPLICATE_SHIFT = 16;

/**
 * Places a sticker centred on a point of the window (a drop), or in the middle
 * of the visible part of the note. Random tilt; above the others. Undoable.
 */
export function placeSticker(view: EditorView, spec: NewSticker, at?: { x: number; y: number }): string {
  const geometry = geometryOf(view);
  const scroll = view.scrollDOM.getBoundingClientRect();
  const size = spec.kind === "postit" ? POSTIT_SIZE.default : STICKER_SIZE.default;
  const point = at ?? { x: scroll.left + scroll.width / 2, y: scroll.top + scroll.height / 2 };
  const items = stickersOf(view.state);
  const sameKind = items.filter((p) => p.kind === spec.kind);
  const base: Placed = {
    id: stickerId(),
    kind: spec.kind,
    ...(spec.asset && { asset: spec.asset }),
    ...(spec.kind === "postit" && { text: spec.text ?? "", color: spec.color ?? "yellow" }),
    anchor: { type: "paragraph", text: "", index: 0 },
    pos: 0,
    dx: 0,
    dy: 0,
    rotation: placementRotation(spec.kind),
    size,
    z: sameKind.length ? Math.max(...sameKind.map((p) => p.z)) + 1 : 0,
  };
  const sticker = placedAt(view, geometry, base, { x: point.x - geometry.originX - size / 2, y: point.y - geometry.originY - size / 2 });
  view.dispatch(stickerTransaction([{ before: null, after: sticker }], PLACE_EVENT));
  // A new post-it is ready to type in.
  if (spec.kind === "postit" && !spec.text) editPostit(view, sticker.id);
  else focusSticker(view, sticker.id);
  return sticker.id;
}

export type StickerCommand = "front" | "back" | "duplicate" | "delete" | { color: PostitColor };

/** Context menu actions. Each is one undo step. */
export function runStickerCommand(view: EditorView, id: string, command: StickerCommand): void {
  const p = stickerById(view.state, id);
  if (!p) return;
  const sameKind = stickersOf(view.state).filter((s) => s.kind === p.kind && s.id !== id);
  const zs = sameKind.map((s) => s.z);
  if (command === "front") {
    if (zs.length && Math.max(...zs) >= p.z) view.dispatch(stickerTransaction([{ before: p, after: { ...p, z: Math.max(...zs) + 1 } }]));
  } else if (command === "back") {
    if (zs.length && Math.min(...zs) <= p.z) view.dispatch(stickerTransaction([{ before: p, after: { ...p, z: Math.min(...zs) - 1 } }]));
  } else if (command === "delete") {
    view.dispatch(stickerTransaction([{ before: p, after: null }]));
    view.focus();
    return;
  } else if (command === "duplicate") {
    const copy: Placed = { ...p, id: stickerId(), z: Math.max(p.z, ...zs) + 1, dy: p.dy + DUPLICATE_SHIFT };
    copy.dx = p.dx + (DUPLICATE_SHIFT / Math.max(1, geometryOf(view).colWidth)) * 100;
    view.dispatch(stickerTransaction([{ before: null, after: copy }], PLACE_EVENT));
    focusSticker(view, copy.id);
    return;
  } else if (p.kind === "postit" && p.color !== command.color) {
    view.dispatch(stickerTransaction([{ before: p, after: { ...p, color: command.color } }]));
  }
  focusSticker(view, id);
}
