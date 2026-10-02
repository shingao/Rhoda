import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useT } from "../../app/i18n";
import { setPaper } from "../../app/notes";
import { PAPERS, type Note, type Paper } from "../../core/note/note";
import { Toggle } from "../../components/Toggle";
import paper from "./paper.module.css";
import s from "./PaperPicker.module.css";

interface PaperPickerProps {
  note: Note;
  /** Effective values (the note's, else the default setting). */
  current: Paper;
  margin: boolean;
  /** Top-right corner of the popover (under the "…" button). */
  at: { x: number; y: number };
  onClose: () => void;
}

/** "Fond de page" popover [DESIGN §7]: 4 thumbnails + red margin, saved in the note's frontmatter. */
export function PaperPicker({ note, current, margin, at, onClose }: PaperPickerProps) {
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
      <div className={s.thumbs} role="radiogroup" aria-label={t.paper.title}>
        {PAPERS.map((p) => (
          <button
            key={p}
            type="button"
            role="radio"
            aria-checked={p === current}
            className={[s.option, p === current && s.selected].filter(Boolean).join(" ")}
            onClick={() => void setPaper(note.id, p, margin)}
          >
            <span className={[s.thumb, paper.thumb, paper[p], margin && paper.margin].filter(Boolean).join(" ")} />
            <span className={s.label}>{t.paper.names[p]}</span>
          </button>
        ))}
      </div>
      <Toggle checked={margin} onChange={(m) => void setPaper(note.id, current, m)} label={t.paper.margin} />
      <p className={s.hint}>
        {t.paper.saved}{" "}
        <code className={s.code}>
          paper: {current}, margin: {String(margin)}
        </code>
      </p>
    </div>,
    document.body,
  );
}
