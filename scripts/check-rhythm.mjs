// Vertical rhythm check [DESIGN §6] — `npm run test:rhythm`.
// Opens "Rythme vertical.md" in a real browser (in-memory vault) and checks,
// for both editor fonts and every allowed size (14–20 px), that:
// - every text line starts on a multiple of --rhythm and is a multiple tall;
// - every block (code, quote) starts on the rhythm and ends on it.
// Needs Chromium for Playwright (`npx playwright install chromium` once).
import { chromium } from "playwright";
import { createServer } from "vite";

const SIZES = [14, 14.5, 15, 15.5, 16, 16.5, 17, 17.5, 18, 18.5, 19, 19.5, 20];
const FONTS = ["sans", "serif"];
const EPS = 0.6;

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
      const { out: problems, lines, blocks, backlinks, images } = await page.evaluate(
        async ({ font, size, EPS }) => {
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
        },
        { font, size, EPS },
      );
      const tag = `${font} ${size}px`;
      if (problems.length) {
        failures += problems.length;
        console.error(`✗ ${tag}\n  ${problems.slice(0, 12).join("\n  ")}${problems.length > 12 ? `\n  … ${problems.length - 12} more` : ""}`);
      } else console.log(`✓ ${tag} (${lines} lignes, ${blocks} blocs, ${images} images${backlinks ? ", rétroliens" : ""})`);
    }
  }
} finally {
  await browser.close();
  await server.close();
}
process.exit(failures ? 1 : 0);
