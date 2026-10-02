import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { ArrowDownWideNarrow, Trash2 } from "lucide-react";
import { listedNotes, updateSettings, useApp } from "../../app/store";
import { selectNote, trashNote } from "../../app/notes";
import { useNow } from "../../app/useNow";
import type { SortKey } from "../../core/note/sort";
import { focusEditor } from "../../editor/session";
import { IconButton } from "../../components/IconButton";
import { Menu, type MenuEntry } from "../../components/Menu";
import { useAutoHideScrollbar } from "../../components/useAutoHideScrollbar";
import { NoteCard } from "./NoteCard";
import s from "./NoteList.module.css";

const SORT_LABELS: Record<SortKey, string> = {
  modified: "Date modified",
  created: "Date created",
  title: "Title",
};

type MenuState = { kind: "sort"; at: { x: number; y: number } } | { kind: "note"; uid: string; at: { x: number; y: number } };

/** Middle column: the notes of the current section [DESIGN §2.4]. */
export function NoteList() {
  const notes = useApp((st) => st.notes);
  const sort = useApp((st) => st.settings.sort);
  const selectedUid = useApp((st) => st.selectedUid);
  const list = useMemo(() => listedNotes(notes, sort), [notes, sort]);
  const now = useNow();
  const scroller = useRef<HTMLDivElement>(null);
  const cards = useRef(new Map<string, HTMLDivElement>());
  const [menu, setMenu] = useState<MenuState | null>(null);
  useAutoHideScrollbar(scroller);

  useEffect(() => {
    if (selectedUid) cards.current.get(selectedUid)?.scrollIntoView({ block: "nearest" });
  }, [selectedUid]);

  const focusUid = selectedUid && list.some((n) => n.uid === selectedUid) ? selectedUid : list[0]?.uid;

  const moveTo = (index: number) => {
    const target = list[Math.max(0, Math.min(list.length - 1, index))];
    if (!target) return;
    selectNote(target.uid);
    cards.current.get(target.uid)?.focus();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const index = list.findIndex((n) => n.uid === focusUid);
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
        if (focusUid) {
          selectNote(focusUid);
          focusEditor();
        }
        break;
      case "Delete":
        if (focusUid) void trashNote(focusUid).then(() => cards.current.get(useApp.getState().selectedUid ?? "")?.focus());
        break;
      default:
        return;
    }
    e.preventDefault();
  };

  const menuEntries = (m: MenuState): MenuEntry[] =>
    m.kind === "sort"
      ? (Object.keys(SORT_LABELS) as SortKey[]).map((key) => ({
          id: key,
          label: SORT_LABELS[key],
          checked: key === sort,
          onSelect: () => updateSettings((st) => ({ ...st, sort: key })),
        }))
      : [{ id: "trash", label: "Move to Trash", icon: Trash2, shortcut: "Del", danger: true, onSelect: () => void trashNote(m.uid) }];

  return (
    <section className={s.panel} aria-label="Notes">
      <header className={s.header}>
        <h2 className={s.title}>Notes</h2>
        <IconButton
          icon={ArrowDownWideNarrow}
          label={`Sort: ${SORT_LABELS[sort]}`}
          aria-haspopup="menu"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            setMenu({ kind: "sort", at: { x: r.left, y: r.bottom + 4 } });
          }}
        />
      </header>
      <div ref={scroller} className={s.scroller}>
        {list.length === 0 ? (
          <p className={s.empty}>No notes yet</p>
        ) : (
          <div role="listbox" aria-label="Notes" className={s.cards} onKeyDown={onKeyDown}>
            {list.map((note) => (
              <NoteCard
                key={note.uid}
                ref={(el) => {
                  if (el) cards.current.set(note.uid, el);
                  else cards.current.delete(note.uid);
                }}
                note={note}
                now={now}
                dateKind={sort === "created" ? "created" : "modified"}
                selected={note.uid === selectedUid}
                focusable={note.uid === focusUid}
                onSelect={() => selectNote(note.uid)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  selectNote(note.uid);
                  setMenu({ kind: "note", uid: note.uid, at: { x: e.clientX, y: e.clientY } });
                }}
              />
            ))}
          </div>
        )}
      </div>
      {menu && <Menu at={menu.at} label={menu.kind === "sort" ? "Sort notes" : "Note actions"} entries={menuEntries(menu)} onClose={() => setMenu(null)} />}
    </section>
  );
}
