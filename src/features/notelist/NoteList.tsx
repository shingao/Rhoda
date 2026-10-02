import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { ChevronDown } from "lucide-react";
import { noteIndex } from "../../app/noteIndex";
import { formatTag } from "../../core/tags";
import { Button } from "../../components/Button";
import { useT } from "../../app/i18n";
import { selectNote, trashedNoteIds, trashNote } from "../../app/notes";
import { matchShortcut } from "../../app/shortcuts";
import { listedNotes, updateSettings, useApp } from "../../app/store";
import { useNow } from "../../app/useNow";
import type { SortKey } from "../../core/note/sort";
import { focusEditor } from "../../editor/session";
import { Menu, type MenuEntry } from "../../components/Menu";
import { useAutoHideScrollbar } from "../../components/useAutoHideScrollbar";
import { NoteCard } from "./NoteCard";
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
  const list = useMemo(() => listedNotes(notes, sort, filter, now), [notes, sort, filter, now]);
  const inTrash = filter.kind === "section" && filter.section === "trash";
  const tagNode = filter.kind === "tag" ? noteIndex(notes).tags.byKey.get(filter.key) : undefined;
  const title = filter.kind === "section" ? t.sidebar.sections[filter.section] : tagNode ? formatTag(tagNode.path) : t.list.title;
  const emptyText = filter.kind === "section" ? t.list.emptySection[filter.section] : t.list.emptyTag;
  const scroller = useRef<HTMLDivElement>(null);
  const cards = useRef(new Map<string, HTMLDivElement>());
  const [menu, setMenu] = useState<MenuState | null>(null);
  useAutoHideScrollbar(scroller);

  useEffect(() => {
    if (selectedId) cards.current.get(selectedId)?.scrollIntoView({ block: "nearest" });
  }, [selectedId]);

  const focusId = selectedId && list.some((n) => n.id === selectedId) ? selectedId : list[0]?.id;

  const moveTo = (index: number) => {
    const target = list[Math.max(0, Math.min(list.length - 1, index))];
    if (!target) return;
    selectNote(target.id);
    cards.current.get(target.id)?.focus();
  };

  /** After trashing, keyboard focus moves to the newly selected card. */
  const trashAndRefocus = (id: string) =>
    void trashNote(id).then(() => document.getElementById(cardDomId(useApp.getState().selectedId))?.focus());

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
      ? SORT_KEYS.map((key) => ({
          id: key,
          label: t.list.sort[key],
          checked: key === sort,
          onSelect: () => updateSettings((st) => ({ ...st, sort: key })),
        }))
      : noteMenuEntries(notes[m.id], t, trashAndRefocus);

  return (
    <section className={s.panel} aria-label={title}>
      <header className={s.header}>
        <h2 className={s.title}>{title}</h2>
        {inTrash && list.length > 0 && (
          <Button className={s.emptyTrash} onClick={() => void confirmDeleteNotes(trashedNoteIds())}>
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
        {list.length === 0 ? (
          <p className={s.empty}>{emptyText}</p>
        ) : (
          <div role="listbox" aria-label={title} className={s.cards} onKeyDown={onKeyDown}>
            {list.map((note) => (
              <NoteCard
                key={note.id}
                ref={(el) => {
                  if (el) cards.current.set(note.id, el);
                  else cards.current.delete(note.id);
                }}
                domId={cardDomId(note.id)}
                note={note}
                now={now}
                dateKind={sort === "created" ? "created" : "modified"}
                todoLabel={note.syntax?.todos.total ? t.list.todos(note.syntax.todos.done, note.syntax.todos.total) : null}
                selected={note.id === selectedId}
                focusable={note.id === focusId}
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
