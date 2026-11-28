// Viewmodel 動作曲線的純函式（M1-11；無頭測試直接驗證）。
// 所有曲線都以「進度」或「累計距離／時間」為參數，不依賴畫面更新率；彈簧用 core/math 的解析解（SpringScalar／SpringVec3）。
// 姿勢以 VmPose 表示：位移 px／py／pz（m，相機空間：x 右、y 上、+z 後）與旋轉 rx（pitch 上）、ry（yaw 右）、rz（roll，逆時針為正），單位度。
import { clamp01, lerp } from '@/core/math';
import type { ViewmodelConfig } from '@/weapons/ViewmodelConfig';

export interface VmPose {
  px: number;
  py: number;
  pz: number;
  rx: number;
  ry: number;
  rz: number;
}

export function zeroPose(out: VmPose = { px: 0, py: 0, pz: 0, rx: 0, ry: 0, rz: 0 }): VmPose {
  out.px = out.py = out.pz = out.rx = out.ry = out.rz = 0;
  return out;
}

/** out += p × w。 */
export function addPose(out: VmPose, p: Readonly<VmPose>, w = 1): VmPose {
  out.px += p.px * w;
  out.py += p.py * w;
  out.pz += p.pz * w;
  out.rx += p.rx * w;
  out.ry += p.ry * w;
  out.rz += p.rz * w;
  return out;
}

/** smoothstep 在 [a, b] 之間 0 → 1（a ≥ b 時為階梯）。 */
export function ramp(t: number, a: number, b: number): number {
  if (b <= a) return t >= a ? 1 : 0;
  const x = clamp01((t - a) / (b - a));
  return x * x * (3 - 2 * x);
}

/** 先在 [a, b] 升到 1，再在 [c, d] 降回 0。 */
export function bump(t: number, a: number, b: number, c: number, d: number): number {
  return ramp(t, a, b) * (1 - ramp(t, c, d));
}

/**
 * 8 字形晃動（∞ 形）：x = sin(φ)、y = sin(2φ)，φ 為步伐相位（每步前進 π）。
 * 寫入 out 的 px／py／rz（未乘權重）。
 */
export function figureEight(phase: number, ax: number, ay: number, rollDeg: number, out: VmPose): VmPose {
  out.px = ax * Math.sin(phase);
  out.py = ay * Math.sin(2 * phase);
  out.pz = 0;
  out.rx = 0;
  out.ry = 0;
  out.rz = rollDeg * Math.sin(phase);
  return out;
}

/** 步伐相位的增量：每走 stride 公尺前進 π（左右腳各一步為一個週期）。 */
export function bobPhaseDelta(speed: number, dt: number, stride: number): number {
  return stride > 0 && speed > 0 && dt > 0 ? (speed * dt * Math.PI) / stride : 0;
}

/** 擺動目標（度）：視角速度（度/秒）× 增益，反向並夾在 ±max。 */
export function swayTarget(angularVelocityDeg: number, gain: number, maxDeg: number): number {
  const v = -angularVelocityDeg * gain;
  return v > maxDeg ? maxDeg : v < -maxDeg ? -maxDeg : v;
}

/** 開鏡位置：讓瞄具點（槍模本地）對到相機前方 eyeRelief 處，再加上 adsOffset（[右, 上, 前]）。 */
export function adsPosition(
  sight: Readonly<{ x: number; y: number; z: number }>,
  eyeRelief: number,
  adsOffset: readonly [number, number, number] | undefined,
  out: { x: number; y: number; z: number },
): { x: number; y: number; z: number } {
  const o = adsOffset ?? [0, 0, 0];
  out.x = -sight.x + o[0];
  out.y = -sight.y + o[1];
  out.z = -eyeRelief - sight.z - o[2];
  return out;
}

/** 換彈姿勢的輸出：槍身姿勢與彈匣的本地位移。 */
export interface ReloadPose {
  pose: VmPose;
  /** 彈匣位移（槍模本地，m）；0 = 裝好。 */
  magY: number;
  magZ: number;
  /** 彈匣是否顯示（掉出後到新彈匣出現前隱藏）。 */
  magVisible: boolean;
}

export function createReloadPose(): ReloadPose {
  return { pose: zeroPose(), magY: 0, magZ: 0, magVisible: true };
}

type ReloadKeys = Pick<
  ViewmodelConfig,
  | 'reloadRollDeg'
  | 'reloadPitchDeg'
  | 'reloadPos'
  | 'reloadTiltIn'
  | 'reloadMagOut'
  | 'reloadMagDrop'
  | 'reloadMagShow'
  | 'reloadMagSeat'
  | 'reloadChargeStart'
  | 'reloadChargeEnd'
  | 'reloadTiltOut'
  | 'magPullDistance'
  | 'magDropDistance'
  | 'chargeKick'
  | 'chargePitchDeg'
  | 'tacticalChargeMult'
>;

/**
 * 彈匣式換彈的程序關鍵影格（progress 0..1，時間軸隨 reloadTactical／reloadEmpty 縮放）：
 * 槍身傾斜（0 → tiltIn）→ 彈匣拔出（tiltIn → magOut）→ 掉落（magOut → magDrop，之後隱藏）→
 * 新彈匣從下方出現（magShow）→ 插入（→ magSeat）→ 上膛（chargeStart → chargeEnd，空倉較大）→ 回正（tiltOut → 1）。
 * progress = 0 與 1 時姿勢為 0（可以直接接回一般姿勢）。
 */
export function reloadPose(progress: number, empty: boolean, k: Readonly<ReloadKeys>, out: ReloadPose): ReloadPose {
  const t = clamp01(progress);
  const tilt = ramp(t, 0, k.reloadTiltIn) * (1 - ramp(t, k.reloadTiltOut, 1));
  const p = out.pose;
  p.px = k.reloadPos[0] * tilt;
  p.py = k.reloadPos[1] * tilt;
  p.pz = k.reloadPos[2] * tilt;
  p.rx = k.reloadPitchDeg * tilt;
  p.ry = 0;
  p.rz = k.reloadRollDeg * tilt;
  // 彈匣：拔出 → 掉落（加速）→ 隱藏 → 新彈匣從下方升起 → 插入。
  let magY = 0;
  let visible = true;
  if (t >= k.reloadTiltIn && t < k.reloadMagOut) {
    magY = -k.magPullDistance * ramp(t, k.reloadTiltIn, k.reloadMagOut);
  } else if (t >= k.reloadMagOut && t < k.reloadMagDrop) {
    const f = clamp01((t - k.reloadMagOut) / Math.max(1e-6, k.reloadMagDrop - k.reloadMagOut));
    magY = -k.magPullDistance - k.magDropDistance * f * f;
  } else if (t >= k.reloadMagDrop && t < k.reloadMagShow) {
    visible = false;
    magY = -k.magPullDistance - k.magDropDistance;
  } else if (t >= k.reloadMagShow && t < k.reloadMagSeat) {
    const f = ramp(t, k.reloadMagShow, k.reloadMagSeat);
    magY = lerp(-k.magPullDistance * 2.2, 0, f);
  }
  // 插入時的頓挫：槍身往上一頂。
  const seat = bump(t, k.reloadMagSeat - 0.03, k.reloadMagSeat, k.reloadMagSeat, k.reloadMagSeat + 0.06);
  p.py += 0.008 * seat;
  p.rx += 1.5 * seat;
  // 上膛：後拉 + 槍口跳動（戰術換彈較小）。
  const charge = bump(t, k.reloadChargeStart, (k.reloadChargeStart + k.reloadChargeEnd) / 2, (k.reloadChargeStart + k.reloadChargeEnd) / 2, k.reloadChargeEnd);
  const cm = empty ? 1 : k.tacticalChargeMult;
  p.pz += k.chargeKick * charge * cm;
  p.rx += k.chargePitchDeg * charge * cm;
  out.magY = magY;
  out.magZ = 0;
  out.magVisible = visible;
  return out;
}

/**
 * 逐發裝填：整段換彈中槍身傾斜（inside 0..1，進入與離開由呼叫端平滑），每發的週期內往前推入一次（cycle 0..1）。
 */
export function shellPose(
  inside: number,
  cycle: number,
  k: Readonly<Pick<ViewmodelConfig, 'shellRollDeg' | 'shellPos' | 'shellPush'>>,
  out: VmPose,
): VmPose {
  const w = clamp01(inside);
  const push = cycle > 0 && cycle < 1 ? Math.sin(Math.PI * clamp01(cycle)) : 0;
  out.px = k.shellPos[0] * w;
  out.py = k.shellPos[1] * w - 0.006 * push * w;
  out.pz = k.shellPos[2] * w - k.shellPush * push * w;
  out.rx = -2 * push * w;
  out.ry = 0;
  out.rz = k.shellRollDeg * w;
  return out;
}

/** 切槍放下的程度（0 = 拿好、1 = 放到最低）：收槍中 0 → 1，掏槍中 1 → 0。 */
export function swapLowered(
  swap: Readonly<{ active: boolean; phase: 'out' | 'in'; start: number; outEnd: number; inEnd: number }>,
  time: number,
): number {
  if (!swap.active) return 0;
  if (swap.phase === 'out') {
    const len = swap.outEnd - swap.start;
    return len > 0 ? ramp((time - swap.start) / len, 0, 1) : 1;
  }
  const len = swap.inEnd - swap.outEnd;
  return len > 0 ? 1 - ramp((time - swap.outEnd) / len, 0, 1) : 0;
}

/** 近戰前刺（progress 0..1）：峰值在 peak，之後收回。 */
export function meleePose(
  progress: number,
  k: Readonly<Pick<ViewmodelConfig, 'meleeThrust' | 'meleeYawDeg' | 'meleeRollDeg' | 'meleePeak'>>,
  out: VmPose,
): VmPose {
  const t = clamp01(progress);
  const peak = Math.min(0.95, Math.max(0.05, k.meleePeak));
  // 預備（往後拉）→ 前刺 → 收回。
  const wind = bump(t, 0, peak * 0.4, peak * 0.4, peak);
  const thrust = ramp(t, peak * 0.35, peak) * (1 - ramp(t, peak + 0.1, 1));
  out.px = -0.04 * thrust;
  out.py = 0.02 * thrust - 0.01 * wind;
  out.pz = 0.03 * wind - k.meleeThrust * thrust;
  out.rx = -6 * thrust + 4 * wind;
  out.ry = -k.meleeYawDeg * thrust;
  out.rz = k.meleeRollDeg * thrust;
  return out;
}

/** 泵動護木後拉量（0..1）：距上一發 sinceShot 秒、射擊間隔 interval 秒。 */
export function pumpTravel(sinceShot: number, interval: number, k: Readonly<Pick<ViewmodelConfig, 'pumpStart' | 'pumpMid' | 'pumpEnd'>>): number {
  if (!(interval > 0) || !(sinceShot >= 0)) return 0;
  const t = sinceShot / interval;
  return bump(t, k.pumpStart, k.pumpMid, k.pumpMid, k.pumpEnd);
}

/** 開火後發光條的亮度倍率：暗到 dip，在 recover 秒內線性恢復到 1。 */
export function glowAfterShot(sinceShot: number, recover: number, dip: number): number {
  if (!(sinceShot >= 0) || !(recover > 0)) return 1;
  return lerp(dip, 1, clamp01(sinceShot / recover));
}
