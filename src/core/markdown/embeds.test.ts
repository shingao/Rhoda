import { describe, expect, it } from "vitest";
import { embedLines, imageMarkdown, parseEmbedLine, relativeSrc, resolveVaultPath } from "./embeds";

describe("parseEmbedLine", () => {
  it("recognises an image alone on its line, with its width", () => {
    expect(parseEmbedLine("![Plan](assets/plan.png){width=560}")).toEqual({ kind: "image", alt: "Plan", src: "assets/plan.png", width: 560, attrFrom: 24, attrTo: 35 });
    expect(parseEmbedLine("![](assets/a.png)")).toMatchObject({ kind: "image", width: null, attrFrom: 17, attrTo: 17 });
    expect(parseEmbedLine("![](<assets/mon image.png> \"titre\")")).toMatchObject({ kind: "image", src: "assets/mon image.png" });
    expect(parseEmbedLine("![](assets/mon%20image.png)")).toMatchObject({ src: "assets/mon%20image.png" });
    // Not alone: stays inline text.
    expect(parseEmbedLine("Voir ![](a.png) ici")).toBeNull();
    expect(parseEmbedLine("![](a.png) suite")).toBeNull();
  });

  it("recognises PDF links and bare URLs", () => {
    expect(parseEmbedLine("[Devis 2026.pdf](<assets/Devis 2026.pdf>)")).toEqual({ kind: "pdf", label: "Devis 2026.pdf", src: "assets/Devis 2026.pdf" });
    expect(parseEmbedLine("[notes](assets/notes.txt)")).toBeNull();
    expect(parseEmbedLine("https://example.com/article?id=3")).toEqual({ kind: "url", url: "https://example.com/article?id=3" });
    expect(parseEmbedLine("  <https://example.com>  ")).toEqual({ kind: "url", url: "https://example.com" });
    expect(parseEmbedLine("Lire https://example.com")).toBeNull();
    expect(parseEmbedLine("ftp://example.com")).toBeNull();
  });
});

describe("paths", () => {
  it("resolves destinations relative to the note, never outside the vault", () => {
    expect(resolveVaultPath("Voyage.md", "assets/a.png")).toBe("assets/a.png");
    expect(resolveVaultPath("projets/Ursa.md", "../assets/a%20b.png")).toBe("assets/a b.png");
    expect(resolveVaultPath("Voyage.md", "./img/x.png?v=2")).toBe("img/x.png");
    expect(resolveVaultPath("Voyage.md", "../secret.png")).toBeNull();
    expect(resolveVaultPath("Voyage.md", "https://example.com/a.png")).toBeNull();
    expect(resolveVaultPath("Voyage.md", "C:/Users/a.png")).toBeNull();
    expect(resolveVaultPath("Voyage.md", "/etc/a.png")).toBeNull();
  });

  it("writes relative destinations, with <> when needed", () => {
    expect(relativeSrc("Voyage.md", "assets/a.png")).toBe("assets/a.png");
    expect(relativeSrc("projets/ursa/Note.md", "assets/a.png")).toBe("../../assets/a.png");
    expect(relativeSrc("Voyage.md", "assets/mon image.png")).toBe("<assets/mon image.png>");
    expect(imageMarkdown("", "assets/a.png", 400)).toBe("![](assets/a.png){width=400}");
  });
});

describe("embedLines", () => {
  it("skips code blocks", () => {
    const lines = ["![](a.png)", "```", "![](b.png)", "```", "    ![](c.png)", "https://example.com", "~~~~", "https://x.org", "~~~~", "![](d.png)"];
    expect([...embedLines(lines).keys()]).toEqual([1, 6, 10]);
  });
});
