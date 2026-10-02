import { ChevronsUpDown } from "lucide-react";
import s from "./Select.module.css";

interface SelectProps<T extends string> {
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (value: T) => void;
  label: string;
}

/** Native select styled as a field (maquette 09 « Police de l'éditeur »). */
export function Select<T extends string>({ value, options, onChange, label }: SelectProps<T>) {
  return (
    <div className={s.wrap}>
      <select className={s.select} value={value} aria-label={label} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronsUpDown className={s.icon} aria-hidden />
    </div>
  );
}
