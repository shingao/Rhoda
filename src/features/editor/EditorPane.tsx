import { useEffect, useRef, useState } from "react";
import { CircleAlert, Ellipsis, PanelLeftClose, PanelLeftOpen, Trash2 } from "lucide-react";
import { useT } from "../../app/i18n";
import { toggleColumn } from "../../app/layout";
import { editNote, trashNote } from "../../app/notes";
import { shortcutLabel } from "../../app/shortcuts";
import { useApp } from "../../app/store";
import { attachAutoHideScrollbar } from "../../components/useAutoHideScrollbar";
import { IconButton } from "../../components/IconButton";
import { Menu } from "../../components/Menu";
import { Tooltip } from "../../components/Tooltip";
import { editorExtensions } from "../../editor/setup";
import { mountEditor, showNote, unmountEditor } from "../../editor/session";
import s from "./EditorPane.module.css";

/** Right column: editor toolbar + CodeMirror. */
export function EditorPane() {
  const host = useRef<HTMLDivElement>(null);
  const selectedId = useApp((st) => st.selectedId);
  const listCollapsed = useApp((st) => st.settings.layout.listCollapsed);
  const saveError = useApp((st) => (st.selectedId ? st.saveErrors[st.selectedId] : undefined));
  const t = useT();
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!host.current) return;
    const view = mountEditor(host.current, editorExtensions(), editNote);
    const detach = attachAutoHideScrollbar(view.scrollDOM);
    const { selectedId: id, notes } = useApp.getState();
    showNote(id, id ? (notes[id]?.body ?? "") : "");
    return () => {
      detach();
      unmountEditor();
    };
  }, []);

  return (
    <section className={s.pane} aria-label={t.editor.label}>
      <div className={s.bar}>
        <IconButton
          icon={listCollapsed ? PanelLeftOpen : PanelLeftClose}
          label={listCollapsed ? t.editor.showList : t.editor.hideList}
          shortcut={shortcutLabel("layout.toggleList", t)}
          onClick={() => toggleColumn("list")}
        />
        <div className={s.spacer} />
        {saveError && (
          <Tooltip label={t.saveStatus.tooltip(t.errors.reasons[saveError])}>
            <span className={s.unsaved} role="status" tabIndex={0} aria-label={t.saveStatus.tooltip(t.errors.reasons[saveError])}>
              <CircleAlert aria-hidden />
            </span>
          </Tooltip>
        )}
        <IconButton
          icon={Ellipsis}
          label={t.editor.more}
          aria-haspopup="menu"
          disabled={!selectedId}
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            setMenuAt({ x: r.right, y: r.bottom + 4 });
          }}
        />
      </div>
      <div ref={host} className={s.host} hidden={!selectedId} />
      {!selectedId && (
        <div className={s.empty}>
          <p className={s.emptyTitle}>{t.editor.noSelection}</p>
          <p className={s.emptyHint}>{t.editor.noSelectionHint(shortcutLabel("note.new", t))}</p>
        </div>
      )}
      {menuAt && selectedId && (
        <Menu
          at={menuAt}
          align="end"
          label={t.list.noteActions}
          entries={[{ id: "trash", label: t.list.moveToTrash, icon: Trash2, danger: true, onSelect: () => void trashNote(selectedId) }]}
          onClose={() => setMenuAt(null)}
        />
      )}
    </section>
  );
}
