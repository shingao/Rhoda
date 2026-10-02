import { useEffect, useRef, useState } from "react";
import { Ellipsis, PanelLeftClose, PanelLeftOpen, Trash2 } from "lucide-react";
import { toggleColumn } from "../../app/layout";
import { editNote, trashNote } from "../../app/notes";
import { useApp } from "../../app/store";
import { attachAutoHideScrollbar } from "../../components/useAutoHideScrollbar";
import { IconButton } from "../../components/IconButton";
import { Menu } from "../../components/Menu";
import { editorExtensions } from "../../editor/setup";
import { mountEditor, showNote, unmountEditor } from "../../editor/session";
import s from "./EditorPane.module.css";

/** Right column: editor toolbar + CodeMirror. */
export function EditorPane() {
  const host = useRef<HTMLDivElement>(null);
  const selectedUid = useApp((st) => st.selectedUid);
  const listCollapsed = useApp((st) => st.settings.layout.listCollapsed);
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!host.current) return;
    const view = mountEditor(host.current, editorExtensions(), editNote);
    const detach = attachAutoHideScrollbar(view.scrollDOM);
    const { selectedUid: uid, notes } = useApp.getState();
    showNote(uid, uid ? (notes[uid]?.body ?? "") : "");
    return () => {
      detach();
      unmountEditor();
    };
  }, []);

  return (
    <section className={s.pane} aria-label="Editor">
      <div className={s.bar}>
        <IconButton
          icon={listCollapsed ? PanelLeftOpen : PanelLeftClose}
          label={listCollapsed ? "Show note list" : "Hide note list"}
          shortcut="Ctrl Shift \"
          onClick={() => toggleColumn("list")}
        />
        <div className={s.spacer} />
        <IconButton
          icon={Ellipsis}
          label="More"
          aria-haspopup="menu"
          disabled={!selectedUid}
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            setMenuAt({ x: r.right, y: r.bottom + 4 });
          }}
        />
      </div>
      <div ref={host} className={s.host} hidden={!selectedUid} />
      {!selectedUid && (
        <div className={s.empty}>
          <p className={s.emptyTitle}>No note selected</p>
          <p className={s.emptyHint}>Press Ctrl N to create a note.</p>
        </div>
      )}
      {menuAt && selectedUid && (
        <Menu
          at={menuAt}
          align="end"
          label="Note actions"
          entries={[{ id: "trash", label: "Move to Trash", icon: Trash2, danger: true, onSelect: () => void trashNote(selectedUid) }]}
          onClose={() => setMenuAt(null)}
        />
      )}
    </section>
  );
}
