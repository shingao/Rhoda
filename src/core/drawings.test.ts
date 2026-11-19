import { describe, expect, it } from "vitest";
import { drawingIdOf, drawingText, drawingsIn, isDrawingId, isDrawingSrc, replaceDrawingIds } from "./drawings";

describe("drawings", () => {
  it("knows a drawing's picture by its path", () => {
    expect(drawingIdOf("assets/dessins/01abc-9.svg")).toBe("01abc-9");
    expect([drawingIdOf("assets/dessins/a.png"), drawingIdOf("assets/a.svg"), drawingIdOf("assets/dessins/../x.svg")]).toEqual([null, null, null]);
    expect([isDrawingId("01abc_9"), isDrawingId("../x"), isDrawingId("")]).toEqual([true, false, false]);
    expect([isDrawingSrc("assets/dessins/a1.svg"), isDrawingSrc("../assets/dessins/a1.svg?v=2"), isDrawingSrc("assets/a1.svg")]).toEqual([true, true, false]);
  });

  it("finds the drawings of a note, relative to its folder", () => {
    const body = "![Dessin](assets/dessins/a1.svg)\n\n![Photo](assets/p.png)\n![Dessin](../assets/dessins/b2.svg){width=300}";
    expect(drawingsIn("Note.md", body)).toEqual(["a1"]);
    expect(drawingsIn("Projets/Note.md", body)).toEqual(["b2"]);
  });

  it("reads the text written in a drawing, never deleted or empty texts", () => {
    const scene = JSON.stringify({
      type: "excalidraw",
      elements: [
        { type: "rectangle" },
        { type: "text", text: "Cuisine", originalText: "Cuisine" },
        { type: "text", text: "Plan du\nsalon", originalText: "Plan du salon" },
        { type: "text", text: "effacé", isDeleted: true },
        { type: "text", text: "  " },
      ],
    });
    expect(drawingText(scene)).toBe("Cuisine\nPlan du salon");
    expect([drawingText("pas du json"), drawingText("{}")]).toEqual(["", ""]);
  });

  it("points a copied note to its copied drawings", () => {
    const body = "![Dessin](assets/dessins/a1.svg) ![Dessin](assets/dessins/a1.svg) ![Dessin](assets/dessins/zz.svg)";
    expect(replaceDrawingIds(body, new Map([["a1", "n1"]]))).toBe("![Dessin](assets/dessins/n1.svg) ![Dessin](assets/dessins/n1.svg) ![Dessin](assets/dessins/zz.svg)");
  });
});
