import { forwardRef, type ButtonHTMLAttributes } from "react";
import type { LucideIcon } from "lucide-react";
import { Tooltip } from "./Tooltip";
import s from "./IconButton.module.css";

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: LucideIcon;
  label: string;
  shortcut?: string;
  /** "chrome" for buttons on --bg-0 (titlebar, sidebar). */
  tone?: "default" | "chrome";
  active?: boolean;
}

/** Ghost icon button, 32×32 [DESIGN §2.18], with tooltip [§2.22]. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon: Icon, label, shortcut, tone = "default", active = false, className, ...rest },
  ref,
) {
  return (
    <Tooltip label={label} shortcut={shortcut}>
      <button
        ref={ref}
        type="button"
        aria-label={label}
        className={[s.button, s[tone], active && s.active, className].filter(Boolean).join(" ")}
        {...rest}
      >
        <Icon className={s.icon} aria-hidden />
      </button>
    </Tooltip>
  );
});
