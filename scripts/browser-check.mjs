// 瀏覽器煙霧測試（M1-16，npm run check:browser）：用本機 Chrome／Edge 的 headless 模式（實體 GPU）實測 dist/：
//   boot        直接開遊戲：載入完成、開始遊玩、HUD 顯示、主控台沒有錯誤。
//   cover       #cover：下載封面按鈕、HUD 隱藏、擷取 800 × 500 的封面（≤ 5 MiB）。
//   demo        #demo 自動完成連招（M1-15）。
//   iframe      平台模擬頁（npm run sim 同款伺服器，跨來源 sandbox iframe）：iframe 內載入完成並跑完 #demo。
//   nostorage   localStorage 存取丟 SecurityError：仍可載入並開始遊玩。
//   contextlost WEBGL_lose_context：顯示「3D 繪圖中斷」並暫停；恢復後錯誤畫面消失、繼續繪製。
//   runtime     遊戲迴圈連續丟例外：停止並顯示「遊戲執行時發生錯誤」。
//   nowebgl     以 --disable-3d-apis 停用 WebGL：顯示「無法使用 3D 繪圖」錯誤畫面與重試按鈕，不是白畫面。
//   nowasm      WebAssembly.instantiate／compile 被封鎖：顯示「物理引擎載入失敗」。
//   loadfail    遊戲檔案（rapier chunk）下載失敗：index.html 的看門狗顯示提示與重試。
// --shots <資料夾> 存下錯誤畫面與恢復後的截圖。
// 用法：npm run build && npm run check:browser -- [--browser chrome|edge] [--only boot,demo,...]
// 不下載任何瀏覽器；只結束自己啟動的瀏覽器與伺服器。
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GPU_FLAGS, launchBrowser, serveDir } from './lib/browser.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : def;
};
const browserName = opt('browser', 'chrome');
const only = opt('only', null)?.split(',') ?? null;
// --shots <資料夾>：把錯誤畫面等截圖存起來（文件用）。
const shotsDir = opt('shots', null);
const saveShot = (name, buf) => {
  if (!shotsDir) return;
  mkdirSync(resolve(root, shotsDir), { recursive: true });
  writeFileSync(resolve(root, shotsDir, name), buf);
};
const dist = resolve(root, 'dist');
if (!existsSync(resolve(dist, 'index.html'))) {
  console.error('找不到 dist/index.html，請先執行 npm run build');
  process.exit(1);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FLAGS = GPU_FLAGS.filter((f) => f !== '--disable-gpu-vsync' && f !== '--disable-frame-rate-limit');
// 與遊戲無關、可以忽略的主控台訊息。
const IGNORED = [/favicon\.ico/, /WebGL context lost/i, /THREE\.WebGLRenderer: Context Lost/i];
const realErrors = (page) =>
  [...page.errors, ...page.console.filter((c) => c.type === 'error').map((c) => c.text)].filter((t) => !IGNORED.some((re) => re.test(t)));

const results = [];
async function scenario(name, fn) {
  if (only && !only.includes(name)) return;
  const t0 = Date.now();
  try {
    const detail = await fn();
    results.push({ name, ok: true, detail });
    console.log(`✔ ${name}（${((Date.now() - t0) / 1000).toFixed(1)} s）${detail ? `：${detail}` : ''}`);
  } catch (err) {
    results.push({ name, ok: false, detail: String(err?.message ?? err) });
    console.log(`✘ ${name}：${err?.message ?? err}`);
  }
}

const bootState = `document.documentElement.dataset.swBoot`;
async function withBrowser(flags, fn) {
  const browser = await launchBrowser({ browser: browserName, width: 1280, height: 720, flags });
  try {
    return await fn(browser);
  } finally {
    await browser.close();
  }
}

const server = await serveDir(dist);
try {
  await withBrowser(FLAGS, async (browser) => {
    await scenario('boot', async () => {
      const page = await browser.newPage(`${server.url}#debug&nolock`);
      await page.waitFor(`['ready','error'].includes(${bootState})`, { timeout: 90000 });
      if ((await page.evaluate(bootState)) !== 'ready') throw new Error(`啟動失敗：${realErrors(page).join('；')}`);
      const bootGone = await page.evaluate(`!document.getElementById('sw-boot')`);
      if (await page.evaluate(`!!document.querySelector('.sw-cover-download')`)) throw new Error('非 #cover 時出現了「下載封面」按鈕');
      await page.evaluate(`window.__shardwake.panel.close(); window.__shardwake.menuActions.start()`);
      await page.waitFor(`window.__shardwake.game.mode === 'playing'`, { timeout: 5000 });
      await sleep(1500);
      const s = await page.evaluate(`(() => { const sw = window.__shardwake; return { hud: !sw.hud.root.hidden, calls: sw.renderer.info.render.calls, steps: sw.game.loop.stepCount, errors: sw.frameGuard.errors }; })()`);
      if (!bootGone) throw new Error('載入畫面沒有移除');
      if (!s.hud || s.calls <= 0 || s.steps <= 0) throw new Error(`遊玩狀態異常 ${JSON.stringify(s)}`);
      const errs = realErrors(page);
      if (errs.length || s.errors) throw new Error(`主控台錯誤：${errs.join('；')}（迴圈例外 ${s.errors}）`);
      await page.close();
      return `draw calls ${s.calls}、步數 ${s.steps}`;
    });

    await scenario('cover', async () => {
      const page = await browser.newPage(`${server.url}#cover`);
      await page.waitFor(`document.documentElement.dataset.swCover === 'ready'`, { timeout: 90000 });
      const r = await page.evaluate(`(async () => {
        const btn = document.querySelector('.sw-cover-download');
        const hud = document.querySelector('.sw-hud');
        const menu = document.documentElement.dataset.swMenu ?? null;
        const url = await window.__shardwakeCover.capture();
        const img = new Image();
        await new Promise((res) => { img.onload = res; img.src = url; });
        return { button: btn?.textContent ?? null, hudHidden: hud?.hidden ?? null, menu, size: [img.width, img.height], bytes: Math.round(url.length * 0.75) };
      })()`);
      const errs = realErrors(page);
      await page.close();
      if (r.button !== '下載封面' || r.hudHidden !== true || r.size.join('x') !== '800x500' || r.bytes > 5 * 1024 * 1024) throw new Error(JSON.stringify(r));
      if (errs.length) throw new Error(`主控台錯誤：${errs.join('；')}`);
      return `按鈕「${r.button}」、HUD 隱藏、${r.size.join(' × ')}、約 ${(r.bytes / 1024).toFixed(0)} KiB`;
    });

    await scenario('demo', async () => {
      const page = await browser.newPage(`${server.url}#demo`);
      await page.waitFor(`['done','failed'].includes(document.documentElement.dataset.swDemo)`, { timeout: 120000 });
      const r = await page.evaluate(`({ state: document.documentElement.dataset.swDemo, combo: document.documentElement.dataset.swDemoCombo, err: document.documentElement.dataset.swDemoError })`);
      const errs = realErrors(page);
      await page.close();
      if (r.state !== 'done' || r.combo !== 'ok') throw new Error(JSON.stringify(r));
      if (errs.length) throw new Error(`主控台錯誤：${errs.join('；')}`);
      return `連招完成、終點差 ${r.err} mm`;
    });

    await scenario('nostorage', async () => {
      const page = await browser.newPage('about:blank');
      await page.send('Page.addScriptToEvaluateOnNewDocument', {
        source: `Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new DOMException('儲存已停用（測試）', 'SecurityError'); } });`,
      });
      await page.send('Page.navigate', { url: `${server.url}#debug&nolock` });
      await page.waitFor(`['ready','error'].includes(${bootState})`, { timeout: 90000 });
      if ((await page.evaluate(bootState)) !== 'ready') throw new Error(`啟動失敗：${realErrors(page).join('；')}`);
      await page.evaluate(`window.__shardwake.panel.close(); window.__shardwake.menuActions.start()`);
      await page.waitFor(`window.__shardwake.game.mode === 'playing'`, { timeout: 5000 });
      const persistent = await page.evaluate(`window.__shardwake.storage.isPersistent`);
      await page.evaluate(`window.__shardwake.settings.set('sensitivity', 1.7)`);
      const kept = await page.evaluate(`window.__shardwake.settings.get('sensitivity')`);
      const errs = realErrors(page);
      await page.close();
      if (persistent !== false || kept !== 1.7) throw new Error(`persistent=${persistent} sensitivity=${kept}`);
      if (errs.length) throw new Error(`主控台錯誤：${errs.join('；')}`);
      return '退回記憶體儲存，可遊玩';
    });

    await scenario('contextlost', async () => {
      const page = await browser.newPage(`${server.url}#debug&nolock`);
      await page.waitFor(`${bootState} === 'ready'`, { timeout: 90000 });
      await page.evaluate(`window.__shardwake.panel.close(); window.__shardwake.menuActions.start(); window.__lose = window.__shardwake.renderer.getContext().getExtension('WEBGL_lose_context'); window.__lose.loseContext();`);
      await page.waitFor(`document.documentElement.dataset.swError === 'contextLost'`, { timeout: 5000 });
      const lost = await page.evaluate(`({ mode: window.__shardwake.game.mode, title: document.querySelector('.sw-error-title').textContent, visible: !document.querySelector('.sw-error').hidden })`);
      await sleep(500);
      saveShot('M1-16-error-context-lost.png', await page.screenshot());
      await page.evaluate(`window.__lose.restoreContext()`);
      await page.waitFor(`document.documentElement.dataset.swContext === 'restored' && !document.documentElement.dataset.swError`, { timeout: 10000 });
      await sleep(1500);
      const after = await page.evaluate(`(() => { const sw = window.__shardwake; sw.menuActions.resume(); return { calls: sw.renderer.info.render.calls, lost: sw.renderer.getContext().isContextLost(), errors: sw.frameGuard.errors }; })()`);
      await sleep(500);
      const shot = await page.screenshot();
      saveShot('M1-16-context-restored.png', shot);
      const errs = realErrors(page);
      await page.close();
      if (lost.mode !== 'paused' || !lost.visible) throw new Error(`中斷時 ${JSON.stringify(lost)}`);
      if (after.lost || after.calls <= 0) throw new Error(`恢復後 ${JSON.stringify(after)}`);
      if (errs.length || after.errors) throw new Error(`主控台錯誤：${errs.join('；')}（迴圈例外 ${after.errors}）`);
      return `中斷：「${lost.title}」並暫停；恢復後 draw calls ${after.calls}（截圖 ${shot.length} bytes）`;
    });

    await scenario('runtime', async () => {
      const page = await browser.newPage(`${server.url}#debug&nolock`);
      await page.waitFor(`${bootState} === 'ready'`, { timeout: 90000 });
      await page.evaluate(`window.__shardwake.panel.close(); window.__shardwake.game.addSystem({ name: 'boom', update() { throw new Error('測試：畫面更新錯誤'); } })`);
      await page.waitFor(`document.documentElement.dataset.swError === 'runtime'`, { timeout: 5000 });
      const r = await page.evaluate(`({ title: document.querySelector('.sw-error-title').textContent, detail: document.querySelector('.sw-error-detail').textContent, retry: document.querySelector('.sw-error-retry').textContent })`);
      await page.close();
      if (!r.detail.includes('測試：畫面更新錯誤')) throw new Error(JSON.stringify(r));
      return `「${r.title}」・按鈕「${r.retry}」`;
    });
  });

  // 平台模擬頁：跨來源 sandbox iframe（遊戲在 127.0.0.1:4174，平台在 localhost:4173）。
  await scenario('iframe', async () => {
    const env = { ...process.env, SIM_PLATFORM_PORT: '4183', SIM_GAME_PORT: '4184' };
    const sim = spawn(process.execPath, [resolve(root, 'scripts/platform-sim.mjs')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    try {
      await new Promise((res, rej) => {
        const t = setTimeout(() => rej(new Error('平台模擬頁沒有啟動')), 10000);
        sim.stdout.on('data', (d) => String(d).includes('平台模擬頁') && (clearTimeout(t), res()));
        sim.on('exit', (code) => rej(new Error(`平台模擬頁結束（${code}）`)));
      });
      return await withBrowser(FLAGS, async (browser) => {
        const page = await browser.newPage('http://localhost:4183/');
        await page.waitFor(`document.getElementById('game') && document.getElementById('game').src`, { timeout: 10000 });
        // 跨來源 iframe 是獨立的程序（OOPIF）：自動附加取得它的 CDP session。
        let frameSession = null;
        const frameConsole = [];
        page.on((msg) => {
          if (msg.method === 'Target.attachedToTarget' && msg.params.targetInfo.type === 'iframe') frameSession = msg.params.sessionId;
        });
        browser.onEvent((msg) => {
          if (msg.sessionId && msg.sessionId === frameSession) {
            if (msg.method === 'Runtime.exceptionThrown') frameConsole.push(msg.params.exceptionDetails.exception?.description ?? 'exception');
            if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') frameConsole.push(msg.params.args.map((a) => a.value ?? a.description).join(' '));
          }
        });
        await page.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
        await page.evaluate(`(() => { const f = document.getElementById('game'); f.src = f.src.split('#')[0] + '#demo'; })()`);
        const fe = (expr) => browser.send('Runtime.evaluate', { expression: expr, returnByValue: true }, frameSession).then((r) => r.result.value);
        const end = Date.now() + 120000;
        let state = null;
        for (;;) {
          await sleep(500);
          if (frameSession) {
            try {
              await browser.send('Runtime.enable', {}, frameSession);
              state = await fe(`JSON.stringify({ href: location.href, boot: document.documentElement.dataset.swBoot, demo: document.documentElement.dataset.swDemo, combo: document.documentElement.dataset.swDemoCombo, embedded: document.documentElement.dataset.swEmbedded, coi: globalThis.crossOriginIsolated })`);
              state = JSON.parse(state);
              if (state.href.includes('#demo') && ['done', 'failed'].includes(state.demo)) break;
            } catch {
              /* iframe 重新載入中 */
            }
          }
          if (Date.now() > end) throw new Error(`逾時：${JSON.stringify(state)}`);
        }
        await page.close();
        if (state.demo !== 'done' || state.combo !== 'ok' || state.embedded !== 'true' || state.coi !== false) throw new Error(JSON.stringify(state));
        const errs = frameConsole.filter((t) => !IGNORED.some((re) => re.test(t)));
        if (errs.length) throw new Error(`iframe 主控台錯誤：${errs.join('；')}`);
        return `embedded=${state.embedded}、crossOriginIsolated=${state.coi}、#demo 連招完成`;
      });
    } finally {
      sim.kill();
    }
  });

  await scenario('nowebgl', () =>
    withBrowser([...FLAGS, '--disable-3d-apis', '--disable-webgl'], async (browser) => {
      const page = await browser.newPage(`${server.url}`);
      await page.waitFor(`${bootState} === 'error'`, { timeout: 30000 });
      const r = await page.evaluate(`({ kind: document.documentElement.dataset.swError, title: document.querySelector('.sw-error-title')?.textContent, retry: document.querySelector('.sw-error-retry')?.textContent, visible: !document.querySelector('.sw-error').hidden, boot: !!document.getElementById('sw-boot') })`);
      const shot = await page.screenshot();
      saveShot('M1-16-error-webgl.png', shot);
      await page.close();
      if (r.kind !== 'webgl' || !r.visible || r.boot) throw new Error(JSON.stringify(r));
      return `「${r.title}」・按鈕「${r.retry}」（截圖 ${shot.length} bytes）`;
    }),
  );

  // WebAssembly 被封鎖（Chrome 的 --noexpose-wasm 旗標實測無效，改在頁面載入前讓 instantiate／compile 拒絕）。
  await scenario('nowasm', () =>
    withBrowser(FLAGS, async (browser) => {
      const page = await browser.newPage('about:blank');
      await page.send('Page.addScriptToEvaluateOnNewDocument', {
        source: `for (const k of ['instantiate', 'compile', 'instantiateStreaming', 'compileStreaming']) WebAssembly[k] = () => Promise.reject(new WebAssembly.CompileError('測試：WebAssembly 已被封鎖'));`,
      });
      await page.send('Page.navigate', { url: server.url });
      await page.waitFor(`${bootState} === 'error'`, { timeout: 30000 });
      const r = await page.evaluate(`({ kind: document.documentElement.dataset.swError, title: document.querySelector('.sw-error-title')?.textContent, stage: document.querySelector('.sw-error-stage')?.textContent })`);
      await page.close();
      if (r.kind !== 'physics') throw new Error(JSON.stringify(r));
      return `「${r.title}」${r.stage}`;
    }),
  );

  // 遊戲檔案下載失敗（以 CDP Fetch 讓 rapier chunk 失敗）：主程式無法執行，index.html 的看門狗顯示提示與重試，不是一直「載入中」。
  await scenario('loadfail', () =>
    withBrowser(FLAGS, async (browser) => {
      const page = await browser.newPage('about:blank');
      await page.send('Fetch.enable', { patterns: [{ urlPattern: '*rapier-*.js' }] });
      page.on((msg) => {
        if (msg.method === 'Fetch.requestPaused') void page.send('Fetch.failRequest', { requestId: msg.params.requestId, errorReason: 'ConnectionReset' });
      });
      await page.send('Page.navigate', { url: server.url });
      await page.waitFor(`document.getElementById('sw-boot-slow') && !document.getElementById('sw-boot-slow').hidden`, { timeout: 15000 });
      const r = await page.evaluate(`({ text: document.querySelector('#sw-boot-slow p').textContent, button: document.querySelector('#sw-boot-slow button').textContent, boot: document.documentElement.dataset.swBoot ?? null })`);
      await page.close();
      if (r.boot !== null) throw new Error(JSON.stringify(r));
      return `看門狗：「${r.text}」・按鈕「${r.button}」`;
    }),
  );
} finally {
  await server.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${browserName}：${results.length - failed.length}／${results.length} 通過`);
process.exit(failed.length ? 1 : 0);
