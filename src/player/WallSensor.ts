// 牆面偵測（M1-06）：給跑牆用的側面牆偵測、跑牆中的牆面追蹤，以及給攀爬用的前方牆與邊緣偵測。
//
// - 側面：在空中時，每步往左右（相對水平速度方向）從膠囊中心做水平 shape cast（小球），
//   偵測「膠囊半徑 + wallDetectExtra」以內的牆。可跑牆 = |n.y| < wallMaxNormalY 且表面旗標 wallRunnable。
// - 追蹤：跑牆中朝目前牆面（−法線方向）做同樣的偵測；偵測不到或法線差太多就是「牆面結束」。
// - 前方／邊緣：沿視線水平方向掃掠縮小的膠囊（膠囊表面往前 mantleReach），打到接近垂直的牆後，
//   在牆後方從上往下 raycast 找邊緣頂面，再檢查高度、坡度、頂面放得下站姿膠囊與上升／前進路徑沒有阻擋。
// - 除錯：ProbeLog 記錄這一步的偵測射線與結果（調參面板「移動/除錯顯示」開啟時才記錄）。
//
// 查詢一律只打靜態世界（QueryMask.world），排除玩家自己的膠囊與 sensor。
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { DEG2RAD } from '@/core/math';
import { QueryMask } from '@/physics/groups';
import type { Physics, Vec3Like } from '@/physics/Physics';
import type { MovementConfig } from '@/player/MovementConfig';

/** 偵測結果種類（除錯顯示的顏色）。 */
export const ProbeKind = {
  /** 沒打到。 */
  miss: 0,
  /** 打到且符合條件（可跑牆的牆、可攀的邊緣）。 */
  valid: 1,
  /** 打到但不符合條件。 */
  invalid: 2,
  /** 攀爬目標位置。 */
  target: 3,
} as const;
export type ProbeKindValue = (typeof ProbeKind)[keyof typeof ProbeKind];

const PROBE_LOG_CAPACITY = 24;
const PROBE_STRIDE = 7;

/** 這一步的偵測線段（from → to、種類）；固定容量、重複使用。 */
export class ProbeLog {
  /** 開啟時才記錄（除錯顯示）。 */
  enabled = false;
  count = 0;
  readonly data = new Float32Array(PROBE_LOG_CAPACITY * PROBE_STRIDE);
  /** 每次有新紀錄就加一（除錯顯示判斷要不要重建線段）。 */
  revision = 0;

  static get capacity(): number {
    return PROBE_LOG_CAPACITY;
  }

  clear(): void {
    if (this.count > 0) this.revision++;
    this.count = 0;
  }

  push(from: Readonly<Vec3Like>, tx: number, ty: number, tz: number, kind: ProbeKindValue): void {
    if (!this.enabled || this.count >= PROBE_LOG_CAPACITY) return;
    const o = this.count * PROBE_STRIDE;
    const d = this.data;
    d[o] = from.x;
    d[o + 1] = from.y;
    d[o + 2] = from.z;
    d[o + 3] = tx;
    d[o + 4] = ty;
    d[o + 5] = tz;
    d[o + 6] = kind;
    this.count++;
    this.revision++;
  }
}

/** 一次牆面偵測的結果（重複使用）。 */
export interface WallContact {
  found: boolean;
  /** 可以跑牆：接近垂直且表面旗標 wallRunnable。 */
  runnable: boolean;
  /** 碰撞體 handle（同一面牆的判斷）。 */
  handle: number;
  /** 牆面法線的水平部分（正規化、朝牆外）。 */
  readonly normal: THREE.Vector3;
  /** 原始法線的 y 分量。 */
  normalY: number;
  /** 命中點（牆面上）。 */
  readonly point: THREE.Vector3;
  /** 膠囊軸線到牆面的距離（m；可跑牆時為垂直距離，否則為沿偵測方向的距離）。 */
  distance: number;
}

function makeContact(): WallContact {
  return {
    found: false,
    runnable: false,
    handle: -1,
    normal: new THREE.Vector3(),
    normalY: 0,
    point: new THREE.Vector3(),
    distance: Number.POSITIVE_INFINITY,
  };
}

/** 攀爬計畫：findLedge() 成功時填入。 */
export interface MantlePlan {
  /** 目標腳底位置（邊緣頂面上）。 */
  readonly target: THREE.Vector3;
  /** 攀爬方向（水平單位向量；結束時的前進方向）。 */
  readonly dir: THREE.Vector3;
  /** 邊緣高度（腳底以上，m）。 */
  height: number;
  /** 牆面法線（水平）。 */
  readonly wallNormal: THREE.Vector3;
}

export function makeMantlePlan(): MantlePlan {
  return { target: new THREE.Vector3(), dir: new THREE.Vector3(), height: 0, wallNormal: new THREE.Vector3() };
}

/** 偵測需要的玩家資料。 */
export interface WallSensorHost {
  readonly config: MovementConfig;
  /** 腳底位置。 */
  readonly position: THREE.Vector3;
  /** 目前膠囊總高。 */
  readonly height: number;
  readonly capsule: RAPIER.Collider | null;
  /** 站姿膠囊放在腳底 (x, feetY, z) 是否不與世界重疊。 */
  standingCapsuleFits(x: number, feetY: number, z: number): boolean;
}

/** 側面偵測球的半徑（× 膠囊半徑）。 */
const SIDE_PROBE_RADIUS_RATIO = 0.6;
/** 側面偵測：法線與偵測方向至少要這麼「迎面」（−n·dir），否則視為沒打到正面。 */
const SIDE_MIN_FACING = 0.3;
/** 牆面確認射線：比偵測距離多打的距離，與要求的法線一致度。 */
const FACE_RAY_EXTRA = 0.05;
const FACE_CONFIRM_DOT = 0.95;
/** 跑牆追蹤：每步與整次跑牆允許的牆面法線轉角（度）。 */
const TRACK_MAX_STEP_TURN_DEG = 15;
const TRACK_MAX_TOTAL_TURN_DEG = 35;
/** 前方偵測膠囊的半徑內縮與抬高（不打到腳下地面、不因間隙重疊）。 */
const FRONT_SHRINK = 0.05;
const FRONT_LIFT = 0.06;
/** 前方牆：法線的水平部分至少要有這麼長（排除地面、天花板）。 */
const FRONT_MIN_HORIZONTAL = 0.7;
/** 邊緣探測點在牆面後方的深度（m）。 */
const LEDGE_PROBE_DEPTH = 0.2;
/** 邊緣 raycast 起點在邊緣高度上限之上多少（m）。 */
const LEDGE_RAY_ABOVE = 0.3;
/** 站上邊緣後，膠囊與牆面邊緣的額外距離（m）。 */
const MANTLE_INSET_MARGIN = 0.12;
/** 目標點頂面與邊緣頂面的高度差上限（m）：太窄或高低不平的邊緣不攀。 */
const MANTLE_TOP_TOLERANCE = 0.25;
/** 攀爬路徑檢查的膠囊半徑內縮（m）。 */
const PATH_SHRINK = 0.03;
/** 攀爬上升時腳底高出邊緣頂面的距離（m），前進段從這個高度越過邊緣。 */
export const MANTLE_CLEARANCE = 0.04;

const _from = { x: 0, y: 0, z: 0 };
const _dir = { x: 0, y: 0, z: 0 };
const _down = { x: 0, y: -1, z: 0 };
const _up = { x: 0, y: 1, z: 0 };

export class WallSensor {
  /** 相對速度方向的左側、右側偵測結果（scanSides 更新）。 */
  readonly left: WallContact = makeContact();
  readonly right: WallContact = makeContact();
  /** 跑牆中的牆面追蹤結果（track 更新）。 */
  readonly tracked: WallContact = makeContact();
  /** 前方牆的偵測結果（findLedge 更新）。 */
  readonly front: WallContact = makeContact();
  readonly log = new ProbeLog();

  private ball: RAPIER.Ball | null = null;
  private ballRadius = 0;
  /** 前方偵測與路徑檢查各用一個膠囊形狀（尺寸不同，分開快取）。 */
  private readonly capsules: { shape: RAPIER.Capsule | null; key: string }[] = [
    { shape: null, key: '' },
    { shape: null, key: '' },
  ];

  constructor(
    private readonly physics: Physics,
    private readonly host: WallSensorHost,
  ) {}

  /** 清除側面結果（不在空中時）。 */
  clearSides(): void {
    this.left.found = false;
    this.left.runnable = false;
    this.right.found = false;
    this.right.runnable = false;
  }

  /** 往速度方向 (velX, velZ) 的左右各偵測一次。速度太小時清除結果。 */
  scanSides(velX: number, velZ: number): void {
    const len = Math.hypot(velX, velZ);
    if (len < 1e-3) {
      this.clearSides();
      return;
    }
    const dx = velX / len;
    const dz = velZ / len;
    // 右 = forward × up = (−dz, 0, dx)；左 = (dz, 0, −dx)。
    this.castWall(-dz, dx, this.right);
    this.castWall(dz, -dx, this.left);
  }

  /**
   * 跑牆中追蹤目前的牆（朝 −normal 偵測）；回傳是否仍有可跑的牆，結果在 tracked。
   * 法線與上一步相差超過 TRACK_MAX_STEP_TURN_DEG、或與開始跑牆時相差超過 TRACK_MAX_TOTAL_TURN_DEG 都算牆面結束。
   */
  track(normal: Readonly<Vec3Like>, startNormal: Readonly<Vec3Like> = normal): boolean {
    const t = this.tracked;
    this.castWall(-normal.x, -normal.z, t);
    if (!t.found || !t.runnable) return false;
    if (t.normal.x * normal.x + t.normal.z * normal.z < Math.cos(TRACK_MAX_STEP_TURN_DEG * DEG2RAD)) return false;
    return t.normal.x * startNormal.x + t.normal.z * startNormal.z >= Math.cos(TRACK_MAX_TOTAL_TURN_DEG * DEG2RAD);
  }

  /**
   * 從膠囊中心沿水平方向 (dirX, dirZ)（單位向量）偵測「半徑 + wallDetectExtra」以內的牆。
   * 回傳是否打到（out.found）。
   */
  castWall(dirX: number, dirZ: number, out: WallContact): boolean {
    const cfg = this.host.config;
    const rb = cfg.radius * SIDE_PROBE_RADIUS_RATIO;
    if (!this.ball || Math.abs(this.ballRadius - rb) > 1e-9) {
      this.ball = new RAPIER.Ball(rb);
      this.ballRadius = rb;
    }
    const p = this.host.position;
    _from.x = p.x;
    _from.y = p.y + this.host.height / 2;
    _from.z = p.z;
    _dir.x = dirX;
    _dir.y = 0;
    _dir.z = dirZ;
    const reach = cfg.radius + cfg.wallDetectExtra;
    const hit = this.physics.shapeCast(this.ball, _from, _dir, Math.max(0, reach - rb), QueryMask.world, undefined, this.host.capsule, true);
    out.found = false;
    out.runnable = false;
    out.handle = -1;
    out.distance = Number.POSITIVE_INFINITY;
    if (!hit) {
      this.log.push(_from, _from.x + dirX * reach, _from.y, _from.z + dirZ * reach, ProbeKind.miss);
      return false;
    }
    const n = hit.normal;
    const hl = Math.hypot(n.x, n.z);
    const facing = hl > 1e-6 ? -(n.x * dirX + n.z * dirZ) / hl : 0;
    if (hl < 1e-6 || facing < SIDE_MIN_FACING) {
      this.log.push(_from, hit.point.x, hit.point.y, hit.point.z, ProbeKind.invalid);
      return false;
    }
    out.found = true;
    out.handle = hit.collider.handle;
    out.normal.set(n.x / hl, 0, n.z / hl);
    out.normalY = n.y;
    out.point.set(hit.point.x, hit.point.y, hit.point.z);
    out.distance = hit.distance + rb;
    out.runnable = Math.abs(n.y) < cfg.wallMaxNormalY && (hit.surface?.wallRunnable ?? false);
    if (out.runnable) {
      // 確認是牆「面」而不是邊角：從膠囊中心沿 −法線打射線，要打到法線一致的面。
      // （膠囊中心越過牆端後偵測球仍會擦到邊角，法線沿著邊角旋轉；不確認的話會繞著牆端跑到背面。）
      const nx = out.normal.x;
      const nz = out.normal.z;
      _dir.x = -nx;
      _dir.z = -nz;
      const ray = this.physics.raycast(_from, _dir, reach + FACE_RAY_EXTRA, QueryMask.world, this.host.capsule);
      const rl = ray ? Math.hypot(ray.normal.x, ray.normal.z) : 0;
      if (
        !ray ||
        rl < 1e-6 ||
        (ray.normal.x * nx + ray.normal.z * nz) / rl < FACE_CONFIRM_DOT ||
        Math.abs(ray.normal.y) >= cfg.wallMaxNormalY ||
        !(ray.surface?.wallRunnable ?? false)
      ) {
        out.runnable = false;
      } else {
        // 以射線打到的牆面法線與距離為準（偵測球擦到邊角時的法線會偏）。
        out.normal.set(ray.normal.x / rl, 0, ray.normal.z / rl);
        out.normalY = ray.normal.y;
        out.handle = ray.collider.handle;
        out.distance = ray.distance;
      }
    }
    this.log.push(_from, hit.point.x, hit.point.y, hit.point.z, out.runnable ? ProbeKind.valid : ProbeKind.invalid);
    return true;
  }

  /**
   * 攀爬偵測：沿視線水平方向 (fwdX, fwdZ)（單位向量）找正面牆與可攀的邊緣。
   * 成功時填入 plan 並回傳 true。條件：
   *   前方 mantleReach 內有接近垂直的牆、視線與牆面夾角 ≤ mantleMaxFacingDeg；
   *   牆後方從上往下 raycast 找到坡度 < mantleMaxSlopeDeg 的頂面，高度在腳底以上 mantleMinHeight～mantleMaxHeight；
   *   目標位置放得下站姿膠囊；從目前位置往上、再往前到目標的路徑沒有阻擋。
   */
  findLedge(fwdX: number, fwdZ: number, plan: MantlePlan): boolean {
    const host = this.host;
    const cfg = host.config;
    const front = this.front;
    front.found = false;
    front.runnable = false;
    const fl = Math.hypot(fwdX, fwdZ);
    if (fl < 1e-6) return false;
    const fx = fwdX / fl;
    const fz = fwdZ / fl;
    const p = host.position;
    const r = cfg.radius;

    // 1. 前方牆：掃掠縮小、抬高的目前姿勢膠囊。
    const rc = Math.max(0.05, r - FRONT_SHRINK);
    const hh = Math.max(0, (host.height - FRONT_LIFT) / 2 - rc);
    const shape = this.capsule(0, hh, rc);
    _from.x = p.x;
    _from.y = p.y + FRONT_LIFT + hh + rc;
    _from.z = p.z;
    _dir.x = fx;
    _dir.y = 0;
    _dir.z = fz;
    const reach = cfg.mantleReach + (r - rc);
    const wall = this.physics.shapeCast(shape, _from, _dir, reach, QueryMask.world, undefined, host.capsule, true);
    if (!wall) {
      this.log.push(_from, _from.x + fx * (reach + rc), _from.y, _from.z + fz * (reach + rc), ProbeKind.miss);
      return false;
    }
    const n = wall.normal;
    const hl = Math.hypot(n.x, n.z);
    if (hl < FRONT_MIN_HORIZONTAL) {
      this.log.push(_from, wall.point.x, wall.point.y, wall.point.z, ProbeKind.invalid);
      return false;
    }
    const nx = n.x / hl;
    const nz = n.z / hl;
    const facing = -(nx * fx + nz * fz);
    front.found = true;
    front.handle = wall.collider.handle;
    front.normal.set(nx, 0, nz);
    front.normalY = n.y;
    front.point.set(wall.point.x, wall.point.y, wall.point.z);
    front.distance = wall.distance + rc;
    if (facing < Math.cos(cfg.mantleMaxFacingDeg * DEG2RAD)) {
      this.log.push(_from, wall.point.x, wall.point.y, wall.point.z, ProbeKind.invalid);
      return false;
    }
    this.log.push(_from, wall.point.x, wall.point.y, wall.point.z, ProbeKind.valid);
    const wx = wall.point.x;
    const wz = wall.point.z;

    // 2. 邊緣頂面：牆面後方從上往下 raycast。
    const top = this.castTop(wx + fx * LEDGE_PROBE_DEPTH, wz + fz * LEDGE_PROBE_DEPTH);
    if (top === null) return false;
    const height = top - p.y;
    if (height < cfg.mantleMinHeight - 1e-6 || height > cfg.mantleMaxHeight + 1e-6) return false;

    // 3. 目標位置：沿視線越過牆面，讓膠囊完整站在頂面上。
    const inset = (r + MANTLE_INSET_MARGIN) / Math.max(0.5, facing);
    const tx = wx + fx * inset;
    const tz = wz + fz * inset;
    const targetTop = this.castTop(tx, tz);
    if (targetTop === null || Math.abs(targetTop - top) > MANTLE_TOP_TOLERANCE) return false;
    const targetHeight = targetTop - p.y;
    if (targetHeight < cfg.mantleMinHeight - 1e-6 || targetHeight > cfg.mantleMaxHeight + 1e-6) return false;
    if (!host.standingCapsuleFits(tx, targetTop, tz)) {
      this.log.push({ x: tx, y: targetTop, z: tz }, tx, targetTop + cfg.standHeight, tz, ProbeKind.invalid);
      return false;
    }

    // 4. 路徑：先往上到頂面 + clearance，再往前到目標，都不能被擋住。
    const rp = Math.max(0.05, r - PATH_SHRINK);
    const hp = Math.max(0, host.height / 2 - rp);
    const pathShape = this.capsule(1, hp, rp);
    const riseTo = targetTop + MANTLE_CLEARANCE;
    const rise = riseTo - p.y;
    _from.x = p.x;
    _from.y = p.y + hp + rp + PATH_SHRINK;
    _from.z = p.z;
    if (rise > 0 && this.physics.shapeCast(pathShape, _from, _up, rise, QueryMask.world, undefined, host.capsule, true)) {
      this.log.push(_from, _from.x, _from.y + rise, _from.z, ProbeKind.invalid);
      return false;
    }
    _from.y += Math.max(0, rise);
    const ddx = tx - p.x;
    const ddz = tz - p.z;
    const dist = Math.hypot(ddx, ddz);
    if (dist > 1e-4) {
      _dir.x = ddx / dist;
      _dir.y = 0;
      _dir.z = ddz / dist;
      if (this.physics.shapeCast(pathShape, _from, _dir, dist, QueryMask.world, undefined, host.capsule, true)) {
        this.log.push(_from, tx, _from.y, tz, ProbeKind.invalid);
        return false;
      }
    }

    plan.target.set(tx, targetTop, tz);
    plan.dir.set(fx, 0, fz);
    plan.height = targetHeight;
    plan.wallNormal.set(nx, 0, nz);
    this.log.push({ x: tx, y: targetTop, z: tz }, tx, targetTop + cfg.standHeight, tz, ProbeKind.target);
    return true;
  }

  /**
   * 在 (x, z) 從「腳底 + mantleMaxHeight + LEDGE_RAY_ABOVE」往下 raycast 到「腳底 + mantleMinHeight − 0.1」，
   * 回傳可站立頂面（坡度 < mantleMaxSlopeDeg）的高度；沒有時回傳 null。起點在實心物體內時（牆比上限高）回傳 null。
   */
  private castTop(x: number, z: number): number | null {
    const cfg = this.host.config;
    const p = this.host.position;
    _from.x = x;
    _from.y = p.y + cfg.mantleMaxHeight + LEDGE_RAY_ABOVE;
    _from.z = z;
    const len = cfg.mantleMaxHeight + LEDGE_RAY_ABOVE - cfg.mantleMinHeight + 0.1;
    const hit = this.physics.raycast(_from, _down, len, QueryMask.world);
    if (!hit) {
      this.log.push(_from, x, _from.y - len, z, ProbeKind.miss);
      return null;
    }
    const ok = hit.distance > 1e-4 && hit.normal.y >= Math.cos(cfg.mantleMaxSlopeDeg * DEG2RAD);
    this.log.push(_from, hit.point.x, hit.point.y, hit.point.z, ok ? ProbeKind.valid : ProbeKind.invalid);
    return ok ? hit.point.y : null;
  }

  private capsule(slot: number, halfHeight: number, radius: number): RAPIER.Capsule {
    const c = this.capsules[slot]!;
    const key = `${halfHeight.toFixed(5)}:${radius.toFixed(5)}`;
    if (!c.shape || c.key !== key) {
      c.shape = new RAPIER.Capsule(halfHeight, radius);
      c.key = key;
    }
    return c.shape;
  }
}
