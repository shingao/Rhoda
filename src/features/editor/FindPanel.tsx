import { useEffect, useRef, type KeyboardEvent } from "react";
import { ChevronDown, ChevronRight, ChevronUp, X } from "lucide-react";
import { useT } from "../../app/i18n";
import { closeFind, setFind } from "../../app/search";
import { matchShortcut, shortcutLabel } from "../../app/shortcuts";
import { showToast, useApp } from "../../app/store";
import { Button } from "../../components/Button";
import { IconButton } from "../../components/IconButton";
import { findStep, replaceEvery, replaceOne } from "../../editor/session";
import s from "./FindPanel.module.css";

/**
 * Find in the note (Ctrl+F) and replace (Ctrl+H): case and accents ignored like
 * the global search, "3 / 12", Entrée / Maj+Entrée for next / previous,
 * Échap closes. "Tout remplacer" is one undo step.
 */
export function FindPanel() {
  const t = useT();
  const find = useApp((st) => st.find);
  const query = useRef<HTMLInputElement>(null);
  const replacement = useRef<HTMLInputElement>(null);

  useEffect(() => {
    query.current?.focus();
    query.current?.select();
    // Start at the occurrence nearest to the cursor (unless one is already current).
    if (find.query && useApp.getState().find.current === null) findStep(1);
  }, [find.focusToken]); // eslint-disable-line react-hooks/exhaustive-deps

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>, onEnter: () => void) => {
    const id = matchShortcut(e.nativeEvent, "find");
    if (id === "find.next") onEnter();
    else if (id === "find.previous") findStep(-1);
    else if (e.key === "Escape") closeFind();
    else return;
    e.preventDefault();
  };

  const replaceAll = () => {
    const n = replaceEvery(replacement.current?.value ?? "");
    if (n) showToast(t.find.replaced(n));
  };

  return (
    <div className={s.panel} role="search" aria-label={t.find.label}>
      <div className={s.row}>
        <IconButton
          icon={ChevronRight}
          label={t.find.toggleReplace}
          shortcut={shortcutLabel("find.replace", t)}
          className={[s.toggle, find.replace && s.toggleOpen].filter(Boolean).join(" ")}
          aria-expanded={find.replace}
          onClick={() => setFind({ replace: !find.replace })}
        />
        <input
          ref={query}
          className={s.input}
          type="text"
          spellCheck={false}
          placeholder={t.find.placeholder}
          aria-label={t.find.label}
          value={find.query}
          onChange={(e) => {
            setFind({ query: e.target.value });
            findStep(1);
          }}
          onKeyDown={(e) => onKeyDown(e, () => findStep(1))}
        />
        <span className={[s.count, find.query && find.count === 0 && s.none].filter(Boolean).join(" ")} aria-live="polite">
          {find.query ? t.find.position(find.current, find.count) : ""}
        </span>
        <IconButton icon={ChevronUp} label={t.find.previous} shortcut={shortcutLabel("find.previous", t)} disabled={!find.count} onClick={() => findStep(-1)} />
        <IconButton icon={ChevronDown} label={t.find.next} shortcut={shortcutLabel("find.next", t)} disabled={!find.count} onClick={() => findStep(1)} />
        <IconButton icon={X} label={t.find.close} onClick={closeFind} />
      </div>
      {find.replace && (
        <div className={s.row}>
          <span className={s.indent} />
          <input
            ref={replacement}
            className={s.input}
            type="text"
            spellCheck={false}
            placeholder={t.find.replacePlaceholder}
            aria-label={t.find.replaceLabel}
            onKeyDown={(e) => onKeyDown(e, () => replaceOne(e.currentTarget.value))}
          />
          <Button size="small" disabled={!find.count} onClick={() => replaceOne(replacement.current?.value ?? "")}>
            {t.find.replace}
          </Button>
          <Button size="small" disabled={!find.count} onClick={replaceAll}>
            {t.find.replaceAll}
          </Button>
        </div>
      )}
    </div>
  );
}
