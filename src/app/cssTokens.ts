/** Reads numeric design tokens from CSS so TS never duplicates their values. */

function raw(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export function cssPx(name: string): number {
  const value = parseFloat(raw(name));
  return Number.isFinite(value) ? value : 0;
}

export function cssMs(name: string): number {
  const v = raw(name);
  const n = parseFloat(v);
  if (!Number.isFinite(n)) return 0;
  return v.endsWith("ms") ? n : v.endsWith("s") ? n * 1000 : n;
}
