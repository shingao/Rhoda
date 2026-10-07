/**
 * Ctrl+Shift+T [DESIGN §2.7]: ticks or unticks the task of the current line,
 * or of every selected line together (all ticked if any was not, else all
 * unticked). With no task among them, the lines become tasks: a list item
 * gets a box, a plain line becomes "- [ ] …". Blank lines stay blank.
 */

const TASK = /^(\s*(?:>\s?)*\s*(?:[-*+]|\d+[.)])\s+)\[([ xX])\]/;
const ITEM = /^(\s*(?:>\s?)*\s*(?:[-*+]|\d+[.)])\s+)/;
const LEAD = /^(\s*(?:>\s?)*\s*)/;

/** A change inside one line: replace [from, to) of the line by `insert`. */
export interface LineEdit {
  line: number;
  from: number;
  to: number;
  insert: string;
}

/** Edits for the given lines (index → text); empty when nothing applies. */
export function toggleTaskEdits(lines: ReadonlyArray<{ line: number; text: string }>): LineEdit[] {
  const tasks = lines.flatMap(({ line, text }) => {
    const m = TASK.exec(text);
    return m ? [{ line, at: m[1]!.length + 1, checked: m[2] !== " " }] : [];
  });
  if (tasks.length) {
    const tick = tasks.some((t) => !t.checked);
    return tasks.filter((t) => t.checked !== tick).map((t) => ({ line: t.line, from: t.at, to: t.at + 1, insert: tick ? "x" : " " }));
  }
  return lines.flatMap(({ line, text }): LineEdit[] => {
    if (!text.trim() && lines.length > 1) return [];
    const item = ITEM.exec(text);
    if (item) return [{ line, from: item[1]!.length, to: item[1]!.length, insert: "[ ] " }];
    const lead = LEAD.exec(text)![1]!.length;
    return [{ line, from: lead, to: lead, insert: "- [ ] " }];
  });
}
