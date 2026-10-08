import { useEffect, useRef, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import s from "./Modal.module.css";

interface DialogProps {
  onClose: () => void;
  /** id of the element naming the dialog. */
  labelledBy: string;
  className?: string;
  children: ReactNode;
  /** Control focused on open; defaults to the first control after the close button. */
  initialFocus?: RefObject<HTMLElement | null>;
  /** Vertically centred (tall dialogs) instead of placed high. */
  centered?: boolean;
  /** Placement of a dialog that is not a modal card (the command palette). */
  scrimClassName?: string;
}

/** Open dialogs: the app behind them is inert (no focus, no clicks, hidden from assistive tech). */
let openDialogs = 0;
function setAppInert(): void {
  const root = document.getElementById("root");
  if (root) root.inert = openDialogs > 0;
}

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

/** Modal shell [DESIGN §2.17]: scrim, trapped focus, Esc / scrim click close, focus restored. */
export function Dialog({ onClose, labelledBy, className, children, initialFocus, centered, scrimClassName }: DialogProps) {
  const dialog = useRef<HTMLDivElement>(null);

  useEffect(() => {
    openDialogs++;
    setAppInert();
    return () => {
      openDialogs--;
      setAppInert();
    };
  }, []);

  useEffect(() => {
    const previous = document.activeElement;
    const controls = dialog.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
    (initialFocus?.current ?? controls?.[1] ?? controls?.[0])?.focus();
    return () => {
      // Without scrolling: the editor's text stays where it was (an editor scrolled
      // far down would otherwise jump to show its top).
      if (previous instanceof HTMLElement) previous.focus({ preventScroll: true });
    };
  }, [initialFocus]);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== "Tab" || !dialog.current) return;
    const controls = [...dialog.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null);
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      last?.focus();
      e.preventDefault();
    } else if (!e.shiftKey && document.activeElement === last) {
      first?.focus();
      e.preventDefault();
    }
  };

  return createPortal(
    <div className={[s.scrim, centered && s.centered, scrimClassName].filter(Boolean).join(" ")} onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby={labelledBy} className={className} onKeyDown={onKeyDown}>
        {children}
      </div>
    </div>,
    document.body,
  );
}
