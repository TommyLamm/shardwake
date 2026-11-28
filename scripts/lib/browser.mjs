// 無頭瀏覽器工具（M1-16）：只用 Node 內建模組與本機已安裝的 Chrome／Edge，不下載任何瀏覽器。
//   - findBrowser(name)：找 chrome／edge 的執行檔（環境變數 SW_CHROME／SW_EDGE 可覆寫）。
//   - launchBrowser({ browser, width, height, flags })：以獨立的暫存使用者資料夾啟動 headless，回傳 CDP 連線；
//     close() 只結束自己啟動的程序並刪除暫存資料夾，不影響使用者開著的瀏覽器視窗。
//   - serveDir(dir, { port })：極簡靜態伺服器（給 cover／perf 腳本直接開 dist/）。
// CDP 以 flatten session 操作：browser.newPage(url) 回傳 { send, on, evaluate, waitFor, screenshot, close }。
import { spawn } from 'node:child_process';
import { createReadStream, existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, normalize, sep } from 'node:path';

const CANDIDATES = {
  chrome: [
    process.env.SW_CHROME,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'),
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ],
  edge: [
    process.env.SW_EDGE,
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/usr/bin/microsoft-edge',
  ],
};

export function findBrowser(name = 'chrome') {
  const list = CANDIDATES[name];
  if (!list) throw new Error(`未知的瀏覽器：${name}（chrome／edge）`);
  const found = list.find((p) => p && existsSync(p));
  if (!found) throw new Error(`找不到 ${name}，可用環境變數 SW_${name.toUpperCase()} 指定執行檔`);
  return found;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 預設旗標：使用實體 GPU（ANGLE D3D11）、不限幀率（量吞吐量）、允許自動播放。 */
export const GPU_FLAGS = [
  '--use-angle=d3d11',
  '--enable-gpu',
  '--ignore-gpu-blocklist',
  '--enable-webgl',
  '--disable-gpu-vsync',
  '--disable-frame-rate-limit',
  '--enable-precise-memory-info',
  '--autoplay-policy=no-user-gesture-required',
];

export async function launchBrowser({ browser = 'chrome', width = 1920, height = 1080, flags = GPU_FLAGS, headless = true } = {}) {
  const exe = findBrowser(browser);
  const userDir = mkdtempSync(join(tmpdir(), `sw-${browser}-`));
  const args = [
    ...(headless ? ['--headless=new'] : []),
    '--remote-debugging-port=0',
    `--user-data-dir=${userDir}`,
    `--window-size=${width},${height}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    ...flags,
    'about:blank',
  ];
  const proc = spawn(exe, args, { stdio: 'ignore' });
  let exited = false;
  proc.on('exit', () => (exited = true));
  const portFile = join(userDir, 'DevToolsActivePort');
  let port = 0;
  for (let i = 0; i < 200 && !port; i++) {
    if (exited) throw new Error(`${browser} 啟動失敗`);
    if (existsSync(portFile)) port = Number(readFileSync(portFile, 'utf8').split('\n')[0]);
    if (!port) await sleep(50);
  }
  if (!port) throw new Error(`${browser} 沒有開啟 CDP 埠`);
  const info = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  const ws = new WebSocket(info.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = () => rej(new Error('CDP 連線失敗'));
  });
  let nextId = 1;
  const pending = new Map();
  const listeners = new Set();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(String(ev.data));
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(`${msg.error.message}（${msg.error.code}）`));
      else resolve(msg.result);
    } else if (msg.method) {
      for (const l of listeners) l(msg);
    }
  };
  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });

  async function newPage(url, { viewport = { width, height } } = {}) {
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    const s = (method, params) => send(method, params, sessionId);
    const console = [];
    const errors = [];
    const off = (msg) => {
      if (msg.sessionId !== sessionId) return;
      if (msg.method === 'Runtime.consoleAPICalled') {
        const text = msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ');
        console.push({ type: msg.params.type, text });
      } else if (msg.method === 'Runtime.exceptionThrown') {
        errors.push(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text);
      } else if (msg.method === 'Log.entryAdded') {
        if (msg.params.entry.level === 'error') errors.push(`${msg.params.entry.text} ${msg.params.entry.url ?? ''}`);
      }
    };
    listeners.add(off);
    await s('Runtime.enable');
    await s('Log.enable');
    await s('Page.enable');
    if (viewport) await s('Emulation.setDeviceMetricsOverride', { width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: false });
    await s('Page.navigate', { url });
    const evaluate = async (expression, { awaitPromise = true, contextId } = {}) => {
      const r = await s('Runtime.evaluate', { expression, awaitPromise, returnByValue: true, ...(contextId ? { contextId } : {}) });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
      return r.result.value;
    };
    const waitFor = async (expression, { timeout = 60000, interval = 200 } = {}) => {
      const end = Date.now() + timeout;
      for (;;) {
        let v;
        try {
          v = await evaluate(expression);
        } catch {
          v = undefined;
        }
        if (v) return v;
        if (Date.now() > end) throw new Error(`等待逾時：${expression}`);
        await sleep(interval);
      }
    };
    const screenshot = async (clip) => {
      const r = await s('Page.captureScreenshot', { format: 'png', ...(clip ? { clip: { ...clip, scale: 1 } } : {}) });
      return Buffer.from(r.data, 'base64');
    };
    return {
      sessionId,
      targetId,
      send: s,
      on: (fn) => {
        const h = (msg) => msg.sessionId === sessionId && fn(msg);
        listeners.add(h);
        return () => listeners.delete(h);
      },
      evaluate,
      waitFor,
      screenshot,
      console,
      errors,
      close: async () => {
        listeners.delete(off);
        await send('Target.closeTarget', { targetId }).catch(() => {});
      },
    };
  }

  async function close() {
    try {
      await send('Browser.close');
    } catch {
      /* 已關閉 */
    }
    ws.close();
    for (let i = 0; i < 40 && !exited; i++) await sleep(50);
    if (!exited) proc.kill();
    for (let i = 0; i < 20; i++) {
      try {
        rmSync(userDir, { recursive: true, force: true });
        break;
      } catch {
        await sleep(100);
      }
    }
  }

  return { pid: proc.pid, browser, send, newPage, close, onEvent: (fn) => listeners.add(fn) };
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.wasm': 'application/wasm',
};

/** 把 dir 放在 /（或 mount）下的極簡靜態伺服器；回傳 { url, close }。 */
export function serveDir(dir, { port = 0, mount = '/' } = {}) {
  const server = createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
    if (!pathname.startsWith(mount)) {
      res.writeHead(404).end();
      return;
    }
    let rel = pathname.slice(mount.length);
    if (rel === '' || rel.endsWith('/')) rel += 'index.html';
    const file = normalize(join(dir, rel));
    if (!file.startsWith(normalize(dir) + sep) || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
    createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      const addr = server.address();
      resolve({ url: `http://127.0.0.1:${addr.port}${mount}`, close: () => new Promise((r) => server.close(() => r())) });
    });
  });
}
