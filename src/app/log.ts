import { logLine, type LogContext } from "../core/logText";
import { logApi, type LogLevel } from "../services/log";
import { getState } from "./store";

/** At most this many lines a minute: a loop of errors must not fill the journal. */
const PER_MINUTE = 60;

let installed = false;
let windowStart = 0;
let written = 0;
let skipped = 0;

function context(): LogContext {
  const { vault, settings } = getState();
  return { vault: vault.kind === "ready" ? vault.path : settings.vaultPath };
}

/** Writes one line to the journal; never throws, never logs its own failures. */
export function logEntry(level: LogLevel, source: string, args: readonly unknown[]): void {
  const now = Date.now();
  if (now - windowStart > 60_000) {
    if (skipped) void logApi.write("warn", "log", `${skipped} lines skipped`).catch(() => undefined);
    windowStart = now;
    written = 0;
    skipped = 0;
  }
  if (written >= PER_MINUTE) {
    skipped++;
    return;
  }
  written++;
  let line: string;
  try {
    line = logLine(args, context());
  } catch {
    line = "<unreadable>";
  }
  void logApi.write(level, source, line).catch(() => undefined);
}

/**
 * Sends `console.error` / `console.warn`, uncaught errors and unhandled
 * rejections to the journal (still shown in the console during development).
 */
export function connectLog(): void {
  if (installed) return;
  installed = true;
  for (const level of ["error", "warn"] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      original(...args);
      logEntry(level, "app", args);
    };
  }
  window.addEventListener("error", (e) => logEntry("error", "uncaught", [e.error instanceof Error ? e.error : `${e.message}`]));
  window.addEventListener("unhandledrejection", (e) => logEntry("error", "promise", ["[unhandled rejection]", e.reason]));
}
