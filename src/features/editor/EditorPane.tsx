import { useEffect, useRef, useState, type RefObject } from "react";
import { CircleAlert, Ellipsis, ListTree, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useT } from "../../app/i18n";
import { cssPx } from "../../app/cssTokens";
import { toggleColumn, toggleOutline } from "../../app/layout";
import { editNote, trashNote } from "../../app/notes";
import { shortcutLabel } from "../../app/shortcuts";
import { updateSettings, useApp } from "../../app/store";
import { useNow } from "../../app/useNow";
import { relativeDate } from "../../core/dates";
import { attachAutoHideScrollbar } from "../../components/useAutoHideScrollbar";
import { IconButton } from "../../components/IconButton";
import { Menu } from "../../components/Menu";
import { Tooltip } from "../../components/Tooltip";
import { editorExtensions } from "../../editor/setup";
import { mountEditor, setEditorOption, showNote, unmountEditor } from "../../editor/session";
import { typewriter, typewriterCompartment } from "../../editor/typewriter";
import { noteMenuEntries } from "../notelist/noteActions";
import { Breadcrumb } from "./Breadcrumb";
import { OutlinePanel } from "../outline/OutlinePanel";
import s from "./EditorPane.module.css";

/**
 * Right column: editor bar + CodeMirror. Bar as in the maquettes: breadcrumb on
 * the left, modification date and actions on the right.
 */
export function EditorPane() {
  const host = useRef<HTMLDivElement>(null);
  const selectedId = useApp((st) => st.selectedId);
  const note = useApp((st) => (st.selectedId ? st.notes[st.selectedId] : undefined));
  const mtime = note?.mtime;
  const listCollapsed = useApp((st) => st.settings.layout.listCollapsed);
  const saveError = useApp((st) => (st.selectedId ? st.saveErrors[st.selectedId] : undefined));
  const typewriterOn = useApp((st) => st.settings.editor.typewriter);
  const outlineOpen = useApp((st) => st.settings.layout.outlineOpen);
  const body = useRef<HTMLDivElement>(null);
  const docked = useDocking(body);
  const t = useT();
  const now = useNow();
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

  useEffect(() => setEditorOption(typewriterCompartment, typewriter(typewriterOn)), [typewriterOn]);

  const edited = mtime !== undefined ? relativeDate(mtime, now, t.dates) : null;

  return (
    <section className={s.pane} aria-label={t.editor.label}>
      <div className={s.bar}>
        <Breadcrumb />
        <div className={s.spacer} />
        {edited && <span className={s.edited}>{t.editor.editedAt(edited.kind, edited.text)}</span>}
        {saveError && (
          <Tooltip label={t.saveStatus.tooltip(t.errors.reasons[saveError])}>
            <span className={s.unsaved} role="status" tabIndex={0} aria-label={t.saveStatus.tooltip(t.errors.reasons[saveError])}>
              <CircleAlert aria-hidden />
            </span>
          </Tooltip>
        )}
        <IconButton
          icon={ListTree}
          label={outlineOpen ? t.outline.hide : t.outline.show}
          shortcut={shortcutLabel("outline.toggle", t)}
          active={outlineOpen}
          aria-pressed={outlineOpen}
          onClick={toggleOutline}
        />
        <IconButton
          icon={Ellipsis}
          label={t.editor.more}
          aria-haspopup="menu"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            setMenuAt({ x: r.right, y: r.bottom + 4 });
          }}
        />
      </div>
      <div ref={body} className={[s.body, outlineOpen && docked && s.docked].filter(Boolean).join(" ")}>
        <div ref={host} className={s.host} hidden={!selectedId} />
        {outlineOpen && selectedId && <OutlinePanel docked={docked} />}
        {!selectedId && (
          <div className={s.empty}>
            <p className={s.emptyTitle}>{t.editor.noSelection}</p>
            <p className={s.emptyHint}>{t.editor.noSelectionHint(shortcutLabel("note.new", t))}</p>
          </div>
        )}
      </div>
      {menuAt && (
        <Menu
          at={menuAt}
          align="end"
          label={t.list.noteActions}
          entries={[
            {
              id: "list",
              label: listCollapsed ? t.editor.showList : t.editor.hideList,
              icon: listCollapsed ? PanelLeftOpen : PanelLeftClose,
              shortcut: shortcutLabel("layout.toggleList", t),
              onSelect: () => toggleColumn("list"),
            },
            {
              id: "typewriter",
              label: t.editor.typewriter,
              checked: typewriterOn,
              toggle: true,
              onSelect: () => updateSettings((st) => ({ ...st, editor: { ...st.editor, typewriter: !st.editor.typewriter } })),
            },
            ...(note ? [{ kind: "separator" as const, id: "sep" }, ...noteMenuEntries(note, t, (id) => void trashNote(id))] : []),
          ]}
          onClose={() => setMenuAt(null)}
        />
      )}
    </section>
  );
}

/**
 * Wide enough for the column and the Contents panel side by side? Then the
 * column moves left to make room (the panel never covers text); otherwise the
 * panel floats over the text.
 */
function useDocking(ref: RefObject<HTMLDivElement | null>): boolean {
  const [docked, setDocked] = useState(true);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const column = cssPx("--editor-max") + 2 * cssPx("--editor-pad-x");
      setDocked((entry?.contentRect.width ?? 0) >= column + cssPx("--outline-reserve"));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return docked;
}
