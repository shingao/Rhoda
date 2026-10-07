import { useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Search } from "lucide-react";
import { useT } from "../../app/i18n";
import { closePalette, insertNoteLink, paletteGroups, runPaletteItem, type PaletteItem } from "../../app/palette";
import { useApp } from "../../app/store";
import { Dialog } from "../../components/Dialog";
import { Kbd } from "../../components/Kbd";
import s from "./CommandPalette.module.css";

/** Command palette [DESIGN §2.16, maquette 07]. */
export function CommandPalette() {
  const palette = useApp((st) => st.palette);
  if (!palette) return null;
  return <Palette initial={palette.query} />;
}

/** The label with the matched characters in bold accent [§2.16]. */
function highlight(label: string, ranges: Array<[number, number]>): ReactNode {
  if (!ranges.length) return label;
  const out: ReactNode[] = [];
  let at = 0;
  ranges.forEach(([from, to], i) => {
    if (from > at) out.push(label.slice(at, from));
    out.push(
      <mark key={i} className={s.match}>
        {label.slice(from, to)}
      </mark>,
    );
    at = to;
  });
  if (at < label.length) out.push(label.slice(at));
  return out;
}

function Palette({ initial }: { initial: string }) {
  const t = useT();
  const p = t.palette;
  const [query, setQuery] = useState(initial);
  const [active, setActive] = useState(0);
  const titleId = useId();
  const listId = useId();
  const input = useRef<HTMLInputElement>(null);
  // Also follows the notes, tags and shortcuts in force.
  const notes = useApp((st) => st.notes);
  const recent = useApp((st) => st.settings.palette.recent);
  const groups = useMemo(() => paletteGroups(query, t), [query, t, notes, recent]); // eslint-disable-line react-hooks/exhaustive-deps
  const items = groups.flatMap((g) => g.items);
  const current = items[Math.min(active, items.length - 1)];

  const move = (step: number) => {
    if (!items.length) return;
    const next = (Math.min(active, items.length - 1) + step + items.length) % items.length;
    setActive(next);
    document.getElementById(`${listId}-${next}`)?.scrollIntoView({ block: "nearest" });
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      move(e.key === "ArrowDown" ? 1 : -1);
    } else if (e.key === "Enter" && current) {
      e.preventDefault();
      runPaletteItem(current);
    } else if (e.key === "Tab" && !e.shiftKey && current?.kind === "note") {
      e.preventDefault();
      insertNoteLink(current, t);
    }
  };

  let index = -1;
  return (
    <Dialog onClose={closePalette} labelledBy={titleId} className={s.palette} scrimClassName={s.scrim} initialFocus={input}>
      <h2 id={titleId} className={s.hidden}>
        {p.label}
      </h2>
      <div className={s.field}>
        <Search className={s.fieldIcon} aria-hidden />
        <input
          ref={input}
          className={s.input}
          value={query}
          placeholder={p.placeholder}
          aria-label={p.label}
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={current ? `${listId}-${items.indexOf(current)}` : undefined}
          aria-autocomplete="list"
          spellCheck={false}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
        />
        <Kbd keys={[t.keys.Escape ?? "Esc"]} />
      </div>
      <div id={listId} className={s.list} role="listbox" aria-label={p.label}>
        {!items.length && <p className={s.empty}>{p.noResults}</p>}
        {groups.map((g) => (
          <div key={g.id} role="group" aria-labelledby={`${listId}-${g.id}`}>
            <div id={`${listId}-${g.id}`} className={s.group}>
              {p.groups[g.id]}
            </div>
            {g.items.map((item: PaletteItem) => {
              index++;
              const i = index;
              const Icon = item.icon;
              const disabled = item.kind === "command" && item.reason !== null;
              return (
                <div
                  key={`${item.kind}:${item.key}`}
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={item === current}
                  aria-disabled={disabled || undefined}
                  title={disabled ? p.unavailable(item.reason!) : undefined}
                  className={[s.row, item === current && s.current, disabled && s.disabled].filter(Boolean).join(" ")}
                  onPointerMove={() => i !== active && setActive(i)}
                  onClick={() => runPaletteItem(item)}
                >
                  <Icon className={s.icon} aria-hidden />
                  <span className={s.label}>
                    {item.kind === "tag" && "#"}
                    {highlight(item.label, item.ranges)}
                  </span>
                  {item.kind === "command" ? (
                    disabled ? (
                      <span className={s.reason}>{item.reason}</span>
                    ) : (
                      <Kbd keys={item.keys} />
                    )
                  ) : (
                    <span className={s.meta}>{item.meta}</span>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <footer className={s.footer}>
        <span>
          <span aria-hidden>↑↓</span> {p.navigate}
        </span>
        <span>
          <span aria-hidden>↵</span> {current?.kind === "command" || !current ? p.run : p.open}
        </span>
        {current?.kind === "note" && <span>Tab {p.insertLink}</span>}
        <span className={s.footerEnd}>
          &gt; {p.commandsOnly} · # {p.tagsOnly}
        </span>
      </footer>
    </Dialog>
  );
}
