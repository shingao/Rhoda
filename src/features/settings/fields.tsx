import type { ReactNode } from "react";
import s from "./Settings.module.css";

/** One labelled setting: label (+ value on the right), control, optional hint. */
export function Field({ label, value, hint, children }: { label: string; value?: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <section className={s.field}>
      <div className={s.fieldHead}>
        <span className={s.label}>{label}</span>
        {value !== undefined && <span className={s.value}>{value}</span>}
      </div>
      {children}
      {hint && <p className={s.hint}>{hint}</p>}
    </section>
  );
}
