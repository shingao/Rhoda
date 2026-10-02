import { describe, expect, it } from "vitest";
import { applyChanges, tagRemoveChanges, tagRenameChanges, wikiLinkRenameChanges } from "../rewrite";
import { buildTagIndex, cleanTagName, formatTag } from "../tags";
import { extractSyntax, tagKey, titleKey } from "./extract";

const tagNames = (body: string) => extractSyntax(body).tags.map((t) => t.name);

describe("tags: what is a tag", () => {
  it("accepts accents, digits and nesting", () => {
    expect(tagNames("#été #japon-2026 #voyages/japon-2026 #Idée_1")).toEqual(["été", "japon-2026", "voyages/japon-2026", "Idée_1"]);
    expect(tagNames("#liste de courses# et #a")).toEqual(["liste de courses", "a"]);
    // Prose between a tag and a later "C#" is not a multi-word tag.
    expect(tagNames("(#Idée = #idée) — mais pas C#, ni #FFF")).toEqual(["Idée", "idée"]);
    expect(tagNames("#l'été en famille#")).toEqual(["l'été en famille"]);
  });

  it("ignores titles", () => {
    expect(tagNames("# Titre")).toEqual([]);
    expect(tagNames("## Titre avec #tag")).toEqual([]);
    expect(tagNames("Titre #tag\n===")).toEqual([]);
    expect(tagNames("#tag-en-tête\n\ntexte #ok")).toEqual(["tag-en-tête", "ok"]);
  });

  it("ignores code blocks and inline code", () => {
    expect(tagNames("```\n#nope\n```\n`#nope` et    #oui")).toEqual(["oui"]);
    expect(tagNames("    #indented-code")).toEqual([]);
  });

  it("ignores URLs and anchors", () => {
    expect(tagNames("https://site.fr/page#ancre et https://site.fr/#ancre et <https://x.fr/#a>")).toEqual([]);
    expect(tagNames("[lien](https://site.fr/#ancre)")).toEqual([]);
  });

  it("ignores hex colours but keeps hex-looking words", () => {
    expect(tagNames("#FFF #E0654A #e0654a #FFFFFF80 #abc1")).toEqual([]);
    expect(tagNames("#cafe #bed #Face")).toEqual(["cafe", "bed", "Face"]);
  });

  it("ignores # inside words and numbers", () => {
    expect(tagNames("C# F# n°#3 ticket #123 a#b")).toEqual([]);
  });

  it("stops at punctuation", () => {
    expect(tagNames("(#idée), #fin. #a/b/")).toEqual(["idée", "fin", "a/b"]);
  });
});

describe("tags: index", () => {
  const note = (id: string, created: number, body: string) => ({ id, created, tags: extractSyntax(body).tags });

  it("is case-insensitive and keeps the first spelling", () => {
    const idx = buildTagIndex([note("b", 2, "#voyage"), note("a", 1, "#Voyage")]);
    expect(idx.roots.map((r) => r.label)).toEqual(["Voyage"]);
    expect(idx.byKey.get("voyage")!.noteIds.size).toBe(2);
    expect(tagKey("ÉTÉ")).toBe("été");
  });

  it("counts children's notes in the parent", () => {
    const idx = buildTagIndex([note("1", 1, "#voyages/japon"), note("2", 2, "#voyages/lisbonne"), note("3", 3, "#voyages #voyages/japon")]);
    const voyages = idx.byKey.get("voyages")!;
    expect(voyages.noteIds.size).toBe(3);
    expect(voyages.children.map((c) => [c.label, c.noteIds.size])).toEqual([
      ["japon", 2],
      ["lisbonne", 1],
    ]);
  });

  it("formats and cleans names", () => {
    expect(formatTag("a b")).toBe("#a b#");
    expect(cleanTagName(" #voyages / japon ")).toBe("voyages/japon");
  });
});

describe("todos and wiki links", () => {
  it("counts todos", () => {
    expect(extractSyntax("- [x] a\n- [ ] b\n  - [X] c\n- d").todos).toEqual({ done: 2, total: 3 });
  });

  it("reads targets, anchors and aliases", () => {
    const [a, b] = extractSyntax("[[Voyage]] et [[Voyage au Japon#Itinéraire|le plan]]").links;
    expect(a).toMatchObject({ target: "Voyage", anchor: null, alias: null });
    expect(b).toMatchObject({ target: "Voyage au Japon", anchor: "Itinéraire", alias: "le plan" });
    expect(titleKey("  Voyage  au JAPON ")).toBe("voyage au japon");
  });
});

describe("rewriting", () => {
  it("renames wiki links, keeping anchors and aliases, ignoring code", () => {
    const body = "[[Old]] [[old#Part|text]] [[Older]] `[[Old]]`";
    expect(applyChanges(body, wikiLinkRenameChanges(body, "Old", "New name"))).toBe("[[New name]] [[New name#Part|text]] [[Older]] `[[Old]]`");
  });

  it("renames a tag and its children, any case", () => {
    const body = "#Voyages et #voyages/Japon, pas #voyagesbis ni `#voyages`";
    expect(applyChanges(body, tagRenameChanges(body, "voyages", "trips"))).toBe("#trips et #trips/Japon, pas #voyagesbis ni `#voyages`");
    expect(applyChanges("#a/b", tagRenameChanges("#a/b", "a", "deux mots"))).toBe("#deux mots/b#");
  });

  it("removes a tag cleanly, including tag-only lines", () => {
    const body = "# Titre\n#voyages #projets\n\nTexte #voyages/japon fin.\n#voyages";
    expect(applyChanges(body, tagRemoveChanges(body, "voyages"))).toBe("# Titre\n#projets\n\nTexte fin.\n");
    const only = "# T\n#a\nsuite";
    expect(applyChanges(only, tagRemoveChanges(only, "a"))).toBe("# T\nsuite");
  });
});
