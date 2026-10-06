import { describe, expect, it } from "vitest";
import { noteFromFile, type Note } from "../note/note";
import { parseQuery, tokenize } from "./query";
import { invalidateTextSources, registerTextSource, searchNotes, snippet } from "./search";
import { postitText } from "../stickers";

const NOW = new Date(2026, 9, 2, 15).getTime();
let clock = 0;
function note(content: string, opts: Partial<Pick<Note, "mtime" | "archived" | "pinned">> = {}): Note {
  const n = noteFromFile({ path: `${++clock}.md`, content, mtime: opts.mtime ?? NOW - clock * 60_000, created: 0 }, `n${clock}`);
  return { ...n, ...opts };
}
const titles = (notes: Note[]) => notes.map((n) => n.title);
const run = (notes: Note[], raw: string) => titles(searchNotes(notes, parseQuery(raw), NOW, (x) => x));

describe("query syntax", () => {
  it("tokenizes words, phrases, tags, operators and exclusions", () => {
    expect(tokenize('@todo #voyages/japon "chemin du philosophe" -nara -#travail kyoto').map((t) => [t.kind, t.value, t.negated])).toEqual([
      ["operator", "todo", false],
      ["tag", "voyages/japon", false],
      ["phrase", "chemin du philosophe", false],
      ["word", "nara", true],
      ["tag", "travail", true],
      ["word", "kyoto", false],
    ]);
    expect(parseQuery("@inconnu").include[0]!.text).toBe("@inconnu");
    // An operator being typed is not searched as a word.
    expect(parseQuery("@to").include).toEqual([]);
    expect(parseQuery('"Été à Nîmes" -Œuvre').text).toBe("Été à Nîmes");
  });
});

describe("search", () => {
  const voyage = note("---\nid: a\nsecret: kyoto\n---\n# Voyage à Kyoto\n#voyages/japon-2026\n\nLe chemin du Philosophe en été.\n- [ ] Réserver\n- [x] Vols\n");
  const budget = note("# Budget voyages 2026\n#finances\n\nRyokan à Kyoto : 410 €.\n");
  const kyotoTag = note("# Carnet\n#kyoto\n\nAdresses.\n");
  const oeuvre = note("# Lectures\n\nUne œuvre complète, sans accent nulle part.\n![scan](assets/a.png)\n", { archived: true });
  const done = note("# Courses\n- [x] Pain\n- [x] Lait\n", { pinned: true });
  const old = note("# Ancienne\nKyoto aussi, il y a longtemps.\n", { mtime: NOW - 400 * 86_400_000 });
  const all = [voyage, budget, kyotoTag, oeuvre, done, old];

  it("ignores case and accents, both ways", () => {
    expect(run(all, "ete")).toEqual(["Voyage à Kyoto"]);
    expect(run(all, "ÉTÉ")).toEqual(["Voyage à Kyoto"]);
    expect(run(all, "oeuvre")).toEqual(["Lectures"]);
    expect(run(all, "œuvre")).toEqual(["Lectures"]);
  });

  it("matches words at their start only", () => {
    expect(run(all, "plete")).toEqual([]);
    expect(run(all, "compl")).toEqual(["Lectures"]);
  });

  it("apostrophes (straight and typographic) and hyphens split words", () => {
    const words = [note("# Mots\nDe l'été et de l’hiver, un porte-monnaie, #voyages/japon-2026.\n")];
    expect(run(words, "ete")).toEqual(["Mots"]);
    expect(run(words, "hiver")).toEqual(["Mots"]);
    expect(run(words, "monnaie")).toEqual(["Mots"]);
    expect(run(words, "2026")).toEqual(["Mots"]);
    expect(snippet(words[0]!, parseQuery("ete"))!.text).toContain("l'été");
  });

  it("ranks title > tag > content, then the most recent", () => {
    expect(run(all, "kyoto")).toEqual(["Voyage à Kyoto", "Carnet", "Budget voyages 2026", "Ancienne"]);
  });

  it("never searches the frontmatter", () => {
    expect(run(all, "secret")).toEqual([]);
  });

  it("requires every word, supports exact phrases and exclusions", () => {
    expect(run(all, "kyoto ryokan")).toEqual(["Budget voyages 2026"]);
    expect(run(all, '"chemin du philosophe"')).toEqual(["Voyage à Kyoto"]);
    expect(run(all, '"philosophe du chemin"')).toEqual([]);
    expect(run(all, "kyoto -ryokan -#kyoto")).toEqual(["Voyage à Kyoto", "Ancienne"]);
  });

  it("filters by tag, a parent tag including its sub-tags, accents ignored", () => {
    expect(run(all, "#voyages")).toEqual(["Voyage à Kyoto"]);
    expect(run(all, "#Voyages/Japon-2026")).toEqual(["Voyage à Kyoto"]);
    expect(run(all, "#voyages/japon")).toEqual([]);
  });

  it("supports the operators", () => {
    expect(run(all, "@todo")).toEqual(["Voyage à Kyoto"]);
    // Notes without any task are not "done".
    expect(run(all, "@done")).toEqual(["Courses"]);
    expect(run(all, "@untagged")).toEqual(["Lectures", "Courses", "Ancienne"]);
    expect(run(all, "@pinned")).toEqual(["Courses"]);
    expect(run(all, "@today kyoto")).toEqual(["Voyage à Kyoto", "Carnet", "Budget voyages 2026"]);
    expect(run(all, "@images")).toEqual(["Lectures"]);
    // Images inserted by Ursa (width, paths with spaces) count too.
    const added = [note("# Collée\n![](assets/capture-2026-10-03-143200.png){width=420}\n"), note("# Glissée\n![](<assets/mon image.png>)\n")];
    expect(run(added, "@images")).toEqual(["Collée", "Glissée"]);
    expect(run(all, "@untagged -@pinned kyoto")).toEqual(["Ancienne"]);
  });

  it("gives a plain-text excerpt around the match, highlighted", () => {
    const s = snippet(budget, parseQuery("kyoto"))!;
    expect(s.text).toBe("Ryokan à Kyoto : 410 €.");
    expect(s.ranges.map(([a, b]) => s.text.slice(a, b))).toEqual(["Kyoto"]);
    // A match in the title only: the card keeps its preview.
    expect(snippet(kyotoTag, parseQuery("carnet"))).toBeNull();
    // Long lines are cut before the match.
    const long = note(`# L\n${"mot ".repeat(40)}cible finale`);
    const cut = snippet(long, parseQuery("cible"))!;
    expect(cut.text.startsWith("…")).toBe(true);
    expect(cut.ranges.map(([a, b]) => cut.text.slice(a, b))).toEqual(["cible"]);
  });

  it("indexes extra text sources (OCR later), with their name", () => {
    const scan = note("# Billets\n![](assets/jr.png)\n");
    const ocr = new Map([[scan.id, "SHINKANSEN 15 APR · KYOTO → NARA"]]);
    registerTextSource({ name: "ocr", text: (n) => ocr.get(n.id) ?? null });
    invalidateTextSources();
    expect(run([scan], "nara")).toEqual(["Billets"]);
    const s = snippet(scan, parseQuery("nara"))!;
    expect(s.source).toBe("ocr");
    expect(s.ranges.map(([a, b]) => s.text.slice(a, b))).toEqual(["NARA"]);
  });

  it("indexes post-it text from the frontmatter", () => {
    const decorated = note('---\nstickers:\n  - id: a\n    type: postit\n    text: |-\n      Samedi — marché d\'Aligre\n      avec Inès\n    anchor: { block: paragraph, text: "", index: 0 }\n---\n# Journal\nUne journée calme.\n');
    registerTextSource({ name: "postit", text: (n) => postitText(n.stickers) || null });
    invalidateTextSources();
    expect(run([decorated], "aligre ines")).toEqual(["Journal"]);
    const s = snippet(decorated, parseQuery("ines"))!;
    expect(s.source).toBe("postit");
  });
});
