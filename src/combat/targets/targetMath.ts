// 靶標的純邏輯（M1-12；不碰 three、Rapier，可無頭測試）：血量與重置、軌道移動、無人機繞行。
import type { DamageOutcome } from '@/combat/Damage';
import { clamp } from '@/core/math';
import type { Rng } from '@/core/Rng';
import type { Vec3Like } from '@/physics/Physics';

// ── 血量、回滿、死亡與重置 ─────────────────────────────

export interface LifeRules {
  maxHealth: number;
  /** 未受傷多久後一次回滿（s；Infinity = 不回復）。 */
  regenDelay: number;
  /** 死亡後多久重置（s）。 */
  resetDelay: number;
}

export type LifeEvent = 'regen' | 'reset' | null;

/** 靶標的血量狀態：受傷、回滿、死亡計時與重置。 */
export class TargetLife {
  health: number;
  alive = true;
  /** 距離最後一次受傷（s）。 */
  sinceDamage = 1e6;
  /** 死亡經過的時間（s；存活時 0）。 */
  deadTime = 0;
  /** 重置（站起、重生）後經過的時間（s）。 */
  sinceReset = 1e6;
  /** 累計：受傷次數、擊殺次數。 */
  hits = 0;
  kills = 0;

  constructor(public rules: LifeRules) {
    this.health = rules.maxHealth;
  }

  get maxHealth(): number {
    return Math.max(1, this.rules.maxHealth);
  }

  get fraction(): number {
    return clamp(this.health / this.maxHealth, 0, 1);
  }

  damage(amount: number): DamageOutcome {
    if (!this.alive || !(amount > 0)) return { dealt: 0, killed: false };
    const dealt = Math.min(this.health, amount);
    this.health -= amount;
    this.sinceDamage = 0;
    this.hits++;
    if (this.health <= 0) {
      this.health = 0;
      this.alive = false;
      this.deadTime = 0;
      this.kills++;
      return { dealt, killed: true };
    }
    return { dealt, killed: false };
  }

  /** 推進 dt；回傳這一步發生的事件（回滿或重置）。 */
  step(dt: number): LifeEvent {
    if (!(dt > 0)) return null;
    this.sinceReset += dt;
    if (!this.alive) {
      this.deadTime += dt;
      if (this.deadTime >= this.rules.resetDelay) {
        this.reset();
        return 'reset';
      }
      return null;
    }
    const before = this.sinceDamage;
    this.sinceDamage += dt;
    if (this.health < this.maxHealth && before < this.rules.regenDelay && this.sinceDamage >= this.rules.regenDelay) {
      this.health = this.maxHealth;
      return 'regen';
    }
    // 調參面板提高血量上限後，沒在受傷的目標直接補滿。
    if (this.health < this.maxHealth && this.sinceDamage >= this.rules.regenDelay) this.health = this.maxHealth;
    return null;
  }

  reset(): void {
    this.alive = true;
    this.health = this.maxHealth;
    this.deadTime = 0;
    this.sinceDamage = 1e6;
    this.sinceReset = 0;
  }

  /** 套用新的血量上限（存活時直接回滿）。 */
  applyMax(): void {
    if (this.alive) this.health = this.maxHealth;
  }
}

// ── 軌道移動靶 ─────────────────────────────────────────

export interface RailRules {
  speedMin: number;
  speedMax: number;
  changeMin: number;
  changeMax: number;
  reverseChance: number;
}

/** 沿 [min, max] 左右移動：每隔隨機時間重新挑速度（並可能反向），碰到端點反彈。 */
export class RailMotion {
  x: number;
  dir: 1 | -1 = 1;
  speed: number;
  timer: number;

  constructor(
    public min: number,
    public max: number,
    private readonly rng: Rng,
    rules: RailRules,
    start = (min + max) / 2,
  ) {
    this.x = clamp(start, min, max);
    this.speed = rng.range(rules.speedMin, Math.max(rules.speedMin, rules.speedMax));
    this.timer = rng.range(rules.changeMin, Math.max(rules.changeMin, rules.changeMax));
    this.dir = rng.sign();
  }

  get velocity(): number {
    return this.dir * this.speed;
  }

  step(dt: number, rules: RailRules): void {
    if (!(dt > 0)) return;
    let remain = dt;
    // 變向計時可能在步中間到期：分段推進（與步長無關）。
    for (let guard = 0; guard < 8 && remain > 0; guard++) {
      const t = Math.min(remain, this.timer);
      this.advance(t);
      remain -= t;
      this.timer -= t;
      if (this.timer <= 1e-9) {
        this.speed = this.rng.range(rules.speedMin, Math.max(rules.speedMin, rules.speedMax));
        if (this.rng.chance(rules.reverseChance)) this.dir = this.dir > 0 ? -1 : 1;
        this.timer = this.rng.range(rules.changeMin, Math.max(rules.changeMin, rules.changeMax));
      }
    }
    if (remain > 0) this.advance(remain);
  }

  private advance(t: number): void {
    let x = this.x + this.dir * this.speed * t;
    // 端點反彈（可能多次，速度很快或軌道很短時）。
    for (let i = 0; i < 4; i++) {
      if (x > this.max) {
        x = this.max - (x - this.max);
        this.dir = -1;
      } else if (x < this.min) {
        x = this.min + (this.min - x);
        this.dir = 1;
      } else break;
    }
    this.x = clamp(x, this.min, this.max);
  }
}

// ── 無人機繞行 ─────────────────────────────────────────

export interface DroneRules {
  orbitRadiusMin: number;
  orbitRadiusMax: number;
  orbitSpeed: number;
  heightMin: number;
  heightMax: number;
  retargetMin: number;
  retargetMax: number;
  reverseChance: number;
  maxSpeed: number;
  accel: number;
  followGain: number;
  separation: number;
}

export interface Bounds3 {
  readonly min: readonly [number, number, number];
  readonly max: readonly [number, number, number];
}

/**
 * 無人機的飛行：以玩家為中心、半徑 radius 繞行（角速度 = 切線速度 / 半徑），每隔隨機時間重新挑半徑、高度，
 * 可能反轉繞行方向；目標點夾在戰區範圍內，並與其他無人機保持距離；以「追隨增益 × 偏差」的期望速度、最大加速度逼近。
 * player 為 null（不在戰區）時飛回待命點。
 */
export class DroneMotion {
  readonly position: Vec3Like;
  readonly velocity: Vec3Like = { x: 0, y: 0, z: 0 };
  readonly desired: Vec3Like = { x: 0, y: 0, z: 0 };
  angle: number;
  orbitDir: 1 | -1;
  radius: number;
  height: number;
  timer: number;

  constructor(
    start: Readonly<Vec3Like>,
    private readonly rng: Rng,
    rules: DroneRules,
    angle = 0,
  ) {
    this.position = { x: start.x, y: start.y, z: start.z };
    this.angle = angle;
    this.orbitDir = rng.sign();
    this.radius = rng.range(rules.orbitRadiusMin, Math.max(rules.orbitRadiusMin, rules.orbitRadiusMax));
    this.height = rng.range(rules.heightMin, Math.max(rules.heightMin, rules.heightMax));
    this.timer = rng.range(rules.retargetMin, Math.max(rules.retargetMin, rules.retargetMax));
  }

  /** 傳送到 p（重生）。 */
  place(p: Readonly<Vec3Like>): void {
    this.position.x = p.x;
    this.position.y = p.y;
    this.position.z = p.z;
    this.velocity.x = this.velocity.y = this.velocity.z = 0;
  }

  /** 以玩家位置（null = 回待命點 home）算出目標點，夾在 bounds 內並避開 others。 */
  computeDesired(
    rules: DroneRules,
    player: Readonly<Vec3Like> | null,
    home: Readonly<Vec3Like>,
    bounds: Bounds3,
    others: readonly Readonly<Vec3Like>[],
  ): Vec3Like {
    const d = this.desired;
    if (player) {
      d.x = player.x + Math.cos(this.angle) * this.radius;
      d.z = player.z + Math.sin(this.angle) * this.radius;
      d.y = this.height;
    } else {
      d.x = home.x;
      d.y = home.y;
      d.z = home.z;
    }
    // 與其他無人機保持距離：目標點往遠離的方向推。
    const sep = rules.separation;
    if (sep > 0) {
      for (const o of others) {
        const dx = this.position.x - o.x;
        const dy = this.position.y - o.y;
        const dz = this.position.z - o.z;
        const dist = Math.hypot(dx, dy, dz);
        if (dist < sep && dist > 1e-6) {
          const push = (sep - dist) / dist;
          d.x += dx * push;
          d.y += dy * push * 0.5;
          d.z += dz * push;
        }
      }
    }
    d.x = clamp(d.x, bounds.min[0], bounds.max[0]);
    d.y = clamp(d.y, bounds.min[1], bounds.max[1]);
    d.z = clamp(d.z, bounds.min[2], bounds.max[2]);
    return d;
  }

  step(
    dt: number,
    rules: DroneRules,
    player: Readonly<Vec3Like> | null,
    home: Readonly<Vec3Like>,
    bounds: Bounds3,
    others: readonly Readonly<Vec3Like>[] = [],
  ): void {
    if (!(dt > 0)) return;
    if (player) {
      const r = Math.max(1, this.radius);
      this.angle += (this.orbitDir * rules.orbitSpeed * dt) / r;
      this.timer -= dt;
      if (this.timer <= 0) {
        this.radius = this.rng.range(rules.orbitRadiusMin, Math.max(rules.orbitRadiusMin, rules.orbitRadiusMax));
        this.height = this.rng.range(rules.heightMin, Math.max(rules.heightMin, rules.heightMax));
        if (this.rng.chance(rules.reverseChance)) this.orbitDir = this.orbitDir > 0 ? -1 : 1;
        this.timer += this.rng.range(rules.retargetMin, Math.max(rules.retargetMin, rules.retargetMax));
      }
    }
    const d = this.computeDesired(rules, player, home, bounds, others);
    const p = this.position;
    const v = this.velocity;
    // 期望速度 = 增益 × 偏差，夾在最大速度；速度以最大加速度逼近期望速度。
    let wx = (d.x - p.x) * rules.followGain;
    let wy = (d.y - p.y) * rules.followGain;
    let wz = (d.z - p.z) * rules.followGain;
    const ws = Math.hypot(wx, wy, wz);
    if (ws > rules.maxSpeed && ws > 0) {
      const k = rules.maxSpeed / ws;
      wx *= k;
      wy *= k;
      wz *= k;
    }
    const ax = wx - v.x;
    const ay = wy - v.y;
    const az = wz - v.z;
    const al = Math.hypot(ax, ay, az);
    const maxDv = rules.accel * dt;
    const k = al > maxDv && al > 0 ? maxDv / al : 1;
    v.x += ax * k;
    v.y += ay * k;
    v.z += az * k;
    p.x += v.x * dt;
    p.y += v.y * dt;
    p.z += v.z * dt;
    p.x = clamp(p.x, bounds.min[0], bounds.max[0]);
    p.y = clamp(p.y, bounds.min[1], bounds.max[1]);
    p.z = clamp(p.z, bounds.min[2], bounds.max[2]);
  }
}

/** 水平距離（m）。 */
export function horizontalDistance(a: Readonly<Vec3Like>, b: Readonly<Vec3Like>): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}
