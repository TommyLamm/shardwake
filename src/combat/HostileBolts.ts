// 敵方投射物（M1-12 訓練無人機的能量球；M3 的敵人沿用）：固定容量物件池（滿了回收最舊的），
// 每個固定步以「這一步的位移線段」同時檢查世界（raycast，掩體擋得住）與玩家膠囊（sweepSphereCapsule，與步長無關），
// 先碰到哪個算哪個。打到玩家時對 getPlayerTarget() 呼叫 applyDamage 並發出 `combat:damage`（target 為玩家、source 為發射者）。
// 速度慢（18 m/s）、拖尾明顯（外觀在 TargetVisuals），可以用 Dash、滑鏟、跑牆閃避；不追蹤、不預判。
import { createDamageInfo, type DamageInfo, type Damageable } from '@/combat/Damage';
import { sweepSphereCapsule } from '@/combat/sweep';
import type { EventBus } from '@/core/EventBus';
import type { GameEvents } from '@/core/events';
import { Pool } from '@/core/Pool';
import { QueryMask } from '@/physics/groups';
import type { Physics, Vec3Like } from '@/physics/Physics';

export interface HostileBolt {
  id: number;
  source: string;
  weaponId: string;
  damage: number;
  radius: number;
  lifetime: number;
  readonly position: Vec3Like;
  readonly previousPosition: Vec3Like;
  readonly velocity: Vec3Like;
  readonly origin: Vec3Like;
  age: number;
  traveled: number;
}

/** 玩家膠囊：軸線段 a（下）→ b（上）與半徑。 */
export interface CapsuleLike {
  readonly a: Vec3Like;
  readonly b: Vec3Like;
  radius: number;
}

export interface HostileBoltsOptions {
  physics?: Physics | null;
  bus?: EventBus<GameEvents> | undefined;
  capacity?: number;
  /** 玩家膠囊（沒有玩家或玩家死亡時回傳 null）。 */
  getPlayerCapsule?: () => Readonly<CapsuleLike> | null;
  getPlayerTarget?: () => Damageable | null;
}

const v3 = (): Vec3Like => ({ x: 0, y: 0, z: 0 });

export class HostileBolts {
  readonly pool: Pool<HostileBolt>;
  /** 累計：發射、打到玩家、打到世界、逾時（除錯監看與測試）。 */
  readonly stats = { spawned: 0, hitPlayer: 0, impact: 0, expired: 0 };
  private nextId = 1;
  private readonly info: DamageInfo = createDamageInfo();
  private readonly evFire: GameEvents['enemy:fire'] = { source: '', position: v3(), dir: v3(), speed: 0 };
  private readonly evProj: GameEvents['enemy:projectile'] = { phase: 'impact', id: 0, source: '', position: v3(), normal: { x: 0, y: 1, z: 0 } };
  private readonly seg = v3();
  private readonly done: HostileBolt[] = [];

  constructor(private readonly options: HostileBoltsOptions = {}) {
    this.pool = new Pool<HostileBolt>({
      max: Math.max(1, Math.floor(options.capacity ?? 32)),
      create: () => ({
        id: 0,
        source: '',
        weaponId: '',
        damage: 0,
        radius: 0,
        lifetime: 0,
        position: v3(),
        previousPosition: v3(),
        velocity: v3(),
        origin: v3(),
        age: 0,
        traveled: 0,
      }),
      whenExhausted: 'recycleOldest',
    });
  }

  get activeCount(): number {
    return this.pool.activeCount;
  }

  /** 發射一顆（dir 會正規化）。 */
  spawn(
    source: string,
    origin: Readonly<Vec3Like>,
    dir: Readonly<Vec3Like>,
    speed: number,
    damage: number,
    radius: number,
    lifetime: number,
    weaponId = 'drone-bolt',
  ): HostileBolt | null {
    const l = Math.hypot(dir.x, dir.y, dir.z);
    if (!(l > 1e-9) || !(speed > 0)) return null;
    const b = this.pool.acquire();
    if (!b) return null;
    b.id = this.nextId++;
    b.source = source;
    b.weaponId = weaponId;
    b.damage = damage;
    b.radius = radius;
    b.lifetime = lifetime;
    copy(b.position, origin);
    copy(b.previousPosition, origin);
    copy(b.origin, origin);
    b.velocity.x = (dir.x / l) * speed;
    b.velocity.y = (dir.y / l) * speed;
    b.velocity.z = (dir.z / l) * speed;
    b.age = 0;
    b.traveled = 0;
    this.stats.spawned++;
    const ev = this.evFire;
    ev.source = source;
    copy(ev.position, origin);
    ev.dir.x = dir.x / l;
    ev.dir.y = dir.y / l;
    ev.dir.z = dir.z / l;
    ev.speed = speed;
    this.options.bus?.emit('enemy:fire', ev);
    return b;
  }

  /** 推進所有投射物一步。 */
  step(dt: number): void {
    if (this.pool.activeCount === 0 || !(dt > 0)) return;
    const done = this.done;
    done.length = 0;
    const capsule = this.options.getPlayerCapsule?.() ?? null;
    this.pool.forEachActive((b) => {
      copy(b.previousPosition, b.position);
      if (this.advance(b, dt, capsule)) done.push(b);
    });
    for (const b of done) this.pool.release(b);
    done.length = 0;
  }

  clear(): void {
    this.pool.releaseAll();
  }

  /** 推進一顆；回傳 true 表示結束。 */
  private advance(b: HostileBolt, dt: number, capsule: Readonly<CapsuleLike> | null): boolean {
    let t = dt;
    let expire = false;
    if (b.age + t >= b.lifetime) {
      t = Math.max(0, b.lifetime - b.age);
      expire = true;
    }
    const seg = this.seg;
    seg.x = b.velocity.x * t;
    seg.y = b.velocity.y * t;
    seg.z = b.velocity.z * t;
    const len = Math.hypot(seg.x, seg.y, seg.z);
    let playerT: number | null = null;
    if (capsule && len > 0) playerT = sweepSphereCapsule(b.position, seg, b.radius, capsule.a, capsule.b, capsule.radius);
    let worldT: number | null = null;
    let wn: Readonly<Vec3Like> | null = null;
    const physics = this.options.physics;
    if (physics && len > 1e-9) {
      const hit = physics.raycast(b.position, seg, len, QueryMask.world);
      if (hit) {
        // 球心停在表面前 radius 處（近似；能量球很小）。
        worldT = Math.max(0, (hit.distance - b.radius * 0.5) / len);
        wn = hit.normal;
      }
    }
    if (playerT !== null && (worldT === null || playerT <= worldT)) {
      this.moveTo(b, seg, playerT, len, t);
      this.hitPlayer(b);
      return true;
    }
    if (worldT !== null && wn) {
      this.moveTo(b, seg, worldT, len, t);
      this.stats.impact++;
      this.emit('impact', b, wn);
      return true;
    }
    b.position.x += seg.x;
    b.position.y += seg.y;
    b.position.z += seg.z;
    b.traveled += len;
    b.age += t;
    if (expire) {
      this.stats.expired++;
      this.emit('expire', b, null);
      return true;
    }
    return false;
  }

  private moveTo(b: HostileBolt, seg: Readonly<Vec3Like>, f: number, len: number, t: number): void {
    b.position.x += seg.x * f;
    b.position.y += seg.y * f;
    b.position.z += seg.z * f;
    b.traveled += len * f;
    b.age += t * f;
  }

  private hitPlayer(b: HostileBolt): void {
    this.stats.hitPlayer++;
    const target = this.options.getPlayerTarget?.() ?? null;
    const sp = Math.hypot(b.velocity.x, b.velocity.y, b.velocity.z) || 1;
    const normal = this.evProj.normal;
    normal.x = -b.velocity.x / sp;
    normal.y = -b.velocity.y / sp;
    normal.z = -b.velocity.z / sp;
    if (target && target.alive) {
      const info = this.info;
      info.amount = b.damage;
      info.isCrit = false;
      copy(info.point, b.position);
      copy(info.normal, normal);
      info.dir.x = b.velocity.x / sp;
      info.dir.y = b.velocity.y / sp;
      info.dir.z = b.velocity.z / sp;
      info.source = b.source;
      info.weaponId = b.weaponId;
      info.isKill = false;
      info.target = target;
      info.zone = 'body';
      info.kind = 'projectile';
      info.shotId = -b.id;
      // 距離 = 發射點到命中點（damageSourcePosition 由此倒推出發射點）。
      info.distance = Math.hypot(b.position.x - b.origin.x, b.position.y - b.origin.y, b.position.z - b.origin.z);
      const outcome = target.applyDamage(info);
      info.isKill = outcome.killed;
      this.options.bus?.emit('combat:damage', info);
    }
    this.emit('hitPlayer', b, normal);
  }

  private emit(phase: GameEvents['enemy:projectile']['phase'], b: HostileBolt, normal: Readonly<Vec3Like> | null): void {
    const bus = this.options.bus;
    if (!bus) return;
    const ev = this.evProj;
    ev.phase = phase;
    ev.id = b.id;
    ev.source = b.source;
    copy(ev.position, b.position);
    if (normal && normal !== ev.normal) copy(ev.normal, normal);
    else if (!normal) {
      ev.normal.x = 0;
      ev.normal.y = 1;
      ev.normal.z = 0;
    }
    bus.emit('enemy:projectile', ev);
  }
}

function copy(dst: Vec3Like, src: Readonly<Vec3Like>): void {
  dst.x = src.x;
  dst.y = src.y;
  dst.z = src.z;
}
