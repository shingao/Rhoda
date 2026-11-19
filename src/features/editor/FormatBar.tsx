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
  RemoveFormatting,
  Strikethrough,
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
import { NO_LOOK, type NoteLook } from "../../editor/noteStyle";
import { NOTE_FONTS, TEXT_SIZE, type NoteFont } from "../../core/note/note";
import type { Messages } from "../../i18n";
import s from "./FormatBar.module.css";

/**
 * Formatting toolbar (decision P12-2): one thin line under the editor bar,
 * aligned on the text column. Groups from left to right; on a narrow window
 * the right-hand ones move into a "…" menu. Every button acts on the
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

/** Font of the note: the default setting, or one of its own (`font:`). */
function noteFontEntries(t: Messages, look: NoteLook, fallback: NoteFont): MenuEntry[] {
  return [
    { id: "font-default", label: t.format.byDefault(t.format.fonts[fallback]), checked: look.font === null, onSelect: run({ kind: "look", look: { font: null } }) },
    ...NOTE_FONTS.map((font) => ({ id: `font-${font}`, label: t.format.fonts[font], checked: look.font === font, onSelect: run({ kind: "look", look: { font } }) })),
  ];
}

/** Text size of the note, 14–20 px (`size:`); a half size set in Settings or by hand is listed too. */
function noteSizeEntries(t: Messages, look: NoteLook, fallback: number): MenuEntry[] {
  const sizes = new Set<number>();
  for (let n = TEXT_SIZE.min; n <= TEXT_SIZE.max; n++) sizes.add(n);
  if (look.size !== null) sizes.add(look.size);
  return [
    { id: "size-default", label: t.format.byDefault(t.settings.px(fallback)), checked: look.size === null, onSelect: run({ kind: "look", look: { size: null } }) },
    ...[...sizes]
      .sort((a, b) => a - b)
      .map((size) => ({ id: `size-${size}`, label: t.settings.px(size), checked: look.size === size, onSelect: run({ kind: "look", look: { size } }) })),
  ];
}

type Opener = (entries: MenuEntry[], label: string, at: DOMRect) => void;

interface Group {
  id: string;
  /** Buttons shown in the bar. */
  render: (open: Opener) => ReactNode;
  /** The same actions as menu entries, for the "…" menu. */
  entries: () => MenuEntry[];
}

export function FormatBar() {
  const t = useT();
  const f = useApp((st) => st.format);
  const ref = useRef<HTMLDivElement>(null);
  const widths = useRef(new Map<string, number>());
  const [fits, setFits] = useState<number | null>(null);
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
  const defaults = useApp((st) => st.settings.editor);

  /** A text button showing a value, opening a menu (block style, note font and size). */
  const dropdown = (label: string, value: string, entries: () => MenuEntry[], open: Opener, wide = true) => (
    <Tooltip label={label}>
      <button
        type="button"
        className={[s.select, !wide && s.narrow].filter(Boolean).join(" ")}
        aria-haspopup="menu"
        aria-label={`${label} : ${value}`}
        onClick={(e) => open(entries(), label, e.currentTarget.getBoundingClientRect())}
      >
        <span className={s.selectLabel}>{value}</span>
        <ChevronDown className={s.chevron} aria-hidden />
      </button>
    </Tooltip>
  );
  const fontEntries = () => noteFontEntries(t, state.look, defaults.font);
  const textSizeEntries = () => noteSizeEntries(t, state.look, defaults.fontSize);

  const groups: Group[] = [
    {
      id: "block",
      render: (open) => dropdown(t.format.blockStyle, t.format.blocks[state.block], () => blockEntries(t, state), open),
      entries: () => blockEntries(t, state),
    },
    {
      id: "note",
      render: (open) => (
        <>
          {dropdown(t.format.noteFont, t.format.fonts[state.look.font ?? defaults.font], fontEntries, open)}
          {dropdown(t.format.noteSize, t.settings.px(state.look.size ?? defaults.fontSize), textSizeEntries, open, false)}
        </>
      ),
      entries: () => [...fontEntries(), { kind: "separator" as const, id: "note-sep" }, ...textSizeEntries()],
    },
    {
      id: "size",
      render: (open) => (
        <IconButton
          icon={ALargeSmall}
          label={t.format.textSize}
          aria-haspopup="menu"
          active={state.size !== "normal"}
          disabled={inline}
          onClick={(e) => open(sizeEntries(t, state), t.format.textSize, e.currentTarget.getBoundingClientRect())}
        />
      ),
      entries: () => sizeEntries(t, state),
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
      render: (open) => (
        <IconButton
          icon={Highlighter}
          label={t.format.highlight}
          aria-haspopup="menu"
          active={state.highlight !== null}
          disabled={inline}
          onClick={(e) => open(highlightEntries(t, state), t.format.highlight, e.currentTarget.getBoundingClientRect())}
        />
      ),
      entries: () => highlightEntries(t, state),
    },
    {
      id: "lists",
      render: () =>
        LISTS.map(({ list, icon, shortcut }) => (
          <IconButton
            key={list}
            icon={icon}
            label={t.format.lists[list]}
            shortcut={shortcutLabel(shortcut, t)}
            active={state.list === list}
            aria-pressed={state.list === list}
            disabled={state.block === "code"}
            onClick={run({ kind: "list", list })}
          />
        )),
      entries: () =>
        LISTS.map(({ list, icon, shortcut }) => ({ id: list, label: t.format.lists[list], icon, toggle: true, checked: state.list === list, shortcut: shortcutLabel(shortcut, t), onSelect: run({ kind: "list", list }) })),
    },
    {
      id: "align",
      render: () =>
        ALIGNS.map(({ align, icon }) => (
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
      entries: () =>
        state.canAlign
          ? ALIGNS.map(({ align, icon }) => ({ id: align, label: t.align[align], icon, checked: state.align === align, shortcut: shortcutLabel(`align.${align}`, t), onSelect: run({ kind: "align", align }) }))
          : [],
    },
    {
      id: "insert",
      render: () => (
        <>
          <IconButton icon={Link} label={t.format.link} shortcut={shortcutLabel("format.link", t)} disabled={inline} onClick={run({ kind: "link" })} />
          <IconButton icon={ImagePlus} label={t.format.image} onClick={() => void insertFromDialog()} />
          <IconButton icon={PenTool} label={t.drawings.insertCommand} onClick={newDrawing} />
          <IconButton icon={Minus} label={t.format.rule} onClick={run({ kind: "rule" })} />
        </>
      ),
      entries: () => [
        { id: "link", label: t.format.link, icon: Link, shortcut: shortcutLabel("format.link", t), onSelect: run({ kind: "link" }) },
        { id: "image", label: t.format.image, icon: ImagePlus, onSelect: () => void insertFromDialog() },
        { id: "drawing", label: t.drawings.insertCommand, icon: PenTool, onSelect: newDrawing },
        { id: "rule", label: t.format.rule, icon: Minus, onSelect: run({ kind: "rule" }) },
      ],
    },
    {
      id: "clear",
      render: () => <IconButton icon={RemoveFormatting} label={t.format.clear} shortcut={shortcutLabel("format.clear", t)} disabled={inline} onClick={run({ kind: "clear" })} />,
      entries: () => [{ id: "clear", label: t.format.clear, icon: RemoveFormatting, shortcut: shortcutLabel("format.clear", t), onSelect: run({ kind: "clear" }) }],
    },
  ];

  // How many groups fit: each group's width is measured once (all shown), then
  // the bar keeps as many as the room allows, the rest going to "…".
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const style = getComputedStyle(el);
      const room = el.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      const gap = parseFloat(style.columnGap) || 0;
      const more = cssPx("--icon-btn");
      const all = [...widths.current.values()];
      const total = all.reduce((a, w) => a + w + gap, -gap);
      if (total <= room) return setFits(null);
      let used = more;
      let n = 0;
      for (const w of all) {
        if (used + gap + w > room) break;
        used += gap + w;
        n++;
      }
      setFits(n);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const shown = fits === null ? groups : groups.slice(0, fits);
  const hidden = fits === null ? [] : groups.slice(fits);

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
        <div
          key={g.id}
          className={s.group}
          ref={(node) => {
            if (node && fits === null) widths.current.set(g.id, node.offsetWidth);
          }}
        >
          {g.render(open)}
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
    </div>
  );
}
