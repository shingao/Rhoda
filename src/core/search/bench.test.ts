import { describe, expect, it } from "vitest";
import { generateNotes } from "../../dev/generateNotes";
import { noteFromFile } from "../note/note";
import { withSyntax } from "../note/note";
import { parseQuery } from "./query";
import { searchNotes, snippet } from "./search";

/**
 * Budget: < 50 ms per keystroke with 1 000 notes [phase 5]. A keystroke =
 * parse the query, scan every note, rank, and build the excerpts of the
 * visible cards (the list shows about 20).
 */
describe("search performance (1 000 notes)", () => {
  const now = Date.now();
  const notes = generateNotes(1000, now).map((f) => withSyntax(noteFromFile({ ...f, created: f.mtime })));
  const size = notes.reduce((n, x) => n + x.body.length, 0);

  it("stays under 50 ms per keystroke", () => {
    const keystroke = (raw: string) => {
      const q = parseQuery(raw);
      const hits = searchNotes(notes, q, now, (x) => x);
      for (const n of hits.slice(0, 20)) snippet(n, q);
      return hits.length;
    };
    const t0 = performance.now();
    keystroke("v"); // first search builds the index
    const cold = performance.now() - t0;
    const typed = ["v", "vo", "voy", "voya", "voyag", "voyage", "voyage k", "voyage ky", "voyage kyo", "voyage kyoto", "@todo #voyages ete", '"marché train" -osaka', "oeuvre"];
    const times = typed.map((raw) => {
      const t = performance.now();
      keystroke(raw);
      return performance.now() - t;
    });
    const worst = Math.max(...times);
    const mean = times.reduce((a, b) => a + b, 0) / times.length;
    console.info(`[bench] ${notes.length} notes, ${(size / 1e6).toFixed(1)} M chars: index ${cold.toFixed(0)} ms, keystroke mean ${mean.toFixed(1)} ms, worst ${worst.toFixed(1)} ms`);
    expect(worst).toBeLessThan(50);
  });

  it("re-indexes only the note that changed", () => {
    const q = parseQuery("kyoto");
    searchNotes(notes, q, now, (x) => x);
    const changed = notes.slice();
    changed[500] = { ...changed[500]!, body: `${changed[500]!.body}\nkyotonouveau`, title: changed[500]!.title };
    const t = performance.now();
    searchNotes(changed, q, now, (x) => x);
    expect(performance.now() - t).toBeLessThan(50);
  });
});
