import { useRef, useState } from "react";
import s from "./Resizer.module.css";

interface ResizerProps {
  label: string;
  /** Current width of the column on the left of the handle. */
  width: number;
  /** Called with the width the pointer asks for (start width + horizontal travel). */
  onResize: (width: number) => void;
  onResizeStart: () => void;
  onResizeEnd: () => void;
  /** Double-click restores the default width. */
  onReset: () => void;
}

/** Invisible 6 px handle on a column junction; 2 px accent line while dragging [DESIGN §Layout]. */
export function Resizer({ label, width, onResize, onResizeStart, onResizeEnd, onReset }: ResizerProps) {
  const start = useRef({ x: 0, width: 0 });
  const [dragging, setDragging] = useState(false);

  return (
    <div className={s.resizer}>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={label}
        className={[s.handle, dragging && s.dragging].filter(Boolean).join(" ")}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          start.current = { x: e.clientX, width };
          setDragging(true);
          onResizeStart();
        }}
        onPointerMove={(e) => dragging && onResize(start.current.width + e.clientX - start.current.x)}
        onPointerUp={() => {
          if (!dragging) return;
          setDragging(false);
          onResizeEnd();
        }}
        onLostPointerCapture={() => {
          if (!dragging) return;
          setDragging(false);
          onResizeEnd();
        }}
        onDoubleClick={onReset}
      />
    </div>
  );
}
