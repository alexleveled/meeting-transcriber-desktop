// @ts-check
/**
 * Generate build/icon.ico — a 256×256 app icon (electron-builder buildResource) with no external
 * image tooling: hand-encode a PNG (RGBA) and wrap it in a single-entry ICO. The mark echoes the
 * sidebar logo — a row of rounded "audio level" bars in the app accent on a dark rounded tile.
 */
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const S = 256;

// Palette (matches the app: dark slate tile, indigo accent bars).
const BG = [11, 17, 32, 255]; // #0b1120
const TILE = [30, 41, 59, 255]; // #1e293b rounded panel
const ACCENT = [99, 102, 241, 255]; // #6366f1

// Six bars with varying heights, like an equalizer / waveform.
const BARS = [0.42, 0.68, 0.9, 0.55, 0.78, 0.36];

function roundedInside(x, y, x0, y0, x1, y1, r) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = x < x0 + r ? x0 + r : x > x1 - r ? x1 - r : x;
  const cy = y < y0 + r ? y0 + r : y > y1 - r ? y1 - r : y;
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

function pixel(x, y) {
  // Outer rounded tile inset from the edges.
  const m = 18;
  if (!roundedInside(x, y, m, m, S - m, S - m, 44)) return BG;

  // Bar geometry inside the tile.
  const areaX0 = 60;
  const areaX1 = S - 60;
  const baseY = S - 74;
  const topY = 74;
  const slot = (areaX1 - areaX0) / BARS.length;
  const barW = slot * 0.55;
  for (let i = 0; i < BARS.length; i++) {
    const bx0 = areaX0 + i * slot + (slot - barW) / 2;
    const bx1 = bx0 + barW;
    const h = (baseY - topY) * BARS[i];
    const by0 = baseY - h;
    if (roundedInside(x, y, bx0, by0, bx1, baseY, barW / 2)) return ACCENT;
  }
  return TILE;
}

// --- encode RGBA scanlines (filter byte 0 per row) --------------------------
const raw = Buffer.alloc(S * (S * 4 + 1));
let o = 0;
for (let y = 0; y < S; y++) {
  raw[o++] = 0; // filter: none
  for (let x = 0; x < S; x++) {
    const [r, g, b, a] = pixel(x, y);
    raw[o++] = r;
    raw[o++] = g;
    raw[o++] = b;
    raw[o++] = a;
  }
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])) >>> 0, 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c;
}

const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(S, 0);
ihdr.writeUInt32BE(S, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // color type RGBA
const png = Buffer.concat([
  sig,
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);

// --- wrap in ICO (single 256×256 PNG entry) ---------------------------------
const dir = Buffer.alloc(6 + 16);
dir.writeUInt16LE(0, 0); // reserved
dir.writeUInt16LE(1, 2); // type: icon
dir.writeUInt16LE(1, 4); // count
dir[6] = 0; // width 0 => 256
dir[7] = 0; // height 0 => 256
dir[8] = 0; // colors in palette
dir[9] = 0; // reserved
dir.writeUInt16LE(1, 10); // planes
dir.writeUInt16LE(32, 12); // bpp
dir.writeUInt32LE(png.length, 14); // size
dir.writeUInt32LE(6 + 16, 18); // offset

const ico = Buffer.concat([dir, png]);
mkdirSync(join(process.cwd(), "build"), { recursive: true });
writeFileSync(join(process.cwd(), "build", "icon.ico"), ico);
console.log(`build/icon.ico written (${ico.length} bytes, 256×256)`);
