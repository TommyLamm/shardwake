// 音效的純邏輯（M1-13）：音量換算、隨機變化、變體挑選、節流、發聲數上限與搶占、事件數值對應。
// 不依賴 Web Audio，Vitest 直接測試；AudioEngine 與 AudioEvents 使用。
import { clamp, clamp01, lerp, smoothstep } from '@/core/math';
import type { Rng } from '@/core/Rng';

// ── 音量 ────────────────────────────────────────────────

/** dB → 線性增益。 */
export function dbToGain(db: number): number {
  return Math.pow(10, db / 20);
}

/** 線性增益 → dB（0 以下回傳 -Infinity）。 */
export function gainToDb(gain: number): number {
  return gain > 0 ? 20 * Math.log10(gain) : Number.NEGATIVE_INFINITY;
}

/**
 * 音量滑桿 0..1 → 線性增益（感知曲線 v^exponent；exponent 2 時 50% ≈ -12 dB）。
 * 0 一定是完全靜音；超出範圍的值夾住。
 */
export function volumeToGain(volume: number, exponent = 2): number {
  if (!Number.isFinite(volume) || volume <= 0) return 0;
  return Math.pow(Math.min(1, volume), Math.max(0.1, exponent));
}

/** 匯流排最終增益：設定音量（感知曲線）× 混音修正（dB）。 */
export function busGain(volume: number, trimDb: number, exponent = 2): number {
  return volumeToGain(volume, exponent) * dbToGain(trimDb);
}

// ── 隨機變化 ────────────────────────────────────────────

export interface Variation {
  /** 播放速率（音高）倍率。 */
  rate: number;
  /** 音量偏移（dB）。 */
  gainDb: number;
}

/** 每次播放的隨機變化：音高 ±pitch（比例，例如 0.03 = ±3%）、音量 ±volumeDb。 */
export function randomVariation(rng: Rng, pitch: number, volumeDb: number, out: Variation = { rate: 1, gainDb: 0 }): Variation {
  const p = Math.max(0, pitch);
  const v = Math.max(0, volumeDb);
  out.rate = 1 + (p > 0 ? rng.range(-p, p) : 0);
  out.gainDb = v > 0 ? rng.range(-v, v) : 0;
  return out;
}

/** 挑選變體：count > 1 時不重複上一次（last）。回傳 0..count-1。 */
export function pickVariant(rng: Rng, count: number, last: number): number {
  if (count <= 1) return 0;
  if (last < 0 || last >= count) return rng.int(0, count - 1);
  const i = rng.int(0, count - 2);
  return i >= last ? i + 1 : i;
}

// ── 節流 ────────────────────────────────────────────────

/** 同一音效在 minInterval 秒內只播一次（大量命中、霰彈彈孔、腳步）。 */
export class Throttle {
  private readonly last = new Map<string, number>();
  /** 被擋下的次數（監看）。 */
  blocked = 0;

  /** 允許播放時記錄時間並回傳 true。 */
  allow(id: string, now: number, minInterval: number): boolean {
    if (minInterval > 0) {
      const prev = this.last.get(id);
      if (prev !== undefined && now - prev < minInterval && now >= prev) {
        this.blocked++;
        return false;
      }
    }
    this.last.set(id, now);
    return true;
  }

  reset(): void {
    this.last.clear();
    this.blocked = 0;
  }
}

// ── 發聲數上限與搶占 ─────────────────────────────────────

export interface VoiceSlot {
  readonly index: number;
  /** 正在播放的音效 id（空槽為 ''）。 */
  soundId: string;
  category: string;
  priority: number;
  start: number;
  /** 預計結束時間（start + 長度 / 速率）。 */
  end: number;
}

export interface VoiceRequest {
  soundId: string;
  category: string;
  priority: number;
  /** 長度（s，已除以速率）。 */
  duration: number;
  /** 同一音效的同時發聲上限（0 = 不限）。 */
  maxInstances: number;
  /** 類別的同時發聲上限（0 = 不限）。 */
  categoryMax: number;
}

export interface VoiceAllocation {
  slot: VoiceSlot;
  /** 搶占了正在播放的聲音（需要先淡出舊的）。 */
  stolen: boolean;
}

/**
 * 固定數量的發聲槽（每槽一個常駐 GainNode／PannerNode）。規則：
 * 1. 同一音效已達 maxInstances → 搶占同音效最舊的一個。
 * 2. 類別已達 categoryMax → 搶占該類別中優先序 ≤ 新聲音、最舊的一個；沒有就丟棄新聲音。
 * 3. 有空槽就用空槽；全滿時搶占全部中優先序最低（同優先序取最舊）且 ≤ 新聲音的一個；沒有就丟棄。
 */
export class VoiceAllocator {
  readonly slots: VoiceSlot[];
  stats = { allocated: 0, stolen: 0, dropped: 0, peak: 0 };
  private readonly result: VoiceAllocation;

  constructor(readonly size: number) {
    this.slots = [];
    for (let i = 0; i < size; i++) this.slots.push({ index: i, soundId: '', category: '', priority: 0, start: 0, end: 0 });
    this.result = { slot: this.slots[0]!, stolen: false };
  }

  isActive(slot: VoiceSlot, now: number): boolean {
    return slot.soundId !== '' && slot.end > now;
  }

  /** 正在播放的數量（可指定類別或音效）。 */
  activeCount(now: number, filter?: { category?: string; soundId?: string }): number {
    let n = 0;
    for (const s of this.slots) {
      if (!this.isActive(s, now)) continue;
      if (filter?.category !== undefined && s.category !== filter.category) continue;
      if (filter?.soundId !== undefined && s.soundId !== filter.soundId) continue;
      n++;
    }
    return n;
  }

  /** 分配一個槽；回傳的物件重複使用。丟棄時回傳 null。 */
  allocate(req: VoiceRequest, now: number): VoiceAllocation | null {
    let target: VoiceSlot | null = null;
    let stolen = false;
    // 1. 同音效上限
    if (req.maxInstances > 0 && this.activeCount(now, { soundId: req.soundId }) >= req.maxInstances) {
      target = this.oldest(now, (s) => s.soundId === req.soundId);
      stolen = target !== null;
    }
    // 2. 類別上限
    if (!target && req.categoryMax > 0 && this.activeCount(now, { category: req.category }) >= req.categoryMax) {
      target = this.oldest(now, (s) => s.category === req.category && s.priority <= req.priority);
      if (!target) {
        this.stats.dropped++;
        return null;
      }
      stolen = true;
    }
    // 3. 空槽或全域搶占
    if (!target) {
      for (const s of this.slots) {
        if (!this.isActive(s, now)) {
          target = s;
          break;
        }
      }
    }
    if (!target) {
      let best: VoiceSlot | null = null;
      for (const s of this.slots) {
        if (s.priority > req.priority) continue;
        if (!best || s.priority < best.priority || (s.priority === best.priority && s.start < best.start)) best = s;
      }
      if (!best) {
        this.stats.dropped++;
        return null;
      }
      target = best;
      stolen = true;
    }
    target.soundId = req.soundId;
    target.category = req.category;
    target.priority = req.priority;
    target.start = now;
    target.end = now + Math.max(0, req.duration);
    this.stats.allocated++;
    if (stolen) this.stats.stolen++;
    const active = this.activeCount(now);
    if (active > this.stats.peak) this.stats.peak = active;
    this.result.slot = target;
    this.result.stolen = stolen;
    return this.result;
  }

  /** 提前結束一個槽（例如 stop）。 */
  release(slot: VoiceSlot): void {
    slot.soundId = '';
    slot.end = 0;
  }

  releaseAll(): void {
    for (const s of this.slots) this.release(s);
  }

  private oldest(now: number, pred: (s: VoiceSlot) => boolean): VoiceSlot | null {
    let best: VoiceSlot | null = null;
    for (const s of this.slots) {
      if (!this.isActive(s, now) || !pred(s)) continue;
      if (!best || s.start < best.start) best = s;
    }
    return best;
  }
}

// ── 事件數值對應 ─────────────────────────────────────────

/** 腳底表面 → 腳步音效 id（金屬／格柵／玻璃三種；混凝土歸金屬、能量歸玻璃、危險區歸格柵）。 */
export function footstepSoundId(surface: string | null | undefined): string {
  switch (surface) {
    case 'grate':
    case 'hazard':
      return 'step.grate';
    case 'glass':
    case 'energy':
      return 'step.glass';
    default:
      return 'step.metal';
  }
}

export interface LandingThresholds {
  /** 低於這個落地速度不出聲（m/s）。 */
  landMinSpeed: number;
  /** 這個速度以上算重落地。 */
  landHeavySpeed: number;
  /** 輕落地音量：landMinSpeed → landHeavySpeed 對應 landQuietDb → 0 dB。 */
  landQuietDb: number;
}

/** 落地速度 → 音效與音量；太輕回傳 null。 */
export function landingSound(impactSpeed: number, t: Readonly<LandingThresholds>): { id: string; gainDb: number } | null {
  if (!(impactSpeed >= t.landMinSpeed)) return null;
  if (impactSpeed >= t.landHeavySpeed) return { id: 'land.heavy', gainDb: 0 };
  const f = clamp01((impactSpeed - t.landMinSpeed) / Math.max(1e-6, t.landHeavySpeed - t.landMinSpeed));
  return { id: 'land.light', gainDb: lerp(t.landQuietDb, 0, f) };
}

/** 速度對應的音量（dB）：speedMin → speedMax 對應 quietDb → 0 dB（夾住）。 */
export function speedGainDb(speed: number, speedMin: number, speedMax: number, quietDb: number): number {
  const f = clamp01((speed - speedMin) / Math.max(1e-6, speedMax - speedMin));
  return lerp(quietDb, 0, f);
}

export interface WindParams {
  /** 開始有風聲的速度與最大風聲的速度（m/s，三維速度）。 */
  windMinSpeed: number;
  windMaxSpeed: number;
  /** 最大風聲的線性增益。 */
  windMaxGain: number;
  /** 播放速率：最小速度 → 最大速度。 */
  windRateMin: number;
  windRateMax: number;
}

/** 依速度變化的風聲：增益（smoothstep）與播放速率。 */
export function windLevel(speed: number, p: Readonly<WindParams>, out = { gain: 0, rate: 1 }): { gain: number; rate: number } {
  const f = smoothstep(p.windMinSpeed, p.windMaxSpeed, speed);
  out.gain = f * p.windMaxGain;
  out.rate = lerp(p.windRateMin, p.windRateMax, clamp01((speed - p.windMinSpeed) / Math.max(1e-6, p.windMaxSpeed - p.windMinSpeed)));
  return out;
}

export interface HeartbeatParams {
  /** 生命比例低於此值開始心跳。 */
  heartbeatThreshold: number;
  /** 心跳間隔：剛低於門檻 → 生命 0（s）。 */
  heartbeatSlow: number;
  heartbeatFast: number;
  /** 音量：剛低於門檻 → 生命 0（dB）。 */
  heartbeatQuietDb: number;
}

/** 低生命心跳：回傳間隔（s）與音量（dB）；不需要心跳時回傳 null。 */
export function heartbeat(healthFraction: number, alive: boolean, p: Readonly<HeartbeatParams>): { interval: number; gainDb: number } | null {
  if (!alive || !(healthFraction < p.heartbeatThreshold) || p.heartbeatThreshold <= 0) return null;
  const k = 1 - clamp(healthFraction, 0, 1) / p.heartbeatThreshold;
  return { interval: lerp(p.heartbeatSlow, p.heartbeatFast, k), gainDb: lerp(p.heartbeatQuietDb, 0, k) };
}
