// 武器的純數學（無頭測試直接驗證）：散布、瞄準方向、後座偏移與回正。
// 所有「隨時間回復」都是線性、夾在 0 的函式：recover(recover(x, a), b) = recover(x, a + b)，
// 所以把一段時間切成幾步（任何步長）結果都一樣——武器邏輯與畫面更新率、模擬頻率無關。
import { DEG2RAD, clamp01, lerp } from '@/core/math';
import type { Rng } from '@/core/Rng';
import type { Vec3Like } from '@/physics/Physics';
import type { RecoilDef, SpreadDef } from '@/weapons/WeaponDef';

/** 線性回復到 0（rate 每秒）。 */
export function recoverLinear(value: number, rate: number, dt: number): number {
  if (!(dt > 0) || !(rate > 0)) return value;
  return Math.max(0, value - rate * dt);
}

/**
 * 基礎散布（度）：依開鏡進度在腰射與開鏡之間內插，乘上移動倍率（moveFactor 0..1 依速度）與空中倍率。
 */
export function baseSpread(spread: Readonly<SpreadDef>, adsProgress: number, moveFactor: number, airborne: boolean): number {
  const a = clamp01(adsProgress);
  const base = lerp(spread.hip, spread.ads, a);
  const move = lerp(1, spread.moveMult, clamp01(moveFactor));
  return base * move * (airborne ? spread.airMult : 1);
}

/** 錐形內均勻取樣（圓盤面積均勻）：回傳 [右, 上] 偏移（度），半徑 ≤ spreadDeg。 */
export function sampleSpreadOffset(rng: Rng, spreadDeg: number, out: { x: number; y: number }): { x: number; y: number } {
  if (!(spreadDeg > 0)) {
    out.x = 0;
    out.y = 0;
    return out;
  }
  const r = spreadDeg * Math.sqrt(rng.float());
  const a = rng.float() * Math.PI * 2;
  out.x = r * Math.cos(a);
  out.y = r * Math.sin(a);
  return out;
}

/**
 * 視線方向（yaw／pitch 弧度，M1-03 慣例：yaw 0 面向 -Z、正值向左；pitch 正值抬頭）
 * 加上 [右, 上] 角度偏移（度），寫入 out（單位向量）。
 */
export function aimDirection(yaw: number, pitch: number, rightDeg: number, upDeg: number, out: Vec3Like): Vec3Like {
  const sy = Math.sin(yaw);
  const cy = Math.cos(yaw);
  const sp = Math.sin(pitch);
  const cp = Math.cos(pitch);
  // forward、right、up 互相垂直。
  const fx = -sy * cp;
  const fy = sp;
  const fz = -cy * cp;
  const rx = cy;
  const rz = -sy;
  const ux = sp * sy;
  const uy = cp;
  const uz = sp * cy;
  const tr = Math.tan(rightDeg * DEG2RAD);
  const tu = Math.tan(upDeg * DEG2RAD);
  const x = fx + rx * tr + ux * tu;
  const y = fy + uy * tu;
  const z = fz + rz * tr + uz * tu;
  const len = Math.hypot(x, y, z) || 1;
  out.x = x / len;
  out.y = y / len;
  out.z = z / len;
  return out;
}

/** 兩個單位向量的夾角（度）。 */
export function angleBetweenDeg(a: Readonly<Vec3Like>, b: Readonly<Vec3Like>): number {
  const d = Math.min(1, Math.max(-1, a.x * b.x + a.y * b.y + a.z * b.z));
  return (Math.acos(d) * 180) / Math.PI;
}

/** 開鏡過渡的曲線：ease 0 = 線性、1 = smoothstep。 */
export function adsEase(progress: number, ease: number): number {
  const t = clamp01(progress);
  const s = t * t * (3 - 2 * t);
  return lerp(t, s, clamp01(ease));
}

/**
 * 後座偏移（度，視角慣例：pitch 正值往上、yaw 正值往左），疊加到 ViewAngles 的 offset。
 * - kick()：每發加上增量（隨機範圍＋偏向；第一發倍率、開鏡倍率；pitch 累積不超過 maxClimb）。
 * - recover()：停火 recoveryDelay 後以 recoveryPerSec（度/秒）沿偏移方向線性回正到 0，只回正偏移本身。
 * - absorb()：玩家朝偏移反方向轉動（壓槍）時，先抵掉偏移並把同樣的量轉進玩家視角，畫面不跳；
 *   回正就不會把玩家壓下去的量再拉回來（不抵銷玩家自己的壓槍）。
 * 統計：accumulated（累積加上的量）、recovered（回正的量）、absorbed（被壓槍吸收的量），皆為度。
 */
export class RecoilState {
  pitch = 0;
  yaw = 0;
  lastShotTime = Number.NEGATIVE_INFINITY;
  /** 回正參數（取自最後一次開火的武器；切槍後照舊回正）。 */
  recoveryDelay = 0;
  recoveryPerSec = 0;
  accumulated = 0;
  recovered = 0;
  absorbed = 0;
  /** 最後一次 kick 是否算「第一發」。 */
  lastWasFirst = false;

  get magnitude(): number {
    return Math.hypot(this.pitch, this.yaw);
  }

  /** 是否為第一發：距上一發超過 max(recoveryDelay, 1.5 × 射擊間隔)。 */
  isFirstShot(time: number, recoil: Readonly<RecoilDef>, interval: number): boolean {
    return time - this.lastShotTime > Math.max(recoil.recoveryDelay, interval * 1.5) + 1e-9;
  }

  /** 在 time 開一槍：加上後座增量。回傳這一發實際加上的 [pitch, yaw]（度）。 */
  kick(
    time: number,
    recoil: Readonly<RecoilDef>,
    adsProgress: number,
    interval: number,
    rng: Rng,
    out: { pitch: number; yaw: number },
  ): { pitch: number; yaw: number } {
    const first = this.isFirstShot(time, recoil, interval);
    this.lastWasFirst = first;
    const mult = (first ? recoil.firstShotMult : 1) * lerp(1, recoil.adsMult, clamp01(adsProgress));
    let dp = rng.range(recoil.pitchPerShot[0], recoil.pitchPerShot[1]) * mult;
    // yaw 資料是「往右為正」，視角是「往左為正」。
    const dy = -(rng.range(recoil.yawPerShot[0], recoil.yawPerShot[1]) + recoil.yawBias) * mult;
    if (dp > 0) dp = Math.max(0, Math.min(dp, recoil.maxClimb - this.pitch));
    this.pitch += dp;
    this.yaw += dy;
    this.accumulated += Math.hypot(dp, dy);
    this.lastShotTime = time;
    this.recoveryDelay = recoil.recoveryDelay;
    this.recoveryPerSec = recoil.recoveryPerSec;
    out.pitch = dp;
    out.yaw = dy;
    return out;
  }

  /** 從 from 回正到 to（模擬時間，秒）。 */
  recover(from: number, to: number): void {
    const start = Math.max(from, this.lastShotTime + this.recoveryDelay);
    if (!(to > start) || !(this.recoveryPerSec > 0)) return;
    const mag = this.magnitude;
    if (mag <= 0) return;
    const amount = this.recoveryPerSec * (to - start);
    if (amount >= mag) {
      this.recovered += mag;
      this.pitch = 0;
      this.yaw = 0;
      return;
    }
    const k = (mag - amount) / mag;
    this.recovered += amount;
    this.pitch *= k;
    this.yaw *= k;
  }

  /**
   * 壓槍吸收：玩家視角這一步變化了 (dPitch, dYaw)（度）。朝偏移反方向的部分先抵掉偏移，
   * 回傳要轉進玩家視角的量（度，與偏移同號），讓最終視角不變。
   */
  absorb(dPitch: number, dYaw: number, out: { pitch: number; yaw: number }): { pitch: number; yaw: number } {
    out.pitch = absorbAxis(this.pitch, dPitch);
    out.yaw = absorbAxis(this.yaw, dYaw);
    this.pitch -= out.pitch;
    this.yaw -= out.yaw;
    this.absorbed += Math.abs(out.pitch) + Math.abs(out.yaw);
    return out;
  }

  reset(): void {
    this.pitch = 0;
    this.yaw = 0;
    this.lastShotTime = Number.NEGATIVE_INFINITY;
    this.accumulated = 0;
    this.recovered = 0;
    this.absorbed = 0;
  }
}

function absorbAxis(offset: number, delta: number): number {
  if (offset > 0 && delta < 0) return Math.min(offset, -delta);
  if (offset < 0 && delta > 0) return -Math.min(-offset, delta);
  return 0;
}
