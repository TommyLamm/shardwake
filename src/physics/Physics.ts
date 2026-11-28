// 物理世界（Rapier 單執行緒 compat 版，不需要 SharedArrayBuffer）與查詢包裝。
//
// - 先 `await Physics.init()`（只初始化一次 WASM），再 `new Physics()`。
// - 世界重力只給動態物件；玩家用自訂重力（M1-05 的 KinematicCharacterController 不受世界重力影響）。
// - 每個固定步由 PhysicsSystem 呼叫 step(dt)（order = SystemOrder.physics）。
// - 查詢（raycast／shapeCast／overlap）重用包裝自己的暫存物件與結果物件，不在呼叫端配置記憶體：
//   回傳的結果物件會在下一次同種查詢時被覆寫，要保存請自行複製。
//   （Rapier 的 JS 綁定本身每次查詢仍會建立少量小物件，這部分無法避免。）
// - 新增或移除碰撞體後，查詢要等 broad phase 更新：Physics 在下一次查詢前自動呼叫 syncQueries()。
// - resetWorld()：釋放舊世界、建立新世界並清空 SurfaceRegistry（LevelManager 換關卡時使用）；
//   舊的 Collider／handle 全部失效，持有者應監聽 `physics:reset` 事件。
import RAPIER from '@dimforge/rapier3d-compat';
import type { EventBus } from '@/core/EventBus';
import type { GameEvents } from '@/core/events';
import { SystemOrder, type GameSystem } from '@/core/Game';
import { PHYSICS_CONFIG, type PhysicsConfig } from '@/physics/config';
import { QueryMask, queryGroups } from '@/physics/groups';
import { SurfaceRegistry, type SurfaceInfo } from '@/physics/SurfaceRegistry';

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

export interface QuatLike {
  x: number;
  y: number;
  z: number;
  w: number;
}

/** 查詢結果（每種查詢各一個物件，重複使用）。 */
export interface PhysicsHit {
  /** 命中點（世界座標）。 */
  readonly point: Vec3Like;
  /** 命中表面的法線（世界座標，朝外）。 */
  readonly normal: Vec3Like;
  readonly collider: RAPIER.Collider;
  /** 沿方向的距離（公尺）。 */
  distance: number;
  /** 命中碰撞體的表面資訊（沒有登記時為 undefined）。 */
  surface: SurfaceInfo | undefined;
}

interface MutableHit {
  point: Vec3Like;
  normal: Vec3Like;
  collider: RAPIER.Collider;
  distance: number;
  surface: SurfaceInfo | undefined;
}

const IDENTITY_ROT: Readonly<QuatLike> = Object.freeze({ x: 0, y: 0, z: 0, w: 1 });

let initPromise: Promise<void> | null = null;
let initialized = false;

export class Physics {
  /** 初始化 Rapier WASM（只執行一次，可重複呼叫）。 */
  static init(): Promise<void> {
    initPromise ??= RAPIER.init().then(() => {
      initialized = true;
    });
    return initPromise;
  }

  static get ready(): boolean {
    return initialized;
  }

  static get version(): string {
    return RAPIER.version();
  }

  readonly surfaces = new SurfaceRegistry();
  readonly config: PhysicsConfig;
  /** 已執行的 step 數（除錯用）。 */
  stepCount = 0;

  private _world: RAPIER.World;
  private _generation = 0;
  private readonly bus: EventBus<GameEvents> | undefined;
  private queriesDirty = true;
  private disposed = false;

  // 查詢用暫存（重複使用）。
  private readonly ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 });
  private readonly vPos = { x: 0, y: 0, z: 0 };
  private readonly vDir = { x: 0, y: 0, z: 0 };
  private readonly rayHit: MutableHit = Physics.makeHit();
  private readonly castHit: MutableHit = Physics.makeHit();
  /** overlap 的結果（重複使用的陣列；長度 = 最後一次 overlap 的命中數）。 */
  readonly overlapResults: RAPIER.Collider[] = [];
  private overlapLimit = Infinity;
  private readonly collectOverlap = (collider: RAPIER.Collider): boolean => {
    this.overlapResults.push(collider);
    return this.overlapResults.length < this.overlapLimit;
  };

  constructor(options: { config?: PhysicsConfig; bus?: EventBus<GameEvents> } = {}) {
    if (!initialized) throw new Error('Physics：請先 await Physics.init()');
    this.config = options.config ?? PHYSICS_CONFIG;
    this.bus = options.bus;
    this._world = this.createWorld();
  }

  private static makeHit(): MutableHit {
    return {
      point: { x: 0, y: 0, z: 0 },
      normal: { x: 0, y: 1, z: 0 },
      collider: null as unknown as RAPIER.Collider,
      distance: 0,
      surface: undefined,
    };
  }

  get world(): RAPIER.World {
    return this._world;
  }

  /** 世界的代數：每次 resetWorld() 加一；舊代的 Collider 全部失效。 */
  get generation(): number {
    return this._generation;
  }

  get isDisposed(): boolean {
    return this.disposed;
  }

  private createWorld(): RAPIER.World {
    const world = new RAPIER.World({ x: 0, y: this.config.worldGravityY, z: 0 });
    world.numSolverIterations = this.config.solverIterations;
    return world;
  }

  /** 套用調參面板改過的設定（重力、迭代次數）。 */
  applyConfig(): void {
    this._world.gravity = { x: 0, y: this.config.worldGravityY, z: 0 };
    this._world.numSolverIterations = this.config.solverIterations;
  }

  /** 推進一個固定步。 */
  step(dt: number): void {
    const world = this._world;
    world.timestep = dt;
    world.step();
    this.stepCount++;
    this.queriesDirty = false;
  }

  /** 讓查詢看到剛新增／移除的碰撞體（以 timestep 0 執行一步，不移動任何物件）。 */
  syncQueries(): void {
    const world = this._world;
    const dt = world.timestep;
    world.timestep = 0;
    world.step();
    world.timestep = dt;
    this.queriesDirty = false;
  }

  /** 釋放舊世界並建立新的空世界；SurfaceRegistry 一併清空，發出 `physics:reset`。 */
  resetWorld(): void {
    this._world.free();
    this.surfaces.clear();
    this.overlapResults.length = 0;
    this._world = this.createWorld();
    this._generation++;
    this.queriesDirty = true;
    this.bus?.emit('physics:reset', {});
  }

  // ── 碰撞體 ─────────────────────────────────────────────

  /** 建立不掛剛體的靜態碰撞體並登記表面資訊。 */
  createStaticCollider(desc: RAPIER.ColliderDesc, surface?: Partial<SurfaceInfo>): RAPIER.Collider {
    const collider = this._world.createCollider(desc);
    if (surface) this.surfaces.register(collider.handle, surface);
    this.queriesDirty = true;
    return collider;
  }

  /**
   * 移除碰撞體。generation 為建立時的 `physics.generation`：世界已經重建過（不同代）時直接忽略，
   * 避免舊 handle 誤刪新世界裡剛好同號的碰撞體。
   */
  removeCollider(collider: RAPIER.Collider, generation: number = this._generation): void {
    if (this.disposed || generation !== this._generation) return;
    if (!this._world.getCollider(collider.handle)) return;
    this.surfaces.remove(collider.handle);
    this._world.removeCollider(collider, false);
    this.queriesDirty = true;
  }

  /** 標記碰撞體有變動（直接用 world 建立碰撞體時呼叫）。 */
  markDirty(): void {
    this.queriesDirty = true;
  }

  // ── 查詢 ───────────────────────────────────────────────

  private beforeQuery(): void {
    if (this.queriesDirty) this.syncQueries();
  }

  /**
   * 有新增／移除碰撞體時先同步 broad phase（不移動物件）。直接使用 Rapier API 查詢的程式
   * （例如 M1-05 的 KinematicCharacterController）在查詢前呼叫。
   */
  ensureQueries(): void {
    this.beforeQuery();
  }

  /**
   * 射線：dir 不必正規化（內部正規化）；回傳最近命中或 null。
   * mask 為要命中的碰撞群組（預設只有世界）；預設排除 sensor（觸發區）。
   */
  raycast(
    origin: Readonly<Vec3Like>,
    dir: Readonly<Vec3Like>,
    maxDist: number,
    mask: number = QueryMask.world,
    exclude?: RAPIER.Collider | null,
    filterFlags: number = RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
  ): PhysicsHit | null {
    const len = Math.hypot(dir.x, dir.y, dir.z);
    if (len < 1e-9 || !(maxDist > 0)) return null;
    this.beforeQuery();
    const ray = this.ray;
    ray.origin.x = origin.x;
    ray.origin.y = origin.y;
    ray.origin.z = origin.z;
    ray.dir.x = dir.x / len;
    ray.dir.y = dir.y / len;
    ray.dir.z = dir.z / len;
    const hit = this._world.castRayAndGetNormal(ray, maxDist, true, filterFlags, queryGroups(mask), exclude ?? undefined);
    if (!hit) return null;
    const out = this.rayHit;
    const t = hit.timeOfImpact;
    out.point.x = ray.origin.x + ray.dir.x * t;
    out.point.y = ray.origin.y + ray.dir.y * t;
    out.point.z = ray.origin.z + ray.dir.z * t;
    out.normal.x = hit.normal.x;
    out.normal.y = hit.normal.y;
    out.normal.z = hit.normal.z;
    out.collider = hit.collider;
    out.distance = t;
    out.surface = this.surfaces.get(hit.collider.handle);
    return out;
  }

  /**
   * 射線穿透查詢：回傳射線在 maxDist 內穿過的所有碰撞體數量（每個碰撞體一筆、依距離由近到遠排序），
   * 結果放在 rayAllResults 的前 n 筆（重複使用；下一次 raycastAll 會覆寫）。武器穿透（M1-10）使用。
   */
  raycastAll(
    origin: Readonly<Vec3Like>,
    dir: Readonly<Vec3Like>,
    maxDist: number,
    mask: number = QueryMask.hitscan,
    filterFlags: number = RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
  ): number {
    const len = Math.hypot(dir.x, dir.y, dir.z);
    if (len < 1e-9 || !(maxDist > 0)) return 0;
    this.beforeQuery();
    const ray = this.ray;
    ray.origin.x = origin.x;
    ray.origin.y = origin.y;
    ray.origin.z = origin.z;
    ray.dir.x = dir.x / len;
    ray.dir.y = dir.y / len;
    ray.dir.z = dir.z / len;
    this.rayAllCount = 0;
    this._world.intersectionsWithRay(ray, maxDist, true, this.collectRayAll, filterFlags, queryGroups(mask));
    const n = this.rayAllCount;
    const list = this.rayAllList;
    // 插入排序（筆數很少）。
    for (let i = 1; i < n; i++) {
      const cur = list[i]!;
      let j = i - 1;
      while (j >= 0 && list[j]!.distance > cur.distance) {
        list[j + 1] = list[j]!;
        j--;
      }
      list[j + 1] = cur;
    }
    return n;
  }

  /** raycastAll 的結果（前 n 筆有效；物件重複使用）。 */
  get rayAllResults(): readonly PhysicsHit[] {
    return this.rayAllList;
  }

  private readonly rayAllList: MutableHit[] = [];
  private rayAllCount = 0;
  private readonly collectRayAll = (hit: RAPIER.RayColliderIntersection): boolean => {
    const list = this.rayAllList;
    if (this.rayAllCount >= list.length) list.push(Physics.makeHit());
    const out = list[this.rayAllCount++]!;
    const ray = this.ray;
    const t = hit.timeOfImpact;
    out.point.x = ray.origin.x + ray.dir.x * t;
    out.point.y = ray.origin.y + ray.dir.y * t;
    out.point.z = ray.origin.z + ray.dir.z * t;
    out.normal.x = hit.normal.x;
    out.normal.y = hit.normal.y;
    out.normal.z = hit.normal.z;
    out.collider = hit.collider;
    out.distance = t;
    out.surface = this.surfaces.get(hit.collider.handle);
    return true;
  };

  /**
   * 形狀掃掠：把 shape 從 from 沿 dir 移動最多 maxDist，回傳第一個命中（point／normal 在被命中的碰撞體上）。
   * 起點已經重疊時（stopAtPenetration = true）回傳 distance 0。
   */
  shapeCast(
    shape: RAPIER.Shape,
    from: Readonly<Vec3Like>,
    dir: Readonly<Vec3Like>,
    maxDist: number,
    mask: number = QueryMask.world,
    rot: Readonly<QuatLike> = IDENTITY_ROT,
    exclude?: RAPIER.Collider | null,
    stopAtPenetration = true,
    filterFlags: number = RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
  ): PhysicsHit | null {
    const len = Math.hypot(dir.x, dir.y, dir.z);
    if (len < 1e-9 || !(maxDist >= 0)) return null;
    this.beforeQuery();
    const pos = this.vPos;
    pos.x = from.x;
    pos.y = from.y;
    pos.z = from.z;
    const vel = this.vDir;
    vel.x = dir.x / len;
    vel.y = dir.y / len;
    vel.z = dir.z / len;
    const hit = this._world.castShape(
      pos,
      rot,
      vel,
      shape,
      0,
      maxDist,
      stopAtPenetration,
      filterFlags,
      queryGroups(mask),
      exclude ?? undefined,
    );
    if (!hit) return null;
    const out = this.castHit;
    out.point.x = hit.witness1.x;
    out.point.y = hit.witness1.y;
    out.point.z = hit.witness1.z;
    out.normal.x = hit.normal1.x;
    out.normal.y = hit.normal1.y;
    out.normal.z = hit.normal1.z;
    out.collider = hit.collider;
    out.distance = hit.time_of_impact;
    out.surface = this.surfaces.get(hit.collider.handle);
    return out;
  }

  /**
   * 重疊測試：回傳與 shape（放在 pos、rot）重疊的碰撞體數量，碰撞體放在 overlapResults（重複使用）。
   * limit 可提早停止（例如只想知道「有沒有」時傳 1）。預設包含 sensor（觸發區）。
   */
  overlap(
    shape: RAPIER.Shape,
    pos: Readonly<Vec3Like>,
    mask: number = QueryMask.world,
    rot: Readonly<QuatLike> = IDENTITY_ROT,
    exclude?: RAPIER.Collider | null,
    limit = Infinity,
    filterFlags = 0,
  ): number {
    this.beforeQuery();
    this.overlapResults.length = 0;
    this.overlapLimit = limit;
    const p = this.vPos;
    p.x = pos.x;
    p.y = pos.y;
    p.z = pos.z;
    this._world.intersectionsWithShape(
      p,
      rot,
      shape,
      this.collectOverlap,
      filterFlags,
      queryGroups(mask),
      exclude ?? undefined,
    );
    return this.overlapResults.length;
  }

  /** 碰撞體線框（除錯顯示）：每兩個點一條線段。 */
  debugLines(): Float32Array {
    this.beforeQuery();
    return this._world.debugRender().vertices;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this._world.free();
    this.surfaces.clear();
  }
}

/** 每個固定步推進物理世界的 Game 系統。 */
export class PhysicsSystem implements GameSystem {
  readonly name = 'physics';
  readonly order = SystemOrder.physics;

  constructor(readonly physics: Physics) {}

  fixedUpdate(dt: number): void {
    this.physics.step(dt);
  }

  dispose(): void {
    this.physics.dispose();
  }
}
