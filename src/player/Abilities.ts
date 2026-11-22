// 能力計時器、修正介面與唯讀狀態（M1-07）。
//
// - 通用計時器：ChargeTimer（多格充能、依序回充；Dash）、FuelTank（燃料；噴射）、Cooldown（冷卻；抓鉤）。
// - AbilityModifiers：裝備模組（M2-06）與技能（M5-01）透過它修正能力數值（加值與倍率），不直接改 MovementConfig。
//   實際值 = (基礎值 + Σadd) × Πmul；次數類（dashCharges、doubleJumpCount）取整數。基礎值仍可在調參面板調整。
// - Abilities：PlayerController 擁有的能力資料（二段跳次數、噴射燃料、Dash 充能、抓鉤冷卻與鉤爪），
//   每步更新唯讀狀態 `state` 給 HUD（M1-14）、音效（M1-13）、鏡頭（M1-08）讀取；事件見 core/events.ts 的 M1-07 段。
// 各能力的移動邏輯在 abilityStates.ts（二段跳、噴射、Dash、抓鉤狀態），鉤爪飛行在 Grapple.ts。
import * as THREE from 'three';
import type { MovementConfig } from '@/player/MovementConfig';
import { GrappleHook, type GrapplePhase } from '@/player/Grapple';

const EPS = 1e-9;

/** 多格充能、依序回充（一次只回充一格）。 */
export class ChargeTimer {
  charges: number;
  /** 正在回充那一格已經過的時間（s；滿格時為 0）。 */
  elapsed = 0;

  constructor(
    private readonly getMax: () => number,
    private readonly getRechargeTime: () => number,
  ) {
    this.charges = this.max;
  }

  get max(): number {
    return Math.max(0, Math.floor(this.getMax() + EPS));
  }

  get rechargeTime(): number {
    return Math.max(0, this.getRechargeTime());
  }

  /** 正在回充那一格的進度 0..1（滿格時為 0）。 */
  get progress(): number {
    const t = this.rechargeTime;
    if (this.charges >= this.max || t <= 0) return 0;
    return Math.min(1, this.elapsed / t);
  }

  get full(): boolean {
    return this.charges >= this.max;
  }

  canUse(): boolean {
    return this.charges >= 1;
  }

  /** 使用一格；沒有充能時回傳 false。 */
  use(): boolean {
    if (this.charges < 1) return false;
    if (this.charges >= this.max) this.elapsed = 0;
    this.charges--;
    return true;
  }

  /** 推進時間；回傳這次恢復的格數。 */
  update(dt: number): number {
    const max = this.max;
    if (this.charges > max) this.charges = max;
    if (this.charges >= max) {
      this.elapsed = 0;
      return 0;
    }
    const t = this.rechargeTime;
    if (t <= 0) {
      const n = max - this.charges;
      this.charges = max;
      this.elapsed = 0;
      return n;
    }
    this.elapsed += dt;
    let n = 0;
    while (this.charges < max && this.elapsed >= t - EPS) {
      this.elapsed = Math.max(0, this.elapsed - t);
      this.charges++;
      n++;
    }
    if (this.charges >= max) this.elapsed = 0;
    return n;
  }

  refill(): void {
    this.charges = this.max;
    this.elapsed = 0;
  }
}

/** 燃料（單位：秒）。回充延遲由呼叫端判斷（例如著地多久）。 */
export class FuelTank {
  fuel: number;

  constructor(
    private readonly getCapacity: () => number,
    private readonly getRechargeRate: () => number,
  ) {
    this.fuel = this.capacity;
  }

  get capacity(): number {
    return Math.max(0, this.getCapacity());
  }

  /** 剩餘比例 0..1。 */
  get fraction(): number {
    const c = this.capacity;
    return c > 0 ? Math.min(1, this.fuel / c) : 0;
  }

  get empty(): boolean {
    return this.fuel <= EPS;
  }

  get full(): boolean {
    return this.fuel >= this.capacity - EPS;
  }

  /** 消耗最多 amount；回傳實際消耗量。 */
  drain(amount: number): number {
    const used = Math.min(Math.max(0, amount), this.fuel);
    this.fuel -= used;
    if (this.fuel < EPS) this.fuel = 0;
    return used;
  }

  /** 以回充速度回充 dt 秒；回傳是否在這次回滿。 */
  recharge(dt: number): boolean {
    const c = this.capacity;
    if (this.fuel > c) this.fuel = c;
    if (this.fuel >= c) return false;
    this.fuel = Math.min(c, this.fuel + Math.max(0, this.getRechargeRate()) * dt);
    return this.fuel >= c - EPS;
  }

  refill(): void {
    this.fuel = this.capacity;
  }
}

/** 冷卻計時。 */
export class Cooldown {
  remaining = 0;
  /** 這次冷卻的總時間（進度條用）。 */
  total = 0;

  get ready(): boolean {
    return this.remaining <= EPS;
  }

  /** 冷卻進度 0（剛開始）→ 1（結束）；沒有冷卻時為 1。 */
  get progress(): number {
    return this.total > 0 ? 1 - Math.min(1, this.remaining / this.total) : 1;
  }

  start(duration: number): void {
    this.total = Math.max(0, duration);
    this.remaining = this.total;
  }

  /** 推進時間；回傳是否在這次結束冷卻。 */
  update(dt: number): boolean {
    if (this.remaining <= 0) return false;
    this.remaining -= dt;
    if (this.remaining <= EPS) {
      this.remaining = 0;
      return true;
    }
    return false;
  }

  reset(): void {
    this.remaining = 0;
    this.total = 0;
  }
}

// ── 能力修正介面 ─────────────────────────────────────────

/** 可被修正的能力數值（MovementConfig 的欄位）。 */
export const ABILITY_STATS = [
  'doubleJumpCount',
  'doubleJumpSpeed',
  'doubleJumpRedirect',
  'jetThrust',
  'jetMaxRiseSpeed',
  'jetHorizontalAccel',
  'jetHorizontalMaxSpeed',
  'jetFuel',
  'jetRechargeDelay',
  'jetRechargeRate',
  'dashCharges',
  'dashRechargeTime',
  'dashDistance',
  'dashDuration',
  'dashExitMinSpeed',
  'grappleHookSpeed',
  'grappleRange',
  'grappleMissCooldown',
  'grapplePullAccel',
  'grappleSteerAccel',
  'grappleMaxSpeed',
  'grappleGravityScale',
  'grappleJumpBoost',
  'grappleMaxTime',
  'grappleCooldown',
] as const satisfies readonly (keyof MovementConfig)[];

export type AbilityStat = (typeof ABILITY_STATS)[number];

/** 取整數的數值（次數）。 */
const INTEGER_STATS: ReadonlySet<AbilityStat> = new Set<AbilityStat>(['doubleJumpCount', 'dashCharges']);

export interface AbilityModifier {
  stat: AbilityStat;
  /** 加值（先加）。 */
  add?: number;
  /** 倍率（後乘）。 */
  mul?: number;
  /** 來源（裝備、技能 id），removeSource 用。 */
  source?: string;
}

export class AbilityModifiers {
  private readonly list: AbilityModifier[] = [];
  /** 每次增減修正時加一（快取用）。 */
  revision = 0;

  get count(): number {
    return this.list.length;
  }

  /** 加入修正；回傳移除函式。 */
  add(modifier: AbilityModifier): () => void {
    const m = { ...modifier };
    this.list.push(m);
    this.revision++;
    return () => {
      const i = this.list.indexOf(m);
      if (i >= 0) {
        this.list.splice(i, 1);
        this.revision++;
      }
    };
  }

  /** 移除某個來源的所有修正；回傳移除數。 */
  removeSource(source: string): number {
    let n = 0;
    for (let i = this.list.length - 1; i >= 0; i--) {
      if (this.list[i]!.source === source) {
        this.list.splice(i, 1);
        n++;
      }
    }
    if (n > 0) this.revision++;
    return n;
  }

  clear(): void {
    if (this.list.length === 0) return;
    this.list.length = 0;
    this.revision++;
  }

  /** 套用修正後的值（不小於 0；次數取整數）。 */
  apply(stat: AbilityStat, base: number): number {
    if (this.list.length === 0) return INTEGER_STATS.has(stat) ? Math.floor(base + EPS) : base;
    let add = 0;
    let mul = 1;
    for (const m of this.list) {
      if (m.stat !== stat) continue;
      if (m.add !== undefined) add += m.add;
      if (m.mul !== undefined) mul *= m.mul;
    }
    let v = (base + add) * mul;
    // 可為負的數值（目前沒有）以外一律不小於 0。
    if (stat !== 'doubleJumpRedirect') v = Math.max(0, v);
    else v = Math.min(1, Math.max(0, v));
    return INTEGER_STATS.has(stat) ? Math.floor(v + EPS) : v;
  }
}

// ── 唯讀狀態（HUD 用）───────────────────────────────────

export interface AbilityState {
  doubleJump: { enabled: boolean; remaining: number; max: number };
  jet: {
    enabled: boolean;
    /** 剩餘燃料（s）與比例。 */
    fuel: number;
    capacity: number;
    fraction: number;
    /** 這一步正在推進。 */
    active: boolean;
    /** 正在回充（著地超過延遲或跑牆中，且未滿）。 */
    recharging: boolean;
  };
  dash: {
    enabled: boolean;
    charges: number;
    maxCharges: number;
    /** 正在回充那一格的進度 0..1。 */
    rechargeProgress: number;
    /** 正在 Dash。 */
    active: boolean;
  };
  grapple: {
    enabled: boolean;
    phase: GrapplePhase;
    /** 冷卻剩餘（s）與總時間（落空 0.8／脫鉤 4）。 */
    cooldown: number;
    cooldownTotal: number;
    /** 現在按下就能發射。 */
    ready: boolean;
    /** 準星輔助：視線上射程內有可勾的表面（「可勾取」）。 */
    aimAvailable: boolean;
    aimDistance: number;
  };
}

/** 能力資料容器：計時器、鉤爪、修正與唯讀狀態（邏輯在 abilityStates.ts）。 */
export class Abilities {
  readonly modifiers = new AbilityModifiers();
  readonly dash: ChargeTimer;
  readonly jet: FuelTank;
  readonly grappleCooldown = new Cooldown();
  readonly hook = new GrappleHook();
  readonly state: AbilityState;

  /** 剩餘空中跳躍次數。 */
  doubleJumpsLeft: number;
  /** 這一步噴射是否在推進、上一步是否在推進（事件用）。 */
  jetThisStep = false;
  jetLastStep = false;
  /** 噴射已「上膛」：這次按住跳是在空中按下的（不是地面起跳那一下）。放開跳時解除。 */
  jetArmed = false;
  /** 連續著地時間（s；噴射回充延遲用）。 */
  groundedTime = 0;
  /** 這一步燃料是否在回充。 */
  jetRecharging = false;
  /** 進行中的 Dash（方向、時間、進入前沿 Dash 方向的速度）。 */
  readonly dashRun = {
    dir: new THREE.Vector3(0, 0, -1),
    time: 0,
    duration: 0,
    speed: 0,
    entryAlong: 0,
    /** 從地面開始且仍貼著地面（地面移動：自動上台階、貼地）。 */
    onGround: false,
    fromState: '',
  };
  /** 抓鉤狀態 step 中決定的脫鉤原因（按跳）；其餘原因在轉換規則中判斷。 */
  grappleReleaseReason: 'jump' | null = null;

  constructor(private readonly config: MovementConfig) {
    this.dash = new ChargeTimer(
      () => this.stat('dashCharges'),
      () => this.stat('dashRechargeTime'),
    );
    this.jet = new FuelTank(
      () => this.stat('jetFuel'),
      () => this.stat('jetRechargeRate'),
    );
    this.doubleJumpsLeft = this.stat('doubleJumpCount');
    this.state = {
      doubleJump: { enabled: true, remaining: 0, max: 0 },
      jet: { enabled: true, fuel: 0, capacity: 0, fraction: 0, active: false, recharging: false },
      dash: { enabled: true, charges: 0, maxCharges: 0, rechargeProgress: 0, active: false },
      grapple: { enabled: true, phase: 'idle', cooldown: 0, cooldownTotal: 0, ready: true, aimAvailable: false, aimDistance: 0 },
    };
    this.publish(false);
  }

  /** 修正後的能力數值。 */
  stat(key: AbilityStat): number {
    return this.modifiers.apply(key, this.config[key]);
  }

  /** 重置空中跳躍次數（著地、跑牆、抓鉤附著、重生）。 */
  resetDoubleJumps(): void {
    this.doubleJumpsLeft = this.stat('doubleJumpCount');
  }

  /** 重生：全部補滿、冷卻清除、鉤爪收回。 */
  refillAll(): void {
    this.resetDoubleJumps();
    this.jet.refill();
    this.dash.refill();
    this.grappleCooldown.reset();
    this.hook.reset();
    this.jetThisStep = false;
    this.jetLastStep = false;
    this.jetArmed = false;
    this.groundedTime = 0;
    this.jetRecharging = false;
  }

  /** 鉤爪現在能否發射（啟用、冷卻結束、沒有在飛行或附著）。 */
  canFireGrapple(): boolean {
    return (
      this.config.grappleEnabled &&
      this.grappleCooldown.ready &&
      (this.hook.phase === 'idle' || this.hook.phase === 'retracting')
    );
  }

  /** 更新唯讀狀態（每步結束時）。 */
  publish(dashing: boolean): void {
    const cfg = this.config;
    const s = this.state;
    s.doubleJump.enabled = cfg.doubleJumpEnabled;
    s.doubleJump.remaining = this.doubleJumpsLeft;
    s.doubleJump.max = this.stat('doubleJumpCount');
    s.jet.enabled = cfg.jetEnabled;
    s.jet.fuel = this.jet.fuel;
    s.jet.capacity = this.jet.capacity;
    s.jet.fraction = this.jet.fraction;
    s.jet.active = this.jetThisStep;
    s.jet.recharging = this.jetRecharging;
    s.dash.enabled = cfg.dashEnabled;
    s.dash.charges = this.dash.charges;
    s.dash.maxCharges = this.dash.max;
    s.dash.rechargeProgress = this.dash.progress;
    s.dash.active = dashing;
    const g = s.grapple;
    g.enabled = cfg.grappleEnabled;
    g.phase = this.hook.phase;
    g.cooldown = this.grappleCooldown.remaining;
    g.cooldownTotal = this.grappleCooldown.total;
    g.ready = this.canFireGrapple();
    g.aimAvailable = this.hook.aimAvailable && cfg.grappleEnabled;
    g.aimDistance = this.hook.aimDistance;
  }
}
