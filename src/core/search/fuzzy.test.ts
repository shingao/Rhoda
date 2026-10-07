import { describe, expect, it } from "vitest";
import { fuzzyMatch } from "./fuzzy";

const rank = (query: string, items: string[]) =>
  items
    .map((text) => ({ text, m: fuzzyMatch(query, text) }))
    .filter((x) => x.m)
    .sort((a, b) => b.m!.score - a.m!.score)
    .map((x) => x.text);

describe("palette fuzzy search", () => {
  it("finds the letters in order, ignoring case and accents", () => {
    expect(fuzzyMatch("expn", "Exporter la note…")).not.toBeNull();
    expect(fuzzyMatch("ete", "Été à Kyoto")).not.toBeNull();
    expect(fuzzyMatch("REGLAGES", "Réglages")).not.toBeNull();
    expect(fuzzyMatch("oeuvre", "Œuvre complète")).not.toBeNull();
    expect(fuzzyMatch("xyz", "Exporter la note…")).toBeNull();
    expect(fuzzyMatch("ne", "En")).toBeNull();
  });

  it("ranks prefixes and word starts first", () => {
    const items = ["Mode focus", "Nouvelle note", "Rechercher dans les notes", "Exporter la note…"];
    expect(rank("no", items)[0]).toBe("Nouvelle note");
    expect(rank("exp", items)[0]).toBe("Exporter la note…");
    expect(rank("focus", ["Isoler la section", "Mode focus", "Mode focus (seconde touche)"])[0]).toBe("Mode focus");
  });

  it("gives the matched characters of the original text", () => {
    expect(fuzzyMatch("reg", "Réglages")!.ranges).toEqual([[0, 3]]);
    expect(fuzzyMatch("nn", "Nouvelle note")!.ranges).toEqual([
      [0, 1],
      [9, 10],
    ]);
    expect(fuzzyMatch("", "Tout")).toEqual({ score: 0, ranges: [] });
  });
});
