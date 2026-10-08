import { useT } from "../../app/i18n";
import { setState, useApp } from "../../app/store";
import { Menu } from "../../components/Menu";
import { alignEntries } from "./alignEntries";

/** Right-click in the text: the block's alignment (the system menu stays on Shift+right-click or over a selection). */
export function BlockMenu() {
  const menu = useApp((st) => st.blockMenu);
  const t = useT();
  if (!menu) return null;
  const entries = alignEntries(t);
  if (entries.length === 0) return null;
  return <Menu at={menu.at} label={t.align.menu} entries={entries} onClose={() => setState({ blockMenu: null })} />;
}
