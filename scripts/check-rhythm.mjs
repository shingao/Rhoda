// Vertical rhythm check [DESIGN §6] — `npm run test:rhythm`.
// Opens "Rythme vertical.md" in a real browser (in-memory vault) and checks,
// for both editor fonts and every allowed size (14–20 px), that:
// - every text line starts on a multiple of --rhythm and is a multiple tall;
// - every block (code, quote) starts on the rhythm and ends on it.
// Then, at each Windows display scale (100, 125, 150, 175 %), that the rhythm
// holds and that the page background is drawn on whole physical pixels: rules,
// grid and red margin of regular width with no half-lit row, the 28 px pitch
// exact, dots all alike; and that moving to a screen at another scale is followed.
// Needs Chromium for Playwright (`npx playwright install chromium` once).
import { chromium } from "playwright";
import { createServer } from "vite";

const SIZES = [14, 14.5, 15, 15.5, 16, 16.5, 17, 17.5, 18, 18.5, 19, 19.5, 20];
const FONTS = ["sans", "serif"];
const EPS = 0.6;

/** In the page: every line and block of the open note on the rhythm, for one font and size. */
const lineCheck = async ({ font, size, EPS }) => {
  const { updateSettings } = await import("/src/app/store.ts");
  updateSettings((s) => ({ ...s, editor: { ...s.editor, font, fontSize: size } }));
  const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  await document.fonts.ready;
  await frame();
  // Images must be loaded (their block height depends on their size).
  for (let i = 0; i < 50 && document.querySelector(".cm-image:not(.is-loaded):not(.is-missing)"); i++) await new Promise((r) => setTimeout(r, 50));
  await frame();
  const v = window.__ursaView;
  const rhythm = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--rhythm"));
  const off = (y) => {
    const m = ((y % rhythm) + rhythm) % rhythm;
    return Math.min(m, rhythm - m);
  };
  const out = [];
  const blocks = new Map(); // block id → { top, bottom }
  v.contentDOM.blur();
  await new Promise((r) => setTimeout(r, 50));
  await frame();
  // Origin = where the page background starts (top of the scroller's content,
  // background-attachment: local): lines must sit on its rules.
  const paperTop = v.scrollDOM.getBoundingClientRect().top + v.scrollDOM.clientTop - v.scrollDOM.scrollTop;
  for (const el of v.contentDOM.querySelectorAll(".cm-line, .cm-backlinks, .cm-isolation-bar, .cm-embed")) {
    const r = el.getBoundingClientRect();
    // Relative offsets are optical (H1 baseline on its rule), not layout.
    const cs = getComputedStyle(el);
    const shift = cs.position === "relative" ? parseFloat(cs.top) || 0 : 0;
    const y = r.top - paperTop - shift;
    const line = el.classList.contains("cm-line") ? v.state.doc.lineAt(v.posAtDOM(el)) : null;
    const label = line ? `l.${line.number} « ${line.text.slice(0, 30)} »` : el.className;
    // Code lines follow the mono rhythm; the block as a whole is checked below.
    if (el.classList.contains("cm-code") || el.classList.contains("cm-quote")) {
      const kind = el.classList.contains("cm-code") ? "code" : "quote";
      const startsBlock = kind === "code" ? el.classList.contains("cm-code-head") || el.classList.contains("cm-code-first") : el.classList.contains("cm-quote-first") && !el.classList.contains("cm-quote-nested");
      let id = null;
      if (!startsBlock) for (const [k, b] of blocks) if (b.kind === kind && Math.abs(b.bottom - y) < EPS) id = k;
      if (id === null) blocks.set((id = `${kind}@${Math.round(y)}`), { kind, top: y, bottom: y, label, frameTop: y, frameBottom: y });
      const b = blocks.get(id);
      b.bottom = y + r.height;
      b.frameBottom = b.bottom;
      // A quote's frame is drawn by its ::before / ::after: measure them.
      if (kind === "quote" && el.classList.contains("cm-quote-first") && startsBlock) {
        const before = getComputedStyle(el, "::before");
        if (before.content !== "none") b.frameTop = y + parseFloat(before.top);
      }
      if (kind === "quote" && el.classList.contains("cm-quote-last")) {
        const after = getComputedStyle(el, "::after");
        if (after.content !== "none") b.frameBottom = b.bottom - parseFloat(after.bottom);
      }
      if (kind === "code") continue;
    }
    if (off(y) > EPS) out.push(`${label}: top ${y.toFixed(2)} (+${off(y).toFixed(2)})`);
    if (off(r.height) > EPS) out.push(`${label}: height ${r.height.toFixed(2)}`);
  }
  for (const [id, b] of blocks) {
    const top = b.kind === "quote" ? b.frameTop : b.top;
    const bottom = b.kind === "quote" ? b.frameBottom : b.bottom;
    if (off(top) > EPS) out.push(`${id} ${b.label}: block top ${top.toFixed(2)}`);
    if (off(bottom - top) > EPS) out.push(`${id} ${b.label}: block height ${(bottom - top).toFixed(2)}`);
  }
  // Images keep their proportions (the rounding is space around them, never a stretch).
  for (const img of v.contentDOM.querySelectorAll(".cm-image img")) {
    const r = img.getBoundingClientRect();
    const ratio = img.naturalWidth / img.naturalHeight;
    if (Math.abs(r.width / r.height - ratio) > 0.01) out.push(`image ${img.alt}: distorted ${r.width}×${r.height} (natural ${img.naturalWidth}×${img.naturalHeight})`);
  }
  return { out, images: v.contentDOM.querySelectorAll(".cm-image.is-loaded").length, lines: v.contentDOM.querySelectorAll(".cm-line").length, blocks: blocks.size, backlinks: !!v.contentDOM.querySelector(".cm-backlinks") };
};

const SCALES = [1, 1.25, 1.5, 1.75];

/**
 * In the page: the page background of the open note, read from a screenshot
 * (physical pixels). Returns the problems found.
 */
const paperCheck = async ({ b64, paper }) => {
  const dpr = window.devicePixelRatio;
  const img = new Image();
  img.src = `data:image/png;base64,${b64}`;
  await img.decode();
  const canvas = document.createElement("canvas");
  canvas.width = img.width;
  canvas.height = img.height;
  const g = canvas.getContext("2d", { willReadFrequently: true });
  g.drawImage(img, 0, 0);
  const v = window.__ursaView;
  const root = getComputedStyle(document.documentElement);
  const px = (name) => parseFloat(root.getPropertyValue(name));
  const box = v.scrollDOM.getBoundingClientRect();
  const paperTop = box.top + v.scrollDOM.clientTop - v.scrollDOM.scrollTop;
  const paperLeft = box.left + v.scrollDOM.clientLeft;
  const pitch = px("--paper-pitch") * dpr;
  const lineW = Math.max(1, Math.round(dpr));
  const out = [];
  const pixels = (x, y, w, h) => {
    const d = g.getImageData(x, y, w, h).data;
    const list = [];
    for (let i = 0; i < d.length; i += 4) list.push([d[i], d[i + 1], d[i + 2]]);
    return list;
  };
  const lum = ([r, gr, b]) => 0.2126 * r + 0.7152 * gr + 0.0722 * b;
  /** Runs of pixels darker than the paper, with their darkness per pixel. */
  const runs = (list, start, test) => {
    const found = [];
    let cur = null;
    list.forEach((p, i) => {
      const d = test(p);
      if (d > 1) {
        if (!cur) found.push((cur = { at: start + i, values: [] }));
        cur.values.push(d);
      } else cur = null;
    });
    return found;
  };
  const crisp = (label, found, width) => {
    const all = found.flatMap((r) => r.values);
    const max = Math.max(...all);
    for (const r of found) {
      if (r.values.length !== width) out.push(`${label} at ${r.at}: ${r.values.length} physical pixels wide (expected ${width}) [${r.values.map(Math.round)}]`);
      else if (r.values.some((d) => d < max * 0.8)) out.push(`${label} at ${r.at}: half-lit pixel [${r.values.map(Math.round)}]`);
    }
    if (found.length && Math.max(...found.map((r) => r.values[0])) - Math.min(...found.map((r) => r.values[0])) > 3) out.push(`${label}: uneven darkness`);
  };

  // Rules and grid rows: a column in the blank right part of the editor.
  const x = Math.round((box.right - 20) * dpr);
  const y0 = Math.ceil(box.top * dpr) + 1;
  const column = pixels(x, y0, 1, Math.floor(box.bottom * dpr) - 1 - y0);
  const bg = Math.max(...column.map(lum));
  if (paper !== "dots") {
    const rows = runs(column, y0, (p) => bg - lum(p));
    if (rows.length < 8) out.push(`only ${rows.length} rules found`);
    crisp(paper === "grid" ? "grid row" : "rule", rows, lineW);
    const gaps = rows.slice(1).map((r, i) => r.at - rows[i].at);
    const per = paper === "grid" ? 2 : 1;
    for (let i = 0; i + per <= gaps.length; i += per) {
      const step = gaps.slice(i, i + per).reduce((a, b) => a + b, 0);
      if (step !== pitch) out.push(`pitch ${step} physical pixels after ${rows[i].at} (expected ${pitch})`);
    }
    // On the rhythm: the rule of each unit at --paper-rule-y, within one physical pixel.
    const first = rows.find((r) => paper !== "grid" || ((r.at / dpr - paperTop) % 28 + 28) % 28 > 14);
    const expected = (paperTop + px("--paper-rule-y")) * dpr;
    const offset = (((first.at - expected) % pitch) + pitch) % pitch;
    if (Math.min(offset, pitch - offset) > 1) out.push(`rules ${offset.toFixed(2)} physical pixels off the rhythm`);
  } else {
    // Dots: every dot drawn alike (same pixels around each centre).
    const cell = (cx, cy) => pixels(cx - 3, cy - 3, 7, 7).map(lum);
    const ox = Math.round((paperLeft + 14) * dpr);
    const oy = Math.round((paperTop + px("--paper-rule-y") + 28 * 2) * dpr);
    const ref = cell(ox, oy);
    for (const [i, j] of [[3, 0], [7, 1], [11, 2], [5, 3]]) {
      const other = cell(ox + i * pitch, oy + j * pitch);
      const diff = Math.max(...other.map((l, k) => Math.abs(l - ref[k])));
      if (diff > 3) out.push(`dot ${i},${j} drawn differently (${diff.toFixed(0)})`);
    }
  }

  // Red margin: one row between two rules, from the scroller's edge to the text.
  const textLeft = v.contentDOM.getBoundingClientRect().left + px("--editor-pad-x");
  const y = Math.round((paperTop + 28 * 2 + 26) * dpr);
  const x0 = Math.ceil(box.left * dpr) + 1;
  const row = pixels(x0, y, Math.round((textLeft - 16) * dpr) - x0, 1);
  const red = runs(row, x0, ([r, gr]) => r - gr - 8);
  if (red.length !== 1) out.push(`red margin: ${red.length} lines found`);
  else {
    crisp("red margin", red, Math.round(1.5 * dpr));
    const at = (textLeft - px("--paper-margin-x")) * dpr;
    if (Math.abs(red[0].at - at) > 1) out.push(`red margin at ${red[0].at} (expected ${at.toFixed(1)})`);
  }
  return out;
};

/** Opens "Rythme vertical" in a fresh page. */
async function openNote(page) {
  await page.goto(url);
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem("ursa-dev-settings", JSON.stringify({ welcomed: true }));
  });
  await page.reload();
  await page.waitForFunction(() => window.__ursaView !== undefined);
  await page.waitForTimeout(800);
  await page.evaluate(async () => {
    const { useApp } = await import("/src/app/store.ts");
    const { revealNote } = await import("/src/app/notes.ts");
    revealNote(Object.values(useApp.getState().notes).find((n) => n.title === "Rythme vertical").id);
  });
  await page.waitForTimeout(300);
}

/** The page background at the page's current scale; prints and counts problems. */
async function checkPaper(page, label) {
  let problems = 0;
  for (const paper of ["lined", "grid", "dots"]) {
    await page.evaluate(async (paper) => {
      const { getState, updateSettings } = await import("/src/app/store.ts");
      const { setPaper } = await import("/src/app/notes.ts");
      // Decorations off: only the paper is read.
      updateSettings((s) => ({ ...s, stickers: { ...s.stickers, show: false } }));
      setPaper(getState().selectedId, paper, true);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    }, paper);
    await page.mouse.move(1, 1);
    await page.waitForTimeout(150);
    const shot = await page.screenshot();
    const out = await page.evaluate(paperCheck, { b64: shot.toString("base64"), paper });
    if (out.length) {
      problems += out.length;
      console.error(`✗ ${label} ${paper}\n  ${out.slice(0, 8).join("\n  ")}${out.length > 8 ? `\n  … ${out.length - 8} more` : ""}`);
    } else console.log(`✓ ${label} ${paper} : traits nets, pas exact, marge rouge nette`);
  }
  return problems;
}

const server = await createServer({ server: { port: 0, strictPort: false }, logLevel: "error" });
await server.listen();
const url = server.resolvedUrls.local[0];
const browser = await chromium.launch();
// Tall enough for CodeMirror to draw the whole note at once (it only draws what is on screen).
const page = await browser.newPage({ viewport: { width: 1440, height: 6000 } });
let failures = 0;

try {
  await page.goto(url);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => window.__ursaView !== undefined);
  await page.waitForTimeout(800);
  await page.evaluate(async () => {
    const { useApp } = await import("/src/app/store.ts");
    const { revealNote } = await import("/src/app/notes.ts");
    const note = Object.values(useApp.getState().notes).find((n) => n.title === "Rythme vertical");
    revealNote(note.id);
  });
  // Stickers and post-its are drawn above the text: the rhythm must not move.
  await page.waitForTimeout(300);
  const decorations = await page.evaluate(() => ({
    stickers: document.querySelectorAll(".cm-sticker:not(.cm-postit)").length,
    postits: document.querySelectorAll(".cm-postit").length,
  }));
  if (decorations.stickers === 0 || decorations.postits === 0) {
    console.error(`✗ stickers and post-its expected on the note (found ${decorations.stickers} / ${decorations.postits})`);
    failures++;
  } else console.log(`✓ ${decorations.stickers} stickers and ${decorations.postits} post-its present`);

  for (const font of FONTS) {
    for (const size of SIZES) {
      const { out: problems, lines, blocks, backlinks, images } = await page.evaluate(lineCheck, { font, size, EPS });
      const tag = `${font} ${size}px`;
      if (problems.length) {
        failures += problems.length;
        console.error(`✗ ${tag}\n  ${problems.slice(0, 12).join("\n  ")}${problems.length > 12 ? `\n  … ${problems.length - 12} more` : ""}`);
      } else console.log(`✓ ${tag} (${lines} lignes, ${blocks} blocs, ${images} images${backlinks ? ", rétroliens" : ""})`);
    }
  }

  // Block alignment (decision P11-2): every paragraph, heading, quote and list
  // item centred, right-aligned or justified in turn; the rhythm must not move.
  const alignedCount = await page.evaluate(async () => {
    const v = window.__ursaView;
    const { blocksOf } = await import("/src/core/stickers.ts");
    const { isAlignable } = await import("/src/core/align.ts");
    const { alignTransaction } = await import("/src/editor/align.ts");
    const blocks = blocksOf(v.state.doc.toString().split("\n")).filter((b) => isAlignable(b.type));
    const kinds = ["center", "right", "justify"];
    v.dispatch(alignTransaction(blocks.map((b, i) => ({ pos: v.state.doc.line(b.from).from, before: null, after: kinds[i % 3] }))));
    return { blocks: blocks.length, lines: document.querySelectorAll(".cm-align-center, .cm-align-right, .cm-align-justify").length };
  });
  if (alignedCount.lines === 0) {
    failures++;
    console.error("✗ alignement : aucune ligne alignée");
  }
  for (const font of FONTS) {
    for (const size of [14, 16.5, 20]) {
      const { out: problems, lines } = await page.evaluate(lineCheck, { font, size, EPS });
      const tag = `aligné ${font} ${size}px`;
      if (problems.length) {
        failures += problems.length;
        console.error(`✗ ${tag}\n  ${problems.slice(0, 12).join("\n  ")}`);
      } else console.log(`✓ ${tag} (${alignedCount.blocks} blocs centrés, à droite ou justifiés, ${lines} lignes)`);
    }
  }
  await page.evaluate(async () => {
    const { loadAligns } = await import("/src/editor/align.ts");
    window.__ursaView.dispatch({ effects: loadAligns.of([]) });
  });

  // Windows display scaling (decision P10-15): a real scale factor, as on
  // Windows (Playwright's emulated one lays the page out differently).
  for (const dpr of SCALES) {
    const label = `${Math.round(dpr * 100)} %`;
    const scaledBrowser = await chromium.launch({ args: [`--force-device-scale-factor=${dpr}`, "--window-size=1440,2400"] });
    const scaled = await (await scaledBrowser.newContext({ viewport: null })).newPage();
    await openNote(scaled);
    for (const font of FONTS) {
      const { out } = await scaled.evaluate(lineCheck, { font, size: 16.5, EPS });
      if (out.length) {
        failures += out.length;
        console.error(`✗ ${label} ${font} 16.5px\n  ${out.slice(0, 8).join("\n  ")}`);
      } else console.log(`✓ ${label} ${font} 16.5px : rythme tenu`);
    }
    failures += await checkPaper(scaled, label);

    // Moving the window to a screen with another scale, without reloading:
    // the app follows (--dpr, red margin measured again).
    if (dpr === 1.25) {
      const cdp = await scaled.context().newCDPSession(scaled);
      const { width, height } = await scaled.evaluate(() => ({ width: innerWidth, height: innerHeight }));
      await cdp.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1.75, mobile: false });
      await scaled.waitForTimeout(300);
      const after = await scaled.evaluate(() => ({
        dpr: parseFloat(document.documentElement.style.getPropertyValue("--dpr")),
        margin: parseFloat(getComputedStyle(window.__ursaView.contentDOM, "::before").width),
      }));
      // 1.5 px at 175 % = 3 physical pixels (layout keeps 1/64 px steps).
      if (Math.abs(after.dpr - 1.75) > 0.001 || Math.abs(after.margin * 1.75 - 3) > 0.05) {
        failures++;
        console.error(`✗ 125 % → 175 % : --dpr ${after.dpr}, marge rouge de ${after.margin} px (${(after.margin * 1.75).toFixed(2)} pixels physiques)`);
      } else console.log("✓ 125 % → 175 % : échelle suivie sans recharger (épaisseurs recalculées)");
    }
    await scaledBrowser.close();
  }
} finally {
  await browser.close();
  await server.close();
}
process.exit(failures ? 1 : 0);
