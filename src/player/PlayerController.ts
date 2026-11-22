// 玩家控制器（M1-05）：膠囊體＋Rapier KinematicCharacterController＋可擴充的移動狀態機。
//
// 每個固定步（fixedUpdate → step）：
//   1. 讀 InputFrame：期望方向（依 yaw）、蹲／跳／衝刺／開火／開鏡；更新跳躍緩衝。
//   2. 姿勢：蹲下／起身（膠囊高度在 crouchTransitionTime 內線性過渡，腳底固定；起身前 overlap 檢查頭頂空間）。
//   3. 狀態機 'pre' 轉換 → 目前狀態 step（只改速度）。
//   4. 移動：期望位移 = 速度 × dt（重力以梯形積分修正）→ computeColliderMovement → 依實際碰撞法線投影速度
//      （只有「真的被擋住」的分量才移除：撞牆不累積速度、沿牆滑行；自動上台階不會被擋速）。
//   5. 地面探測：向下 shape cast（球），取得地面法線、距離與表面材質。
//   6. 落地事件 → 狀態機 'post' 轉換 → 腳步事件 → killVolume 重生。
// 速度自己維護（不用 Rapier 剛體）；切換狀態永不硬性歸零速度（只有重生會歸零）。
//
// 座標：position 是腳底（膠囊底部）位置；眼睛 = position + eyeHeight。yaw 0 面向 -Z、正值向左（M1-03）。
// 物理世界重建（physics.generation 改變）時自動重建膠囊與角色控制器。
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import type { EventBus } from '@/core/EventBus';
import type { GameEvents } from '@/core/events';
import { SystemOrder, type GameSystem } from '@/core/Game';
import { DEG2RAD } from '@/core/math';
import { InputBuffer } from '@/input/InputBuffer';
import { isHeld, wasPressed, type InputFrame } from '@/input/InputFrame';
import { COLLISION_PRESETS, QueryMask, queryGroups } from '@/physics/groups';
import type { Physics, PhysicsHit, Vec3Like } from '@/physics/Physics';
import type { SurfaceType } from '@/physics/SurfaceRegistry';
import { MOVEMENT_CONFIG, type MovementConfig } from '@/player/MovementConfig';
import { clipVelocity, horizontalSpeed, inputAngleFromForward, jumpSpeedFor, wishDirection } from '@/player/movementMath';
import { StateMachine } from '@/player/StateMachine';
import { MoveStateId, registerCoreMovement } from '@/player/states';

/** 給鏡頭、HUD、音效、武器讀取的玩家狀態（每步更新，同一個物件）。 */
export interface PlayerState {
  /** 腳底位置（這一步結束）。 */
  readonly position: THREE.Vector3;
  /** 上一步的腳底位置（插值用）。 */
  readonly previousPosition: THREE.Vector3;
  readonly velocity: THREE.Vector3;
  /** 移動狀態 id（'ground'／'air'／'slide'…）。 */
  state: string;
  grounded: boolean;
  /** 眼高（腳底以上，這一步結束）。 */
  eyeHeight: number;
  /** 上一步的眼高（插值用）。 */
  previousEyeHeight: number;
  /** 蹲下程度 0（站）→ 1（蹲）。 */
  crouchAmount: number;
  /** 姿勢目標是否為蹲（含滑鏟）。 */
  crouched: boolean;
  /** 地面法線（著地時有效，否則為正上方）。 */
  readonly groundNormal: THREE.Vector3;
  /** 腳下表面材質（著地時有效）。 */
  surface: SurfaceType | null;
  /** 水平速度（m/s）。 */
  speed: number;
}

/** 玩家相關設定（Settings 的子集）。 */
export interface PlayerSettings {
  autoSprint: boolean;
}

/** 重生點（腳底位置、yaw 弧度）。 */
export interface RespawnTarget {
  pos: Vec3Like;
  yaw: number;
}

export interface PlayerControllerOptions {
  physics: Physics;
  /** 每個固定步的輸入（InputSystem.frame）。 */
  getFrame: () => Readonly<InputFrame>;
  bus?: EventBus<GameEvents> | undefined;
  config?: MovementConfig;
  getSettings?: () => Readonly<PlayerSettings>;
  /** 每步檢查是否落入 killVolume（傳入腳底位置）；回傳重生點時傳送過去。 */
  checkRespawn?: (feet: Readonly<Vec3Like>) => RespawnTarget | null;
  /** 傳送後要求設定視角（yaw、pitch 弧度），例如 input.view.set。 */
  setView?: (yaw: number, pitch: number) => void;
  /** 渲染時放到插值後眼睛位置的物件（暫用：直接放相機；M1-08 改由 CameraRig 讀 PlayerState）。 */
  object?: THREE.Object3D | null;
}

/** 這一步讀到的輸入（狀態與轉換規則使用）。 */
export interface MoveInput {
  moveX: number;
  moveY: number;
  crouchHeld: boolean;
  crouchPressed: boolean;
  sprintHeld: boolean;
  fireHeld: boolean;
  adsHeld: boolean;
  jumpPressed: boolean;
}

const UP = new THREE.Vector3(0, 1, 0);
/** 上升速度超過此值時不算著地（剛起跳）。 */
const GROUNDED_MAX_RISE_SPEED = 0.5;
/** 地面探測球的半徑比例與起點抬高（避免起點就重疊）。 */
const PROBE_RADIUS_RATIO = 0.9;
const PROBE_LIFT = 0.05;
/** 起身檢查：膠囊半徑內縮與底部抬高（不把腳下地面算成擋住）。 */
const HEADROOM_SHRINK = 0.02;
const HEADROOM_LIFT = 0.02;
/** 速度投影：期望位移比實際位移多進入法線方向超過此距離才算被擋住。 */
const BLOCK_EPS = 1e-5;
/** 碰撞點在腳底以上 autostepHeight + 此值以內視為台階。 */
const STEP_CONTACT_MARGIN = 0.02;
/** 修正碰撞法線的射線：比半徑多打的距離，與接受的最小方向一致度。 */
const NORMAL_RAY_EXTRA = 0.1;
const NORMAL_REFINE_MIN_DOT = 0.5;
/** 離地超過 skinOffset × 此倍率才貼地（間隙內的微小距離不處理，平地不抖動）。 */
const SNAP_MIN_OFFSET_RATIO = 2;

const _desired = { x: 0, y: 0, z: 0 };
const _center = { x: 0, y: 0, z: 0 };
const _moved = new RAPIER.Vector3(0, 0, 0);
const _jumpDir = new THREE.Vector3();
const _probeFrom = { x: 0, y: 0, z: 0 };
const _down = { x: 0, y: -1, z: 0 };
const _refined = { x: 0, y: 1, z: 0 };
const _rayFrom = { x: 0, y: 0, z: 0 };
const _rayDir = { x: 0, y: -1, z: 0 };

export class PlayerController implements GameSystem {
  readonly name = 'player';
  readonly order = SystemOrder.player;

  readonly config: MovementConfig;
  readonly machine: StateMachine<PlayerController>;
  readonly state: PlayerState;
  /** 停用時不模擬、不移動相機（除錯飛行模式）。 */
  enabled = true;

  // ── 狀態與轉換規則讀寫的欄位（不是公開 API，但狀態實作需要）──
  readonly velocity = new THREE.Vector3();
  readonly position = new THREE.Vector3();
  readonly groundNormal = new THREE.Vector3(0, 1, 0);
  readonly input: MoveInput = {
    moveX: 0,
    moveY: 0,
    crouchHeld: false,
    crouchPressed: false,
    sprintHeld: false,
    fireHeld: false,
    adsHeld: false,
    jumpPressed: false,
  };
  /** 期望方向（世界水平單位向量）與輸入長度（0..1）。 */
  readonly wish = { x: 0, z: 0, len: 0 };
  readonly jumpBuffer: InputBuffer;
  grounded = false;
  groundDistance = Number.POSITIVE_INFINITY;
  surface: SurfaceType | null = null;
  /** 在地面狀態的步數（落地免摩擦用）。 */
  stepsOnGround = 0;
  /** 離地後經過時間（s）。 */
  airTime = 0;
  /** 是否還有土狼時間可用（走出平台、尚未起跳）。 */
  coyoteAvailable = false;
  /** 這一步是否起跳（Air.enter 判斷是不是走出平台）。 */
  jumpedThisStep = false;
  /** 距上次滑鏟推進的時間（s）。 */
  slideBoostTimer = Number.POSITIVE_INFINITY;
  /** 姿勢：目前蹲下程度 0..1 與目標。 */
  crouchAmount = 0;
  crouchTarget = false;
  /** 起身被頭頂擋住（除錯顯示）。 */
  headBlocked = false;
  /** Rapier 角色控制器回報的著地（除錯顯示）。 */
  controllerGrounded = false;
  /** 這一步的重力（套用時記錄，用來做梯形積分修正）。 */
  private gravityThisStep = 0;
  private footstepAccum = 0;

  private readonly options: PlayerControllerOptions;
  private collider: RAPIER.Collider | null = null;
  private controller: RAPIER.KinematicCharacterController | null = null;
  private generation = -1;
  private probeShape: RAPIER.Ball | null = null;
  private probeRadius = 0;
  private headroomShape: RAPIER.Capsule | null = null;
  private headroomKey = '';
  private currentHalfHeight = -1;
  private readonly rendered = new THREE.Vector3();
  private readonly collision = new RAPIER.CharacterCollision();

  // 事件 payload（重複使用）。
  private readonly evState = { from: '', to: '' };
  private readonly evJump = { fromState: '', coyote: false };
  private readonly evLand = { impactSpeed: 0, surface: 'metal' };
  private readonly evSlideStart = { speed: 0, boosted: false };
  private readonly evSlideEnd = { speed: 0 };
  private readonly evCrouch = { crouched: false };
  private readonly evFootstep = { surface: 'metal', speed: 0 };
  private readonly evRespawn = { pos: { x: 0, y: 0, z: 0 } };

  constructor(options: PlayerControllerOptions) {
    this.options = options;
    this.config = options.config ?? MOVEMENT_CONFIG;
    this.jumpBuffer = new InputBuffer(() => this.config.jumpBufferTime);
    this.state = {
      position: this.position,
      previousPosition: new THREE.Vector3(),
      velocity: this.velocity,
      state: MoveStateId.air,
      grounded: false,
      eyeHeight: this.config.standEyeHeight,
      previousEyeHeight: this.config.standEyeHeight,
      crouchAmount: 0,
      crouched: false,
      groundNormal: this.groundNormal,
      surface: null,
      speed: 0,
    };
    this.machine = new StateMachine<PlayerController>(this, (from, to) => {
      this.evState.from = from;
      this.evState.to = to;
      this.state.state = to;
      this.options.bus?.emit('player:state', this.evState);
    });
    registerCoreMovement(this.machine);
    this.machine.set(MoveStateId.air);
  }

  /** 玩家膠囊（物理世界重建後會換成新的；尚未建立時為 null）。 */
  get capsule(): RAPIER.Collider | null {
    return this.collider;
  }

  /** 目前膠囊總高。 */
  get height(): number {
    const c = this.config;
    return c.standHeight + (c.crouchHeight - c.standHeight) * this.crouchAmount;
  }

  /** 目前眼高。 */
  get eyeHeight(): number {
    const c = this.config;
    return c.standEyeHeight + (c.crouchEyeHeight - c.standEyeHeight) * this.crouchAmount;
  }

  // ── 對外 API ───────────────────────────────────────────

  /** 傳送到腳底位置 feet，面向 yaw（弧度）；速度歸零、回到站姿（頭頂有空間時）、狀態設為空中。 */
  teleport(feet: Readonly<Vec3Like>, yaw?: number, pitch = 0): void {
    this.position.set(feet.x, feet.y + this.config.skinOffset * 2, feet.z);
    this.state.previousPosition.copy(this.position);
    this.velocity.set(0, 0, 0);
    this.grounded = false;
    this.coyoteAvailable = false;
    this.jumpBuffer.clear();
    this.footstepAccum = 0;
    this.ensureBody();
    if (this.crouchAmount > 0 && this.hasHeadroom()) {
      this.crouchAmount = 0;
      this.crouchTarget = false;
    }
    this.applyPosture();
    this.syncColliderToFeet();
    this.machine.set(MoveStateId.air, true);
    this.state.state = this.machine.currentId;
    this.publishState();
    this.state.previousEyeHeight = this.state.eyeHeight;
    this.rendered.copy(this.position);
    if (yaw !== undefined) this.options.setView?.(yaw, pitch);
    this.placeObject(1);
  }

  /** 回到檢查點：傳送、速度歸零並發出 `player:respawn`。 */
  respawn(target: RespawnTarget): void {
    this.teleport(target.pos, target.yaw);
    const p = this.evRespawn.pos;
    p.x = this.position.x;
    p.y = this.position.y;
    p.z = this.position.z;
    this.options.bus?.emit('player:respawn', this.evRespawn);
  }

  fixedUpdate(dt: number): void {
    if (!this.enabled) {
      this.state.previousPosition.copy(this.position);
      this.state.previousEyeHeight = this.state.eyeHeight;
      return;
    }
    this.step(dt);
  }

  render(alpha: number): void {
    if (!this.enabled) return;
    this.placeObject(alpha);
  }

  /** 插值後的眼睛位置（alpha 為固定步之間的插值係數）。 */
  eyePosition(alpha: number, out: THREE.Vector3): THREE.Vector3 {
    const s = this.state;
    out.lerpVectors(s.previousPosition, s.position, alpha);
    out.y += s.previousEyeHeight + (s.eyeHeight - s.previousEyeHeight) * alpha;
    return out;
  }

  dispose(): void {
    this.removeBody();
  }

  /** 推進一個固定步（無頭測試直接呼叫）。 */
  step(dt: number): void {
    if (!(dt > 0)) return;
    this.ensureBody();
    const s = this.state;
    s.previousPosition.copy(this.position);
    s.previousEyeHeight = s.eyeHeight;
    this.jumpedThisStep = false;
    this.gravityThisStep = 0;
    this.slideBoostTimer += dt;

    this.readInput(dt);
    this.updatePosture(dt);
    this.machine.evaluate('pre');
    this.machine.step(dt);
    const wasGrounded = this.grounded;
    const fallSpeed = Math.max(0, -this.velocity.y);
    const moved = this.move(dt);
    this.probeGround();
    if (this.grounded && !wasGrounded) {
      this.evLand.impactSpeed = fallSpeed;
      this.evLand.surface = this.surface ?? 'metal';
      this.options.bus?.emit('player:land', this.evLand);
      // 落地時腳步計數從半步開始（落地後很快就有第一步）。
      this.footstepAccum = this.config.footstepStride * 0.5;
    }
    this.machine.evaluate('post');
    this.updateFootsteps(moved);
    this.publishState();

    const respawn = this.options.checkRespawn?.(this.position);
    if (respawn) this.respawn(respawn);
  }

  // ── 狀態使用的工具 ─────────────────────────────────────

  /** 地面的目標速度（蹲走／跑／衝刺）。 */
  groundWishSpeed(): number {
    const cfg = this.config;
    if (this.crouchTarget) return cfg.crouchSpeed;
    return this.isSprinting() ? cfg.sprintSpeed : cfg.runSpeed;
  }

  /** 是否符合衝刺條件（站姿、方向在正前方錐形內、沒開火或開鏡；手動模式要按住衝刺鍵）。 */
  isSprinting(): boolean {
    const inp = this.input;
    if (this.crouchTarget || this.wish.len < 1e-3 || inp.fireHeld || inp.adsHeld) return false;
    const auto = this.options.getSettings?.().autoSprint ?? true;
    if (!auto && !inp.sprintHeld) return false;
    return inputAngleFromForward(inp.moveX, inp.moveY) <= this.config.sprintConeDeg * DEG2RAD + 1e-6;
  }

  /**
   * 有跳躍緩衝時起跳並回傳 true。地面／滑鏟起跳方向為地面法線與正上方的混合；保留水平動量。
   * coyote：土狼時間內的空中起跳（方向為正上方）。
   */
  tryJump(coyote: boolean): boolean {
    if (!this.jumpBuffer.consume()) return false;
    const cfg = this.config;
    const v = this.velocity;
    _jumpDir.copy(UP);
    if (!coyote) _jumpDir.lerp(this.groundNormal, cfg.jumpNormalBlend).normalize();
    if (v.y < 0) v.y = 0;
    v.addScaledVector(_jumpDir, jumpSpeedFor(cfg.jumpHeight, cfg.gravity));
    this.jumpedThisStep = true;
    this.coyoteAvailable = false;
    this.grounded = false;
    this.evJump.fromState = this.machine.currentId;
    this.evJump.coyote = coyote;
    this.options.bus?.emit('player:jump', this.evJump);
    return true;
  }

  /** 套用重力（半隱式＋梯形位移修正，跳躍高度與步長無關）並限制最大下落速度。 */
  applyGravity(dt: number): void {
    const g = this.config.gravity;
    this.velocity.y = Math.max(this.velocity.y - g * dt, -this.config.maxFallSpeed);
    this.gravityThisStep = g;
  }

  emitSlideStart(speed: number, boosted: boolean): void {
    this.evSlideStart.speed = speed;
    this.evSlideStart.boosted = boosted;
    this.options.bus?.emit('player:slideStart', this.evSlideStart);
  }

  emitSlideEnd(speed: number): void {
    this.evSlideEnd.speed = speed;
    this.options.bus?.emit('player:slideEnd', this.evSlideEnd);
  }

  /** 以目前膠囊（站姿尺寸）檢查頭頂是否有起身空間。 */
  hasHeadroom(): boolean {
    const cfg = this.config;
    const r = Math.max(0.01, cfg.radius - HEADROOM_SHRINK);
    const hh = Math.max(0, cfg.standHeight / 2 - cfg.radius);
    const key = `${hh}:${r}`;
    if (!this.headroomShape || this.headroomKey !== key) {
      this.headroomShape = new RAPIER.Capsule(hh, r);
      this.headroomKey = key;
    }
    _center.x = this.position.x;
    _center.y = this.position.y + HEADROOM_LIFT + HEADROOM_SHRINK + hh + r;
    _center.z = this.position.z;
    const n = this.options.physics.overlap(
      this.headroomShape,
      _center,
      QueryMask.playerMove,
      undefined,
      this.collider,
      1,
      RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
    );
    return n === 0;
  }

  // ── 內部 ───────────────────────────────────────────────

  private readInput(dt: number): void {
    const f = this.options.getFrame();
    const inp = this.input;
    inp.moveX = f.move.x;
    inp.moveY = f.move.y;
    inp.crouchHeld = isHeld(f, 'crouch');
    inp.crouchPressed = wasPressed(f, 'crouch');
    inp.sprintHeld = isHeld(f, 'sprint');
    inp.fireHeld = isHeld(f, 'fire');
    inp.adsHeld = isHeld(f, 'ads');
    inp.jumpPressed = wasPressed(f, 'jump');
    this.jumpBuffer.updateFrom(dt, f, 'jump');
    const w = this.wish;
    wishDirection(f.move.x, f.move.y, f.yaw, w);
    const len = Math.hypot(w.x, w.z);
    if (len > 1e-6) {
      w.x /= len;
      w.z /= len;
      w.len = Math.min(1, len);
    } else {
      w.x = 0;
      w.z = 0;
      w.len = 0;
    }
  }

  private updatePosture(dt: number): void {
    const cfg = this.config;
    let want = this.input.crouchHeld || this.machine.is(MoveStateId.slide);
    this.headBlocked = false;
    if (!want && this.crouchAmount > 0 && !this.hasHeadroom()) {
      want = true;
      this.headBlocked = true;
    }
    if (want !== this.crouchTarget) {
      this.crouchTarget = want;
      this.evCrouch.crouched = want;
      this.options.bus?.emit('player:crouch', this.evCrouch);
    }
    const rate = dt / Math.max(1e-3, cfg.crouchTransitionTime);
    const target = want ? 1 : 0;
    if (this.crouchAmount < target) this.crouchAmount = Math.min(target, this.crouchAmount + rate);
    else if (this.crouchAmount > target) this.crouchAmount = Math.max(target, this.crouchAmount - rate);
    this.applyPosture();
  }

  /** 依 crouchAmount 設定膠囊半高（腳底固定）。 */
  private applyPosture(): void {
    const cfg = this.config;
    const hh = Math.max(0, this.height / 2 - cfg.radius);
    const c = this.collider;
    if (c && Math.abs(hh - this.currentHalfHeight) > 1e-6) {
      c.setHalfHeight(hh);
      this.currentHalfHeight = hh;
    }
    if (c && Math.abs(c.radius() - cfg.radius) > 1e-6) c.setRadius(cfg.radius);
  }

  private halfTotalHeight(): number {
    return this.currentHalfHeight + this.config.radius;
  }

  private syncColliderToFeet(): void {
    if (!this.collider) return;
    _center.x = this.position.x;
    _center.y = this.position.y + this.halfTotalHeight();
    _center.z = this.position.z;
    this.collider.setTranslation(_center);
  }

  private applyControllerConfig(kcc: RAPIER.KinematicCharacterController, groundedMove: boolean): void {
    const cfg = this.config;
    if (Math.abs(kcc.offset() - cfg.skinOffset) > 1e-9) kcc.setOffset(cfg.skinOffset);
    kcc.setMaxSlopeClimbAngle(cfg.maxSlopeClimbDeg * DEG2RAD);
    kcc.setMinSlopeSlideAngle(cfg.minSlopeSlideDeg * DEG2RAD);
    // 自動上台階只在地面移動時啟用（空中不自動跨台階）。
    if (groundedMove && cfg.autostepHeight > 0) kcc.enableAutostep(cfg.autostepHeight, cfg.autostepMinWidth, false);
    else kcc.disableAutostep();
    // 貼地由 snapDown() 自己做（見該方法說明）。
    if (kcc.snapToGroundEnabled()) kcc.disableSnapToGround();
  }

  /** 移動膠囊並投影速度；回傳水平實際位移量（m）。 */
  private move(dt: number): number {
    const kcc = this.controller!;
    const collider = this.collider!;
    const v = this.velocity;
    const onGround = (this.machine.is(MoveStateId.ground) || this.machine.is(MoveStateId.slide)) && v.y <= 0;
    this.applyControllerConfig(kcc, onGround);
    _desired.x = v.x * dt;
    // 重力的梯形積分：位移用本步開始與結束速度的平均（v 已經減過 g·dt，所以補回 ½ g dt²）。
    _desired.y = v.y * dt + 0.5 * this.gravityThisStep * dt * dt;
    _desired.z = v.z * dt;
    this.syncColliderToFeet();
    this.options.physics.ensureQueries();
    kcc.computeColliderMovement(
      collider,
      _desired,
      RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
      queryGroups(QueryMask.playerMove),
    );
    const m = kcc.computedMovement(_moved);
    this.controllerGrounded = kcc.computedGrounded();
    this.position.x += m.x;
    this.position.y += m.y;
    this.position.z += m.z;
    this.syncColliderToFeet();

    // 速度投影：只移除真的被擋住的分量。
    const cfg = this.config;
    const walkableCos = Math.cos(cfg.maxSlopeClimbDeg * DEG2RAD);
    const feetBeforeY = this.state.previousPosition.y;
    const count = kcc.numComputedCollisions();
    for (let i = 0; i < count; i++) {
      const c = kcc.computedCollision(i, this.collision);
      if (!c) continue;
      const n = this.refineNormal(c.normal1, c.witness1.y);
      // 地面狀態中，可站立的面由狀態處理（否則上坡會被投影減速）。
      if (onGround && n.y >= walkableCos) continue;
      // 地面狀態中撞到腳邊的低矮障礙（台階）：交給 autostep 在接下來幾步跨上去，不擋速度。
      if (onGround && cfg.autostepHeight > 0 && c.witness1.y - feetBeforeY <= cfg.autostepHeight + STEP_CONTACT_MARGIN) continue;
      const intoDesired = -(_desired.x * n.x + _desired.y * n.y + _desired.z * n.z);
      const intoActual = -(m.x * n.x + m.y * n.y + m.z * n.z);
      if (intoDesired - intoActual > BLOCK_EPS) clipVelocity(v, n.x, n.y, n.z);
    }
    const horizontal = Math.hypot(m.x, m.z);
    if (onGround) this.snapDown();
    return horizontal;
  }

  /**
   * 角色控制器回報的碰撞法線在「貼著間隙移動」時會有幾度的誤差（平面牆回報成 (0.24, 0, 0.97) 之類），
   * 直接拿來投影會把速度彈離牆面造成抖動。改從膠囊軸線朝碰撞方向打一條射線取得表面的真實法線；
   * 射線沒打到或方向差太多時沿用原本的法線。
   */
  private refineNormal(n: Readonly<Vec3Like>, contactY: number): Vec3Like {
    const cfg = this.config;
    const out = _refined;
    out.x = n.x;
    out.y = n.y;
    out.z = n.z;
    const r = cfg.radius;
    const bottom = this.position.y + r;
    const top = this.position.y + this.height - r;
    _rayFrom.x = this.position.x;
    _rayFrom.y = Math.min(top, Math.max(bottom, contactY));
    _rayFrom.z = this.position.z;
    _rayDir.x = -n.x;
    _rayDir.y = -n.y;
    _rayDir.z = -n.z;
    const hit = this.options.physics.raycast(_rayFrom, _rayDir, r + cfg.skinOffset + NORMAL_RAY_EXTRA, QueryMask.playerMove);
    if (hit && hit.normal.x * n.x + hit.normal.y * n.y + hit.normal.z * n.z > NORMAL_REFINE_MIN_DOT) {
      out.x = hit.normal.x;
      out.y = hit.normal.y;
      out.z = hit.normal.z;
    }
    return out;
  }

  /** 從腳底往下掃掠探測球，最多 distance 公尺（命中結果物件會被下一次 shapeCast 覆寫）。 */
  private castGround(distance: number): PhysicsHit | null {
    const cfg = this.config;
    const rp = cfg.radius * PROBE_RADIUS_RATIO;
    if (!this.probeShape || Math.abs(this.probeRadius - rp) > 1e-9) {
      this.probeShape = new RAPIER.Ball(rp);
      this.probeRadius = rp;
    }
    _probeFrom.x = this.position.x;
    _probeFrom.y = this.position.y + rp + PROBE_LIFT;
    _probeFrom.z = this.position.z;
    return this.options.physics.shapeCast(
      this.probeShape,
      _probeFrom,
      _down,
      PROBE_LIFT + distance,
      QueryMask.playerMove,
      undefined,
      this.collider,
      false,
    );
  }

  /**
   * 貼地：在地面移動後若離地（下坡、下台階），且下方 snapToGround 內有可站立的面，就往下移過去。
   * 不用 Rapier 內建的 snapToGround：它在平地上會讓膠囊上下抖動 1–4 cm、偶爾陷進地面並卡住一步。
   */
  private snapDown(): void {
    const cfg = this.config;
    if (cfg.snapToGround <= 0) return;
    const hit = this.castGround(cfg.snapToGround);
    if (!hit || hit.normal.y < Math.cos(cfg.maxSlopeClimbDeg * DEG2RAD)) return;
    const dist = hit.distance - PROBE_LIFT;
    if (dist <= cfg.skinOffset * SNAP_MIN_OFFSET_RATIO || dist > cfg.snapToGround) return;
    _desired.x = 0;
    _desired.y = -dist;
    _desired.z = 0;
    const kcc = this.controller!;
    kcc.computeColliderMovement(
      this.collider!,
      _desired,
      RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
      queryGroups(QueryMask.playerMove),
    );
    const m = kcc.computedMovement(_moved);
    this.position.x += m.x;
    this.position.y += m.y;
    this.position.z += m.z;
    this.syncColliderToFeet();
  }

  private probeGround(): void {
    const cfg = this.config;
    const hit = this.castGround(cfg.groundProbeDistance);
    const walkableCos = Math.cos(cfg.maxSlopeClimbDeg * DEG2RAD);
    const rising = this.velocity.y > GROUNDED_MAX_RISE_SPEED || this.jumpedThisStep;
    if (hit && hit.normal.y >= walkableCos) {
      this.groundDistance = hit.distance - PROBE_LIFT;
      this.grounded = !rising && this.groundDistance <= cfg.groundProbeDistance;
      if (this.grounded) {
        this.groundNormal.set(hit.normal.x, hit.normal.y, hit.normal.z).normalize();
        this.surface = hit.surface?.surface ?? 'metal';
      }
    } else if (!hit && this.controllerGrounded && !rising) {
      // 探測球沒打到（例如站在邊緣只有膠囊外緣接觸），以角色控制器的判定為準。
      this.groundDistance = 0;
      this.grounded = true;
      this.groundNormal.copy(UP);
    } else {
      this.groundDistance = hit ? hit.distance - PROBE_LIFT : Number.POSITIVE_INFINITY;
      this.grounded = false;
    }
    if (!this.grounded) {
      this.groundNormal.copy(UP);
      this.surface = null;
    }
  }

  private updateFootsteps(moved: number): void {
    if (!this.machine.is(MoveStateId.ground) || !this.grounded) return;
    const stride = this.config.footstepStride;
    this.footstepAccum += moved;
    if (stride > 0 && this.footstepAccum >= stride) {
      this.footstepAccum -= stride * Math.floor(this.footstepAccum / stride);
      this.evFootstep.surface = this.surface ?? 'metal';
      this.evFootstep.speed = horizontalSpeed(this.velocity);
      this.options.bus?.emit('player:footstep', this.evFootstep);
    }
  }

  private publishState(): void {
    const s = this.state;
    s.state = this.machine.currentId;
    s.grounded = this.grounded;
    s.eyeHeight = this.eyeHeight;
    s.crouchAmount = this.crouchAmount;
    s.crouched = this.crouchTarget;
    s.surface = this.surface;
    s.speed = horizontalSpeed(this.velocity);
  }

  private placeObject(alpha: number): void {
    const obj = this.options.object;
    if (!obj) return;
    this.eyePosition(alpha, this.rendered);
    obj.position.copy(this.rendered);
  }

  private ensureBody(): void {
    const physics = this.options.physics;
    if (this.collider && this.generation === physics.generation && !physics.isDisposed) return;
    // 舊世界已釋放（resetWorld 會一併釋放角色控制器），直接丟棄舊參考。
    this.collider = null;
    this.controller = null;
    const cfg = this.config;
    const hh = Math.max(0, this.height / 2 - cfg.radius);
    const world = physics.world;
    const desc = RAPIER.ColliderDesc.capsule(hh, cfg.radius)
      .setTranslation(this.position.x, this.position.y + hh + cfg.radius, this.position.z)
      .setCollisionGroups(COLLISION_PRESETS.player);
    this.collider = world.createCollider(desc);
    this.currentHalfHeight = hh;
    physics.markDirty();
    this.controller = world.createCharacterController(cfg.skinOffset);
    this.controller.setUp(UP);
    this.controller.setSlideEnabled(true);
    this.controller.setApplyImpulsesToDynamicBodies(false);
    this.generation = physics.generation;
  }

  private removeBody(): void {
    const physics = this.options.physics;
    if (this.collider && this.generation === physics.generation && !physics.isDisposed) {
      if (this.controller) physics.world.removeCharacterController(this.controller);
      physics.removeCollider(this.collider, this.generation);
    }
    this.collider = null;
    this.controller = null;
  }
}

