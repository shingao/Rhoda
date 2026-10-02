import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Search, X } from "lucide-react";
import { registerSearchFocus } from "../../app/commands";
import { useT } from "../../app/i18n";
import { noteIndex } from "../../app/noteIndex";
import { clearSearch, openSearchResult, setSearch, stepSearchResult } from "../../app/search";
import { shortcutLabel } from "../../app/shortcuts";
import { activeQuery, currentList, useApp } from "../../app/store";
import { fold } from "../../core/search/fold";
import { OPERATORS } from "../../core/search/query";
import { formatTag } from "../../core/tags";
import { focusEditor } from "../../editor/session";
import s from "./SearchField.module.css";

interface Suggestion {
  value: string;
  hint?: string;
}

const MAX_SUGGESTIONS = 8;
/** An operator or a tag followed by a space, just before the caret: it becomes a chip. */
const COMPLETED = /(^|\s)(-?(?:@[\p{L}]+|#[^\s#]+#?))\s$/u;
/** The operator or tag being typed at the caret. */
const PARTIAL = /(?:^|\s)-?([@#][^\s]*)$/u;

function isChip(token: string): boolean {
  const t = token.replace(/^-/, "");
  return t.startsWith("#") ? t.length > 1 : (OPERATORS as readonly string[]).includes(t.slice(1).toLowerCase());
}

/**
 * Search field [DESIGN §2.3]: complete operators and tags become chips,
 * suggestions for `@` and `#`, results counted in the field. ↑/↓ browse the
 * results, Entrée opens one at its first occurrence, Échap clears and goes
 * back to the editor.
 */
export function SearchField() {
  const t = useT();
  const input = useRef<HTMLInputElement>(null);
  const search = useApp((st) => st.search);
  const notes = useApp((st) => st.notes);
  const [caret, setCaret] = useState(0);
  const [armed, setArmed] = useState(false);
  const [active, setActive] = useState(0);
  const [suggestOpen, setSuggestOpen] = useState(true);
  const [focused, setFocused] = useState(false);
  const searching = useApp((st) => activeQuery(st.search) !== null);
  // Counted from the same list the column shows.
  const count = useApp((st) => (activeQuery(st.search) ? currentList().length : 0));

  useEffect(() => {
    registerSearchFocus(() => input.current?.select());
    return () => registerSearchFocus(null);
  }, []);

  const partial = PARTIAL.exec(search.text.slice(0, caret))?.[1] ?? null;
  const suggestions = useMemo<Suggestion[]>(() => {
    if (!partial) return [];
    const q = fold(partial.slice(1));
    if (partial.startsWith("@")) {
      return OPERATORS.filter((op) => op.startsWith(q)).map((op) => ({ value: `@${op}`, hint: t.search.operators[op] }));
    }
    return [...noteIndex(notes).tags.byKey.values()]
      .filter((n) => fold(n.path).split("/").some((seg, i, all) => seg.startsWith(q) || all.slice(i).join("/").startsWith(q)))
      .slice(0, MAX_SUGGESTIONS)
      .map((n) => ({ value: `#${n.path.includes(" ") ? `${n.path}#` : n.path}` }));
  }, [partial, notes, t]);
  const showSuggestions = suggestOpen && focused && suggestions.length > 0;

  const update = (text: string, caretAt: number) => {
    let chips = search.chips;
    // Starting a search while a tag is selected in the sidebar: the search starts inside it.
    const { filter } = useApp.getState();
    if (!chips.length && !search.text && text.trim() && filter.kind === "tag") {
      const node = noteIndex(notes).tags.byKey.get(filter.key);
      if (node) chips = [formatTag(node.path)];
    }
    const done = COMPLETED.exec(text.slice(0, caretAt));
    if (done && isChip(done[2]!)) {
      const start = done.index + done[1]!.length;
      const rest = text.slice(0, start) + text.slice(caretAt);
      setSearch({ chips: [...chips, done[2]!], text: rest });
      setCaret(start);
      requestAnimationFrame(() => input.current?.setSelectionRange(start, start));
    } else {
      setSearch({ chips, text });
      setCaret(caretAt);
    }
    setArmed(false);
    setActive(0);
    setSuggestOpen(true);
  };

  const accept = (s: Suggestion) => {
    const before = search.text.slice(0, caret).replace(/-?[@#][^\s]*$/, (m) => (m.startsWith("-") ? "-" : "") + s.value + " ");
    const text = before + search.text.slice(caret);
    update(text, before.length);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    const el = e.currentTarget;
    if (showSuggestions && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      setActive((i) => (i + (e.key === "ArrowDown" ? 1 : -1) + suggestions.length) % suggestions.length);
    } else if (showSuggestions && (e.key === "Enter" || e.key === "Tab")) {
      accept(suggestions[active] ?? suggestions[0]!);
    } else if (showSuggestions && e.key === "Escape") {
      setSuggestOpen(false);
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      stepSearchResult(e.key === "ArrowDown" ? 1 : -1);
    } else if (e.key === "Enter") {
      if (searching) openSearchResult();
    } else if (e.key === "Escape") {
      clearSearch();
      focusEditor();
    } else if (e.key === "Backspace" && el.selectionStart === 0 && el.selectionEnd === 0 && search.chips.length) {
      // First press selects the last chip, the second removes it.
      if (armed) {
        setSearch({ chips: search.chips.slice(0, -1), text: search.text });
        setArmed(false);
      } else setArmed(true);
    } else {
      if (armed) setArmed(false);
      return;
    }
    e.preventDefault();
  };

  return (
    <div className={s.wrap}>
      <label className={[s.field, (searching || search.text) && s.filled].filter(Boolean).join(" ")}>
        <Search className={s.icon} aria-hidden />
        {search.chips.map((chip, i) => (
          <span
            key={`${chip}-${i}`}
            className={[chip.replace(/^-/, "").startsWith("#") ? s.tagChip : s.opChip, armed && i === search.chips.length - 1 && s.armed]
              .filter(Boolean)
              .join(" ")}
          >
            {chip}
          </span>
        ))}
        <input
          ref={input}
          className={s.input}
          type="text"
          role="combobox"
          aria-expanded={showSuggestions}
          aria-controls="search-suggestions"
          aria-activedescendant={showSuggestions ? `search-suggestion-${active}` : undefined}
          aria-autocomplete="list"
          placeholder={search.chips.length ? "" : t.search.placeholder}
          aria-label={t.search.label}
          spellCheck={false}
          value={search.text}
          onChange={(e) => update(e.target.value, e.target.selectionStart ?? e.target.value.length)}
          onSelect={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
          onKeyDown={onKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setArmed(false);
            setFocused(false);
          }}
        />
        {searching && <span className={s.count}>{t.search.results(count)}</span>}
        {searching || search.text ? (
          <button
            type="button"
            className={s.clear}
            aria-label={t.search.clear}
            onClick={() => {
              clearSearch();
              input.current?.focus();
            }}
          >
            <X aria-hidden />
          </button>
        ) : (
          <kbd className={s.kbd}>{shortcutLabel("search.focus", t)}</kbd>
        )}
      </label>
      {showSuggestions && (
        <ul id="search-suggestions" role="listbox" aria-label={t.search.suggestions} className={s.suggestions}>
          {suggestions.map((sug, i) => (
            <li
              key={sug.value}
              id={`search-suggestion-${i}`}
              role="option"
              aria-selected={i === active}
              className={[s.suggestion, i === active && s.activeSuggestion].filter(Boolean).join(" ")}
              onMouseDown={(e) => {
                e.preventDefault();
                accept(sug);
              }}
            >
              <span className={sug.value.startsWith("@") ? s.opChip : s.tagChip}>{sug.value}</span>
              {sug.hint && <span className={s.hint}>{sug.hint}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
