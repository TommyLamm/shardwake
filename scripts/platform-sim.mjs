// 平台模擬頁（npm run sim）：只用 Node 內建 http，起兩個不同來源的伺服器。
//   平台頁：http://localhost:4173/
//   遊戲：  http://127.0.0.1:4174/games/shardwake/<version>/（另有 /preview/shardwake/<version>-sim/）
// 平台頁用與 Playroom 相同權限的 sandbox iframe 載入 dist/，並可切換
// 「一般／填滿視窗（沉浸）／原生全螢幕」與調整 iframe 尺寸。不提供 SPA fallback。
// 環境變數：SIM_PLATFORM_PORT、SIM_GAME_PORT、SIM_DIST（預設 dist）。
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync, createReadStream } from 'node:fs';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const distDir = resolve(root, process.env.SIM_DIST ?? 'dist');
const PLATFORM_PORT = Number(process.env.SIM_PLATFORM_PORT ?? 4173);
const GAME_PORT = Number(process.env.SIM_GAME_PORT ?? 4174);
const HOST = '127.0.0.1';

if (!existsSync(join(distDir, 'game.json'))) {
  console.error(`找不到 ${join(distDir, 'game.json')}，請先執行 npm run build`);
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(join(distDir, 'game.json'), 'utf8'));
const GAME_ID = manifest.id;
const VERSION = manifest.version;
const MOUNTS = {
  games: `/games/${GAME_ID}/${VERSION}/`,
  preview: `/preview/${GAME_ID}/${VERSION}-sim/`,
};
const GAME_ORIGIN = `http://${HOST}:${GAME_PORT}`;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
  '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

// 不送 COOP/COEP：遊戲必須在 crossOriginIsolated === false 下運作。
const BASE_HEADERS = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };

function send(res, status, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, { ...BASE_HEADERS, 'Content-Type': type });
  res.end(body);
}

const gameServer = createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method Not Allowed');
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url ?? '/', GAME_ORIGIN).pathname);
  } catch {
    return send(res, 400, 'Bad Request');
  }
  const mount = Object.values(MOUNTS).find((m) => pathname.startsWith(m));
  if (!mount) {
    console.warn(`[game] 404（不在遊戲子目錄內，可能是根目錄絕對路徑）：${pathname}`);
    return send(res, 404, `Not Found: ${pathname}`);
  }
  let rel = pathname.slice(mount.length);
  if (rel === '' || rel.endsWith('/')) rel += 'index.html';
  const filePath = normalize(join(distDir, rel));
  if (!filePath.startsWith(distDir + sep)) return send(res, 403, 'Forbidden');
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    console.warn(`[game] 404：${pathname}`);
    return send(res, 404, `Not Found: ${pathname}`);
  }
  res.writeHead(200, {
    ...BASE_HEADERS,
    'Content-Type': MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream',
    'Content-Length': statSync(filePath).size,
  });
  if (req.method === 'HEAD') return res.end();
  createReadStream(filePath).pipe(res);
});

function platformPage() {
  const config = JSON.stringify({ origin: GAME_ORIGIN, mounts: MOUNTS, name: manifest.name, version: VERSION });
  return `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<link rel="icon" href="data:," />
<title>Playroom 平台模擬 — ${manifest.name} ${VERSION}</title>
<style>
  :root { color-scheme: dark; font-family: system-ui, 'Microsoft JhengHei', sans-serif; }
  html, body { margin: 0; height: 100%; background: #10141b; color: #d6dde6; }
  header { display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: center; padding: 10px 16px; background: #171d27; border-bottom: 1px solid #2a3342; }
  header h1 { font-size: 15px; margin: 0 8px 0 0; }
  fieldset { display: flex; gap: 6px; align-items: center; border: 1px solid #2a3342; padding: 4px 8px; margin: 0; }
  legend { font-size: 11px; color: #8a96a8; padding: 0 4px; }
  button, select, input { font: inherit; font-size: 13px; background: #222b38; color: inherit; border: 1px solid #3a4658; border-radius: 4px; padding: 3px 8px; }
  button[aria-pressed="true"] { background: #1f6f8b; border-color: #39e6ff; }
  input[type="number"] { width: 72px; }
  main { padding: 16px; }
  #status { font: 12px/1.5 ui-monospace, Consolas, monospace; color: #8a96a8; margin: 8px 0 0; white-space: pre-wrap; }
  #stage { position: relative; background: #000; border: 1px solid #2a3342; width: 960px; height: 540px; max-width: 100%; }
  #stage.fit { width: 100%; height: calc(100vh - 170px); }
  #stage iframe { display: block; width: 100%; height: 100%; border: 0; }
  #exit { display: none; position: absolute; top: 10px; right: 10px; z-index: 2; background: rgb(0 0 0 / 60%); border-color: #5a6678; }
  /* 沉浸模式：填滿網頁視窗，只留遊戲與右上角退出鈕（覆蓋尺寸預設的 inline 寬高）。 */
  #stage.immersive { position: fixed; inset: 0; width: auto !important; height: auto !important; max-width: none; border: 0; z-index: 10; }
  #stage.immersive #exit, #stage:fullscreen #exit { display: block; }
  #stage:fullscreen { width: 100% !important; height: 100% !important; max-width: none; border: 0; }
</style>
</head>
<body>
<header>
  <h1>Playroom 平台模擬</h1>
  <fieldset><legend>顯示模式</legend>
    <button data-mode="normal" aria-pressed="true">一般</button>
    <button data-mode="immersive">填滿視窗（沉浸）</button>
    <button data-mode="fullscreen">原生全螢幕</button>
  </fieldset>
  <fieldset><legend>iframe 尺寸</legend>
    <select id="preset">
      <option value="960x540" selected>960 × 540</option>
      <option value="1280x720">1280 × 720</option>
      <option value="1920x1080">1920 × 1080</option>
      <option value="800x500">800 × 500</option>
      <option value="640x480">640 × 480</option>
      <option value="400x700">400 × 700（直向）</option>
      <option value="fit">填滿內容區</option>
    </select>
    <input id="w" type="number" min="100" step="10" value="960" aria-label="寬" /> ×
    <input id="h" type="number" min="100" step="10" value="540" aria-label="高" />
    <button id="apply">套用</button>
  </fieldset>
  <fieldset><legend>入口</legend>
    <select id="mount"><option value="games">/games/…</option><option value="preview">/preview/…</option></select>
    <button id="reload">重新載入 iframe</button>
  </fieldset>
</header>
<main>
  <div id="stage">
    <button id="exit" type="button">退出 ✕</button>
    <iframe id="game" title="遊戲"
      sandbox="allow-scripts allow-same-origin allow-pointer-lock"
      allow="fullscreen; autoplay; gamepad"></iframe>
  </div>
  <p id="status"></p>
</main>
<script>
const CFG = ${config};
const stage = document.getElementById('stage');
const frame = document.getElementById('game');
const status = document.getElementById('status');
const mountSel = document.getElementById('mount');
let mode = 'normal';

function gameUrl() { return CFG.origin + CFG.mounts[mountSel.value] + 'index.html'; }
function load() { frame.src = gameUrl(); update(); }
function update() {
  const r = frame.getBoundingClientRect();
  status.textContent = '遊戲 ' + CFG.name + ' ' + CFG.version + '\\n' + 'iframe：' + frame.src +
    '\\n模式：' + mode + '　尺寸：' + Math.round(r.width) + ' × ' + Math.round(r.height) +
    '　（平台頁 crossOriginIsolated=' + window.crossOriginIsolated + '）';
}
function setPressed() {
  for (const b of document.querySelectorAll('[data-mode]')) b.setAttribute('aria-pressed', String(b.dataset.mode === mode));
}
async function setMode(next) {
  if (document.fullscreenElement && next !== 'fullscreen') {
    try { navigator.keyboard?.unlock?.(); } catch {}
    await document.exitFullscreen().catch(() => {});
  }
  stage.classList.remove('immersive');
  if (next === 'fullscreen') {
    try {
      await stage.requestFullscreen({ navigationUI: 'hide' });
      // 與平台相同：頂層以 Keyboard Lock 鎖定 Escape，短按交給遊戲。
      try { await navigator.keyboard?.lock?.(['Escape']); } catch {}
    } catch (err) {
      console.warn('原生全螢幕不可用，改用沉浸模式', err);
      next = 'immersive';
    }
  }
  if (next === 'immersive') stage.classList.add('immersive');
  mode = next;
  setPressed();
  update();
}
function applySize(value) {
  stage.classList.toggle('fit', value === 'fit');
  if (value === 'fit') { stage.style.width = ''; stage.style.height = ''; }
  else {
    const [w, h] = value.split('x').map(Number);
    document.getElementById('w').value = w; document.getElementById('h').value = h;
    stage.style.width = w + 'px'; stage.style.height = h + 'px';
  }
  update();
}
document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement && mode === 'fullscreen') { mode = 'normal'; setPressed(); }
  update();
});
for (const b of document.querySelectorAll('[data-mode]')) b.addEventListener('click', () => setMode(b.dataset.mode));
document.getElementById('exit').addEventListener('click', () => setMode('normal'));
document.getElementById('preset').addEventListener('change', (e) => applySize(e.target.value));
document.getElementById('apply').addEventListener('click', () => {
  applySize(document.getElementById('w').value + 'x' + document.getElementById('h').value);
});
document.getElementById('reload').addEventListener('click', load);
mountSel.addEventListener('change', load);
new ResizeObserver(update).observe(stage);
load();
</script>
</body>
</html>`;
}

const platformServer = createServer((req, res) => {
  const { pathname } = new URL(req.url ?? '/', `http://localhost:${PLATFORM_PORT}`);
  if (pathname === '/' || pathname === '/index.html') return send(res, 200, platformPage(), 'text/html; charset=utf-8');
  return send(res, 404, 'Not Found');
});

function listen(server, port, label) {
  return new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(port, HOST, () => {
      console.log(`${label}`);
      resolveListen();
    });
  });
}

try {
  await listen(gameServer, GAME_PORT, `遊戲伺服器：${GAME_ORIGIN}${MOUNTS.games}`);
  await listen(platformServer, PLATFORM_PORT, `平台模擬頁：http://localhost:${PLATFORM_PORT}/`);
  console.log('按 Ctrl+C 結束。');
} catch (err) {
  console.error(`無法啟動伺服器：${err.message}（埠號被占用時可設定 SIM_PLATFORM_PORT／SIM_GAME_PORT）`);
  process.exit(1);
}

const shutdown = () => {
  gameServer.close();
  platformServer.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
