import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import type { Command } from "@codemirror/view";
import { toggleTaskEdits } from "../core/markdown/tasks";

const inCode = (state: EditorState, pos: number) => {
  for (let n: { name: string; parent: unknown } | null = syntaxTree(state).resolveInner(pos, 1); n; n = n.parent as typeof n) {
    if (n.name === "FencedCode" || n.name === "CodeBlock") return true;
  }
  return false;
};

/** Ctrl+Shift+T: the task of the current line, or of every selected line (never inside code). */
export const toggleTasks: Command = (view) => {
  const { state } = view;
  const seen = new Set<number>();
  const lines: Array<{ line: number; text: string }> = [];
  for (const range of state.selection.ranges) {
    const last = state.doc.lineAt(range.to).number;
    for (let n = state.doc.lineAt(range.from).number; n <= last; n++) {
      const line = state.doc.line(n);
      // A selection ending at the start of a line does not take that line.
      if (n === last && n > state.doc.lineAt(range.from).number && range.to === line.from) continue;
      if (seen.has(n) || inCode(state, line.from)) continue;
      seen.add(n);
      lines.push({ line: n, text: line.text });
    }
  }
  const edits = toggleTaskEdits(lines);
  if (!edits.length) return lines.length > 0;
  view.dispatch({
    changes: edits.map((e) => {
      const from = state.doc.line(e.line).from;
      return { from: from + e.from, to: from + e.to, insert: e.insert };
    }),
    userEvent: "input.toggle",
    scrollIntoView: true,
  });
  return true;
};
