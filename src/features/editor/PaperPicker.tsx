import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useT } from "../../app/i18n";
import { setColumn, setPaper } from "../../app/notes";
import { COLUMN_POSITIONS, PAPERS, type ColumnPosition, type Note, type Paper } from "../../core/note/note";
import { Segmented } from "../../components/Segmented";
import { Toggle } from "../../components/Toggle";
import paper from "./paper.module.css";
import s from "./PaperPicker.module.css";

interface PaperPickerProps {
  note: Note;
  /** Effective values (the note's, else the default setting). */
  current: Paper;
  margin: boolean;
  column: ColumnPosition;
  /** Top-right corner of the popover (under the "…" button). */
  at: { x: number; y: number };
  onClose: () => void;
}

/** "Fond de page" popover [DESIGN §7]: 4 thumbnails, red margin and text column, saved in the note's frontmatter. */
export function PaperPicker({ note, current, margin, column, at, onClose }: PaperPickerProps) {
  const t = useT();
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    root.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
    const onPointer = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) onClose();
    };
    document.addEventListener("pointerdown", onPointer, true);
    return () => document.removeEventListener("pointerdown", onPointer, true);
  }, [onClose]);

  return createPortal(
    <div
      ref={root}
      className={s.popover}
      style={{ top: at.y, right: window.innerWidth - at.x }}
      role="dialog"
      aria-label={t.paper.title}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <div className={s.title}>{t.paper.title}</div>
      <PaperChoices value={current} margin={margin} label={t.paper.title} onChange={(p) => void setPaper(note.id, p, margin)} />
      <Toggle checked={margin} onChange={(m) => void setPaper(note.id, current, m)} label={t.paper.margin} />
      <ColumnChoice value={column} onChange={(c) => void setColumn(note.id, c)} />
      <p className={s.hint}>
        {t.paper.saved}{" "}
        <code className={s.code}>
          paper: {current}, margin: {String(margin)}, column: {column}
        </code>
      </p>
    </div>,
    document.body,
  );
}

/** Centred or left text column (the note's, or the default in the settings). */
export function ColumnChoice({ value, onChange }: { value: ColumnPosition; onChange: (column: ColumnPosition) => void }) {
  const t = useT();
  return (
    <div className={s.column}>
      <span className={s.columnLabel}>{t.paper.column}</span>
      <Segmented label={t.paper.column} value={value} options={COLUMN_POSITIONS.map((c) => ({ value: c, label: t.paper.columns[c] }))} onChange={onChange} />
    </div>
  );
}

/** The 4 thumbnails, also used for the default background in the settings. */
export function PaperChoices({ value, margin, label, onChange }: { value: Paper; margin: boolean; label: string; onChange: (paper: Paper) => void }) {
  const t = useT();
  return (
    <div className={s.thumbs} role="radiogroup" aria-label={label}>
      {PAPERS.map((p) => (
        <button
          key={p}
          type="button"
          role="radio"
          aria-checked={p === value}
          className={[s.option, p === value && s.selected].filter(Boolean).join(" ")}
          onClick={() => onChange(p)}
        >
          <span className={[s.thumb, paper.thumb, paper[p], margin && paper.margin].filter(Boolean).join(" ")} />
          <span className={s.label}>{t.paper.names[p]}</span>
        </button>
      ))}
    </div>
  );
}
