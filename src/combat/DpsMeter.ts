// DPS 計（M1-12）與武器 DPS 預估：靶場看板顯示最近 window 秒的滾動 DPS、總傷害、爆頭率。
//
// - 一次「交戰」從第一筆傷害開始；超過 idleReset 秒沒有傷害後，下一筆傷害開始新的交戰（總傷害、命中數、爆頭率歸零）。
// - 滾動 DPS = 最近 window 秒內的傷害總和 ÷ 有效時間；有效時間 = clamp(現在 − 交戰開始, minSpan, window)。
//   交戰超過 window 秒後就是標準的滾動平均（例如 600 RPM × 18 → 180）；剛開始時用實際經過時間，不會被 window 稀釋。
// - 傷害量用 DamageInfo.amount（套用衰減、弱點之後、目標血量上限之前），與預估值可以直接比較。
import { falloffMultiplier } from '@/combat/Damage';
import type { WeaponDef } from '@/weapons/WeaponDef';

export interface DpsMeterConfig {
  /** 滾動視窗（s）。 */
  window: number;
  /** 沒有傷害超過這段時間（s）後，下一筆傷害開始新的交戰。 */
  idleReset: number;
  /** 有效時間的下限（s；交戰剛開始時避免除以很小的數）。 */
  minSpan: number;
}

export const DPS_METER_CONFIG: DpsMeterConfig = { window: 5, idleReset: 5, minSpan: 1 };

export interface DpsSnapshot {
  dps: number;
  total: number;
  hits: number;
  crits: number;
  /** 爆頭率 0..1（以傷害筆數計）。 */
  critRate: number;
  /** 交戰時間（s：開始到最後一筆傷害）。 */
  duration: number;
  /** 最後一筆傷害的武器 id。 */
  weaponId: string;
}

export class DpsMeter {
  readonly config: DpsMeterConfig;
  total = 0;
  hits = 0;
  crits = 0;
  engagementStart = -Infinity;
  lastHit = -Infinity;
  weaponId = '';
  private times: Float64Array;
  private amounts: Float64Array;
  private head = 0;
  private count = 0;

  constructor(config: DpsMeterConfig = DPS_METER_CONFIG, capacity = 4096) {
    this.config = config;
    this.times = new Float64Array(capacity);
    this.amounts = new Float64Array(capacity);
  }

  /** 記錄一筆傷害（time 為模擬時間，須單調不減）。 */
  record(time: number, amount: number, isCrit: boolean, weaponId = ''): void {
    if (!(amount >= 0)) return;
    if (!(time - this.lastHit <= this.config.idleReset)) {
      this.engagementStart = time;
      this.total = 0;
      this.hits = 0;
      this.crits = 0;
      this.count = 0;
      this.head = 0;
    }
    this.lastHit = time;
    this.total += amount;
    this.hits++;
    if (isCrit) this.crits++;
    if (weaponId) this.weaponId = weaponId;
    const cap = this.times.length;
    if (this.count >= cap) this.grow();
    const i = (this.head + this.count) % this.times.length;
    this.times[i] = time;
    this.amounts[i] = amount;
    this.count++;
  }

  /** 最近 window 秒內（time ∈ (now − window, now]）的傷害總和。 */
  windowDamage(now: number): number {
    this.prune(now);
    let sum = 0;
    const cap = this.times.length;
    for (let k = 0; k < this.count; k++) {
      const i = (this.head + k) % cap;
      if (this.times[i]! <= now) sum += this.amounts[i]!;
    }
    return sum;
  }

  /** 滾動 DPS（沒有傷害時 0）。 */
  dps(now: number): number {
    const sum = this.windowDamage(now);
    if (!(sum > 0)) return 0;
    const c = this.config;
    const span = Math.min(c.window, Math.max(c.minSpan, now - this.engagementStart));
    return sum / span;
  }

  get critRate(): number {
    return this.hits > 0 ? this.crits / this.hits : 0;
  }

  snapshot(now: number, out: DpsSnapshot = { dps: 0, total: 0, hits: 0, crits: 0, critRate: 0, duration: 0, weaponId: '' }): DpsSnapshot {
    out.dps = this.dps(now);
    out.total = this.total;
    out.hits = this.hits;
    out.crits = this.crits;
    out.critRate = this.critRate;
    out.duration = this.hits > 0 ? Math.max(0, this.lastHit - this.engagementStart) : 0;
    out.weaponId = this.weaponId;
    return out;
  }

  reset(): void {
    this.total = 0;
    this.hits = 0;
    this.crits = 0;
    this.count = 0;
    this.head = 0;
    this.engagementStart = -Infinity;
    this.lastHit = -Infinity;
    this.weaponId = '';
  }

  private prune(now: number): void {
    const cut = now - this.config.window;
    const cap = this.times.length;
    while (this.count > 0 && this.times[this.head]! <= cut) {
      this.head = (this.head + 1) % cap;
      this.count--;
    }
  }

  private grow(): void {
    const cap = this.times.length;
    const t = new Float64Array(cap * 2);
    const a = new Float64Array(cap * 2);
    for (let k = 0; k < this.count; k++) {
      const i = (this.head + k) % cap;
      t[k] = this.times[i]!;
      a[k] = this.amounts[i]!;
    }
    this.times = t;
    this.amounts = a;
    this.head = 0;
  }
}

export interface DpsEstimateOptions {
  /** 目標距離（m；距離衰減）。 */
  distance?: number;
  /** 命中弱點的比例 0..1。 */
  critFraction?: number;
  /** 投射物：直擊時受到的範圍傷害倍率（目標中心離爆炸點的範圍衰減；0 = 不計範圍傷害）。 */
  splashMult?: number;
}

export interface DpsEstimate {
  /** 每發（所有彈丸）的傷害。 */
  perShot: number;
  /** 每秒發數。 */
  shotsPerSec: number;
  /** 不換彈的爆發 DPS。 */
  burst: number;
  /** 含換彈的持續 DPS（打空 → 空倉換彈 → 再打空的循環）。 */
  sustained: number;
  /** 一個循環的時間（s）。 */
  cycle: number;
}

/** 依 WeaponDef 預估 DPS（靶場實測比較用；不含散布落空、開鏡與切槍）。 */
export function estimateWeaponDps(def: Readonly<WeaponDef>, options: DpsEstimateOptions = {}): DpsEstimate {
  const d = def.damage;
  const distance = options.distance ?? 0;
  const critFraction = Math.max(0, Math.min(1, options.critFraction ?? 0));
  const falloff = falloffMultiplier(distance, d.falloffStart, d.falloffEnd, d.minMult);
  const critAvg = 1 + critFraction * (d.critMult - 1);
  const direct = d.base * falloff * critAvg * Math.max(1, def.fire.pellets);
  const splash = def.projectile ? def.projectile.splashDamage * (options.splashMult ?? 0) : 0;
  const perShot = direct + splash;
  const fire = def.fire;
  let shotsPerSec = fire.rpm / 60;
  if (fire.mode === 'burst' && fire.burstCount && fire.burstCount > 1) shotsPerSec = (fire.rpm / 60) * fire.burstCount;
  const ammo = def.ammo;
  const mag = Math.max(1, ammo.mag);
  const reload = ammo.reloadPerShell !== undefined && ammo.reloadPerShell > 0 ? ammo.reloadEmpty + mag * ammo.reloadPerShell : ammo.reloadEmpty;
  // 打空一個彈匣：第一發在 0，最後一發在 (mag − 1) / rate；空倉換彈從下一發的時間點開始（自動換彈）。
  const cycle = mag / shotsPerSec + reload;
  return {
    perShot,
    shotsPerSec,
    burst: perShot * shotsPerSec,
    sustained: (perShot * mag) / cycle,
    cycle,
  };
}
