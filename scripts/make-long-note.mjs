// Builds "samples/Note longue (5000 lignes).md" from the demo note, for the typing performance test.
import { readFileSync, writeFileSync } from "node:fs";

const TARGET_LINES = 5000;
const demo = readFileSync(new URL("../samples/Démo éditeur.md", import.meta.url), "utf8");
const body = demo.replace(/^---[\s\S]*?---\n/, "").replace(/^# .*\n/, "");
const lines = ["---", "id: 0192f3a8-0000-7000-8000-000000001000", "---", "# Note longue (5000 lignes)", ""];
for (let part = 1; lines.length < TARGET_LINES; part++) {
  lines.push(`# Partie ${part}`, ...body.split("\n"));
}
writeFileSync(new URL("../samples/Note longue (5000 lignes).md", import.meta.url), lines.slice(0, TARGET_LINES).join("\n") + "\n");
console.log(`${TARGET_LINES} lignes écrites`);
