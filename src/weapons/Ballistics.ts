// 彈道（M1-10）：hitscan、投射物、範圍傷害、近戰目標查詢與傷害結算。
//
// - Hitscan：從射擊起點（相機／眼睛）沿「視線＋散布」方向做穿透射線（Physics.raycastAll，世界＋敵人）。
//   依距離由近到遠：碰到世界就停（不穿牆）；碰到 Hitbox 造成傷害（同一目標只算一次），穿過 damage.penetration 個目標後停。
//   傷害 = base × 距離衰減 ×（弱點 critMult）× Hitbox 倍率 × perk 修正。
// - 投射物：物件池（滿了回收最舊的），每步以「這一步的位移線段」做 shape cast（球，半徑 radius；0 時為 raycast），
//   速度再快也不會穿過薄牆。碰撞時：直擊目標受 base 傷害；範圍內的目標依距離衰減受 splashDamage（視線被世界擋住時不生效）；
//   範圍內的玩家受到擊退（加到玩家速度，可以火箭跳），selfDamageMult > 0 時另受自傷。
// - 近戰：眼睛前方球形 overlap（敵人）→ 錐形與視線過濾 → 依距離與偏離角挑一個目標。
// 傷害經 EventBus 的 `combat:damage`（DamageInfo，物件重複使用）發出；hitscan 每顆彈丸另發 `weapon:hitscan`（曳光、彈孔），
// 爆炸發 `weapon:explosion`，投射物生成／命中／逾時發 `weapon:projectile`。M1-11 的投射物外觀讀 ballistics.projectiles。
import RAPIER from '@dimforge/rapier3d-compat';
import {
  createDamageInfo,
  falloffMultiplier,
  hitboxOf,
  type DamageInfo,
  type DamageKind,
  type Damageable,
  type Hitbox,
} from '@/combat/Damage';
import type { EventBus } from '@/core/EventBus';
import type { GameEvents } from '@/core/events';
import { Pool } from '@/core/Pool';
import { CollisionGroup, QueryMask } from '@/physics/groups';
import type { Physics, Vec3Like } from '@/physics/Physics';
import type { SurfaceType } from '@/physics/SurfaceRegistry';
import { WEAPON_SYSTEM_CONFIG, type WeaponSystemConfig } from '@/weapons/WeaponConfig';
import type { WeaponDef } from '@/weapons/WeaponDef';
import type { PerkContext, WeaponPerkHooks } from '@/weapons/perks';

/** 一次開火的共用資訊（同一發的所有彈丸共用）。 */
export interface ShotContext {
  shotId: number;
  weaponId: string;
  source: string;
  def: Readonly<WeaponDef>;
  perks: readonly WeaponPerkHooks[];
  perkCtx: PerkContext | null;
}

/** hitscan 命中的一個目標。 */
export interface HitscanTargetHit {
  target: Damageable;
  zone: Hitbox['zone'];
  distance: number;
  amount: number;
  killed: boolean;
  readonly point: Vec3Like;
}

/** 一顆彈丸的 hitscan 結果（物件重複使用；下一次 hitscan 會覆寫）。 */
export interface HitscanResult {
  readonly origin: Vec3Like;
  readonly dir: Vec3Like;
  /** 彈道終點（打到牆、穿透上限的目標，或射程盡頭）。 */
  readonly end: Vec3Like;
  /** 終點打到世界（有彈孔）。 */
  hitWorld: boolean;
  readonly normal: Vec3Like;
  surface: SurfaceType | null;
  distance: number;
  /** 命中的目標（前 targetCount 筆有效）。 */
  readonly targets: HitscanTargetHit[];
  targetCount: number;
}

/** 飛行中的投射物（M1-11 讀取 position／previousPosition 畫外觀）。 */
export interface Projectile {
  id: number;
  shotId: number;
  weaponId: string;
  def: WeaponDef;
  perks: readonly WeaponPerkHooks[];
  readonly position: Vec3Like;
  /** 上一步的位置（插值用）。 */
  readonly previousPosition: Vec3Like;
  readonly velocity: Vec3Like;
  readonly origin: Vec3Like;
  age: number;
  traveled: number;
}

export interface BallisticsOptions {
  physics: Physics;
  bus?: EventBus<GameEvents> | undefined;
  config?: WeaponSystemConfig;
  /** 玩家的中心點（擊退、自傷距離與視線用）；沒有玩家時回傳 null。 */
  getPlayerCenter?: (out: Vec3Like) => Vec3Like | null;
  /** 對玩家施加速度變化（自身擊退）。 */
  applyPlayerImpulse?: (dv: Readonly<Vec3Like>) => void;
  /** 玩家自身的受擊目標（selfDamageMult > 0 時使用；M1-12 提供）。 */
  getSelfTarget?: () => Damageable | null;
}

const _ballShapes = new Map<number, RAPIER.Ball>();
function ballShape(radius: number): RAPIER.Ball {
  const key = Math.round(radius * 1000);
  let s = _ballShapes.get(key);
  if (!s) {
    s = new RAPIER.Ball(Math.max(0.001, key / 1000));
    _ballShapes.set(key, s);
  }
  return s;
}

const v3 = (): Vec3Like => ({ x: 0, y: 0, z: 0 });

export class Ballistics {
  readonly config: WeaponSystemConfig;
  readonly projectiles: Pool<Projectile>;
  /** 已命中、已發出的傷害次數（除錯監看）。 */
  damageEvents = 0;
  private readonly physics: Physics;
  private readonly bus: EventBus<GameEvents> | undefined;
  private readonly info: DamageInfo = createDamageInfo();
  private readonly hitscanResult: HitscanResult = {
    origin: v3(),
    dir: v3(),
    end: v3(),
    hitWorld: false,
    normal: { x: 0, y: 1, z: 0 },
    surface: null,
    distance: 0,
    targets: [],
    targetCount: 0,
  };
  private readonly hitTargets = new Set<Damageable>();
  private readonly splashTargets = new Map<Damageable, Hitbox>();
  private nextProjectileId = 1;
  private readonly tmpA = v3();
  private readonly tmpB = v3();
  private readonly tmpC = v3();
  private readonly tmpDir = v3();
  private readonly expCenter = v3();
  private readonly expNormal = v3();
  private readonly evHitscan: GameEvents['weapon:hitscan'];
  private readonly evProjectile: GameEvents['weapon:projectile'];
  private readonly evExplosion: GameEvents['weapon:explosion'];
  private readonly releaseQueue: Projectile[] = [];

  constructor(private readonly options: BallisticsOptions) {
    this.physics = options.physics;
    this.bus = options.bus;
    this.config = options.config ?? WEAPON_SYSTEM_CONFIG;
    this.projectiles = new Pool<Projectile>({
      max: Math.max(1, Math.floor(this.config.projectilePoolSize)),
      create: () => ({
        id: 0,
        shotId: 0,
        weaponId: '',
        def: null as unknown as WeaponDef,
        perks: [],
        position: v3(),
        previousPosition: v3(),
        velocity: v3(),
        origin: v3(),
        age: 0,
        traveled: 0,
      }),
      onRelease: (p) => {
        p.def = null as unknown as WeaponDef;
        p.perks = [];
      },
      whenExhausted: 'recycleOldest',
    });
    this.evHitscan = {
      shotId: 0,
      weaponId: '',
      pellet: 0,
      origin: v3(),
      end: v3(),
      normal: { x: 0, y: 1, z: 0 },
      hitWorld: false,
      surface: null,
      targets: 0,
    };
    this.evProjectile = { phase: 'spawn', id: 0, shotId: 0, weaponId: '', position: v3(), velocity: v3() };
    this.evExplosion = {
      shotId: 0,
      weaponId: '',
      point: v3(),
      normal: { x: 0, y: 1, z: 0 },
      radius: 0,
      targets: 0,
      selfKnockback: 0,
    };
  }

  // ── hitscan ───────────────────────────────────────────

  /** 一顆彈丸的 hitscan（origin 為射擊起點，dir 為單位方向）。 */
  hitscan(origin: Readonly<Vec3Like>, dir: Readonly<Vec3Like>, shot: Readonly<ShotContext>, pellet = 0): HitscanResult {
    const res = this.hitscanResult;
    const def = shot.def;
    const range = this.config.hitscanRange;
    copy(res.origin, origin);
    copy(res.dir, dir);
    res.hitWorld = false;
    res.surface = null;
    res.targetCount = 0;
    res.normal.x = 0;
    res.normal.y = 1;
    res.normal.z = 0;
    res.distance = range;
    const n = this.physics.raycastAll(origin, dir, range, QueryMask.hitscan);
    const hits = this.physics.rayAllResults;
    const maxTargets = 1 + Math.max(0, Math.floor(def.damage.penetration));
    this.hitTargets.clear();
    let stopped = false;
    for (let i = 0; i < n && !stopped; i++) {
      const h = hits[i]!;
      const hitbox = hitboxOf(this.physics, h.collider.handle);
      if (!hitbox) {
        // 敵人群組但沒有登記成受擊範圍的碰撞體（例如移動用膠囊）：穿過，不擋子彈。
        const membership = h.collider.collisionGroups() >>> 16;
        if ((membership & CollisionGroup.ENEMY) !== 0 && (membership & CollisionGroup.WORLD) === 0) continue;
        // 世界：停下，留彈孔。
        res.hitWorld = true;
        copy(res.normal, h.normal);
        res.surface = h.surface?.surface ?? 'metal';
        res.distance = h.distance;
        stopped = true;
        break;
      }
      const target = hitbox.target;
      if (!target.alive || this.hitTargets.has(target)) continue;
      this.hitTargets.add(target);
      const crit = hitbox.zone === 'crit';
      const amount =
        def.damage.base *
        falloffMultiplier(h.distance, def.damage.falloffStart, def.damage.falloffEnd, def.damage.minMult) *
        (crit ? def.damage.critMult : 1) *
        (hitbox.multiplier ?? 1);
      const info = this.deal(hitbox, amount, 'hitscan', h.point, h.normal, dir, h.distance, shot);
      const rec = this.targetSlot(res, res.targetCount++);
      rec.target = target;
      rec.zone = hitbox.zone;
      rec.distance = h.distance;
      rec.amount = info.amount;
      rec.killed = info.isKill;
      copy(rec.point, h.point);
      if (res.targetCount >= maxTargets) {
        res.distance = h.distance;
        copy(res.normal, h.normal);
        stopped = true;
      }
    }
    res.end.x = origin.x + dir.x * res.distance;
    res.end.y = origin.y + dir.y * res.distance;
    res.end.z = origin.z + dir.z * res.distance;
    const ev = this.evHitscan;
    ev.shotId = shot.shotId;
    ev.weaponId = shot.weaponId;
    ev.pellet = pellet;
    copy(ev.origin, origin);
    copy(ev.end, res.end);
    copy(ev.normal, res.normal);
    ev.hitWorld = res.hitWorld;
    ev.surface = res.surface;
    ev.targets = res.targetCount;
    this.bus?.emit('weapon:hitscan', ev);
    return res;
  }

  private targetSlot(res: HitscanResult, i: number): HitscanTargetHit {
    let rec = res.targets[i];
    if (!rec) {
      rec = { target: null as unknown as Damageable, zone: 'body', distance: 0, amount: 0, killed: false, point: v3() };
      res.targets.push(rec);
    }
    return rec;
  }

  // ── 投射物 ─────────────────────────────────────────────

  /** 生成投射物；advance 為生成後這一步剩下的時間（s，同一步內就往前飛，與步長無關）。 */
  spawnProjectile(
    origin: Readonly<Vec3Like>,
    dir: Readonly<Vec3Like>,
    shot: Readonly<ShotContext>,
    advance: number,
  ): Projectile | null {
    const pd = shot.def.projectile;
    if (!pd) return null;
    const p = this.projectiles.acquire();
    if (!p) return null;
    p.id = this.nextProjectileId++;
    p.shotId = shot.shotId;
    p.weaponId = shot.weaponId;
    p.def = shot.def as WeaponDef;
    p.perks = shot.perks;
    copy(p.position, origin);
    copy(p.previousPosition, origin);
    copy(p.origin, origin);
    p.velocity.x = dir.x * pd.speed;
    p.velocity.y = dir.y * pd.speed;
    p.velocity.z = dir.z * pd.speed;
    p.age = 0;
    p.traveled = 0;
    this.emitProjectile('spawn', p);
    if (advance > 0) {
      if (this.advance(p, advance)) this.projectiles.release(p);
    }
    return p;
  }

  /** 推進所有投射物一步。 */
  step(dt: number): void {
    if (this.projectiles.activeCount === 0) return;
    const queue = this.releaseQueue;
    queue.length = 0;
    this.projectiles.forEachActive((p) => {
      copy(p.previousPosition, p.position);
      if (this.advance(p, dt)) queue.push(p);
    });
    for (const p of queue) this.projectiles.release(p);
    queue.length = 0;
  }

  /** 推進一個投射物 dt；回傳 true 表示已結束（命中或逾時），呼叫端負責歸還。 */
  private advance(p: Projectile, dt: number): boolean {
    const pd = p.def.projectile!;
    let t = dt;
    let expire = false;
    if (p.age + t >= pd.lifetime) {
      t = Math.max(0, pd.lifetime - p.age);
      expire = true;
    }
    const g = pd.gravity;
    const seg = this.tmpA;
    seg.x = p.velocity.x * t;
    seg.y = p.velocity.y * t - 0.5 * g * t * t;
    seg.z = p.velocity.z * t;
    const len = Math.hypot(seg.x, seg.y, seg.z);
    if (len > 1e-9) {
      const hit =
        pd.radius > 0
          ? this.physics.shapeCast(ballShape(pd.radius), p.position, seg, len, QueryMask.hitscan)
          : this.physics.raycast(p.position, seg, len, QueryMask.hitscan);
      if (hit) {
        const f = hit.distance / len;
        // 碰撞時投射物中心的位置（shape cast 的 TOI）；raycast 時就是命中點。
        const center = this.tmpB;
        center.x = p.position.x + seg.x * f;
        center.y = p.position.y + seg.y * f;
        center.z = p.position.z + seg.z * f;
        p.traveled += hit.distance;
        p.age += t * f;
        p.position.x = center.x;
        p.position.y = center.y;
        p.position.z = center.z;
        const handle = hit.collider.handle;
        const normal = this.tmpC;
        copy(normal, hit.normal);
        // shape cast 的 normal 在被命中的碰撞體上（朝外）；保險起見保證朝向投射物來的方向。
        if (normal.x * seg.x + normal.y * seg.y + normal.z * seg.z > 0) {
          normal.x = -normal.x;
          normal.y = -normal.y;
          normal.z = -normal.z;
        }
        this.impact(p, center, normal, handle);
        return true;
      }
    }
    p.position.x += seg.x;
    p.position.y += seg.y;
    p.position.z += seg.z;
    p.velocity.y -= g * t;
    p.age += t;
    p.traveled += len;
    if (expire) {
      this.emitProjectile('expire', p);
      return true;
    }
    return false;
  }

  private impact(p: Projectile, center: Readonly<Vec3Like>, normal: Readonly<Vec3Like>, handle: number): void {
    const def = p.def;
    const pd = def.projectile!;
    const shot = this.shotFromProjectile(p);
    const dir = this.tmpDir;
    const speed = Math.hypot(p.velocity.x, p.velocity.y, p.velocity.z) || 1;
    dir.x = p.velocity.x / speed;
    dir.y = p.velocity.y / speed;
    dir.z = p.velocity.z / speed;
    this.emitProjectile('impact', p);
    const hitbox = hitboxOf(this.physics, handle);
    if (hitbox && hitbox.target.alive) {
      const crit = hitbox.zone === 'crit';
      const amount =
        def.damage.base *
        falloffMultiplier(p.traveled, def.damage.falloffStart, def.damage.falloffEnd, def.damage.minMult) *
        (crit ? def.damage.critMult : 1) *
        (hitbox.multiplier ?? 1);
      this.deal(hitbox, amount, 'projectile', center, normal, dir, p.traveled, shot);
    }
    this.explode(center, normal, pd.splashRadius, pd, shot);
  }

  /**
   * 爆炸（範圍傷害與自身擊退）：center 為爆炸點，normal 為命中表面法線（爆炸點沿法線抬起 explosionLift 再做視線檢查）。
   * 範圍內每個目標依「爆炸點 → 目標中心」距離衰減（1 → splashMinMult），視線被世界擋住時不生效。
   */
  explode(
    center: Readonly<Vec3Like>,
    normal: Readonly<Vec3Like>,
    radius: number,
    pd: NonNullable<WeaponDef['projectile']>,
    shot: Readonly<ShotContext>,
  ): void {
    // 呼叫端可能傳入暫存向量：先複製。
    const ec = this.expCenter;
    const en = this.expNormal;
    copy(ec, center);
    copy(en, normal);
    center = ec;
    normal = en;
    const c = this.tmpA;
    const lift = this.config.explosionLift;
    c.x = center.x + normal.x * lift;
    c.y = center.y + normal.y * lift;
    c.z = center.z + normal.z * lift;
    let count = 0;
    let knock = 0;
    if (radius > 0) {
      const targets = this.splashTargets;
      targets.clear();
      const n = this.physics.overlap(ballShape(radius), c, CollisionGroup.ENEMY, undefined, null, Infinity, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS);
      for (let i = 0; i < n; i++) {
        const col = this.physics.overlapResults[i]!;
        const hb = hitboxOf(this.physics, col.handle);
        if (!hb || !hb.target.alive) continue;
        // 同一個目標有多個 hitbox 時取身體（範圍傷害不算弱點）。
        if (!targets.has(hb.target) || hb.zone === 'body') targets.set(hb.target, hb);
      }
      const tc = this.tmpB;
      const dir = this.tmpDir;
      for (const [target, hb] of targets) {
        target.getCenter(tc);
        const d = Math.hypot(tc.x - c.x, tc.y - c.y, tc.z - c.z);
        if (!this.lineOfSight(c, tc, d)) continue;
        const mult = falloffMultiplier(Math.min(d, radius), 0, radius, pd.splashMinMult);
        if (d > 1e-6) {
          dir.x = (tc.x - c.x) / d;
          dir.y = (tc.y - c.y) / d;
          dir.z = (tc.z - c.z) / d;
        } else copy(dir, normal);
        const negDir = this.tmpC;
        negDir.x = -dir.x;
        negDir.y = -dir.y;
        negDir.z = -dir.z;
        this.deal(hb, pd.splashDamage * mult * (hb.multiplier ?? 1), 'splash', tc, negDir, dir, d, shot);
        count++;
      }
      targets.clear();
      // 自身：擊退與自傷。
      const pc = this.options.getPlayerCenter?.(this.tmpB) ?? null;
      if (pc) {
        const d = Math.hypot(pc.x - c.x, pc.y - c.y, pc.z - c.z);
        if (d <= radius && this.lineOfSight(c, pc, d)) {
          const mult = falloffMultiplier(d, 0, radius, pd.splashMinMult);
          if (pd.selfKnockback > 0) {
            const dv = this.tmpDir;
            if (d > 1e-6) {
              dv.x = (pc.x - c.x) / d;
              dv.y = (pc.y - c.y) / d;
              dv.z = (pc.z - c.z) / d;
            } else copy(dv, normal);
            knock = pd.selfKnockback * mult;
            dv.x *= knock;
            dv.y *= knock;
            dv.z *= knock;
            this.options.applyPlayerImpulse?.(dv);
          }
          const self = pd.selfDamageMult > 0 ? (this.options.getSelfTarget?.() ?? null) : null;
          if (self && self.alive) {
            const hb: Hitbox = { kind: 'hitbox', target: self, zone: 'body', multiplier: 1 };
            const dir = this.tmpDir;
            dir.x = pc.x - c.x;
            dir.y = pc.y - c.y;
            dir.z = pc.z - c.z;
            const l = Math.hypot(dir.x, dir.y, dir.z) || 1;
            dir.x /= l;
            dir.y /= l;
            dir.z /= l;
            this.deal(hb, pd.splashDamage * mult * pd.selfDamageMult, 'splash', pc, normal, dir, d, shot);
          }
        }
      }
    }
    const ev = this.evExplosion;
    ev.shotId = shot.shotId;
    ev.weaponId = shot.weaponId;
    copy(ev.point, center);
    copy(ev.normal, normal);
    ev.radius = radius;
    ev.targets = count;
    ev.selfKnockback = knock;
    this.bus?.emit('weapon:explosion', ev);
  }

  /** from → to（距離 dist）之間沒有世界幾何擋住。 */
  lineOfSight(from: Readonly<Vec3Like>, to: Readonly<Vec3Like>, dist: number): boolean {
    if (dist < 1e-4) return true;
    const dir = this.tmpC;
    dir.x = to.x - from.x;
    dir.y = to.y - from.y;
    dir.z = to.z - from.z;
    const hit = this.physics.raycast(from, dir, dist, QueryMask.world);
    return !hit || hit.distance >= dist - 1e-3;
  }

  // ── 近戰 ───────────────────────────────────────────────

  /**
   * 近戰目標：eye 周圍 range 內（目標中心距離 ≤ range + tolerance）、與 forward 的夾角 ≤ coneDeg、視線沒被擋住的目標中，
   * 挑分數最低的（距離 ×（1 + 夾角／錐形半角））。回傳 null 表示沒有目標。out 為目標中心。
   */
  findMeleeTarget(
    eye: Readonly<Vec3Like>,
    forward: Readonly<Vec3Like>,
    range: number,
    coneDeg: number,
    tolerance: number,
    out: Vec3Like,
  ): { hitbox: Hitbox; distance: number } | null {
    const n = this.physics.overlap(ballShape(range), eye, CollisionGroup.ENEMY, undefined, null, Infinity, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS);
    let best: Hitbox | null = null;
    let bestScore = Infinity;
    let bestDist = 0;
    const c = this.tmpB;
    const cosCone = Math.cos((coneDeg * Math.PI) / 180);
    for (let i = 0; i < n; i++) {
      const hb = hitboxOf(this.physics, this.physics.overlapResults[i]!.handle);
      if (!hb || !hb.target.alive) continue;
      hb.target.getCenter(c);
      const dx = c.x - eye.x;
      const dy = c.y - eye.y;
      const dz = c.z - eye.z;
      const d = Math.hypot(dx, dy, dz);
      if (d > range + tolerance) continue;
      const cos = d > 1e-6 ? (dx * forward.x + dy * forward.y + dz * forward.z) / d : 1;
      if (cos < cosCone) continue;
      if (!this.lineOfSight(eye, c, d)) continue;
      const angle = Math.acos(Math.min(1, cos)) * (180 / Math.PI);
      const score = d * (1 + angle / Math.max(1, coneDeg));
      if (score < bestScore) {
        bestScore = score;
        best = hb.zone === 'body' ? hb : { kind: 'hitbox', target: hb.target, zone: 'body', multiplier: 1 };
        bestDist = d;
        copy(out, c);
      }
    }
    return best ? { hitbox: best, distance: bestDist } : null;
  }

  // ── 傷害 ───────────────────────────────────────────────

  /** 結算一筆傷害：perk 修正 → target.applyDamage → perk onHit → `combat:damage`。回傳重複使用的 DamageInfo。 */
  deal(
    hitbox: Hitbox,
    amount: number,
    kind: DamageKind,
    point: Readonly<Vec3Like>,
    normal: Readonly<Vec3Like>,
    dir: Readonly<Vec3Like>,
    distance: number,
    shot: Readonly<ShotContext>,
  ): DamageInfo {
    const info = this.info;
    info.amount = amount;
    info.isCrit = hitbox.zone === 'crit' && kind !== 'splash';
    copy(info.point, point);
    copy(info.normal, normal);
    copy(info.dir, dir);
    info.source = shot.source;
    info.weaponId = shot.weaponId;
    info.isKill = false;
    info.target = hitbox.target;
    info.zone = hitbox.zone;
    info.kind = kind;
    info.shotId = shot.shotId;
    info.distance = distance;
    const ctx = shot.perkCtx;
    if (ctx) for (const h of shot.perks) if (h.modifyDamage) info.amount = Math.max(0, h.modifyDamage(ctx, info));
    const outcome = hitbox.target.applyDamage(info);
    info.isKill = outcome.killed;
    if (ctx) for (const h of shot.perks) h.onHit?.(ctx, info);
    this.damageEvents++;
    this.bus?.emit('combat:damage', info);
    return info;
  }

  /** 清掉所有投射物（換關卡、重生）。 */
  clear(): void {
    this.projectiles.releaseAll();
  }

  private readonly projShot: ShotContext = {
    shotId: 0,
    weaponId: '',
    source: 'player',
    def: null as unknown as WeaponDef,
    perks: [],
    perkCtx: null,
  };

  private shotFromProjectile(p: Projectile): ShotContext {
    const s = this.projShot;
    s.shotId = p.shotId;
    s.weaponId = p.weaponId;
    s.def = p.def;
    s.perks = p.perks;
    s.perkCtx = null;
    return s;
  }

  private emitProjectile(phase: 'spawn' | 'impact' | 'expire', p: Projectile): void {
    if (!this.bus) return;
    const ev = this.evProjectile;
    ev.phase = phase;
    ev.id = p.id;
    ev.shotId = p.shotId;
    ev.weaponId = p.weaponId;
    copy(ev.position, p.position);
    copy(ev.velocity, p.velocity);
    this.bus.emit('weapon:projectile', ev);
  }
}

function copy(dst: Vec3Like, src: Readonly<Vec3Like>): void {
  dst.x = src.x;
  dst.y = src.y;
  dst.z = src.z;
}
