import { Archive, ArchiveRestore, Copy, Pin, PinOff, RotateCcw, Share, Trash2 } from "lucide-react";
import { openExport } from "../../app/export";
import { confirmAction } from "../../app/confirm";
import { currentMessages } from "../../app/i18n";
import { BackupFailedError, deleteNotes, duplicateNote, restoreNote, setArchived, setPinned, undoAction, type BulkOperation } from "../../app/notes";
import { showToast } from "../../app/store";
import { shortcutLabel } from "../../app/shortcuts";
import type { Note } from "../../core/note/note";
import type { MenuEntry } from "../../components/Menu";
import type { Messages } from "../../i18n";

/** Permanent deletion, after a confirmation that states how many notes go. */
export async function confirmDeleteNotes(ids: string[], op: BulkOperation = "delete-notes"): Promise<void> {
  if (ids.length === 0) return;
  const t = currentMessages();
  const ok = await confirmAction({
    title: t.list.deleteTitle(ids.length),
    body: t.list.deleteBody(ids.length),
    confirmLabel: t.list.deleteConfirm,
    danger: true,
  });
  if (!ok) return;
  try {
    const { count, backup } = await deleteNotes(ids, op);
    if (backup) showToast(t.list.deleted(count), undoAction(backup));
  } catch (e) {
    if (!(e instanceof BackupFailedError)) throw e;
    showToast(t.undo.backupFailed);
  }
}

/** Actions on a note depending on where it is; shared by the list's context menu and the editor's "…" menu. */
export function noteMenuEntries(note: Note | undefined, t: Messages, onTrash: (id: string) => void): MenuEntry[] {
  if (!note) return [];
  if (note.trashed) {
    return [
      { id: "restore", label: t.list.restore, icon: RotateCcw, onSelect: () => void restoreNote(note.id) },
      { kind: "separator", id: "sep-note" },
      {
        id: "delete",
        label: t.list.deletePermanently,
        icon: Trash2,
        shortcut: shortcutLabel("note.trash", t),
        danger: true,
        onSelect: () => void confirmDeleteNotes([note.id]),
      },
    ];
  }
  return [
    { id: "pin", label: note.pinned ? t.list.unpin : t.list.pin, icon: note.pinned ? PinOff : Pin, onSelect: () => void setPinned(note.id, !note.pinned) },
    {
      id: "archive",
      label: note.archived ? t.list.unarchive : t.list.archive,
      icon: note.archived ? ArchiveRestore : Archive,
      onSelect: () => void setArchived(note.id, !note.archived),
    },
    { id: "duplicate", label: t.list.duplicate, icon: Copy, onSelect: () => void duplicateNote(note.id) },
    { id: "export", label: t.exportDialog.menuNote, icon: Share, shortcut: shortcutLabel("export.open", t), onSelect: () => openExport([note.id]) },
    { kind: "separator", id: "sep-note" },
    {
      id: "trash",
      label: t.list.moveToTrash,
      icon: Trash2,
      shortcut: shortcutLabel("note.trash", t),
      danger: true,
      onSelect: () => onTrash(note.id),
    },
  ];
}
