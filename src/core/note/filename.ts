/** File names derived from note titles, valid on Windows. */

/** Longest stem Ursa produces. The backend shortens it further if the full path would exceed MAX_PATH. */
export const MAX_STEM_LENGTH = 120;

// eslint-disable-next-line no-control-regex
const FORBIDDEN = /[<>:"/\\|?*\u0000-\u001f\u007f]/g;
/** Windows device names, reserved even when followed by an extension (`CON.txt`). */
const RESERVED = /^(con|prn|aux|nul|conin\$|conout\$|com[0-9¹²³]|lpt[0-9¹²³])$/i;

/** Cuts to `max` UTF-16 units (Windows counts paths in UTF-16) without splitting a surrogate pair. */
function truncateUtf16(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const last = cut.charCodeAt(cut.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
}

/**
 * Turns a note title into a file name stem:
 * forbidden and control characters become spaces, whitespace collapses,
 * leading dots and trailing dots/spaces go, reserved device names get a "_",
 * and the result is capped at `maxLength`. Empty → `fallback`.
 */
export function sanitizeStem(title: string, fallback: string, maxLength = MAX_STEM_LENGTH): string {
  let stem = title
    .normalize("NFC")
    .replace(FORBIDDEN, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[.\s]+/, "");
  stem = truncateUtf16(stem, maxLength).replace(/[.\s]+$/, "");
  if (!stem) return fallback;
  const dot = stem.indexOf(".");
  const base = dot < 0 ? stem : stem.slice(0, dot);
  if (RESERVED.test(base.trimEnd())) stem = `${base.trimEnd()}_${dot < 0 ? "" : stem.slice(dot)}`;
  return stem;
}

export function stemOf(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  return name.replace(/\.md$/i, "");
}
