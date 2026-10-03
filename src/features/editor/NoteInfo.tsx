import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useT } from "../../app/i18n";
import type { Note } from "../../core/note/note";
import s from "./NoteInfo.module.css";
import { useNoteStats } from "./useNoteStats";

/** "Infos" popover: words, characters, reading time (230 words/min), dates. */
export function NoteInfo({ note, at, onClose }: { note: Note; at: { x: number; y: number }; onClose: () => void }) {
  const t = useT();
  const root = useRef<HTMLDivElement>(null);
  const stats = useNoteStats(note)!;
  const number = new Intl.NumberFormat(t.dates.locale);
  const date = new Intl.DateTimeFormat(t.dates.locale, { dateStyle: "long", timeStyle: "short" });

  useEffect(() => {
    root.current?.focus();
    const onPointer = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) onClose();
    };
    document.addEventListener("pointerdown", onPointer, true);
    return () => document.removeEventListener("pointerdown", onPointer, true);
  }, [onClose]);

  const rows: Array<[string, string]> = [
    [t.info.words, number.format(stats.words)],
    [t.info.characters, number.format(stats.characters)],
    [t.info.charactersNoSpaces, number.format(stats.charactersNoSpaces)],
    [t.info.reading, t.info.minutes(stats.readingMinutes)],
    [t.info.created, date.format(note.created)],
    [t.info.modified, date.format(note.mtime)],
  ];

  return createPortal(
    <div
      ref={root}
      className={s.popover}
      style={{ top: at.y, right: window.innerWidth - at.x }}
      role="dialog"
      aria-label={t.info.title}
      tabIndex={-1}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          e.preventDefault();
          onClose();
        }
      }}
    >
      <div className={s.title}>{t.info.title}</div>
      <dl className={s.rows}>
        {rows.map(([label, value]) => (
          <div key={label} className={s.row}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </div>,
    document.body,
  );
}
