// Block alignment — `npm run test:align`.
// In a real browser (in-memory vault), on a new note:
// 1. Ctrl+Shift+2 centres the paragraph (AZERTY: the physical key of "é"/"2"),
//    Ctrl+Z undoes it with the text's history, Ctrl+Shift+3 / 4 / 1;
// 2. right-click in a paragraph opens the block menu; in a code block, or over
//    a selection, the system menu is left alone;
// 3. a sticker in the right margin never covers right-aligned text;
// 4. saved in the frontmatter (`align:`), back after reopening the note.
// Needs Chromium for Playwright.
import { chromium } from "playwright";
import { createServer } from "vite";

const server = await createServer({ server: { port: 0, strictPort: false }, logLevel: "error" });
await server.listen();
const url = server.resolvedUrls.local[0];
const browser = await chromium.launch();
let failures = 0;
const check = (ok, label, detail = "") => {
  if (ok) console.log(`✓ ${label}${detail ? ` (${detail})` : ""}`);
  else {
    failures++;
    console.error(`✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
};

const BODY = "# Titre\n\nUn paragraphe assez long pour occuper plusieurs lignes de la colonne, aligné à droite pendant le test des stickers.\n\n```\ndu code\n```\n\nFin.";

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: "fr-FR" });
  page.on("pageerror", (e) => check(false, "erreur de la page", e.message));
  await page.goto(url);
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem("ursa-dev-settings", JSON.stringify({ welcomed: true }));
  });
  await page.reload();
  await page.waitForFunction(() => window.__ursaView !== undefined);
  await page.waitForTimeout(600);
  const noteId = await page.evaluate(async (body) => {
    const { createNote } = await import("/src/app/notes.ts");
    await createNote();
    const v = window.__ursaView;
    v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: body } });
    const { useApp } = await import("/src/app/store.ts");
    return useApp.getState().selectedId;
  }, BODY);
  const paragraphLine = 3;
  const lineAlign = (n) =>
    page.evaluate((n) => {
      const v = window.__ursaView;
      const el = v.domAtPos(v.state.doc.line(n).from).node;
      const line = (el.nodeType === 1 ? el : el.parentElement).closest(".cm-line");
      return getComputedStyle(line).textAlign;
    }, n);
  const place = (n) =>
    page.evaluate((n) => {
      const v = window.__ursaView;
      v.focus();
      v.dispatch({ selection: { anchor: v.state.doc.line(n).from + 3 } });
    }, n);

  // 1. Shortcuts, by physical key (what an AZERTY keyboard sends for Ctrl+Shift+2: key "2", code Digit2).
  await place(paragraphLine);
  await page.keyboard.press("Control+Shift+Digit2");
  check((await lineAlign(paragraphLine)) === "center", "Ctrl+Maj+2 : paragraphe centré");
  await page.keyboard.press("Control+z");
  check((await lineAlign(paragraphLine)) === "start" || (await lineAlign(paragraphLine)) === "left", "Ctrl+Z : de retour à gauche", await lineAlign(paragraphLine));
  await page.keyboard.press("Control+Shift+Digit4");
  check((await lineAlign(paragraphLine)) === "justify", "Ctrl+Maj+4 : justifié");
  await page.keyboard.press("Control+Shift+Digit1");
  check(["start", "left"].includes(await lineAlign(paragraphLine)), "Ctrl+Maj+1 : à gauche");
  await place(6);
  await page.keyboard.press("Control+Shift+Digit2");
  check(["start", "left"].includes(await lineAlign(6)), "bloc de code : jamais aligné");

  // 2. Right-click: the block menu in a paragraph.
  const point = (n) =>
    page.evaluate((n) => {
      const v = window.__ursaView;
      const c = v.coordsAtPos(v.state.doc.line(n).from + 5);
      return { x: c.left, y: (c.top + c.bottom) / 2 };
    }, n);
  let at = await point(paragraphLine);
  await page.mouse.click(at.x, at.y, { button: "right" });
  await page.waitForTimeout(200);
  const menu = await page.evaluate(() => [...document.querySelectorAll('[role="menu"] [role^="menuitem"]')].map((e) => e.textContent));
  check(menu.length === 4 && menu.some((t) => t.includes("Centrer")), "clic droit : menu du bloc", menu.join(" · "));
  await page.getByRole("menuitemradio", { name: /Aligner à droite/ }).click();
  await page.waitForTimeout(150);
  check((await lineAlign(paragraphLine)) === "right", "menu du bloc : aligné à droite");

  // In a code block, and over a selection: no block menu (the system one opens).
  const prevented = (n, select) =>
    page.evaluate(
      ([n, select]) => {
        const v = window.__ursaView;
        const line = v.state.doc.line(n);
        if (select) v.dispatch({ selection: { anchor: line.from, head: line.to } });
        const c = v.coordsAtPos(line.from + 1);
        const target = document.elementFromPoint(c.left + 1, (c.top + c.bottom) / 2);
        const e = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2, clientX: c.left + 1, clientY: (c.top + c.bottom) / 2 });
        target.dispatchEvent(e);
        return e.defaultPrevented;
      },
      [n, select],
    );
  await page.keyboard.press("Escape");
  check(!(await prevented(6, false)), "clic droit dans le code : menu système");
  check(!(await prevented(paragraphLine, true)), "clic droit sur une sélection : menu système");

  // 3. A sticker beside a short heading, in the column: the heading is then
  // right-aligned, under the sticker; the sticker steps aside (display only).
  const stickerVsText = () =>
    page.evaluate(() => {
      const v = window.__ursaView;
      const node = v.domAtPos(v.state.doc.line(1).from).node;
      const line = (node.nodeType === 1 ? node : node.parentElement).closest(".cm-line");
      const range = document.createRange();
      range.selectNodeContents(line);
      const rects = [...range.getClientRects()].filter((r) => r.width > 0);
      const text = { left: Math.min(...rects.map((r) => r.left)), right: Math.max(...rects.map((r) => r.right)) };
      const sticker = document.querySelector(".cm-sticker").getBoundingClientRect();
      return { overlap: sticker.left < text.right && sticker.right > text.left, text, sticker: { left: sticker.left, right: sticker.right } };
    });
  await page.evaluate(async (id) => {
    const v = window.__ursaView;
    const { addSticker } = await import("/src/editor/session.ts");
    const content = v.contentDOM.getBoundingClientRect();
    const pad = parseFloat(getComputedStyle(v.contentDOM).paddingLeft);
    const c = v.coordsAtPos(v.state.doc.line(1).from + 1);
    addSticker(id, { kind: "sticker", asset: "fluent/sparkles" }, { x: content.left + pad + (content.width - 2 * pad) * 0.7, y: c.top });
  }, noteId);
  await page.waitForTimeout(400);
  // Back in the heading's text (the new sticker took the focus).
  const heading = await point(1);
  await page.mouse.click(heading.x, heading.y);
  const beforeAlign = await stickerVsText();
  check(!beforeAlign.overlap, "sticker posé à droite d'un titre court, hors du texte");
  await page.keyboard.press("Control+Shift+Digit3");
  await page.waitForTimeout(400);
  check((await lineAlign(1)) === "right", "Ctrl+Maj+3 : titre aligné à droite");
  const afterAlign = await stickerVsText();
  check(!afterAlign.overlap, "titre aligné à droite : le sticker s'écarte du texte", `texte ${afterAlign.text.left.toFixed(0)}–${afterAlign.text.right.toFixed(0)}, sticker ${afterAlign.sticker.left.toFixed(0)}–${afterAlign.sticker.right.toFixed(0)}`);
  await page.keyboard.press("Control+Shift+Digit2");
  await page.waitForTimeout(400);
  check((await lineAlign(1)) === "center", "Ctrl+Maj+2 : titre centré");
  check(!(await stickerVsText()).overlap, "titre centré : le sticker évite toujours le texte");
  const stored = await page.evaluate(async () => {
    const { stickersOf } = await import("/src/editor/stickers/state.ts");
    return stickersOf(window.__ursaView.state)[0].dx;
  });
  check(Math.abs(stored - 70) < 15, "position enregistrée du sticker inchangée (affichage seulement)", `dx ${stored} %`);
  await page.keyboard.press("Control+Shift+Digit1");

  // 4. Saved, then back after reopening the note.
  await page.evaluate(async () => (await import("/src/app/notes.ts")).flushAll());
  await page.waitForTimeout(700);
  const frontmatter = await page.evaluate(async (id) => (await import("/src/app/store.ts")).useApp.getState().notes[id].frontmatter, noteId);
  check(/align:\n\s+- block: paragraph[\s\S]*align: right/.test(frontmatter), "frontmatter : align: … right");
  check(!/^align:[\s\S]*block: code/m.test(frontmatter), "frontmatter : rien pour le bloc de code");
  await page.evaluate(async (id) => {
    const { useApp } = await import("/src/app/store.ts");
    const { revealNote } = await import("/src/app/notes.ts");
    const other = Object.keys(useApp.getState().notes).find((n) => n !== id);
    revealNote(other);
    await new Promise((r) => setTimeout(r, 200));
    const { forgetNote } = await import("/src/editor/session.ts");
    forgetNote(id);
    revealNote(id);
  }, noteId);
  await page.waitForTimeout(400);
  check((await lineAlign(paragraphLine)) === "right", "réouverture : toujours aligné à droite");
} finally {
  await browser.close();
  await server.close();
}
process.exit(failures ? 1 : 0);
