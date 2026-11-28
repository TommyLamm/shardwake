// HUD 的純邏輯（M1-14，可無頭測試）：版面縮放、數值格式化、受擊延遲條、提示訊息佇列、冷卻與充能的顯示值。
import type { StringKey } from '@/i18n/zh-TW';
import type { HudLayoutConfig, HudMessageConfig, HudVitalsConfig } from '@/ui/HudConfig';

// ── 版面 ─────────────────────────────────────────────────

export interface HudLayout {
  /** 元件縮放（px 乘數）。 */
  scale: number;
  /** HUD 安全區寬度（px；超寬螢幕時小於畫面寬度、置中）。 */
  safeWidth: number;
  /** 安全區邊距（px，已乘 scale）。 */
  margin: number;
}

/** 依 iframe 尺寸（CSS px）計算 HUD 縮放與安全區。 */
export function hudLayout(width: number, height: number, cfg: Readonly<HudLayoutConfig>, out?: HudLayout): HudLayout {
  const o = out ?? { scale: 1, safeWidth: 0, margin: 0 };
  const w = width > 0 && Number.isFinite(width) ? width : 1;
  const hgt = height > 0 && Number.isFinite(height) ? height : 1;
  const short = Math.min(w, hgt);
  const ref = cfg.refShortSide > 0 ? cfg.refShortSide : 1080;
  const user = cfg.userScale > 0 ? cfg.userScale : 1;
  const lo = Math.min(cfg.minScale, cfg.maxScale);
  const hi = Math.max(cfg.minScale, cfg.maxScale);
  o.scale = Math.min(hi, Math.max(lo, (short / ref) * user));
  const maxW = cfg.safeMaxAspect > 0 ? hgt * cfg.safeMaxAspect : w;
  o.safeWidth = Math.min(w, maxW);
  o.margin = Math.max(0, cfg.margin) * o.scale;
  return o;
}

/** 選單的縮放：同樣依短邊，但範圍較窄（720p 仍要能看清楚設定文字、4K 不會過大）。 */
export function menuScale(width: number, height: number, cfg: Readonly<Pick<HudLayoutConfig, 'refShortSide' | 'menuMinScale' | 'menuMaxScale'>>): number {
  const short = Math.min(width > 0 ? width : 1, height > 0 ? height : 1);
  const ref = cfg.refShortSide > 0 ? cfg.refShortSide : 1080;
  const lo = Math.min(cfg.menuMinScale, cfg.menuMaxScale);
  const hi = Math.max(cfg.menuMinScale, cfg.menuMaxScale);
  return Math.min(hi, Math.max(lo, short / ref));
}

// ── 格式化 ───────────────────────────────────────────────

/** 整數顯示（無限為 ∞；負數與 NaN 為 0）。 */
export function formatCount(n: number, infinite = '∞'): string {
  if (n === Number.POSITIVE_INFINITY) return infinite;
  if (!Number.isFinite(n) || n <= 0) return '0';
  return String(Math.floor(n));
}

export type AmmoTone = 'ok' | 'low' | 'empty';

/** 彈藥數字的警示色：空 → empty、低於 lowFraction → low。 */
export function ammoTone(ammo: number, mag: number, lowFraction: number): AmmoTone {
  if (!(ammo > 0)) return 'empty';
  if (mag > 0 && ammo / mag <= lowFraction + 1e-9 && ammo < mag) return 'low';
  return 'ok';
}

const FIRE_MODE_KEYS: Readonly<Record<string, StringKey>> = {
  auto: 'hud.fireMode.auto',
  semi: 'hud.fireMode.semi',
  burst: 'hud.fireMode.burst',
  pump: 'hud.fireMode.pump',
};

/** 射擊模式的字串 key（未知模式為半自動）。 */
export function fireModeKey(mode: string): StringKey {
  return FIRE_MODE_KEYS[mode] ?? 'hud.fireMode.semi';
}

/** 計時器：m:ss.cc（一小時以上 h:mm:ss.cc）；負數或非有限值為「-:--.--」。 */
export function formatTimer(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '-:--.--';
  const cs = Math.floor(seconds * 100 + 1e-6);
  const c = cs % 100;
  const totalS = Math.floor(cs / 100);
  const s = totalS % 60;
  const totalM = Math.floor(totalS / 60);
  const m = totalM % 60;
  const hr = Math.floor(totalM / 60);
  const pad = (v: number): string => String(v).padStart(2, '0');
  return hr > 0 ? `${hr}:${pad(m)}:${pad(s)}.${pad(c)}` : `${totalM}:${pad(s)}.${pad(c)}`;
}

/** 分段時間差：+0.42／-1.20（四捨五入到 0.01 s；0 為 ±0.00）。 */
export function formatDelta(seconds: number): string {
  if (!Number.isFinite(seconds)) return '';
  const cs = Math.round(Math.abs(seconds) * 100);
  if (cs === 0) return '±0.00';
  const sign = seconds > 0 ? '+' : '-';
  return `${sign}${Math.floor(cs / 100)}.${String(cs % 100).padStart(2, '0')}`;
}

/** 距離顯示（公尺，整數）。 */
export function formatMeters(m: number): string {
  return Number.isFinite(m) && m > 0 ? String(Math.round(m)) : '0';
}

/** 0..1 的比例（非有限值為 0）。 */
export function fraction(value: number, max: number): number {
  if (!(max > 0) || !Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value / max));
}

/** 冷卻進度：0 = 剛開始冷卻、1 = 可用。 */
export function cooldownProgress(remaining: number, total: number): number {
  if (!(remaining > 0)) return 1;
  if (!(total > 0)) return 0;
  return Math.min(1, Math.max(0, 1 - remaining / total));
}

/** SVG 圓環的 stroke-dashoffset：progress 0..1 → 剩下的空白長度。 */
export function ringDashOffset(progress: number, circumference: number): number {
  const p = Math.min(1, Math.max(0, Number.isFinite(progress) ? progress : 0));
  return circumference * (1 - p);
}

/**
 * Dash 充能格的填滿量：已充好的格為 1、正在回充的那一格為 progress、其他為 0。
 * 寫入 out（長度 = maxCharges）。
 */
export function chargePips(charges: number, maxCharges: number, progress: number, out: number[]): number[] {
  const n = Math.max(0, Math.floor(maxCharges));
  out.length = n;
  const full = Math.min(n, Math.max(0, Math.floor(charges + 1e-9)));
  for (let i = 0; i < n; i++) {
    if (i < full) out[i] = 1;
    else if (i === full) out[i] = Math.min(1, Math.max(0, Number.isFinite(progress) ? progress : 0));
    else out[i] = 0;
  }
  return out;
}

// ── 受擊延遲條 ───────────────────────────────────────────

/**
 * 受擊延遲條：value 立即跟著實際值；trail 在扣血時停留 trailDelay 秒，然後以 trailRate（每秒佔滿條的比例）追上。
 * 回復時 trail 直接跟上（只有受擊顯示延遲）。數值都是 0..1 的比例。
 */
export class DelayedBar {
  value = 1;
  trail = 1;
  private wait = 0;

  constructor(private readonly cfg: Readonly<Pick<HudVitalsConfig, 'trailDelay' | 'trailRate'>>) {}

  reset(v: number): void {
    this.value = this.trail = clamp01(v);
    this.wait = 0;
  }

  update(target: number, dt: number): void {
    const v = clamp01(target);
    if (v < this.value - 1e-9) this.wait = this.cfg.trailDelay;
    this.value = v;
    if (this.trail <= v) {
      this.trail = v;
      this.wait = 0;
      return;
    }
    const d = Math.max(0, dt);
    if (this.wait > 0) {
      this.wait -= d;
      if (this.wait > 0) return;
      // 超過等待時間的部分拿來追。
      const extra = -this.wait;
      this.wait = 0;
      this.trail = Math.max(v, this.trail - this.cfg.trailRate * extra);
      return;
    }
    this.trail = Math.max(v, this.trail - this.cfg.trailRate * d);
  }
}

function clamp01(v: number): number {
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
}

// ── 提示訊息佇列 ─────────────────────────────────────────

export type MessageTone = 'info' | 'good' | 'warn';

export interface HudMessage {
  id: number;
  key: string | null;
  text: string;
  tone: MessageTone;
  /** 剩餘時間（s）。 */
  remaining: number;
  duration: number;
}

export interface MessageOptions {
  /** 相同 key 的訊息會更新內容並重新計時（不重複堆疊）。 */
  key?: string;
  duration?: number;
  tone?: MessageTone;
}

/**
 * 上方的提示訊息佇列：最新的在最前面；同 key 合併；超過 maxVisible 時最舊的先移除。
 * `version` 在內容改變時遞增（DOM 只在 version 改變時重建清單）。
 */
export class MessageQueue {
  readonly items: HudMessage[] = [];
  version = 0;
  private nextId = 1;

  constructor(private readonly cfg: Readonly<Pick<HudMessageConfig, 'duration' | 'maxVisible' | 'fadeOut'>>) {}

  push(text: string, opts: MessageOptions = {}): HudMessage {
    const duration = opts.duration ?? this.cfg.duration;
    const key = opts.key ?? null;
    if (key !== null) {
      const i = this.items.findIndex((m) => m.key === key);
      if (i >= 0) {
        const m = this.items[i]!;
        m.text = text;
        m.tone = opts.tone ?? m.tone;
        m.remaining = m.duration = duration;
        this.items.splice(i, 1);
        this.items.unshift(m);
        this.version++;
        return m;
      }
    }
    const m: HudMessage = { id: this.nextId++, key, text, tone: opts.tone ?? 'info', remaining: duration, duration };
    this.items.unshift(m);
    const max = Math.max(1, Math.floor(this.cfg.maxVisible));
    if (this.items.length > max) this.items.length = max;
    this.version++;
    return m;
  }

  /** 移除指定 key 的訊息。 */
  dismiss(key: string): boolean {
    const i = this.items.findIndex((m) => m.key === key);
    if (i < 0) return false;
    this.items.splice(i, 1);
    this.version++;
    return true;
  }

  clear(): void {
    if (this.items.length === 0) return;
    this.items.length = 0;
    this.version++;
  }

  update(dt: number): void {
    let removed = false;
    for (let i = this.items.length - 1; i >= 0; i--) {
      const m = this.items[i]!;
      m.remaining -= Math.max(0, dt);
      if (m.remaining <= 0) {
        this.items.splice(i, 1);
        removed = true;
      }
    }
    if (removed) this.version++;
  }

  /** 訊息的不透明度（最後 fadeOut 秒淡出）。 */
  opacity(m: Readonly<HudMessage>): number {
    const f = this.cfg.fadeOut;
    if (!(f > 0)) return m.remaining > 0 ? 1 : 0;
    return Math.min(1, Math.max(0, m.remaining / f));
  }
}

// ── 計時器（M1-15 計時賽寫入，HUD 只顯示）─────────────────

export interface TimerSplit {
  label: string;
  time: number;
  /** 與最佳成績的差（s；沒有最佳成績時為 null）。 */
  delta: number | null;
}

export interface TimerState {
  visible: boolean;
  /** 目前時間（s）。 */
  time: number;
  running: boolean;
  /** 最佳時間（s；沒有時為 null）。 */
  best: number | null;
  /** 最近的分段（顯示最後一筆）。 */
  splits: TimerSplit[];
}

export function createTimerState(): TimerState {
  return { visible: false, time: 0, running: false, best: null, splits: [] };
}

// ── 更新節流（M1-16）──────────────────────────────────

/**
 * HUD 元件的更新節流：高更新率（例如 240 FPS）時，DOM 只以 hz 更新，元件收到累計的 dt（動畫速度不變）。
 * hz ≤ 0 = 每畫面更新；dt ≤ 0（第一個畫面、無頭測試）也立即更新。準星與命中標記不經過這裡（每畫面更新）。
 */
export class UpdateThrottle {
  private accReal = 0;
  private accSim = 0;
  private force = false;
  /** 本次要交給元件的累計 dt（tick 回傳 true 時有效）。 */
  readonly out = { realDt: 0, dt: 0 };

  tick(realDt: number, dt: number, hz: number): boolean {
    this.accReal += Math.max(0, realDt);
    this.accSim += Math.max(0, dt);
    if (!this.force && hz > 0 && realDt > 0 && this.accReal < 1 / hz - 1e-6) return false;
    this.force = false;
    this.out.realDt = this.accReal;
    this.out.dt = this.accSim;
    this.accReal = 0;
    this.accSim = 0;
    return true;
  }

  /** 下一次 tick 立即更新（例如重新顯示、重設）。 */
  flush(): void {
    this.force = true;
  }

  reset(): void {
    this.accReal = 0;
    this.accSim = 0;
  }
}