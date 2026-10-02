import { forwardRef, memo, type MouseEvent } from "react";
import { Pin } from "lucide-react";
import { formatRelative } from "../../core/dates";
import type { Note } from "../../core/note/note";
import s from "./NoteCard.module.css";

interface NoteCardProps {
  note: Note;
  now: number;
  dateKind: "modified" | "created";
  selected: boolean;
  focusable: boolean;
  onSelect: () => void;
  onContextMenu: (e: MouseEvent) => void;
}

/** Note card [DESIGN §2.4]: meta line, title, two-line plain-text preview. */
export const NoteCard = memo(
  forwardRef<HTMLDivElement, NoteCardProps>(function NoteCard(
    { note, now, dateKind, selected, focusable, onSelect, onContextMenu },
    ref,
  ) {
    const time = dateKind === "created" ? note.created : note.mtime;
    return (
      <div
        ref={ref}
        role="option"
        aria-selected={selected}
        tabIndex={focusable ? 0 : -1}
        className={[s.card, selected && s.selected].filter(Boolean).join(" ")}
        onClick={onSelect}
        onFocus={onSelect}
        onContextMenu={onContextMenu}
      >
        <div className={s.meta}>
          {note.pinned && <Pin className={s.metaIcon} aria-label="Pinned" />}
          <time dateTime={new Date(time).toISOString()}>{formatRelative(time, now)}</time>
        </div>
        <div className={[s.title, !note.title && s.untitled].filter(Boolean).join(" ")}>{note.title || "Untitled"}</div>
        {note.preview && <div className={s.preview}>{note.preview}</div>}
      </div>
    );
  }),
);
