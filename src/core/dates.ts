const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function startOfDay(t: number): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

const weekday = new Intl.DateTimeFormat("en-US", { weekday: "short" });
const monthDay = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
const monthDayYear = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });

/** Relative date as specified in DESIGN.md §2.4. */
export function formatRelative(time: number, now: number = Date.now()): string {
  const diff = now - time;
  if (diff < MINUTE) return "just now";
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)} min ago`;
  const today = startOfDay(now);
  if (time >= today) return `${Math.floor(diff / HOUR)} h ago`;
  if (time >= today - DAY) return "Yesterday";
  if (time >= today - 6 * DAY) return weekday.format(time);
  if (new Date(time).getFullYear() === new Date(now).getFullYear()) return monthDay.format(time);
  return monthDayYear.format(time);
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
