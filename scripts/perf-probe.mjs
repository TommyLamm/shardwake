// 效能探針（M1-16，npm run perf）：用本機 Chrome／Edge 的 headless 模式開 dist/，在無人機戰區跑一段
// 「激烈戰鬥 + 高速移動」的腳本輸入（前進／橫移、連射、跳、Dash、滑鏟、輪流切 5 把槍，無人機開啟、無敵），量測：
//   1. rAF 驅動 N 秒：畫面間隔與每畫面 CPU 時間（game.frame）分布、Tracing 的 GC 次數與長任務、renderer.info 最大值。
//   2. 同步吞吐量：連跑 M 個畫面（每畫面 1 個 120 Hz 固定步），每畫面以 1 px readPixels 強制等 GPU 完成並強制版面計算，
//      得到 CPU + GPU 的 frame time 分布（不受 headless 的 rAF 節奏影響）；高／中／低畫質各一次。
//   3. 取樣式記憶體配置剖析：熱迴圈每畫面配置的位元組與前幾名配置來源。
// 用法：npm run build && npm run perf -- [--browser chrome|edge] [--seconds 30] [--frames 600] [--width 1920 --height 1080] [--json out.json]
// 不下載任何瀏覽器；只結束自己啟動的瀏覽器程序。
import { writeFileSync, existsSync } from 'node:fs';
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
const seconds = Number(opt('seconds', 30));
const syncFrames = Number(opt('frames', 600));
const skipSync = syncFrames <= 0;
const width = Number(opt('width', 1920));
const height = Number(opt('height', 1080));
const jsonOut = opt('json', null);
const dist = resolve(root, opt('dist', 'dist'));
const flag = (name) => args.includes(`--${name}`);
// --vsync：保留瀏覽器的幀率限制（預設解除限制以量吞吐量）；--panel：量測時保留調參面板開啟（預設關閉，量玩家實際情況）。
const vsync = flag('vsync');
const keepPanel = flag('panel');
if (!existsSync(resolve(dist, 'index.html'))) {
  console.error('找不到 dist/index.html，請先執行 npm run build');
  process.exit(1);
}

// 頁面端的戰鬥腳本：安裝輸入來源與量測鉤子（字串注入）。
const SCENARIO = String.raw`(() => {
  const sw = window.__shardwake;
  const B = (i) => 1 << i;
  const A = { fwd: B(0), back: B(1), left: B(2), right: B(3), jump: B(4), crouch: B(5), dash: B(7), fire: B(9), reload: B(11) };
  const W = [B(14), B(15), B(16), B(17), B(18)];
  let step = 0, prev = 0;
  const hz = () => sw.game.loop.config.hz;
  const source = (out) => {
    const t = step++ / hz();
    let held = A.fire;
    // 前進 2.5 s／後退 1 s 交替，橫移正弦；看向戰區中央左右擺動、略往上看無人機。
    const phase = t % 3.5;
    if (phase < 2.5) held |= A.fwd; else held |= A.back;
    const sx = Math.sin(t * 1.7);
    if (sx > 0.35) held |= A.right; else if (sx < -0.35) held |= A.left;
    if (t % 1.3 < 0.12) held |= A.jump;
    if (t % 2.7 < 0.05) held |= A.dash;
    if (t % 4.1 > 3.4) held |= A.crouch;
    const wi = Math.floor(t / 5) % 5;
    if (t % 5 < 0.05) held |= W[wi];
    if (t % 5 > 4.2 && t % 5 < 4.27) held |= A.reload;
    out.move.x = (held & A.right ? 1 : 0) - (held & A.left ? 1 : 0);
    out.move.y = (held & A.fwd ? 1 : 0) - (held & A.back ? 1 : 0);
    const len = Math.hypot(out.move.x, out.move.y);
    if (len > 1) { out.move.x /= len; out.move.y /= len; }
    out.yaw = Math.sin(t * 0.6) * 1.0;
    out.pitch = 0.18 + Math.sin(t * 1.1) * 0.12;
    out.held = held >>> 0;
    out.pressed = (held & ~prev) >>> 0;
    out.released = (prev & ~held) >>> 0;
    prev = held;
    return true;
  };
  sw.health.config.invulnerable = true;
  sw.settings.set('trainingDrones', true);
  const arena = sw.levels.current.data.zones.find((z) => z.id === 'arena');
  const sp = arena.spawn;
  if (sw.game.mode === 'title') sw.game.start();
  sw.player.teleport({ x: sp.pos[0], y: sp.pos[1], z: sp.pos[2] - 6 }, 0);
  sw.input.setFrameSource(source);
  // 量測鉤子：每畫面 CPU 時間（game.frame）、畫面間隔、renderer.info 最大值、特效數。
  const m = (window.__perf = { cpu: [], interval: [], calls: 0, triangles: 0, lastNow: 0, recording: false, steps: 0, fx: 0, spikes: [] });
  const orig = sw.game.frame.bind(sw.game);
  sw.game.frame = (now) => {
    const t0 = performance.now();
    orig(now);
    const t1 = performance.now();
    if (m.recording) {
      m.cpu.push(t1 - t0);
      if (t1 - t0 > 12 && m.spikes.length < 400) m.spikes.push({ ms: +(t1 - t0).toFixed(1), t: +(step / hz()).toFixed(2), weapon: sw.weapons.active?.id ?? null, programs: sw.renderer.info.programs.length, steps: sw.game.loop.lastSteps ?? null });
      if (m.lastNow) m.interval.push(now - m.lastNow);
      const r = sw.renderer.info.render;
      if (r.calls > m.calls) m.calls = r.calls;
      if (r.triangles > m.triangles) m.triangles = r.triangles;
    }
    m.lastNow = now;
  };
  return { gpu: (() => { const gl = sw.renderer.getContext(); const e = gl.getExtension('WEBGL_debug_renderer_info'); return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER); })(),
    size: [sw.viewport.width, sw.viewport.height], pixelRatio: sw.viewport.pixelRatio };
})()`;

// 同步吞吐量：每畫面 1 個固定步（now 每次加 1/hz 秒），readPixels 1 px 等 GPU，offsetHeight 強制樣式／版面。
const SYNC = (frames) => String.raw`(() => {
  const sw = window.__shardwake;
  const gl = sw.renderer.getContext();
  const px = new Uint8Array(4);
  const hz = sw.game.loop.config.hz;
  let now = performance.now();
  const times = [];
  let calls = 0, tris = 0;
  for (let i = 0; i < ${frames}; i++) {
    now += 1000 / hz;
    const t0 = performance.now();
    sw.game.frame(now);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    void document.body.offsetHeight;
    times.push(performance.now() - t0);
    calls = Math.max(calls, sw.renderer.info.render.calls);
    tris = Math.max(tris, sw.renderer.info.render.triangles);
  }
  return { times, calls, tris, programs: sw.renderer.info.programs.length, geometries: sw.renderer.info.memory.geometries, textures: sw.renderer.info.memory.textures };
})()`;

function stats(list) {
  if (!list.length) return null;
  const s = [...list].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  const mean = s.reduce((a, b) => a + b, 0) / s.length;
  return { n: s.length, mean: +mean.toFixed(3), p50: +q(0.5).toFixed(3), p95: +q(0.95).toFixed(3), p99: +q(0.99).toFixed(3), max: +s[s.length - 1].toFixed(3) };
}

const server = await serveDir(dist);
const flags = vsync ? GPU_FLAGS.filter((f) => f !== '--disable-gpu-vsync' && f !== '--disable-frame-rate-limit') : GPU_FLAGS;
const browser = await launchBrowser({ browser: browserName, width, height, flags });
const report = { browser: browserName, date: new Date().toISOString(), width, height, vsync, panel: keepPanel };
try {
  const page = await browser.newPage(`${server.url}#debug&nolock`);
  await page.waitFor(`document.documentElement.dataset.swBoot === 'ready' || document.documentElement.dataset.swBoot === 'error'`, { timeout: 90000 });
  const boot = await page.evaluate(`document.documentElement.dataset.swBoot`);
  if (boot !== 'ready') throw new Error(`遊戲啟動失敗：${page.errors.join('\n')}`);
  await page.evaluate(`window.__shardwake.settings.update({ quality: 'high', renderScale: 'auto', shadows: 'auto', bloom: 'auto' })`);
  await new Promise((r) => setTimeout(r, 1500));
  if (!keepPanel) await page.evaluate(`window.__shardwake.panel.close()`);
  Object.assign(report, await page.evaluate(SCENARIO));
  console.log(`GPU：${report.gpu}；畫面 ${report.size.join(' × ')}，像素比 ${report.pixelRatio}`);
  await new Promise((r) => setTimeout(r, 3000)); // 先打一陣子讓特效池與無人機進入穩態

  // 1. rAF 驅動 + Tracing（GC、長任務）。
  const traceEvents = [];
  const offTrace = page.on((msg) => {
    if (msg.method === 'Tracing.dataCollected') traceEvents.push(...msg.params.value);
  });
  const traceDone = new Promise((r) => page.on((msg) => msg.method === 'Tracing.tracingComplete' && r()));
  await page.send('Tracing.start', {
    traceConfig: { includedCategories: ['devtools.timeline', 'v8', 'disabled-by-default-v8.gc', 'toplevel'], recordMode: 'recordAsMuchAsPossible' },
    transferMode: 'ReportEvents',
  });
  const heapBefore = await page.evaluate(`performance.memory ? performance.memory.usedJSHeapSize : 0`);
  await page.evaluate(`window.__perf.recording = true; window.__perf.cpu.length = 0; window.__perf.interval.length = 0;`);
  await new Promise((r) => setTimeout(r, seconds * 1000));
  const live = await page.evaluate(`(() => { const m = window.__perf; m.recording = false; return { cpu: m.cpu, interval: m.interval, calls: m.calls, triangles: m.triangles, spikes: m.spikes }; })()`);
  const heapAfter = await page.evaluate(`performance.memory ? performance.memory.usedJSHeapSize : 0`);
  await page.send('Tracing.end');
  await traceDone;
  offTrace();
  const gcNames = new Set(['MinorGC', 'MajorGC', 'V8.GC_SCAVENGER', 'V8.GC_MC_BACKGROUND_MARKING', 'V8.GCScavenger', 'V8.GCFinalizeMC', 'V8.GCIncrementalMarking']);
  const gc = { minor: 0, major: 0, totalMs: 0, maxMs: 0 };
  let longTasks = 0;
  let longestTask = 0;
  for (const e of traceEvents) {
    if (e.ph !== 'X' && e.ph !== 'B') continue;
    const dur = (e.dur ?? 0) / 1000;
    if (e.name === 'MinorGC' || e.name === 'MajorGC') {
      if (e.name === 'MinorGC') gc.minor++;
      else gc.major++;
      gc.totalMs += dur;
      gc.maxMs = Math.max(gc.maxMs, dur);
    } else if (e.name === 'RunTask' || e.name === 'ThreadControllerImpl::RunTask') {
      if (e.tid !== undefined && dur > 50) longTasks++;
      longestTask = Math.max(longestTask, dur);
    }
  }
  void gcNames;
  report.raf = {
    seconds,
    frames: live.cpu.length,
    fps: +(live.interval.length / (live.interval.reduce((a, b) => a + b, 0) / 1000)).toFixed(1),
    interval: stats(live.interval),
    cpu: stats(live.cpu),
    maxCalls: live.calls,
    maxTriangles: live.triangles,
    gc: { minor: gc.minor, major: gc.major, totalMs: +gc.totalMs.toFixed(1), maxMs: +gc.maxMs.toFixed(2) },
    longTasks,
    longestTaskMs: +longestTask.toFixed(1),
    heapDeltaKiB: +((heapAfter - heapBefore) / 1024).toFixed(0),
  };
  report.raf.spikes = live.spikes.length;
  report.raf.spikeSample = live.spikes.slice(0, 40);
  console.log('rAF：', JSON.stringify(report.raf));

  // 2. 取樣式配置剖析（含已被 GC 回收的物件）：熱迴圈每畫面配置量與前幾名來源。
  await page.send('HeapProfiler.enable');
  await page.send('HeapProfiler.collectGarbage');
  await page.evaluate(`window.__perf.recording = true; window.__perf.cpu.length = 0;`);
  await page.send('HeapProfiler.startSampling', { samplingInterval: 512, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
  await new Promise((r) => setTimeout(r, 8000));
  const { profile } = await page.send('HeapProfiler.stopSampling');
  const allocFrames = await page.evaluate(`(() => { window.__perf.recording = false; return window.__perf.cpu.length; })()`);
  const bySite = new Map();
  let total = 0;
  const walk = (node) => {
    const self = node.selfSize;
    if (self > 0) {
      const cf = node.callFrame;
      const key = `${cf.functionName || '(匿名)'} ${cf.url.split('/').pop()}:${cf.lineNumber + 1}:${cf.columnNumber + 1}`;
      bySite.set(key, (bySite.get(key) ?? 0) + self);
      total += self;
    }
    for (const c of node.children) walk(c);
  };
  walk(profile.head);
  const perFrame = (v) => (allocFrames ? Math.round(v / allocFrames) : v);
  const sorted = [...bySite.entries()].sort((a, b) => b[1] - a[1]);
  // 依來源分組：遊戲程式（index-*.js）、three、rapier、tweakpane、瀏覽器內建（url 空白）。
  const groupOf = (site) => {
    const file = site.split(' ').pop() ?? '';
    if (file.startsWith('index-')) return 'game';
    if (file.startsWith('three-')) return 'three';
    if (file.startsWith('rapier-')) return 'rapier';
    if (file.startsWith('tweakpane')) return 'tweakpane';
    return 'native';
  };
  const byGroup = {};
  for (const [k, v] of sorted) byGroup[groupOf(k)] = (byGroup[groupOf(k)] ?? 0) + v;
  report.alloc = {
    frames: allocFrames,
    bytesPerFrame: perFrame(total),
    byGroup: Object.fromEntries(Object.entries(byGroup).map(([k, v]) => [k, perFrame(v)])),
    top: sorted.slice(0, 15).map(([k, v]) => ({ site: k, bytesPerFrame: perFrame(v) })),
    topGame: sorted.filter(([k]) => groupOf(k) === 'game').slice(0, 20).map(([k, v]) => ({ site: k, bytesPerFrame: perFrame(v) })),
  };
  console.log(`配置：每畫面約 ${report.alloc.bytesPerFrame} bytes（${allocFrames} 畫面）；分組 ${JSON.stringify(report.alloc.byGroup)}`);
  for (const t of report.alloc.top) console.log(`  ${String(t.bytesPerFrame).padStart(7)} B/畫面  ${t.site}`);
  console.log('  遊戲程式前幾名：');
  for (const t of report.alloc.topGame) console.log(`  ${String(t.bytesPerFrame).padStart(7)} B/畫面  ${t.site}`);

  // 3. 同步吞吐量（高／中／低）。
  report.sync = {};
  for (const q of skipSync ? [] : ['high', 'medium', 'low']) {
    await page.evaluate(`window.__shardwake.settings.set('quality', '${q}')`);
    await new Promise((r) => setTimeout(r, 1500));
    await page.evaluate(SYNC(60)); // 暖機
    const r = await page.evaluate(SYNC(syncFrames));
    const st = stats(r.times);
    report.sync[q] = { ...st, fpsAtMean: +(1000 / st.mean).toFixed(0), calls: r.calls, triangles: r.tris, programs: r.programs, geometries: r.geometries, textures: r.textures };
    console.log(`同步 ${q}：`, JSON.stringify(report.sync[q]));
  }
  // 4. 成本拆解（--matrix）：高畫質下個別關閉陰影／Bloom、降低渲染比例。
  if (flag('matrix') && !skipSync) {
    report.matrix = {};
    const cases = {
      'high': {},
      'high-noShadow': { shadows: 'off' },
      'high-noBloom': { bloom: 'off' },
      'high-scale0.85': { renderScale: '0.85' },
      'high-scale0.75': { renderScale: '0.75' },
    };
    for (const [name, o] of Object.entries(cases)) {
      await page.evaluate(`window.__shardwake.settings.update(${JSON.stringify({ quality: 'high', renderScale: 'auto', shadows: 'auto', bloom: 'auto', ...o })})`);
      await new Promise((r) => setTimeout(r, 1500));
      await page.evaluate(SYNC(60));
      const r = await page.evaluate(SYNC(syncFrames));
      report.matrix[name] = { ...stats(r.times), calls: r.calls };
      console.log(`拆解 ${name}：`, JSON.stringify(report.matrix[name]));
    }
  }
  await page.evaluate(`window.__shardwake.settings.update({ quality: 'high', renderScale: 'auto', shadows: 'auto', bloom: 'auto' })`);
  report.errors = page.errors;
  report.consoleErrors = page.console.filter((c) => c.type === 'error').map((c) => c.text);
  if (report.errors.length || report.consoleErrors.length) console.log('主控台錯誤：', report.errors, report.consoleErrors);
  await page.close();
} finally {
  await browser.close();
  await server.close();
}
if (jsonOut) writeFileSync(resolve(root, jsonOut), JSON.stringify(report, null, 2) + '\n');
