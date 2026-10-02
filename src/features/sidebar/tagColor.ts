/** Tag palette (maquette 06), from tokens.components.css. */
const TAG_COLORS = [
  "var(--tag-color-1)",
  "var(--tag-color-2)",
  "var(--tag-color-3)",
  "var(--tag-color-4)",
  "var(--tag-color-5)",
  "var(--tag-color-6)",
  "var(--tag-color-7)",
  "var(--tag-color-8)",
];

/** Colour of a tag's icon (1–8); undefined = default colour. */
export function tagColor(color: number | undefined): string | undefined {
  return color ? TAG_COLORS[color - 1] : undefined;
}

export const TAG_COLOR_COUNT = TAG_COLORS.length;
