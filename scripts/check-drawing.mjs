// Drawings (Excalidraw) — `npm run test:drawing`.
// In a real browser (in-memory vault):
// 1. nothing of Excalidraw is loaded at startup; "Insert drawing" opens it full
//    screen, its fonts served by the app (no request leaves the machine);
// 2. a drawing with a text is saved: `![Dessin](assets/dessins/<id>.svg)` in the
//    note, shown inline through <img>, its height on the rhythm, its text found
//    by search;
// 3. double-click and Ctrl+click reopen it; closing after a change asks first;
//    the picture is redrawn after saving again;
// 4. dark palette: the picture is turned; duplicating the note copies the drawing.
// Needs Chromium for Playwright.
import { chromium } from "playwright";
import { createServer } from "vite";

const server = await createServer({ server: { port: 0, strictPort: false }, logLevel: "error" });
await server.listen();
const url = server.resolvedUrls.local[0];
const origin = new URL(url).origin;
const browser = await chromium.launch();
let failures = 0;
const check = (ok, label, detail = "") => {
  if (ok) console.log(`✓ ${label}${detail ? ` (${detail})` : ""}`);
  else {
    failures++;
    console.error(`✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
};

try {
  const page = await browser.newPage({ viewport: { width: 1800, height: 900 }, locale: "fr-FR" });
  page.on("pageerror", (e) => check(false, "erreur de la page", e.message));
  const outside = [];
  const scripts = [];
  page.on("request", (r) => {
    const u = r.url();
    if (/^https?:/.test(u) && !u.startsWith(origin)) outside.push(u);
    if (r.resourceType() === "script") scripts.push(u);
  });
  await page.goto(url);
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem("ursa-dev-settings", JSON.stringify({ welcomed: true, layout: { sidebarCollapsed: true } }));
  });
  await page.reload();
  await page.waitForFunction(() => window.__ursaView !== undefined);
  await page.waitForTimeout(800);
  const early = scripts.filter((u) => /@excalidraw|DrawingEditor/.test(u));
  check(early.length === 0, "Excalidraw non chargé au démarrage", early.slice(0, 3).join(", "));

  await page.evaluate(async () => {
    const { createNote } = await import("/src/app/notes.ts");
    await createNote();
    const v = window.__ursaView;
    v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: "# Plan du salon\n\nAvant le dessin." } });
    v.dispatch({ selection: { anchor: v.state.doc.length } });
    v.focus();
  });
  const doc = () => page.evaluate(() => window.__ursaView.state.doc.toString());

  // 1–2. Insert, draw, save.
  await page.click('[role=toolbar] button[aria-label="Insérer un dessin"]');
  await page.waitForSelector(".excalidraw canvas.interactive", { timeout: 30000 });
  await page.waitForTimeout(800);
  check(scripts.some((u) => /DrawingEditor/.test(u)), "Excalidraw chargé à la demande");
  const box = await page.locator(".excalidraw canvas.interactive").boundingBox();
  const at = (x, y) => [box.x + x, box.y + y];
  const drag = async (key, [x1, y1], [x2, y2]) => {
    await page.keyboard.press(key);
    await page.mouse.move(x1, y1);
    await page.mouse.down();
    await page.mouse.move(x2, y2, { steps: 8 });
    await page.mouse.up();
  };
  await drag("r", at(400, 250), at(620, 400));
  await drag("a", at(625, 325), at(760, 325));
  await page.keyboard.press("t");
  await page.mouse.click(...at(440, 300));
  await page.waitForSelector(".excalidraw-textEditorContainer textarea");
  await page.waitForTimeout(150);
  await page.keyboard.type("Cuisine ouverte");
  await page.waitForTimeout(150);
  await page.keyboard.press("Escape");
  const fonts = await page.evaluate(() => [...document.fonts].filter((f) => f.family.replace(/"/g, "") === "Excalifont" && f.status === "loaded").length);
  check(fonts > 0, "police Excalifont servie par l'app", `${fonts} fichier(s)`);
  await page.keyboard.press("Control+Enter");
  await page.waitForFunction(() => !document.querySelector(".excalidraw"), null, { timeout: 15000 });
  await page.waitForTimeout(500);
  const text = await doc();
  const line = /!\[Dessin\]\(assets\/dessins\/([\w-]+)\.svg\)/.exec(text);
  check(line !== null, "Ctrl+Entrée enregistre ; le dessin est lié dans la note", text.split("\n").pop() || text.split("\n").at(-2));
  await page.evaluate(() => {
    window.__ursaView.dispatch({ selection: { anchor: 0 } });
    window.__ursaView.contentDOM.blur();
  });
  await page.waitForFunction(() => document.querySelector(".cm-drawing.is-loaded img"), null, { timeout: 10000 });
  const shown = await page.evaluate(() => {
    const block = document.querySelector(".cm-drawing");
    const rhythm = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--rhythm"));
    return { tag: block?.querySelector("img")?.tagName, svg: block?.querySelector(".cm-image-frame svg") !== null, h: block?.getBoundingClientRect().height ?? 0, rhythm };
  });
  check(shown.tag === "IMG" && !shown.svg, "affiché par <img>, jamais injecté");
  check(shown.h > 0 && Math.abs(shown.h / shown.rhythm - Math.round(shown.h / shown.rhythm)) < 0.02, "hauteur du bloc arrondie au rythme", `${shown.h} px`);
  const found = await page.evaluate(async () => {
    await new Promise((r) => setTimeout(r, 300));
    const { searchNotes } = await import("/src/core/search/search.ts");
    const { parseQuery } = await import("/src/core/search/query.ts");
    const { useApp } = await import("/src/app/store.ts");
    return searchNotes(Object.values(useApp.getState().notes), parseQuery('"cuisine ouverte"'), Date.now(), (x) => x).map((n) => n.title);
  });
  check(found.includes("Plan du salon"), "le texte du dessin est trouvé par la recherche", found.join(", "));

  // 3. Reopen (double-click, Ctrl+click), close after a change asks first.
  await page.dblclick(".cm-drawing .cm-image-frame");
  await page.waitForSelector(".excalidraw canvas.interactive", { timeout: 15000 });
  await page.waitForTimeout(800);
  check(true, "double-clic rouvre le dessin");
  await page.click('button:has-text("Fermer")');
  await page.waitForTimeout(300);
  check((await page.locator(".excalidraw").count()) === 0, "fermer sans modification : pas de question");
  await page.click(".cm-drawing .cm-image-frame", { modifiers: ["Control"] });
  await page.waitForSelector(".excalidraw canvas.interactive", { timeout: 15000 });
  await page.waitForTimeout(800);
  check(true, "Ctrl+clic rouvre le dessin");
  const box2 = await page.locator(".excalidraw canvas.interactive").boundingBox();
  await page.keyboard.press("o");
  await page.mouse.move(box2.x + 900, box2.y + 600);
  await page.mouse.down();
  await page.mouse.move(box2.x + 1020, box2.y + 700, { steps: 6 });
  await page.mouse.up();
  await page.click('button:has-text("Fermer")');
  await page.waitForTimeout(300);
  const asked = await page.locator('[role=dialog]:has-text("Fermer sans enregistrer ?")').count();
  check(asked === 1, "fermer après une modification demande confirmation");
  await page.click('[role=dialog] button:has-text("Annuler")');
  await page.waitForTimeout(200);
  check((await page.locator(".excalidraw").count()) === 1, "« Annuler » garde le dessin ouvert");
  const before = await page.evaluate(() => document.querySelector(".cm-drawing img")?.getAttribute("src"));
  await page.click('button:has-text("Enregistrer")');
  await page.waitForFunction(() => !document.querySelector(".excalidraw"), null, { timeout: 15000 });
  await page.waitForTimeout(500);
  const after = await page.evaluate(() => document.querySelector(".cm-drawing img")?.getAttribute("src"));
  check(after && after !== before, "l'aperçu est régénéré à l'enregistrement");

  // 4. Dark palette, duplication, nothing from the network.
  await page.evaluate(async () => {
    const { updateSettings } = await import("/src/app/store.ts");
    updateSettings((s) => ({ ...s, appearance: { ...s.appearance, mode: "dark" } }));
  });
  await page.waitForTimeout(300);
  const filter = await page.evaluate(() => getComputedStyle(document.querySelector(".cm-drawing img")).filter);
  check(filter.includes("invert"), "palette sombre : le dessin est inversé", filter);
  const copied = await page.evaluate(async () => {
    const { useApp } = await import("/src/app/store.ts");
    const { duplicateNote } = await import("/src/app/notes.ts");
    const source = useApp.getState().selectedId;
    await duplicateNote(source);
    const st = useApp.getState();
    return { source: st.notes[source].body, copy: st.notes[st.selectedId].body };
  });
  const id = (body) => /assets\/dessins\/([\w-]+)\.svg/.exec(body)?.[1];
  check(id(copied.copy) && id(copied.copy) !== id(copied.source), "la note dupliquée a sa propre copie du dessin");
  check(outside.length === 0, "aucune requête hors de l'app", outside.slice(0, 3).join(", "));
} catch (e) {
  check(false, "exécution", e.stack ?? String(e));
} finally {
  await browser.close();
  await server.close();
}
process.exit(failures ? 1 : 0);
