// Typewriter mode — `npm run test:typewriter`.
// On the 5 000-line note, lined paper, two folded sections and a sticker, in a
// real browser (in-memory vault):
// 1. switched on from the "…" menu (which takes the focus): the cursor's line
//    is centred, not the start of the note, and the editor has the focus back;
// 2. a click, a mouse selection and the wheel never move the text, and the
//    text stays where the wheel left it;
// 3. typing and the up / down arrows recentre the line, smoothly;
// 4. the vertical rhythm holds (every line on the paper's rules);
// 5. switched off, the cursor's line stays where it is on screen.
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

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on("pageerror", (e) => {
    failures++;
    console.error(`✗ page error: ${e.message}`);
  });
  await page.goto(url);
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem("ursa-dev-settings", JSON.stringify({ welcomed: true, editor: { paper: "lined" } }));
  });
  await page.reload();
  await page.waitForFunction(() => window.__ursaView !== undefined);
  await page.waitForTimeout(600);

  // The long note, lined paper; a cursor around line 1 500 placed with the mouse.
  await page.evaluate(async () => {
    const { useApp } = await import("/src/app/store.ts");
    const { revealNote } = await import("/src/app/notes.ts");
    revealNote(Object.values(useApp.getState().notes).find((n) => n.path.startsWith("Note longue")).id);
  });
  await page.waitForTimeout(500);
  const setup = await page.evaluate(async () => {
    const v = window.__ursaView;
    const { toggleFold } = await import("/src/editor/sections/fold.ts");
    const { headingsIn } = await import("/src/editor/sections/headings.ts");
    const { addSticker } = await import("/src/editor/session.ts");
    const { useApp } = await import("/src/app/store.ts");
    // Two sections folded before the cursor, one after: heights above and below change.
    const target = v.state.doc.line(1500).from;
    const headings = headingsIn(v.state).map((h) => h.from);
    const before = headings.filter((h) => h < target).slice(-3, -1);
    const after = headings.find((h) => h > target + 2000);
    for (const h of [...before, after]) if (h !== undefined) toggleFold(v, h);
    v.dispatch({ selection: { anchor: target }, scrollIntoView: true });
    await new Promise((r) => setTimeout(r, 300));
    // A sticker beside the text.
    const r = v.scrollDOM.getBoundingClientRect();
    addSticker(useApp.getState().selectedId, { kind: "sticker", asset: "fluent/sparkles" }, { x: r.left + r.width * 0.75, y: r.top + r.height * 0.4 });
    const { stickersField } = await import("/src/editor/stickers/state.ts");
    return { folded: before.length + (after === undefined ? 0 : 1), stickers: v.state.field(stickersField).length };
  });
  check(setup.folded === 3, "sections repliées", `${setup.folded}`);
  check(setup.stickers > 0, "sticker posé à côté du texte", `${setup.stickers}`);

  // A click on a visible line, 1/3 from the top: the cursor goes there.
  const box = await page.evaluate(() => {
    const r = window.__ursaView.scrollDOM.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  });
  await page.mouse.click(box.x + box.w * 0.3, box.y + box.h * 0.3);
  await page.waitForTimeout(200);

  const state = () =>
    page.evaluate(() => {
      const v = window.__ursaView;
      const scroller = v.scrollDOM;
      const r = scroller.getBoundingClientRect();
      const head = v.state.selection.main.head;
      const c = v.coordsAtPos(head, 1) ?? v.coordsAtPos(head, -1);
      return {
        scrollTop: scroller.scrollTop,
        line: v.state.doc.lineAt(head).number,
        // Distance from the scroller's centre to the middle of the cursor's line.
        offset: c ? (c.top + c.bottom) / 2 - (r.top + scroller.clientHeight / 2) : null,
        screenY: c ? c.top : null,
        focused: v.hasFocus,
      };
    });
  const settle = async () => {
    // Waits for a smooth scroll to end (scrollTop stable over a few frames).
    let last = -1;
    for (let i = 0; i < 60; i++) {
      const top = await page.evaluate(() => window.__ursaView.scrollDOM.scrollTop);
      if (top === last) return;
      last = top;
      await page.waitForTimeout(50);
    }
  };
  const before = await state();
  check(before.line > 100, "curseur posé au milieu de la note", `ligne ${before.line}`);

  // 1. Switched on from the "…" menu.
  await page.getByRole("button", { name: "Plus d'actions" }).click();
  await page.getByRole("menuitemcheckbox", { name: "Mode machine à écrire" }).or(page.getByRole("menuitem", { name: "Mode machine à écrire" })).click();
  await page.waitForTimeout(150);
  await settle();
  const on = await state();
  check(on.line === before.line, "activation : le curseur n'a pas bougé", `ligne ${on.line}`);
  check(on.offset !== null && Math.abs(on.offset) <= 2, "activation : la ligne du curseur est centrée", `écart ${on.offset?.toFixed(1)} px`);
  check(on.focused, "activation : le focus revient à l'éditeur");

  // 2. A click elsewhere never moves the text.
  await page.mouse.click(box.x + box.w * 0.3, box.y + box.h * 0.2);
  await page.waitForTimeout(500);
  const clicked = await state();
  check(Math.abs(clicked.scrollTop - on.scrollTop) < 0.5, "clic : le texte ne bouge pas", `défilement ${(clicked.scrollTop - on.scrollTop).toFixed(1)} px, ligne ${clicked.line}`);

  // A selection made with the mouse.
  await page.mouse.move(box.x + box.w * 0.25, box.y + box.h * 0.35);
  await page.mouse.down();
  await page.mouse.move(box.x + box.w * 0.5, box.y + box.h * 0.55, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(500);
  const selected = await state();
  check(Math.abs(selected.scrollTop - clicked.scrollTop) < 0.5, "sélection à la souris : le texte ne bouge pas", `défilement ${(selected.scrollTop - clicked.scrollTop).toFixed(1)} px`);

  // The wheel scrolls freely, and the text stays there.
  await page.mouse.move(box.x + box.w * 0.5, box.y + box.h * 0.5);
  await page.mouse.wheel(0, 700);
  await page.waitForTimeout(300);
  const wheeled = await state();
  await page.waitForTimeout(800);
  const still = await state();
  check(wheeled.scrollTop - selected.scrollTop > 300, "molette : le défilement est libre", `${(wheeled.scrollTop - selected.scrollTop).toFixed(0)} px`);
  check(Math.abs(still.scrollTop - wheeled.scrollTop) < 0.5, "molette : le texte reste où on l'a laissé");

  // 3. The next keystroke recentres (the cursor is far above, off screen).
  await page.keyboard.press("End");
  await page.keyboard.type("x");
  await settle();
  const typed = await state();
  check(typed.offset !== null && Math.abs(typed.offset) <= 2, "frappe : la ligne revient au centre", `écart ${typed.offset?.toFixed(1)} px`);

  // Typing within the line: nothing moves.
  await page.keyboard.type("yz");
  await page.waitForTimeout(300);
  const again = await state();
  check(Math.abs(again.scrollTop - typed.scrollTop) < 0.5, "frappe dans la ligne : aucun saut");

  // Arrows down and up: centred each time, and the scroll is animated (several frames).
  const frames = [];
  for (const key of ["ArrowDown", "ArrowDown", "ArrowDown", "ArrowUp"]) {
    await page.keyboard.press(key);
    const steps = new Set();
    for (let i = 0; i < 12; i++) {
      steps.add(Math.round(await page.evaluate(() => window.__ursaView.scrollDOM.scrollTop)));
      await page.waitForTimeout(16);
    }
    frames.push(steps.size);
    await settle();
    const s = await state();
    check(s.offset !== null && Math.abs(s.offset) <= 2, `${key} : ligne centrée`, `ligne ${s.line}, écart ${s.offset?.toFixed(1)} px`);
  }
  check(frames.some((n) => n > 2), "recentrage animé (défilement doux)", `positions intermédiaires : ${frames.join(", ")}`);

  // 4. Rhythm: every visible line on the paper's rules.
  const offRhythm = await page.evaluate(() => {
    const v = window.__ursaView;
    const rhythm = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--rhythm"));
    const paperTop = v.scrollDOM.getBoundingClientRect().top + v.scrollDOM.clientTop - v.scrollDOM.scrollTop;
    const out = [];
    for (const el of v.contentDOM.querySelectorAll(".cm-line:not(.cm-code)")) {
      const cs = getComputedStyle(el);
      const shift = cs.position === "relative" ? parseFloat(cs.top) || 0 : 0;
      const y = el.getBoundingClientRect().top - paperTop - shift;
      const m = ((y % rhythm) + rhythm) % rhythm;
      if (Math.min(m, rhythm - m) > 0.6) out.push(`l.${v.state.doc.lineAt(v.posAtDOM(el)).number} +${m.toFixed(2)}`);
    }
    return out;
  });
  check(offRhythm.length === 0, "rythme tenu en mode machine à écrire (fond ligné)", offRhythm.slice(0, 5).join(", "));

  // 5. Switched off from the palette: the cursor's line stays where it is.
  const lastOn = await state();
  await page.keyboard.press("Control+p");
  await page.keyboard.type("machine");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(400);
  const off = await state();
  check(Math.abs(off.screenY - lastOn.screenY) <= 1, "désactivation : la ligne reste à sa place", `${(off.screenY - lastOn.screenY).toFixed(1)} px`);
  check(off.focused, "désactivation : le focus est dans l'éditeur");
} finally {
  await browser.close();
  await server.close();
}
process.exit(failures ? 1 : 0);
