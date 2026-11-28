// 產生正式封面 public/cover.png（M1-16，npm run cover）：以本機 Chrome／Edge 的 headless 模式開 dist/ 的 #cover，
// 等封面模式取景並凍結後呼叫 window.__shardwakeCover.capture()，寫出 800 × 500 的 PNG（≤ 5 MiB）。
// 需要先 npm run build（封面取景數值在 src/tools/cover.ts 的 COVER_CONFIG）。不下載任何瀏覽器；只結束自己啟動的程序。
// 用法：npm run build && npm run cover -- [輸出路徑，預設 public/cover.png] [--browser chrome|edge]
// M1-01 的佔位封面（純 Node 繪製）已由遊戲實際畫面取代。
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GPU_FLAGS, launchBrowser, serveDir } from './lib/browser.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const bi = args.indexOf('--browser');
const browserName = bi >= 0 ? args[bi + 1] : 'chrome';
const positional = args.filter((a, i) => !a.startsWith('--') && (bi < 0 || i !== bi + 1));
const outPath = resolve(root, positional[0] ?? 'public/cover.png');
const dist = resolve(root, 'dist');
if (!existsSync(resolve(dist, 'index.html'))) {
  console.error('找不到 dist/index.html，請先執行 npm run build');
  process.exit(1);
}

const server = await serveDir(dist);
// 封面不量效能：保留幀率限制。
const flags = GPU_FLAGS.filter((f) => f !== '--disable-gpu-vsync' && f !== '--disable-frame-rate-limit');
const browser = await launchBrowser({ browser: browserName, width: 1280, height: 800, flags });
try {
  const page = await browser.newPage(`${server.url}#cover`);
  await page.waitFor(`['ready', 'error'].includes(document.documentElement.dataset.swBoot)`, { timeout: 90000 });
  if ((await page.evaluate(`document.documentElement.dataset.swBoot`)) !== 'ready') throw new Error(`遊戲啟動失敗：${page.errors.join('\n')}`);
  await page.waitFor(`document.documentElement.dataset.swCover === 'ready'`, { timeout: 30000 });
  const url = await page.evaluate(`window.__shardwakeCover.capture()`);
  const png = Buffer.from(String(url).split(',')[1], 'base64');
  const w = png.readUInt32BE(16);
  const h = png.readUInt32BE(20);
  if (w !== 800 || h !== 500) throw new Error(`封面尺寸 ${w} × ${h}，應為 800 × 500`);
  if (png.length > 5 * 1024 * 1024) throw new Error(`封面 ${png.length} bytes 超過 5 MiB`);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, png);
  const errors = [...page.errors, ...page.console.filter((c) => c.type === 'error').map((c) => c.text)];
  if (errors.length) console.warn('主控台錯誤：', errors);
  console.log(`已寫入 ${outPath}（${w} × ${h}，${(png.length / 1024).toFixed(1)} KiB）`);
  await page.close();
} finally {
  await browser.close();
  await server.close();
}
