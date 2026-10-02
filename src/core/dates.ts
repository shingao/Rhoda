const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function startOfDay(t: number): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Locale-specific words for relative dates (provided by the i18n catalogues). */
export interface RelativeDateLabels {
  /** BCP 47 locale for weekday and month names, e.g. "fr-FR". */
  locale: string;
  justNow: string;
  minutesAgo: (n: number) => string;
  hoursAgo: (n: number) => string;
  yesterday: string;
}

const formatters = new Map<string, { weekday: Intl.DateTimeFormat; monthDay: Intl.DateTimeFormat; monthDayYear: Intl.DateTimeFormat }>();

function formattersFor(locale: string) {
  let f = formatters.get(locale);
  if (!f) {
    f = {
      weekday: new Intl.DateTimeFormat(locale, { weekday: "short" }),
      monthDay: new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" }),
      monthDayYear: new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", year: "numeric" }),
    };
    formatters.set(locale, f);
  }
  return f;
}

export type RelativeKind = "justNow" | "minutes" | "hours" | "yesterday" | "weekday" | "date";

/** Relative date following the rules of DESIGN.md §2.4, with its kind (for phrasing around it). */
export function relativeDate(time: number, now: number, labels: RelativeDateLabels): { kind: RelativeKind; text: string } {
  const diff = now - time;
  if (diff < MINUTE) return { kind: "justNow", text: labels.justNow };
  if (diff < HOUR) return { kind: "minutes", text: labels.minutesAgo(Math.floor(diff / MINUTE)) };
  const today = startOfDay(now);
  if (time >= today) return { kind: "hours", text: labels.hoursAgo(Math.floor(diff / HOUR)) };
  if (time >= today - DAY) return { kind: "yesterday", text: labels.yesterday };
  const f = formattersFor(labels.locale);
  if (time >= today - 6 * DAY) return { kind: "weekday", text: f.weekday.format(time) };
  if (new Date(time).getFullYear() === new Date(now).getFullYear()) return { kind: "date", text: f.monthDay.format(time) };
  return { kind: "date", text: f.monthDayYear.format(time) };
}

export function formatRelative(time: number, now: number, labels: RelativeDateLabels): string {
  return relativeDate(time, now, labels).text;
}

/** ISO 8601 with the local UTC offset, e.g. 2026-10-02T11:24:00+02:00. */
export function isoLocal(time: number = Date.now()): string {
  const d = new Date(time);
  const pad = (n: number) => String(Math.trunc(Math.abs(n))).padStart(2, "0");
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? "+" : "-";
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `${sign}${pad(off / 60)}:${pad(off % 60)}`
  );
}

/** Local date-time for file names, sortable as text: `2026-10-02_15-04-05`. */
export function fileStamp(time: number = Date.now()): string {
  const d = new Date(time);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
}
