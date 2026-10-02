import { useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { registerSearchFocus } from "../../app/commands";
import s from "./SearchField.module.css";

/** Search field [DESIGN §2.3]. Visual only in phase 1: search arrives in phase 5. */
export function SearchField() {
  const input = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState("");

  useEffect(() => {
    registerSearchFocus(() => input.current?.select());
    return () => registerSearchFocus(null);
  }, []);

  return (
    <label className={s.field}>
      <Search className={s.icon} aria-hidden />
      <input
        ref={input}
        className={s.input}
        type="text"
        role="searchbox"
        placeholder="Search notes"
        aria-label="Search notes"
        spellCheck={false}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setValue("");
            e.currentTarget.blur();
          }
        }}
      />
      {value ? (
        <button type="button" className={s.clear} aria-label="Clear search" onClick={() => setValue("")}>
          <X aria-hidden />
        </button>
      ) : (
        <kbd className={s.kbd}>Ctrl K</kbd>
      )}
    </label>
  );
}
