import { ArrowDownToLine, ArrowUpToLine, Copy, Trash2 } from "lucide-react";
import { useT } from "../../app/i18n";
import { setState, useApp } from "../../app/store";
import { Menu, type MenuEntry } from "../../components/Menu";
import { POSTIT_COLORS } from "../../core/stickers";
import { stickerCommand, stickerInfo } from "../../editor/session";

/** Right-click on a sticker or post-it: stacking, duplicate, colour (post-its), delete [DESIGN §8, §9]. */
export function StickerMenu() {
  const menu = useApp((st) => st.stickerMenu);
  const t = useT();
  if (!menu) return null;
  const sticker = stickerInfo(menu.noteId, menu.id);
  if (!sticker) return null;
  const run = (command: Parameters<typeof stickerCommand>[2]) => () => stickerCommand(menu.noteId, menu.id, command);
  const entries: MenuEntry[] = [
    { id: "front", label: t.stickers.front, icon: ArrowUpToLine, onSelect: run("front") },
    { id: "back", label: t.stickers.back, icon: ArrowDownToLine, onSelect: run("back") },
    { id: "duplicate", label: t.stickers.duplicate, icon: Copy, onSelect: run("duplicate") },
  ];
  if (sticker.kind === "postit") {
    entries.push({ kind: "separator", id: "colors" });
    for (const color of POSTIT_COLORS) {
      entries.push({ id: color, label: t.stickers.colors[color], checked: sticker.color === color, onSelect: run({ color }) });
    }
  }
  entries.push({ kind: "separator", id: "end" }, { id: "delete", label: t.stickers.remove, icon: Trash2, danger: true, onSelect: run("delete") });
  return <Menu at={menu.at} label={t.stickers.menu} entries={entries} onClose={() => setState({ stickerMenu: null })} />;
}
