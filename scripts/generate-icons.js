// Generates PNG icons matching UniBookmarkSync-icon.svg design.
// Blue rounded-square + white bookmark + cloud dots.
// Run: node scripts/generate-icons.js

import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const __dirname = dirname(fileURLToPath(import.meta.url));
const iconsDir = resolve(__dirname, '..', 'public', 'icons');
mkdirSync(iconsDir, { recursive: true });

const BLUE = [0x36, 0x32, 0xD8];
const WHITE = [0xFF, 0xFF, 0xFF];

function createPNG(width, height, pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0; // RGBA

  const rawData = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    const rowOff = y * (1 + width * 4);
    rawData[rowOff] = 0;
    for (let x = 0; x < width; x++) {
      const px = pixels[y * width + x];
      const off = rowOff + 1 + x * 4;
      rawData[off] = (px >> 24) & 0xff;
      rawData[off + 1] = (px >> 16) & 0xff;
      rawData[off + 2] = (px >> 8) & 0xff;
      rawData[off + 3] = px & 0xff;
    }
  }
  const compressed = deflateSync(rawData);

  function crc32(buf) {
    let c; const table = [];
    for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1); table[n] = c; }
    c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  function chunk(type, data) {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
    const typeB = Buffer.from(type, 'ascii');
    const crcVal = Buffer.alloc(4);
    crcVal.writeUInt32BE(crc32(Buffer.concat([typeB, data])), 0);
    return Buffer.concat([len, typeB, data, crcVal]);
  }

  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', compressed), chunk('IEND', Buffer.alloc(0))]);
}

function blend(bg, fg, alpha) {
  return [
    Math.round(bg[0] + (fg[0] - bg[0]) * alpha),
    Math.round(bg[1] + (fg[1] - bg[1]) * alpha),
    Math.round(bg[2] + (fg[2] - bg[2]) * alpha),
  ];
}

function drawIcon(size) {
  const pixels = new Uint32Array(size * size);
  const r = size * 0.21; // corner radius
  const pad = size * 0.04;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let bg = 0x00000000; // transparent

      // Rounded rect fill
      if (x >= pad && x < size - pad && y >= pad && y < size - pad) {
        let inCorner = false;
        const corners = [
          [pad + r, pad + r],
          [size - pad - r, pad + r],
          [pad + r, size - pad - r],
          [size - pad - r, size - pad - r],
        ];
        for (const [cx, cy] of corners) {
          const dx = x - cx, dy = y - cy;
          if (dx * dx + dy * dy <= r * r) { inCorner = true; break; }
        }

        if (!inCorner) bg = 0xFF3632D8;
        else {
          // Check each corner
          let inAnyCorner = false;
          if (x < pad + r && y < pad + r) inAnyCorner = (x-pad-r)*(x-pad-r) + (y-pad-r)*(y-pad-r) <= r*r;
          else if (x >= size-pad-r && y < pad + r) inAnyCorner = (x-(size-pad-r))*(x-(size-pad-r)) + (y-pad-r)*(y-pad-r) <= r*r;
          else if (x < pad + r && y >= size-pad-r) inAnyCorner = (x-pad-r)*(x-pad-r) + (y-(size-pad-r))*(y-(size-pad-r)) <= r*r;
          else if (x >= size-pad-r && y >= size-pad-r) inAnyCorner = (x-(size-pad-r))*(x-(size-pad-r)) + (y-(size-pad-r))*(y-(size-pad-r)) <= r*r;
          if (inAnyCorner) bg = 0xFF3632D8;
          else bg = 0xFF3632D8;
        }
      }

      // Bookmark shape (white)
      const bw = size * 0.56, bh = size * 0.72;
      const bx = (size - bw) / 2, by = size * 0.12;

      if (x >= bx && x < bx + bw && y >= by && y < by + bh) {
        const notchTop = by + bh * 0.65;
        if (y < notchTop) {
          if (x >= bx + bw * 0.08 && x < bx + bw * 0.92) bg = 0xFFFFFFFF;
        } else {
          const frac = (y - notchTop) / (bh * 0.35);
          const halfW = (bw * 0.42) * (1 - frac);
          const mid = bx + bw / 2;
          if (x >= mid - halfW && x <= mid + halfW) bg = 0xFFFFFFFF;
        }
      }

      // Bookmark inner fill (blue)
      const ibw = bw * 0.82, ibh = bh * 0.55;
      const ibx = (size - ibw) / 2, iby = by + bh * 0.08;
      if (x >= ibx && x < ibx + ibw && y >= iby && y < iby + ibh) {
        if (x >= ibx + ibw * 0.06 && x < ibx + ibw * 0.94) bg = 0xFF3632D8;
      }

      // Small cloud dots on the bookmark
      const dotCY = by + bh * 0.45;
      const dots = [
        [size * 0.35, dotCY], [size * 0.42, dotCY + size * 0.03],
        [size * 0.50, dotCY], [size * 0.58, dotCY + size * 0.03],
        [size * 0.65, dotCY],
      ];
      for (const [dx, dy] of dots) {
        const dd = (x-dx)*(x-dx) + (y-dy)*(y-dy);
        if (dd < size * size * 0.0008) bg = 0xFFFFFFFF;
      }

      pixels[y * size + x] = bg;
    }
  }
  return pixels;
}

const sizes = [32, 64, 128];
for (const size of sizes) {
  const pixels = drawIcon(size);
  writeFileSync(resolve(iconsDir, `icon-${size}.png`), createPNG(size, size, pixels));
  console.log(`Created icon-${size}.png`);
}
console.log('Done!');
