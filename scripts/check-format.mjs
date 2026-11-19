// Formatting toolbar — `npm run test:format`.
// In a real browser (in-memory vault), on a new note:
// 1. Ctrl+B / I / U, Ctrl+Shift+X: added around the word at the cursor, removed
//    when inside, the buttons pressed meanwhile; Ctrl+Z undoes each step;
// 2. highlight colours (menu), relative sizes (a large line = 2 × --rhythm),
//    block styles (headings, quote, code), lists (Ctrl+Shift+7 / 8 / 9 by
//    physical key, AZERTY included), link, separator, clear formatting;
// 3. "Aa": font and size of the whole note (frontmatter `font:`, `size:`) and
//    of the selection, undoable; the "Lists" menu;
// 4. 1 440 px with sidebar and list: the whole bar; alignment, then insert,
//    fold into one menu each; "…" only below about 1 200 px; focus mode and
//    the setting hide the bar.
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
  await page.evaluate(async () => {
    const { createNote } = await import("/src/app/notes.ts");
    await createNote();
  });

  const set = (text, anchor, head = anchor) =>
    page.evaluate(
      ([text, anchor, head]) => {
        const v = window.__ursaView;
        v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: text } });
        v.dispatch({ selection: { anchor, head } });
        v.focus();
      },
      [text, anchor, head],
    );
  const doc = () => page.evaluate(() => window.__ursaView.state.doc.toString());
  const select = (anchor, head = anchor) => page.evaluate(([a, h]) => window.__ursaView.dispatch({ selection: { anchor: a, head: h } }), [anchor, head]);
  const pressed = (label) => page.evaluate((label) => document.querySelector(`[role=toolbar] button[aria-label="${label}"]`)?.getAttribute("aria-pressed"), label);
  const settle = () => page.waitForTimeout(80);
  const undo = async (n = 1) => {
    for (let i = 0; i < n; i++) await page.keyboard.press("Control+z");
    await settle();
  };

  // 1. Inline marks.
  await set("Un mot ici", 4);
  const bar = await page.locator("[role=toolbar]").count();
  check(bar === 1, "barre de mise en forme affichée sous la barre de l'éditeur");
  await page.keyboard.press("Control+b");
  await settle();
  check((await doc()) === "Un **mot** ici", "Ctrl+B met le mot du curseur en gras", await doc());
  check((await pressed("Gras")) === "true", "bouton Gras enfoncé dans le gras");
  await page.keyboard.press("Control+b");
  await settle();
  check((await doc()) === "Un mot ici", "Ctrl+B dans le gras le retire", await doc());
  await page.keyboard.press("Control+i");
  await page.keyboard.press("Control+u");
  await page.keyboard.press("Control+Shift+x");
  await settle();
  check((await doc()) === "Un *<u>~~mot~~</u>* ici", "italique, souligné (<u>), barré, imbriqués", await doc());
  check((await pressed("Souligné")) === "true" && (await pressed("Italique")) === "true", "boutons Italique et Souligné enfoncés");
  await undo(3);
  check((await doc()) === "Un mot ici", "Ctrl+Z annule chaque mise en forme, dans l'historique du texte", await doc());

  // 2. Highlight colours, from the menu.
  await set("Un mot ici", 3, 6);
  await page.click('[role=toolbar] button[aria-label="Surligner"]');
  await page.click('[role=menuitemradio]:has-text("Vert")');
  await settle();
  check((await doc()) === 'Un <mark data-color="green">mot</mark> ici', "surlignage vert en <mark data-color>", await doc());
  const green = await page.evaluate(() => {
    const el = document.querySelector(".cm-mark-green");
    return el ? getComputedStyle(el).backgroundColor : null;
  });
  check(green !== null && green !== "rgba(0, 0, 0, 0)", "surlignage vert affiché", green ?? "absent");
  await page.click('[role=toolbar] button[aria-label="Surligner"]');
  await page.click('[role=menuitemradio]:has-text("Jaune")');
  await settle();
  check((await doc()) === "Un ==mot== ici", "jaune = == (couleur par défaut)", await doc());
  await page.keyboard.press("Control+Shift+y");
  await settle();
  check((await doc()) === "Un mot ici", "Ctrl+Maj+Y retire le surlignage", await doc());

  // Sizes: a large run makes its line exactly two rhythm units.
  await set("Un mot ici\n\nSuite", 4);
  await page.keyboard.press("Control+Shift+Period");
  await settle();
  check((await doc()).startsWith('Un <span data-size="lg">mot</span> ici'), "Ctrl+Maj+. agrandit (span data-size=lg)", await doc());
  await select(20);
  const heights = await page.evaluate(() => {
    const v = window.__ursaView;
    const rhythm = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--rhythm"));
    const line = v.contentDOM.querySelector(".cm-line-lg");
    return { rhythm, h: line?.getBoundingClientRect().height ?? 0 };
  });
  check(Math.abs(heights.h - 2 * heights.rhythm) < 0.5, "ligne « grande » = 2 × --rhythm", `${heights.h} px`);
  // The same from the "Aa" popover: small, normal.
  await select(4, 6);
  await page.click('[role=toolbar] button[aria-label="Police et taille"]');
  await page.getByRole("dialog", { name: "Police et taille" }).getByRole("radio", { name: "Normal" }).click();
  await settle();
  check((await doc()).startsWith("Un mot ici"), "« Aa » › Normal retire la taille", await doc());
  await page.getByRole("dialog", { name: "Police et taille" }).getByRole("radio", { name: "Grand" }).click();
  await settle();
  check((await doc()).startsWith('Un <span data-size="lg">mot</span> ici'), "« Aa » › Grand agrandit la sélection", await doc());
  await page.keyboard.press("Escape");
  await page.waitForTimeout(150);
  check((await page.getByRole("dialog", { name: "Police et taille" }).count()) === 0, "Échap ferme le popover « Aa »");
  await select(28);
  await page.keyboard.press("Control+Shift+Comma");
  await page.keyboard.press("Control+Shift+Comma");
  await settle();
  check((await doc()).startsWith('Un <span data-size="sm">mot</span> ici'), "Ctrl+Maj+, deux fois : petit (3 crans)", await doc());
  await page.keyboard.press("Control+Shift+Comma");
  await settle();
  check((await doc()).startsWith('Un <span data-size="sm">mot</span> ici'), "pas plus petit que « petit »");

  // Block styles from the dropdown.
  await set("Un paragraphe\nsur deux lignes", 2, 20);
  const block = (name) => page.click('[role=toolbar] button[aria-haspopup="menu"]').then(() => page.click(`[role=menuitemradio]:has-text("${name}")`));
  await block("Titre 2");
  await settle();
  check((await doc()) === "## Un paragraphe\n## sur deux lignes", "style Titre 2 sur les lignes sélectionnées", await doc());
  const label = await page.evaluate(() => document.querySelector("[role=toolbar] button[aria-haspopup=menu]")?.textContent);
  check(label === "Titre 2", "la liste déroulante montre le style courant", label ?? "");
  await block("Citation");
  await settle();
  check((await doc()) === "> Un paragraphe\n> sur deux lignes", "style Citation", await doc());
  await block("Code");
  await settle();
  check((await doc()) === "```\n> Un paragraphe\n> sur deux lignes\n```", "style Code : bloc clôturé", await doc());
  await select(8);
  await block("Texte");
  await settle();
  check((await doc()) === "> Un paragraphe\n> sur deux lignes", "Texte hors d'un bloc de code : clôtures retirées", await doc());
  await undo(4);
  check((await doc()) === "Un paragraphe\nsur deux lignes", "Ctrl+Z revient au texte de départ", await doc());

  // Font and size of the note: in its frontmatter, undone with Ctrl+Z.
  await set("Une note\n\nSon texte", 3);
  const choose = async (label, value) => {
    const popover = page.getByRole("dialog", { name: "Police et taille" });
    if ((await popover.count()) === 0) await page.click('[role=toolbar] button[aria-label="Police et taille"]');
    await popover.locator(`select[aria-label="${label}"]`).selectOption(value);
    await settle();
  };
  const look = () =>
    page.evaluate(() => {
      const st = getComputedStyle(window.__ursaView.contentDOM);
      return { family: st.fontFamily, size: st.fontSize };
    });
  const before = await look();
  await choose("Police de la note", "hand");
  await choose("Taille du texte de la note", "20");
  await page.keyboard.press("Escape");
  const after = await look();
  check(/^"?Caveat/.test(after.family) && after.size === "20px", "police manuscrite et 20 px pour toute la note", `${after.family.split(",")[0]} ${after.size}`);
  const saved = await page.evaluate(async () => {
    const { flushAll } = await import("/src/app/notes.ts");
    await flushAll();
    const { useApp } = await import("/src/app/store.ts");
    const st = useApp.getState();
    return st.notes[st.selectedId].frontmatter ?? "";
  });
  check(/^font: hand$/m.test(saved) && /^size: 20$/m.test(saved), "font: et size: écrits dans le frontmatter", saved.replace(/\n/g, " | "));
  await undo(2);
  const back = await look();
  check(back.family === before.family && back.size === before.size, "Ctrl+Z rend la police et la taille par défaut", `${back.family.split(",")[0]} ${back.size}`);

  // Lists by physical key (Digit7 = "è" on AZERTY, no Shift needed there).
  await set("Un\nDeux", 0, 6);
  await page.keyboard.press("Control+Shift+Digit7");
  await settle();
  check((await doc()) === "- Un\n- Deux", "Ctrl+Maj+7 : liste à puces", await doc());
  await page.keyboard.press("Control+Shift+Digit8");
  await settle();
  check((await doc()) === "1. Un\n2. Deux", "Ctrl+Maj+8 : liste numérotée", await doc());
  await page.keyboard.press("Control+Shift+Digit9");
  await settle();
  check((await doc()) === "- [ ] Un\n- [ ] Deux", "Ctrl+Maj+9 : liste de tâches", await doc());
  const listsActive = await page.evaluate(() => document.querySelector('[role=toolbar] button[aria-label="Listes"]')?.classList.length);
  await page.click('[role=toolbar] button[aria-label="Listes"]');
  const checkedList = await page.locator('[role=menu] [aria-checked="true"]').allTextContents();
  check(checkedList.length === 1 && checkedList[0].startsWith("Liste de tâches") && listsActive > 1, "menu « Listes » : tâche cochée, bouton actif", checkedList.join(", "));
  await page.getByRole("menuitemcheckbox", { name: /Liste numérotée/ }).click();
  await settle();
  check((await doc()) === "1. Un\n2. Deux", "menu « Listes » › Liste numérotée", await doc());
  await page.keyboard.press("Control+Shift+Digit8");
  await settle();
  check((await doc()) === "Un\nDeux", "le même raccourci à nouveau : plus de liste", await doc());

  // Link, separator, clear formatting.
  await set("Voir https://example.org", 5, 24);
  await page.keyboard.press("Control+l");
  await settle();
  check((await doc()) === "Voir [](https://example.org)", "Ctrl+L sur une URL : lien, curseur dans le texte", await doc());
  await set("Une ligne", 3);
  await page.click('[role=toolbar] button[aria-label="Séparateur"]');
  await settle();
  check((await doc()) === "Une ligne\n\n---\n", "séparateur après une ligne vide (jamais un titre Setext)", JSON.stringify(await doc()));
  await set('Du **gras**, ==surligné== et <u>souligné</u> <span data-size="lg">grand</span>', 0, 66);
  await page.keyboard.press("Control+Shift+Space");
  await settle();
  check((await doc()) === "Du gras, surligné et souligné grand", "Ctrl+Maj+Espace efface la mise en forme", await doc());
  await undo();
  check((await doc()).startsWith("Du **gras**"), "et Ctrl+Z la rend");

  // Code: inline formatting greyed out.
  await set("```\ncode\n```", 6);
  await settle();
  const disabled = await page.evaluate(() => document.querySelector('[role=toolbar] button[aria-label="Gras"]')?.disabled);
  check(disabled === true, "dans du code : Gras indisponible");

  // 3. Room (sidebar and list open): everything at 1 440 px, alignment then
  // insert folded into one menu each, "…" only below about 1 200 px.
  const more = page.locator('[role=toolbar] button[aria-label="Plus de mise en forme"]');
  const barState = () =>
    page.evaluate(() => {
      const el = document.querySelector("[role=toolbar]");
      const has = (label) => el.querySelector(`button[aria-label="${label}"]`) !== null;
      return { overflow: el.scrollWidth > el.clientWidth + 1, more: has("Plus de mise en forme"), alignButtons: has("Centrer"), alignMenu: has("Alignement"), insertButtons: has("Séparateur"), insertMenu: has("Insérer") };
    });
  for (const [width, want, label] of [
    [1440, { more: false, alignButtons: true, insertButtons: true }, "1 440 px : toute la barre, sans débordement"],
    [1280, { more: false, alignMenu: true, insertButtons: true }, "1 280 px : alignement dans un menu"],
    [1200, { more: false, alignMenu: true, insertMenu: true }, "1 200 px : alignement et insertion dans un menu, pas de « … »"],
    [1000, { more: true }, "1 000 px : les groupes de droite passent dans « … »"],
  ]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(250);
    const got = await barState();
    check(!got.overflow && Object.entries(want).every(([k, v]) => got[k] === v), label, JSON.stringify(got));
  }
  await set("Un mot", 3);
  await more.click();
  const entries = await page.locator("[role=menu] [role^=menuitem]").allTextContents();
  check(entries.some((e) => e.startsWith("Effacer la mise en forme")), "le menu « … » propose les actions masquées", `${entries.length} entrées`);
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(300);
  check((await more.count()) === 0, "retour à 1 440 px : plus de « … »");

  await page.evaluate(async () => (await import("/src/app/layout.ts")).toggleFocusMode());
  await page.waitForTimeout(400);
  const focus = await page.evaluate(() => {
    const row = document.querySelector("[role=toolbar]")?.parentElement;
    return row ? { opacity: getComputedStyle(row).opacity, inert: row.inert } : null;
  });
  check(focus?.opacity === "0" && focus.inert, "mode focus : barre masquée et inerte", JSON.stringify(focus));
  await page.evaluate(async () => (await import("/src/app/layout.ts")).toggleFocusMode());
  await page.evaluate(async () => (await import("/src/app/layout.ts")).toggleFormatBar());
  await page.waitForTimeout(200);
  check((await page.locator("[role=toolbar]").count()) === 0, "réglage : barre masquée");
} catch (e) {
  check(false, "exécution", e.stack ?? String(e));
} finally {
  await browser.close();
  await server.close();
}
process.exit(failures ? 1 : 0);
