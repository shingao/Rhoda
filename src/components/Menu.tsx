import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Check, type LucideIcon } from "lucide-react";
import s from "./Menu.module.css";

export type MenuEntry =
  | {
      kind?: "item";
      id: string;
      label: string;
      icon?: LucideIcon;
      shortcut?: string;
      danger?: boolean;
      /** Shows a check mark; turns the item into a radio item (or a checkbox item with `toggle`). */
      checked?: boolean;
      toggle?: boolean;
      onSelect: () => void;
    }
  | { kind: "separator"; id: string };

interface MenuProps {
  /** Viewport coordinates of the top-left corner (or the click point). */
  at: { x: number; y: number };
  entries: MenuEntry[];
  label: string;
  /** "end": the menu's right edge sits at `at.x` (for buttons on the right). */
  align?: "start" | "end";
  onClose: () => void;
}

const EDGE = 8;

type MenuItem = Exclude<MenuEntry, { kind: "separator" }>;
const isItem = (e: MenuEntry): e is MenuItem => e.kind !== "separator";

/** Context menu / dropdown [DESIGN §2.21], keyboard navigable. */
export function Menu({ at, entries, label, align = "start", onClose }: MenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const items = entries.filter(isItem);
  const [active, setActive] = useState(() => Math.max(0, items.findIndex((e) => e.checked)));
  const [pos, setPos] = useState(at);
  const returnFocus = useRef<Element | null>(document.activeElement);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const x = align === "end" ? at.x - r.width : at.x;
    setPos({
      x: Math.max(EDGE, Math.min(x, window.innerWidth - r.width - EDGE)),
      y: Math.max(EDGE, Math.min(at.y, window.innerHeight - r.height - EDGE)),
    });
    el.focus();
  }, [at, align]);

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("blur", onClose);
    window.addEventListener("resize", onClose);
    const focusTarget = returnFocus.current;
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("blur", onClose);
      window.removeEventListener("resize", onClose);
      if (focusTarget instanceof HTMLElement && document.activeElement === document.body) focusTarget.focus();
    };
  }, [onClose]);

  const select = (index: number) => {
    const entry = items[index];
    if (!entry) return;
    onClose();
    entry.onSelect();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const n = items.length;
    switch (e.key) {
      case "ArrowDown":
        setActive((i) => (i + 1) % n);
        break;
      case "ArrowUp":
        setActive((i) => (i - 1 + n) % n);
        break;
      case "Home":
        setActive(0);
        break;
      case "End":
        setActive(n - 1);
        break;
      case "Enter":
      case " ":
        select(active);
        break;
      case "Escape":
      case "Tab":
        onClose();
        break;
      default:
        return;
    }
    e.preventDefault();
    e.stopPropagation();
  };

  let itemIndex = -1;
  return createPortal(
    <div
      ref={ref}
      role="menu"
      aria-label={label}
      tabIndex={-1}
      className={s.menu}
      style={{ left: pos.x, top: pos.y }}
      onKeyDown={onKeyDown}
      onContextMenu={(e) => e.preventDefault()}
    >
      {entries.map((entry) => {
        if (entry.kind === "separator") return <div key={entry.id} role="separator" className={s.separator} />;
        const index = ++itemIndex;
        const Icon = entry.checked ? Check : entry.icon;
        const radio = entry.checked !== undefined;
        return (
          <div
            key={entry.id}
            role={radio ? (entry.toggle ? "menuitemcheckbox" : "menuitemradio") : "menuitem"}
            aria-checked={radio ? entry.checked : undefined}
            className={[s.item, entry.danger && s.danger, index === active && s.current].filter(Boolean).join(" ")}
            onPointerMove={() => setActive(index)}
            onClick={() => select(index)}
          >
            <span className={s.iconSlot}>{Icon && <Icon className={s.icon} aria-hidden />}</span>
            <span className={s.label}>{entry.label}</span>
            {entry.shortcut && <span className={s.shortcut}>{entry.shortcut}</span>}
          </div>
        );
      })}
    </div>,
    document.body,
  );
}
