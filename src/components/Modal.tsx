import { useEffect, useRef, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import s from "./Modal.module.css";

interface ModalProps {
  title: string;
  subtitle?: ReactNode;
  closeLabel: string;
  onClose: () => void;
  children?: ReactNode;
  footer: ReactNode;
  /** Control focused on open; defaults to the first control after the close button. */
  initialFocus?: RefObject<HTMLElement | null>;
}

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

/** Modal dialog [DESIGN §2.17]: scrim, trapped focus, Esc / scrim click close, focus restored. */
export function Modal({ title, subtitle, closeLabel, onClose, children, footer, initialFocus }: ModalProps) {
  const dialog = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previous = document.activeElement;
    // Initial focus: the first control after the header's close button.
    const controls = dialog.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
    (initialFocus?.current ?? controls?.[1] ?? controls?.[0])?.focus();
    return () => {
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, [initialFocus]);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== "Tab" || !dialog.current) return;
    const controls = [...dialog.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
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
    <div className={s.scrim} onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        className={s.modal}
        onKeyDown={onKeyDown}
      >
        <header className={s.header}>
          <div className={s.heading}>
            <h2 id="modal-title" className={s.title}>
              {title}
            </h2>
            {subtitle && <div className={s.subtitle}>{subtitle}</div>}
          </div>
          <button type="button" className={s.close} aria-label={closeLabel} onClick={onClose}>
            <X aria-hidden />
          </button>
        </header>
        {children}
        <footer className={s.footer}>{footer}</footer>
      </div>
    </div>,
    document.body,
  );
}
