import { forwardRef, type ButtonHTMLAttributes } from "react";
import type { LucideIcon } from "lucide-react";
import s from "./Button.module.css";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "danger";
  size?: "default" | "titlebar";
  icon?: LucideIcon;
}

/** Text button [DESIGN §2.18]. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "default", icon: Icon, className, children, ...rest },
  ref,
) {
  return (
    <button ref={ref} type="button" className={[s.button, s[variant], s[size], className].filter(Boolean).join(" ")} {...rest}>
      {Icon && <Icon className={s.icon} aria-hidden />}
      {children}
    </button>
  );
});
