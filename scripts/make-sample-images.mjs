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
console.log("samples/assets: paysage.png, portrait.png, petite.png, schema.svg");
