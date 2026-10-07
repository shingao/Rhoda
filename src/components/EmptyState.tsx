import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import s from "./EmptyState.module.css";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  hint?: ReactNode;
  /** A button, e.g. "Nouvelle note". */
  action?: ReactNode;
  /** Centered in its column (editor) rather than at the top (list). */
  centered?: boolean;
}

/** Nothing to show: decorative icon, what is empty, what to do (decision P10-14). */
export function EmptyState({ icon: Icon, title, hint, action, centered }: EmptyStateProps) {
  return (
    <div className={[s.empty, centered && s.centered].filter(Boolean).join(" ")} role="status">
      <Icon className={s.icon} aria-hidden />
      <p className={s.title}>{title}</p>
      {hint && <p className={s.hint}>{hint}</p>}
      {action && <div className={s.action}>{action}</div>}
    </div>
  );
}
