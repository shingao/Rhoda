import { describe, expect, it } from "vitest";
import { coverOn, matchBoxes, ocrFiles, ocrParts, type OcrPageLike } from "./ocr";

const ticket: OcrPageLike = {
  width: 1000,
  height: 420,
  text: "SHINKANSEN 15 APR\nKYOTO → NARA",
  lines: [
    { words: [{ text: "SHINKANSEN", x: 83, y: 122, w: 420, h: 50 }, { text: "15", x: 520, y: 122, w: 60, h: 50 }, { text: "APR", x: 610, y: 122, w: 130, h: 50 }] },
    { words: [{ text: "KYOTO", x: 83, y: 198, w: 165, h: 40 }, { text: "→", x: 268, y: 198, w: 50, h: 40 }, { text: "NARA", x: 320, y: 198, w: 138, h: 40 }] },
  ],
};

describe("OCR results", () => {
  it("lists the images and PDFs of a note (not SVG, not remote)", () => {
    const body = "![](assets/a.png)\n![](assets/s.svg)\n[devis](assets/devis.pdf)\n![](https://x.org/b.png)\n![](../../outside.jpg)";
    expect(ocrFiles("n.md", body).sort()).toEqual(["assets/a.png", "assets/devis.pdf"]);
  });

  it("indexes one part per page, with its page number", () => {
    expect(ocrParts("assets/d.pdf", [{ ...ticket, page: 2 }, { ...ticket, page: 3, text: " " }])).toEqual([{ text: ticket.text, file: "assets/d.pdf", page: 2 }]);
    expect(ocrParts("assets/t.png", [ticket])).toEqual([{ text: ticket.text, file: "assets/t.png" }]);
  });

  it("finds the zone of a word or a phrase, case and accent insensitive", () => {
    expect(matchBoxes(ticket, ["kyoto"])).toEqual([{ x: 83, y: 198, w: 165, h: 40 }]);
    expect(matchBoxes(ticket, ["kyo"])).toEqual([{ x: 83, y: 198, w: 165, h: 40 }]);
    expect(matchBoxes(ticket, ["15 apr"])).toEqual([{ x: 520, y: 122, w: 220, h: 50 }]);
    expect(matchBoxes(ticket, ["nara", "shinkansen"]).map((b) => b.x)).toEqual([83, 320]);
    expect(matchBoxes(ticket, ["osaka"])).toEqual([]);
  });

  it("frames a square thumbnail on the zone", () => {
    // 1000×420, KYOTO at x 83–248: the square starts at the left edge.
    const kyoto = coverOn({ x: 83, y: 198, w: 165, h: 40 }, { width: 1000, height: 420 });
    expect(kyoto.position).toEqual({ x: 0, y: 50 });
    expect(kyoto.box.x).toBeCloseTo((83 / 420) * 100);
    expect(kyoto.box.w).toBeCloseTo((165 / 420) * 100);
    // A word in the middle: the square is centred on it.
    const mid = coverOn({ x: 480, y: 100, w: 40, h: 20 }, { width: 1000, height: 420 });
    expect(mid.position.x).toBeCloseTo(((500 - 210) / 580) * 100);
    expect(mid.box.x).toBeCloseTo((190 / 420) * 100);
  });
});
