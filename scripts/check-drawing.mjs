// Drawings (Excalidraw) — `npm run test:drawing`.
// In a real browser (in-memory vault):
// 1. nothing of Excalidraw is loaded at startup; "Insert drawing" opens it full
//    screen, its fonts served by the app (no request leaves the machine);
// 2. a drawing with a text is saved: `![Dessin](assets/dessins/<id>.svg)` in the
//    note, shown inline through <img>, its height on the rhythm, its text found
//    by search;
// 3. double-click and Ctrl+click reopen it; closing after a change asks first;
//    the picture is redrawn after saving again;
// 4. previous versions (5 kept): listed from the drawing's bar, reopened, restored;
// 5. dark palette: the picture is turned; duplicating the note copies the drawing;
// 6. CJK text without, then with, the font downloaded from Settings › Drawings.
// Needs Chromium for Playwright.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
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
  // Requests that left the machine: finished, or failed for another reason than
  // the CSP (Excalidraw lists its CDN after the app's fonts; the CSP, the app's
  // as the dev server's, stops it before any connection).
  const watchOutside = (p) => {
    const away = (r) => /^https?:/.test(r.url()) && !r.url().startsWith(origin);
    p.on("requestfinished", (r) => away(r) && outside.push(r.url()));
    p.on("requestfailed", (r) => away(r) && !/BLOCKED_BY_CSP|^csp$/i.test(r.failure()?.errorText ?? "") && outside.push(`${r.url()} (${r.failure()?.errorText})`));
  };
  watchOutside(page);
  page.on("request", (r) => {
    if (r.resourceType() === "script") scripts.push(r.url());
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

  // Previous versions: the scene before this save was kept; reopening it and
  // saving brings it back (the replaced one is kept in turn).
  const scene = () =>
    page.evaluate(async () => {
      const { useApp } = await import("/src/app/store.ts");
      const { drawingsIn } = await import("/src/core/drawings.ts");
      const { drawingsApi } = await import("/src/services/drawings.ts");
      const note = useApp.getState().notes[useApp.getState().selectedId];
      const id = drawingsIn(note.path, window.__ursaView.state.doc.toString())[0];
      const json = JSON.parse(await drawingsApi.read(id));
      return { id, shapes: json.elements.filter((e) => !e.isDeleted).map((e) => e.type).sort().join(","), versions: (await drawingsApi.versions(id)).length };
    });
  const edited = await scene();
  check(edited.versions === 1 && edited.shapes.includes("ellipse"), "enregistrer un dessin modifié garde la version précédente", JSON.stringify(edited));
  await page.click(".cm-drawing .cm-image-frame");
  await page.click('.cm-drawing button[aria-label="Versions précédentes…"]');
  const rows = page.locator('[role=dialog] li:has-text("Remplacée le")');
  await rows.first().waitFor();
  check((await rows.count()) === 1, "« Versions précédentes… » dans la barre du dessin : une version listée");
  await rows.first().locator("button").click();
  await page.waitForSelector(".excalidraw canvas.interactive", { timeout: 15000 });
  await page.waitForTimeout(800);
  check((await page.locator("#drawing-title").textContent()).startsWith("Dessin — version du"), "la version s'ouvre dans l'éditeur");
  await page.click('button:has-text("Fermer")');
  await page.waitForTimeout(300);
  check((await page.locator('[role=dialog]:has-text("Fermer sans enregistrer ?")').count()) === 1, "fermer une version non enregistrée demande confirmation");
  await page.click('[role=dialog] button:has-text("Annuler")');
  await page.click('button:has-text("Enregistrer")');
  await page.waitForFunction(() => !document.querySelector(".excalidraw"), null, { timeout: 15000 });
  await page.waitForTimeout(300);
  const restored = await scene();
  check(!restored.shapes.includes("ellipse") && restored.versions === 2, "enregistrer la version la restaure ; l'actuelle devient une version", JSON.stringify(restored));

  // 4. Dark palette, duplication, nothing from the network.
  await page.evaluate(async () => {
    const { updateSettings } = await import("/src/app/store.ts");
    updateSettings((s) => ({ ...s, appearance: { ...s.appearance, mode: "dark" } }));
  });
  await page.waitForTimeout(300);
  const filter = await page.evaluate(() => getComputedStyle(document.querySelector(".cm-drawing img")).filter);
  check(filter.includes("invert"), "palette sombre : le dessin est inversé", filter);
  // The turn keeps hues (invert + hue-rotate(180deg), as Excalidraw does): red stays red.
  const hues = await page.evaluate((filter) => {
    const c = document.createElement("canvas");
    c.width = c.height = 1;
    const x = c.getContext("2d", { willReadFrequently: true });
    const hue = ([r, g, b]) => {
      const max = Math.max(r, g, b), d = max - Math.min(r, g, b);
      const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
      return Math.round((h * 60 + 360) % 360);
    };
    return ["#e03131", "#2f9e44", "#1971c2", "#f08c00"].map((color) => {
      x.filter = "none";
      x.fillStyle = color;
      x.fillRect(0, 0, 1, 1);
      const before = hue(x.getImageData(0, 0, 1, 1).data);
      x.clearRect(0, 0, 1, 1);
      x.filter = filter;
      x.fillRect(0, 0, 1, 1);
      return [color, before, hue(x.getImageData(0, 0, 1, 1).data)];
    });
  }, filter);
  const drift = (a, b) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));
  check(hues.every(([, a, b]) => drift(a, b) <= 15), "palette sombre : les teintes restent (rouge reste rouge)", hues.map(([c, a, b]) => `${c} ${a}°→${b}°`).join(", "));
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

  // 6. Chinese (simplified and traditional), Japanese, Korean: without then with
  // the CJK font downloaded from Settings › Drawings (decision P12-11). Renders
  // of the editor, the picture in the note, the HTML / image page and the PDF
  // are written to test-results/drawing-cjk (a CI artifact: Windows' rendering).
  const shots = process.env.DRAWING_ARTIFACTS ?? join("test-results", "drawing-cjk");
  mkdirSync(shots, { recursive: true });
  const TEXT = "简体中文：你好 · 繁體中文：您好 · 日本語 · 한국어";
  const cjkDrawing = async (p, tag) => {
    await p.evaluate(async () => {
      const { createNote } = await import("/src/app/notes.ts");
      await createNote();
      const v = window.__ursaView;
      v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: "# 中文 Chinois\n\nUn dessin en chinois simplifié et traditionnel.\n" } });
      v.dispatch({ selection: { anchor: v.state.doc.length } });
      (await import("/src/app/drawings.ts")).newDrawing();
    });
    await p.waitForSelector(".excalidraw canvas.interactive", { timeout: 30000 });
    await p.waitForTimeout(800);
    const c = await p.locator(".excalidraw canvas.interactive").boundingBox();
    await p.keyboard.press("t");
    await p.mouse.click(c.x + 400, c.y + 300);
    await p.waitForSelector(".excalidraw-textEditorContainer textarea");
    await p.waitForTimeout(150);
    await p.keyboard.insertText(TEXT);
    await p.waitForTimeout(150);
    await p.keyboard.press("Escape");
    await p.waitForTimeout(600);
    await p.screenshot({ path: join(shots, `${tag}-1-editeur.png`) });
    await p.keyboard.press("Control+Enter");
    await p.waitForFunction(() => !document.querySelector(".excalidraw"), null, { timeout: 15000 });
    await p.evaluate(() => {
      window.__ursaView.dispatch({ selection: { anchor: 0 } });
      window.__ursaView.contentDOM.blur();
    });
    await p.waitForFunction(() => document.querySelector(".cm-drawing.is-loaded img"), null, { timeout: 10000 });
    await p.mouse.move(5, 5);
    await p.waitForTimeout(400);
    await p.screenshot({ path: join(shots, `${tag}-2-note.png`) });
    const svg = await p.evaluate(async () => (await fetch(document.querySelector(".cm-drawing img").src)).text());
    writeFileSync(join(shots, `${tag}-apercu.svg`), svg);
    // The note's export page (HTML, and the images / PDF made from it).
    const html = await p.evaluate(async () => {
      const { useApp } = await import("/src/app/store.ts");
      const { exportPage } = await import("/src/app/export/page.ts");
      const st = useApp.getState();
      return (await exportPage(st.notes[st.selectedId], { images: true, tags: true, currentTheme: false, paper: true, stickers: true, wiki: () => null })).html;
    });
    const out = await browser.newPage({ viewport: { width: 900, height: 700 } });
    await out.setContent(html, { waitUntil: "load" });
    await out.waitForTimeout(500);
    await out.screenshot({ path: join(shots, `${tag}-3-export-image.png`), fullPage: true });
    const pdf = await out.pdf({ format: "A4", printBackground: true });
    writeFileSync(join(shots, `${tag}-4-export.pdf`), pdf);
    await out.close();
    return { svg, pdf: pdf.length };
  };

  const fresh = async (cjk) => {
    const p = await browser.newPage({ viewport: { width: 1440, height: 800 }, locale: "fr-FR" });
    p.on("pageerror", (e) => check(false, "erreur de la page (CJK)", e.message));
    watchOutside(p);
    await p.goto(url);
    await p.evaluate((cjk) => {
      localStorage.clear();
      localStorage.setItem("ursa-dev-settings", JSON.stringify({ welcomed: true, layout: { sidebarCollapsed: true, listCollapsed: true } }));
      if (cjk) localStorage.setItem("ursa-dev-cjk", "1");
    }, cjk);
    await p.reload();
    await p.waitForFunction(() => window.__ursaView !== undefined);
    await p.waitForTimeout(600);
    return p;
  };

  const without = await fresh(false);
  const a = await cjkDrawing(without, "sans-police");
  check(a.svg.includes("简体中文") && a.svg.includes("繁體中文"), "sans la police CJK : le texte chinois est dans l'aperçu (police du système)");
  check(!/url\(\s*["']?https?:/.test(a.svg), "l'aperçu ne pointe jamais vers Internet (police non embarquée retirée)");
  // Settings › Drawings: download (in-memory vault: the package's files).
  await without.evaluate(async () => (await import("/src/app/store.ts")).setState({ settingsPage: "drawings" }));
  await without.getByRole("button", { name: /^Télécharger/ }).click();
  await without.waitForFunction(() => document.body.textContent.includes("Installée"), null, { timeout: 20000 });
  await without.screenshot({ path: join(shots, "reglages-dessins.png") });
  check(true, "Réglages › Dessins : police téléchargée, « Installée »");
  await without.close();

  const withFont = await fresh(true);
  const b = await cjkDrawing(withFont, "avec-police");
  const embedded = /@font-face\s*\{[^}]*font-family:\s*"?Xiaolai"?[^}]*url\(\s*["']?data:font\/woff2/.test(b.svg);
  check(embedded && b.svg.includes("繁體中文"), "avec la police CJK : glyphes embarqués dans l'aperçu SVG (même rendu partout)");
  check(a.pdf > 0 && b.pdf > 0, "exports PDF et image écrits", `${shots}`);
  await withFont.close();
  check(outside.length === 0, "CJK : aucune requête hors de l'app", outside.slice(0, 3).join(", "));
} catch (e) {
  check(false, "exécution", e.stack ?? String(e));
} finally {
  await browser.close();
  await server.close();
}
process.exit(failures ? 1 : 0);
