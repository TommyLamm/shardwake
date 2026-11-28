// 進入點：建立核心執行框架（M1-02）、輸入系統（M1-03）、物理與灰盒訓練場（M1-04）、玩家控制器（M1-05；M1-06 跑牆與攀爬；
// M1-07 二段跳、噴射、Dash、抓鉤與繩索視覺）、鏡頭手感（M1-08：CameraRig、速度線）、
// 視覺風格與後處理（M1-09：材質庫、程序貼圖、燈光與陰影、天空與霧、全息看板、PostFX、畫質預設、著色器預熱）、
// 武器核心邏輯（M1-10：WeaponManager、Ballistics、5 把原型武器；開火震動與爆炸色差接到 CameraRig／PostFX）。
// renderer.setAnimationLoop 每畫面呼叫 Game.frame()：beginFrame（滑鼠視角）→ 固定步長模擬 → update → render（PostFX）。
// 「點擊開始」覆蓋層與滑鼠鎖定流程見 input/LockFlow.ts、ui/StartOverlay.ts；完整選單在 M1-14。
// 鏡頭由 CameraRig 放在玩家插值後的眼睛位置並疊加鏡頭效果（M1-08）；自由飛行相機保留為除錯用的穿牆飛行。
import * as THREE from 'three';
import { bindCameraPanel } from '@/camera/CameraPanel';
import { CameraRig } from '@/camera/CameraRig';
import { FREE_CAMERA_CONFIG, FreeCamera } from '@/camera/FreeCamera';
import { LOOP_CONFIG, VIEWPORT_CONFIG } from '@/core/config';
import { EventBus } from '@/core/EventBus';
import type { GameEvents, GameMode } from '@/core/events';
import { Game, SystemOrder } from '@/core/Game';
import { Lifecycle } from '@/core/Lifecycle';
import { resolveQualityPreset } from '@/core/quality';
import { SETTINGS_SCHEMA, SettingsStore, type Settings, type SettingsKey } from '@/core/Settings';
import { GameStorage } from '@/core/Storage';
import { Viewport } from '@/core/Viewport';
import { DebugPanel, hasHashFlag, type ConfigSchema, type ParamSpec } from '@/debug/DebugPanel';
import { StatsOverlay } from '@/debug/Stats';
import { actionsInMask } from '@/input/Actions';
import { Bindings } from '@/input/Bindings';
import { INPUT_CONFIG } from '@/input/config';
import { InputSystem } from '@/input/Input';
import { LockFlow } from '@/input/LockFlow';
import { cmPer360 } from '@/input/Mouse';
import { PointerLock } from '@/input/PointerLock';
import { GrappleRope } from '@/fx/GrappleRope';
import { PostFX } from '@/fx/PostFX';
import { SpeedLines } from '@/fx/SpeedLines';
import { bindVisualPanel } from '@/fx/VisualPanel';
import { runWarmup, type WarmupReport } from '@/fx/Warmup';
import { PHYSICS_CONFIG } from '@/physics/config';
import { Physics, PhysicsSystem } from '@/physics/Physics';
import { MovementDebug } from '@/player/MovementDebug';
import { bindMovementPanel } from '@/player/MovementPanel';
import { PlayerController } from '@/player/PlayerController';
import { makeHitbox, registerHitbox } from '@/combat/Damage';
import { Ballistics } from '@/weapons/Ballistics';
import { WeaponManager } from '@/weapons/WeaponManager';
import { bindWeaponPanel } from '@/weapons/WeaponPanel';
import { StartOverlay } from '@/ui/StartOverlay';
import { DataLevel, LevelManager } from '@/world/Level';
import { SceneLighting } from '@/world/Lighting';
import { ENVIRONMENT_CONFIG, MaterialLibrary, setupEnvironment } from '@/world/Materials';
import { Sky } from '@/world/Sky';
import { LevelDebug } from '@/world/LevelDebug';
import { TrainingGround } from '@/world/levels/TrainingGround';
import './style.css';

function getAppRoot(): HTMLElement {
  const el = document.getElementById('app');
  if (!el) throw new Error('找不到 #app 容器');
  return el;
}

async function initPhysics(): Promise<void> {
  await Physics.init();
  console.info(
    `[shardwake] Rapier ${Physics.version} 已初始化；crossOriginIsolated=${String(
      globalThis.crossOriginIsolated ?? false,
    )}；SharedArrayBuffer ${typeof SharedArrayBuffer === 'undefined' ? '不可用' : '可用'}（不需要）`,
  );
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

  // 反鋸齒改用後處理的 SMAA（M1-09）；色調映射（AgX）在 PostFX，renderer 本身不做。
  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  app.appendChild(renderer.domElement);

  // FOV 由 CameraRig 每畫面依設定的水平 FOV 與畫面比例設定（M1-08）。
  // 遠裁切 900 m：場地對角線約 226 m，遠景巨構剪影在 380–520 m（M1-09）。
  const camera = new THREE.PerspectiveCamera(70, 1, 0.05, 900);

  const viewport = new Viewport({
    container: app,
    renderer,
    bus,
    config: VIEWPORT_CONFIG,
    renderScale: settings.qualityPreset.renderScale,
  });
  viewport.addCamera(camera);

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
    if (changed.includes('showFps')) stats.setVisible(s.showFps);
  });

  // ── 物理與關卡（M1-04）─────────────────────────────────
  await initPhysics();
  const physics = new Physics({ bus });
  const scene = new THREE.Scene();
  // ── 視覺（M1-09）：後處理、環境反射、燈光、天空與霧、材質庫 ─────────
  const qualityPreset = (): ReturnType<typeof resolveQualityPreset> => resolveQualityPreset(settings.get('quality'));
  const postfx = new PostFX({ renderer, scene, camera, quality: qualityPreset() });
  postfx.aberrationEnabled = settings.get('chromaticAberration');
  postfx.setSize(viewport.width, viewport.height);
  viewport.onResize((size) => postfx.setSize(size.width, size.height));
  setupEnvironment(renderer, scene, ENVIRONMENT_CONFIG);
  const lighting = new SceneLighting({ scene, camera, quality: qualityPreset() });
  const sky = new Sky({ scene, camera, getPixelRatio: () => viewport.pixelRatio });
  const library = new MaterialLibrary({ maxAnisotropy: renderer.capabilities.getMaxAnisotropy() });
  const levels = new LevelManager({ physics, scene, visuals: library, bus });
  const currentDataLevel = (): DataLevel | null => (levels.current instanceof DataLevel ? levels.current : null);
  const feet = new THREE.Vector3();
  // 武器系統在玩家之後建立；玩家的開鏡減速讀它（M1-10）。
  let weaponsRef: WeaponManager | null = null;
  const player = new PlayerController({
    physics,
    bus,
    getFrame: () => input.frame,
    getSettings: () => settings.value,
    setView: (yaw, pitch) => input.view.set(yaw, pitch),
    checkRespawn: (p) => currentDataLevel()?.checkRespawn(p) ?? null,
    // 抓鉤脫鉤／落空後關掉「切換模式」的狀態；準星輔助用每畫面的視角。
    setToggle: (action, on) => input.builder.setToggle(action, on),
    getAim: () => aimView,
    getMoveSpeedScale: () => weaponsRef?.moveSpeedScale ?? 1,
  });
  const aimView = {
    get yaw(): number {
      return input.view.viewYaw;
    },
    get pitch(): number {
      return input.view.viewPitch;
    },
  };
  const freeCam = new FreeCamera({
    getFrame: () => input.frame,
    object: camera,
    setView: (yaw, pitch) => input.view.set(yaw, pitch),
    checkRespawn: (eye) => {
      const lvl = currentDataLevel();
      return lvl ? lvl.checkRespawn(feet.set(eye.x, eye.y - freeCam.config.eyeHeight, eye.z)) : null;
    },
  });
  // 自由相機預設關閉（除錯飛行：調參面板「自由相機/啟用」）。
  freeCam.enabled = false;
  player.enabled = true;
  // 區域追蹤的對象：玩家腳底（飛行除錯時為自由相機的腳底）。
  const focusFeet = new THREE.Vector3();
  const getFocus = (): THREE.Vector3 =>
    freeCam.enabled
      ? focusFeet.set(freeCam.position.x, freeCam.position.y - freeCam.config.eyeHeight, freeCam.position.z)
      : focusFeet.copy(player.position);
  levels.setFocus(getFocus);
  const level = await levels.load(new TrainingGround());
  const spawn = level.getSpawn();
  player.teleport(spawn.pos, spawn.yaw);
  const teleportActive = (s: { pos: THREE.Vector3; yaw: number }): void => {
    if (freeCam.enabled) freeCam.teleport(s.pos, s.yaw);
    else player.teleport(s.pos, s.yaw);
  };
  /** 切換除錯飛行：從目前位置接續，不跳視角。 */
  const setFlying = (fly: boolean): void => {
    const yaw = input.view.yaw;
    const pitch = input.view.pitch;
    if (fly) {
      freeCam.teleport(player.position, yaw, pitch);
      freeCam.enabled = true;
      player.enabled = false;
    } else {
      feet.set(freeCam.position.x, freeCam.position.y - freeCam.config.eyeHeight, freeCam.position.z);
      player.teleport(feet, yaw, pitch);
      player.enabled = true;
      freeCam.enabled = false;
    }
  };
  const levelDebug = new LevelDebug({
    scene,
    levels,
    physics,
    panel,
    bus,
    getFocus,
    teleport: teleportActive,
  });

  // 註冊順序不影響執行順序（依 SystemOrder），這裡依順序列出方便閱讀。
  game.addSystem(input);
  game.addSystem(player);
  game.addSystem(freeCam);
  game.addSystem(new PhysicsSystem(physics));
  game.addSystem(levels);
  // 鏡頭（M1-08）：跟隨玩家並疊加效果；除錯飛行時只套用視角（位置由自由相機設定）。
  const cameraRig = new CameraRig({
    camera,
    view: input.view,
    bus,
    getSettings: () => settings.value,
    getPlayer: () => (player.enabled ? player.state : null),
  });
  game.addSystem(cameraRig);
  // 武器（M1-10）：射擊起點是玩家這一步的眼睛，視線用 input.view（含後座偏移）；開鏡縮放寫入 CameraRig.fovZoom。
  const ballistics = new Ballistics({
    physics,
    bus,
    getPlayerCenter: (out) => {
      if (!player.enabled) return null;
      out.x = player.position.x;
      out.y = player.position.y + player.height / 2;
      out.z = player.position.z;
      return out;
    },
    applyPlayerImpulse: (dv) => player.addImpulse(dv),
  });
  const weapons = new WeaponManager({
    getFrame: () => input.frame,
    view: input.view,
    getPlayer: () => (player.enabled ? player : null),
    ballistics,
    bus,
    getSettings: () => settings.value,
    setToggle: (action, on) => input.builder.setToggle(action, on),
    mouse: input.mouse,
    camera: cameraRig,
  });
  weaponsRef = weapons;
  game.addSystem(weapons);
  // 開火的鏡頭震動與 FOV 衝擊、爆炸震動與色差（viewmodel 後座與特效在 M1-11）。
  bus.on('weapon:fire', ({ weaponId }) => {
    const def = weapons.active?.def;
    if (!def || def.id !== weaponId) return;
    if (def.feel.trauma > 0) cameraRig.addTrauma(def.feel.trauma);
    if (def.feel.fovKick !== 0) cameraRig.addFovKick(def.feel.fovKick, 0.18, 0.02);
  });
  bus.on('weapon:explosion', ({ point, radius, selfKnockback }) => {
    cameraRig.addTraumaAt(point, 0.5, Math.max(1, radius) * 3);
    if (selfKnockback > 0) postfx.pulseAberration(0.35, 0.2);
  });
  game.addSystem(lighting);
  game.addSystem(sky);
  game.addSystem({
    name: 'materials',
    order: SystemOrder.fx,
    render(_alpha, frame) {
      library.update(frame.realDt);
    },
  });
  game.addSystem(postfx);
  game.addSystem(stats);
  game.addSystem(panel);
  game.addSystem(levelDebug);

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
  // 物理、自由相機與灰盒外觀：可調數值。
  panel.bindConfig(
    '物理',
    PHYSICS_CONFIG,
    {
      worldGravityY: {
        label: '世界重力 y',
        min: -40,
        max: 0,
        step: 0.1,
        description: 'm/s²；只影響動態物件，玩家用自訂重力（M1-05）',
      },
      solverIterations: { label: '求解迭代', min: 1, max: 16, step: 1 },
    },
    { onChange: () => physics.applyConfig() },
  );
  panel.bindConfig('物理', physics, { stepCount: { label: '累計步數', readonly: true } });
  panel.bindConfig('自由相機', FREE_CAMERA_CONFIG, {
    speed: { label: '速度 m/s', min: 1, max: 60, step: 0.5 },
    boostMultiplier: { label: 'Shift 倍率', min: 1, max: 10, step: 0.1 },
    responsiveness: { label: '跟手程度', min: 1, max: 40, step: 0.5, description: '速度平滑的倒數時間常數（1/s）' },
    eyeHeight: { label: '眼高 m', min: 0.5, max: 3, step: 0.05 },
  });
  const flyState = { enabled: false };
  panel.bindConfig(
    '自由相機',
    flyState,
    { enabled: { label: '啟用（穿牆飛行）', description: '除錯用：停用玩家控制器，改用自由飛行相機' } },
    { onChange: (_k, v) => setFlying(Boolean(v)) },
  );
  // 移動（M1-05～M1-07）：所有 MovementConfig 參數（含能力開關）與監看；除錯顯示牆面／邊緣偵測射線。
  game.addSystem(bindMovementPanel(panel, player));
  const movementDebug = new MovementDebug({ scene, player, panel });
  game.addSystem(movementDebug);
  // 抓鉤繩索（M1-07）。
  const grappleRope = new GrappleRope({ scene, player, camera, panel });
  game.addSystem(grappleRope);
  // 速度線與調參面板「鏡頭」（M1-08）。
  const speedLines = new SpeedLines({
    scene,
    camera,
    getSpeed: () => (player.enabled ? player.state.speed : null),
    isEnabled: () => settings.get('speedLines'),
  });
  game.addSystem(speedLines);
  game.addSystem(bindCameraPanel(panel, cameraRig, speedLines));
  // 武器（M1-10）：目前手持武器的所有欄位、系統參數、監看、匯出 JSON。
  const weaponPanel = bindWeaponPanel({ panel, weapons, bus });
  game.addSystem(weaponPanel);
  // 視覺（M1-09）：畫質預設、後處理、燈光、天空與霧、全息看板、材質；畫質切換與著色器預熱。
  let warmupReport: WarmupReport | null = null;
  let warmupRunning: Promise<void> | null = null;
  const warmup = (reason: string): Promise<void> => {
    const run = async (): Promise<void> => {
      const report = await runWarmup({
        renderer,
        scene,
        camera,
        renderTarget: postfx.inputBuffer,
        textures: library.textures.textures(),
      });
      // 陰影深度材質與後處理的全螢幕材質在第一次 render 時編譯：先畫一個畫面。
      postfx.draw(0);
      report.programs = renderer.info.programs?.length ?? report.programs;
      warmupReport = report;
      console.info(
        `[shardwake] 著色器預熱（${reason}）：${report.materials} 個材質、${report.textures} 張貼圖、` +
          `${report.programs} 個著色器程式、${report.ms.toFixed(0)} ms`,
      );
    };
    const p = (warmupRunning ?? Promise.resolve()).then(run, run);
    warmupRunning = p;
    return p;
  };
  const applyQuality = (): void => {
    const q = qualityPreset();
    viewport.setRenderScale(q.renderScale);
    lighting.applyQuality(q);
    postfx.applyQuality(q);
    void warmup('切換畫質');
  };
  settings.onChange((s, changed) => {
    if (changed.includes('quality')) applyQuality();
    if (changed.includes('chromaticAberration')) {
      postfx.aberrationEnabled = s.chromaticAberration;
      if (!s.chromaticAberration) postfx.aberration.clear();
    }
  });
  bus.on('player:dash', () => postfx.pulseAberration(postfx.config.dashAberration, postfx.config.dashAberrationTime));
  game.addSystem(
    bindVisualPanel({
      panel,
      postfx,
      lighting,
      sky,
      library,
      scene,
      renderer,
      environment: ENVIRONMENT_CONFIG,
      getQualityLevel: () => settings.get('quality'),
      applyQuality,
      warmup: () => void warmup('手動'),
      getWarmupReport: () => warmupReport,
    }),
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
        ...{ physics, levels, freeCam, levelDebug, scene, player, movementDebug, grappleRope, cameraRig, speedLines },
        ...{ postfx, lighting, sky, library, getWarmupReport: () => warmupReport, warmup },
        ...{ weapons, ballistics, weaponPanel, combat: { registerHitbox, makeHitbox } },
      };
      (globalThis as Record<string, unknown>).__shardwake = handles;
    }
  };
  window.addEventListener('hashchange', exposeDebug);
  exposeDebug();

  // 著色器預熱（M1-09）：相機先放到出生點眼睛位置，編譯場景與預熱清單、上傳貼圖、畫一個畫面，完成後才顯示標題。
  camera.position.set(spawn.pos.x, spawn.pos.y + 1.6, spawn.pos.z);
  camera.rotation.set(0, spawn.yaw, 0, 'YXZ');
  await warmup('載入');

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
