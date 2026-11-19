import { useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import {
  ALargeSmall,
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Bold,
  ChevronDown,
  Ellipsis,
  Highlighter,
  ImagePlus,
  Italic,
  Link,
  List,
  ListOrdered,
  ListTodo,
  Minus,
  PenTool,
  Plus,
  RemoveFormatting,
  Strikethrough,
  Type,
  Underline,
  type LucideIcon,
} from "lucide-react";
import { insertFromDialog } from "../../app/attachments";
import { newDrawing } from "../../app/drawings";
import { cssPx } from "../../app/cssTokens";
import { useT } from "../../app/i18n";
import { shortcutLabel, type ShortcutId } from "../../app/shortcuts";
import { useApp } from "../../app/store";
import { IconButton } from "../../components/IconButton";
import { Menu, type MenuEntry } from "../../components/Menu";
import { Tooltip } from "../../components/Tooltip";
import type { Alignment } from "../../core/align";
import type { ListKind } from "../../core/markdown/blockFormat";
import { HIGHLIGHT_COLORS, type HighlightColor } from "../../core/markdown/inlineTags";
import type { BlockChoice, FormatAction, FormatState, InlineMark } from "../../editor/format";
import { formatSelection } from "../../editor/session";
import { NO_LOOK } from "../../editor/noteStyle";
import type { Messages } from "../../i18n";
import s from "./FormatBar.module.css";
import { TextPopover } from "./TextPopover";

/**
 * Formatting toolbar (decisions P12-2, P12-9): one thin line under the editor
 * bar, aligned on the text column. Groups from left to right; short of room,
 * alignment and insert fold into one menu button each, then (below about
 * 1 200 px with the side columns open) the right-hand groups go to "…". Every button acts on the
 * selection in one transaction (Ctrl+Z undoes it) and shows its state there.
 */

const BLOCKS: readonly BlockChoice[] = ["text", "h1", "h2", "h3", "quote", "code"];
const MARKS: ReadonlyArray<{ mark: InlineMark; icon: LucideIcon; shortcut: ShortcutId }> = [
  { mark: "bold", icon: Bold, shortcut: "format.bold" },
  { mark: "italic", icon: Italic, shortcut: "format.italic" },
  { mark: "underline", icon: Underline, shortcut: "format.underline" },
  { mark: "strike", icon: Strikethrough, shortcut: "format.strike" },
];
const LISTS: ReadonlyArray<{ list: ListKind; icon: LucideIcon; shortcut: ShortcutId }> = [
  { list: "bullet", icon: List, shortcut: "list.bullet" },
  { list: "ordered", icon: ListOrdered, shortcut: "list.ordered" },
  { list: "task", icon: ListTodo, shortcut: "list.task" },
];
const ALIGNS: ReadonlyArray<{ align: Alignment; icon: LucideIcon }> = [
  { align: "left", icon: AlignLeft },
  { align: "center", icon: AlignCenter },
  { align: "right", icon: AlignRight },
  { align: "justify", icon: AlignJustify },
];
const SIZES = ["sm", "normal", "lg"] as const;
const SWATCH: Record<HighlightColor, string> = { yellow: "--hl-yellow", green: "--hl-green", blue: "--hl-blue", pink: "--hl-pink" };

const run = (action: FormatAction) => () => void formatSelection(action);

/** Width of each group in buttons (0: the block style menu), and folded into one menu button where it can (layout). */
const PLAN: ReadonlyArray<{ id: string; buttons: number; compact?: number }> = [
  { id: "block", buttons: 0 },
  { id: "text", buttons: 1 },
  { id: "marks", buttons: 4 },
  { id: "highlight", buttons: 1 },
  { id: "lists", buttons: 1 },
  { id: "align", buttons: 4, compact: 1 },
  { id: "insert", buttons: 4, compact: 1 },
  { id: "clear", buttons: 1 },
];

/** Entries of the menus (dropdowns, and the "…" menu for the groups that do not fit). */
function blockEntries(t: Messages, f: FormatState): MenuEntry[] {
  return BLOCKS.map((style) => ({ id: `block-${style}`, label: t.format.blocks[style], checked: f.block === style, onSelect: run({ kind: "block", style }) }));
}

function sizeEntries(t: Messages, f: FormatState): MenuEntry[] {
  return SIZES.map((size) => ({
    id: `size-${size}`,
    label: t.format.sizes[size],
    checked: f.size === size,
    shortcut: size === "lg" ? shortcutLabel("format.larger", t) : size === "sm" ? shortcutLabel("format.smaller", t) : undefined,
    onSelect: run({ kind: "size", size }),
  }));
}

function highlightEntries(t: Messages, f: FormatState): MenuEntry[] {
  return [
    ...HIGHLIGHT_COLORS.map((color) => ({
      id: `hl-${color}`,
      label: t.format.colors[color],
      swatch: SWATCH[color],
      checked: f.highlight === color,
      shortcut: color === "yellow" ? shortcutLabel("format.highlight", t) : undefined,
      onSelect: run({ kind: "highlight", color }),
    })),
    { kind: "separator" as const, id: "hl-sep" },
    { id: "hl-none", label: t.format.removeHighlight, icon: RemoveFormatting, onSelect: run({ kind: "highlight", color: null }) },
  ];
}

type Opener = (entries: MenuEntry[], label: string, at: DOMRect) => void;

interface Group {
  id: string;
  /** Buttons shown in the bar; `compact`: the group as one menu button. */
  render: (open: Opener, compact: boolean) => ReactNode;
  /** The same actions as menu entries, for the "…" menu. */
  entries: () => MenuEntry[];
}

export function FormatBar() {
  const t = useT();
  const f = useApp((st) => st.format);
  const ref = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<{ entries: MenuEntry[]; label: string; at: { x: number; y: number } } | null>(null);

  const state: FormatState = f ?? {
    block: "text",
    list: null,
    marks: { bold: false, italic: false, underline: false, strike: false },
    highlight: null,
    size: "normal",
    align: "left",
    canAlign: false,
    inCode: false,
    look: NO_LOOK,
  };
  const inline = state.inCode;
  const [textAt, setTextAt] = useState<{ x: number; y: number } | null>(null);

  /** A text button showing a value, opening a menu (block style). */
  const dropdown = (label: string, value: string, entries: () => MenuEntry[], open: Opener) => (
    <Tooltip label={label}>
      <button
        type="button"
        className={s.select}
        aria-haspopup="menu"
        aria-label={`${label} : ${value}`}
        onClick={(e) => open(entries(), label, e.currentTarget.getBoundingClientRect())}
      >
        <span className={s.selectLabel}>{value}</span>
        <ChevronDown className={s.chevron} aria-hidden />
      </button>
    </Tooltip>
  );
  /** One icon opening a menu (lists, and alignment / insert when the bar is short of room). */
  const menuButton = (icon: LucideIcon, label: string, entries: () => MenuEntry[], open: Opener, active = false, disabled = false) => (
    <IconButton icon={icon} label={label} aria-haspopup="menu" active={active} disabled={disabled} onClick={(e) => open(entries(), label, e.currentTarget.getBoundingClientRect())} />
  );

  const listEntries = () =>
    LISTS.map(({ list, icon, shortcut }) => ({ id: list, label: t.format.lists[list], icon, checked: state.list === list, toggle: true, shortcut: shortcutLabel(shortcut, t), onSelect: run({ kind: "list", list }) }));
  const alignEntries = () =>
    state.canAlign
      ? ALIGNS.map(({ align, icon }) => ({ id: align, label: t.align[align], icon, checked: state.align === align, shortcut: shortcutLabel(`align.${align}`, t), onSelect: run({ kind: "align", align }) }))
      : [];
  const insertEntries = (): MenuEntry[] => [
    { id: "link", label: t.format.link, icon: Link, shortcut: shortcutLabel("format.link", t), onSelect: run({ kind: "link" }) },
    { id: "image", label: t.format.image, icon: ImagePlus, onSelect: () => void insertFromDialog() },
    { id: "drawing", label: t.drawings.insertCommand, icon: PenTool, onSelect: newDrawing },
    { id: "rule", label: t.format.rule, icon: Minus, onSelect: run({ kind: "rule" }) },
  ];
  const textEntries = (): MenuEntry[] => [
    { id: "text", label: `${t.format.text}…`, icon: Type, onSelect: () => setTextAt(textAnchor()) },
    ...sizeEntries(t, state),
  ];
  const textAnchor = () => {
    const r = document.querySelector<HTMLElement>("[data-text-button]")?.getBoundingClientRect() ?? document.querySelector("[role=toolbar]")?.getBoundingClientRect();
    return { x: r?.left ?? 0, y: (r?.bottom ?? 0) + 4 };
  };
  const listIcon = LISTS.find((l) => l.list === state.list)?.icon ?? List;
  const alignIcon = ALIGNS.find((a) => a.align === state.align)?.icon ?? AlignLeft;

  const groups: Group[] = [
    {
      id: "block",
      render: (open) => dropdown(t.format.blockStyle, t.format.blocks[state.block], () => blockEntries(t, state), open),
      entries: () => blockEntries(t, state),
    },
    {
      id: "text",
      render: () => (
        <IconButton
          icon={ALargeSmall}
          label={t.format.text}
          aria-haspopup="dialog"
          data-text-button
          active={state.size !== "normal" || state.look.font !== null || state.look.size !== null}
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            setTextAt((at) => (at ? null : { x: r.left, y: r.bottom + 4 }));
          }}
        />
      ),
      entries: textEntries,
    },
    {
      id: "marks",
      render: () =>
        MARKS.map(({ mark, icon, shortcut }) => (
          <IconButton
            key={mark}
            icon={icon}
            label={t.format[mark]}
            shortcut={shortcutLabel(shortcut, t)}
            active={state.marks[mark]}
            aria-pressed={state.marks[mark]}
            disabled={inline}
            onClick={run({ kind: "mark", mark })}
          />
        )),
      entries: () =>
        MARKS.map(({ mark, icon, shortcut }) => ({ id: mark, label: t.format[mark], icon, toggle: true, checked: state.marks[mark], shortcut: shortcutLabel(shortcut, t), onSelect: run({ kind: "mark", mark }) })),
    },
    {
      id: "highlight",
      render: (open) => menuButton(Highlighter, t.format.highlight, () => highlightEntries(t, state), open, state.highlight !== null, inline),
      entries: () => highlightEntries(t, state),
    },
    {
      id: "lists",
      render: (open) => menuButton(listIcon, t.format.listMenu, listEntries, open, state.list !== null, state.block === "code"),
      entries: listEntries,
    },
    {
      id: "align",
      render: (open, compact) =>
        compact
          ? menuButton(alignIcon, t.format.alignment, alignEntries, open, false, !state.canAlign)
          : ALIGNS.map(({ align, icon }) => (
              <IconButton
                key={align}
                icon={icon}
                label={t.align[align]}
                shortcut={shortcutLabel(`align.${align}`, t)}
                active={state.canAlign && state.align === align}
                aria-pressed={state.canAlign && state.align === align}
                disabled={!state.canAlign}
                onClick={run({ kind: "align", align })}
              />
            )),
      entries: alignEntries,
    },
    {
      id: "insert",
      render: (open, compact) =>
        compact ? (
          menuButton(Plus, t.format.insert, insertEntries, open)
        ) : (
          <>
            <IconButton icon={Link} label={t.format.link} shortcut={shortcutLabel("format.link", t)} disabled={inline} onClick={run({ kind: "link" })} />
            <IconButton icon={ImagePlus} label={t.format.image} onClick={() => void insertFromDialog()} />
            <IconButton icon={PenTool} label={t.drawings.insertCommand} onClick={newDrawing} />
            <IconButton icon={Minus} label={t.format.rule} onClick={run({ kind: "rule" })} />
          </>
        ),
      entries: insertEntries,
    },
    {
      id: "clear",
      render: () => <IconButton icon={RemoveFormatting} label={t.format.clear} shortcut={shortcutLabel("format.clear", t)} disabled={inline} onClick={run({ kind: "clear" })} />,
      entries: () => [{ id: "clear", label: t.format.clear, icon: RemoveFormatting, shortcut: shortcutLabel("format.clear", t), onSelect: run({ kind: "clear" }) }],
    },
  ];

  // Layout from the room (sizes read from the tokens): every group in full;
  // else alignment, then insert, folded into one menu button each; else the
  // right-hand groups go to "…" (decision P12-9).
  const [layout, setLayout] = useState<{ compact: ReadonlySet<string>; fits: number | null }>({ compact: new Set(), fits: null });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const style = getComputedStyle(el);
      const room = el.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      const [btn, inner, between, select] = [cssPx("--icon-btn"), cssPx("--formatbar-gap"), cssPx("--formatbar-group-gap"), cssPx("--formatbar-select-w")];
      const widthOf = (buttons: number) => (buttons === 0 ? select : buttons * btn + (buttons - 1) * inner);
      const total = (compact: ReadonlySet<string>, count = PLAN.length, more = false) =>
        PLAN.slice(0, count).reduce((sum, g, i) => sum + (i ? between : 0) + widthOf(compact.has(g.id) && g.compact ? g.compact : g.buttons), 0) + (more ? between + btn : 0);
      for (const compact of [new Set<string>(), new Set(["align"]), new Set(["align", "insert"])]) {
        if (total(compact) <= room) return setLayout({ compact, fits: null });
      }
      const compact = new Set(["align", "insert"]);
      let n = PLAN.length - 1;
      while (n > 1 && total(compact, n, true) > room) n--;
      setLayout({ compact, fits: n });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const shown = layout.fits === null ? groups : groups.slice(0, layout.fits);
  const hidden = layout.fits === null ? [] : groups.slice(layout.fits);

  const open = (entries: MenuEntry[], label: string, r: DOMRect) => setMenu({ entries, label, at: { x: r.left, y: r.bottom + 4 } });

  // Toolbar keys [WAI-ARIA toolbar]: arrows move between the buttons.
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight" && e.key !== "Home" && e.key !== "End") return;
    const buttons = [...(ref.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    const next = e.key === "Home" ? 0 : e.key === "End" ? buttons.length - 1 : (i + (e.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next]?.focus();
    e.preventDefault();
  };

  return (
    <div
      ref={ref}
      className={s.bar}
      role="toolbar"
      aria-label={t.format.bar}
      onKeyDown={onKeyDown}
      // The editor keeps the focus and its selection while a button is clicked.
      onMouseDown={(e) => {
        if ((e.target as HTMLElement).closest("button")) e.preventDefault();
      }}
    >
      {shown.map((g) => (
        <div key={g.id} className={s.group}>
          {g.render(open, layout.compact.has(g.id))}
        </div>
      ))}
      {hidden.length > 0 && (
        <div className={s.group}>
          <IconButton
            icon={Ellipsis}
            label={t.format.more}
            aria-haspopup="menu"
            onClick={(e) => {
              const entries = hidden.flatMap((g, i) => {
                const list = g.entries();
                return i > 0 && list.length ? [{ kind: "separator" as const, id: `sep-${g.id}` }, ...list] : list;
              });
              const r = e.currentTarget.getBoundingClientRect();
              setMenu({ entries, label: t.format.more, at: { x: r.left, y: r.bottom + 4 } });
            }}
          />
        </div>
      )}
      {menu && <Menu at={menu.at} entries={menu.entries} label={menu.label} onClose={() => setMenu(null)} />}
      {textAt && <TextPopover state={state} at={textAt} onClose={() => setTextAt(null)} />}
    </div>
  );
}
