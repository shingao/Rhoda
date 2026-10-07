// Accessibility audit — `npm run test:a11y`.
// Runs axe-core (WCAG 2.1 A/AA rules) on the main screens of the app in a real
// browser (in-memory vault), then checks what axe cannot see:
// - prefers-reduced-motion: durations at 0 except fades [DESIGN §4];
// - forced colours (Windows high contrast): borders on cards, fields, modals
//   and a visible focus [DESIGN §5];
// - keyboard: every focusable element shows a focus ring.
// Needs Chromium for Playwright.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { chromium } from "playwright";
import { createServer } from "vite";

const require = createRequire(import.meta.url);
const axeSource = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");

const server = await createServer({ server: { port: 0, strictPort: false }, logLevel: "error" });
await server.listen();
const url = server.resolvedUrls.local[0];
const browser = await chromium.launch();
let failures = 0;

const fail = (label, lines) => {
  failures += lines.length;
  console.error(`✗ ${label}\n  ${lines.slice(0, 10).join("\n  ")}${lines.length > 10 ? `\n  … ${lines.length - 10} more` : ""}`);
};

async function open(page) {
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
    revealNote(Object.values(useApp.getState().notes).find((n) => n.title === "Journal décoré" || n.path === "Journal décoré.md").id);
  });
  await page.waitForTimeout(400);
}

const set = (page, patch) =>
  page.evaluate(async (patch) => {
    const { setState } = await import("/src/app/store.ts");
    setState(patch);
  }, patch);

async function audit(page, label, prepare) {
  await prepare?.();
  await page.waitForTimeout(350);
  await page.evaluate(axeSource);
  const result = await page.evaluate(() =>
    window.axe.run(document, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] },
      // Decorative stickers are aria-hidden images; CodeMirror's own content is a textbox.
      resultTypes: ["violations"],
    }),
  );
  const lines = result.violations.flatMap((v) => v.nodes.slice(0, 3).map((n) => `${v.id} (${v.impact}): ${n.target.join(" ")} — ${n.failureSummary?.split("\n")[1]?.trim() ?? v.help}`));
  if (lines.length) fail(`axe : ${label}`, lines);
  else console.log(`✓ axe : ${label}`);
}

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await open(page);

  // 1. axe on each screen.
  await audit(page, "fenêtre principale, note ouverte");
  await audit(page, "palette de commandes", () => page.keyboard.press("Control+p"));
  await page.keyboard.press("Escape");
  for (const p of ["general", "editor", "shortcuts", "ocr", "backups", "about"]) {
    await audit(page, `réglages › ${p}`, () => set(page, { settingsPage: p }));
  }
  await set(page, { settingsPage: null });
  await audit(page, "export", () =>
    page.evaluate(async () => {
      const { useApp } = await import("/src/app/store.ts");
      const { openExport } = await import("/src/app/export/index.ts");
      openExport([useApp.getState().selectedId], "Journal décoré");
    }),
  );
  await page.keyboard.press("Escape");
  await audit(page, "tiroir à stickers", () => set(page, { stickerDrawer: true }));
  await set(page, { stickerDrawer: false });
  await audit(page, "recherche sans résultat", async () => {
    await page.keyboard.press("Control+k");
    await page.keyboard.type("zzzquintessence");
  });
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await audit(page, "corbeille vide", () => set(page, { filter: { kind: "section", section: "archive" }, selectedId: null }));
  await set(page, { filter: { kind: "section", section: "notes" } });

  // Same screens in the other five palettes (contrast depends on the theme).
  for (const [mode, palette] of [["light", "sage"], ["light", "ink"], ["light", "kraft"], ["dark", "graphite"], ["dark", "blue"]]) {
    await open(page);
    await page.evaluate(
      async ([mode, palette]) => {
        const { updateSettings } = await import("/src/app/store.ts");
        updateSettings((s) => ({ ...s, appearance: { ...s.appearance, mode, [mode]: palette } }));
      },
      [mode, palette],
    );
    await audit(page, `thème ${palette} : fenêtre principale`);
    await audit(page, `thème ${palette} : palette`, () => page.keyboard.press("Control+p"));
    await page.keyboard.press("Escape");
    await audit(page, `thème ${palette} : réglages`, () => set(page, { settingsPage: "general" }));
    await set(page, { settingsPage: null });
  }

  // 2. Keyboard: Tab through the window; every stop shows a focus ring (or is the editor, whose caret shows it).
  await open(page);
  await page.mouse.click(5, 895);
  const stops = [];
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press("Tab");
    stops.push(
      await page.evaluate(() => {
        const el = document.activeElement;
        if (!el || el === document.body) return null;
        const cs = getComputedStyle(el);
        const ring = (cs.boxShadow !== "none" && cs.boxShadow !== "") || (cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0);
        const name = el.getAttribute("aria-label") || el.textContent?.trim().slice(0, 30) || el.tagName;
        return { name, ring: ring || el.classList.contains("cm-content"), visible: el.getBoundingClientRect().width > 0 };
      }),
    );
  }
  const noRing = stops.filter((s) => s && s.visible && !s.ring).map((s) => `pas d'anneau de focus : ${s.name}`);
  if (noRing.length) fail("clavier : focus visible", [...new Set(noRing)]);
  else console.log(`✓ clavier : focus visible sur ${new Set(stops.filter(Boolean).map((s) => s.name)).size} arrêts de tabulation`);

  // F6 / Maj+F6 go round the zones [DESIGN §5].
  const zones = [];
  for (const key of ["F6", "F6", "F6", "F6", "F6", "Shift+F6"]) {
    await page.keyboard.press(key);
    zones.push(await page.evaluate(() => document.activeElement?.closest("[data-zone]")?.getAttribute("data-zone") ?? "—"));
  }
  const expected = ["titlebar", "sidebar", "list", "editor", "titlebar", "editor"];
  if (zones.join() !== expected.join()) fail("clavier : F6", [`zones ${zones.join(" → ")} (attendu ${expected.join(" → ")})`]);
  else console.log(`✓ clavier : F6 / Maj+F6 ${zones.join(" → ")}`);

  // 3. Reduced motion [DESIGN §4]: durations 0 except fades (80 ms).
  const reduced = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  await open(reduced);
  const motion = await reduced.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    const ms = (v) => (v.endsWith("ms") ? parseFloat(v) : parseFloat(v) * 1000);
    return ["--dur-instant", "--dur-fast", "--dur-base", "--dur-slow", "--dur-check", "--caret-blink", "--dur-popover-in", "--dur-popover-out"].map((t) => [t, root.getPropertyValue(t).trim(), ms(root.getPropertyValue(t).trim() || "0")]);
  });
  // Popover fades stay at 80 ms [DESIGN §4]; everything else stops.
  const moving = motion.filter(([t, , v]) => (t.startsWith("--dur-popover") ? v > 80 : v > 0)).map(([t, raw]) => `${t} = ${raw}`);
  if (moving.length) fail("mouvement réduit", moving);
  else console.log(`✓ mouvement réduit : ${motion.map(([t, raw]) => `${t} ${raw || "—"}`).join(", ")}`);
  await reduced.close();

  // 4. Forced colours (Windows high contrast) [DESIGN §5].
  const forced = await browser.newPage({ viewport: { width: 1440, height: 900 }, forcedColors: "active" });
  await open(forced);
  const borders = await forced.evaluate(async () => {
    const out = [];
    const border = (el, what) => {
      if (!el) return out.push(`${what} : introuvable`);
      const cs = getComputedStyle(el);
      if (parseFloat(cs.borderTopWidth) < 1 && (cs.outlineStyle === "none" || parseFloat(cs.outlineWidth) < 1)) out.push(`${what} : pas de bordure`);
    };
    border(document.querySelector('[role="option"][aria-selected="true"]'), "carte sélectionnée");
    border(document.querySelector('header input')?.closest("label"), "champ de recherche");
    border(document.querySelector(".cm-checkbox"), "case à cocher");
    border([...document.querySelectorAll("header button")].find((b) => b.textContent?.trim()), "bouton « Nouvelle note »");
    return out;
  });
  await forced.keyboard.press("Control+p");
  await forced.waitForTimeout(300);
  borders.push(
    ...(await forced.evaluate(() => {
      const el = document.querySelector('[role="dialog"]');
      return el && parseFloat(getComputedStyle(el).borderTopWidth) >= 1 ? [] : ["palette : pas de bordure"];
    })),
  );
  await forced.keyboard.press("Escape");
  await forced.keyboard.press("Tab");
  borders.push(
    ...(await forced.evaluate(() => {
      const cs = getComputedStyle(document.activeElement);
      return cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) >= 1 ? [] : [`focus sans contour : ${document.activeElement?.tagName}`];
    })),
  );
  if (borders.length) fail("contraste élevé", borders);
  else console.log("✓ contraste élevé : bordures sur carte, champ, case à cocher, bouton, palette ; focus en contour");
  await forced.close();
} finally {
  await browser.close();
  await server.close();
}
process.exit(failures ? 1 : 0);
