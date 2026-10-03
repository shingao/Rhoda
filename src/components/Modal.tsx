import { useId, type ReactNode, type RefObject } from "react";
import { X } from "lucide-react";
import { Dialog } from "./Dialog";
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
  /** Wider dialog (crop). */
  wide?: boolean;
}

/** Modal dialog [DESIGN §2.17]: header with title and close button, content, footer of buttons. */
export function Modal({ title, subtitle, closeLabel, onClose, children, footer, initialFocus, wide }: ModalProps) {
  const titleId = useId();
  return (
    <Dialog onClose={onClose} labelledBy={titleId} className={[s.modal, wide && s.wide].filter(Boolean).join(" ")} initialFocus={initialFocus}>
      <header className={s.header}>
        <div className={s.heading}>
          <h2 id={titleId} className={s.title}>
            {title}
          </h2>
          {subtitle && <div className={s.subtitle}>{subtitle}</div>}
        </div>
        <CloseButton label={closeLabel} onClick={onClose} />
      </header>
      {children}
      <footer className={s.footer}>{footer}</footer>
    </Dialog>
  );
}

export function CloseButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" className={s.close} aria-label={label} onClick={onClick}>
      <X aria-hidden />
    </button>
  );
}
