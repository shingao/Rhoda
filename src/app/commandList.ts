import {
  AArrowDown,
  AArrowUp,
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Archive,
  Bold,
  ChevronsDownUp,
  ChevronsUpDown,
  Copy,
  Expand,
  Eye,
  FilePlus2,
  Focus,
  FolderOpen,
  Heading1,
  Heading2,
  Heading3,
  Highlighter,
  Italic,
  Keyboard,
  Link,
  List,
  ListChecks,
  ListOrdered,
  ListTodo,
  ListTree,
  Minus,
  Moon,
  PanelLeft,
  PanelsTopLeft,
  PenTool,
  Pilcrow,
  Pin,
  RemoveFormatting,
  Replace,
  ScanText,
  Search,
  Settings,
  Share,
  SquareCode,
  Sticker,
  Strikethrough,
  TextCursorInput,
  TextQuote,
  TextSearch,
  Trash2,
  Type,
  Underline,
  type LucideIcon,
} from "lucide-react";
import { alignmentHere, formatSelection, runEditorCommand } from "../editor/session";
import type { FormatAction } from "../editor/format";
import type { Messages } from "../i18n";
import { focusSearch } from "./commands";
import { openExport } from "./export";
import { moveFocusZone, toggleColumn, toggleFocusMode, toggleTypewriter, toggleOutline, toggleFormatBar } from "./layout";
import { createNote, duplicateNote, setArchived, setPinned, trashNote } from "./notes";
import { toggleStickersHidden } from "./noteView";
import { reindexOcr } from "./ocr";
import { openFindFromSelection } from "./search";
import { SHORTCUTS, type ShortcutId } from "./shortcuts";
import { toggleStickerDrawer } from "./stickers";
import { newDrawing } from "./drawings";
import { currentList, getState, setState, updateSettings } from "./store";
import { changeVaultFolder } from "./vault";

/**
 * Every action of the app that can be run by name: the command palette lists
 * them with their shortcut, and the global shortcuts run them. A command that
 * cannot run now says why (the palette greys it out with that reason).
 */
export interface AppCommand {
  /** Stable id (remembered in the palette's recent commands). */
  id: string;
  label: (t: Messages) => string;
  icon: LucideIcon;
  shortcut?: ShortcutId;
  /** Why it cannot run now, or null. */
  unavailable?: (t: Messages) => string | null;
  run: () => void;
}

const openNote = () => {
  const { selectedId, notes } = getState();
  return selectedId ? notes[selectedId] : undefined;
};
const needsNote = (t: Messages) => (openNote() ? null : t.commands.reasons.noNote);
const needsLiveNote = (t: Messages) => {
  const note = openNote();
  return !note ? t.commands.reasons.noNote : note.trashed ? t.commands.reasons.inTrash : null;
};
const editor = (id: ShortcutId) => () => void runEditorCommand(id);
/** Alignment: an open note, and a block that can be aligned at the cursor (not code, table, image). */
const needsAlignableBlock = (t: Messages) => needsLiveNote(t) ?? (alignmentHere().available ? null : t.align.unavailable);
/** Inline formatting: an open note, the cursor outside code. */
const needsText = (t: Messages) => needsLiveNote(t) ?? (getState().format?.inCode ? t.format.inCode : null);
const format = (action: FormatAction) => () => void formatSelection(action);
const BLOCK_ICONS = { text: Pilcrow, h1: Heading1, h2: Heading2, h3: Heading3, quote: TextQuote, code: SquareCode } as const;

export const COMMANDS: readonly AppCommand[] = [
  { id: "note.new", label: (t) => t.commands.newNote, icon: FilePlus2, shortcut: "note.new", run: () => void createNote() },
  { id: "search.focus", label: (t) => t.commands.search, icon: Search, shortcut: "search.focus", run: focusSearch },
  { id: "find.open", label: (t) => t.commands.find, icon: TextSearch, shortcut: "find.open", unavailable: needsNote, run: () => openFindFromSelection(false) },
  { id: "find.replace", label: (t) => t.commands.replace, icon: Replace, shortcut: "find.replace", unavailable: needsLiveNote, run: () => openFindFromSelection(true) },
  { id: "export.open", label: (t) => t.commands.exportNote, icon: Share, shortcut: "export.open", unavailable: needsNote, run: () => openExport() },
  {
    id: "export.list",
    label: (t) => t.commands.exportList,
    icon: Share,
    unavailable: (t) => (currentList().length ? null : t.commands.reasons.emptyList),
    run: () => openExport(currentList().map((n) => n.id)),
  },
  { id: "task.toggle", label: (t) => t.commands.toggleTask, icon: ListChecks, shortcut: "task.toggle", unavailable: needsLiveNote, run: editor("task.toggle") },
  { id: "align.left", label: (t) => t.align.commands.left, icon: AlignLeft, shortcut: "align.left", unavailable: needsAlignableBlock, run: editor("align.left") },
  { id: "align.center", label: (t) => t.align.commands.center, icon: AlignCenter, shortcut: "align.center", unavailable: needsAlignableBlock, run: editor("align.center") },
  { id: "align.right", label: (t) => t.align.commands.right, icon: AlignRight, shortcut: "align.right", unavailable: needsAlignableBlock, run: editor("align.right") },
  { id: "align.justify", label: (t) => t.align.commands.justify, icon: AlignJustify, shortcut: "align.justify", unavailable: needsAlignableBlock, run: editor("align.justify") },
  { id: "format.bold", label: (t) => t.format.commands.bold, icon: Bold, shortcut: "format.bold", unavailable: needsText, run: editor("format.bold") },
  { id: "format.italic", label: (t) => t.format.commands.italic, icon: Italic, shortcut: "format.italic", unavailable: needsText, run: editor("format.italic") },
  { id: "format.underline", label: (t) => t.format.commands.underline, icon: Underline, shortcut: "format.underline", unavailable: needsText, run: editor("format.underline") },
  { id: "format.strike", label: (t) => t.format.commands.strike, icon: Strikethrough, shortcut: "format.strike", unavailable: needsText, run: editor("format.strike") },
  { id: "format.highlight", label: (t) => t.format.commands.highlight, icon: Highlighter, shortcut: "format.highlight", unavailable: needsText, run: editor("format.highlight") },
  { id: "format.larger", label: (t) => t.format.commands.larger, icon: AArrowUp, shortcut: "format.larger", unavailable: needsText, run: editor("format.larger") },
  { id: "format.smaller", label: (t) => t.format.commands.smaller, icon: AArrowDown, shortcut: "format.smaller", unavailable: needsText, run: editor("format.smaller") },
  { id: "format.clear", label: (t) => t.format.commands.clear, icon: RemoveFormatting, shortcut: "format.clear", unavailable: needsText, run: editor("format.clear") },
  { id: "format.link", label: (t) => t.format.commands.link, icon: Link, shortcut: "format.link", unavailable: needsText, run: editor("format.link") },
  { id: "drawing.insert", label: (t) => t.drawings.insertCommand, icon: PenTool, unavailable: needsLiveNote, run: newDrawing },
  { id: "format.rule", label: (t) => t.format.commands.rule, icon: Minus, unavailable: needsLiveNote, run: format({ kind: "rule" }) },
  { id: "list.bullet", label: (t) => t.format.commands.bullet, icon: List, shortcut: "list.bullet", unavailable: needsLiveNote, run: editor("list.bullet") },
  { id: "list.ordered", label: (t) => t.format.commands.ordered, icon: ListOrdered, shortcut: "list.ordered", unavailable: needsLiveNote, run: editor("list.ordered") },
  { id: "list.task", label: (t) => t.format.commands.task, icon: ListTodo, shortcut: "list.task", unavailable: needsLiveNote, run: editor("list.task") },
  ...(["text", "h1", "h2", "h3", "quote", "code"] as const).map((style) => ({
    id: `block.${style}`,
    label: (t: Messages) => t.format.commands[style],
    icon: BLOCK_ICONS[style],
    unavailable: needsLiveNote,
    run: format({ kind: "block", style }),
  })),
  {
    id: "note.pin",
    label: (t) => (openNote()?.pinned ? t.list.unpin : t.list.pin),
    icon: Pin,
    unavailable: needsLiveNote,
    run: () => {
      const note = openNote();
      if (note) void setPinned(note.id, !note.pinned);
    },
  },
  {
    id: "note.archive",
    label: (t) => (openNote()?.archived ? t.list.unarchive : t.list.archive),
    icon: Archive,
    unavailable: needsLiveNote,
    run: () => {
      const note = openNote();
      if (note) void setArchived(note.id, !note.archived);
    },
  },
  {
    id: "note.duplicate",
    label: (t) => t.list.duplicate,
    icon: Copy,
    unavailable: needsLiveNote,
    run: () => {
      const note = openNote();
      if (note) void duplicateNote(note.id);
    },
  },
  {
    id: "note.trash",
    label: (t) => t.list.moveToTrash,
    icon: Trash2,
    unavailable: needsLiveNote,
    run: () => {
      const note = openNote();
      if (note) void trashNote(note.id);
    },
  },
  { id: "fold.section", label: (t) => t.folding.fold, icon: ChevronsDownUp, shortcut: "fold.section", unavailable: needsNote, run: editor("fold.section") },
  { id: "unfold.section", label: (t) => t.folding.unfold, icon: ChevronsUpDown, shortcut: "unfold.section", unavailable: needsNote, run: editor("unfold.section") },
  { id: "fold.all", label: (t) => t.folding.foldAll, icon: ChevronsDownUp, shortcut: "fold.all", unavailable: needsNote, run: editor("fold.all") },
  { id: "unfold.all", label: (t) => t.folding.unfoldAll, icon: ChevronsUpDown, shortcut: "unfold.all", unavailable: needsNote, run: editor("unfold.all") },
  { id: "section.isolate", label: (t) => t.commands.isolate, icon: Focus, shortcut: "section.isolate", unavailable: needsNote, run: editor("section.isolate") },
  { id: "outline.toggle", label: (t) => t.commands.outline, icon: ListTree, shortcut: "outline.toggle", run: toggleOutline },
  { id: "layout.toggleSidebar", label: (t) => t.commands.toggleSidebar, icon: PanelLeft, shortcut: "layout.toggleSidebar", run: () => toggleColumn("sidebar") },
  { id: "layout.toggleList", label: (t) => t.commands.toggleList, icon: PanelsTopLeft, shortcut: "layout.toggleList", run: () => toggleColumn("list") },
  { id: "focus.toggle", label: (t) => t.info.focusMode, icon: Expand, shortcut: "focus.toggle", run: toggleFocusMode },
  {
    id: "editor.formatBar",
    label: (t) => (getState().settings.editor.formatBar ? t.format.hide : t.format.show),
    icon: Type,
    run: toggleFormatBar,
  },
  {
    id: "editor.typewriter",
    label: (t) => t.editor.typewriter,
    icon: TextCursorInput,
    run: toggleTypewriter,
  },
  { id: "stickers.drawer", label: (t) => t.stickers.open, icon: Sticker, shortcut: "stickers.drawer", unavailable: needsLiveNote, run: () => toggleStickerDrawer() },
  {
    id: "stickers.hide",
    label: (t) => (openNote() && getState().hiddenStickers[openNote()!.id] ? t.stickers.show : t.stickers.hide),
    icon: Eye,
    shortcut: "stickers.hide",
    unavailable: needsNote,
    run: toggleStickersHidden,
  },
  {
    id: "theme.toggle",
    label: (t) => (getState().settings.appearance.mode === "dark" ? t.commands.lightTheme : t.commands.darkTheme),
    icon: Moon,
    run: () => updateSettings((s) => ({ ...s, appearance: { ...s.appearance, mode: s.appearance.mode === "dark" ? "light" : "dark" } })),
  },
  { id: "settings.open", label: (t) => t.settings.menu, icon: Settings, shortcut: "settings.open", run: () => setState({ settingsPage: "general" }) },
  { id: "settings.shortcuts", label: (t) => t.commands.shortcutsSettings, icon: Keyboard, run: () => setState({ settingsPage: "shortcuts" }) },
  { id: "vault.change", label: (t) => t.commands.changeFolder, icon: FolderOpen, run: () => void changeVaultFolder() },
  {
    id: "ocr.reindex",
    label: (t) => t.commands.reindexOcr,
    icon: ScanText,
    unavailable: (t) => (getState().settings.ocr.enabled && getState().ocr.status?.available ? null : t.commands.reasons.ocrOff),
    run: () => void reindexOcr(),
  },
];

const byId = new Map(COMMANDS.map((c) => [c.id, c]));
export const commandById = (id: string) => byId.get(id);

/** Global shortcuts → the command they run (F11 is a second key for focus mode). */
export function globalHandlers(t: () => Messages): Partial<Record<ShortcutId, () => void>> {
  const run = (c: AppCommand) => () => {
    if (!c.unavailable?.(t())) c.run();
  };
  const handlers: Partial<Record<ShortcutId, () => void>> = {};
  for (const c of COMMANDS) if (c.shortcut && SHORTCUTS[c.shortcut].scope === "global") handlers[c.shortcut] = run(c);
  handlers["focus.toggleKey"] = toggleFocusMode;
  handlers["zone.next"] = () => moveFocusZone(1);
  handlers["zone.previous"] = () => moveFocusZone(-1);
  handlers["palette.open"] = () => setState({ palette: getState().palette ? null : { query: "" } });
  return handlers;
}
