// Performance measures — `npm run perf` (figures recorded in PROGRESS.md).
// Production build with the in-memory vault (VITE_URSA_MOCK=1), Chromium:
// 1. startup with 2 000 notes: boot → vault ready → first frame (median of 5);
// 2. the same with OCR on and 200 pictures to read: startup time and main
//    thread blocked (long tasks) during the first seconds;
// 3. typing in the search field with 2 000 notes: keystroke → next frame;
// 4. memory: 200 notes opened one after the other, JS heap and DOM nodes
//    after garbage collection every 50 notes, then the first 50 again.
// The disk side (Rust reading 2 000 files) is measured by
// `cargo test scan_reads_2000_notes -- --nocapture`.
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { preview } from "vite";

const NOTES = 2000;
const RUNS = 5;
const outDir = mkdtempSync(join(tmpdir(), "ursa-perf-"));
execSync(`npx vite build --outDir "${outDir}" --emptyOutDir`, { stdio: "ignore", env: { ...process.env, VITE_URSA_MOCK: "1" } });
const server = await preview({ build: { outDir }, preview: { port: 0, strictPort: false }, logLevel: "error" });
const url = server.resolvedUrls.local[0];
const browser = await chromium.launch();
const median = (list) => [...list].sort((a, b) => a - b)[Math.floor(list.length / 2)];
const ms = (n) => `${Math.round(n)} ms`;

async function start({ ocr, pictures }) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.goto(url);
  await page.evaluate(
    ({ notes, ocr, pictures }) => {
      localStorage.clear();
      localStorage.setItem("ursa-dev-settings", JSON.stringify({ welcomed: true }));
      localStorage.setItem("ursa-dev-notes", String(notes));
      localStorage.setItem("ursa-dev-ocr", ocr ? "en" : "off");
      if (pictures) localStorage.setItem("ursa-dev-note-images", "1");
    },
    { notes: NOTES, ocr, pictures },
  );
  await page.addInitScript(() => {
    window.__long = [];
    new PerformanceObserver((list) => list.getEntries().forEach((e) => window.__long.push({ at: e.startTime, ms: e.duration }))).observe({ type: "longtask", buffered: true });
  });
  await page.reload();
  await page.waitForFunction(() => performance.getEntriesByName("ursa:interactive").length > 0, null, { timeout: 30000 });
  const marks = await page.evaluate(() => {
    const at = (n) => performance.getEntriesByName(n)[0].startTime;
    return { boot: at("ursa:boot"), ready: at("ursa:ready"), interactive: at("ursa:interactive"), notes: document.querySelector("nav button span:last-child")?.textContent };
  });
  return { context, page, marks };
}

try {
  // 1. Startup
  const runs = [];
  for (let i = 0; i < RUNS; i++) {
    const { context, marks } = await start({ ocr: false, pictures: false });
    runs.push(marks);
    await context.close();
  }
  const boot = median(runs.map((r) => r.interactive - r.boot));
  console.log(`démarrage, ${NOTES} notes (compteur « Notes » : ${runs[0].notes}) : boot → prêt ${ms(median(runs.map((r) => r.ready - r.boot)))}, boot → première image ${ms(boot)}, ouverture de la page → première image ${ms(median(runs.map((r) => r.interactive)))}`);

  // 2. Startup with 200 pictures in the notes, OCR off then on: the queue must not slow the start.
  const withPictures = async (ocr) => {
    const list = [];
    for (let i = 0; i < RUNS; i++) {
      const { context, page, marks } = await start({ ocr, pictures: true });
      await page.waitForTimeout(4000);
      const after = await page.evaluate((ready) => {
        const long = window.__long.filter((e) => e.at >= ready);
        return { long: long.map((e) => `${Math.round(e.ms)} ms à +${((e.at - ready) / 1000).toFixed(1)} s`), left: document.querySelector('nav [role="status"]')?.textContent ?? "" };
      }, marks.ready);
      list.push({ ...marks, ...after });
      await context.close();
    }
    return { first: median(list.map((r) => r.interactive - r.boot)), all: list.map((r) => Math.round(r.interactive - r.boot)), sample: list[1] };
  };
  const off = await withPictures(false);
  const on = await withPictures(true);
  console.log(`démarrage, 200 images dans les notes : OCR coupé ${ms(off.first)} [${off.all}], OCR actif ${ms(on.first)} [${on.all}] (boot → première image, médiane de ${RUNS})`);
  console.log(`  OCR actif, 4 s après « prêt » : tâches longues [${on.sample.long.join(", ") || "aucune"}] ; file : « ${on.sample.left} »`);

  // 3. Search typing
  const { context: searchContext, page } = await start({ ocr: false, pictures: false });
  // The index is warmed during idle time after startup; then the user types.
  await page.waitForTimeout(3000);
  await page.keyboard.press("Control+k");
  await page.evaluate(() => {
    window.__lat = [];
    document.addEventListener(
      "keydown",
      () => {
        const t = performance.now();
        requestAnimationFrame(() => setTimeout(() => window.__lat.push(performance.now() - t), 0));
      },
      true,
    );
  });
  for (const ch of "voyage kyoto") {
    await page.keyboard.type(ch);
    await page.waitForTimeout(120);
  }
  await page.waitForTimeout(400);
  const lat = await page.evaluate(() => window.__lat);
  console.log(`recherche, ${NOTES} notes : frappe → image ${ms(median(lat))} médiane, ${ms(Math.max(...lat))} max [${lat.map(Math.round).join(", ")}]`);
  await searchContext.close();

  // 4. Memory over 200 notes
  const { context: memContext, page: mem } = await start({ ocr: false, pictures: false });
  const cdp = await memContext.newCDPSession(mem);
  await cdp.send("HeapProfiler.enable");
  const sample = async () => {
    for (let i = 0; i < 2; i++) await cdp.send("HeapProfiler.collectGarbage");
    const { usedSize } = await cdp.send("Runtime.getHeapUsage");
    const nodes = await mem.evaluate(() => document.getElementsByTagName("*").length);
    return { mb: usedSize / 1048576, nodes };
  };
  // Production build: notes are opened as a user would, from the list.
  // Down arrow in the list: the next note each time (the list loads more cards as it scrolls).
  await mem.locator('[role="option"]').first().click();
  const open = () => mem.keyboard.press("ArrowDown");
  const points = [{ n: 0, ...(await sample()) }];
  for (let i = 1; i <= 200; i++) {
    await open();
    await mem.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    if (i % 50 === 0) points.push({ n: i, ...(await sample()) });
  }
  await mem.keyboard.press("Home");
  for (let i = 1; i <= 50; i++) {
    await open();
    await mem.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  }
  points.push({ n: "200 + 50 rouvertes", ...(await sample()) });
  const opened = await mem.evaluate(() => document.querySelector('[role="option"][aria-selected="true"]')?.id);
  if (!opened) throw new Error("no note selected after the walk");
  console.log(`mémoire, notes ouvertes l'une après l'autre : ${points.map((p) => `${p.n} → ${p.mb.toFixed(1)} Mo / ${p.nodes} nœuds`).join(" ; ")}`);
  await memContext.close();
} finally {
  await browser.close();
  await new Promise((r) => server.httpServer.close(r));
  rmSync(outDir, { recursive: true, force: true });
}
