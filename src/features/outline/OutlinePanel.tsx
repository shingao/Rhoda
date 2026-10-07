import { useRef, type KeyboardEvent } from "react";
import { ChevronDown, ChevronRight, X } from "lucide-react";
import { useT } from "../../app/i18n";
import { toggleOutline } from "../../app/layout";
import { useApp } from "../../app/store";
import { IconButton } from "../../components/IconButton";
import { focusEditor, scrollToHeading, toggleFoldAt } from "../../editor/session";
import type { OutlineItem } from "../../editor/sections/outline";
import s from "./OutlinePanel.module.css";

/**
 * Contents panel [DESIGN §2.15]: headings of the open note, current section
 * highlighted while scrolling. Chevrons fold and unfold like the editor's; a
 * click on a folded heading unfolds it, then scrolls to it.
 */
export function OutlinePanel({ docked }: { docked: boolean }) {
  const t = useT();
  const { items, current } = useApp((st) => st.outline);
  const list = useRef<HTMLUListElement>(null);
  const visible = items.filter((i) => !i.hidden);
  const minLevel = Math.min(...visible.map((i) => i.level));

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      toggleOutline();
      focusEditor();
      e.preventDefault();
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const buttons = [...(list.current?.querySelectorAll<HTMLElement>("[data-outline-item]") ?? [])];
    const index = buttons.indexOf(document.activeElement as HTMLElement);
    buttons[index + (e.key === "ArrowDown" ? 1 : -1)]?.focus();
    e.preventDefault();
  };

  const row = (item: OutlineItem) => {
    const active = item.from === current;
    return (
      <li key={item.from} className={s.row} style={{ ["--outline-depth" as string]: item.level - minLevel }}>
        {item.foldable && (
          <button
            type="button"
            tabIndex={-1}
            className={[s.chevron, item.folded && s.folded].filter(Boolean).join(" ")}
            aria-label={item.folded ? t.folding.unfold : t.folding.fold}
            onClick={() => toggleFoldAt(item.from)}
          >
            {item.folded ? <ChevronRight aria-hidden /> : <ChevronDown aria-hidden />}
          </button>
        )}
        <button
          type="button"
          data-outline-item
          tabIndex={active || (current === null && item === visible[0]) ? 0 : -1}
          className={[s.item, item.level === minLevel && s.top, active && s.current].filter(Boolean).join(" ")}
          aria-current={active ? "location" : undefined}
          onClick={() => scrollToHeading(item.from)}
        >
          {item.text || "#"}
        </button>
      </li>
    );
  };

  return (
    <aside className={[s.panel, docked && s.docked].filter(Boolean).join(" ")} aria-label={t.outline.title} onKeyDown={onKeyDown} data-zone="outline">
      <header className={s.head}>
        <h2 className={s.title}>{t.outline.title}</h2>
        <IconButton icon={X} label={t.outline.close} className={s.close} onClick={toggleOutline} />
      </header>
      {visible.length ? (
        <ul ref={list} className={s.list}>
          {visible.map(row)}
        </ul>
      ) : (
        <p className={s.empty}>{t.outline.empty}</p>
      )}
    </aside>
  );
}
