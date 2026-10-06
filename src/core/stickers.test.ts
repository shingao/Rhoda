import { describe, expect, it } from "vitest";
import { parseFrontmatter, patchFrontmatter } from "./note/frontmatter";
import { blockKey, blocksOf, cloneStickers, parseStickers, placementRotation, postitText, resolveAnchor, serializeStickers, type Sticker } from "./stickers";

const note = `# Mardi 2 octobre
#journal

Levé avant le jour. Café sur le rebord de la fenêtre.

J'ai repris les notes sur le voyage.

## Petites choses
- [ ] Rappeler Inès pour samedi
- [x] Rempoter le basilic

\`\`\`
code
\`\`\`

![](assets/a.png)
`.split("\n");

const postit = (text: string): Sticker => ({
  id: "p1",
  kind: "postit",
  text,
  color: "pink",
  anchor: { type: "paragraph", text: "levé avant le jour. café sur le rebord de la fenêtre.", index: 2 },
  dx: 104.5,
  dy: 14,
  rotation: -3,
  size: 148,
  z: 1001,
});

describe("blocks", () => {
  it("splits a note into anchorable blocks", () => {
    expect(blocksOf(note).map((b) => b.type)).toEqual(["heading", "paragraph", "paragraph", "paragraph", "heading", "list", "list", "code", "embed"]);
    expect(blockKey(blocksOf(note), 5)).toEqual({ type: "list", text: "rappeler inès pour samedi", index: 5 });
  });
});

describe("anchors", () => {
  const blocks = blocksOf(note);
  const key = blockKey(blocks, 6); // "Rempoter le basilic"

  it("finds the block again after insertions elsewhere", () => {
    const edited = ["Une ligne ajoutée en tête.", "", ...note];
    const b = blocksOf(edited);
    expect(b[resolveAnchor(key, b)]!.text).toContain("Rempoter le basilic");
  });

  it("follows a block whose text was edited (start kept), or takes its rank", () => {
    const edited = note.map((l) => (l.startsWith("- [x] Rempoter") ? "- [x] Rempoter le basilic et la menthe" : l));
    let b = blocksOf(edited);
    expect(b[resolveAnchor(key, b)]!.text).toContain("et la menthe");
    const renamed = note.map((l) => (l.startsWith("- [x] Rempoter") ? "- [x] Arroser les tomates" : l));
    b = blocksOf(renamed);
    expect(resolveAnchor(key, b)).toBe(6);
  });

  it("never loses a sticker: deleted block → nearest one, empty note → -1", () => {
    const shorter = note.slice(0, 3);
    const b = blocksOf(shorter);
    expect(resolveAnchor(key, b)).toBe(b.length - 1);
    expect(resolveAnchor(key, [])).toBe(-1);
  });
});

describe("frontmatter", () => {
  it("round-trips post-it text with quotes, colons, line breaks and emoji", () => {
    const tricky = 'Samedi : marché d\'Aligre "10 h"\n- pas un tiret de liste\n# ni un titre\nfin 🐻 — ok: oui';
    const fm = patchFrontmatter("id: x\n", { stickers: serializeStickers([postit(tricky)]) })!;
    const back = parseStickers(parseFrontmatter(fm).stickers);
    expect(back).toEqual([postit(tricky)]);
    // Still valid, readable YAML.
    expect(fm.startsWith("id: x\nstickers:\n")).toBe(true);
  });

  it("drops malformed entries and brings numbers in range", () => {
    const parsed = parseStickers([{ type: "sticker" }, { type: "sticker", asset: "fluent/2615", size: 9999, rotation: "x", dx: 50 }, "nope"]);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({ asset: "fluent/2615", size: 200, rotation: 0, dx: 50 });
    expect(parseStickers(undefined)).toEqual([]);
  });

  it("removes the key when there is no sticker left", () => {
    expect(serializeStickers([])).toBeUndefined();
  });
});

describe("helpers", () => {
  it("clones with new ids and gives post-it text to the search", () => {
    let n = 0;
    const copy = cloneStickers([postit("a"), { ...postit("b"), id: "p2" }], () => `new-${++n}`);
    expect(copy.map((s) => s.id)).toEqual(["new-1", "new-2"]);
    expect(postitText(copy)).toBe("a\nb");
  });

  it("rotates within ±8° (stickers) and ±3° (post-its)", () => {
    expect(placementRotation("sticker", () => 1)).toBe(8);
    expect(placementRotation("postit", () => 0)).toBe(-3);
  });
});
