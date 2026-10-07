import { Archive, CalendarDays, Inbox, NotebookText, Pin, SquareCheck, Trash2, type LucideIcon } from "lucide-react";
import type { SectionId } from "../../app/sections";

/** Icons of the fixed sections [DESIGN §2.2], also used by their empty states. */
export const SECTION_ICONS: Record<SectionId, LucideIcon> = {
  notes: NotebookText,
  untagged: Inbox,
  todo: SquareCheck,
  today: CalendarDays,
  pinned: Pin,
  archive: Archive,
  trash: Trash2,
};
