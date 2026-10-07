import { describe, expect, it } from "vitest";
import { escapeHtml, renderHtml, safeHref, type HtmlOptions } from "./html";
import { headingSlug, parseDocument, plainText, withoutTags, type Block, type Inline } from "./model";

/** Runs of a paragraph or heading (fails the test for any other block). */
function runs(block: Block | undefined): Inline[] {
  if (block?.t !== "paragraph" && block?.t !== "heading") throw new Error(`not text: ${block?.t}`);
  return block.children;
}

const options = (over: Partial<HtmlOptions> = {}): HtmlOptions => ({
  image: (src) => ({ src: `data:${src}` }),
  wiki: () => null,
  labels: { done: "fait", todo: "à faire", pdf: "PDF" },
  ...over,
});

describe("export document", () => {
  it("reads blocks with the lines they start on", () => {
    const doc = parseDocument("# Titre\n\nUn paragraphe\nsur deux lignes.\n\n- [ ] tâche\n- [x] faite\n\n```js\nlet a = 1\n```\n\n---\n");
    expect(doc.map((b) => [b.t, b.line])).toEqual([
      ["heading", 1],
      ["paragraph", 3],
      ["list", 6],
      ["code", 9],
      ["rule", 13],
    ]);
    expect(plainText(runs(doc[1]))).toBe("Un paragraphe sur deux lignes.");
    const list = doc[2]!;
    expect(list.t === "list" && list.items.map((i) => [i.line, i.checked, plainText(runs(i.blocks[0]))])).toEqual([
      [6, false, "tâche"],
      [7, true, "faite"],
    ]);
    expect(doc[3]).toMatchObject({ lang: "js", text: "let a = 1" });
  });

  it("reads inline styles, links, wiki links, tags and underline", () => {
    const [p] = parseDocument("**gras** *it* ~~barré~~ ==surligné== `code` <u>souligné</u> [lien](https://a.b) [[Cible|alias]] #projet/kyoto");
    const kinds = runs(p).filter((c) => c.t !== "text").map((c) => c.t);
    expect(kinds).toEqual(["strong", "em", "strike", "highlight", "code", "underline", "link", "wiki", "tag"]);
  });

  it("keeps tags out of titles and quote marks out of text", () => {
    const [h, q] = parseDocument("# Titre #pas-un-tag\n\n> une\n> citation");
    expect(h).toMatchObject({ t: "heading", children: [{ t: "text", text: "Titre #pas-un-tag" }] });
    expect(q?.t === "quote" && plainText(runs(q.blocks[0]))).toBe("une citation");
  });

  it("splits embed lines out of paragraphs, as the editor does", () => {
    const doc = parseDocument("Avant\n![photo](assets/a.png){width=320}\n[devis.pdf](assets/devis.pdf)\nhttps://example.com/x\nAprès");
    expect(doc.map((b) => [b.t, b.line])).toEqual([
      ["paragraph", 1],
      ["image", 2],
      ["pdf", 3],
      ["url", 4],
      ["paragraph", 5],
    ]);
    expect(doc[1]).toMatchObject({ src: "assets/a.png", width: 320 });
  });

  it("reads tables with their alignment", () => {
    const [t] = parseDocument("| a | b | c |\n|:--|:-:|--:|\n| 1 | 2 | 3 |");
    expect(t).toMatchObject({ t: "table", align: ["left", "center", "right"] });
    expect(t!.t === "table" && t!.rows[0]!.map(plainText)).toEqual(["1", "2", "3"]);
  });

  it("removes tags on demand, with the spaces they leave", () => {
    const doc = withoutTags(parseDocument("Voyage #voyages au #japon Kyoto\n\n#seul"));
    expect(doc).toHaveLength(1);
    expect(plainText(runs(doc[0]))).toBe("Voyage au Kyoto");
  });

  it("keeps the note's blank lines between blocks, and only those", () => {
    const doc = parseDocument("## Titres\n# Un\n## Deux\n\nTexte\n- a\n\n  suite\n- b");
    expect(doc.map((b) => [b.t, b.gap ?? false])).toEqual([
      ["heading", false],
      ["heading", false],
      ["heading", false],
      ["paragraph", true],
      ["list", false],
    ]);
    const list = doc[4]!;
    expect(list.t === "list" && list.items[0]!.blocks.map((b) => b.gap ?? false)).toEqual([false, true]);
  });

  it("makes stable heading anchors", () => {
    expect(headingSlug("Jour 1 — Higashiyama")).toBe("h-jour-1-higashiyama");
    expect(headingSlug("Été à Kyōto")).toBe("h-ete-a-kyoto");
  });
});

describe("export HTML", () => {
  it("escapes everything, raw HTML included", () => {
    const html = renderHtml(parseDocument('<script>alert("x")</script>\n\nTexte <b>gras</b> & "guillemets"'), options());
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<b>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&amp; &quot;guillemets&quot;");
  });

  it("keeps only links that work in a standalone file", () => {
    expect(safeHref("https://a.b")).toBe("https://a.b");
    expect(safeHref("javascript:alert(1)")).toBeNull();
    expect(safeHref("assets/x.pdf")).toBeNull();
    const html = renderHtml(parseDocument("[web](https://a.b) [js](javascript:x)"), options());
    expect(html).toContain('<a href="https://a.b">web</a>');
    expect(html).toContain('<span class="u-link-text">js</span>');
  });

  it("renders tasks, highlights and tags", () => {
    const html = renderHtml(parseDocument("- [x] ==fait== #todo\n- [ ] reste"), options());
    expect(html).toContain('<li class="u-task u-done" data-line="1"><input type="checkbox" disabled checked aria-label="fait">');
    expect(html).toContain("<mark>fait</mark>");
    expect(html).toContain('<span class="u-tag">#todo</span>');
    expect(html).toContain('<input type="checkbox" disabled aria-label="à faire">');
  });

  it("links wiki links to headings of the note or to exported notes, else text", () => {
    const html = renderHtml(parseDocument("# Jour 1\n\n[[#Jour 1]] [[Autre note]] [[Absente|ailleurs]]"), options({ wiki: (t) => (t === "Autre note" ? "Autre note.html" : null) }));
    expect(html).toContain('<h1 id="h-jour-1" data-line="1">Jour 1</h1>');
    expect(html).toContain('<a class="u-wiki" href="#h-jour-1">Jour 1</a>');
    expect(html).toContain('<a class="u-wiki" href="Autre note.html">Autre note</a>');
    expect(html).toContain('<span class="u-wiki">ailleurs</span>');
  });

  it("gives duplicate headings distinct anchors", () => {
    const html = renderHtml(parseDocument("## Notes\n\n## Notes"), options());
    expect(html).toContain('id="h-notes"');
    expect(html).toContain('id="h-notes-2"');
  });

  it("includes images through the resolver, or their text", () => {
    const doc = parseDocument("![photo](assets/a.png){width=300}\n\n![absente](https://x/y.png)");
    const html = renderHtml(doc, options({ image: (src) => (src.startsWith("assets/") ? { src: "data:image/png;base64,AA" } : null) }));
    expect(html).toContain('<figure class="u-image" data-line="1"><img src="data:image/png;base64,AA" alt="photo" style="width:300px"></figure>');
    expect(html).toContain('<p class="u-missing" data-line="3" data-gap>absente</p>');
  });

  it("places stickers and post-its before their block, the rest at the end", () => {
    const html = renderHtml(parseDocument("Un\n\nDeux"), {
      ...options(),
      decorations: [
        { kind: "postit", line: 3, text: "A <b>\nB", color: "yellow", size: 160, rotation: -2, side: "right" },
        { kind: "sticker", line: 1, src: "data:s", size: 64, rotation: 5, side: "left", offset: 10 },
        { kind: "sticker", line: 9, src: "data:t", size: 64, rotation: 0, side: "right", offset: 0 },
      ],
    });
    const order = [...html.matchAll(/u-sticker|u-postit|<p /g)].map((m) => m[0]);
    expect(order).toEqual(["u-sticker", "<p ", "u-postit", "<p ", "u-sticker"]);
    expect(html).toContain("A &lt;b&gt;<br>B");
  });

  it("escapes attribute quotes", () => {
    expect(escapeHtml(`"'<>&`)).toBe("&quot;&#39;&lt;&gt;&amp;");
  });
});

describe("export Markdown", () => {
  it("finds the vault files a note links to, never in code", async () => {
    const { linkedFiles } = await import("./markdown");
    const body = "![a](assets/a.png){width=300}\n[devis](<../assets/devis 2.pdf>)\n`![b](assets/b.png)`\n```\n![c](assets/c.png)\n```\n[web](https://x.y)";
    expect(linkedFiles("notes/n.md", body)).toEqual(["notes/assets/a.png", "assets/devis 2.pdf"]);
  });

  it("points links at the copies, keeping sizes and titles", async () => {
    const { rewriteLinks } = await import("./markdown");
    const copies = new Map([
      ["assets/a.png", "assets/a.png"],
      ["assets/devis 2.pdf", "assets/devis 2 (2).pdf"],
    ]);
    const body = '![a](../assets/a.png "titre"){width=300}\n[devis](<../assets/devis 2.pdf>)\n[absent](../assets/x.png)';
    expect(rewriteLinks("notes/n.md", body, copies)).toBe('![a](assets/a.png "titre"){width=300}\n[devis](<assets/devis 2 (2).pdf>)\n[absent](../assets/x.png)');
  });

  it("removes images but keeps code", async () => {
    const { removeImages } = await import("./markdown");
    expect(removeImages("Avant\n![a](assets/a.png){width=300}\nTexte ![logo](l.png) fin\n```\n![c](c.png)\n```")).toBe("Avant\nTexte logo fin\n```\n![c](c.png)\n```");
  });

  it("removes tags, not titles, code or colours", async () => {
    const { removeTags } = await import("./markdown");
    expect(removeTags("# Titre #pas\n\nVoyage #voyages au #japon Kyoto\n\n#seul\n\n`#code` et #FF0000")).toBe("# Titre #pas\n\nVoyage au Kyoto\n\n`#code` et #FF0000");
  });
});
