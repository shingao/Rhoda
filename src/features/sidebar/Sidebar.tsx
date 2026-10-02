import { NotebookText } from "lucide-react";
import { useT } from "../../app/i18n";
import { isListed, useApp } from "../../app/store";
import s from "./Sidebar.module.css";

/** Sidebar [DESIGN §2.2]. Phase 1 has the "Notes" section only; the others arrive in phase 3. */
export function Sidebar() {
  const count = useApp((st) => Object.values(st.notes).filter(isListed).length);
  const t = useT();

  return (
    <nav className={s.sidebar} aria-label={t.sidebar.label}>
      <ul className={s.items}>
        <li>
          <button type="button" className={`${s.item} ${s.selected}`} aria-current="page">
            <NotebookText className={s.icon} aria-hidden />
            <span className={s.label}>{t.sidebar.notes}</span>
            <span className={s.count}>{count}</span>
          </button>
        </li>
      </ul>
    </nav>
  );
}
