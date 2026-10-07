import { useDeferredValue, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { ChevronDown, Hash, Plus, SearchX, Share } from "lucide-react";
import { openExport } from "../../app/export";
import { cssPx } from "../../app/cssTokens";
import { createFromSearch } from "../../app/search";
import { noteIndex } from "../../app/noteIndex";
import { formatTag } from "../../core/tags";
import { Button } from "../../components/Button";
import { EmptyState } from "../../components/EmptyState";
import { useT } from "../../app/i18n";
import { createNote, selectNote, trashedNoteIds, trashNote } from "../../app/notes";
import { matchShortcut, shortcutLabel } from "../../app/shortcuts";
import { activeQuery, listedNotes, searchText, updateSettings, useApp } from "../../app/store";
import { useNow } from "../../app/useNow";
import type { SortKey } from "../../core/note/sort";
import { focusEditor } from "../../editor/session";
import { Menu, type MenuEntry } from "../../components/Menu";
import { useAutoHideScrollbar } from "../../components/useAutoHideScrollbar";
import { SECTION_ICONS } from "../sidebar/sectionIcons";
import { NoteCard } from "./NoteCard";
import { useWindow } from "./useWindow";
import { confirmDeleteNotes, noteMenuEntries } from "./noteActions";
import s from "./NoteList.module.css";

const SORT_KEYS: SortKey[] = ["modified", "created", "title"];
const cardDomId = (noteId: string | null) => `note-card-${noteId ?? ""}`;

type Point = { x: number; y: number };
type MenuState = { kind: "sort"; at: Point } | { kind: "note"; id: string; at: Point };

/** Middle column: the notes of the current section [DESIGN §2.4]. */
export function NoteList() {
  const notes = useApp((st) => st.notes);
  const sort = useApp((st) => st.settings.sort);
  const selectedId = useApp((st) => st.selectedId);
  const filter = useApp((st) => st.filter);
  const t = useT();
  const now = useNow();
  // Deferred: typing in the search field stays fluid while the list catches up.
  const search = useDeferredValue(useApp((st) => st.search));
  const query = activeQuery(search);
  // OCR results arriving can add search results.
  const textVersion = useApp((st) => st.ocr.version);
  const list = useMemo(
    () => listedNotes(notes, sort, filter, now, query),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [notes, sort, filter, now, query, query ? textVersion : 0],
  );
  const inTrash = filter.kind === "section" && filter.section === "trash";
  const tagNode = filter.kind === "tag" ? noteIndex(notes).tags.byKey.get(filter.key) : undefined;
  const viewTitle = filter.kind === "section" ? t.sidebar.sections[filter.section] : tagNode ? formatTag(tagNode.path) : t.list.title;
  const title = query ? t.search.resultsTitle : viewTitle;
  const scroller = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  useAutoHideScrollbar(scroller);
  // Only the cards near the visible part are in the DOM (decision P10-18).
  const ids = useMemo(() => list.map((n) => n.id), [list]);
  const view = useWindow(scroller, ids, cssPx("--card-spacing"), cssPx("--card-estimate"));

  // A new search or view starts at the top.
  const viewKey = `${JSON.stringify(filter)}\u0000${searchText(search)}`;
  useEffect(() => {
    if (scroller.current) scroller.current.scrollTop = 0;
  }, [viewKey]);

  useEffect(() => {
    if (!selectedId) return;
    const card = view.element(selectedId);
    if (card) card.scrollIntoView({ block: "nearest" });
    else view.reveal(ids.indexOf(selectedId));
    // Only when the selection changes, not on every scroll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  const focusId = selectedId && list.some((n) => n.id === selectedId) ? selectedId : list[0]?.id;
  const focusIndex = focusId ? ids.indexOf(focusId) : -1;
  const focusDrawn = focusIndex >= view.start && focusIndex < view.end;

  const moveTo = (index: number) => {
    const target = list[Math.max(0, Math.min(list.length - 1, index))];
    if (!target) return;
    selectNote(target.id);
    view.focus(target.id);
  };

  /** After trashing, keyboard focus moves to the newly selected card. */
  const trashAndRefocus = (id: string) =>
    void trashNote(id).then(() => {
      const next = useApp.getState().selectedId;
      if (next) view.focus(next);
    });

  const onKeyDown = (e: KeyboardEvent) => {
    if (matchShortcut(e.nativeEvent, "list") === "note.trash") {
      if (focusId) {
        if (inTrash) void confirmDeleteNotes([focusId]);
        else trashAndRefocus(focusId);
      }
      e.preventDefault();
      return;
    }
    // Listbox navigation keys (fixed by ARIA conventions, not customizable).
    const index = list.findIndex((n) => n.id === focusId);
    switch (e.key) {
      case "ArrowDown":
        moveTo(index + 1);
        break;
      case "ArrowUp":
        moveTo(index - 1);
        break;
      case "Home":
        moveTo(0);
        break;
      case "End":
        moveTo(list.length - 1);
        break;
      case "Enter":
        if (focusId) {
          selectNote(focusId);
          focusEditor();
        }
        break;
      default:
        return;
    }
    e.preventDefault();
  };

  const menuEntries = (m: MenuState): MenuEntry[] =>
    m.kind === "sort"
      ? [
          ...SORT_KEYS.map((key) => ({
            id: key,
            label: t.list.sort[key],
            checked: key === sort,
            onSelect: () => updateSettings((st) => ({ ...st, sort: key })),
          })),
          ...(list.length > 0 && !inTrash
            ? [
                { kind: "separator" as const, id: "sep-export" },
                { id: "export", label: t.exportDialog.menuList(list.length), icon: Share, onSelect: () => openExport(list.map((n) => n.id), `${title} · ${t.exportDialog.notes(list.length)}`) },
              ]
            : []),
        ]
      : noteMenuEntries(notes[m.id], t, trashAndRefocus);

  return (
    <section className={s.panel} aria-label={title} data-zone="list">
      <header className={s.header}>
        <h2 className={s.title}>{title}</h2>
        {query && <span className={s.resultCount}>{t.search.notesCount(list.length)}</span>}
        {inTrash && list.length > 0 && (
          <Button className={s.emptyTrash} onClick={() => void confirmDeleteNotes(trashedNoteIds(), "empty-trash")}>
            {t.list.emptyTrash}
          </Button>
        )}
        <button
          type="button"
          className={s.sort}
          aria-haspopup="menu"
          aria-label={t.list.sortBy(t.list.sort[sort])}
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            setMenu({ kind: "sort", at: { x: r.right, y: r.bottom + 4 } });
          }}
        >
          {t.list.sortShort[sort]}
          <ChevronDown className={s.sortIcon} aria-hidden />
        </button>
      </header>
      <div ref={scroller} className={s.scroller}>
        {list.length === 0 && query ? (
          <EmptyState
            icon={SearchX}
            title={t.search.noResults(query.text)}
            hint={t.search.noResultsHint}
            action={
              query.text && (
                <Button icon={Plus} onClick={() => void createFromSearch(query.text)}>
                  {t.search.createNote(query.text)}
                </Button>
              )
            }
          />
        ) : list.length === 0 && filter.kind === "tag" ? (
          <EmptyState icon={Hash} title={t.list.emptyTag} hint={t.list.emptyTagHint(viewTitle)} />
        ) : list.length === 0 && filter.kind === "section" && filter.section === "notes" ? (
          <EmptyState
            icon={SECTION_ICONS.notes}
            title={t.list.emptySection.notes}
            hint={t.list.emptyHint.notes(shortcutLabel("note.new", t))}
            action={
              <Button variant="primary" icon={Plus} onClick={() => void createNote()}>
                {t.titlebar.newNote}
              </Button>
            }
          />
        ) : list.length === 0 && filter.kind === "section" ? (
          <EmptyState icon={SECTION_ICONS[filter.section]} title={t.list.emptySection[filter.section]} hint={filter.section === "notes" ? undefined : t.list.emptyHint[filter.section]} />
        ) : (
          <div
            ref={(el) => view.attachList(el)}
            role="listbox"
            aria-label={title}
            className={s.cards}
            style={{ paddingTop: view.before, paddingBottom: view.after }}
            // The current card is outside the window: the list itself takes the Tab stop and hands it over.
            tabIndex={focusDrawn ? -1 : 0}
            onFocus={(e) => {
              if (e.target === e.currentTarget && !view.parked() && focusId) view.focus(focusId);
            }}
            onKeyDown={onKeyDown}
          >
            {list.slice(view.start, view.end).map((note, i) => (
              <NoteCard
                key={note.id}
                ref={view.refFor(note.id)}
                position={view.start + i + 1}
                count={list.length}
                domId={cardDomId(note.id)}
                note={note}
                now={now}
                dateKind={sort === "created" ? "created" : "modified"}
                todoLabel={note.syntax?.todos.total ? t.list.todos(note.syntax.todos.done, note.syntax.todos.total) : null}
                selected={note.id === selectedId}
                focusable={note.id === focusId}
                query={query}
                textVersion={textVersion}
                onSelect={() => selectNote(note.id)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  selectNote(note.id);
                  setMenu({ kind: "note", id: note.id, at: { x: e.clientX, y: e.clientY } });
                }}
              />
            ))}
          </div>
        )}
      </div>
      {menu && (
        <Menu
          at={menu.at}
          align={menu.kind === "sort" ? "end" : "start"}
          label={menu.kind === "sort" ? t.list.sortMenu : t.list.noteActions}
          entries={menuEntries(menu)}
          onClose={() => setMenu(null)}
        />
      )}
    </section>
  );
}
