import { useId, type ReactNode } from "react";
import s from "./Toggle.module.css";

interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: ReactNode;
  hint?: ReactNode;
}

/** Toggle [DESIGN §2.19]: a switch, the whole row is clickable. */
export function Toggle({ checked, onChange, label, hint }: ToggleProps) {
  const id = useId();
  return (
    <label className={s.row} htmlFor={id}>
      <span className={s.text}>
        <span className={s.label}>{label}</span>
        {hint && <span className={s.hint}>{hint}</span>}
      </span>
      <input id={id} type="checkbox" role="switch" className={s.input} checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className={s.track} aria-hidden>
        <span className={s.handle} />
      </span>
    </label>
  );
}
