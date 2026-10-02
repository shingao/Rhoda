import type { Messages } from "./fr";

export const en: Messages = {
  untitled: "Untitled",
  dates: {
    locale: "en-US",
    justNow: "just now",
    minutesAgo: (n) => `${n} min ago`,
    hoursAgo: (n) => `${n} h ago`,
    yesterday: "Yesterday",
  },
  keys: {
    Ctrl: "Ctrl",
    Shift: "Shift",
    Alt: "Alt",
    Delete: "Del",
    Enter: "Enter",
    Escape: "Esc",
    Backslash: "\\",
  },
  titlebar: {
    showSidebar: "Show sidebar",
    hideSidebar: "Hide sidebar",
    newNote: "New note",
    minimize: "Minimize",
    maximize: "Maximize",
    restore: "Restore",
    close: "Close",
  },
  search: {
    placeholder: "Search notes",
    label: "Search notes",
    clear: "Clear search",
  },
  sidebar: {
    label: "Sections",
    notes: "Notes",
  },
  list: {
    title: "Notes",
    empty: "No notes yet",
    sortBy: (field) => `Sort: ${field}`,
    sortMenu: "Sort notes",
    sort: {
      modified: "Date modified",
      created: "Date created",
      title: "Title",
    },
    pinned: "Pinned",
    noteActions: "Note actions",
    moveToTrash: "Move to Trash",
  },
  editor: {
    label: "Editor",
    textLabel: "Note text",
    placeholder: "Start writing…",
    showList: "Show note list",
    hideList: "Hide note list",
    more: "More",
    noSelection: "No note selected",
    noSelectionHint: (shortcut) => `Press ${shortcut} to create a note.`,
  },
  layout: {
    resizeSidebar: "Resize sidebar",
    resizeList: "Resize note list",
  },
  errors: {
    vaultOpen: (message) => `Could not open the notes folder: ${message}`,
  },
};
