// 進入點：建立核心執行框架（M1-02）並掛上開機場景。
// renderer.setAnimationLoop 每畫面呼叫 Game.frame()：固定步長模擬 → update → render。
// 「點擊開始／點擊繼續」與 Esc 暫停是暫時的接線，M1-03（輸入）與 M1-14（選單）取代。
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

/** 暫時的模式提示（M1-03 的「點擊開始」覆蓋層、M1-14 的選單取代）。 */
function createHint(app: HTMLElement): (mode: GameMode, persistent: boolean) => void {
  const el = document.createElement('div');
  el.className = 'sw-hint';
  app.appendChild(el);
  return (mode, persistent) => {
    const text: Partial<Record<GameMode, string>> = {
      title: '點擊畫面開始',
      paused: '已暫停：點擊畫面繼續',
    };
    const storageNote = persistent ? '' : '\n目前無法存檔（設定只保留到關閉頁面）';
    el.textContent = (text[mode] ?? '') + (mode === 'playing' ? '' : storageNote);
    el.hidden = el.textContent === '';
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
  camera.lookAt(0, 0.6, 0);
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
  const panel = new DebugPanel({ container: app, bus, getRenderInfo: () => renderer.info });

  settings.onChange((s, changed) => {
    if (changed.includes('quality')) viewport.setRenderScale(QUALITY_PRESETS[s.quality].renderScale);
    if (changed.includes('fovHorizontal')) applyFov();
    if (changed.includes('showFps')) stats.setVisible(s.showFps);
  });

  const scene = new BootScene(CFG);
  const world = await initPhysics();

  // 註冊順序不影響執行順序（依 SystemOrder），這裡依順序列出方便閱讀。
  game.addSystem(physicsSystem(world));
  game.addSystem(scene);
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

  // ── 模式與生命週期（暫時接線）─────────────────────────
  const showHint = createHint(app);
  const syncMode = (mode: GameMode): void => {
    document.documentElement.dataset.swMode = mode;
    showHint(mode, storage.isPersistent);
  };
  bus.on('game:mode', ({ to }) => syncMode(to));
  bus.on('storage:status', () => showHint(game.mode, storage.isPersistent));

  const lifecycle = new Lifecycle({ bus, onAutoPause: (reason) => game.pause(reason) });
  document.documentElement.dataset.swEmbedded = String(lifecycle.embedded);
  bus.on('lifecycle:visibility', ({ hidden }) => {
    // 回到分頁時重設時脈與 FPS 取樣，避免把離開的時間算進第一個畫面。
    if (!hidden) {
      game.resetClock();
      stats.sampler.reset();
    }
  });

  app.addEventListener('pointerdown', (e) => {
    if ((e.target as Element | null)?.closest('.sw-debug')) return;
    if (game.mode === 'title') game.start();
    else if (game.mode === 'paused') game.resume();
  });
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Escape' && !e.repeat) game.pause('user');
  });

  // #debug 時把核心物件掛到 window，方便主控台與自動化測試檢查。
  const exposeDebug = (): void => {
    if (hasHashFlag(location.hash, 'debug')) {
      const handles = { game, bus, settings, storage, viewport, panel, lifecycle, camera, renderer };
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
