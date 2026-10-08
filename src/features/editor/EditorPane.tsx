import { useEffect, useRef, useState, type RefObject } from "react";
import { ChevronsDownUp, ChevronsUpDown, CircleAlert, Ellipsis, Expand, Focus, ImagePlus, Info, ListTree, Notebook, NotebookPen, PanelLeftClose, PanelLeftOpen, Eye, EyeOff, Settings, Share, Sticker } from "lucide-react";
import { openExport } from "../../app/export";
import { useT } from "../../app/i18n";
import { cssPx } from "../../app/cssTokens";
import { insertFromDialog } from "../../app/attachments";
import { toggleColumn, toggleFocusMode, toggleOutline, toggleTypewriter } from "../../app/layout";
import { editNote, trashNote } from "../../app/notes";
import { shortcutLabel } from "../../app/shortcuts";
import { EmptyState } from "../../components/EmptyState";
import { setState, useApp } from "../../app/store";
import { useNow } from "../../app/useNow";
import { relativeDate } from "../../core/dates";
import { attachAutoHideScrollbar } from "../../components/useAutoHideScrollbar";
import { IconButton } from "../../components/IconButton";
import { Menu } from "../../components/Menu";
import { Tooltip } from "../../components/Tooltip";
import { editorExtensions } from "../../editor/setup";
import { isSectionIsolated, mountEditor, NO_EXTRAS, runSectionCommand, setEditorOption, showNote, unmountEditor } from "../../editor/session";
import { focusDim, focusDimCompartment } from "../../editor/focusDim";
import { typewriter, typewriterCompartment } from "../../editor/typewriter";
import { noteMenuEntries } from "../notelist/noteActions";
import { Breadcrumb } from "./Breadcrumb";
import { FindPanel } from "./FindPanel";
import { NoteInfo } from "./NoteInfo";
import { useNoteStats } from "./useNoteStats";
import { PaperPicker } from "./PaperPicker";
import { alignEntries } from "./alignEntries";
import paperStyles from "./paper.module.css";
import { FindPill } from "./FindPill";
import { OutlinePanel } from "../outline/OutlinePanel";
import { StickerDrawer } from "../stickers/StickerDrawer";
import { toggleStickerDrawer } from "../../app/stickers";
import { toggleStickersHidden } from "../../app/noteView";
import { stickerDisplay, stickersShown } from "../../editor/stickers/state";
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
  const drawerOpen = useApp((st) => st.stickerDrawer);
  const findOpen = useApp((st) => st.find.open);
  const body = useRef<HTMLDivElement>(null);
  const docked = useDocking(body);
  const t = useT();
  const now = useNow();
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);
  const [paperAt, setPaperAt] = useState<{ x: number; y: number } | null>(null);
  const [infoAt, setInfoAt] = useState<{ x: number; y: number } | null>(null);
  const focusMode = useApp((st) => st.focusMode);
  const stats = useNoteStats(focusMode ? note : undefined);
  const defaults = useApp((st) => st.settings.editor);
  const paper = note?.paper ?? defaults.paper;
  const margin = note?.margin ?? defaults.margin;
  const column = note?.column ?? defaults.columnPosition;

  useEffect(() => {
    if (!host.current) return;
    const view = mountEditor(host.current, editorExtensions(), editNote);
    const detach = attachAutoHideScrollbar(view.scrollDOM);
    const { selectedId: id, notes } = useApp.getState();
    const note = id ? notes[id] : undefined;
    showNote(id, note?.body ?? "", note ?? NO_EXTRAS);
    return () => {
      detach();
      unmountEditor();
    };
  }, []);

  useEffect(() => setEditorOption(typewriterCompartment, typewriter(typewriterOn)), [typewriterOn]);
  const dimOn = focusMode && defaults.focusDim;
  useEffect(() => setEditorOption(focusDimCompartment, focusDim(dimOn)), [dimOn]);
  const decorations = useApp((st) => st.settings.stickers);
  const decorationsOn = decorations.show && !(focusMode && decorations.hideInFocus);
  useEffect(() => setEditorOption(stickerDisplay, stickersShown.of(decorationsOn)), [decorationsOn]);
  const stickersHidden = useApp((st) => (st.selectedId ? st.hiddenStickers[st.selectedId] === true : false));

  const edited = mtime !== undefined ? relativeDate(mtime, now, t.dates) : null;

  return (
    <section className={[s.pane, focusMode && s.focus].filter(Boolean).join(" ")} aria-label={t.editor.label} data-zone="editor">
      <div className={s.bar} inert={focusMode}>
        <Breadcrumb />
        <div className={s.spacer} />
        <FindPill />
        {edited && note && (
          <button
            type="button"
            className={s.edited}
            aria-haspopup="dialog"
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              setInfoAt({ x: r.right, y: r.bottom + 4 });
            }}
          >
            {t.editor.editedAt(edited.kind, edited.text)}
          </button>
        )}
        {saveError && (
          <Tooltip label={t.saveStatus.tooltip(t.errors.reasons[saveError])}>
            <span className={s.unsaved} role="status" tabIndex={0} aria-label={t.saveStatus.tooltip(t.errors.reasons[saveError])}>
              <CircleAlert aria-hidden />
            </span>
          </Tooltip>
        )}
        {(stickersHidden || (note?.stickers.length ?? 0) > 0) && (
          <IconButton
            icon={stickersHidden ? EyeOff : Eye}
            label={stickersHidden ? t.stickers.show : t.stickers.hide}
            shortcut={shortcutLabel("stickers.hide", t)}
            active={stickersHidden}
            aria-pressed={stickersHidden}
            onClick={toggleStickersHidden}
          />
        )}
        <IconButton
          icon={Sticker}
          label={t.stickers.open}
          shortcut={shortcutLabel("stickers.drawer", t)}
          active={drawerOpen}
          activeTone="accent"
          aria-pressed={drawerOpen}
          disabled={!selectedId}
          onClick={() => toggleStickerDrawer()}
        />
        <IconButton
          icon={ListTree}
          label={outlineOpen ? t.outline.hide : t.outline.show}
          shortcut={shortcutLabel("outline.toggle", t)}
          active={outlineOpen}
          aria-pressed={outlineOpen}
          onClick={toggleOutline}
        />
        <IconButton
          icon={Share}
          label={t.exportDialog.menuNote.replace(/…$/, "")}
          shortcut={shortcutLabel("export.open", t)}
          disabled={!selectedId}
          onClick={() => openExport()}
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
      <div
        ref={body}
        className={[s.body, outlineOpen && docked && s.docked, paperStyles.surface, paperStyles[paper], margin && paperStyles.margin, column === "left" && paperStyles.columnLeft]
          .filter(Boolean)
          .join(" ")}
      >
        <div ref={host} className={s.host} hidden={!selectedId} />
        {outlineOpen && selectedId && !(findOpen && !docked) && <OutlinePanel docked={docked} />}
        {findOpen && selectedId && <FindPanel />}
        {selectedId && <StickerDrawer />}
        {!selectedId && (
          <EmptyState centered icon={NotebookPen} title={t.editor.noSelection} hint={t.editor.noSelectionHint(shortcutLabel("note.new", t))} />
        )}
      </div>
      {focusMode && stats && (
        <footer className={s.focusFooter} aria-live="off">
          <span>{t.info.wordCount(stats.words)}</span>
          <span>{t.info.readingTime(stats.readingMinutes)}</span>
        </footer>
      )}
      {infoAt && note && <NoteInfo note={note} at={infoAt} onClose={() => setInfoAt(null)} />}
      {paperAt && note && <PaperPicker note={note} current={paper} margin={margin} column={column} at={paperAt} onClose={() => setPaperAt(null)} />}
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
            ...(selectedId
              ? [
                  { kind: "separator" as const, id: "sep-sections" },
                  {
                    id: "foldAll",
                    label: t.folding.foldAll,
                    icon: ChevronsDownUp,
                    shortcut: shortcutLabel("fold.all", t),
                    onSelect: () => runSectionCommand("foldAll"),
                  },
                  {
                    id: "unfoldAll",
                    label: t.folding.unfoldAll,
                    icon: ChevronsUpDown,
                    shortcut: shortcutLabel("unfold.all", t),
                    onSelect: () => runSectionCommand("unfoldAll"),
                  },
                  {
                    id: "isolate",
                    label: isSectionIsolated() ? t.focus.showAll : t.focus.isolate,
                    icon: Focus,
                    shortcut: shortcutLabel("section.isolate", t),
                    onSelect: () => runSectionCommand("toggleIsolation"),
                  },
                  ...(() => {
                    const align = alignEntries(t);
                    return align.length ? [{ kind: "separator" as const, id: "sep-align" }, ...align, { kind: "separator" as const, id: "sep-align-end" }] : [];
                  })(),
                  {
                    id: "attach",
                    label: t.images.insert,
                    icon: ImagePlus,
                    onSelect: () => void insertFromDialog(),
                  },
                  {
                    id: "paper",
                    label: t.paper.menu,
                    icon: Notebook,
                    onSelect: () => setPaperAt(menuAt),
                  },
                  {
                    id: "info",
                    label: t.info.menu,
                    icon: Info,
                    onSelect: () => setInfoAt(menuAt),
                  },
                  { kind: "separator" as const, id: "sep-view" },
                ]
              : []),
            {
              id: "typewriter",
              label: t.editor.typewriter,
              checked: typewriterOn,
              toggle: true,
              onSelect: toggleTypewriter,
            },
            {
              id: "focusMode",
              label: t.info.focusMode,
              icon: Expand,
              shortcut: shortcutLabel("focus.toggle", t),
              onSelect: toggleFocusMode,
            },
            {
              id: "settings",
              label: t.settings.menu,
              icon: Settings,
              shortcut: shortcutLabel("settings.open", t),
              onSelect: () => setState({ settingsPage: "general" }),
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
