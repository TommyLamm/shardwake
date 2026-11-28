// 進入點：建立核心執行框架（M1-02）、輸入系統（M1-03）、物理與灰盒訓練場（M1-04）、玩家控制器（M1-05；M1-06 跑牆與攀爬；
// M1-07 二段跳、噴射、Dash、抓鉤與繩索視覺）、鏡頭手感（M1-08：CameraRig、速度線）、
// 視覺風格與後處理（M1-09：材質庫、程序貼圖、燈光與陰影、天空與霧、全息看板、PostFX、畫質預設、著色器預熱）、
// 武器核心邏輯（M1-10：WeaponManager、Ballistics、5 把原型武器；開火震動與爆炸色差接到 CameraRig／PostFX）、
// 武器表現（M1-11：Viewmodel 場景與第二個 RenderPass、程序槍模、槍口閃光、曳光、命中火花、彈孔、電漿球與爆炸、準星、狙擊鏡遮罩）、
// 靶標與戰鬥回饋（M1-12：PlayerHealth、TargetManager（假人、移動靶、訓練無人機、DPS 計看板）、命中標記、傷害數字、受擊畫面回饋）、
// 程序合成音效（M1-13：AudioEngine（玩家第一次操作才建立 AudioContext）、AudioEventBinder（事件 → 音效）、載入時預渲染）、
// HUD、選單與設定（M1-14：ui/Hud 與 ui/hud/ 的元件、ui/menu/ 的標題／暫停／設定／按鍵配置／操作說明、i18n 字串表）、
// 調校工具（M1-15：tools/ 的預設組合、輸入錄製與確定性重播、鬼影、跑酷計時賽、#demo 示範，調參面板「工具」）。
// renderer.setAnimationLoop 每畫面呼叫 Game.frame()：beginFrame（滑鼠視角）→ 固定步長模擬 → update → render（PostFX）。
// 滑鼠鎖定流程見 input/LockFlow.ts：選單的「開始／繼續」按鈕與點擊背景在點擊事件中請求鎖定。
// 鏡頭由 CameraRig 放在玩家插值後的眼睛位置並疊加鏡頭效果（M1-08）；自由飛行相機保留為除錯用的穿牆飛行。
import * as THREE from 'three';
import { AUDIO_CONFIG } from '@/audio/AudioConfig';
import { buildStressScenario, renderStress } from '@/audio/audioDiagnostics';
import { AudioEngine } from '@/audio/AudioEngine';
import { AudioEventBinder } from '@/audio/AudioEvents';
import { bindAudioPanel } from '@/audio/AudioPanel';
import { bindCameraPanel } from '@/camera/CameraPanel';
import { CameraRig } from '@/camera/CameraRig';
import { FREE_CAMERA_CONFIG, FreeCamera } from '@/camera/FreeCamera';
import { LOOP_CONFIG, VIEWPORT_CONFIG } from '@/core/config';
import { EventBus } from '@/core/EventBus';
import type { GameEvents, GameMode } from '@/core/events';
import { Game, SystemOrder } from '@/core/Game';
import { Lifecycle } from '@/core/Lifecycle';
import { QUALITY_SETTING_KEYS, SETTINGS_SCHEMA, SettingsStore, type QualityPreset, type Settings, type SettingsKey } from '@/core/Settings';
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
import { registerWarmup, runWarmup, type WarmupReport } from '@/fx/Warmup';
import { WeaponFx } from '@/fx/WeaponFx';
import { PHYSICS_CONFIG } from '@/physics/config';
import { Physics, PhysicsSystem } from '@/physics/Physics';
import { MovementDebug } from '@/player/MovementDebug';
import { bindMovementPanel } from '@/player/MovementPanel';
import { PlayerController } from '@/player/PlayerController';
import { bindCombatPanel } from '@/combat/CombatPanel';
import { makeHitbox, registerHitbox } from '@/combat/Damage';
import { HitConfirmSystem } from '@/combat/HitConfirm';
import { PlayerHealth } from '@/combat/PlayerHealth';
import { TargetManager, type TargetPlayerInfo } from '@/combat/targets/TargetManager';
import { Ballistics } from '@/weapons/Ballistics';
import { WeaponManager } from '@/weapons/WeaponManager';
import { bindWeaponPanel } from '@/weapons/WeaponPanel';
import { Viewmodel } from '@/weapons/Viewmodel';
import { bindPresentationPanel } from '@/weapons/ViewmodelPanel';
import { Crosshair, crosshairStyleFor, effectiveSpreadDeg, type CrosshairInput } from '@/ui/Crosshair';
import { DamageNumbers } from '@/ui/DamageNumbers';
import { DamageOverlay } from '@/ui/DamageOverlay';
import { FEEDBACK_CONFIG } from '@/ui/FeedbackConfig';
import { damageIndicatorAngle, hitTrauma } from '@/ui/feedbackMath';
import { HitMarker } from '@/ui/HitMarker';
import { ScopeOverlay } from '@/ui/ScopeOverlay';
import { FullscreenControl } from '@/ui/fullscreen';
import { Hud } from '@/ui/Hud';
import { HUD_ABILITY_PANEL, HUD_CONFIG, HUD_LAYOUT_PANEL, HUD_MESSAGE_PANEL, HUD_VITALS_PANEL, HUD_WEAPON_PANEL } from '@/ui/HudConfig';
import { menuScale } from '@/ui/hudMath';
import { AbilitiesWidget } from '@/ui/hud/AbilitiesWidget';
import { GrappleHintWidget, MessagesWidget, TimerWidget } from '@/ui/hud/InfoWidgets';
import { VitalsWidget } from '@/ui/hud/VitalsWidget';
import { WeaponWidget } from '@/ui/hud/WeaponWidget';
import { ControlsScreen } from '@/ui/menu/ControlsScreen';
import { Menu } from '@/ui/menu/Menu';
import { menuStatus, type MenuStatusState } from '@/ui/menu/menuStatus';
import { HelpScreen, PauseScreen, SCREEN, TitleScreen, type MenuActions } from '@/ui/menu/screens';
import { SettingsScreen } from '@/ui/menu/SettingsScreen';
import { t } from '@/i18n';
import { setupTuningTools } from '@/tools/TuningTools';
import demoClip from '@/debug/demo-clip.json';
import { version as GAME_VERSION } from '../package.json';
import { DataLevel, LevelManager } from '@/world/Level';
import { SceneLighting } from '@/world/Lighting';
import { ENVIRONMENT_CONFIG, MaterialLibrary, setupEnvironment } from '@/world/Materials';
import { Sky } from '@/world/Sky';
import { LevelDebug } from '@/world/LevelDebug';
import { TRAINING_GROUND_ID, TrainingGround } from '@/world/levels/TrainingGround';
import './style.css';
import './ui/hud.css';
import './ui/menu.css';

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
  });
  const lockFlow = flow;
  // 暫停鍵：遊玩中暫停並解除鎖定；選單中為「返回上一層」（Esc 由選單自己在 capture 階段處理，這裡只會收到改綁的暫停鍵）。
  let menuBack = (): boolean => false;
  input.onAction('pause', () => {
    if (game.mode === 'playing') lockFlow.pauseRequested();
    else menuBack();
  });
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
  // 畫質：畫質預設套用玩家的渲染比例／陰影／Bloom 覆寫（M1-14）。
  const qualityPreset = (): QualityPreset => settings.qualityPreset;
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
  // 影響模擬的設定：錄影重播期間改用錄影記下的值（M1-15；目前只有自動衝刺），其餘時間是玩家設定。
  let simSettingsOverride: Settings | null = null;
  const simSettings = (): Readonly<Settings> => simSettingsOverride ?? settings.value;
  const player = new PlayerController({
    physics,
    bus,
    getFrame: () => input.frame,
    getSettings: simSettings,
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
  // 玩家生命與護盾（M1-12）：敵方能量球、自傷打在這裡；死亡淡出後在出生點（或最近檢查點）重生。
  let onPlayerRespawn = (): void => {};
  const health = new PlayerHealth({
    bus,
    getCenter: (out) => {
      if (!player.enabled) return null;
      out.x = player.position.x;
      out.y = player.position.y + player.height / 2;
      out.z = player.position.z;
      return out;
    },
    onRespawn: () => onPlayerRespawn(),
  });
  game.addSystem(health);
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
    getSelfTarget: () => health,
  });
  const weapons = new WeaponManager({
    getFrame: () => input.frame,
    view: input.view,
    // 死亡淡出中不能射擊（M1-12）。
    getPlayer: () => (player.enabled && health.alive ? player : null),
    ballistics,
    bus,
    getSettings: simSettings,
    setToggle: (action, on) => input.builder.setToggle(action, on),
    mouse: input.mouse,
    camera: cameraRig,
  });
  weaponsRef = weapons;
  game.addSystem(weapons);
  // 開火的鏡頭震動與 FOV 衝擊、爆炸震動與色差（viewmodel 後座與特效在下方的 Viewmodel／WeaponFx）。
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
  // ── 武器表現（M1-11）──────────────────────────────────
  // Viewmodel：獨立場景與相機（固定 FOV），PostFX 在世界之後清深度再畫（不穿牆、仍有 Bloom）；整個場景加入預熱。
  const viewmodel = new Viewmodel({
    weapons,
    getPlayer: () => (player.enabled ? player : null),
    view: input.view,
    worldCamera: camera,
    bus,
    getStepDt: () => 1 / game.loop.config.hz,
    lights: lighting,
    envSource: scene,
  });
  viewmodel.scene.environment = scene.environment;
  viewmodel.scene.environmentIntensity = scene.environmentIntensity;
  postfx.addViewmodelPass(viewmodel.scene, viewmodel.camera);
  registerWarmup(viewmodel.scene);
  game.addSystem(viewmodel);
  // 特效池：曳光、命中火花、彈孔、電漿球、爆炸與固定的世界點光源（建構時加入世界場景，載入預熱一起編譯）。
  const archetypeOf = (weaponId: string): string | undefined => weapons.slots.find((w) => w?.id === weaponId)?.def.archetype;
  const weaponFx = new WeaponFx({
    scene,
    bus,
    muzzle: viewmodel,
    ballistics,
    getArchetype: archetypeOf,
    getQuality: () => settings.get('quality'),
  });
  registerWarmup(weaponFx.root);
  game.addSystem(weaponFx);
  bus.on('level:unloaded', () => weaponFx.clear());
  // ── HUD（M1-14）──────────────────────────────────────
  // 全畫面層與 7 個錨點區域；依 iframe 短邊縮放（尺寸改變、切換顯示模式時重新計算）。準星與命中標記掛在 hud.root。
  const hud = new Hud({ container: app, config: HUD_CONFIG });
  const applyUiLayout = (width: number, height: number): void => {
    hud.layout(width, height);
    app.style.setProperty('--sw-ui-scale', menuScale(width, height, HUD_CONFIG.layout).toFixed(4));
  };
  applyUiLayout(viewport.width, viewport.height);
  viewport.onResize((size) => applyUiLayout(size.width, size.height));
  // 準星與狙擊鏡遮罩。
  const crosshairInput: CrosshairInput = { visible: false, style: 'cross', spreadDeg: 0, vFovDeg: 70, ads: 0, scope: 0 };
  const crosshair = new Crosshair({
    container: hud.root,
    getHeight: () => viewport.height,
    getInput: () => {
      const w = weapons.active;
      const ci = crosshairInput;
      ci.visible = Boolean(w) && player.enabled && game.mode === 'playing';
      if (!w) return ci;
      ci.style = crosshairStyleFor(w.def.archetype);
      ci.spreadDeg = effectiveSpreadDeg(w.def, weapons.currentSpread());
      ci.vFovDeg = camera.fov;
      ci.ads = viewmodel.state.ads;
      ci.scope = viewmodel.state.scope;
      return ci;
    },
  });
  game.addSystem(crosshair);
  const scopeOverlay = new ScopeOverlay({
    container: app,
    getAmount: () => (player.enabled && game.mode !== 'title' ? viewmodel.state.scope : 0),
  });
  game.addSystem(scopeOverlay);
  // ── 靶標與戰鬥回饋（M1-12）────────────────────────────
  const targetPlayerInfo = {
    feet: player.position,
    center: { x: 0, y: 0, z: 0 },
    eye: { x: 0, y: 0, z: 0 },
    height: 0,
    radius: 0,
  };
  const getTargetPlayer = (): TargetPlayerInfo | null => {
    if (!player.enabled || !health.alive) return null;
    const t = targetPlayerInfo;
    t.height = player.height;
    t.radius = player.config.radius;
    t.center.x = player.position.x;
    t.center.y = player.position.y + player.height / 2;
    t.center.z = player.position.z;
    t.eye.x = player.position.x;
    t.eye.y = player.position.y + player.eyeHeight;
    t.eye.z = player.position.z;
    return t;
  };
  const weaponName = (id: string): string => weapons.slots.find((w) => w?.id === id)?.def.name ?? id;
  const targets = new TargetManager({
    physics,
    bus,
    scene,
    glow: library,
    holoUniforms: library.holoUniforms,
    getPlayer: getTargetPlayer,
    getPlayerTarget: () => health,
    getZoneId: () => currentDataLevel()?.zone?.id ?? null,
    dronesEnabled: () => settings.get('trainingDrones'),
    weaponName,
  });
  if (level.id === TRAINING_GROUND_ID) targets.build();
  bus.on('level:loaded', ({ id }) => {
    if (id === TRAINING_GROUND_ID) targets.build();
    health.reset();
  });
  game.addSystem(targets);
  const hitConfirm = new HitConfirmSystem({ bus, getSelf: () => health });
  game.addSystem(hitConfirm);
  const feedback = FEEDBACK_CONFIG;
  const hitMarker = new HitMarker({
    container: hud.root,
    bus,
    config: feedback.hitMarker,
    isEnabled: () => settings.get('hitMarkers'),
  });
  game.addSystem(hitMarker);
  const damageNumbers = new DamageNumbers({
    container: app,
    bus,
    camera,
    getSize: () => viewport,
    config: feedback.numbers,
    getSelf: () => health,
    isEnabled: () => settings.get('damageNumbers'),
    isMerge: () => settings.get('damageNumberMerge'),
  });
  game.addSystem(damageNumbers);
  const damageOverlay = new DamageOverlay({
    container: app,
    bus,
    health,
    getYaw: () => input.view.viewYaw,
    getPlayerPos: () => (player.enabled ? player.position : null),
    getSize: () => viewport,
    indicator: feedback.indicator,
    screen: feedback.screen,
  });
  game.addSystem(damageOverlay);
  // HUD 元件：只讀狀態（PlayerHealth、player.abilities、WeaponManager），值改變時才寫 DOM。
  hud.add(new VitalsWidget({ getHealth: () => health.state, config: HUD_CONFIG.vitals }));
  hud.add(
    new AbilitiesWidget({
      getAbilities: () => (player.enabled ? player.abilities.state : null),
      getGrappleKey: () => bindings.labelFor('grapple'),
      config: HUD_CONFIG.abilities,
    }),
  );
  hud.add(
    new WeaponWidget({
      getWeapon: () => (weapons.active ? weapons.state : null),
      getFireMode: () => weapons.active?.def.fire.mode ?? null,
      getSlotFilled: (slot) => weapons.slots[slot] != null,
      getReloadKey: () => bindings.labelFor('reload'),
      config: HUD_CONFIG.weapon,
    }),
  );
  hud.add(
    new GrappleHintWidget({
      getAbilities: () => (player.enabled ? player.abilities.state : null),
      getGrappleKey: () => bindings.labelFor('grapple'),
    }),
  );
  const hudTimer = hud.add(new TimerWidget());
  const hudMessages = hud.add(new MessagesWidget(HUD_CONFIG));
  game.addSystem(hud);
  bus.on('level:respawn', () => hudMessages.push(t('hud.msg.checkpoint'), { key: 'respawn' }));
  bus.on('player:revived', () => hudMessages.push(t('hud.msg.revived'), { key: 'respawn' }));
  bus.on('storage:status', ({ persistent }) =>
    hudMessages.push(t(persistent ? 'hud.msg.storageBack' : 'hud.msg.storageLost'), { key: 'storage', tone: persistent ? 'good' : 'warn', duration: 5 }),
  );
  onPlayerRespawn = () => {
    const lvl = currentDataLevel();
    const cp = health.config.respawnAt === 'checkpoint' && lvl ? lvl.nearestCheckpoint(player.position) : null;
    const target = cp && lvl ? lvl.checkpointSpawn(cp) : (levels.current?.getSpawn() ?? spawn);
    if (player.enabled) player.respawn(target);
    ballistics.clear();
    targets.clearBolts();
    damageOverlay.clear();
  };
  bus.on('level:unloaded', () => {
    damageNumbers.clear();
    damageOverlay.clear();
  });
  // 受擊鏡頭：震動、往遠離攻擊方向傾斜、色差（數值在 FEEDBACK_CONFIG.camera）。
  bus.on('player:damaged', (e) => {
    const c = feedback.camera;
    const trauma = hitTrauma(e.amount, e.shieldBroken, c);
    if (trauma > 0) cameraRig.addTrauma(trauma);
    const a = damageIndicatorAngle(input.view.viewYaw, player.position.x, player.position.z, e.sourcePos.x, e.sourcePos.z);
    if (c.rollDeg > 0) cameraRig.addRollImpulse(Math.sin(a) * c.rollDeg);
    if (e.blocked) return;
    if (e.shieldBroken) postfx.pulseAberration(c.shieldBreakAberration, c.shieldBreakAberrationTime);
    else if (e.healthDamage > 0) postfx.pulseAberration(Math.min(1, c.aberration + e.healthDamage * c.aberrationPerDamage), c.aberrationTime);
  });
  // 擊殺特效：無人機爆炸（不留焦痕）、假人頭部火花。
  const up = { x: 0, y: 1, z: 0 };
  bus.on('target:killed', (e) => {
    if (e.kind === 'drone') {
      weaponFx.spawnExplosion(e.point, up, targets.config.drone.explosionRadius, { scorch: false });
      cameraRig.addTraumaAt(e.point, feedback.camera.droneKillTrauma, targets.config.drone.explosionRadius * 6);
    } else {
      weaponFx.spawnImpact(e.point, up, 'metal', { scale: 2.5, decal: false });
    }
  });
  // 敵方能量球的命中特效（橘色能量火花、不留彈孔）。
  bus.on('enemy:projectile', (e) => {
    if (e.phase === 'expire') return;
    weaponFx.spawnImpact(e.position, e.normal, 'energy', {
      color: targets.visuals?.style.boltColor ?? 0xff6a2a,
      decal: false,
      scale: e.phase === 'hitPlayer' ? 0.6 : 1.2,
    });
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
  // 武器表現（M1-11）：viewmodel 擺位與動畫、特效、準星、監看與測試。
  game.addSystem(bindPresentationPanel({ panel, viewmodel, fx: weaponFx, crosshair, camera }));
  // 戰鬥（M1-12）：靶標、無人機、玩家生命與無敵模式、命中回饋、DPS 計、測試按鈕。
  const combatPanel = bindCombatPanel({
    panel,
    bus,
    targets,
    health,
    feedback,
    getDronesEnabled: () => settings.get('trainingDrones'),
    setDronesEnabled: (on) => settings.set('trainingDrones', on),
    getPlayerCenter: () => health.getCenter({ x: 0, y: 0, z: 0 }),
    getYaw: () => input.view.viewYaw,
  });
  game.addSystem(combatPanel);
  // ── 音效（M1-13）──────────────────────────────────────
  // AudioContext 在玩家第一次操作（點擊、按鍵）時才建立；Web Audio 不可用時以靜音進行。各系統只發事件，由 AudioEventBinder 轉成音效。
  const audio = new AudioEngine({ config: AUDIO_CONFIG });
  const applyVolumes = (s: Readonly<Settings>): void =>
    audio.setVolumes({ master: s.masterVolume, sfx: s.sfxVolume, ui: s.uiVolume, music: s.musicVolume });
  applyVolumes(settings.value);
  settings.onChange((s, changed) => {
    if (changed.some((k) => k === 'masterVolume' || k === 'sfxVolume' || k === 'uiVolume' || k === 'musicVolume')) applyVolumes(s);
  });
  audio.attachUnlock(window);
  const audioHealth = { healthFraction: 1, alive: true };
  const audioEvents = new AudioEventBinder({
    bus,
    sink: audio,
    config: AUDIO_CONFIG.events,
    getWeaponDef: (id) => weapons.slots.find((w) => w?.id === id)?.def,
    getPlayer: () => (player.enabled ? player.state : null),
    getHealth: () => {
      audioHealth.healthFraction = health.healthFraction;
      audioHealth.alive = health.alive;
      return audioHealth;
    },
    getMode: () => game.mode,
    getProjectilePosition: (id, out) => {
      let found = false;
      ballistics.projectiles.forEachActive((p) => {
        if (p.id !== id) return;
        out.x = p.position.x;
        out.y = p.position.y;
        out.z = p.position.z;
        found = true;
      });
      return found;
    },
    getReloadKeys: () => viewmodel.config,
    emitters: AUDIO_CONFIG.voices.emitters,
  });
  game.addSystem(audioEvents);
  // 聽者跟隨相機（CameraRig 在 camera 階段已放好位置與朝向）。
  game.addSystem({
    name: 'audioListener',
    order: SystemOrder.audio,
    render() {
      audio.setListener(camera.position, camera.quaternion);
    },
  });
  const weaponAudios = (): { fire: string; params: Record<string, number> }[] => weapons.slots.flatMap((w) => (w ? [w.def.audio] : []));
  game.addSystem(bindAudioPanel({ panel, engine: audio, weaponAudios }));
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
    if (changed.some((k) => (QUALITY_SETTING_KEYS as readonly string[]).includes(k))) applyQuality();
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

  // ── 模式、選單與生命週期（M1-14）──────────────────────
  const lifecycle = new Lifecycle({ bus, onAutoPause: (reason) => game.pause(reason) });
  document.documentElement.dataset.swEmbedded = String(lifecycle.embedded);
  bus.on('lifecycle:visibility', ({ hidden }) => {
    // 回到分頁時重設時脈與 FPS 取樣，避免把離開的時間算進第一個畫面。
    if (!hidden) {
      game.resetClock();
      stats.sampler.reset();
    }
  });

  // 訓練場的重設：重新開始訓練、返回標題後再開始（新的一局）。
  const resetPlayerTo = (target: { pos: THREE.Vector3; yaw: number }): void => {
    if (freeCam.enabled) {
      flyState.enabled = false;
      setFlying(false);
    }
    player.respawn(target);
    ballistics.clear();
    targets.clearBolts();
    damageOverlay.clear();
  };
  const restartTraining = (): void => {
    resetPlayerTo(levels.current?.getSpawn() ?? spawn);
    health.reset();
    targets.resetAll();
    targets.dps.reset();
    for (const w of weapons.slots) w?.reset(weapons.time);
    if (weapons.activeSlot !== 0) weapons.selectSlot(0);
    weaponFx.clear();
    damageNumbers.clear();
    hud.reset();
    tools.trial.reset();
  };
  // ── 調校工具（M1-15）─────────────────────────────────
  const tools = setupTuningTools({
    game,
    bus,
    storage,
    panel,
    input,
    scene,
    container: app,
    player,
    weapons,
    weaponPanel,
    health,
    targets,
    ballistics,
    getLevel: currentDataLevel,
    isActive: () => game.mode === 'playing' && player.enabled,
    getSettings: () => settings.value,
    setSimSettings: (s) => {
      simSettingsOverride = s ? { ...settings.value, ...s } : null;
    },
    resetPlayerTo,
    teleport: teleportActive,
    clearEffects: () => {
      damageNumbers.clear();
      damageOverlay.clear();
    },
    hud,
    timer: hudTimer.state,
    messages: hudMessages,
    keyLabel: (action) => bindings.labelFor(action),
    ...(hasHashFlag(location.hash, 'demo') ? { demoClip } : {}),
    gameVersion: GAME_VERSION,
    makeVector: (x, y, z) => new THREE.Vector3(x, y, z),
  });
  /** 回到最近的檢查點（卡住時用）。 */
  const resetPosition = (): void => {
    const lvl = currentDataLevel();
    const cp = lvl ? lvl.nearestCheckpoint(player.position) : null;
    resetPlayerTo(cp && lvl ? lvl.checkpointSpawn(cp) : (levels.current?.getSpawn() ?? spawn));
  };
  // 選單按鈕：開始與繼續都在點擊事件中同步請求滑鼠鎖定（瀏覽器要求使用者手勢）。
  const menuActions: MenuActions = {
    start: () => void lockFlow.click(),
    resume: () => void lockFlow.click(),
    resetPosition: () => {
      resetPosition();
      hudMessages.push(t('hud.msg.positionReset'), { key: 'reset' });
      void lockFlow.click();
    },
    restartTraining: () => {
      restartTraining();
      hudMessages.push(t('hud.msg.trainingRestarted'), { key: 'reset', tone: 'good' });
      void lockFlow.click();
    },
    toTitle: () => {
      game.setMode('title');
    },
    startTimeTrial: () => {
      tools.restartCourse();
      void lockFlow.click();
    },
  };
  const fullscreen = new FullscreenControl({ embedded: lifecycle.embedded });
  const statusState: MenuStatusState = {
    mode: 'boot',
    needsRelock: false,
    lockError: null,
    lockCooldown: false,
    useLock: lockFlow.useLock,
    storagePersistent: true,
  };
  const menu = new Menu({
    container: app,
    playSound: (id) => void audio.play(id),
    getStatus: () => {
      const s = statusState;
      s.mode = game.mode;
      s.pauseReason = game.pauseReason;
      s.needsRelock = lockFlow.needsRelock && !panel.isOpen;
      s.lockError = lockFlow.error;
      s.lockCooldown = pointerLock.inCooldown;
      s.storagePersistent = storage.isPersistent;
      s.audioUnavailable = audio.status === 'unavailable';
      return menuStatus(s);
    },
  });
  menu.register(new TitleScreen({ actions: menuActions, fullscreen, version: GAME_VERSION }));
  menu.register(new PauseScreen({ actions: menuActions, fullscreen, version: GAME_VERSION }));
  const settingsScreen = menu.register(new SettingsScreen({ settings, isPersistent: () => storage.isPersistent })) as SettingsScreen;
  const controlsScreen = menu.register(new ControlsScreen({ bindings })) as ControlsScreen;
  menu.register(new HelpScreen(bindings));
  game.addSystem(menu);
  menuBack = () => menu.back();
  let firstStart = true;
  const syncMode = (mode: GameMode): void => {
    document.documentElement.dataset.swMode = mode;
    menu.nav.syncMode(mode);
    hud.setHidden('mode', mode === 'title' || mode === 'boot');
  };
  bus.on('game:mode', ({ from, to }) => {
    lockFlow.modeChanged(to);
    syncMode(to);
    // 返回標題：下一次開始是新的一局。
    if (to === 'title' && (from === 'playing' || from === 'paused')) restartTraining();
    if (to === 'playing' && from === 'title' && firstStart && HUD_CONFIG.messages.pauseHintDuration > 0) {
      firstStart = false;
      hudMessages.push(t('hud.msg.pauseHint', { key: bindings.labelFor('pause') }), { key: 'pauseHint', duration: HUD_CONFIG.messages.pauseHintDuration });
    }
  });
  // 調參面板「介面」：HUD 版面與元件數值（不存檔）。
  const relayout = (): void => applyUiLayout(viewport.width, viewport.height);
  panel.bindConfig('介面/HUD 版面', HUD_CONFIG.layout, HUD_LAYOUT_PANEL, { onChange: relayout });
  panel.bindConfig('介面/生命條', HUD_CONFIG.vitals, HUD_VITALS_PANEL);
  panel.bindConfig('介面/能力', HUD_CONFIG.abilities, HUD_ABILITY_PANEL, { onChange: relayout });
  panel.bindConfig('介面/武器', HUD_CONFIG.weapon, HUD_WEAPON_PANEL);
  panel.bindConfig('介面/提示訊息', HUD_CONFIG.messages, HUD_MESSAGE_PANEL);
  panel.bindConfig('介面/提示訊息', HUD_CONFIG, { grappleHintDistance: { label: '可勾取顯示距離' } });

  // 遊玩中未鎖定（開過調參面板）時點擊畫面重新鎖定；選單與調參面板內的點擊不處理（選單按鈕自己處理開始／繼續）。
  app.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || game.mode !== 'playing') return;
    if ((e.target as Element | null)?.closest('.sw-debug, .sw-menu')) return;
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
        ...{ viewmodel, weaponFx, crosshair, scopeOverlay },
        ...{ health, targets, hitConfirm, hitMarker, damageNumbers, damageOverlay, combatPanel, feedback },
        ...{ audio, audioEvents, audioTools: { renderStress, buildStressScenario } },
        ...{ hud, hudTimer, hudMessages, menu, menuActions, settingsScreen, controlsScreen, fullscreen },
        ...{ tools },
      };
      (globalThis as Record<string, unknown>).__shardwake = handles;
    }
  };
  window.addEventListener('hashchange', exposeDebug);
  exposeDebug();

  // 著色器預熱（M1-09）：相機先放到出生點眼睛位置，編譯場景與預熱清單、上傳貼圖、畫一個畫面，完成後才顯示標題。
  camera.position.set(spawn.pos.x, spawn.pos.y + 1.6, spawn.pos.z);
  camera.rotation.set(0, spawn.yaw, 0, 'YXZ');
  // 音效預渲染（M1-13）：純 JS 合成，分段讓出主執行緒；解鎖時再轉成 AudioBuffer。
  await audio.prerender(weaponAudios());
  await warmup('載入');

  game.setMode('title');
  syncMode(game.mode);
  renderer.setAnimationLoop((now: number) => {
    stats.beginFrame();
    panel.beginFrame();
    game.frame(now);
  });

  document.documentElement.dataset.swBoot = 'ready';

  // #demo：載入後直接進入遊玩，用標準參數重播內建錄影（不需要滑鼠鎖定；自動化驗證與截圖用）。
  if (tools.demo) {
    document.documentElement.dataset.swDemo = 'pending';
    window.setTimeout(() => {
      if (game.mode === 'title') game.start();
      if (!tools.startDemo()) console.warn('[shardwake] 示範無法開始');
    }, tools.demo.config.startDelay * 1000);
  }
}

boot().catch((err: unknown) => {
  document.documentElement.dataset.swBoot = 'error';
  console.error('[shardwake] 啟動失敗', err);
});
