import { ChevronDown, ChevronUp } from "lucide-react";
import { useT } from "../../app/i18n";
import { activeQuery, useApp } from "../../app/store";
import { findStep } from "../../editor/session";
import s from "./FindPill.module.css";

/** "3 occurrences ↑ ↓" in the editor bar while a search is active [DESIGN §2.3]. */
export function FindPill() {
  const t = useT();
  const count = useApp((st) => st.find.count);
  const visible = useApp((st) => !st.find.open && activeQuery(st.search) !== null && (activeQuery(st.search)?.include.length ?? 0) > 0);
  if (!visible || count === 0) return null;
  return (
    <div className={s.pill} role="group" aria-label={t.find.occurrences(count)}>
      <span className={s.count} aria-live="polite">
        {t.find.occurrences(count)}
      </span>
      <button type="button" className={s.step} aria-label={t.find.previous} onClick={() => findStep(-1)}>
        <ChevronUp aria-hidden />
      </button>
      <button type="button" className={s.step} aria-label={t.find.next} onClick={() => findStep(1)}>
        <ChevronDown aria-hidden />
      </button>
    </div>
  );
}
