// 掃掠判定的純函式（M1-12）：敵方投射物（球）沿一步的位移線段對玩家膠囊的最早接觸時間。
// 點到線段的距離是凸函數，所以「移動點到膠囊軸線段的距離」沿掃掠參數 t 也是凸函數：
// 先找最接近的 t*，距離 ≤ 半徑和時，在 [0, t*] 上二分搜尋第一次接觸。結果與步長無關（精確到 tolerance）。
import type { Vec3Like } from '@/physics/Physics';

/** 點 (px, py, pz) 到線段 ab 的距離平方。 */
export function pointSegmentDistanceSq(px: number, py: number, pz: number, a: Readonly<Vec3Like>, b: Readonly<Vec3Like>): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const abz = b.z - a.z;
  const len2 = abx * abx + aby * aby + abz * abz;
  let t = len2 > 1e-12 ? ((px - a.x) * abx + (py - a.y) * aby + (pz - a.z) * abz) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const dx = px - (a.x + abx * t);
  const dy = py - (a.y + aby * t);
  const dz = pz - (a.z + abz * t);
  return dx * dx + dy * dy + dz * dz;
}

/**
 * 兩線段 p1→q1、p2→q2 的最近點參數（s 在第一段、t 在第二段，皆 ∈ [0, 1]）與距離平方。
 * Ericson《Real-Time Collision Detection》5.1.9。
 */
export function closestSegmentParams(
  p1: Readonly<Vec3Like>,
  q1: Readonly<Vec3Like>,
  p2: Readonly<Vec3Like>,
  q2: Readonly<Vec3Like>,
  out: { s: number; t: number; distSq: number } = { s: 0, t: 0, distSq: 0 },
): { s: number; t: number; distSq: number } {
  const d1x = q1.x - p1.x;
  const d1y = q1.y - p1.y;
  const d1z = q1.z - p1.z;
  const d2x = q2.x - p2.x;
  const d2y = q2.y - p2.y;
  const d2z = q2.z - p2.z;
  const rx = p1.x - p2.x;
  const ry = p1.y - p2.y;
  const rz = p1.z - p2.z;
  const a = d1x * d1x + d1y * d1y + d1z * d1z;
  const e = d2x * d2x + d2y * d2y + d2z * d2z;
  const f = d2x * rx + d2y * ry + d2z * rz;
  const eps = 1e-12;
  let s: number;
  let t: number;
  if (a <= eps && e <= eps) {
    s = 0;
    t = 0;
  } else if (a <= eps) {
    s = 0;
    t = clamp01(f / e);
  } else {
    const c = d1x * rx + d1y * ry + d1z * rz;
    if (e <= eps) {
      t = 0;
      s = clamp01(-c / a);
    } else {
      const b = d1x * d2x + d1y * d2y + d1z * d2z;
      const denom = a * e - b * b;
      s = denom > eps ? clamp01((b * f - c * e) / denom) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = clamp01(-c / a);
      } else if (t > 1) {
        t = 1;
        s = clamp01((b - c) / a);
      }
    }
  }
  const dx = p1.x + d1x * s - (p2.x + d2x * t);
  const dy = p1.y + d1y * s - (p2.y + d2y * t);
  const dz = p1.z + d1z * s - (p2.z + d2z * t);
  out.s = s;
  out.t = t;
  out.distSq = dx * dx + dy * dy + dz * dz;
  return out;
}

const _closest = { s: 0, t: 0, distSq: 0 };
const _end = { x: 0, y: 0, z: 0 };

/**
 * 球（中心 from，半徑 r）沿位移 seg 掃過，與膠囊（軸線段 a–b、半徑 capR）第一次接觸的參數 t ∈ [0, 1]；沒有接觸回傳 null。
 * 起點就已重疊時回傳 0。
 */
export function sweepSphereCapsule(
  from: Readonly<Vec3Like>,
  seg: Readonly<Vec3Like>,
  r: number,
  a: Readonly<Vec3Like>,
  b: Readonly<Vec3Like>,
  capR: number,
  tolerance = 1e-4,
): number | null {
  const R = r + capR;
  const R2 = R * R;
  if (pointSegmentDistanceSq(from.x, from.y, from.z, a, b) <= R2) return 0;
  _end.x = from.x + seg.x;
  _end.y = from.y + seg.y;
  _end.z = from.z + seg.z;
  const c = closestSegmentParams(from, _end, a, b, _closest);
  if (c.distSq > R2) return null;
  // d(t) 在 [0, s*] 單調遞減：二分搜尋第一次 d ≤ R。
  let lo = 0;
  let hi = c.s;
  const len = Math.hypot(seg.x, seg.y, seg.z);
  const iters = len > 0 ? Math.min(40, Math.max(4, Math.ceil(Math.log2(len / tolerance)))) : 0;
  for (let i = 0; i < iters; i++) {
    const mid = (lo + hi) / 2;
    const d2 = pointSegmentDistanceSq(from.x + seg.x * mid, from.y + seg.y * mid, from.z + seg.z * mid, a, b);
    if (d2 <= R2) hi = mid;
    else lo = mid;
  }
  return hi;
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}
