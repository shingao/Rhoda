import { describe, expect, it } from "vitest";
import { contains, fold, foldWithMap, matchRanges } from "./fold";

describe("search folding", () => {
  it("ignores case, accents and ligatures", () => {
    expect(fold("Été à Nîmes")).toBe("ete a nimes");
    expect(fold("Œuvre, cœur, Æsop, Straße")).toBe("oeuvre, coeur, aesop, strasse");
    expect(fold("l’été")).toBe(fold("l'ete"));
    expect(fold("ﬁn")).toBe("fin");
  });

  it("fast and mapped folding agree, even with combining marks", () => {
    for (const s of ["Été", "Café crème", "Œuvre ﬁnale", "Ça 🐻 va ?", "İstanbul"]) {
      expect(foldWithMap(s).text).toBe(fold(s));
    }
  });

  it("maps folded offsets back to the original text", () => {
    const text = "Une œuvre d'été";
    const [[from, to]] = matchRanges(text, [{ text: "oeuvre", wordStart: true }]) as [[number, number]];
    expect(text.slice(from, to)).toBe("œuvre");
    expect(matchRanges(text, [{ text: "ete", wordStart: true }]).map(([a, b]) => text.slice(a, b))).toEqual(["été"]);
    expect(matchRanges("Café́", [{ text: "cafe", wordStart: false }]).map(([a, b]) => "Café́".slice(a, b))).toEqual(["Café́"]);
  });

  it("matches at word starts only when asked", () => {
    expect(contains(fold("complète"), "ete", true)).toBe(false);
    expect(contains(fold("complète"), "ete", false)).toBe(true);
    expect(contains(fold("un été"), "ete", true)).toBe(true);
    expect(contains(fold("#voyages/japon"), "japon", true)).toBe(true);
  });
});
