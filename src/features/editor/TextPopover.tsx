import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useT } from "../../app/i18n";
import { useApp } from "../../app/store";
import { Segmented } from "../../components/Segmented";
import { Select } from "../../components/Select";
import { NOTE_FONTS, TEXT_SIZE } from "../../core/note/note";
import type { FormatState } from "../../editor/format";
import { formatSelection } from "../../editor/session";
import s from "./TextPopover.module.css";

const DEFAULT = "default";
const SIZES = ["sm", "normal", "lg"] as const;

interface TextPopoverProps {
  state: FormatState;
  /** Top-left corner (under the "Aa" button). */
  at: { x: number; y: number };
  onClose: () => void;
}

/**
 * "Aa" of the formatting toolbar (decision P12-9): font and size of the whole
 * note (frontmatter `font:` / `size:`, "Default" removes them) and the size of
 * the selection (small / normal / large). Changes apply at once and stay
 * undoable with Ctrl+Z; the popover keeps the focus until it is closed.
 */
export function TextPopover({ state, at, onClose }: TextPopoverProps) {
  const t = useT();
  const root = useRef<HTMLDivElement>(null);
  const defaults = useApp((st) => st.settings.editor);

  useEffect(() => {
    const previous = document.activeElement;
    const node = root.current;
    node?.querySelector<HTMLElement>("select")?.focus();
    const onPointer = (e: PointerEvent) => {
      if (!node?.contains(e.target as Node)) onClose();
    };
    document.addEventListener("pointerdown", onPointer, true);
    return () => {
      document.removeEventListener("pointerdown", onPointer, true);
      if (previous instanceof HTMLElement && (document.activeElement === document.body || node?.contains(document.activeElement))) previous.focus({ preventScroll: true });
    };
  }, [onClose]);

  const sizes = new Set<number>();
  for (let n = TEXT_SIZE.min; n <= TEXT_SIZE.max; n++) sizes.add(n);
  if (state.look.size !== null) sizes.add(state.look.size);
  const sizeOptions = [
    { value: DEFAULT, label: t.format.byDefault(t.settings.px(defaults.fontSize)) },
    ...[...sizes].sort((a, b) => a - b).map((n) => ({ value: String(n), label: t.settings.px(n) })),
  ];
  const fontOptions = [{ value: DEFAULT, label: t.format.byDefault(t.format.fonts[defaults.font]) }, ...NOTE_FONTS.map((f) => ({ value: f, label: t.format.fonts[f] }))];

  return createPortal(
    <div
      ref={root}
      className={s.popover}
      style={{ top: at.y, left: Math.min(at.x, window.innerWidth - 8) }}
      role="dialog"
      aria-label={t.format.text}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <div className={s.title}>{t.format.noteTitle}</div>
      <label className={s.row}>
        <span className={s.label}>{t.format.noteFont}</span>
        <Select
          label={t.format.noteFont}
          value={state.look.font ?? DEFAULT}
          options={fontOptions}
          onChange={(v) => void formatSelection({ kind: "look", look: { font: v === DEFAULT ? null : (v as (typeof NOTE_FONTS)[number]) } }, false)}
        />
      </label>
      <label className={s.row}>
        <span className={s.label}>{t.format.noteSize}</span>
        <Select
          label={t.format.noteSize}
          value={state.look.size === null ? DEFAULT : String(state.look.size)}
          options={sizeOptions}
          onChange={(v) => void formatSelection({ kind: "look", look: { size: v === DEFAULT ? null : Number(v) } }, false)}
        />
      </label>
      <div className={s.title}>{t.format.selectionTitle}</div>
      <div className={s.row} aria-disabled={state.inCode || undefined}>
        <span className={s.label}>{t.format.textSize}</span>
        <Segmented
          label={t.format.textSize}
          value={state.size}
          options={SIZES.map((size) => ({ value: size, label: t.format.sizes[size] }))}
          onChange={(size) => {
            if (!state.inCode) void formatSelection({ kind: "size", size }, false);
          }}
        />
      </div>
      <p className={s.hint}>{t.format.lookSaved}</p>
    </div>,
    document.body,
  );
}
