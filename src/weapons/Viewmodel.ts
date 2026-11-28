// Viewmodel（M1-11）：第一人稱槍模的場景、相機、動畫與槍口閃光。
//
// 渲染：獨立的 viewmodel 場景（scene）與相機（camera，固定 FOV），由 PostFX.addViewmodelPass() 在世界之後、
// 清除深度再畫一次，所以槍不會穿牆、改世界 FOV（含開鏡縮放）不影響槍模大小，而且仍然經過 Bloom／色調映射／SMAA。
// 場景有自己的燈光：半球光 + 方向光（顏色、強度與方向每畫面取自世界燈光，方向換到相機空間），以及槍口的固定點光源（只調亮度）。
// 燈光數量固定，所有槍模在場景內（未使用的隱藏），整個場景加入 registerWarmup()，第一次切槍、開火都不會編譯著色器。
//
// 動畫（全部在 render 以 frame.dt 推進，用解析解彈簧或以距離／進度為參數的曲線，與畫面更新率無關）：
//   擺動（視角速度的反向延遲，有上限）、移動晃動（8 字形，隨速度）、呼吸、衝刺姿勢、滑鏟傾斜、跑牆往牆外偏、空中微抬、
//   落地彈跳、開鏡對位（瞄具對到畫面中心）、後座踢動（每把槍的 viewKick／kickSpring）、換彈關鍵影格（依換彈時間縮放；
//   霰彈逐發）、泵動、切槍下放／舉起、近戰前刺、攀爬放低、開火後發光條暗下再恢復。
// 武器狀態（換彈、切槍、近戰的時間戳）以「渲染時間」= weapons.time −（1 − alpha）× 固定步長 取樣，與模擬步切分無關。
// 狙擊鏡：瞄具為 scope 時，開鏡進度超過 scopeThreshold 隱藏槍模（瞄準鏡遮罩在 ui/ScopeOverlay）；世界 FOV 縮放由 M1-10 的 CameraRig.fovZoom 處理。
import * as THREE from 'three';
import { springImpulseForPeak } from '@/camera/cameraMath';
import type { EventBus } from '@/core/EventBus';
import type { GameEvents } from '@/core/events';
import { SystemOrder, type FrameInfo, type GameSystem } from '@/core/Game';
import { DEG2RAD, RAD2DEG, SpringScalar, SpringVec3, angleDelta, clamp01, damp, lerp } from '@/core/math';
import { Rng } from '@/core/Rng';
import { fxStyleFor, type WeaponFxStyle } from '@/fx/FxConfig';
import { getFlashTexture } from '@/fx/fxTextures';
import type { Vec3Like } from '@/physics/Physics';
import { VIEWMODEL_CONFIG, type Vec3Tuple, type ViewmodelConfig } from '@/weapons/ViewmodelConfig';
import {
  addPose,
  adsPosition,
  bobPhaseDelta,
  createReloadPose,
  figureEight,
  glowAfterShot,
  meleePose,
  pumpTravel,
  ramp,
  reloadPose,
  shellPose,
  swapLowered,
  swayTarget,
  zeroPose,
  type ReloadPose,
  type VmPose,
} from '@/weapons/viewmodelMath';
import type { Weapon } from '@/weapons/Weapon';
import { shotInterval, type WeaponDef, type WeaponModelDef } from '@/weapons/WeaponDef';
import type { WeaponManager } from '@/weapons/WeaponManager';
import { WeaponModelFactory, weaponModelKey, type WeaponModel } from '@/weapons/WeaponModelFactory';
import { adsEase } from '@/weapons/weaponMath';

/** viewmodel 需要的玩家介面（PlayerController 符合）。 */
export interface ViewmodelPlayer {
  readonly state: {
    readonly state: string;
    readonly grounded: boolean;
    readonly speed: number;
    readonly wallNormal: Readonly<Vec3Like>;
  };
  isSprinting(): boolean;
}

/** 世界燈光（SceneLighting 符合）：viewmodel 場景的燈光顏色、強度與方向跟著它。 */
export interface ViewmodelLightSource {
  readonly hemi: THREE.HemisphereLight;
  readonly sun: THREE.DirectionalLight;
}

export interface ViewmodelOptions {
  weapons: WeaponManager;
  /** 目前操控的玩家；null（除錯飛行）時隱藏槍模。 */
  getPlayer: () => ViewmodelPlayer | null;
  /** 玩家視角（弧度；不含後座偏移）：擺動用。 */
  view: { readonly yaw: number; readonly pitch: number };
  /** 世界相機（槍口位置換算到世界：曳光起點）。 */
  worldCamera: THREE.PerspectiveCamera;
  bus?: EventBus<GameEvents> | undefined;
  /** 固定步長（s）：把武器的模擬時間換成渲染時間。預設 1/120。 */
  getStepDt?: () => number;
  lights?: ViewmodelLightSource | null;
  /** 世界場景：環境反射（environment、environmentIntensity）每畫面跟著它。 */
  envSource?: THREE.Scene | null;
  config?: ViewmodelConfig;
  factory?: WeaponModelFactory;
  /** 每種武器原型的特效風格（槍口閃光的顏色、大小、時間）。 */
  getFxStyle?: (archetype: string) => WeaponFxStyle;
  rng?: Rng;
}

/** 監看與測試用的狀態（每畫面更新）。 */
export interface ViewmodelState {
  visible: boolean;
  weaponId: string;
  frame: string;
  ads: number;
  /** 狙擊鏡遮罩 0..1（1 = 完全顯示，槍模隱藏）。 */
  scope: number;
  swayYaw: number;
  swayPitch: number;
  bobWeight: number;
  bobPhase: number;
  sprint: number;
  slide: number;
  wall: number;
  air: number;
  mantle: number;
  land: number;
  reload: number;
  lowered: number;
  melee: number;
  pump: number;
  kickZ: number;
  kickPitch: number;
  flash: number;
  /** 建立過的槍模數。 */
  models: number;
}

interface KickEvent {
  time: number;
  frequency: number;
  dampingRatio: number;
  pos: THREE.Vector3;
  rot: THREE.Vector3;
}

interface CachedModel {
  model: WeaponModel;
  weapon: Weapon;
}

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _ads = { x: 0, y: 0, z: 0 };

export class Viewmodel implements GameSystem {
  readonly name = 'viewmodel';
  readonly order = SystemOrder.fx;
  readonly config: ViewmodelConfig;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  /** 動畫節點（槍模、槍口閃光、點光源都在它底下）。 */
  readonly gun = new THREE.Group();
  readonly factory: WeaponModelFactory;
  readonly hemi = new THREE.HemisphereLight(0xffffff, 0x222222, 1);
  readonly sun = new THREE.DirectionalLight(0xffffff, 1);
  /** 槍口的固定點光源（只調亮度）。 */
  readonly flashLight = new THREE.PointLight(0xffb070, 0, 1.5, 2);
  readonly flash: THREE.Sprite;
  readonly state: ViewmodelState = {
    visible: false,
    weaponId: '',
    frame: '',
    ads: 0,
    scope: 0,
    swayYaw: 0,
    swayPitch: 0,
    bobWeight: 0,
    bobPhase: 0,
    sprint: 0,
    slide: 0,
    wall: 0,
    air: 0,
    mantle: 0,
    land: 0,
    reload: 0,
    lowered: 0,
    melee: 0,
    pump: 0,
    kickZ: 0,
    kickPitch: 0,
    flash: 0,
    models: 0,
  };
  /** 這一畫面的最終姿勢（相機空間；測試比對用）。 */
  readonly pose: VmPose = zeroPose();
  /** 是否顯示（main 依模式設定；除錯飛行時另外隱藏）。 */
  enabled = true;
  private readonly options: ViewmodelOptions;
  private readonly rng: Rng;
  private readonly models = new Map<Weapon, CachedModel>();
  private current: CachedModel | null = null;
  private keyTimer = 0;
  // 彈簧與權重
  private readonly swayYaw: SpringScalar;
  private readonly swayPitch: SpringScalar;
  private readonly kickPos = new SpringVec3({ frequency: 10, dampingRatio: 0.6 });
  private readonly kickRot = new SpringVec3({ frequency: 10, dampingRatio: 0.6 });
  private readonly land: SpringScalar;
  private readonly sprintW: SpringScalar;
  private readonly slideW: SpringScalar;
  private readonly airW: SpringScalar;
  private readonly mantleW: SpringScalar;
  private readonly wallX: SpringScalar;
  private bobWeight = 0;
  private bobPhase = 0;
  private idleTime = 0;
  /** 最近一次換彈的時間戳（weapon:reloadStart／reloadEnd）。 */
  private readonly reloadTrack = {
    started: false,
    weaponId: '',
    shell: false,
    empty: false,
    start: 0,
    end: 0,
    endTime: Number.POSITIVE_INFINITY,
  };
  /** 最近一次近戰的時間（WeaponManager.melee 進行中時複製）。 */
  private readonly meleeTrack = { start: 0, end: 0 };
  private readonly reloadOut: ReloadPose = createReloadPose();
  private readonly shellOut: VmPose = zeroPose();
  private readonly tmpPose: VmPose = zeroPose();
  private flashStart = Number.NEGATIVE_INFINITY;
  private flashTime = 0.05;
  /** 排程中的後座衝量（開火的模擬時間戳；固定容量）。 */
  private readonly kicks: KickEvent[] = Array.from({ length: 16 }, () => ({
    time: 0,
    frequency: 10,
    dampingRatio: 0.6,
    pos: new THREE.Vector3(),
    rot: new THREE.Vector3(),
  }));
  private kickCount = 0;
  private flashBase = new THREE.Color();
  private hasPrevView = false;
  private prevYaw = 0;
  private prevPitch = 0;
  private lastFov = 0;
  private readonly unsubs: (() => void)[] = [];

  constructor(options: ViewmodelOptions) {
    this.options = options;
    this.config = options.config ?? VIEWMODEL_CONFIG;
    this.factory = options.factory ?? new WeaponModelFactory();
    this.rng = options.rng ?? new Rng('shardwake:viewmodel');
    const cfg = this.config;
    this.scene.name = 'viewmodel';
    this.camera = new THREE.PerspectiveCamera(cfg.fov, options.worldCamera.aspect || 1, 0.01, 10);
    this.camera.name = 'viewmodel:camera';
    this.gun.name = 'vm:gun';
    this.scene.add(this.gun, this.hemi, this.sun, this.sun.target);
    this.hemi.name = 'vm:hemi';
    this.sun.name = 'vm:sun';
    this.flashLight.name = 'vm:flashLight';
    this.gun.add(this.flashLight);
    const flashMat = new THREE.SpriteMaterial({
      map: getFlashTexture(),
      color: 0xffffff,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
    });
    flashMat.name = 'vm:flash';
    this.flash = new THREE.Sprite(flashMat);
    this.flash.name = 'vm:flash';
    this.flash.visible = false;
    this.flash.frustumCulled = false;
    this.flash.renderOrder = 10;
    this.gun.add(this.flash);

    this.swayYaw = new SpringScalar({ frequency: cfg.swayFrequency, dampingRatio: cfg.swayDamping });
    this.swayPitch = new SpringScalar({ frequency: cfg.swayFrequency, dampingRatio: cfg.swayDamping });
    this.land = new SpringScalar({ frequency: cfg.landFrequency, dampingRatio: cfg.landDamping });
    this.sprintW = new SpringScalar({ frequency: cfg.poseFrequency });
    this.slideW = new SpringScalar({ frequency: cfg.poseFrequency });
    this.airW = new SpringScalar({ frequency: cfg.poseFrequency });
    this.mantleW = new SpringScalar({ frequency: cfg.poseFrequency });
    this.wallX = new SpringScalar({ frequency: cfg.poseFrequency });

    // 預先建立所有欄位的槍模（隱藏），讓預熱一次編譯完。
    this.syncModels();

    const bus = options.bus;
    if (bus) {
      this.unsubs.push(
        bus.on('weapon:fire', (e) => this.onFire(e.weaponId, e.ads, e.time)),
        bus.on('player:land', ({ impactSpeed }) => this.onLand(impactSpeed)),
        bus.on('weapon:reloadStart', (e) => {
          const rt = this.reloadTrack;
          rt.started = true;
          rt.weaponId = e.weaponId;
          rt.shell = e.kind === 'shell';
          rt.empty = e.kind === 'empty';
          rt.start = e.time;
          rt.end = e.time + e.duration;
          rt.endTime = Number.POSITIVE_INFINITY;
        }),
        bus.on('weapon:reloadEnd', (e) => {
          if (e.weaponId === this.reloadTrack.weaponId) this.reloadTrack.endTime = e.time;
        }),
        bus.on('player:respawn', () => this.snap()),
      );
    }
  }

  /** 目前顯示的槍模（沒有時為 null）。 */
  get model(): WeaponModel | null {
    return this.current?.model ?? null;
  }

  /** 為每個欄位的武器建立（或在描述改變時重建）槍模。 */
  syncModels(): void {
    const weapons = this.options.weapons;
    const alive = new Set<Weapon>();
    for (const w of weapons.slots) {
      if (!w) continue;
      alive.add(w);
      this.ensureModel(w);
    }
    for (const [w, c] of this.models) {
      if (alive.has(w)) continue;
      c.model.dispose();
      this.models.delete(w);
      if (this.current === c) this.current = null;
    }
    this.state.models = this.factory.created;
  }

  private ensureModel(w: Weapon): CachedModel {
    const key = weaponModelKey(w.def.model);
    let c = this.models.get(w);
    if (c && c.model.key === key) return c;
    if (c) {
      c.model.dispose();
      if (this.current === c) this.current = null;
    }
    const model = this.factory.create(w.def.model);
    model.root.visible = false;
    this.gun.add(model.root);
    c = { model, weapon: w };
    this.models.set(w, c);
    this.state.models = this.factory.created;
    return c;
  }

  /**
   * 開火：後座踢動與槍口閃光都以事件的模擬時間戳排程（advance 時在該時間點加入衝量、閃光從該時間點起算），
   * 所以不論畫面更新率，踢動曲線都一樣（不會延遲到下一個畫面才開始）。
   */
  private onFire(weaponId: string, ads: number, time: number): void {
    const w = this.options.weapons.active;
    if (!w || w.id !== weaponId) return;
    const def = w.def;
    const cfg = this.config;
    const k = def.feel.kickSpring;
    const mult = lerp(1, cfg.kickAdsMult, adsEase(ads, cfg.adsEase));
    const side = cfg.kickRandomSide ? this.rng.sign() : 1;
    const side2 = cfg.kickRandomSide ? this.rng.sign() : 1;
    const imp = (peak: number): number => springImpulseForPeak(peak * mult, k.frequency, k.dampingRatio);
    const [px, py, pz] = def.feel.viewKick.pos;
    const [rp, ry, rr] = def.feel.viewKick.rot;
    if (this.kickCount < this.kicks.length) {
      const q = this.kicks[this.kickCount++]!;
      q.time = time;
      q.frequency = k.frequency;
      q.dampingRatio = k.dampingRatio;
      q.pos.set(imp(px * side), imp(py), imp(pz));
      q.rot.set(imp(rp), imp(ry * side), imp(rr * side2));
    }
    // 槍口閃光。
    const style = this.fxStyle(def);
    this.flashStart = time;
    this.flashTime = style.flashTime;
    this.flashBase.set(style.flashColor);
    this.flash.material.rotation = this.rng.range(0, Math.PI * 2);
    const s = style.flashSize * this.rng.range(0.8, 1.2);
    this.flash.scale.set(s, s, s);
    this.flashLight.color.set(style.flashColor);
  }

  /** 推進後座彈簧到渲染時間 t，途中在各次開火的時間點加入衝量。 */
  private advanceKicks(t: number, dt: number): void {
    let cursor = t - Math.max(0, dt);
    let keep = 0;
    for (let i = 0; i < this.kickCount; i++) {
      const q = this.kicks[i]!;
      if (q.time > t) {
        // 還沒到（這一步在渲染時間之後開火）：留到下一個畫面。
        if (keep !== i) {
          const tmp = this.kicks[keep]!;
          this.kicks[keep] = q;
          this.kicks[i] = tmp;
        }
        keep++;
        continue;
      }
      const sub = q.time - cursor;
      if (sub > 0) {
        this.kickPos.update(sub);
        this.kickRot.update(sub);
        cursor = q.time;
      }
      this.kickPos.frequency = this.kickRot.frequency = q.frequency;
      this.kickPos.dampingRatio = this.kickRot.dampingRatio = q.dampingRatio;
      this.kickPos.addImpulse(q.pos);
      this.kickRot.addImpulse(q.rot);
    }
    this.kickCount = keep;
    const rest = t - cursor;
    if (rest > 0) {
      this.kickPos.update(rest);
      this.kickRot.update(rest);
    }
  }

  private onLand(impactSpeed: number): void {
    const cfg = this.config;
    const dip = Math.min(cfg.landMax, Math.max(0, impactSpeed) * cfg.landPerSpeed);
    if (dip <= 0) return;
    this.land.frequency = cfg.landFrequency;
    this.land.dampingRatio = cfg.landDamping;
    this.land.addImpulse(springImpulseForPeak(-dip, cfg.landFrequency, cfg.landDamping));
  }

  /** 所有彈簧直接到位（重生、傳送）。 */
  snap(): void {
    for (const s of [this.swayYaw, this.swayPitch, this.land, this.sprintW, this.slideW, this.airW, this.mantleW, this.wallX]) s.snap(0);
    this.kickPos.snap(_v.set(0, 0, 0));
    this.kickRot.snap(_v.set(0, 0, 0));
    this.kickCount = 0;
    this.hasPrevView = false;
  }

  private fxStyle(def: Readonly<WeaponDef>): WeaponFxStyle {
    return (this.options.getFxStyle ?? fxStyleFor)(def.archetype);
  }

  private hipFor(frame: string): Vec3Tuple {
    const c = this.config;
    switch (frame) {
      case 'shotgun':
        return c.hipShotgun;
      case 'pistol':
        return c.hipPistol;
      case 'sniper':
        return c.hipSniper;
      case 'launcher':
        return c.hipLauncher;
      default:
        return c.hipRifle;
    }
  }

  private eyeRelief(model: Readonly<WeaponModelDef>): number {
    const c = this.config;
    return model.optic === 'scope' ? c.eyeReliefScope : model.optic === 'reflex' ? c.eyeReliefReflex : c.eyeReliefIron;
  }

  render(alpha: number, frame: Readonly<FrameInfo>): void {
    this.advance(frame.dt, alpha);
  }

  /** 推進動畫 dt 秒（暫停時 dt = 0：凍結），alpha 為固定步的插值係數。無頭測試直接呼叫。 */
  /** 姿勢權重彈簧（共用頻率）。 */
  private poseSpring(s: SpringScalar, target: number, dt: number): void {
    s.frequency = this.config.poseFrequency;
    s.target = target;
    if (dt > 0) s.update(dt);
  }

  advance(dt: number, alpha: number): void {
    const cfg = this.config;
    const weapons = this.options.weapons;
    const st = this.state;
    const stepDt = this.options.getStepDt?.() ?? 1 / 120;
    const t = Math.max(0, weapons.time - (1 - clamp01(alpha)) * stepDt);

    // 槍模：欄位改變或描述改變時重建（描述每 0.25 s 檢查一次，避免每畫面序列化）。
    this.keyTimer -= dt > 0 ? dt : 0;
    if (this.keyTimer <= 0) {
      this.keyTimer = 0.25;
      this.syncModels();
    }
    const w = weapons.active;
    const next = w ? (this.models.get(w) ?? this.ensureModel(w)) : null;
    if (next !== this.current) {
      if (this.current) this.current.model.root.visible = false;
      this.current = next;
      if (next) next.model.root.visible = true;
    }
    const player = this.options.getPlayer();
    const cur = this.current;
    if (!cur || !w || !player || !this.enabled) {
      this.gun.visible = false;
      st.visible = false;
      this.hasPrevView = false;
      return;
    }
    const def = w.def;
    const model = cur.model;
    st.weaponId = def.id;
    st.frame = def.model.frame;

    // 開鏡。
    const ads = adsEase(weapons.renderAds, cfg.adsEase);
    st.ads = ads;
    const fov = lerp(cfg.fov, cfg.adsFov, ads);
    const aspect = this.options.worldCamera.aspect || 1;
    if (fov !== this.lastFov || aspect !== this.camera.aspect) {
      this.lastFov = fov;
      this.camera.fov = fov;
      this.camera.aspect = aspect;
      this.camera.updateProjectionMatrix();
    }
    const motion = lerp(1, cfg.adsMotionMult, ads);
    const pose = zeroPose(this.pose);

    // 擺動：視角速度（度/秒）→ 反向延遲的目標，彈簧平滑。
    const view = this.options.view;
    if (dt > 0) {
      if (this.hasPrevView) {
        const yawRight = (-angleDelta(this.prevYaw, view.yaw) * RAD2DEG) / dt;
        const pitchUp = ((view.pitch - this.prevPitch) * RAD2DEG) / dt;
        this.swayYaw.target = swayTarget(yawRight, cfg.swayPerDegPerSec, cfg.swayMaxDeg);
        this.swayPitch.target = swayTarget(pitchUp, cfg.swayPerDegPerSec, cfg.swayMaxDeg);
      }
      this.prevYaw = view.yaw;
      this.prevPitch = view.pitch;
      this.hasPrevView = true;
      // 不在熱迴圈建立陣列（M1-16）。
      this.swayYaw.frequency = this.swayPitch.frequency = cfg.swayFrequency;
      this.swayYaw.dampingRatio = this.swayPitch.dampingRatio = cfg.swayDamping;
      this.swayYaw.update(dt);
      this.swayPitch.update(dt);
    }
    const sy = this.swayYaw.value;
    const sp = this.swayPitch.value;
    st.swayYaw = sy;
    st.swayPitch = sp;
    pose.ry += sy * motion;
    pose.rx += sp * motion;
    pose.px += sy * cfg.swayPosPerDeg * motion;
    pose.py += sp * cfg.swayPosPerDeg * motion;
    pose.rz += sy * cfg.swayRollPerDeg * motion;

    // 移動晃動（8 字形）與呼吸。
    const ps = player.state;
    const sprinting = player.isSprinting();
    const onGround = ps.grounded && ps.state === 'ground';
    const bobTarget = onGround ? Math.min(cfg.bobMaxScale, ps.speed / Math.max(0.1, cfg.bobReferenceSpeed)) * (sprinting ? cfg.sprintBobMult : 1) : 0;
    this.bobWeight = damp(this.bobWeight, bobTarget, cfg.bobBlend, dt);
    if (onGround) this.bobPhase += bobPhaseDelta(ps.speed, dt, cfg.bobStride * (sprinting ? cfg.sprintBobStrideMult : 1));
    st.bobWeight = this.bobWeight;
    st.bobPhase = this.bobPhase;
    addPose(pose, figureEight(this.bobPhase, cfg.bobX, cfg.bobY, cfg.bobRollDeg, this.tmpPose), this.bobWeight * motion);
    this.idleTime += dt;
    pose.py += cfg.idleAmplitude * Math.sin(this.idleTime * cfg.idleFrequency * Math.PI * 2) * motion;

    // 姿勢權重（彈簧）。
    const yaw = view.yaw;
    const wallSide = ps.state === 'wallRun' ? ps.wallNormal.x * Math.cos(yaw) - ps.wallNormal.z * Math.sin(yaw) : 0;
    this.poseSpring(this.sprintW, sprinting && ads < 0.5 ? 1 : 0, dt);
    this.poseSpring(this.slideW, ps.state === 'slide' ? 1 : 0, dt);
    this.poseSpring(this.airW, !ps.grounded && ps.state === 'air' ? 1 : 0, dt);
    this.poseSpring(this.mantleW, ps.state === 'mantle' ? 1 : 0, dt);
    this.poseSpring(this.wallX, wallSide, dt);
    const sprintW = this.sprintW.value * motion;
    pose.px += cfg.sprintPos[0] * sprintW;
    pose.py += cfg.sprintPos[1] * sprintW;
    pose.pz += cfg.sprintPos[2] * sprintW;
    pose.rx += cfg.sprintRot[0] * sprintW;
    pose.ry += cfg.sprintRot[1] * sprintW;
    pose.rz += cfg.sprintRot[2] * sprintW;
    const slideW = this.slideW.value * motion;
    pose.rz += cfg.slideRollDeg * slideW;
    pose.px += cfg.slidePos[0] * slideW;
    pose.py += cfg.slidePos[1] * slideW;
    pose.pz += cfg.slidePos[2] * slideW;
    const wall = this.wallX.value * motion;
    pose.px += wall * cfg.wallOffset;
    pose.rz -= wall * cfg.wallRollDeg;
    const air = this.airW.value * motion;
    pose.py += cfg.airLift * air;
    pose.rx += cfg.airPitchDeg * air;
    const mantle = this.mantleW.value;
    pose.py -= cfg.mantleDrop * mantle;
    pose.rx += cfg.mantlePitchDeg * mantle;
    st.sprint = this.sprintW.value;
    st.slide = this.slideW.value;
    st.wall = this.wallX.value;
    st.air = this.airW.value;
    st.mantle = mantle;

    // 落地彈跳。
    if (dt > 0) this.land.update(dt);
    st.land = this.land.value;
    pose.py += this.land.value * motion;
    pose.rx += this.land.value * 60 * motion;

    // 後座踢動（在開火的時間點加入衝量）。
    if (dt > 0) this.advanceKicks(t, dt);
    const kp = this.kickPos.value;
    const kr = this.kickRot.value;
    pose.px += kp.x;
    pose.py += kp.y;
    pose.pz += kp.z;
    pose.rx += kr.x;
    pose.ry += kr.y;
    pose.rz += kr.z;
    st.kickZ = kp.z;
    st.kickPitch = kr.x;

    // 換彈（以事件的模擬時間戳取樣，與畫面更新率無關）：進行中依進度取關鍵影格；結束或被打斷後，
    // 從結束那一刻的姿勢以 exp(−reloadBlendOut × 經過時間) 淡出。
    let magY = 0;
    let magVisible = true;
    const rt = this.reloadTrack;
    st.reload = 0;
    if (rt.started && t >= rt.start) {
      const shellRate = cfg.poseFrequency * 3;
      const until = Math.min(t, rt.endTime);
      const fade = t > rt.endTime ? Math.exp(-cfg.reloadBlendOut * (t - rt.endTime)) : 1;
      if (rt.shell) {
        const inside = (1 - Math.exp(-shellRate * (until - rt.start))) * fade;
        const r = w.reload;
        const live = t < rt.endTime && w.reloading && w.id === rt.weaponId && r.kind === 'shell';
        const len = r.cycleEnd - r.cycleStart;
        const cycle = live && len > 0 && t >= r.cycleStart ? (t - r.cycleStart) / len : 0;
        addPose(pose, shellPose(inside, cycle, cfg, this.shellOut));
        st.reload = inside;
      } else {
        const len = rt.end - rt.start;
        const p = len > 0 ? clamp01((until - rt.start) / len) : 1;
        reloadPose(p, rt.empty, cfg, this.reloadOut);
        addPose(pose, this.reloadOut.pose, fade);
        if (t < rt.endTime && w.id === rt.weaponId) {
          magY = this.reloadOut.magY;
          magVisible = this.reloadOut.magVisible;
        }
        st.reload = t < rt.endTime ? p : 0;
      }
    }
    if (model.magazine) {
      model.magazine.position.set(0, magY, 0);
      model.magazine.visible = magVisible;
    }

    // 泵動、發光條。
    const sinceShot = t - w.lastShotTime;
    const interval = shotInterval(def);
    const pump = def.fire.mode === 'pump' ? pumpTravel(sinceShot, interval, cfg) : 0;
    st.pump = pump;
    if (model.pump) model.pump.position.z = pump * cfg.pumpTravel;
    if (pump > 0) {
      pose.pz += pump * 0.012;
      pose.rx -= pump * 1.5;
    }
    model.setGlowLevel(glowAfterShot(sinceShot, Math.min(interval, 0.6), cfg.glowFireDip));

    // 切槍、近戰。
    const lowered = swapLowered(weapons.swap, t);
    st.lowered = lowered;
    pose.py -= cfg.swapDrop * lowered;
    pose.rx += cfg.swapPitchDeg * lowered;
    pose.rz += cfg.swapRollDeg * lowered;
    const m = weapons.melee;
    const mt = this.meleeTrack;
    if (m.active) {
      mt.start = m.start;
      mt.end = m.end;
    }
    if (mt.end > mt.start && t >= mt.start && t <= mt.end) {
      const mp = (t - mt.start) / (mt.end - mt.start);
      addPose(pose, meleePose(mp, cfg, this.tmpPose));
      st.melee = mp;
    } else st.melee = 0;

    // 組合：腰射 ↔ 開鏡的基準位置 + 姿勢。
    const hip = this.hipFor(def.model.frame);
    adsPosition(model.sight, this.eyeRelief(def.model), def.model.adsOffset, _ads);
    const g = this.gun;
    g.position.set(lerp(hip[0], _ads.x, ads) + pose.px, lerp(hip[1], _ads.y, ads) + pose.py, lerp(hip[2], _ads.z, ads) + pose.pz);
    g.rotation.set(pose.rx * DEG2RAD, -pose.ry * DEG2RAD, pose.rz * DEG2RAD, 'YXZ');

    // 狙擊鏡：開鏡完成時隱藏槍模。
    const scope = def.model.optic === 'scope' ? ramp(weapons.renderAds, cfg.scopeThreshold - cfg.scopeFade, cfg.scopeThreshold) : 0;
    st.scope = scope;
    g.visible = scope < 1;
    st.visible = g.visible;

    // 槍口閃光與點光源。
    const flashAge = t - this.flashStart;
    const fl = flashAge >= 0 && flashAge < this.flashTime ? 1 - flashAge / this.flashTime : 0;
    st.flash = fl;
    this.flash.visible = fl > 0;
    if (fl > 0) {
      const style = this.fxStyle(def);
      this.flash.material.color.copy(this.flashBase).multiplyScalar(style.flashIntensity * fl);
      this.flash.position.copy(model.muzzle).z -= style.flashSize * 0.3;
    }
    this.flashLight.position.copy(model.muzzle);
    this.flashLight.intensity = cfg.flashLightIntensity * fl;
    this.flashLight.distance = cfg.flashLightDistance;

    this.syncLights();
    g.updateMatrixWorld(true);
  }

  /** viewmodel 燈光跟著世界燈光：顏色與強度相同（乘倍率），方向換到相機空間。 */
  private syncLights(): void {
    const env = this.options.envSource;
    if (env) {
      this.scene.environment = env.environment;
      this.scene.environmentIntensity = env.environmentIntensity;
    }
    const src = this.options.lights;
    if (!src) return;
    const cfg = this.config;
    const camQ = _q.copy(this.options.worldCamera.quaternion).invert();
    this.hemi.color.copy(src.hemi.color);
    this.hemi.groundColor.copy(src.hemi.groundColor);
    this.hemi.intensity = src.hemi.intensity * cfg.hemiScale;
    this.hemi.position.set(0, 1, 0).applyQuaternion(camQ);
    this.sun.color.copy(src.sun.color);
    this.sun.intensity = src.sun.intensity * cfg.sunScale;
    _v.copy(src.sun.position).sub(src.sun.target.position).normalize().applyQuaternion(camQ);
    this.sun.position.copy(_v);
    this.sun.target.position.set(0, 0, 0);
    this.sun.updateMatrixWorld();
    this.sun.target.updateMatrixWorld();
  }

  /**
   * 槍口在世界中的位置（曳光起點）：把 viewmodel 的槍口投影到畫面，再沿世界相機的同一條視線取相同深度，
   * 所以曳光在畫面上正好從槍口出發（兩台相機 FOV 不同）。槍模隱藏時用畫面中央略下方。
   */
  muzzleWorld(out: THREE.Vector3): THREE.Vector3 {
    const cam = this.options.worldCamera;
    const model = this.model;
    if (!model || !this.gun.visible || !this.state.visible) {
      return cam.localToWorld(out.set(0, -0.06, -0.5));
    }
    const p = model.root.localToWorld(_v2.copy(model.muzzle));
    const depth = Math.max(0.05, -p.z);
    const vmT = Math.tan((this.camera.fov * DEG2RAD) / 2);
    const ndcX = p.x / depth / (vmT * this.camera.aspect);
    const ndcY = p.y / depth / vmT;
    const wT = Math.tan((cam.fov * DEG2RAD) / 2);
    out.set(ndcX * wT * cam.aspect * depth, ndcY * wT * depth, -depth);
    return cam.localToWorld(out);
  }

  dispose(): void {
    for (const u of this.unsubs.splice(0)) u();
    for (const c of this.models.values()) c.model.dispose();
    this.models.clear();
    this.factory.dispose();
    this.flash.material.dispose();
  }
}
