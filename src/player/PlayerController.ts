// 玩家控制器（M1-05；M1-06 加入跑牆、蹬牆跳、攀爬；M1-07 加入二段跳、噴射、Dash、抓鉤）：
// 膠囊體＋Rapier KinematicCharacterController＋可擴充的移動狀態機。
//
// 每個固定步（fixedUpdate → step）：
//   1. 讀 InputFrame：期望方向（依 yaw）、視線水平方向、蹲／跳／衝刺／開火／開鏡；更新跳躍緩衝。
//   2. 姿勢：蹲下／起身（膠囊高度在 crouchTransitionTime 內線性過渡，腳底固定；起身前 overlap 檢查頭頂空間）。
//      能力（abilitiesPreStep）：Dash 回充、抓鉤冷卻、鉤爪發射／飛行／收回。
//   3. 狀態機 'pre' 轉換 → 目前狀態 step（只改速度）。
//   4. 移動：期望位移 = 速度 × dt（重力以梯形積分修正）→ computeColliderMovement → 依實際碰撞法線投影速度
//      （只有「真的被擋住」的分量才移除：撞牆不累積速度、沿牆滑行；自動上台階不會被擋速）。
//      移動前的速度另存在 preMoveVelocity（跑牆／攀爬的進入條件與保留速度用）。
//   5. 地面探測：向下 shape cast（球），取得地面法線、距離與表面材質。
//   6. 牆面偵測（WallSensor）：空中掃描左右側牆；跑牆中追蹤目前的牆。攀爬的前方／邊緣偵測在轉換規則需要時才做。
//   7. 落地事件與空中能力重置 → 狀態機 'post' 轉換 → 能力（abilitiesPostStep：燃料回充、噴射事件、唯讀狀態）
//      → 腳步事件 → killVolume 重生。
// 速度自己維護（不用 Rapier 剛體）；切換狀態不硬性歸零速度（只有重生會歸零；跑牆進入與攀爬結束依計畫改寫速度）。
//
// 狀態與轉換規則：states.ts（地面、空中、滑鏟）、wallStates.ts（跑牆、攀爬）、abilityStates.ts（Dash、抓鉤，
// 以及 AirState 呼叫的二段跳與噴射）。能力計時器與唯讀狀態：Abilities.ts（player.abilities）。
// 狀態優先序（MovePriority，數字越大越優先；高優先的狀態不會被低優先的狀態打斷）：
//   Mantle 50 > Grapple 45 > Dash 40 > WallRun 30 > Slide 10 > Air／Ground 0
//   - 攀爬中不能 Dash、不能發射抓鉤；抓鉤附著可以打斷 Dash；Dash 可以打斷跑牆與滑鏟。
//   - Dash、抓鉤中正面有可攀邊緣 → 攀爬；同一步同時符合時，攀爬 > 抓鉤 > Dash。
// 空中能力重置：resetAirAbilities(reason)（著地、開始跑牆、抓鉤附著、重生）→ onAirReset 監聽者與 `player:airReset`；
// Abilities 監聽它重置二段跳次數（重生時另外補滿燃料、Dash 充能並清除抓鉤冷卻）。
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
import { angleToWallTangent, registerWallMovement, type WallRunEndReason } from '@/player/wallStates';
import { Abilities, type AbilityState } from '@/player/Abilities';
import {
  AbilityStateId,
  abilitiesPostStep,
  abilitiesPreStep,
  applyJet,
  registerAbilityMovement,
  tryDoubleJump,
  updateGrappleAim,
} from '@/player/abilityStates';
import { WallSensor, makeMantlePlan, type MantlePlan, type WallContact } from '@/player/WallSensor';

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
  /** 跑牆中牆在哪一側（相對行進方向）；不在跑牆時為 null（M1-08 鏡頭傾斜、M1-11 viewmodel 用）。 */
  wallRunSide: 'left' | 'right' | null;
  /** 跑牆中的牆面法線（水平、朝牆外）；不在跑牆時為零向量。 */
  readonly wallNormal: THREE.Vector3;
  /** 攀爬進度 0..1（不在攀爬時為 0）。 */
  mantleProgress: number;
  /** 能力的唯讀狀態（Dash 充能、噴射燃料、抓鉤冷卻與準星輔助；M1-14 HUD 用）。 */
  readonly abilities: Readonly<AbilityState>;
}

/** 空中能力重置的原因。 */
export type AirResetReason = 'land' | 'wallRun' | 'grapple' | 'respawn';

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
  /** 渲染時放到插值後眼睛位置的物件（選填；M1-08 起遊戲的相機改由 CameraRig 讀 PlayerState 定位，main 不再傳入）。 */
  object?: THREE.Object3D | null;
  /** 強制關閉切換模式的動作（抓鉤脫鉤或落空後關掉「切換」狀態，例如 input.builder.setToggle）。 */
  setToggle?: (action: 'grapple', on: boolean) => void;
  /** 每個渲染畫面的視角（準星輔助用，例如 input.view 的 viewYaw／viewPitch）；省略時用 InputFrame 的視角。 */
  getAim?: () => { yaw: number; pitch: number };
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
  /** 按住跳躍，與這次按住已經過的時間（s；按下的那一步為 0）。噴射用。 */
  jumpHeld: boolean;
  jumpHoldTime: number;
  dashPressed: boolean;
  grapplePressed: boolean;
  /** 抓鉤按住（切換模式時為切換狀態）。 */
  grappleHeld: boolean;
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
/** 進入跑牆：速度朝牆外的分量（單位方向與法線的內積）超過此值時不貼（正在離開這面牆）。 */
const WALL_RUN_MAX_AWAY = 0.17;
/** 同一面牆的判斷：同一個碰撞體且法線內積大於此值。 */
const SAME_WALL_MIN_DOT = 0.9;

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
    jumpHeld: false,
    jumpHoldTime: 0,
    dashPressed: false,
    grapplePressed: false,
    grappleHeld: false,
  };
  /** 這一步的視角（弧度）：抓鉤沿 (yaw, pitch) 發射。 */
  readonly look = { yaw: 0, pitch: 0 };
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

  // ── 跑牆／蹬牆跳／攀爬（M1-06）──
  readonly walls: WallSensor;
  /** 本步移動（碰撞投影）前的速度。 */
  readonly preMoveVelocity = new THREE.Vector3();
  /** 視線的水平方向（單位向量）。 */
  readonly forward = { x: 0, z: -1 };
  /** 累計模擬時間（s）。 */
  simTime = 0;
  /** 跑牆中的牆面法線（水平、朝牆外）與碰撞體 handle。 */
  readonly wallNormal = new THREE.Vector3();
  /** 開始跑牆時的牆面法線（追蹤時限制總轉角，不會繞過牆端）。 */
  readonly wallStartNormal = new THREE.Vector3();
  wallHandle = -1;
  /** 跑牆中牆在哪一側（相對進入時的行進方向）。 */
  wallSide: 'left' | 'right' | null = null;
  /** 這次跑牆經過的時間（s）。 */
  wallRunTime = 0;
  /** 這一步追蹤牆面是否成功（跑牆中）。 */
  wallTracked = false;
  /** 這一步是否蹬牆跳。 */
  wallJumpedThisStep = false;
  /** checkWallRunEnd() 判定的結束原因（WallRun.exit 讀取）。 */
  wallRunEndReason: WallRunEndReason | null = null;
  /** findLedge 的結果（canMantle 成功時有效）。 */
  readonly mantlePlan: MantlePlan = makeMantlePlan();
  /** 進行中的攀爬。 */
  readonly mantle = {
    start: new THREE.Vector3(),
    target: new THREE.Vector3(),
    dir: new THREE.Vector3(0, 0, -1),
    height: 0,
    duration: 0,
    time: 0,
    done: false,
    /** 進入前的水平速度（結束時依比例保留）。 */
    entrySpeed: 0,
  };
  /** canWallRun() 選出的牆（WallRun.enter 使用）。 */
  private wallCandidate: WallContact | null = null;
  /** 最近離開的牆（同牆重貼冷卻；著地後清除）。 */
  private lastWallHandle = -1;
  private readonly lastWallNormal = new THREE.Vector3();
  private lastWallLeftAt = Number.NEGATIVE_INFINITY;
  /** 離牆後的蹬牆跳寬限（到這個模擬時間為止）與當時的牆面法線。 */
  private wallJumpGraceUntil = Number.NEGATIVE_INFINITY;
  private readonly graceNormal = new THREE.Vector3();
  private readonly airResetListeners = new Set<(reason: AirResetReason) => void>();

  // ── 能力（M1-07）──
  /** 二段跳、噴射、Dash、抓鉤的計時器、鉤爪、修正介面與唯讀狀態。 */
  readonly abilities: Abilities;

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
  private readonly aimOrigin = new THREE.Vector3();
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
  private readonly evWallRunStart: { side: 'left' | 'right'; normal: { x: number; y: number; z: number } } = {
    side: 'left',
    normal: { x: 0, y: 0, z: 0 },
  };
  private readonly evWallRunEnd = { reason: '', duration: 0 };
  private readonly evWallJump = { normal: { x: 0, y: 0, z: 0 }, speed: 0, grace: false };
  private readonly evMantle = { height: 0, duration: 0, fromState: '' };
  private readonly evAirReset: { reason: AirResetReason } = { reason: 'land' };

  constructor(options: PlayerControllerOptions) {
    this.options = options;
    this.config = options.config ?? MOVEMENT_CONFIG;
    this.jumpBuffer = new InputBuffer(() => this.config.jumpBufferTime);
    this.abilities = new Abilities(this.config);
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
      wallRunSide: null,
      wallNormal: new THREE.Vector3(),
      mantleProgress: 0,
      abilities: this.abilities.state,
    };
    this.walls = new WallSensor(options.physics, this);
    this.machine = new StateMachine<PlayerController>(this, (from, to) => {
      this.evState.from = from;
      this.evState.to = to;
      this.state.state = to;
      this.options.bus?.emit('player:state', this.evState);
    });
    registerCoreMovement(this.machine);
    registerWallMovement(this.machine);
    registerAbilityMovement(this.machine);
    this.machine.set(MoveStateId.air);
    this.onAirReset((reason) => {
      if (reason === 'respawn') this.abilities.refillAll();
      else this.abilities.resetDoubleJumps();
    });
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
    // 先離開目前狀態（Dash 結束、脫鉤等的 exit 可能改寫速度），再歸零速度。
    this.machine.set(MoveStateId.air, true);
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
    this.clearWallState();
    this.resetAirAbilities('respawn');
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
    // 準星輔助（每畫面）：從插值後的眼睛沿目前視角做 raycast。
    const aim = this.options.getAim?.() ?? this.look;
    this.eyePosition(alpha, this.aimOrigin);
    updateGrappleAim(this, this.aimOrigin, aim.yaw, aim.pitch);
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
    this.wallJumpedThisStep = false;
    this.gravityThisStep = 0;
    this.slideBoostTimer += dt;
    this.simTime += dt;
    this.walls.log.clear();

    this.readInput(dt);
    this.updatePosture(dt);
    abilitiesPreStep(this, dt);
    this.machine.evaluate('pre');
    this.machine.step(dt);
    const wasGrounded = this.grounded;
    const fallSpeed = Math.max(0, -this.velocity.y);
    this.preMoveVelocity.copy(this.velocity);
    const moved = this.move(dt);
    this.probeGround();
    this.updateWallSensing();
    if (this.grounded && !wasGrounded) {
      // 攀爬結束時站上邊緣不算落地（不發落地事件，攀爬有自己的事件）。
      if (!this.machine.is(MoveStateId.mantle)) {
        this.evLand.impactSpeed = fallSpeed;
        this.evLand.surface = this.surface ?? 'metal';
        this.options.bus?.emit('player:land', this.evLand);
      }
      // 落地時腳步計數從半步開始（落地後很快就有第一步）。
      this.footstepAccum = this.config.footstepStride * 0.5;
      // 著地：同牆重貼冷卻與蹬牆跳寬限重置，空中能力重置。
      this.lastWallHandle = -1;
      this.wallJumpGraceUntil = Number.NEGATIVE_INFINITY;
      this.resetAirAbilities('land');
    }
    this.machine.evaluate('post');
    abilitiesPostStep(this, dt);
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
    this.abilities.jetArmed = false;
    this.evJump.fromState = this.machine.currentId;
    this.evJump.coyote = coyote;
    this.options.bus?.emit('player:jump', this.evJump);
    return true;
  }

  /**
   * 套用重力（半隱式＋梯形位移修正，跳躍高度與步長無關）並限制最大下落速度。
   * g 省略時為玩家重力；跑牆傳入依曲線計算的重力。
   */
  applyGravity(dt: number, g: number = this.config.gravity): void {
    this.velocity.y = Math.max(this.velocity.y - g * dt, -this.config.maxFallSpeed);
    this.gravityThisStep = g;
  }

  /**
   * 額外的垂直加速度（噴射推力；在 applyGravity 之後呼叫）：改變垂直速度，並一併修正梯形積分用的本步加速度。
   */
  applyVerticalAcceleration(a: number, dt: number): void {
    this.velocity.y += a * dt;
    this.gravityThisStep -= a;
  }

  /** 腳底下方 distance 公尺內是否有可站立的面（二段跳的落地保護用）。 */
  groundWithin(distance: number): boolean {
    const hit = this.castGround(distance);
    if (!hit || hit.normal.y < Math.cos(this.config.maxSlopeClimbDeg * DEG2RAD)) return false;
    return hit.distance - PROBE_LIFT <= distance;
  }

  /** 目前（這一步）的眼睛位置。 */
  eyeNow(out: THREE.Vector3): THREE.Vector3 {
    return out.set(this.position.x, this.position.y + this.eyeHeight, this.position.z);
  }

  /** 物理世界（能力的 raycast 用）。 */
  get physics(): Physics {
    return this.options.physics;
  }

  /** 發出遊戲事件（能力模組使用；沒有 bus 時不動作）。 */
  emit<K extends keyof GameEvents>(name: K, payload: GameEvents[K]): void {
    this.options.bus?.emit(name, payload);
  }

  /** 空中：二段跳（AirState 在土狼起跳與蹬牆跳寬限之後呼叫）。 */
  tryDoubleJump(): boolean {
    return tryDoubleJump(this);
  }

  /** 空中：噴射推進（AirState 在重力之後呼叫）。 */
  applyJet(dt: number): void {
    applyJet(this, dt);
  }

  /** 準星輔助：從 origin 沿 (yaw, pitch) 檢查有沒有可勾的表面（預設用這一步的眼睛與視角）。 */
  updateGrappleAim(origin?: Readonly<THREE.Vector3>, yaw = this.look.yaw, pitch = this.look.pitch): boolean {
    return updateGrappleAim(this, origin ?? this.eyeNow(this.aimOrigin), yaw, pitch);
  }

  /** 抓鉤結束（脫鉤、落空）後關掉「切換模式」的抓鉤狀態，下次按 F 才會重新發射。 */
  releaseGrappleToggle(): void {
    this.options.setToggle?.('grapple', false);
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
    return this.standingCapsuleFits(this.position.x, this.position.y, this.position.z);
  }

  /** 站姿膠囊（半徑內縮、底部抬高少許）放在腳底 (x, feetY, z) 時是否不與世界重疊。 */
  standingCapsuleFits(x: number, feetY: number, z: number): boolean {
    const cfg = this.config;
    const r = Math.max(0.01, cfg.radius - HEADROOM_SHRINK);
    const hh = Math.max(0, cfg.standHeight / 2 - cfg.radius);
    const key = `${hh}:${r}`;
    if (!this.headroomShape || this.headroomKey !== key) {
      this.headroomShape = new RAPIER.Capsule(hh, r);
      this.headroomKey = key;
    }
    _center.x = x;
    _center.y = feetY + HEADROOM_LIFT + HEADROOM_SHRINK + hh + r;
    _center.z = z;
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

  // ── 空中能力重置（M1-06；跑牆、著地、抓鉤共用）─────────

  /** 監聽空中能力重置（M1-07 的二段跳次數、噴射燃料）；回傳取消函式。 */
  onAirReset(listener: (reason: AirResetReason) => void): () => void {
    this.airResetListeners.add(listener);
    return () => this.airResetListeners.delete(listener);
  }

  /** 重置空中能力：通知監聽者並發出 `player:airReset`。 */
  resetAirAbilities(reason: AirResetReason): void {
    for (const l of this.airResetListeners) l(reason);
    this.evAirReset.reason = reason;
    this.options.bus?.emit('player:airReset', this.evAirReset);
  }

  // ── 跑牆／蹬牆跳（M1-06）────────────────────────────────

  /**
   * 進入跑牆的條件（空中、post 階段）：按住前進、沒按蹲；移動前的水平速度 ≥ wallRunMinSpeed；
   * 側面有可跑的牆，速度方向與牆面切線夾角 < wallRunMaxAngleDeg 且沒有正在離開這面牆；
   * 不是 wallRunSameWallCooldown 內剛離開的同一面牆；離地 ≥ wallRunMinHeight。
   */
  canWallRun(): boolean {
    const cfg = this.config;
    const inp = this.input;
    if (this.grounded || inp.moveY <= 0 || inp.crouchHeld) return false;
    const pv = this.preMoveVelocity;
    const hs = Math.hypot(pv.x, pv.z);
    if (hs < cfg.wallRunMinSpeed || hs < 1e-6) return false;
    const dx = pv.x / hs;
    const dz = pv.z / hs;
    const { left, right } = this.walls;
    const okLeft = this.wallUsable(left, dx, dz);
    const okRight = this.wallUsable(right, dx, dz);
    let best: WallContact | null = null;
    if (okLeft && okRight) best = left.distance <= right.distance ? left : right;
    else if (okLeft) best = left;
    else if (okRight) best = right;
    if (!best) return false;
    if (cfg.wallRunMinHeight > 0) {
      const hit = this.castGround(cfg.wallRunMinHeight);
      if (hit && hit.distance - PROBE_LIFT < cfg.wallRunMinHeight) return false;
    }
    this.wallCandidate = best;
    return true;
  }

  private wallUsable(w: WallContact, dx: number, dz: number): boolean {
    if (!w.found || !w.runnable) return false;
    const n = w.normal;
    if (dx * n.x + dz * n.z > WALL_RUN_MAX_AWAY) return false;
    if (angleToWallTangent(dx, dz, n.x, n.z) >= this.config.wallRunMaxAngleDeg * DEG2RAD) return false;
    return !this.isRecentWall(w.handle, n);
  }

  /** 是否為 wallRunSameWallCooldown 內剛離開的同一面牆（著地後清除）。 */
  isRecentWall(handle: number, normal: Readonly<THREE.Vector3>): boolean {
    if (handle !== this.lastWallHandle) return false;
    if (normal.dot(this.lastWallNormal) <= SAME_WALL_MIN_DOT) return false;
    return this.simTime - this.lastWallLeftAt < this.config.wallRunSameWallCooldown - 1e-9;
  }

  /** WallRun.enter：速度投影到牆面切線（至少 wallRunEntrySpeed）、限制垂直速度、重置空中能力。 */
  beginWallRun(): void {
    const cfg = this.config;
    const w = this.wallCandidate ?? (this.walls.left.runnable ? this.walls.left : this.walls.right);
    const n = this.wallNormal.copy(w.normal);
    this.wallStartNormal.copy(n);
    this.wallHandle = w.handle;
    this.wallTracked = true;
    this.wallCandidate = null;
    const pv = this.preMoveVelocity;
    const v = this.velocity;
    let hx = pv.x;
    let hz = pv.z;
    if (Math.hypot(hx, hz) < 1e-6) {
      hx = this.forward.x;
      hz = this.forward.z;
    }
    // 牆在行進方向的哪一側：右 = (−dz, dx)，牆的方向 = −n。
    this.wallSide = -n.x * -hz + -n.z * hx > 0 ? 'right' : 'left';
    const vn = hx * n.x + hz * n.z;
    let tx = hx - n.x * vn;
    let tz = hz - n.z * vn;
    const along = Math.hypot(tx, tz);
    if (along < 1e-6) {
      // 正面撞牆（夾角條件應已排除）：改用視線方向的切線。
      const fn = this.forward.x * n.x + this.forward.z * n.z;
      tx = this.forward.x - n.x * fn;
      tz = this.forward.z - n.z * fn;
    }
    const tl = Math.max(1e-6, Math.hypot(tx, tz));
    const speed = Math.max(along, cfg.wallRunEntrySpeed);
    v.x = (tx / tl) * speed;
    v.z = (tz / tl) * speed;
    v.y = Math.min(cfg.wallRunMaxRiseSpeed, Math.max(-cfg.wallRunMaxEntryFallSpeed, v.y));
    this.wallRunTime = 0;
    this.wallRunEndReason = null;
    this.wallJumpGraceUntil = Number.NEGATIVE_INFINITY;
    this.coyoteAvailable = false;
    const ev = this.evWallRunStart;
    ev.side = this.wallSide;
    ev.normal.x = n.x;
    ev.normal.y = n.y;
    ev.normal.z = n.z;
    this.options.bus?.emit('player:wallRunStart', ev);
    this.resetAirAbilities('wallRun');
  }

  /** 跑牆是否該結束（post 階段）；回傳原因並記錄在 wallRunEndReason。 */
  checkWallRunEnd(): WallRunEndReason | null {
    const cfg = this.config;
    const inp = this.input;
    let r: WallRunEndReason | null = null;
    if (this.wallJumpedThisStep) r = 'jump';
    else if (inp.crouchHeld) r = 'crouch';
    else if (inp.moveY <= 0) r = 'released';
    else if (!this.wallTracked) r = 'wallEnded';
    else if (horizontalSpeed(this.velocity) < cfg.wallRunEndSpeed) r = 'slow';
    else if (this.wallRunTime >= cfg.wallRunMaxTime - 1e-9) r = 'timeout';
    this.wallRunEndReason = r;
    return r;
  }

  /** WallRun.exit：發出事件、記住離開的牆（同牆重貼冷卻）；grace 時開始蹬牆跳寬限。 */
  endWallRun(reason: WallRunEndReason, grace: boolean): void {
    const cfg = this.config;
    this.evWallRunEnd.reason = reason;
    this.evWallRunEnd.duration = this.wallRunTime;
    this.options.bus?.emit('player:wallRunEnd', this.evWallRunEnd);
    this.lastWallHandle = this.wallHandle;
    this.lastWallNormal.copy(this.wallNormal);
    this.lastWallLeftAt = this.simTime;
    if (grace && cfg.wallJumpGraceTime > 0) {
      this.wallJumpGraceUntil = this.simTime + cfg.wallJumpGraceTime;
      this.graceNormal.copy(this.wallNormal);
    }
    this.wallSide = null;
    this.wallRunEndReason = null;
  }

  /**
   * 蹬牆跳：速度 = 沿牆分量 × wallJumpAlongScale ＋ 牆面法線 × wallJumpNormalSpeed ＋ 上方 × wallJumpUpSpeed；
   * 視線離開牆面（視線與法線同向）時，水平方向再往視線偏轉（權重 wallJumpLookInfluence × 離開程度），水平速率不變。
   */
  wallJump(normal: Readonly<THREE.Vector3>, grace: boolean): void {
    const cfg = this.config;
    const v = this.velocity;
    const nx = normal.x;
    const nz = normal.z;
    const vn = v.x * nx + v.z * nz;
    let hx = (v.x - nx * vn) * cfg.wallJumpAlongScale + nx * cfg.wallJumpNormalSpeed;
    let hz = (v.z - nz * vn) * cfg.wallJumpAlongScale + nz * cfg.wallJumpNormalSpeed;
    const hl = Math.hypot(hx, hz);
    const look = this.forward.x * nx + this.forward.z * nz;
    const w = Math.min(1, Math.max(0, cfg.wallJumpLookInfluence)) * Math.max(0, look);
    if (w > 0 && hl > 1e-6) {
      const dx = (hx / hl) * (1 - w) + this.forward.x * w;
      const dz = (hz / hl) * (1 - w) + this.forward.z * w;
      const dl = Math.hypot(dx, dz);
      if (dl > 1e-6) {
        hx = (dx / dl) * hl;
        hz = (dz / dl) * hl;
      }
    }
    v.set(hx, cfg.wallJumpUpSpeed, hz);
    this.jumpedThisStep = true;
    this.wallJumpedThisStep = true;
    this.grounded = false;
    this.coyoteAvailable = false;
    this.wallJumpGraceUntil = Number.NEGATIVE_INFINITY;
    this.lastWallLeftAt = this.simTime;
    const ev = this.evWallJump;
    ev.normal.x = nx;
    ev.normal.y = 0;
    ev.normal.z = nz;
    ev.speed = hl;
    ev.grace = grace;
    this.options.bus?.emit('player:wallJump', ev);
  }

  /** 空中：跑牆剛結束的寬限時間內按跳 → 蹬牆跳（AirState 呼叫）。 */
  tryWallJumpGrace(): boolean {
    if (this.simTime > this.wallJumpGraceUntil + 1e-9) return false;
    if (!this.jumpBuffer.consume()) return false;
    this.wallJump(this.graceNormal, true);
    return true;
  }

  // ── 攀爬（M1-06）──────────────────────────────────────

  /**
   * 是否可以攀爬：fromGround（pre 階段，地面或滑鏟中按跳）只要著地；
   * 空中（post 階段）要按住前進、未著地、上升速度 < mantleMaxRiseSpeed。
   * 之後由 WallSensor.findLedge 檢查正面牆與邊緣；成功時 mantlePlan 有效。
   */
  canMantle(fromGround: boolean): boolean {
    const cfg = this.config;
    if (cfg.mantleDuration <= 0) return false;
    if (fromGround) {
      if (!this.grounded) return false;
    } else if (this.grounded || this.input.moveY <= 0 || this.velocity.y >= cfg.mantleMaxRiseSpeed) return false;
    return this.walls.findLedge(this.forward.x, this.forward.z, this.mantlePlan);
  }

  /** Mantle.enter：記錄路徑與進入前水平速度；從地面觸發時消耗跳躍緩衝。 */
  beginMantle(prev: string | null): void {
    const cfg = this.config;
    const m = this.mantle;
    const plan = this.mantlePlan;
    m.start.copy(this.position);
    m.target.copy(plan.target);
    m.dir.copy(plan.dir);
    m.height = plan.height;
    m.duration = cfg.mantleDuration;
    m.time = 0;
    m.done = false;
    // Dash／抓鉤打斷時，以離開該狀態後的速度（Dash 結束速度、抓鉤當下速度）為準，不用 Dash 期間的位移速度。
    m.entrySpeed =
      prev === AbilityStateId.dash || prev === AbilityStateId.grapple
        ? horizontalSpeed(this.velocity)
        : Math.max(horizontalSpeed(this.preMoveVelocity), horizontalSpeed(this.velocity));
    if (prev === MoveStateId.ground || prev === MoveStateId.slide) this.jumpBuffer.consume();
    this.coyoteAvailable = false;
    const ev = this.evMantle;
    ev.height = m.height;
    ev.duration = m.duration;
    ev.fromState = prev ?? '';
    this.options.bus?.emit('player:mantle', ev);
  }

  /** Mantle.exit：動作完成時，水平速度 = 進入前 × mantleExitSpeedKeep（至少 mantleExitMinSpeed）向前；被打斷時不改速度。 */
  endMantle(): void {
    const m = this.mantle;
    if (!m.done) return;
    const cfg = this.config;
    const speed = Math.max(m.entrySpeed * cfg.mantleExitSpeedKeep, cfg.mantleExitMinSpeed);
    this.velocity.set(m.dir.x * speed, 0, m.dir.z * speed);
  }

  /**
   * 空中撞到牆（速度被投影）時：撞擊方向與牆面切線的夾角 ≥ wallRunMaxAngleDeg，就把這面牆當成「剛離開的牆」，
   * 同牆重貼冷卻內不會因為投影後剩下的沿牆速度而進入跑牆（大角度撞牆不跑牆）。
   */
  private noteWallImpact(handle: number, n: Readonly<Vec3Like>): void {
    const cfg = this.config;
    if (handle < 0 || Math.abs(n.y) >= cfg.wallMaxNormalY) return;
    const hl = Math.hypot(n.x, n.z);
    const v = this.preMoveVelocity;
    const hs = Math.hypot(v.x, v.z);
    if (hl < 1e-6 || hs < 1e-6) return;
    const nx = n.x / hl;
    const nz = n.z / hl;
    if (angleToWallTangent(v.x / hs, v.z / hs, nx, nz) < cfg.wallRunMaxAngleDeg * DEG2RAD) return;
    this.lastWallHandle = handle;
    this.lastWallNormal.set(nx, 0, nz);
    this.lastWallLeftAt = this.simTime;
  }

  /** 傳送後清除跑牆／攀爬的狀態與記憶。 */
  private clearWallState(): void {
    this.wallSide = null;
    this.wallRunTime = 0;
    this.wallTracked = false;
    this.wallRunEndReason = null;
    this.wallCandidate = null;
    this.lastWallHandle = -1;
    this.lastWallLeftAt = Number.NEGATIVE_INFINITY;
    this.wallJumpGraceUntil = Number.NEGATIVE_INFINITY;
    this.mantle.done = false;
    this.mantle.time = 0;
    this.walls.clearSides();
  }

  /** 移動後的牆面偵測：空中掃描左右側牆；跑牆中追蹤目前的牆。 */
  private updateWallSensing(): void {
    const id = this.machine.currentId;
    if (id === MoveStateId.air && !this.grounded) {
      this.walls.scanSides(this.preMoveVelocity.x, this.preMoveVelocity.z);
    } else this.walls.clearSides();
    if (id === MoveStateId.wallRun && !this.wallJumpedThisStep) {
      this.wallTracked = this.walls.track(this.wallNormal, this.wallStartNormal);
      if (this.wallTracked) {
        this.wallNormal.copy(this.walls.tracked.normal);
        this.wallHandle = this.walls.tracked.handle;
      }
    }
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
    inp.jumpHeld = isHeld(f, 'jump');
    if (inp.jumpPressed) inp.jumpHoldTime = 0;
    else if (inp.jumpHeld) inp.jumpHoldTime += dt;
    else inp.jumpHoldTime = 0;
    inp.dashPressed = wasPressed(f, 'dash');
    inp.grapplePressed = wasPressed(f, 'grapple');
    inp.grappleHeld = isHeld(f, 'grapple');
    this.look.yaw = f.yaw;
    this.look.pitch = f.pitch;
    this.jumpBuffer.updateFrom(dt, f, 'jump');
    this.forward.x = -Math.sin(f.yaw);
    this.forward.z = -Math.cos(f.yaw);
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
    // 地面移動（自動上台階、貼地、忽略可站立的面）：地面、滑鏟、從地面開始且仍貼地的 Dash。
    const groundDash = this.machine.is(AbilityStateId.dash) && this.abilities.dashRun.onGround;
    const onGround = (this.machine.is(MoveStateId.ground) || this.machine.is(MoveStateId.slide) || groundDash) && v.y <= 0;
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
    const inAir = this.machine.is(MoveStateId.air);
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
      if (intoDesired - intoActual > BLOCK_EPS) {
        if (inAir) this.noteWallImpact(c.collider?.handle ?? -1, n);
        clipVelocity(v, n.x, n.y, n.z);
      }
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
    const wallRunning = this.machine.is(MoveStateId.wallRun);
    s.wallRunSide = wallRunning ? this.wallSide : null;
    if (wallRunning) s.wallNormal.copy(this.wallNormal);
    else s.wallNormal.set(0, 0, 0);
    const m = this.mantle;
    s.mantleProgress = this.machine.is(MoveStateId.mantle) ? Math.min(1, m.time / Math.max(1e-3, m.duration)) : 0;
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

