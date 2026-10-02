import { autocompletion, type Completion, type CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import { syntaxTree } from "@codemirror/language";
import { formatTag } from "../core/tags";
import { editorHooks } from "./hooks";

/** Case- and accent-insensitive form for matching. */
function fold(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase();
}

/**
 * Substring matching (CodeMirror's fuzzy matching is too loose for names):
 * prefixes first, then word or segment starts, then anywhere.
 */
function matching(labels: string[], query: string, toOption: (label: string) => Completion): Completion[] {
  const q = fold(query);
  const ranked: Array<[number, string]> = [];
  for (const label of labels) {
    const f = fold(label);
    const at = f.indexOf(q);
    if (at < 0) continue;
    ranked.push([at === 0 ? 0 : /[\s/-]/.test(f[at - 1]!) ? 1 : 2, label]);
  }
  ranked.sort((a, b) => a[0] - b[0] || a[1].localeCompare(b[1], "fr"));
  return ranked.map(([, label]) => toOption(label));
}

/** No completion inside code or URLs. */
function inCode(context: CompletionContext): boolean {
  for (let node: ReturnType<typeof syntaxTree>["topNode"] | null = syntaxTree(context.state).resolveInner(context.pos, -1); node; node = node.parent) {
    if (/Code|URL|ATXHeading|SetextHeading/.test(node.name)) return true;
  }
  return false;
}

/** `#` → tags of the vault. */
function tagSource(context: CompletionContext): CompletionResult | null {
  const match = context.matchBefore(/(?:^|[\s([{])#[\p{L}\p{N}_\-/]*$/u);
  if (!match || inCode(context)) return null;
  const from = match.from + match.text.indexOf("#");
  const options = matching(editorHooks().completions().tags, context.state.sliceDoc(from + 1, context.pos), (path) => ({
    label: formatTag(path),
    type: "tag",
    apply: `${formatTag(path)} `,
  }));
  return options.length ? { from, options, filter: false } : null;
}

/** `[[` → note titles. */
function linkSource(context: CompletionContext): CompletionResult | null {
  const match = context.matchBefore(/\[\[[^\]\n|#]*$/);
  if (!match || inCode(context)) return null;
  const from = match.from + 2;
  const closed = context.state.sliceDoc(context.pos, context.pos + 2) === "]]";
  const options = matching(editorHooks().completions().titles, context.state.sliceDoc(from, context.pos), (title) => ({
    label: title,
    type: "note",
    apply: closed ? title : `${title}]]`,
  }));
  return options.length ? { from, options, filter: false } : null;
}

export function completions() {
  return autocompletion({
    override: [tagSource, linkSource],
    icons: false,
    activateOnTyping: true,
    closeOnBlur: true,
  });
}
