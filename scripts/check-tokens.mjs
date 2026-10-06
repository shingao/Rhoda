// Checks that the code uses DESIGN.md tokens exactly (npm run check:tokens).
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

// fileURLToPath: on Windows, URL.pathname would be "/D:/…".
const root = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(root, p), "utf8");
const errors = [];
const info = [];

// 1. src/styles/tokens.css is a verbatim copy of design/ursa-tokens.css.
const tokens = read("src/styles/tokens.css");
if (tokens !== read("design/ursa-tokens.css")) errors.push("src/styles/tokens.css differs from design/ursa-tokens.css");
else info.push("tokens.css: identical to design/ursa-tokens.css");

// 2. Blocks and declarations of tokens.css.
const blocks = [...tokens.matchAll(/([^{}]+)\{([^}]*)\}/g)].map(([, sel, body]) => ({
  selector: sel.replace(/\/\*[\s\S]*?\*\//g, "").trim(),
  decls: Object.fromEntries([...body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map(([, k, v]) => [k, v.trim()])),
}));
const designTokens = new Set(blocks.flatMap((b) => Object.keys(b.decls)));
const THEMES = ["coral", "sage", "ink", "kraft", "graphite", "blue"];
const themeBlock = (t) => blocks.find((b) => b.selector.includes(`[data-theme="${t}"]`));
const base = Object.keys(themeBlock("coral")?.decls ?? {});
for (const t of THEMES) {
  const b = themeBlock(t);
  if (!b) { errors.push(`theme "${t}" missing in tokens.css`); continue; }
  const missing = base.filter((k) => !(k in b.decls));
  if (missing.length) errors.push(`theme "${t}" lacks ${missing.join(", ")}`);
}
info.push(`themes: ${THEMES.filter(themeBlock).length}/6 present, ${base.length} colour tokens each`);

// 3. Component tokens never redefine a design token (except the reduced-motion block, DESIGN §4).
const components = read("src/styles/tokens.components.css");
const reduced = components.match(/@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*\}\s*$/)?.[0] ?? "";
const componentMain = components.replace(reduced, "");
const componentTokens = new Set([...components.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));
for (const [, k] of componentMain.matchAll(/(--[\w-]+)\s*:/g)) {
  if (designTokens.has(k)) errors.push(`tokens.components.css redefines design token ${k}`);
}
for (const [, k] of reduced.matchAll(/(--[\w-]+)\s*:/g)) {
  if (designTokens.has(k) && !/^--dur-/.test(k)) errors.push(`reduced-motion block overrides non-duration token ${k}`);
}

// 4. Every var(--x) used in src is defined somewhere.
const files = [];
const walk = (d) => readdirSync(d).forEach((f) => { const p = join(d, f); statSync(p).isDirectory() ? walk(p) : files.push(p); });
walk(join(root, "src"));
const code = files.filter((f) => /\.(css|tsx?|)$/.test(f) && !/\.test\.ts$/.test(f) && !/styles[\\/]tokens/.test(f));
const locallyDefined = new Set();
for (const f of code) {
  const text = readFileSync(f, "utf8");
  for (const [, k] of text.matchAll(/(--[\w-]+)\s*:/g)) locallyDefined.add(k);
  for (const [, k] of text.matchAll(/["'`](--[\w-]+):/g)) locallyDefined.add(k);
  // Inline style objects: { ["--depth" as string]: n }
  for (const [, k] of text.matchAll(/\[["'`](--[\w-]+)["'`](?: as string)?\]:/g)) locallyDefined.add(k);
}
const defined = new Set([...designTokens, ...componentTokens, ...locallyDefined]);
const used = new Map();
for (const f of code) {
  const text = readFileSync(f, "utf8");
  for (const [, k] of text.matchAll(/var\((--[\w-]+)/g)) used.set(k, relative(root, f));
  for (const [, k] of text.matchAll(/css(?:Px|Ms)\("(--[\w-]+)"\)/g)) used.set(k, relative(root, f));
}
const undefinedVars = [...used].filter(([k]) => !defined.has(k));
for (const [k, f] of undefinedVars) errors.push(`${f}: var(${k}) is not defined`);
const usedDesign = [...used.keys()].filter((k) => designTokens.has(k)).length;
if (!undefinedVars.length) info.push(`${used.size} variables used in src (${usedDesign} design tokens, ${used.size - usedDesign} component/local), all defined`);

// 5. No colour literal in TS/TSX (CSS is covered by stylelint).
for (const f of code.filter((f) => /\.tsx?$/.test(f) && !/devMock/.test(f))) {
  const text = readFileSync(f, "utf8");
  const m = text.match(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b(?![\w-])|rgba?\(/);
  if (m) errors.push(`${relative(root, f)}: colour literal "${m[0]}"`);
}

for (const line of info) console.log(`✓ ${line}`);
for (const e of errors) console.error(`✗ ${e}`);
process.exit(errors.length ? 1 : 0);
