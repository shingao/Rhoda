/** File names derived from note titles, valid on Windows. */

const MAX_STEM = 120;
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
export const UNTITLED = "Untitled";

export function sanitizeStem(title: string): string {
  let stem = title
    // eslint-disable-next-line no-control-regex
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "");
  if (stem.length > MAX_STEM) stem = stem.slice(0, MAX_STEM);
  stem = stem.replace(/[. ]+$/, "");
  if (!stem) return UNTITLED;
  if (RESERVED.test(stem)) stem = `${stem}_`;
  return stem;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** True if `current` is `desired` or `desired (n)` (collision suffix). Case-sensitive, so a case-only title change still renames. */
export function stemMatches(current: string, desired: string): boolean {
  return new RegExp(`^${escapeRegExp(desired)}( \\(\\d+\\))?$`).test(current);
}

export function stemOf(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  return name.replace(/\.md$/i, "");
}
