import { ExternalLink, Link2, RefreshCw } from "lucide-react";
import { useT } from "../../app/i18n";
import { refreshCard } from "../../app/previews";
import { setState, useApp } from "../../app/store";
import { Menu } from "../../components/Menu";
import { focusEditor, setLineText } from "../../editor/session";
import { openExternal } from "../../services/opener";

/** "…" of a link card: open, refresh, back to a plain link (`<url>`, never a card again). */
export function CardMenu() {
  const menu = useApp((st) => st.cardMenu);
  const t = useT();
  if (!menu) return null;
  return (
    <Menu
      at={menu.at}
      align="end"
      label={t.cards.menu}
      entries={[
        { id: "open", label: t.cards.open, icon: ExternalLink, onSelect: () => void openExternal(menu.url) },
        { id: "refresh", label: t.cards.refresh, icon: RefreshCw, onSelect: () => refreshCard(menu.url) },
        {
          id: "plain",
          label: t.cards.plain,
          icon: Link2,
          onSelect: () => {
            setLineText(menu.noteId, menu.lineFrom, `<${menu.url}>`);
            focusEditor();
          },
        },
      ]}
      onClose={() => setState({ cardMenu: null })}
    />
  );
}
