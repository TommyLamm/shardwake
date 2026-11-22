// 進入點：建立核心執行框架（M1-02）、輸入系統（M1-03）並掛上開機場景。
// renderer.setAnimationLoop 每畫面呼叫 Game.frame()：beginFrame（滑鼠視角）→ 固定步長模擬 → update → render。
// 「點擊開始」覆蓋層與滑鼠鎖定流程見 input/LockFlow.ts、ui/StartOverlay.ts；完整選單在 M1-14。
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { BOOT_SCENE_CONFIG as CFG } from '@/bootConfig';
import { LOOP_CONFIG, VIEWPORT_CONFIG } from '@/core/config';
import { EventBus } from '@/core/EventBus';
import type { GameEvents, GameMode } from '@/core/events';
import { Game, SystemOrder, type GameSystem } from '@/core/Game';
import { Lifecycle } from '@/core/Lifecycle';
import { horizontalToVerticalFov } from '@/core/math';
import { QUALITY_PRESETS, SETTINGS_SCHEMA, SettingsStore, type Settings, type SettingsKey } from '@/core/Settings';
import { GameStorage } from '@/core/Storage';
import { Viewport } from '@/core/Viewport';
import { DebugPanel, hasHashFlag, type ConfigSchema, type ParamSpec } from '@/debug/DebugPanel';
import { StatsOverlay } from '@/debug/Stats';
import { actionsInMask } from '@/input/Actions';
import { Bindings } from '@/input/Bindings';
import { INPUT_CONFIG } from '@/input/config';
import { InputSystem } from '@/input/Input';
import { LockFlow } from '@/input/LockFlow';
import { cmPer360, type ViewAngles } from '@/input/Mouse';
import { PointerLock } from '@/input/PointerLock';
import { StartOverlay } from '@/ui/StartOverlay';
import { BootScene } from '@/world/BootScene';
import './style.css';

function getAppRoot(): HTMLElement {
  const el = document.getElementById('app');
  if (!el) throw new Error('找不到 #app 容器');
  return el;
}

async function initPhysics(): Promise<RAPIER.World> {
  await RAPIER.init();
  const world = new RAPIER.World({ x: 0, y: CFG.gravityY, z: 0 });
  console.info(
    `[shardwake] Rapier ${RAPIER.version()} 已初始化；crossOriginIsolated=${String(
      globalThis.crossOriginIsolated ?? false,
    )}；SharedArrayBuffer ${typeof SharedArrayBuffer === 'undefined' ? '不可用' : '可用'}（不需要）`,
  );
  return world;
}

/** Rapier 世界：固定步內以 stepDt 推進（M1-04 擴充成完整物理系統）。 */
function physicsSystem(world: RAPIER.World): GameSystem {
  return {
    name: 'physics',
    order: SystemOrder.physics,
    fixedUpdate(dt) {
      world.timestep = dt;
      world.step();
    },
    dispose() {
      world.free();
    },
  };
}

function renderSystem(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera): GameSystem {
  return {
    name: 'render',
    order: SystemOrder.render,
    render() {
      renderer.render(scene, camera);
    },
  };
}

/** 暫時的鏡頭：每個渲染畫面直接套用滑鼠視角（不插值、不平滑；M1-05／M1-08 換成正式鏡頭）。 */
function cameraSystem(camera: THREE.Camera, view: ViewAngles): GameSystem {
  return {
    name: 'camera',
    order: SystemOrder.camera,
    render() {
      camera.rotation.set(view.viewPitch, view.viewYaw, 0, 'YXZ');
    },
  };
}

/** 把設定欄位規格轉成調參面板規格。 */
function settingsPanelSchema(): ConfigSchema<Settings> {
  const out: Partial<Record<SettingsKey, ParamSpec>> = {};
  for (const key of Object.keys(SETTINGS_SCHEMA) as SettingsKey[]) {
    const spec = SETTINGS_SCHEMA[key];
    if (spec.type === 'number') out[key] = { label: spec.label, min: spec.min, max: spec.max, step: spec.step };
    else if (spec.type === 'boolean') out[key] = { label: spec.label };
    else {
      const options: Record<string, string> = {};
      spec.options.forEach((value, i) => {
        options[spec.optionLabels[i] ?? value] = value;
      });
      out[key] = { label: spec.label, options };
    }
  }
  return out;
}

async function boot(): Promise<void> {
  const app = getAppRoot();
  const bus = new EventBus<GameEvents>();
  const storage = new GameStorage({
    onStatusChange: (persistent, reason) => bus.emit('storage:status', { persistent, reason }),
  });
  const settings = new SettingsStore(storage, bus);
  const game = new Game({ bus, loop: LOOP_CONFIG });

  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(CFG.clearColor);
  app.appendChild(renderer.domElement);

  const camera = new THREE.PerspectiveCamera(70, 1, 0.05, 200);
  camera.position.set(0, 1.4, 4.2);
  const applyFov = (): void => {
    camera.fov = horizontalToVerticalFov(settings.get('fovHorizontal'), camera.aspect);
    camera.updateProjectionMatrix();
  };

  const viewport = new Viewport({
    container: app,
    renderer,
    bus,
    config: VIEWPORT_CONFIG,
    renderScale: settings.qualityPreset.renderScale,
  });
  viewport.addCamera(camera);
  viewport.onResize(applyFov);
  applyFov();

  const stats = new StatsOverlay({ container: app, visible: settings.get('showFps') });
  // ` 鍵改由輸入系統的 debugPanel 動作切換（可重新綁定）。
  const panel = new DebugPanel({ container: app, bus, getRenderInfo: () => renderer.info, listenKey: false });

  // ── 輸入（M1-03）───────────────────────────────────────
  const bindings = new Bindings({ storage, bus });
  let flow: LockFlow | null = null;
  let refreshOverlay = (): void => {};
  const pointerLock = new PointerLock({
    target: renderer.domElement,
    bus,
    onChange: (locked, intentional) => {
      document.documentElement.dataset.swLocked = String(locked);
      if (!locked) input.handleUnlock();
      flow?.lockChanged(locked, intentional);
    },
    onError: (message) => {
      console.warn(`[shardwake] 滑鼠鎖定失敗：${message}`);
      refreshOverlay();
    },
  });
  const input = new InputSystem({
    bindings,
    getSettings: () => settings.value,
    isLocked: () => pointerLock.locked,
    isRaw: () => pointerLock.rawInput,
  });
  // 開機場景的鏡頭位置：一開始看向方塊。
  input.view.set(0, Math.atan2(0.6 - 1.4, 4.2));
  // 網址 #nolock：不鎖定滑鼠（開發用，例如在開發者工具中逐步除錯、自動化測試）。
  flow = new LockFlow({
    game,
    lock: pointerLock,
    useLock: !hasHashFlag(location.hash, 'nolock'),
    onUpdate: () => refreshOverlay(),
  });
  const lockFlow = flow;
  input.onAction('pause', () => lockFlow.pauseRequested());
  input.onAction('debugPanel', () => panel.toggle());
  bus.on('debug:panel', ({ open }) => lockFlow.debugPanelChanged(open));

  settings.onChange((s, changed) => {
    if (changed.includes('quality')) viewport.setRenderScale(QUALITY_PRESETS[s.quality].renderScale);
    if (changed.includes('fovHorizontal')) applyFov();
    if (changed.includes('showFps')) stats.setVisible(s.showFps);
  });

  const scene = new BootScene(CFG);
  const world = await initPhysics();

  // 註冊順序不影響執行順序（依 SystemOrder），這裡依順序列出方便閱讀。
  game.addSystem(input);
  game.addSystem(physicsSystem(world));
  game.addSystem(scene);
  game.addSystem(cameraSystem(camera, input.view));
  game.addSystem(renderSystem(renderer, scene.scene, camera));
  game.addSystem(stats);
  game.addSystem(panel);

  // ── 調參面板 ─────────────────────────────────────────
  panel.bindConfig('核心/主迴圈', game.loop, {
    timeScale: { label: '時間倍率', min: 0, max: 2, step: 0.05, description: '慢動作倍率（0 = 凍結模擬）' },
  });
  panel.bindConfig('核心/主迴圈', game.loop.config, {
    hz: { label: '模擬頻率 Hz', min: 30, max: 240, step: 1, description: '固定步長模擬頻率，預設 120' },
    maxFrameDt: { label: '單畫面 dt 上限', min: 0.02, max: 0.5, step: 0.01, description: '秒；切分頁回來不爆衝' },
    maxStepsPerFrame: { label: '每畫面步數上限', min: 1, max: 16, step: 1, description: '防死亡螺旋' },
  });
  panel.bindConfig('核心/主迴圈', game.loop, {
    stepCount: { label: '累計步數', readonly: true },
    droppedTime: { label: '捨棄時間 s', readonly: true },
  });
  panel.bindConfig(
    '核心/畫面',
    VIEWPORT_CONFIG,
    { maxPixelRatio: { label: '像素比上限', min: 0.5, max: 3, step: 0.25, description: 'devicePixelRatio 上限，預設 1' } },
    { onChange: () => viewport.refresh() },
  );
  const settingsCopy: Settings = { ...settings.value };
  const settingsBinding = panel.bindConfig('設定', settingsCopy, settingsPanelSchema(), {
    onChange: (key, value) => settings.update({ [key]: value }),
  });
  settings.onChange((s) => {
    Object.assign(settingsCopy, s);
    settingsBinding.refresh();
  });
  panel.bindConfig(
    '開機場景',
    CFG,
    {
      spinSpeed: { label: '旋轉速度', params: { x: { min: -5, max: 5 }, y: { min: -5, max: 5 } } },
      emissiveIntensity: { label: '自發光強度', min: 0, max: 5, step: 0.05 },
      haloOpacity: { label: '光暈透明度', min: 0, max: 1, step: 0.01 },
      haloScale: { label: '光暈大小', min: 1, max: 2, step: 0.01 },
    },
    { onChange: () => scene.applyLook() },
  );

  // 輸入：可調數值與監看。
  panel.bindConfig('輸入/滑鼠', INPUT_CONFIG, {
    degreesPerCount: {
      label: '每 count 角度',
      min: 0.001,
      max: 0.1,
      step: 0.001,
      description: '度／count × 靈敏度；Source／Apex 尺度 0.022',
    },
    pitchLimitDeg: { label: 'pitch 上限°', min: 60, max: 89.9, step: 0.1 },
    preferRawInput: { label: '原始輸入', description: '鎖定時要求 unadjustedMovement（下次鎖定生效）' },
    spikeThreshold: {
      label: '跳動門檻',
      min: 0,
      max: 3000,
      step: 10,
      description: '一般鎖定時，單一事件超過此 count 且前一事件不大就丟棄；0 = 停用',
    },
    spikeNeighborRatio: { label: '連續甩動比例', min: 0, max: 1, step: 0.05 },
    spikeFilterRaw: { label: '原始輸入也過濾' },
  });
  panel.bindConfig('輸入/滾輪與鎖定', INPUT_CONFIG, {
    wheelNotchPx: { label: '滾輪一格 px', min: 1, max: 400, step: 1 },
    wheelLinePx: { label: '每行 px', min: 1, max: 100, step: 1 },
    wheelPagePx: { label: '每頁 px', min: 100, max: 2000, step: 10 },
    wheelResetMs: { label: '滾輪重設 ms', min: 0, max: 2000, step: 10 },
    relockCooldownMs: { label: '重新鎖定冷卻 ms', min: 0, max: 3000, step: 50, description: '只影響提示文字' },
  });
  const inputMonitor = { locked: false, raw: false, yaw: 0, pitch: 0, cm360: 0, move: '0, 0', held: '', spikes: 0 };
  panel.bindConfig('輸入/監看', inputMonitor, {
    locked: { label: '已鎖定', readonly: true },
    raw: { label: '原始輸入', readonly: true },
    yaw: { label: 'yaw°', readonly: true },
    pitch: { label: 'pitch°', readonly: true },
    cm360: { label: 'cm/360', readonly: true },
    move: { label: '移動', readonly: true },
    held: { label: '按住', readonly: true },
    spikes: { label: '丟棄跳動', readonly: true },
  });
  game.addSystem({
    name: 'inputMonitor',
    order: SystemOrder.debug,
    update() {
      if (!panel.isOpen) return;
      const f = input.frame;
      inputMonitor.locked = pointerLock.locked;
      inputMonitor.raw = pointerLock.rawInput;
      inputMonitor.yaw = THREE.MathUtils.radToDeg(input.view.viewYaw);
      inputMonitor.pitch = THREE.MathUtils.radToDeg(input.view.viewPitch);
      inputMonitor.cm360 = cmPer360(settings.get('sensitivity'), settings.get('mouseDpi'));
      inputMonitor.move = `${f.move.x.toFixed(2)}, ${f.move.y.toFixed(2)}`;
      inputMonitor.held = actionsInMask(f.held).join(' ');
      inputMonitor.spikes = input.mouse.spikeFilter.dropped;
    },
  });

  // ── 模式、覆蓋層與生命週期 ────────────────────────────
  const overlay = new StartOverlay(app, bindings);
  refreshOverlay = () =>
    overlay.update({
      mode: game.mode,
      pauseReason: game.pauseReason,
      needsRelock: lockFlow.needsRelock,
      lockError: lockFlow.error,
      lockCooldown: pointerLock.inCooldown,
      useLock: lockFlow.useLock,
      storagePersistent: storage.isPersistent,
    });
  // 冷卻提示會隨時間改變：非遊玩畫面時每畫面更新（內容沒變就不動 DOM）。
  game.addSystem({
    name: 'startOverlay',
    order: SystemOrder.ui,
    update() {
      if (game.mode !== 'playing' || lockFlow.needsRelock) refreshOverlay();
    },
  });
  const syncMode = (mode: GameMode): void => {
    document.documentElement.dataset.swMode = mode;
    refreshOverlay();
  };
  bus.on('game:mode', ({ to }) => {
    lockFlow.modeChanged(to);
    syncMode(to);
  });
  bus.on('storage:status', () => refreshOverlay());
  bindings.onChange(() => refreshOverlay());

  const lifecycle = new Lifecycle({ bus, onAutoPause: (reason) => game.pause(reason) });
  document.documentElement.dataset.swEmbedded = String(lifecycle.embedded);
  bus.on('lifecycle:visibility', ({ hidden }) => {
    // 回到分頁時重設時脈與 FPS 取樣，避免把離開的時間算進第一個畫面。
    if (!hidden) {
      game.resetClock();
      stats.sampler.reset();
    }
  });

  // 點擊遊戲畫面（覆蓋層會冒泡到這裡）：鎖定滑鼠並開始／繼續；調參面板內的點擊不處理。
  app.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || (e.target as Element | null)?.closest('.sw-debug')) return;
    void lockFlow.click();
  });

  // #debug 時把核心物件掛到 window，方便主控台與自動化測試檢查。
  const exposeDebug = (): void => {
    if (hasHashFlag(location.hash, 'debug')) {
      const handles = {
        ...{ game, bus, settings, storage, viewport, panel, lifecycle, camera, renderer },
        ...{ input, bindings, pointerLock, lockFlow },
      };
      (globalThis as Record<string, unknown>).__shardwake = handles;
    }
  };
  window.addEventListener('hashchange', exposeDebug);
  exposeDebug();

  game.setMode('title');
  syncMode(game.mode);
  renderer.setAnimationLoop((now: number) => {
    stats.beginFrame();
    panel.beginFrame();
    game.frame(now);
  });

  document.documentElement.dataset.swBoot = 'ready';
}

boot().catch((err: unknown) => {
  document.documentElement.dataset.swBoot = 'error';
  console.error('[shardwake] 啟動失敗', err);
});
