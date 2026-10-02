import type { SyntaxNodeRef } from "@lezer/common";
import { describe, expect, it } from "vitest";
import { ursaParser } from "./syntax";

/** Node names with their text, in document order, for the given types. */
function nodes(doc: string, ...types: string[]): string[] {
  const out: string[] = [];
  ursaParser.parse(doc).iterate({
    enter(n: SyntaxNodeRef) {
      if (types.includes(n.name)) out.push(`${n.name}:${doc.slice(n.from, n.to)}`);
    },
  });
  return out;
}

describe("highlight", () => {
  it("parses ==text==", () => {
    expect(nodes("a ==marked== b", "Highlight")).toEqual(["Highlight:==marked=="]);
    expect(nodes("a == b == c", "Highlight")).toEqual([]);
    expect(nodes("x === y", "Highlight")).toEqual([]);
  });

  it("nests with emphasis", () => {
    expect(nodes("==**bold mark**==", "Highlight", "StrongEmphasis")).toEqual([
      "Highlight:==**bold mark**==",
      "StrongEmphasis:**bold mark**",
    ]);
  });
});

describe("wiki links", () => {
  it("parses targets and aliases", () => {
    expect(nodes("see [[Voyage au Japon]].", "WikiLink", "WikiLinkTarget")).toEqual([
      "WikiLink:[[Voyage au Japon]]",
      "WikiLinkTarget:Voyage au Japon",
    ]);
    expect(nodes("[[Note|ce lien]]", "WikiLinkTarget", "WikiLinkAlias")).toEqual([
      "WikiLinkTarget:Note",
      "WikiLinkAlias:ce lien",
    ]);
  });

  it("ignores unclosed or empty links and does not break regular links", () => {
    expect(nodes("[[open", "WikiLink")).toEqual([]);
    expect(nodes("[[ ]]", "WikiLink")).toEqual([]);
    expect(nodes("[text](http://x.y)", "WikiLink", "Link")).toEqual(["Link:[text](http://x.y)"]);
  });
});

describe("tags", () => {
  it("parses simple, nested and multi-word tags", () => {
    expect(nodes("#idée et #voyages/japon-2026 et #liste de courses#.", "Tag")).toEqual([
      "Tag:#idée",
      "Tag:#voyages/japon-2026",
      "Tag:#liste de courses#",
    ]);
  });

  it("does not take headings, anchors, numbers or C#", () => {
    expect(nodes("# Titre", "Tag")).toEqual([]);
    expect(nodes("http://a.b/page#anchor", "Tag")).toEqual([]);
    expect(nodes("ticket #123", "Tag")).toEqual([]);
    expect(nodes("en C# ou F#", "Tag")).toEqual([]);
    expect(nodes("`#notatag`", "Tag")).toEqual([]);
  });

  it("finds tags inside headings and lists", () => {
    expect(nodes("## Plan #travail\n- item #todo", "Tag")).toEqual(["Tag:#travail", "Tag:#todo"]);
  });

  it("keeps a single-word tag when the hash pair has no space", () => {
    expect(nodes("#a and #b", "Tag")).toEqual(["Tag:#a", "Tag:#b"]);
  });
});

describe("GFM", () => {
  it("parses tasks, strikethrough and inline code containing stars", () => {
    expect(nodes("- [x] done\n- [ ] todo", "TaskMarker")).toEqual(["TaskMarker:[x]", "TaskMarker:[ ]"]);
    expect(nodes("~~gone~~", "Strikethrough")).toEqual(["Strikethrough:~~gone~~"]);
    expect(nodes("`a **b** c`", "InlineCode", "StrongEmphasis")).toEqual(["InlineCode:`a **b** c`"]);
  });
});
