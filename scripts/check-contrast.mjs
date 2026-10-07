// WCAG 2.1 AA contrast of the 6 themes [DESIGN §5] — part of `npm run check`.
// Reads the colours straight from src/styles/tokens.css (translucent ones are
// laid over the background they sit on) and checks every text / background
// pair the interface uses: 4.5:1 for text, 3:1 for interface parts (focus
// ring, accent-filled controls against the page). Component tokens
// (tokens.components.css, color-mix included) are read too.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (p) => readFileSync(fileURLToPath(new URL(`../src/styles/${p}`, import.meta.url)), "utf8");
const THEMES = ["coral", "sage", "ink", "kraft", "graphite", "blue"];

/** Top-level blocks of a token file (media queries left out). */
const blocksOf = (css) =>
  [...css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/@media[^{]*\{(?:[^{}]*\{[^}]*\})*[^{}]*\}/g, "").matchAll(/([^{}]+)\{([^}]*)\}/g)].map(([, sel, body]) => ({
    selectors: sel.split(",").map((x) => x.trim()),
    decls: Object.fromEntries([...body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map(([, k, v]) => [k, v.trim()])),
  }));
// Design tokens, then component tokens (src/styles/tokens.components.css), in cascade order.
const blocks = [...blocksOf(read("tokens.css")), ...blocksOf(read("tokens.components.css"))];
const theme = (t) =>
  Object.assign({}, ...blocks.filter((b) => b.selectors.some((x) => x === ":root" || x === `[data-theme="${t}"]`)).map((b) => b.decls));

/** [r, g, b, a] from #RGB, #RRGGBB or rgba(); null for anything else. */
function parse(value) {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value);
  if (hex) {
    const h = hex[1].length === 3 ? [...hex[1]].map((c) => c + c).join("") : hex[1];
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).concat(1);
  }
  const rgba = /^rgba?\(([^)]+)\)$/i.exec(value);
  if (rgba) {
    const [r, g, b, a = "1"] = rgba[1].split(",").map((s) => s.trim());
    return [Number(r), Number(g), Number(b), Number(a)];
  }
  return null;
}

// sRGB <-> OKLab, for color-mix(in oklab, …).
const lin = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const gam = (v) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
function toOklab([r, g, b]) {
  const [R, G, B] = [r, g, b].map((v) => lin(v / 255));
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
function fromOklab([L, a, b]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const rgb = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
  return rgb.map((v) => Math.round(Math.min(1, Math.max(0, gam(v))) * 255));
}

function resolve(vars, name, seen = new Set()) {
  const raw = vars[name];
  if (raw === undefined) throw new Error(`${name} is not defined`);
  if (seen.has(name)) throw new Error(`${name}: circular`);
  seen.add(name);
  return colour(vars, raw, seen, name);
}

function colour(vars, raw, seen, name) {
  const ref = /^var\((--[\w-]+)\)$/.exec(raw);
  if (ref) return resolve(vars, ref[1], seen);
  // color-mix(in oklab, A [p%], B [q%]) between opaque colours.
  const mix = /^color-mix\(in oklab,\s*(.+?)(?:\s+([\d.]+)%)?,\s*(.+?)(?:\s+([\d.]+)%)?\)$/.exec(raw);
  if (mix) {
    const [, a, pa, b, pb] = mix;
    const wa = pa !== undefined ? pa / 100 : pb !== undefined ? 1 - pb / 100 : 0.5;
    const [ca, cb] = [colour(vars, a, new Set(seen), name), colour(vars, b, new Set(seen), name)];
    if (ca[3] < 1 || cb[3] < 1) throw new Error(`${name}: color-mix of translucent colours not handled`);
    const [la, lb] = [toOklab(ca), toOklab(cb)];
    return fromOklab(la.map((v, i) => v * wa + lb[i] * (1 - wa))).concat(1);
  }
  const c = parse(raw);
  if (!c) throw new Error(`${name}: cannot read "${raw}"`);
  return c;
}

const over = (top, under) => {
  const a = top[3];
  return [0, 1, 2].map((i) => top[i] * a + under[i] * (1 - a)).concat(1);
};
const luminance = ([r, g, b]) => {
  const ch = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
};
const ratio = (a, b) => {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
};

/**
 * [foreground, background, minimum, where]. Backgrounds that are themselves
 * translucent (hover, active…) are given as "token/over-token".
 */
const TEXT = 4.5;
const UI = 3;
const PAIRS = [
  // DESIGN §5 table
  ["--text", "--bg-2", TEXT, "texte de la note"],
  ["--text-2", "--bg-2", TEXT, "texte secondaire"],
  ["--text-3", "--bg-1", TEXT, "méta de la liste"],
  ["--text-3", "--bg-sunken", TEXT, "aide sur fond enfoncé"],
  ["--accent-text", "--bg-2", TEXT, "liens, tags"],
  ["--accent-text", "--accent-soft", TEXT, "pastille de tag, sélection"],
  ["--on-accent", "--accent-solid", TEXT, "bouton principal"],
  ["--chrome-text", "--bg-0", TEXT, "barre latérale"],
  ["--chrome-text-2", "--bg-0", TEXT, "barre latérale, secondaire"],
  ["--chrome-tag-text", "--chrome-tag-bg", TEXT, "tag actif de la barre latérale"],
  ["--postit-text", "--postit-yellow", TEXT, "post-it jaune"],
  ["--postit-text", "--postit-pink", TEXT, "post-it rose"],
  ["--postit-text", "--postit-green", TEXT, "post-it vert"],
  ["--postit-text", "--postit-blue", TEXT, "post-it bleu"],
  // Also used by the interface
  ["--text", "--bg-1", TEXT, "titres de la liste"],
  ["--text-2", "--bg-1", TEXT, "extrait des cartes"],
  ["--text-3", "--bg-2", TEXT, "méta de l'éditeur, états vides"],
  ["--text-2", "--bg-raised", TEXT, "menus, palette"],
  ["--text-3-raised", "--bg-raised", TEXT, "menus, modales, palette : texte tertiaire"],
  ["--text-3-raised", "--selected", TEXT, "date de la carte sélectionnée"],
  ["--text", "--active/--bg-1", TEXT, "carte sélectionnée au clavier"],
  ["--text", "--highlight", TEXT, "surlignage"],
  ["--text", "--match/--bg-2", TEXT, "occurrence trouvée"],
  ["--chrome-text", "--chrome-active", TEXT, "section active de la barre latérale"],
  ["--chrome-text-3", "--bg-0", TEXT, "compteurs de la barre latérale"],
  ["--chrome-count-active", "--chrome-active", TEXT, "compteur de la section active"],
  ["--accent-text-sunken", "--bg-sunken", TEXT, "« Modifier… » du dossier d'export"],
  ["--search-hint", "--chrome-sunken", TEXT, "champ de recherche : texte indicatif, Ctrl K"],
  ["--danger-text", "--bg-raised", TEXT, "action destructive d'un menu"],
  ["--danger-text", "--bg-2", TEXT, "note non enregistrée"],
  ["--danger-text", "--danger-soft", TEXT, "message d'erreur"],
  // Interface parts (WCAG 1.4.11)
  ["--focus-ring", "--bg-2", UI, "anneau de focus, éditeur"],
  ["--focus-ring", "--bg-1", UI, "anneau de focus, liste"],
  ["--focus-ring", "--bg-raised", UI, "anneau de focus, modales"],
  ["--accent-solid", "--bg-2", UI, "bouton principal, toggle activé"],
];

let failures = 0;
const lowest = new Map();
for (const t of THEMES) {
  const vars = theme(t);
  for (const [fg, bg, min, where] of PAIRS) {
    try {
      const [top, under] = bg.split("/");
      let back = resolve(vars, top);
      if (under) back = over(back, resolve(vars, under));
      else if (back[3] < 1) throw new Error(`${bg} is translucent: give the colour it sits on`);
      const front = over(resolve(vars, fg), back);
      const r = ratio(front, back);
      const key = `${fg} / ${bg}`;
      if (!lowest.has(key) || r < lowest.get(key).r) lowest.set(key, { r, t });
      if (r < min) {
        failures++;
        console.error(`✗ ${t}: ${key} = ${r.toFixed(2)}:1 < ${min}:1 (${where})`);
      }
    } catch (e) {
      failures++;
      console.error(`✗ ${t}: ${fg} / ${bg}: ${e.message}`);
    }
  }
}
if (!failures) {
  const worst = [...lowest].sort((a, b) => a[1].r - b[1].r)[0];
  console.log(`✓ contrastes AA : ${PAIRS.length} paires × ${THEMES.length} thèmes (minimum ${worst[1].r.toFixed(2)}:1, ${worst[0]} en ${worst[1].t})`);
}
process.exit(failures ? 1 : 0);
