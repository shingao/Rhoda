import { AlignCenter, AlignJustify, AlignLeft, AlignRight } from "lucide-react";
import { shortcutLabel } from "../../app/shortcuts";
import type { MenuEntry } from "../../components/Menu";
import type { Alignment } from "../../core/align";
import { alignmentHere, runEditorCommand } from "../../editor/session";
import type { Messages } from "../../i18n";

const ICONS = { left: AlignLeft, center: AlignCenter, right: AlignRight, justify: AlignJustify } as const;
const ORDER: readonly Alignment[] = ["left", "center", "right", "justify"];

/** Left, centred, right, justified for the block at the cursor (checked: its alignment); none where it cannot be aligned. */
export function alignEntries(t: Messages): MenuEntry[] {
  const { align, available } = alignmentHere();
  if (!available) return [];
  return ORDER.map((a) => ({
    id: `align-${a}`,
    label: t.align[a],
    icon: ICONS[a],
    checked: align === a,
    shortcut: shortcutLabel(`align.${a}`, t),
    onSelect: () => void runEditorCommand(`align.${a}`),
  }));
}
