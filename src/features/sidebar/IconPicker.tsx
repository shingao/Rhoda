import { useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Search, X } from "lucide-react";
import { DynamicIcon, iconNames, type IconName } from "lucide-react/dynamic";
import lucideTags from "lucide-static/tags.json";
import { cssPx } from "../../app/cssTokens";
import { useT } from "../../app/i18n";
import type { TagSettings } from "../../app/store";
import { formatTag, type TagNode } from "../../core/tags";
import { TagIcon } from "../../components/TagIcon";
import { TAG_COLOR_COUNT, tagColor } from "./tagColor";
import s from "./IconPicker.module.css";

/** Hand-picked groups shown before any search (Lucide ships no categories). */
const GROUPS = {
  travel: "plane train-front map map-pin compass globe mountain tent luggage camera ship car bike sun umbrella house",
  work: "briefcase book-open graduation-cap notebook-pen lightbulb code flask-conical calculator presentation folder file-text chart-line target calendar clock mail",
  life: "chef-hat coffee utensils shopping-cart heart dumbbell wallet gift baby dog cat shirt pill music gamepad-2 palette",
  nature: "leaf flower-2 tree-pine sprout cloud snowflake flame droplet moon star sparkles bird fish bug apple cherry",
  misc: "hash tag bookmark flag rocket inbox archive pin",
} as const;

const KEYWORDS = lucideTags as Record<string, string[]>;
const MAX_RESULTS = 96;
const COLUMNS = 8;
const EDGE = 8;

function search(query: string): IconName[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const exact: IconName[] = [];
  const loose: IconName[] = [];
  for (const name of iconNames) {
    if (name.includes(q)) exact.push(name);
    else if (KEYWORDS[name]?.some((k) => k.includes(q))) loose.push(name);
    if (exact.length >= MAX_RESULTS) break;
  }
  return [...exact, ...loose].slice(0, MAX_RESULTS);
}

interface IconPickerProps {
  node: TagNode;
  anchor: DOMRect;
  settings: TagSettings;
  onChange: (patch: Partial<TagSettings>) => void;
  onClose: () => void;
}

/** Icon and colour of a tag [DESIGN §2.6], next to its sidebar item. */
export default function IconPicker({ node, anchor, settings, onChange, onClose }: IconPickerProps) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [top, setTop] = useState(anchor.top);
  const [active, setActive] = useState(0);
  const results = useMemo(() => search(query), [query]);
  const sections: Array<[string, IconName[]]> = query.trim()
    ? [[t.tags.picker.results, results]]
    : (Object.keys(GROUPS) as Array<keyof typeof GROUPS>).map((g) => [t.tags.picker.groups[g], GROUPS[g].split(" ") as IconName[]]);
  const flat = sections.flatMap(([, icons]) => icons);

  // Aligned on the item, kept inside the window [DESIGN §2.6].
  useLayoutEffect(() => {
    const h = ref.current?.getBoundingClientRect().height ?? 0;
    setTop(Math.max(EDGE, Math.min(anchor.top - h / 3, window.innerHeight - h - EDGE)));
  }, [anchor, sections.length]);

  const choose = (name: IconName) => onChange({ icon: name });

  const onKeyDown = (e: KeyboardEvent) => {
    const moves: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: COLUMNS, ArrowUp: -COLUMNS };
    if (e.key === "Escape") onClose();
    else if (e.key in moves) setActive((i) => Math.max(0, Math.min(flat.length - 1, i + moves[e.key]!)));
    else if (e.key === "Enter" && flat[active]) choose(flat[active]);
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  let index = -1;
  return (
    <>
      <div className={s.backdrop} onPointerDown={onClose} />
      <div
        ref={ref}
        role="dialog"
        aria-label={t.tags.picker.title(formatTag(node.path))}
        className={s.picker}
        style={{ left: anchor.right + cssPx("--picker-offset"), top }}
        onKeyDown={onKeyDown}
      >
        <header className={s.header}>
          <span className={s.preview}>
            <TagIcon name={settings.icon} className={s.previewIcon} style={{ color: tagColor(settings.color) }} />
          </span>
          <span className={s.title}>{t.tags.picker.title(formatTag(node.path))}</span>
          <button type="button" className={s.close} aria-label={t.modal.close} onClick={onClose}>
            <X aria-hidden />
          </button>
        </header>
        <label className={s.search}>
          <Search className={s.searchIcon} aria-hidden />
          <input
            autoFocus
            value={query}
            placeholder={t.tags.picker.search}
            aria-label={t.tags.picker.search}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
          />
        </label>
        <div className={s.swatches} role="radiogroup" aria-label={t.tags.picker.defaultColor}>
          {Array.from({ length: TAG_COLOR_COUNT + 1 }, (_, i) => (
            <button
              key={i}
              type="button"
              role="radio"
              aria-checked={(settings.color ?? 0) === i}
              aria-label={i === 0 ? t.tags.picker.defaultColor : t.tags.picker.color(i)}
              className={[s.swatch, (settings.color ?? 0) === i && s.swatchOn].filter(Boolean).join(" ")}
              style={{ background: i === 0 ? "var(--text-2)" : tagColor(i) }}
              onClick={() => onChange({ color: i === 0 ? undefined : i })}
            />
          ))}
        </div>
        <div className={s.scroll}>
          {sections.map(([title, icons]) => (
            <section key={title}>
              <h4 className={s.group}>{title}</h4>
              {icons.length === 0 ? (
                <p className={s.none}>{t.tags.picker.none}</p>
              ) : (
                <div className={s.grid} role="listbox" aria-label={title}>
                  {icons.map((name) => {
                    const i = ++index;
                    const on = settings.icon === name;
                    return (
                      <button
                        key={name}
                        type="button"
                        role="option"
                        aria-selected={on}
                        title={name}
                        className={[s.cell, on && s.cellOn, i === active && s.cellActive].filter(Boolean).join(" ")}
                        onClick={() => choose(name)}
                        onPointerMove={() => setActive(i)}
                      >
                        <DynamicIcon name={name} className={s.cellIcon} aria-hidden />
                      </button>
                    );
                  })}
                </div>
              )}
            </section>
          ))}
        </div>
        <footer className={s.foot}>
          <button type="button" className={s.remove} onClick={() => onChange({ icon: undefined })}>
            {t.tags.picker.removeIcon}
          </button>
          <span>{t.tags.picker.count(new Intl.NumberFormat("fr-FR").format(iconNames.length))}</span>
        </footer>
      </div>
    </>
  );
}
