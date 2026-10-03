/** File size for people: `840 o`, `12 Ko`, `1,4 Mo` (French) / `840 B`, `12 KB`, `1.4 MB` (English). */
export function formatBytes(bytes: number, locale: string, units: readonly [string, string, string, string]): string {
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  const digits = unit === 0 || value >= 10 ? 0 : 1;
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(value)} ${units[unit]}`;
}
