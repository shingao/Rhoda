// Regenerates the sample images of samples/assets/ (used by "Rythme vertical.md" and the dev vault).
import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

function png(width, height, pixel) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0;
    for (let x = 0; x < width; x++) raw.set(pixel(x / width, y / height), y * (width * 3 + 1) + 1 + x * 3);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));

// Dusk over hills.
writeFileSync(
  "samples/assets/paysage.png",
  png(640, 360, (u, v) => {
    const hill = 0.62 + 0.08 * Math.sin(u * 7) + 0.05 * Math.sin(u * 17 + 1);
    if (v > hill) return mix([74, 98, 76], [38, 52, 40], (v - hill) * 2);
    const sun = Math.hypot(u - 0.7, v - 0.45) < 0.07;
    return sun ? [250, 214, 150] : mix([242, 170, 120], [96, 110, 160], 1 - v / hill);
  }),
);
// Tall sea and sand.
writeFileSync(
  "samples/assets/portrait.png",
  png(300, 417, (u, v) => (v < 0.55 ? mix([120, 170, 210], [40, 90, 140], v / 0.55) : mix([230, 210, 170], [200, 175, 130], (v - 0.55) / 0.45 + 0.05 * Math.sin(u * 30)))),
);
// Small swatch, shown at its natural size.
writeFileSync("samples/assets/petite.png", png(150, 97, (u, v) => mix([224, 101, 74], [244, 200, 120], (u + v) / 2)));
writeFileSync(
  "samples/assets/schema.svg",
  `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="190" viewBox="0 0 480 190">
  <rect width="480" height="190" rx="12" fill="#f3ece3"/>
  <g font-family="sans-serif" font-size="15" fill="#3b3128" text-anchor="middle">
    <rect x="24" y="70" width="120" height="50" rx="8" fill="#fff" stroke="#e0654a"/><text x="84" y="100">watcher</text>
    <rect x="180" y="70" width="120" height="50" rx="8" fill="#fff" stroke="#e0654a"/><text x="240" y="100">fichier .md</text>
    <rect x="336" y="70" width="120" height="50" rx="8" fill="#fff" stroke="#e0654a"/><text x="396" y="100">index</text>
  </g>
  <path d="M144 95h36M300 95h36" stroke="#e0654a" stroke-width="2"/>
</svg>
`,
);
// Two-page PDF (A4), written by hand: a title, a few lines and a coloured band.
function pdf(pages) {
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", null, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
  const kids = [];
  for (const content of pages) {
    const stream = Buffer.from(content, "latin1");
    objects.push(`<< /Length ${stream.length} >>\nstream\n${content}\nendstream`);
    const contentId = objects.length;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`);
    kids.push(`${objects.length} 0 R`);
  }
  objects[1] = `<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${kids.length} >>`;
  let out = "%PDF-1.4\n";
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out, "latin1"));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}
const text = (lines) => lines.map(([size, y, t]) => `BT /F1 ${size} Tf 60 ${y} Td (${t}) Tj ET`).join("\n");
writeFileSync(
  "samples/assets/devis-renovation.pdf",
  pdf([
    `0.88 0.4 0.29 rg 0 772 595 70 re f\n0 0 0 rg\n${text([[26, 700, "Devis - renovation"], [12, 660, "Cuisine et salle de bains"], [12, 630, "Total : 12 480 EUR TTC"], [12, 600, "Validite : 30 jours"]])}`,
    text([[18, 760, "Conditions"], [12, 730, "Acompte de 30 % a la signature."], [12, 710, "Solde a la reception des travaux."]]),
  ]),
);
console.log("samples/assets: paysage.png, portrait.png, petite.png, schema.svg, devis-renovation.pdf");
