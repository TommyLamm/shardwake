// 數學工具：與 dt 無關的平滑、精確積分的彈簧、角度插值、FOV 換算、1D／2D 值雜訊。
import { Vector3 } from 'three';

export const TAU = Math.PI * 2;
export const DEG2RAD = Math.PI / 180;
export const RAD2DEG = 180 / Math.PI;

export function clamp(x: number, min: number, max: number): number {
  return x < min ? min : x > max ? max : x;
}

export function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function inverseLerp(a: number, b: number, x: number): number {
  return a === b ? 0 : (x - a) / (b - a);
}

/** 把 x 從 [inMin, inMax] 對應到 [outMin, outMax]，並夾在輸出範圍內。 */
export function remapClamped(x: number, inMin: number, inMax: number, outMin: number, outMax: number): number {
  return lerp(outMin, outMax, clamp01(inverseLerp(inMin, inMax, x)));
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01(inverseLerp(edge0, edge1, x));
  return t * t * (3 - 2 * t);
}

/** 以固定最大速度逼近目標，不超過。 */
export function moveTowards(current: number, target: number, maxDelta: number): number {
  const d = target - current;
  return Math.abs(d) <= maxDelta ? target : current + Math.sign(d) * maxDelta;
}

/**
 * 與 dt 無關的指數平滑：每秒剩下 e^(-lambda) 的差距。
 * 不論畫面更新率，經過相同總時間得到相同結果。lambda 可由 halfLifeToLambda 換算。
 */
export function damp(current: number, target: number, lambda: number, dt: number): number {
  return lerp(current, target, 1 - Math.exp(-lambda * dt));
}

/** 差距減半所需秒數 → damp 的 lambda。 */
export function halfLifeToLambda(halfLife: number): number {
  return halfLife <= 0 ? Infinity : Math.LN2 / halfLife;
}

/** 把角度（弧度）包到 (-π, π]。 */
export function wrapAngle(a: number): number {
  const w = (((a + Math.PI) % TAU) + TAU) % TAU - Math.PI;
  return w === -Math.PI ? Math.PI : w;
}

/** 兩角度（弧度）的最短差 b - a，範圍 (-π, π]。 */
export function angleDelta(a: number, b: number): number {
  return wrapAngle(b - a);
}

/** 沿最短方向插值角度（弧度）；結果未包回範圍，需要時再呼叫 wrapAngle。 */
export function lerpAngle(a: number, b: number, t: number): number {
  return a + angleDelta(a, b) * t;
}

/** 與 dt 無關的角度平滑（最短方向）。 */
export function dampAngle(current: number, target: number, lambda: number, dt: number): number {
  return lerpAngle(current, target, 1 - Math.exp(-lambda * dt));
}

/** 水平 FOV（度）→ 垂直 FOV（度），aspect = 寬 / 高。 */
export function horizontalToVerticalFov(hFovDeg: number, aspect: number): number {
  return 2 * Math.atan(Math.tan((hFovDeg * DEG2RAD) / 2) / aspect) * RAD2DEG;
}

/** 垂直 FOV（度）→ 水平 FOV（度）。 */
export function verticalToHorizontalFov(vFovDeg: number, aspect: number): number {
  return 2 * Math.atan(Math.tan((vFovDeg * DEG2RAD) / 2) * aspect) * RAD2DEG;
}

// ── 彈簧 ─────────────────────────────────────────────────
//
// 阻尼諧振子 x'' = -ω²(x - target) - 2ζω x'，以解析解精確積分：
// 任何 dt 都不發散，且相同總時間得到相同結果（與畫面更新率無關）。
// frequency 是無阻尼自然頻率（Hz），ω = 2π·frequency；
// dampingRatio ζ：1 = 臨界阻尼（預設，不過衝），< 1 會回彈（例如落地 0.7），> 1 過阻尼。

/** dt 內的線性轉移：x' = a·x + b·v，v' = c·x + d·v（x 為相對目標的位移）。 */
export interface SpringStep {
  a: number;
  b: number;
  c: number;
  d: number;
}

const CRITICAL_EPSILON = 1e-4;

/** 計算彈簧在 dt 內的轉移係數（寫入 out，不配置記憶體）。 */
export function springStep(frequency: number, dampingRatio: number, dt: number, out: SpringStep): SpringStep {
  const w = TAU * Math.max(frequency, 0);
  const z = Math.max(dampingRatio, 0);
  if (w === 0 || dt <= 0) {
    out.a = 1;
    out.b = Math.max(dt, 0);
    out.c = 0;
    out.d = 1;
    return out;
  }
  if (Math.abs(z - 1) < CRITICAL_EPSILON) {
    const e = Math.exp(-w * dt);
    out.a = (1 + w * dt) * e;
    out.b = dt * e;
    out.c = -w * w * dt * e;
    out.d = (1 - w * dt) * e;
  } else if (z < 1) {
    const wd = w * Math.sqrt(1 - z * z);
    const e = Math.exp(-z * w * dt);
    const cos = Math.cos(wd * dt);
    const sin = Math.sin(wd * dt);
    out.a = e * (cos + ((z * w) / wd) * sin);
    out.b = (e * sin) / wd;
    out.c = (-e * w * w * sin) / wd;
    out.d = e * (cos - ((z * w) / wd) * sin);
  } else {
    const s = Math.sqrt(z * z - 1);
    const r1 = -w * (z - s);
    const r2 = -w * (z + s);
    const e1 = Math.exp(r1 * dt);
    const e2 = Math.exp(r2 * dt);
    const inv = 1 / (r1 - r2);
    out.a = (r1 * e2 - r2 * e1) * inv;
    out.b = (e1 - e2) * inv;
    out.c = r1 * r2 * (e2 - e1) * inv;
    out.d = (r1 * e1 - r2 * e2) * inv;
  }
  return out;
}

export interface SpringParams {
  /** 自然頻率（Hz），越高越快。 */
  frequency: number;
  /** 阻尼比；預設 1（臨界阻尼）。 */
  dampingRatio?: number;
}

/** 快取係數：dt 與參數不變時不重算 exp／sin／cos。 */
class SpringCoefCache {
  private f = NaN;
  private z = NaN;
  private dt = NaN;
  readonly step: SpringStep = { a: 1, b: 0, c: 0, d: 1 };

  get(frequency: number, dampingRatio: number, dt: number): SpringStep {
    if (frequency !== this.f || dampingRatio !== this.z || dt !== this.dt) {
      springStep(frequency, dampingRatio, dt, this.step);
      this.f = frequency;
      this.z = dampingRatio;
      this.dt = dt;
    }
    return this.step;
  }
}

export class SpringScalar {
  value: number;
  velocity = 0;
  target: number;
  frequency: number;
  dampingRatio: number;
  private readonly cache = new SpringCoefCache();

  constructor(params: SpringParams & { value?: number; target?: number }) {
    this.frequency = params.frequency;
    this.dampingRatio = params.dampingRatio ?? 1;
    this.value = params.value ?? 0;
    this.target = params.target ?? this.value;
  }

  update(dt: number): number {
    const k = this.cache.get(this.frequency, this.dampingRatio, dt);
    const x = this.value - this.target;
    const v = this.velocity;
    this.value = this.target + k.a * x + k.b * v;
    this.velocity = k.c * x + k.d * v;
    return this.value;
  }

  /** 加速度衝量（直接加到速度上），例如落地下沉、後座踢動。 */
  addImpulse(dv: number): void {
    this.velocity += dv;
  }

  /** 立即到位並停止。 */
  snap(value: number = this.target): void {
    this.value = value;
    this.target = value;
    this.velocity = 0;
  }
}

export class SpringVec3 {
  readonly value = new Vector3();
  readonly velocity = new Vector3();
  readonly target = new Vector3();
  frequency: number;
  dampingRatio: number;
  private readonly cache = new SpringCoefCache();

  constructor(params: SpringParams & { value?: Vector3; target?: Vector3 }) {
    this.frequency = params.frequency;
    this.dampingRatio = params.dampingRatio ?? 1;
    if (params.value) this.value.copy(params.value);
    this.target.copy(params.target ?? this.value);
  }

  update(dt: number): Vector3 {
    const k = this.cache.get(this.frequency, this.dampingRatio, dt);
    const p = this.value;
    const v = this.velocity;
    const t = this.target;
    const x0 = p.x - t.x;
    const y0 = p.y - t.y;
    const z0 = p.z - t.z;
    p.set(t.x + k.a * x0 + k.b * v.x, t.y + k.a * y0 + k.b * v.y, t.z + k.a * z0 + k.b * v.z);
    v.set(k.c * x0 + k.d * v.x, k.c * y0 + k.d * v.y, k.c * z0 + k.d * v.z);
    return p;
  }

  addImpulse(dv: Vector3): void {
    this.velocity.add(dv);
  }

  snap(value: Vector3 = this.target): void {
    this.value.copy(value);
    this.target.copy(value);
    this.velocity.set(0, 0, 0);
  }
}

// ── 值雜訊（震動、晃動用）────────────────────────────────
// 整數格點上的雜湊值，以 quintic 曲線平滑插值；輸出範圍 [-1, 1]，連續、可重現。

function hash1(i: number, seed: number): number {
  let h = Math.imul(i | 0, 0x27d4eb2d) ^ Math.imul(seed | 0, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}

function hash2(i: number, j: number, seed: number): number {
  return hash1(Math.imul(i | 0, 0x1b873593) ^ (j | 0), seed);
}

function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/** 1D 值雜訊，範圍 [-1, 1]。x 通常為 時間 × 頻率。 */
export function valueNoise1D(x: number, seed = 0): number {
  const i = Math.floor(x);
  const t = fade(x - i);
  return lerp(hash1(i, seed), hash1(i + 1, seed), t) * 2 - 1;
}

/** 2D 值雜訊，範圍 [-1, 1]。 */
export function valueNoise2D(x: number, y: number, seed = 0): number {
  const i = Math.floor(x);
  const j = Math.floor(y);
  const tx = fade(x - i);
  const ty = fade(y - j);
  const a = lerp(hash2(i, j, seed), hash2(i + 1, j, seed), tx);
  const b = lerp(hash2(i, j + 1, seed), hash2(i + 1, j + 1, seed), tx);
  return lerp(a, b, ty) * 2 - 1;
}

/** 多層 1D 雜訊（fractal），範圍約 [-1, 1]。 */
export function fbm1D(x: number, octaves = 3, seed = 0, lacunarity = 2, gain = 0.5): number {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let freq = 1;
  for (let o = 0; o < octaves; o++) {
    sum += valueNoise1D(x * freq, seed + o * 131) * amp;
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return norm === 0 ? 0 : sum / norm;
}
