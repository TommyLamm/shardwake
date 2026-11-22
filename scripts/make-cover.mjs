// 產生 800 × 500 的佔位封面 public/cover.png（深色漸層加青色線條）。
// 只使用 Node 內建模組；M1-16 會換成遊戲實際畫面。
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const WIDTH = 800;
const HEIGHT = 500;
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outPath = resolve(root, process.argv[2] ?? 'public/cover.png');

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const mix = (a, b, t) => a + (b - a) * t;

/** 與直線 ax + by + c = 0 的距離，轉成柔邊線條強度。 */
function lineGlow(x, y, x0, y0, x1, y1, width) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len2 = dx * dx + dy * dy;
  const t = clamp01(((x - x0) * dx + (y - y0) * dy) / len2);
  const px = x0 + t * dx - x;
  const py = y0 + t * dy - y;
  const d = Math.sqrt(px * px + py * py);
  return Math.exp(-(d * d) / (width * width));
}

// 碎晶航跡：幾條斜向航跡線與一塊晶體輪廓。
const TRAILS = [
  [-50, 430, 860, 120, 1.6, 1.0],
  [-50, 470, 860, 190, 1.1, 0.6],
  [-50, 395, 860, 60, 0.9, 0.45],
  [120, 520, 700, -20, 0.8, 0.3],
];
const SHARD = [
  [520, 150],
  [610, 215],
  [585, 330],
  [490, 355],
  [455, 250],
];

const horizonY = 330;
const raw = Buffer.alloc((WIDTH * 3 + 1) * HEIGHT);
let o = 0;
for (let y = 0; y < HEIGHT; y++) {
  raw[o++] = 0; // filter: none
  for (let x = 0; x < WIDTH; x++) {
    const v = y / (HEIGHT - 1);
    const u = x / (WIDTH - 1);
    // 深藍灰到近黑的漸層，地平線附近微亮。
    let r = mix(10, 3, v);
    let g = mix(20, 6, v);
    let b = mix(36, 12, v);
    const horizon = Math.exp(-((y - horizonY) ** 2) / (2 * 40 * 40)) * (0.6 + 0.4 * (1 - Math.abs(u - 0.55)));
    r += 4 * horizon;
    g += 30 * horizon;
    b += 40 * horizon;

    // 地面透視格線。
    if (y > horizonY) {
      const depth = (y - horizonY) / (HEIGHT - horizonY);
      const z = 1 / Math.max(depth, 0.02);
      const gx = ((u - 0.55) * z * 6) % 1;
      const gz = (z * 1.2) % 1;
      const lineX = Math.exp(-((Math.min(Math.abs(gx), 1 - Math.abs(gx)) / (0.02 * z)) ** 2));
      const lineZ = Math.exp(-((Math.min(gz, 1 - gz) / (0.04 * z)) ** 2));
      const fade = clamp01(depth * 1.4) * 0.5;
      const grid = Math.max(lineX, lineZ) * fade;
      r += 10 * grid;
      g += 70 * grid;
      b += 85 * grid;
    }

    let glow = 0;
    for (const [x0, y0, x1, y1, w, k] of TRAILS) glow += lineGlow(x, y, x0, y0, x1, y1, w * 2.2) * k;
    for (let i = 0; i < SHARD.length; i++) {
      const [ax, ay] = SHARD[i];
      const [bx, by] = SHARD[(i + 1) % SHARD.length];
      glow += lineGlow(x, y, ax, ay, bx, by, 2.4) * 0.9;
    }
    const halo = Math.exp(-((x - 535) ** 2 + (y - 255) ** 2) / (2 * 90 * 90)) * 0.35;
    r += 57 * glow + 10 * halo;
    g += 230 * glow + 60 * halo;
    b += 255 * glow + 80 * halo;

    raw[o++] = Math.min(255, Math.round(r));
    raw[o++] = Math.min(255, Math.round(g));
    raw[o++] = Math.min(255, Math.round(b));
  }
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(WIDTH, 0);
ihdr.writeUInt32BE(HEIGHT, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 2; // color type: RGB
ihdr[10] = 0;
ihdr[11] = 0;
ihdr[12] = 0;

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, png);
console.log(`已寫入 ${outPath}（${WIDTH} × ${HEIGHT}，${(png.length / 1024).toFixed(1)} KiB）`);
