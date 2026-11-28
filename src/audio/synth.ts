// 合成器（M1-13）：把 SynthRecipe 渲染成單聲道 Float32Array（純 JS DSP，不需要 Web Audio）。
// 決定性（同配方、同種子 → 同樣的樣本），Vitest 可直接測試峰值與是否靜音；
// AudioEngine 在玩家第一次操作後把結果複製到 AudioBuffer。
//
// DSP：白／粉紅／棕色雜訊、sine／triangle／saw／square（polyBLEP 抗鋸齒）＋ FM 與泛音、
// RBJ 雙二階濾波（每 16 個樣本更新係數，支援掃頻與 LFO）、AM、tanh 飽和、
// Schroeder 殘響（4 梳狀 + 2 全通）、峰值正規化、頭尾淡化（循環音為交叉淡化）。
import { Rng, hashSeed } from '@/core/Rng';
import type { SoundDef, SynthFilter, SynthLayer, SynthRecipe, SynthReverb } from '@/audio/SynthRecipes';
import { varyRecipe } from '@/audio/SynthRecipes';

const TAU = Math.PI * 2;
const LN1000 = Math.log(1000); // -60 dB

/** 包絡值（t 為圖層內時間，s）。 */
export function envelopeAt(t: number, attack: number, hold: number, decay: number): number {
  if (t < 0) return 0;
  if (attack > 0 && t < attack) return t / attack;
  const d = t - attack - hold;
  if (d <= 0) return 1;
  return Math.exp((-LN1000 * d) / Math.max(1e-4, decay));
}

/** 指數滑向：from → to，時間常數 tau（tau ≤ 0 = 不滑動，停在 from）。 */
export function glideAt(t: number, from: number, to: number, tau: number): number {
  if (tau <= 0) return from;
  return to + (from - to) * Math.exp(-Math.max(0, t) / tau);
}

class Biquad {
  private b0 = 1;
  private b1 = 0;
  private b2 = 0;
  private a1 = 0;
  private a2 = 0;
  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;

  set(type: SynthFilter['type'], freq: number, q: number, sampleRate: number): void {
    const f = Math.min(sampleRate * 0.45, Math.max(10, freq));
    const w = (TAU * f) / sampleRate;
    const cos = Math.cos(w);
    const alpha = Math.sin(w) / (2 * Math.max(0.05, q));
    let b0: number;
    let b1: number;
    let b2: number;
    if (type === 'lowpass') {
      b1 = 1 - cos;
      b0 = b1 / 2;
      b2 = b0;
    } else if (type === 'highpass') {
      b1 = -(1 + cos);
      b0 = (1 + cos) / 2;
      b2 = b0;
    } else {
      // 帶通（峰值增益 0 dB）
      b0 = alpha;
      b1 = 0;
      b2 = -alpha;
    }
    const a0 = 1 + alpha;
    this.b0 = b0 / a0;
    this.b1 = b1 / a0;
    this.b2 = b2 / a0;
    this.a1 = (-2 * cos) / a0;
    this.a2 = (1 - alpha) / a0;
  }

  process(x: number): number {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
}

/** polyBLEP 修正（t 為相位 0..1，dt 為每樣本相位增量）。 */
function polyBlep(t: number, dt: number): number {
  if (t < dt) {
    const x = t / dt;
    return x + x - x * x - 1;
  }
  if (t > 1 - dt) {
    const x = (t - 1) / dt;
    return x * x + x + x + 1;
  }
  return 0;
}

function renderLayer(layer: SynthLayer, recipe: SynthRecipe, out: Float32Array, sampleRate: number, rng: Rng): void {
  const loop = recipe.loop === true;
  const start = Math.max(0, Math.floor(layer.delay * sampleRate));
  const n = out.length;
  const f = layer.filter;
  const biquad = f ? new Biquad() : null;
  const drive = layer.drive > 0 ? 1 + layer.drive * 4 : 0;
  const driveNorm = drive > 0 ? 1 / Math.tanh(drive) : 1;
  const amDepth = Math.min(1, Math.max(0, layer.amDepth));
  const amFreq = layer.amFreq;
  const env = layer.env;
  // 雜訊狀態
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  let brown = 0;
  // 振盪器狀態
  let phase = 0;
  let fmPhase = 0;
  const partials = layer.kind === 'tone' ? layer.partials : [];
  const pPhase = new Float64Array(partials.length);
  // 單次音效在包絡低於 -80 dB 後提早結束
  const endT = loop ? Number.POSITIVE_INFINITY : env.attack + env.hold + env.decay * 1.34;
  // 包絡與滑音以每樣本的乘法遞推（避免每個樣本呼叫 Math.exp）
  const attackS = env.attack * sampleRate;
  const holdEnd = attackS + env.hold * sampleRate;
  const decK = Math.exp(-LN1000 / (Math.max(1e-4, env.decay) * sampleRate));
  let dec = 1;
  const tone = layer.kind === 'tone' ? layer : null;
  const glideK = tone && tone.glide > 0 ? Math.exp(-1 / (tone.glide * sampleRate)) : 1;
  let fDiff = tone && tone.glide > 0 ? tone.freq - tone.freqEnd : 0;
  const fBase = tone ? (tone.glide > 0 ? tone.freqEnd : tone.freq) : 0;
  const amStep = amFreq / sampleRate;
  let amPhase = 0;
  for (let i = start; i < n; i++) {
    const j = i - start;
    const t = j / sampleRate;
    if (t > endT) break;
    let e = 1;
    if (!loop) {
      if (j < attackS) e = j / attackS;
      else if (j >= holdEnd) e = dec *= decK;
    }
    let x: number;
    if (layer.kind === 'noise') {
      const w = rng.float() * 2 - 1;
      if (layer.color === 'white') x = w;
      else if (layer.color === 'pink') {
        // Paul Kellet 經濟版
        b0 = 0.99765 * b0 + w * 0.099046;
        b1 = 0.963 * b1 + w * 0.2965164;
        b2 = 0.57 * b2 + w * 1.0526913;
        x = (b0 + b1 + b2 + w * 0.1848) * 0.25;
      } else {
        brown = (brown + 0.02 * w) / 1.02;
        x = brown * 3.5;
      }
    } else {
      const freq = fBase + fDiff;
      fDiff *= glideK;
      const dt = Math.min(0.5, freq / sampleRate);
      phase += dt;
      if (phase >= 1) phase -= Math.floor(phase);
      switch (layer.wave) {
        case 'sine':
          if (layer.fmDepth > 0 && layer.fmRatio > 0) {
            fmPhase += dt * layer.fmRatio;
            if (fmPhase >= 1) fmPhase -= Math.floor(fmPhase);
            x = Math.sin(TAU * phase + layer.fmDepth * Math.sin(TAU * fmPhase));
          } else x = Math.sin(TAU * phase);
          break;
        case 'triangle':
          x = 1 - 4 * Math.abs(phase - 0.5);
          break;
        case 'saw':
          x = 2 * phase - 1 - polyBlep(phase, dt);
          break;
        default: {
          x = phase < 0.5 ? 1 : -1;
          x += polyBlep(phase, dt);
          let p2 = phase + 0.5;
          if (p2 >= 1) p2 -= 1;
          x -= polyBlep(p2, dt);
        }
      }
      for (let k = 0; k < partials.length; k++) {
        const pf = Math.min(0.49, dt * partials[k]!);
        let pp = pPhase[k]! + pf;
        if (pp >= 1) pp -= Math.floor(pp);
        pPhase[k] = pp;
        x += Math.sin(TAU * pp) / (k + 2);
      }
    }
    if (biquad && f) {
      if ((j & 15) === 0) {
        let fc = f.sweep > 0 ? glideAt(t, f.freq, f.freqEnd, f.sweep) : f.freq;
        if (f.lfoDepth > 0 && f.lfoFreq > 0) fc *= 1 + f.lfoDepth * Math.sin(TAU * f.lfoFreq * t);
        biquad.set(f.type, fc, f.q, sampleRate);
      }
      x = biquad.process(x);
    }
    if (amDepth > 0 && amFreq > 0) {
      x *= 1 - amDepth * (0.5 - 0.5 * Math.cos(TAU * amPhase));
      amPhase += amStep;
      if (amPhase >= 1) amPhase -= 1;
    }
    if (drive > 0) x = Math.tanh(x * drive) * driveNorm;
    out[i]! += x * e * layer.gain;
  }
}

const COMB_TUNING = [1116, 1188, 1277, 1356];
const ALLPASS_TUNING = [556, 441];

function applyReverb(buf: Float32Array, rv: SynthReverb, sampleRate: number): void {
  if (rv.mix <= 0) return;
  const scale = (sampleRate / 44100) * Math.max(0.1, rv.size);
  const decay = Math.max(0.05, rv.decay) * sampleRate;
  const mk = (d: number): { line: Float32Array; len: number } => {
    const len = Math.max(8, Math.round(d * scale));
    return { line: new Float32Array(len), len };
  };
  const [c0, c1, c2, c3] = COMB_TUNING.map(mk) as [ReturnType<typeof mk>, ReturnType<typeof mk>, ReturnType<typeof mk>, ReturnType<typeof mk>];
  const [a0, a1] = ALLPASS_TUNING.map(mk) as [ReturnType<typeof mk>, ReturnType<typeof mk>];
  // RT60 → 每次回授的增益
  const g0 = Math.pow(10, (-3 * c0.len) / decay);
  const g1 = Math.pow(10, (-3 * c1.len) / decay);
  const g2 = Math.pow(10, (-3 * c2.len) / decay);
  const g3 = Math.pow(10, (-3 * c3.len) / decay);
  const damp = Math.min(0.95, Math.max(0, rv.damp));
  const keep = 1 - damp;
  const wetGain = 0.35 * rv.mix;
  const dry = 1 - rv.mix * 0.5;
  let i0 = 0;
  let i1 = 0;
  let i2 = 0;
  let i3 = 0;
  let j0 = 0;
  let j1 = 0;
  let s0 = 0;
  let s1 = 0;
  let s2 = 0;
  let s3 = 0;
  const L0 = c0.line;
  const L1 = c1.line;
  const L2 = c2.line;
  const L3 = c3.line;
  const A0 = a0.line;
  const A1 = a1.line;
  for (let i = 0; i < buf.length; i++) {
    const x = buf[i]!;
    let y = L0[i0]!;
    s0 = y * keep + s0 * damp;
    L0[i0] = x + s0 * g0;
    if (++i0 >= c0.len) i0 = 0;
    let acc = y;
    y = L1[i1]!;
    s1 = y * keep + s1 * damp;
    L1[i1] = x + s1 * g1;
    if (++i1 >= c1.len) i1 = 0;
    acc += y;
    y = L2[i2]!;
    s2 = y * keep + s2 * damp;
    L2[i2] = x + s2 * g2;
    if (++i2 >= c2.len) i2 = 0;
    acc += y;
    y = L3[i3]!;
    s3 = y * keep + s3 * damp;
    L3[i3] = x + s3 * g3;
    if (++i3 >= c3.len) i3 = 0;
    acc += y;
    y = A0[j0]!;
    A0[j0] = acc + y * 0.5;
    acc = y - acc * 0.5;
    if (++j0 >= a0.len) j0 = 0;
    y = A1[j1]!;
    A1[j1] = acc + y * 0.5;
    acc = y - acc * 0.5;
    if (++j1 >= a1.len) j1 = 0;
    buf[i] = x * dry + acc * wetGain;
  }
}

export interface RenderOptions {
  sampleRate: number;
  /** 亂數種子（同種子 → 同樣的雜訊）。 */
  seed: number;
  /** 循環音的交叉淡化長度（s）。 */
  loopCrossfade?: number;
}

/** 渲染一個配方（不做變體偏移）。回傳單聲道樣本，峰值正規化到 recipe.peakDb。 */
export function renderRecipe(recipe: Readonly<SynthRecipe>, opts: RenderOptions): Float32Array {
  const sr = opts.sampleRate;
  const len = Math.max(1, Math.round(recipe.duration * sr));
  const xfade = recipe.loop ? Math.min(Math.floor(len / 3), Math.round((opts.loopCrossfade ?? 0.12) * sr)) : 0;
  const buf = new Float32Array(len + xfade);
  const rng = new Rng(opts.seed >>> 0);
  for (const layer of recipe.layers) renderLayer(layer, recipe as SynthRecipe, buf, sr, rng);
  if (recipe.reverb) applyReverb(buf, recipe.reverb, sr);
  let out: Float32Array;
  if (xfade > 0) {
    // 循環：尾端（len..len+xfade）交叉淡化到開頭，回繞點連續
    out = buf.subarray(0, len);
    for (let i = 0; i < xfade; i++) {
      const k = i / xfade;
      out[i] = buf[i]! * Math.sin(k * Math.PI * 0.5) + buf[len + i]! * Math.cos(k * Math.PI * 0.5);
    }
    out = out.slice();
  } else {
    out = buf;
    // 頭尾淡化：避免爆音（開頭 1 ms、結尾 min(30 ms, 10%)）
    const fin = Math.min(len, Math.round(0.001 * sr));
    for (let i = 0; i < fin; i++) out[i]! *= i / fin;
    const fout = Math.min(len, Math.round(Math.min(0.03, recipe.duration * 0.1) * sr));
    for (let i = 0; i < fout; i++) out[len - 1 - i]! *= i / fout;
  }
  // 去除直流（棕色雜訊、飽和造成的偏移）
  let mean = 0;
  for (let i = 0; i < out.length; i++) mean += out[i]!;
  mean /= out.length;
  if (Math.abs(mean) > 1e-6 && recipe.loop) for (let i = 0; i < out.length; i++) out[i]! -= mean;
  const peak = peakOf(out);
  if (peak > 1e-9) {
    const g = Math.pow(10, recipe.peakDb / 20) / peak;
    for (let i = 0; i < out.length; i++) out[i]! *= g;
  }
  return out;
}

export function peakOf(data: ArrayLike<number>): number {
  let p = 0;
  for (let i = 0; i < data.length; i++) {
    const a = Math.abs(data[i]!);
    if (a > p) p = a;
  }
  return p;
}

export function rmsOf(data: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < data.length; i++) s += data[i]! * data[i]!;
  return data.length > 0 ? Math.sqrt(s / data.length) : 0;
}

/** 循環點的不連續量（最後一個樣本與第一個樣本的差）。 */
export function loopSeam(data: ArrayLike<number>): number {
  return data.length > 1 ? Math.abs(data[data.length - 1]! - data[0]!) : 0;
}

/** 渲染一種音效的所有變體（變體 0 = 原配方；其餘以 vary 偏移）。 */
export function renderVariants(id: string, def: Readonly<SoundDef>, sampleRate: number, loopCrossfade?: number): Float32Array[] {
  const out: Float32Array[] = [];
  const baseSeed = hashSeed(id);
  const varyRng = new Rng(baseSeed ^ 0x9e3779b9);
  for (let v = 0; v < Math.max(1, def.variants); v++) {
    const r = v === 0 ? def.recipe : varyRecipe(def.recipe, varyRng);
    const opts: RenderOptions = { sampleRate, seed: (baseSeed + v * 0x632be5ab) >>> 0 };
    if (loopCrossfade !== undefined) opts.loopCrossfade = loopCrossfade;
    out.push(renderRecipe(r, opts));
  }
  return out;
}
