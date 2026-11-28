// 正式鏡頭（M1-08）：每個渲染畫面把相機放在「插值後的腳底 + 眼高彈簧」，再疊加各種鏡頭效果。
//
// 效果全部是偏移，只影響畫面，不改變移動邏輯，也不改變命中判定用的視線（input.view 的 viewYaw／viewPitch；
// 後座力由 M1-10 透過 ViewAngles 的偏移介面加入，會一併反映在這裡讀到的視角上）：
//   - 眼高彈簧：蹲、滑鏟、起身時平滑眼高；攀爬時垂直位置以彈簧跟隨（鏡頭先落後再追上）。
//   - FOV：設定的水平 FOV ＋ 速度對應（Dash 中凍結）＋ 抓鉤中 ＋ FOV 衝擊（Dash 等），依畫面比例換算成垂直 FOV。
//   - 傾斜（roll）：跑牆、滑鏟、側移（彈簧平滑）＋ 傾斜衝量（側向 Dash 等）。
//   - 落地：依落地速度下沉並往下點頭（8 Hz、阻尼 0.7 的彈簧回彈）；重落地另加震動。
//   - 頭部晃動：依速度與步距的垂直／水平擺動，只在地面行走時。
//   - 創傷式震動：addTrauma／addTraumaAt。
// 每個效果都能由玩家設定個別關閉；全部關閉時鏡頭位置 = 插值後的眼睛、旋轉 = 視角、FOV = 設定值。
//
// 鏡頭只訂閱事件（player:land、player:dash、player:respawn）與讀取 PlayerState；效果在 render 以畫面的
// 模擬 dt（frame.dt：暫停時為 0、受 timeScale 影響）推進，彈簧與 damp 都是解析解，與畫面更新率無關。
// 傳送（重生或單一畫面位移超過 teleportSnapDistance）時所有彈簧直接到位。
// 除錯飛行（自由相機）時 getPlayer() 回傳 null：只套用視角與基礎 FOV，位置交給自由相機。
import * as THREE from 'three';
import type { EventBus } from '@/core/EventBus';
import type { GameEvents } from '@/core/events';
import { SystemOrder, type FrameInfo, type GameSystem } from '@/core/Game';
import { DEG2RAD, SpringScalar, clamp, damp } from '@/core/math';
import type { Settings } from '@/core/Settings';
import { CAMERA_CONFIG, type CameraConfig } from '@/camera/CameraConfig';
import {
  FovKicks,
  Trauma,
  dashRollImpulse,
  headBob,
  heavyLandingTrauma,
  landingDipAmount,
  resolveFov,
  rollTarget,
  speedFovBonus,
  springImpulseForPeak,
  traumaFalloff,
  type BobOffset,
  type FovResult,
  type ShakeOffset,
} from '@/camera/cameraMath';

/** 鏡頭讀取的玩家狀態（PlayerState 的子集）。 */
export interface CameraPlayerState {
  readonly position: Readonly<THREE.Vector3>;
  readonly previousPosition: Readonly<THREE.Vector3>;
  readonly velocity: Readonly<THREE.Vector3>;
  readonly state: string;
  readonly grounded: boolean;
  readonly eyeHeight: number;
  readonly previousEyeHeight: number;
  /** 水平速度（m/s）。 */
  readonly speed: number;
  readonly wallNormal: Readonly<THREE.Vector3>;
}

/** 鏡頭相關的玩家設定（Settings 的子集）。 */
export type CameraSettings = Pick<
  Settings,
  'fovHorizontal' | 'dynamicFov' | 'cameraTilt' | 'landingDip' | 'headBob' | 'screenShake'
>;

/** 每畫面的視角（例如 input.view：viewYaw／viewPitch 含後座力偏移）。 */
export interface CameraView {
  readonly viewYaw: number;
  readonly viewPitch: number;
}

export interface CameraRigOptions {
  camera: THREE.PerspectiveCamera;
  view: CameraView;
  getSettings: () => Readonly<CameraSettings>;
  /** 要跟隨的玩家；回傳 null 時（除錯飛行）只套用視角與基礎 FOV。 */
  getPlayer: () => Readonly<CameraPlayerState> | null;
  bus?: EventBus<GameEvents> | undefined;
  config?: CameraConfig;
}

/** 唯讀監看（調參面板、HUD、測試）。 */
export interface CameraRigState {
  /** 目前實際的水平／垂直 FOV（度，含動態 FOV）。 */
  horizontalFov: number;
  verticalFov: number;
  /** 不含動態 FOV 的水平／垂直 FOV（度；準星大小與開鏡靈敏度換算用）。 */
  baseHorizontalFov: number;
  baseVerticalFov: number;
  /** 傾斜（度，正值 = 上方往左）。 */
  rollDeg: number;
  /** 落地下沉（m，負值往下）。 */
  dip: number;
  trauma: number;
  /** 頭部晃動垂直偏移（m）。 */
  bob: number;
  /** 眼睛的高度偏移（眼高彈簧 + 攀爬跟隨，相對腳底，m）。 */
  eyeOffset: number;
}

const _right = new THREE.Vector3();
const _euler = new THREE.Euler(0, 0, 0, 'YXZ');

export class CameraRig implements GameSystem {
  readonly name = 'cameraRig';
  readonly order = SystemOrder.camera;
  readonly config: CameraConfig;
  readonly state: CameraRigState = {
    horizontalFov: 0,
    verticalFov: 0,
    baseHorizontalFov: 0,
    baseVerticalFov: 0,
    rollDeg: 0,
    dip: 0,
    trauma: 0,
    bob: 0,
    eyeOffset: 0,
  };

  /**
   * 開鏡縮放倍率（M1-10 的武器系統每畫面設定；1 = 不縮放）：最終 FOV = 2·atan(tan(FOV/2) / fovZoom)，
   * 套用在動態 FOV 之後。不要直接寫 camera.fov（每畫面會被覆寫）。
   */
  fovZoom = 1;

  /** 插值後的腳底位置與最終眼睛位置（不含效果）。 */
  readonly feet = new THREE.Vector3();
  readonly eye = new THREE.Vector3();

  private readonly eyeSpring = new SpringScalar({ frequency: CAMERA_CONFIG.eyeHeightFrequency });
  private readonly mantleLag = new SpringScalar({ frequency: CAMERA_CONFIG.mantleSmoothFrequency });
  private readonly rollSpring = new SpringScalar({ frequency: CAMERA_CONFIG.rollFrequency });
  private readonly rollImpulseSpring = new SpringScalar({ frequency: CAMERA_CONFIG.rollImpulseFrequency });
  private readonly dipSpring = new SpringScalar({
    frequency: CAMERA_CONFIG.landFrequency,
    dampingRatio: CAMERA_CONFIG.landDampingRatio,
  });
  private readonly kicks = new FovKicks();
  private readonly traumaState = new Trauma();
  private dynamicFov = 0;
  /** 速度對應的 FOV 目標；Dash 中凍結（Dash 的位移速度 46.7 m/s 不算，改由 FOV 衝擊表現）。 */
  private speedFovTarget = 0;
  private bobPhase = 0;
  private bobWeight = 0;
  private readonly bob: BobOffset = { vertical: 0, horizontal: 0 };
  private readonly shake: ShakeOffset = { yaw: 0, pitch: 0, roll: 0, x: 0, y: 0, z: 0 };
  private readonly fov: FovResult = { horizontal: 0, vertical: 0 };
  private readonly baseFov: FovResult = { horizontal: 0, vertical: 0 };
  private readonly lastFeet = new THREE.Vector3();
  private initialized = false;
  private snapRequested = false;
  private appliedFov = NaN;
  private readonly unsubs: (() => void)[] = [];

  constructor(private readonly options: CameraRigOptions) {
    this.config = options.config ?? CAMERA_CONFIG;
    const bus = options.bus;
    if (bus) {
      this.unsubs.push(
        bus.on('player:land', ({ impactSpeed }) => this.onLand(impactSpeed)),
        bus.on('player:dash', ({ dir }) => this.onDash(dir)),
        bus.on('player:respawn', () => this.snap()),
      );
    }
  }

  // ── 給其他系統的介面（武器、爆炸、受擊）──────────────────

  /** 加入創傷（0..1，總量上限 1）：開火、爆炸、重落地、受擊。震動量 = trauma²。 */
  addTrauma(amount: number): void {
    this.traumaState.add(amount);
  }

  /** 點狀來源（爆炸）：依與鏡頭的距離衰減，amount × (1 - d / radius)²。回傳實際加入的量。 */
  addTraumaAt(origin: Readonly<{ x: number; y: number; z: number }>, amount: number, radius: number): number {
    const p = this.options.camera.position;
    const d = Math.hypot(origin.x - p.x, origin.y - p.y, origin.z - p.z);
    const t = traumaFalloff(amount, d, radius);
    this.addTrauma(t);
    return t;
  }

  /** FOV 衝擊（水平度，可為負）：attack 內升起、duration 秒內回落；動態 FOV 關閉時忽略。 */
  addFovKick(amountDeg: number, duration: number, attack = this.config.fovKickAttack): void {
    if (!this.options.getSettings().dynamicFov) return;
    this.kicks.add(amountDeg, duration, attack);
  }

  /** 傾斜衝量（度，正值 = 上方往左）：峰值約為 amountDeg，之後彈簧回正。乘上設定的傾斜強度。 */
  addRollImpulse(amountDeg: number): void {
    const cfg = this.config;
    this.rollImpulseSpring.addImpulse(springImpulseForPeak(amountDeg, cfg.rollImpulseFrequency, 1));
  }

  /** 所有彈簧與效果直接到位（傳送、換關卡）。 */
  snap(): void {
    this.snapRequested = true;
  }

  /** 目前的 trauma（0..1）。 */
  get trauma(): number {
    return this.traumaState.value;
  }

  get horizontalFov(): number {
    return this.state.horizontalFov;
  }

  get verticalFov(): number {
    return this.state.verticalFov;
  }

  // ── Game 系統 ──────────────────────────────────────────

  render(alpha: number, frame: Readonly<FrameInfo>): void {
    this.advance(frame.dt, alpha);
  }

  dispose(): void {
    for (const u of this.unsubs.splice(0)) u();
  }

  /** 推進 dt（模擬秒）並套用到相機；alpha 為固定步之間的插值係數。無頭測試直接呼叫。 */
  advance(dt: number, alpha: number): void {
    const cam = this.options.camera;
    const view = this.options.view;
    const settings = this.options.getSettings();
    const cfg = this.config;
    const player = this.options.getPlayer();
    this.syncSpringParams();

    resolveFov(settings.fovHorizontal, cam.aspect, cfg.maxHorizontalFov, cfg.maxVerticalFov, this.baseFov);

    if (!player) {
      // 除錯飛行：只套用視角與基礎 FOV；效果歸零，下次跟隨玩家時直接到位。
      this.resetEffects();
      this.initialized = false;
      this.applyRotation(view.viewYaw, view.viewPitch, 0);
      this.applyFov(this.baseFov, this.baseFov);
      this.state.rollDeg = this.state.dip = this.state.bob = this.state.eyeOffset = 0;
      return;
    }

    // ── 位置：插值後的腳底 + 眼高彈簧 ──
    this.feet.lerpVectors(player.previousPosition, player.position, alpha);
    const eyeHeight = player.previousEyeHeight + (player.eyeHeight - player.previousEyeHeight) * alpha;
    const teleported = this.initialized && this.feet.distanceTo(this.lastFeet) > cfg.teleportSnapDistance;
    if (!this.initialized || teleported || this.snapRequested) {
      this.eyeSpring.snap(eyeHeight);
      this.mantleLag.snap(0);
      this.resetEffects();
      this.lastFeet.copy(this.feet);
      this.initialized = true;
      this.snapRequested = false;
    }
    const dy = this.feet.y - this.lastFeet.y;
    this.lastFeet.copy(this.feet);
    this.eyeSpring.target = eyeHeight;
    this.eyeSpring.update(dt);
    // 攀爬：腳底的垂直位移先記成落後量，再以彈簧追回（臨界阻尼，不過衝）。
    if (player.state === 'mantle') this.mantleLag.value -= dy;
    this.mantleLag.update(dt);
    const eyeOffset = this.eyeSpring.value + this.mantleLag.value;

    // ── FOV ──
    if (settings.dynamicFov) {
      if (player.state !== 'dash') this.speedFovTarget = speedFovBonus(player.speed, cfg);
      const target = this.speedFovTarget + (player.state === 'grapple' ? cfg.fovGrappleBonus : 0);
      this.dynamicFov = damp(this.dynamicFov, target, cfg.fovSmoothing, dt);
      this.kicks.update(dt);
    } else {
      this.dynamicFov = 0;
      this.kicks.clear();
    }
    const hFov = settings.fovHorizontal + (settings.dynamicFov ? this.dynamicFov + this.kicks.value : 0);
    resolveFov(hFov, cam.aspect, cfg.maxHorizontalFov, cfg.maxVerticalFov, this.fov);
    if (this.fovZoom !== 1 && this.fovZoom > 0) applyZoom(this.fov, this.fovZoom);

    // ── 傾斜 ──
    const yaw = view.viewYaw;
    this.rollSpring.target = rollTarget(player, yaw, cfg);
    this.rollSpring.update(dt);
    this.rollImpulseSpring.update(dt);
    const tilt = clamp(settings.cameraTilt, 0, 1);
    const rollDeg = (this.rollSpring.value + this.rollImpulseSpring.value) * tilt;

    // ── 落地 ──
    this.dipSpring.update(dt);
    const dip = settings.landingDip ? this.dipSpring.value : 0;
    const nod = cfg.landMaxDip > 0 ? (dip / cfg.landMaxDip) * cfg.landNodDeg * DEG2RAD : 0;

    // ── 頭部晃動 ──
    const walking = player.state === 'ground' && player.grounded;
    this.bobWeight = damp(this.bobWeight, walking ? 1 : 0, cfg.bobBlend, dt);
    if (walking && cfg.bobStride > 0) this.bobPhase = (this.bobPhase + (player.speed * dt) / cfg.bobStride) % 2;
    if (settings.headBob) headBob(this.bobPhase, player.speed, this.bobWeight, cfg, this.bob);
    else this.bob.vertical = this.bob.horizontal = 0;

    // ── 震動 ──
    this.traumaState.update(dt, cfg.traumaDecay);
    this.traumaState.sample(cfg, settings.screenShake, this.shake);
    const sh = this.shake;

    // ── 套用 ──
    _right.set(Math.cos(yaw), 0, -Math.sin(yaw));
    this.eye.set(this.feet.x, this.feet.y + eyeOffset, this.feet.z);
    cam.position.copy(this.eye);
    cam.position.y += dip + this.bob.vertical;
    cam.position.addScaledVector(_right, this.bob.horizontal);
    this.applyRotation(yaw + sh.yaw, view.viewPitch + nod + sh.pitch, rollDeg * DEG2RAD + sh.roll);
    if (sh.x !== 0 || sh.y !== 0 || sh.z !== 0) {
      // 震動位移在相機座標（右、上、後）。
      _right.set(sh.x, sh.y, sh.z).applyQuaternion(cam.quaternion);
      cam.position.add(_right);
    }
    this.applyFov(this.fov, this.baseFov);

    const st = this.state;
    st.rollDeg = rollDeg;
    st.dip = dip;
    st.trauma = this.traumaState.value;
    st.bob = this.bob.vertical;
    st.eyeOffset = eyeOffset;
  }

  // ── 內部 ───────────────────────────────────────────────

  private onLand(impactSpeed: number): void {
    const cfg = this.config;
    const settings = this.options.getSettings();
    const amount = landingDipAmount(impactSpeed, cfg);
    if (amount > 0 && settings.landingDip) {
      this.dipSpring.addImpulse(springImpulseForPeak(-amount, cfg.landFrequency, cfg.landDampingRatio));
    }
    this.addTrauma(heavyLandingTrauma(impactSpeed, cfg));
  }

  private onDash(dir: { x: number; z: number }): void {
    const cfg = this.config;
    this.addFovKick(cfg.fovDashKick, cfg.fovDashKickTime);
    const roll = dashRollImpulse(dir, this.options.view.viewYaw, cfg);
    if (roll !== 0) this.addRollImpulse(roll);
  }

  private resetEffects(): void {
    this.rollSpring.snap(0);
    this.rollImpulseSpring.snap(0);
    this.dipSpring.snap(0);
    this.kicks.clear();
    this.traumaState.clear();
    this.dynamicFov = 0;
    this.speedFovTarget = 0;
    this.bobWeight = 0;
    this.bobPhase = 0;
  }

  private syncSpringParams(): void {
    const cfg = this.config;
    this.eyeSpring.frequency = cfg.eyeHeightFrequency;
    this.mantleLag.frequency = cfg.mantleSmoothFrequency;
    this.rollSpring.frequency = cfg.rollFrequency;
    this.rollSpring.dampingRatio = cfg.rollDampingRatio;
    this.rollImpulseSpring.frequency = cfg.rollImpulseFrequency;
    this.dipSpring.frequency = cfg.landFrequency;
    this.dipSpring.dampingRatio = cfg.landDampingRatio;
  }

  private applyRotation(yaw: number, pitch: number, roll: number): void {
    const lim = this.config.maxPitchDeg * DEG2RAD;
    _euler.set(clamp(pitch, -lim, lim), yaw, roll, 'YXZ');
    this.options.camera.quaternion.setFromEuler(_euler);
  }

  private applyFov(fov: FovResult, base: FovResult): void {
    const st = this.state;
    st.horizontalFov = fov.horizontal;
    st.verticalFov = fov.vertical;
    st.baseHorizontalFov = base.horizontal;
    st.baseVerticalFov = base.vertical;
    const cam = this.options.camera;
    if (Math.abs(fov.vertical - this.appliedFov) > 1e-5 || cam.fov !== this.appliedFov) {
      cam.fov = fov.vertical;
      cam.updateProjectionMatrix();
      this.appliedFov = fov.vertical;
    }
  }
}

/** 開鏡縮放：兩軸的 tan(FOV/2) 都除以 zoom（畫面比例不變）。 */
function applyZoom(fov: FovResult, zoom: number): void {
  // FOV（度）→ 半角弧度：× π/360；半角弧度 → FOV（度）：÷ (π/360)。
  const k = Math.PI / 360;
  fov.horizontal = Math.atan(Math.tan(fov.horizontal * k) / zoom) / k;
  fov.vertical = Math.atan(Math.tan(fov.vertical * k) / zoom) / k;
}
