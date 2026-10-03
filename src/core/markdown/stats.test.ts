import { describe, expect, it } from "vitest";
import { readableText, textStats, WORDS_PER_MINUTE } from "./stats";

describe("textStats", () => {
  it("counts words as a reader sees them", () => {
    expect(textStats("# Journal — 2 octobre\n\nLevé avant le jour.").words).toBe(7);
    // Apostrophes and hyphens join: one word each.
    expect(textStats("l'été, l’hiver, porte-monnaie, japon-2026").words).toBe(4);
    // Markers, link targets and URLs are not counted.
    expect(textStats("- [x] **Réserver** les [vols](https://example.com/vols) et [[Voyage au Japon|le voyage]]").words).toBe(6);
    expect(textStats("Voir https://example.com/une/longue/adresse ici").words).toBe(2);
    expect(textStats("```ts\nconst a = 1;\n```").words).toBe(3);
    expect(textStats("#voyages/japon-2026 et #idée").words).toBe(4);
    expect(textStats("> Une citation\n> sur deux lignes").words).toBe(5);
  });

  it("counts characters of the text, with and without spaces", () => {
    const s = textStats("## Titre\n\n**Gras** et _ital_");
    expect(readableText("## Titre").trim()).toBe("Titre");
    expect(s.characters).toBe("Titre\nGras et ital".length);
    expect(s.charactersNoSpaces).toBe("TitreGrasetital".length);
    // Emoji count as one character.
    expect(textStats("🐻").characters).toBe(1);
  });

  it("rounds the reading time up at 230 words per minute", () => {
    const words = (n: number) => Array.from({ length: n }, () => "mot").join(" ");
    expect(textStats("").readingMinutes).toBe(0);
    expect(textStats(words(1)).readingMinutes).toBe(1);
    expect(textStats(words(WORDS_PER_MINUTE)).readingMinutes).toBe(1);
    expect(textStats(words(WORDS_PER_MINUTE + 1)).readingMinutes).toBe(2);
  });
});
