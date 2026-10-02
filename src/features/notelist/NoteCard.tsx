import { forwardRef, memo, type MouseEvent } from "react";
import { Pin, SquareCheck } from "lucide-react";
import { useT } from "../../app/i18n";
import { formatRelative } from "../../core/dates";
import type { Note } from "../../core/note/note";
import s from "./NoteCard.module.css";

interface NoteCardProps {
  domId: string;
  note: Note;
  now: number;
  dateKind: "modified" | "created";
  /** Accessible label of the todo counter; null when the note has no todos. */
  todoLabel: string | null;
  selected: boolean;
  focusable: boolean;
  onSelect: () => void;
  onContextMenu: (e: MouseEvent) => void;
}

/** Note card [DESIGN §2.4]: meta line, title, two-line plain-text preview. */
export const NoteCard = memo(
  forwardRef<HTMLDivElement, NoteCardProps>(function NoteCard(
    { domId, note, now, dateKind, todoLabel, selected, focusable, onSelect, onContextMenu },
    ref,
  ) {
    const t = useT();
    const time = dateKind === "created" ? note.created : note.mtime;
    return (
      <div
        ref={ref}
        id={domId}
        role="option"
        aria-selected={selected}
        tabIndex={focusable ? 0 : -1}
        className={[s.card, selected && s.selected].filter(Boolean).join(" ")}
        onClick={onSelect}
        onFocus={onSelect}
        onContextMenu={onContextMenu}
      >
        <div className={s.meta}>
          {note.pinned && <Pin className={s.metaIcon} aria-label={t.list.pinned} />}
          <time dateTime={new Date(time).toISOString()}>{formatRelative(time, now, t.dates)}</time>
          {todoLabel && note.syntax && (
            <span className={s.todos} aria-label={todoLabel}>
              <SquareCheck className={s.metaIcon} aria-hidden />
              {note.syntax.todos.done}/{note.syntax.todos.total}
            </span>
          )}
        </div>
        <div className={[s.title, !note.title && s.untitled].filter(Boolean).join(" ")}>{note.title || t.untitled}</div>
        {note.preview && <div className={s.preview}>{note.preview}</div>}
      </div>
    );
  }),
);
