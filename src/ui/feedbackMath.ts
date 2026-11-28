// 戰鬥回饋的純邏輯（M1-12；不碰 DOM，可無頭測試）：命中標記樣式、傷害數字（合併、池、飄動）、受擊方向、低生命暗角。
import { clamp, smoothstep } from '@/core/math';
import type { DamageIndicatorConfig, DamageNumberConfig, HitMarkerConfig } from '@/ui/FeedbackConfig';

// ── 命中標記 ───────────────────────────────────────────

export type MarkerKind = 'hit' | 'crit' | 'kill';

export interface HitMarkerStyle {
  visible: boolean;
  opacity: number;
  /** 臂長（px，已含放大）。 */
  size: number;
  scale: number;
  color: string;
  shakeX: number;
  shakeY: number;
}

/** 命中標記在 age 秒時的樣式：出現時放大後回到 1，後半段淡出；擊殺另有衰減的震動。 */
export function hitMarkerStyle(cfg: HitMarkerConfig, kind: MarkerKind, age: number, out?: HitMarkerStyle): HitMarkerStyle {
  const o = out ?? { visible: false, opacity: 0, size: 0, scale: 1, color: '', shakeX: 0, shakeY: 0 };
  const dur = kind === 'kill' ? cfg.killDuration : kind === 'crit' ? cfg.critDuration : cfg.duration;
  const base = kind === 'kill' ? cfg.killSize : kind === 'crit' ? cfg.critSize : cfg.size;
  o.color = kind === 'kill' ? cfg.colorKill : kind === 'crit' ? cfg.colorCrit : cfg.colorHit;
  if (!(age >= 0) || !(age < dur) || !(dur > 0)) {
    o.visible = false;
    o.opacity = 0;
    o.size = base;
    o.scale = 1;
    o.shakeX = 0;
    o.shakeY = 0;
    return o;
  }
  const t = age / dur;
  const pop = kind === 'kill' ? cfg.killPop : cfg.pop;
  // 前 25% 從 pop 縮回 1。
  o.scale = 1 + (pop - 1) * (1 - smoothstep(0, 0.25, t));
  o.opacity = 1 - smoothstep(0.45, 1, t);
  o.size = base * o.scale;
  o.visible = true;
  if (kind === 'kill' && cfg.killShake > 0) {
    const amp = cfg.killShake * (1 - t);
    const w = 2 * Math.PI * cfg.killShakeHz * age;
    o.shakeX = Math.sin(w) * amp;
    o.shakeY = Math.cos(w * 1.31) * amp * 0.6;
  } else {
    o.shakeX = 0;
    o.shakeY = 0;
  }
  return o;
}

// ── 傷害數字 ───────────────────────────────────────────

export interface DamageNumber {
  active: boolean;
  /** 合併鍵（目標物件）與是否爆頭（不同種類分開顯示）。 */
  key: unknown;
  crit: boolean;
  kill: boolean;
  amount: number;
  /** 錨點（世界座標）。 */
  x: number;
  y: number;
  z: number;
  /** 水平散開（px，-1..1 × spread）。 */
  jitter: number;
  /** 生成的時間、最後一次累加的時間（s）。 */
  born: number;
  lastAdd: number;
  /** 累加跳動 0..1（每次累加設為 1，之後衰減）。 */
  bump: number;
  /** 生成序號（回收最舊的）。 */
  serial: number;
}

/**
 * 傷害數字的資料池（固定容量，滿了回收最舊的）。add() 在 merge 開啟時把「同一目標、同爆頭種類、mergeWindow 內」的傷害累加到同一個數字。
 * 時間由呼叫端提供（模擬時間或畫面時間）。
 */
export class DamageNumberModel {
  readonly items: DamageNumber[];
  private serial = 0;
  private rngState = 0x9e3779b9;

  constructor(capacity: number) {
    this.items = [];
    for (let i = 0; i < Math.max(1, capacity); i++) {
      this.items.push({ active: false, key: null, crit: false, kill: false, amount: 0, x: 0, y: 0, z: 0, jitter: 0, born: 0, lastAdd: 0, bump: 0, serial: 0 });
    }
  }

  get activeCount(): number {
    let n = 0;
    for (const it of this.items) if (it.active) n++;
    return n;
  }

  /** 加入一筆傷害；回傳寫入（或累加）的數字。 */
  add(
    cfg: DamageNumberConfig,
    time: number,
    key: unknown,
    amount: number,
    crit: boolean,
    kill: boolean,
    x: number,
    y: number,
    z: number,
    merge: boolean,
  ): DamageNumber {
    if (merge && cfg.mergeWindow > 0) {
      for (const it of this.items) {
        if (it.active && it.key === key && it.crit === crit && time - it.lastAdd <= cfg.mergeWindow && time - it.born < cfg.life + cfg.mergeWindow * 8) {
          it.amount += amount;
          it.lastAdd = time;
          it.bump = 1;
          it.kill = it.kill || kill;
          return it;
        }
      }
    }
    let slot: DamageNumber | null = null;
    for (const it of this.items) {
      if (!it.active) {
        slot = it;
        break;
      }
    }
    if (!slot) {
      slot = this.items[0]!;
      for (const it of this.items) if (it.serial < slot.serial) slot = it;
    }
    slot.active = true;
    slot.key = key;
    slot.crit = crit;
    slot.kill = kill;
    slot.amount = amount;
    slot.x = x;
    slot.y = y;
    slot.z = z;
    slot.jitter = this.nextJitter();
    slot.born = time;
    slot.lastAdd = time;
    slot.bump = 0;
    slot.serial = ++this.serial;
    return slot;
  }

  /** 移除過期的數字並衰減跳動。 */
  update(cfg: DamageNumberConfig, time: number, dt: number): void {
    for (const it of this.items) {
      if (!it.active) continue;
      if (time - it.lastAdd >= cfg.life) {
        it.active = false;
        it.key = null;
        continue;
      }
      if (it.bump > 0) it.bump = Math.max(0, it.bump - dt * 8);
    }
  }

  clear(): void {
    for (const it of this.items) {
      it.active = false;
      it.key = null;
    }
  }

  private nextJitter(): number {
    // xorshift：確定性的 -1..1。
    let x = this.rngState;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.rngState = x >>> 0;
    return (this.rngState / 0xffffffff) * 2 - 1;
  }
}

export interface DamageNumberStyle {
  /** 畫面上的位移（px，相對錨點投影）。 */
  dx: number;
  dy: number;
  scale: number;
  opacity: number;
  color: string;
}

/** 數字在 time 時的外觀：出現時彈出、往上飄（ease-out）、最後 35% 淡出；爆頭與擊殺放大，依距離縮小。 */
export function damageNumberStyle(cfg: DamageNumberConfig, n: Readonly<DamageNumber>, time: number, distance: number, out?: DamageNumberStyle): DamageNumberStyle {
  const o = out ?? { dx: 0, dy: 0, scale: 1, opacity: 0, color: '' };
  const age = Math.max(0, time - n.born);
  const fadeAge = Math.max(0, time - n.lastAdd);
  const life = Math.max(1e-3, cfg.life);
  const rise = 1 - Math.pow(1 - clamp(age / life, 0, 1), 2);
  o.dy = -cfg.rise * rise;
  o.dx = n.jitter * cfg.spread * 0.5 * (0.3 + 0.7 * rise);
  const appear = 1 + 0.6 * (1 - smoothstep(0, 0.08, age));
  const kind = n.kill ? cfg.killScale : 1;
  const crit = n.crit ? cfg.critScale : 1;
  const dist = distance > cfg.refDistance ? Math.max(cfg.minScale, cfg.refDistance / distance) : 1;
  o.scale = appear * kind * crit * dist * (1 + cfg.mergeBump * n.bump);
  o.opacity = 1 - smoothstep(0.65, 1, fadeAge / life);
  o.color = n.kill ? cfg.colorKill : n.crit ? cfg.colorCrit : cfg.colorNormal;
  return o;
}

/** 顯示用的數字文字（四捨五入；小於 1 顯示一位小數）。 */
export function formatDamage(amount: number): string {
  if (!(amount > 0)) return '0';
  if (amount < 1) return amount.toFixed(1);
  return String(Math.round(amount));
}

// ── 受擊方向 ───────────────────────────────────────────

/**
 * 攻擊來源在畫面上的方向（弧度，0 = 正前方／畫面上方，正值 = 右邊，±π = 背後）。
 * yaw 為玩家視角（0 時面向 -Z，往左轉為正，與 InputSystem 相同）。只看水平方向。
 */
export function damageIndicatorAngle(yaw: number, px: number, pz: number, sx: number, sz: number): number {
  const dx = sx - px;
  const dz = sz - pz;
  // forward = (-sin yaw, -cos yaw)、right = (cos yaw, -sin yaw)（與 weaponMath.aimDirection 一致）。
  const f = -Math.sin(yaw) * dx - Math.cos(yaw) * dz;
  const r = Math.cos(yaw) * dx - Math.sin(yaw) * dz;
  if (Math.abs(f) < 1e-9 && Math.abs(r) < 1e-9) return 0;
  return Math.atan2(r, f);
}

export interface IndicatorSlot {
  active: boolean;
  /** 攻擊來源（世界座標，水平）；指示每畫面依目前視角重算方向，轉頭時跟著轉。 */
  sx: number;
  sz: number;
  born: number;
  blocked: boolean;
  /** 強度 0..1（依傷害）。 */
  weight: number;
}

/** 受擊方向指示的資料：同方向（mergeDeg 內，以加入時的角度判斷）合併、滿了取代最舊的。 */
export class DamageIndicatorModel {
  readonly slots: IndicatorSlot[];

  constructor(capacity: number) {
    this.slots = [];
    for (let i = 0; i < Math.max(1, capacity); i++) this.slots.push({ active: false, sx: 0, sz: 0, born: 0, blocked: false, weight: 0 });
  }

  add(
    cfg: DamageIndicatorConfig,
    time: number,
    yaw: number,
    px: number,
    pz: number,
    sx: number,
    sz: number,
    weight: number,
    blocked: boolean,
  ): IndicatorSlot {
    const angle = damageIndicatorAngle(yaw, px, pz, sx, sz);
    const merge = (cfg.mergeDeg * Math.PI) / 180;
    let slot: IndicatorSlot | null = null;
    for (const s of this.slots) {
      if (!s.active || time - s.born >= cfg.duration) continue;
      const a = damageIndicatorAngle(yaw, px, pz, s.sx, s.sz);
      if (Math.abs(wrap(a - angle)) <= merge) {
        slot = s;
        break;
      }
    }
    if (!slot) {
      for (const s of this.slots) {
        if (!s.active || time - s.born >= cfg.duration) {
          slot = s;
          break;
        }
      }
    }
    if (!slot) {
      slot = this.slots[0]!;
      for (const s of this.slots) if (s.born < slot.born) slot = s;
    }
    const fresh = !slot.active || time - slot.born >= cfg.duration;
    slot.active = true;
    slot.sx = sx;
    slot.sz = sz;
    slot.born = time;
    slot.blocked = blocked;
    slot.weight = fresh ? clamp(weight, 0, 1) : Math.min(1, Math.max(slot.weight, weight) + 0.15);
    return slot;
  }

  /** 指示在 time 時的不透明度（出現後 15% 時間保持，之後淡出）。 */
  opacity(cfg: DamageIndicatorConfig, slot: Readonly<IndicatorSlot>, time: number): number {
    if (!slot.active) return 0;
    const t = (time - slot.born) / Math.max(1e-3, cfg.duration);
    if (t >= 1 || t < 0) return 0;
    return (0.55 + 0.45 * slot.weight) * (1 - smoothstep(0.15, 1, t));
  }

  update(cfg: DamageIndicatorConfig, time: number): void {
    for (const s of this.slots) if (s.active && time - s.born >= cfg.duration) s.active = false;
  }

  clear(): void {
    for (const s of this.slots) s.active = false;
  }
}

function wrap(a: number): number {
  let x = a;
  while (x > Math.PI) x -= Math.PI * 2;
  while (x < -Math.PI) x += Math.PI * 2;
  return x;
}

// ── 低生命暗角 ─────────────────────────────────────────

/** 低生命暗角強度 0..1：生命比例 ≥ threshold 時 0，0 生命時 1（smoothstep）。 */
export function lowHealthIntensity(healthFraction: number, threshold: number): number {
  if (!(threshold > 0)) return 0;
  return 1 - smoothstep(0, threshold, clamp(healthFraction, 0, 1));
}

/** 受擊鏡頭震動：base + 傷害 × perDamage（上限 max），護盾破裂另加。 */
export function hitTrauma(amount: number, shieldBroken: boolean, c: { traumaBase: number; traumaPerDamage: number; traumaMax: number; shieldBreakTrauma: number }): number {
  if (!(amount > 0)) return 0;
  return Math.min(c.traumaMax, c.traumaBase + amount * c.traumaPerDamage) + (shieldBroken ? c.shieldBreakTrauma : 0);
}
