import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cssMs } from "../app/cssTokens";
import s from "./Tooltip.module.css";

interface TooltipProps {
  label: string;
  shortcut?: string | undefined;
  children: ReactNode;
}

/** Last time any tooltip was visible: a recent one makes the next appear at once [DESIGN §2.22]. */
let lastShownAt = 0;

export function Tooltip({ label, shortcut, children }: TooltipProps) {
  const anchor = useRef<HTMLSpanElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  const hide = useCallback(() => {
    window.clearTimeout(timer.current);
    setPos((p) => {
      if (p) lastShownAt = performance.now();
      return null;
    });
  }, []);

  const show = useCallback(() => {
    window.clearTimeout(timer.current);
    const warm = performance.now() - lastShownAt < cssMs("--tooltip-warmup");
    timer.current = window.setTimeout(
      () => {
        const r = anchor.current?.getBoundingClientRect();
        if (r) setPos({ x: r.left + r.width / 2, y: r.bottom });
      },
      warm ? 0 : cssMs("--tooltip-delay"),
    );
  }, []);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  return (
    <span
      ref={anchor}
      className={s.anchor}
      onPointerEnter={show}
      onPointerLeave={hide}
      onPointerDown={hide}
      onFocus={(e) => e.target.matches(":focus-visible") && show()}
      onBlur={hide}
    >
      {children}
      {pos &&
        createPortal(
          <Bubble x={pos.x} y={pos.y} label={label} shortcut={shortcut} />,
          document.body,
        )}
    </span>
  );
}

const EDGE = 8;

function Bubble({ x, y, label, shortcut }: { x: number; y: number; label: string; shortcut?: string | undefined }) {
  const ref = useRef<HTMLDivElement>(null);
  const [left, setLeft] = useState(x);
  // Keep the bubble inside the window (e.g. near the window controls).
  useLayoutEffect(() => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const half = r.width / 2;
    setLeft(Math.min(Math.max(x, half + EDGE), window.innerWidth - half - EDGE));
  }, [x]);
  return (
    <div ref={ref} role="tooltip" className={s.tooltip} style={{ left, top: y }}>
      {label}
      {shortcut && <span className={s.shortcut}>{shortcut}</span>}
    </div>
  );
}
