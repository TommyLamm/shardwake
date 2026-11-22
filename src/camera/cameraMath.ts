// 鏡頭手感的純函式與小型狀態（M1-08）：FOV 換算與速度對應、FOV 衝擊、彈簧衝量換算、傾斜目標、頭部晃動、
// 創傷式震動（trauma）、落地下沉量。全部與畫面更新率無關，可無頭測試。
import { DEG2RAD, TAU, clamp, clamp01, fbm1D, horizontalToVerticalFov, remapClamped, smoothstep, verticalToHorizontalFov } from '@/core/math';
import type { CameraConfig } from '@/camera/CameraConfig';

// ── FOV ─────────────────────────────────────────────────

export interface FovResult {
  /** 實際的水平／垂直 FOV（度；垂直夾住後再換回水平）。 */
  horizontal: number;
  vertical: number;
}

/**
 * 水平 FOV（度）→ 實際使用的水平／垂直 FOV。水平先夾在 [1, maxHorizontal]；
 * 換算出的垂直 FOV 超過 maxVertical 時夾住（直向畫面），水平值依夾住後的垂直值回推。
 */
export function resolveFov(hFov: number, aspect: number, maxHorizontal: number, maxVertical: number, out: FovResult): FovResult {
  const a = aspect > 0 && Number.isFinite(aspect) ? aspect : 1;
  const h = clamp(hFov, 1, Math.min(maxHorizontal, 179));
  let v = horizontalToVerticalFov(h, a);
  if (v > maxVertical) {
    v = maxVertical;
    out.horizontal = verticalToHorizontalFov(v, a);
  } else out.horizontal = h;
  out.vertical = v;
  return out;
}

/** 速度對應的 FOV 加成（水平度）：fovSpeedMin → fovSpeedMax 線性對應 0 → fovSpeedBonus。 */
export function speedFovBonus(speed: number, cfg: Pick<CameraConfig, 'fovSpeedMin' | 'fovSpeedMax' | 'fovSpeedBonus'>): number {
  if (cfg.fovSpeedMax <= cfg.fovSpeedMin) return speed >= cfg.fovSpeedMin ? cfg.fovSpeedBonus : 0;
  return remapClamped(speed, cfg.fovSpeedMin, cfg.fovSpeedMax, 0, cfg.fovSpeedBonus);
}

/** FOV 衝擊的包絡（0..1）：attack 內以 smoothstep 升起，之後 release 內以 smoothstep 回落到 0。 */
export function kickEnvelope(t: number, attack: number, release: number): number {
  if (t < 0) return 0;
  if (t < attack) return smoothstep(0, attack, t);
  const u = release > 0 ? (t - attack) / release : 1;
  return u >= 1 ? 0 : 1 - smoothstep(0, 1, u);
}

interface Kick {
  amount: number;
  attack: number;
  release: number;
  time: number;
}

/** 疊加的 FOV 衝擊（Dash、武器、爆炸）；固定容量，不配置記憶體。滿了時取代剩餘量最小的一個。 */
export class FovKicks {
  private readonly kicks: Kick[] = [];

  constructor(readonly capacity = 8) {
    for (let i = 0; i < capacity; i++) this.kicks.push({ amount: 0, attack: 0, release: 0, time: Infinity });
  }

  add(amount: number, release: number, attack: number): void {
    if (!(Math.abs(amount) > 0)) return;
    let slot = this.kicks[0]!;
    let best = Infinity;
    for (const k of this.kicks) {
      const remaining = Math.abs(this.valueOf(k));
      if (!this.active(k)) {
        slot = k;
        break;
      }
      if (remaining < best) {
        best = remaining;
        slot = k;
      }
    }
    slot.amount = amount;
    slot.attack = Math.max(0, attack);
    slot.release = Math.max(0, release);
    slot.time = 0;
  }

  update(dt: number): void {
    if (!(dt > 0)) return;
    for (const k of this.kicks) if (this.active(k)) k.time += dt;
  }

  /** 目前所有衝擊的總和（度）。 */
  get value(): number {
    let sum = 0;
    for (const k of this.kicks) if (this.active(k)) sum += this.valueOf(k);
    return sum;
  }

  get activeCount(): number {
    let n = 0;
    for (const k of this.kicks) if (this.active(k)) n++;
    return n;
  }

  clear(): void {
    for (const k of this.kicks) k.time = Infinity;
  }

  private active(k: Kick): boolean {
    return k.time < k.attack + k.release;
  }

  private valueOf(k: Kick): number {
    return k.amount * kickEnvelope(k.time, k.attack, k.release);
  }
}

// ── 彈簧衝量 ─────────────────────────────────────────────

/**
 * 彈簧（自然頻率 Hz、阻尼比）從靜止的目標位置被打入單位初速後，位移的最大值。
 * 衝量要達到峰值 p 時，初速 = p / springPeakPerVelocity(...)。與 core/math 的 SpringScalar 使用相同的模型。
 */
export function springPeakPerVelocity(frequency: number, dampingRatio: number): number {
  const w = TAU * frequency;
  if (!(w > 0)) return Infinity;
  const z = Math.max(0, dampingRatio);
  if (Math.abs(z - 1) < 1e-4) return 1 / (w * Math.E);
  if (z < 1) {
    const wd = w * Math.sqrt(1 - z * z);
    const t = Math.atan2(wd, z * w) / wd;
    return (Math.exp(-z * w * t) * Math.sin(wd * t)) / wd;
  }
  const s = Math.sqrt(z * z - 1);
  const r1 = -w * (z - s);
  const r2 = -w * (z + s);
  const t = Math.log(r2 / r1) / (r1 - r2);
  return (Math.exp(r1 * t) - Math.exp(r2 * t)) / (r1 - r2);
}

/** 要讓彈簧位移峰值為 peak 時應加的初速（peak 可為負）。 */
export function springImpulseForPeak(peak: number, frequency: number, dampingRatio: number): number {
  const k = springPeakPerVelocity(frequency, dampingRatio);
  return Number.isFinite(k) && k > 0 ? peak / k : 0;
}

// ── 落地 ─────────────────────────────────────────────────

/** 落地速度（m/s）→ 下沉量（m，正值）。 */
export function landingDipAmount(impactSpeed: number, cfg: Pick<CameraConfig, 'landMinImpact' | 'landMaxImpact' | 'landMaxDip'>): number {
  if (!(impactSpeed > cfg.landMinImpact)) return 0;
  if (cfg.landMaxImpact <= cfg.landMinImpact) return cfg.landMaxDip;
  return remapClamped(impactSpeed, cfg.landMinImpact, cfg.landMaxImpact, 0, cfg.landMaxDip);
}

/** 重落地的 trauma（低於門檻為 0）。 */
export function heavyLandingTrauma(
  impactSpeed: number,
  cfg: Pick<CameraConfig, 'heavyLandMinSpeed' | 'heavyLandMaxSpeed' | 'heavyLandTraumaMin' | 'heavyLandTraumaMax'>,
): number {
  if (!(impactSpeed >= cfg.heavyLandMinSpeed)) return 0;
  if (cfg.heavyLandMaxSpeed <= cfg.heavyLandMinSpeed) return cfg.heavyLandTraumaMax;
  return remapClamped(impactSpeed, cfg.heavyLandMinSpeed, cfg.heavyLandMaxSpeed, cfg.heavyLandTraumaMin, cfg.heavyLandTraumaMax);
}

// ── 傾斜 ─────────────────────────────────────────────────
// roll 慣例（three.js Euler 'YXZ' 的 z）：正值 = 鏡頭上方往左傾（畫面順時針轉）。

/** 鏡頭傾斜需要的玩家狀態。 */
export interface RollInput {
  state: string;
  /** 跑牆中的牆面法線（水平、朝牆外）。 */
  wallNormal: { x: number; z: number };
  velocity: { x: number; z: number };
}

/** 視線的水平右方向量（yaw 0 面向 -Z、正值向左轉）。 */
export function viewRight(yaw: number): { x: number; z: number } {
  return { x: Math.cos(yaw), z: -Math.sin(yaw) };
}

/**
 * 狀態對應的目標傾斜（度，未乘玩家設定的強度）：
 *   跑牆：朝牆外傾 wallRunRollDeg（依牆面法線在視線右方的分量，正對或背對牆時較小）；
 *   滑鏟：slideRollDeg × slideRollSide；
 *   地面、空中：往側移方向傾 strafeRollDeg（側向速度 / strafeRollSpeed）；其他狀態 0。
 */
export function rollTarget(input: RollInput, yaw: number, cfg: CameraConfig): number {
  const cy = Math.cos(yaw);
  const sy = -Math.sin(yaw);
  switch (input.state) {
    case 'wallRun': {
      const side = input.wallNormal.x * cy + input.wallNormal.z * sy;
      // 牆在右邊 → 法線指向左（side < 0）→ 上方往左傾（正 roll）。
      return -side * cfg.wallRunRollDeg;
    }
    case 'slide':
      return cfg.slideRollDeg * (cfg.slideRollSide < 0 ? -1 : 1);
    case 'ground':
    case 'air': {
      if (cfg.strafeRollSpeed <= 0) return 0;
      const lateral = input.velocity.x * cy + input.velocity.z * sy;
      // 往右移 → 上方往右傾（負 roll）。
      return -clamp(lateral / cfg.strafeRollSpeed, -1, 1) * cfg.strafeRollDeg;
    }
    default:
      return 0;
  }
}

/** 側向 Dash 的傾斜衝量（度）：往 Dash 方向傾；側向分量太小時為 0。 */
export function dashRollImpulse(dir: { x: number; z: number }, yaw: number, cfg: CameraConfig): number {
  const lateral = dir.x * Math.cos(yaw) - dir.z * Math.sin(yaw);
  if (Math.abs(lateral) < cfg.dashRollMinLateral) return 0;
  return -Math.sign(lateral) * cfg.dashRollDeg;
}

// ── 頭部晃動 ─────────────────────────────────────────────

export interface BobOffset {
  /** 垂直（m，正值往上）。 */
  vertical: number;
  /** 水平（m，正值往視線右方）。 */
  horizontal: number;
}

/**
 * 頭部晃動：phase 以「步」為單位（每 bobStride 公尺 +1）。垂直 = -A·cos(2π·phase)（每一步在最低點），
 * 水平 = H·sin(π·phase)（兩步一個週期）。幅度與速度成正比（參考速度時為 bobVertical／bobHorizontal），weight 0..1 淡入淡出。
 */
export function headBob(phase: number, speed: number, weight: number, cfg: CameraConfig, out: BobOffset): BobOffset {
  const ref = cfg.bobReferenceSpeed > 0 ? cfg.bobReferenceSpeed : 1;
  const scale = clamp(speed / ref, 0, cfg.bobMaxScale) * clamp01(weight);
  out.vertical = -cfg.bobVertical * scale * Math.cos(TAU * phase);
  out.horizontal = cfg.bobHorizontal * scale * Math.sin(Math.PI * phase);
  return out;
}

// ── 創傷式震動 ───────────────────────────────────────────

export interface ShakeOffset {
  /** 旋轉（弧度）。 */
  yaw: number;
  pitch: number;
  roll: number;
  /** 位移（m，相機座標：右、上、後）。 */
  x: number;
  y: number;
  z: number;
}

const SHAKE_SEEDS = [11, 23, 37, 41, 53, 67] as const;

/**
 * 創傷式震動：addTrauma 累加（上限 1），每秒線性衰減 traumaDecay；
 * 震動量 = trauma^traumaExponent，位移與旋轉 = 震動量 × 最大值 × 雜訊（時間 × 頻率）。
 */
export class Trauma {
  value = 0;
  /** 雜訊用的時間（s）。 */
  time = 0;

  add(amount: number): void {
    if (!(amount > 0)) return;
    this.value = Math.min(1, this.value + amount);
  }

  update(dt: number, decay: number): void {
    if (!(dt > 0)) return;
    this.time += dt;
    this.value = Math.max(0, this.value - Math.max(0, decay) * dt);
  }

  /** 震動量 0..1。 */
  shake(exponent: number): number {
    return this.value <= 0 ? 0 : Math.pow(this.value, Math.max(0.01, exponent));
  }

  clear(): void {
    this.value = 0;
  }

  /** 計算震動偏移；strength 為玩家設定的強度 0..1。 */
  sample(cfg: CameraConfig, strength: number, out: ShakeOffset): ShakeOffset {
    const s = this.shake(cfg.traumaExponent) * clamp01(strength);
    if (s <= 0) {
      out.yaw = out.pitch = out.roll = out.x = out.y = out.z = 0;
      return out;
    }
    const t = this.time * cfg.shakeFrequency;
    out.yaw = s * cfg.shakeYawDeg * DEG2RAD * fbm1D(t, 2, SHAKE_SEEDS[0]);
    out.pitch = s * cfg.shakePitchDeg * DEG2RAD * fbm1D(t, 2, SHAKE_SEEDS[1]);
    out.roll = s * cfg.shakeRollDeg * DEG2RAD * fbm1D(t, 2, SHAKE_SEEDS[2]);
    out.x = s * cfg.shakeOffset * fbm1D(t, 2, SHAKE_SEEDS[3]);
    out.y = s * cfg.shakeOffset * fbm1D(t, 2, SHAKE_SEEDS[4]);
    out.z = s * cfg.shakeOffset * 0.5 * fbm1D(t, 2, SHAKE_SEEDS[5]);
    return out;
  }
}

/** 爆炸等點狀來源的 trauma：amount × (1 - 距離 / 半徑)²，半徑外為 0。 */
export function traumaFalloff(amount: number, distance: number, radius: number): number {
  if (!(radius > 0) || !(distance < radius)) return 0;
  const k = 1 - Math.max(0, distance) / radius;
  return amount * k * k;
}

// ── 速度線 ───────────────────────────────────────────────

/** 速度線的目標強度 0..1：水平速度 minSpeed 以下為 0，fullSpeed 時為 1（smoothstep）。 */
export function speedLinesTarget(speed: number, minSpeed: number, fullSpeed: number): number {
  if (!(speed > minSpeed)) return 0;
  if (fullSpeed <= minSpeed) return 1;
  return smoothstep(minSpeed, fullSpeed, speed);
}
