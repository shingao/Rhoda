// Regenerates the pictures read by the real OCR tests (src-tauri/src/ocr/windows.rs).
// Needs Chromium for Playwright (`npx playwright install chromium` once).
//
// - ocr-photo.jpg: a photo of a ticket on a table, tilted, JPEG, stored turned
//   90° counter-clockwise with EXIF orientation 6 ("rotate 90° clockwise to show"),
//   as a phone held sideways saves it. Shown: 1600 × 1067.
// - ocr-words.png: four words, one per 120 px row, that the test lays out on a
//   picture wider than the engine's limit (tiles).
import { writeFileSync } from "node:fs";
import { chromium } from "playwright";

const OUT = "src-tauri/tests/fixtures";
const PHOTO = { width: 1600, height: 1067 };
const WORD_ROW = 120;
const WORDS = ["SAPPORO", "HAKODATE", "KUSHIRO", "OTARU"];

// Inside style="…" attributes: no double quotes, single ones escaped.
const grain = `url('data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns='http://www.w3.org/2000/svg' width='400' height='400'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2'/><feColorMatrix values='0 0 0 0 .5 0 0 0 0 .4 0 0 0 0 .3 0 0 0 .35 0'/></filter><rect width='400' height='400' filter='url(#n)'/></svg>`,
).replace(/'/g, "%27")}')`;

// The scene as seen, drawn turned 90° counter-clockwise into a 1067 × 1600 page.
const photo = `<!doctype html><html><body style="margin:0;width:${PHOTO.height}px;height:${PHOTO.width}px;overflow:hidden">
<div style="position:absolute;left:0;top:0;width:${PHOTO.width}px;height:${PHOTO.height}px;transform-origin:0 0;transform:translateY(${PHOTO.width}px) rotate(-90deg);
  background:${grain},repeating-linear-gradient(88deg,#8a5a36 0 38px,#7d5030 38px 41px,#94643d 41px 90px);overflow:hidden">
  <div style="position:absolute;left:230px;top:250px;width:1120px;height:560px;transform:rotate(-4deg);border-radius:18px;
    background:${grain},linear-gradient(160deg,#fbf6ea,#efe6d2);box-shadow:0 30px 60px rgba(0,0,0,.45);font-family:'Liberation Sans','DejaVu Sans',sans-serif;color:#26313f">
    <div style="height:120px;border-radius:18px 18px 0 0;background:#1f5a86;color:#f4f0e6;font:700 78px/120px 'Liberation Sans',sans-serif;padding-left:56px">HAKONE FREE PASS</div>
    <div style="padding:46px 56px 0;font:700 64px/1.3 'Liberation Sans',sans-serif">ODAWARA — TOGENDAI</div>
    <div style="padding:22px 56px 0;font:400 44px/1.3 'Liberation Sans',sans-serif">2 DAYS · ADULT · VALID 12 MAY</div>
    <div style="position:absolute;right:56px;bottom:40px;font:400 30px 'DejaVu Sans Mono',monospace;color:#6b6252">No 004518</div>
  </div>
  <div style="position:absolute;inset:0;background:radial-gradient(ellipse at 35% 30%,rgba(255,240,210,.25),rgba(0,0,0,.35) 80%)"></div>
</div></body></html>`;

const words = `<!doctype html><html><body style="margin:0;background:#fff;width:600px">
${WORDS.map((w) => `<div style="height:${WORD_ROW}px;font:700 64px/${WORD_ROW}px 'Liberation Sans',sans-serif;padding-left:24px;color:#111">${w}</div>`).join("")}
</body></html>`;

/** EXIF block (big-endian TIFF, one entry: Orientation = 6), as a JPEG APP1 segment. */
const exifOrientation6 = Buffer.from([
  0xff, 0xe1, 0x00, 0x22, 0x45, 0x78, 0x69, 0x66, 0, 0, 0x4d, 0x4d, 0, 0x2a, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, 6, 0, 0, 0, 0, 0, 0,
]);

/** Puts the EXIF segment first (after SOI), dropping the JFIF one (both want to be first). */
function withExif(jpeg) {
  let rest = jpeg.subarray(2);
  if (rest[0] === 0xff && rest[1] === 0xe0) rest = rest.subarray(2 + rest.readUInt16BE(2));
  return Buffer.concat([jpeg.subarray(0, 2), exifOrientation6, rest]);
}

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
await page.setViewportSize({ width: PHOTO.height, height: PHOTO.width });
await page.setContent(photo);
writeFileSync(`${OUT}/ocr-photo.jpg`, withExif(await page.screenshot({ type: "jpeg", quality: 82 })));
await page.setViewportSize({ width: 600, height: WORD_ROW * WORDS.length });
await page.setContent(words);
writeFileSync(`${OUT}/ocr-words.png`, await page.screenshot({ type: "png" }));
await browser.close();
