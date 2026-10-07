/**
 * Lines of the error journal. Note text must never get in: only our own
 * messages, error names and the first line of their message (parsers put the
 * offending text on the next lines), code locations, and value types.
 * Paths inside the notes folder lose everything but their extension.
 */

const MAX_MESSAGE = 300;
const MAX_STACK_LINES = 8;

export interface LogContext {
  /** The open notes folder, hidden in every line. */
  vault: string | null;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Hides the notes folder and what follows it (a note's name is its title). */
export function scrub(text: string, ctx: LogContext): string {
  let out = text;
  if (ctx.vault) {
    const root = ctx.vault.replace(/[\\/]+$/, "");
    const flexible = escapeRe(root).replace(/\\\\|\//g, "[\\\\/]");
    // Up to the first file extension (paths may contain spaces), else to a delimiter.
    const rest = `[\\\\/](?:[^"'\`\\n)\\]]*?\\.[a-z0-9]{1,5}(?![a-z0-9])|[^"'\`\\n)\\]]*)`;
    out = out.replace(new RegExp(`${flexible}(?:${rest})?`, "gi"), (path) => {
      const ext = /\.[a-z0-9]{1,5}$/i.exec(path)?.[0] ?? "";
      return path.length > root.length ? `<vault>\\…${ext}` : "<vault>";
    });
  }
  return out;
}

const firstLine = (s: string) => {
  const line = s.split(/\r?\n/, 1)[0] ?? "";
  return line.length > MAX_MESSAGE ? `${line.slice(0, MAX_MESSAGE)}…` : line;
};

/** Stack frames only (`at f (file:line:col)`), never the message repeated on top. */
function frames(stack: string | undefined): string {
  if (!stack) return "";
  const lines = stack
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => /^at\s|@.*:\d+:\d+$/.test(l))
    // Same file names, shorter: no origin, no cache-busting query.
    .map((l) => l.replace(/[a-z][\w+.-]*:\/\/[^/\s)]+\//gi, "").replace(/\?v=\w+/g, ""))
    .slice(0, MAX_STACK_LINES);
  return lines.length ? ` | ${lines.join(" | ")}` : "";
}

/** One value: errors described, our own text kept, anything else reduced to its type. */
export function describe(value: unknown, ctx: LogContext, ownText = false): string {
  if (value instanceof Error) return scrub(`${value.name}: ${firstLine(value.message)}${frames(value.stack)}`, ctx);
  if (typeof value === "string") return ownText ? scrub(firstLine(value), ctx) : `<text ${value.length}>`;
  if (typeof value === "number" || typeof value === "boolean" || value == null) return String(value);
  if (typeof value === "object" && "message" in value && typeof value.message === "string") {
    // Backend errors: `{ kind, message }`.
    const kind = "kind" in value && typeof value.kind === "string" ? `${value.kind}: ` : "";
    return scrub(`${kind}${firstLine(value.message)}`, ctx);
  }
  return `<${typeof value}>`;
}

/**
 * A `console.error(...)` call as one line. The first argument is the message
 * written in the code ("[ursa] rename failed"); the others are values.
 */
export function logLine(args: readonly unknown[], ctx: LogContext): string {
  return args.map((a, i) => describe(a, ctx, i === 0)).join(" ");
}
