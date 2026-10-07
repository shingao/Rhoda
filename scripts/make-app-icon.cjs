// App icon — `npm run icon` (then `npx tauri icon design/app-icon-1024.png -o src-tauri/icons`
// and copy icon.ico + icon-32.png over, see PROGRESS.md P10-20).
// Built from the poppy reference (design/icone-coquelicot-reference.png, a
// 304 x 286 screenshot): a square cream tile with rounded corners, redrawn,
// and the flower cut from the reference on top. 16-32 px: the flower fills
// the tile so that it stays readable. Writes PNGs (16 to 1024), icon.ico
// (PNG entries 16 to 256) and board.png (every size, light and dark).
const { chromium } = require("playwright");
const fs = require("fs");
const [SRC = "design/icone-coquelicot-reference.png", OUT = "icon-out"] = process.argv.slice(2);
const SIZES = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256, 512, 1024];
(async () => {
  const browser = await chromium.launch(); const page = await browser.newPage();
  const b64 = fs.readFileSync(SRC).toString('base64');
  const out = await page.evaluate(async ({ b64, SIZES }) => {
    const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
    const TILE = '#FFFDF9';
    // Flower region in the reference (with a margin) and the square the tile maps to.
    const F = { x: 64, y: 55, w: 169, h: 198 };
    const SQ = { x: 31, y: 17, s: 246 };
    // The flower alone, its cream background made transparent (soft edge).
    const fc = document.createElement('canvas'); fc.width = F.w; fc.height = F.h;
    const fg = fc.getContext('2d'); fg.drawImage(img, F.x, F.y, F.w, F.h, 0, 0, F.w, F.h);
    const fd = fg.getImageData(0, 0, F.w, F.h);
    for (let i = 0; i < fd.data.length; i += 4) {
      const diff = Math.abs(fd.data[i] - 255) + Math.abs(fd.data[i + 1] - 253) + Math.abs(fd.data[i + 2] - 249);
      fd.data[i + 3] = Math.max(0, Math.min(255, Math.round(((diff - 6) / 40) * 255)));
    }
    fg.putImageData(fd, 0, 0);
    // Upscaled flower master (smooth steps), 4× the reference.
    let master = fc;
    for (let k = 0; k < 2; k++) {
      const n = document.createElement('canvas'); n.width = master.width * 2; n.height = master.height * 2;
      const g = n.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(master, 0, 0, n.width, n.height); master = n;
    }
    const tile = (S, small) => {
      const c = document.createElement('canvas'); c.width = S; c.height = S; const g = c.getContext('2d');
      const r = S * 0.2;
      g.fillStyle = TILE; g.beginPath(); g.roundRect(0, 0, S, S, r); g.fill();
      if (small) {
        // Small sizes: the flower fills the tile (outlines would vanish otherwise).
        const h = S * 0.9, w = h * (F.w / F.h);
        g.drawImage(master, (S - w) / 2, (S - h) / 2 + S * 0.01, w, h);
      } else {
        const k = S / SQ.s;
        g.drawImage(master, (F.x - SQ.x) * k, (F.y - SQ.y) * k, F.w * k, F.h * k);
      }
      return c;
    };
    // Downscale by halving from a big render: sharper than one step.
    const render = (S, small) => {
      let big = S; while (big < 1024) big *= 2;
      let c = tile(big, small);
      while (c.width > S) {
        const t = Math.max(S, c.width / 2); const n = document.createElement('canvas'); n.width = t; n.height = t;
        const g = n.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(c, 0, 0, t, t); c = n;
      }
      return c.toDataURL('image/png').split(',')[1];
    };
    const res = {};
    for (const S of SIZES) res[S] = render(S, S <= 32);
    return res;
  }, { b64, SIZES });
  fs.mkdirSync(OUT, { recursive: true });
  for (const [S, data] of Object.entries(out)) fs.writeFileSync(`${OUT}/icon-${S}.png`, Buffer.from(data, 'base64'));
  // .ico with PNG entries (Windows Vista and later).
  const icoSizes = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256];
  const pngs = icoSizes.map((s) => Buffer.from(out[s], 'base64'));
  const header = Buffer.alloc(6); header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(pngs.length, 4);
  const dir = Buffer.alloc(16 * pngs.length); let offset = 6 + dir.length;
  pngs.forEach((p, i) => {
    const s = icoSizes[i]; const o = i * 16;
    dir.writeUInt8(s >= 256 ? 0 : s, o); dir.writeUInt8(s >= 256 ? 0 : s, o + 1); dir.writeUInt8(0, o + 2); dir.writeUInt8(0, o + 3);
    dir.writeUInt16LE(1, o + 4); dir.writeUInt16LE(32, o + 6); dir.writeUInt32LE(p.length, o + 8); dir.writeUInt32LE(offset, o + 12); offset += p.length;
  });
  fs.writeFileSync(`${OUT}/icon.ico`, Buffer.concat([header, dir, ...pngs]));
  // Review board: every size at true size on light and dark, and 16/32 enlarged.
  const imgs = Object.fromEntries(Object.entries(out).map(([k, v]) => [k, `data:image/png;base64,${v}`]));
  const row = (bg) => `<div style="display:flex;gap:18px;align-items:end;padding:16px;background:${bg}">${icoSizes.map((s) => `<figure style="margin:0;text-align:center;font:11px sans-serif;color:#888"><img src="${imgs[s]}" width="${s}" height="${s}"><figcaption>${s}</figcaption></figure>`).join('')}</div>`;
  const zoom = (s) => `<figure style="margin:0;text-align:center;font:12px sans-serif;color:#555"><img src="${imgs[s]}" style="width:${s * 8}px;height:${s * 8}px;image-rendering:pixelated"><figcaption>${s} px ×8</figcaption></figure>`;
  const board = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  await board.setContent(`<body style="margin:0;font-family:sans-serif"><div style="padding:12px 16px;font:600 14px sans-serif">Bullshit — icône, toutes les tailles</div>${row('#ffffff')}${row('#202020')}${row('#3a6ea5')}<div style="display:flex;gap:24px;padding:16px;align-items:end;background:#f3f3f3">${zoom(16)}${zoom(32)}<img src="${imgs[256]}" width="256"></div></body>`);
  await board.waitForTimeout(200);
  await board.screenshot({ path: `${OUT}/board.png`, fullPage: true });
  await browser.close();
})();
