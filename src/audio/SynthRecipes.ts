// 合成配方（M1-13）：用參數描述音色，不使用任何音效檔。M2 的元素、M3 的敵人音效沿用同一格式。
//
// 一個配方（SynthRecipe）= 數個圖層（雜訊爆發＋濾波、振盪器＋音高包絡）疊加，可選短殘響，最後正規化到 peakDb。
// 全部是 JSON 相容的普通資料：可匯出、可在調參面板逐欄調整（面板的範圍與驗證共用 SYNTH_FIELD_SPECS）。
// 載入時由 synth.ts 預先渲染成 AudioBuffer，每種音效 3–5 個變體（vary 決定變體間的隨機偏移）。
//
// 圖層時間軸：delay 秒後開始；包絡 attack（線性 0 → 1）→ hold → decay（指數衰減到 -60 dB 所需秒數）。
// 音高包絡：freq 以時間常數 glide 指數滑向 freqEnd（freqEnd > freq 時為上升；glide 0 = 不滑動）；濾波的 freq → freqEnd 以 sweep 同理。
// 循環音（loop: true）忽略包絡（持續音量 1），渲染後把尾端交叉淡化回開頭，可無縫循環。
import type { ParamSpec } from '@/debug/DebugPanel';

export type NoiseColor = 'white' | 'pink' | 'brown';
export type FilterType = 'lowpass' | 'highpass' | 'bandpass';
export type Waveform = 'sine' | 'triangle' | 'saw' | 'square';

export interface SynthEnvelope {
  attack: number;
  hold: number;
  decay: number;
}

export interface SynthFilter {
  type: FilterType;
  freq: number;
  freqEnd: number;
  sweep: number;
  q: number;
  /** 濾波頻率的 LFO（Hz）與深度（比例 0..1）：風聲、摩擦。 */
  lfoFreq: number;
  lfoDepth: number;
}

interface LayerBase {
  /** 標籤（武器參數 body／crack／charge 依此縮放；其他用途自由）。 */
  tag?: string;
  gain: number;
  delay: number;
  env: SynthEnvelope;
  /** 飽和（tanh）0 = 無。 */
  drive: number;
  /** 振幅調變（Hz、深度 0..1）：棘輪、格柵、噴射爆裂。 */
  amFreq: number;
  amDepth: number;
  filter?: SynthFilter;
}

export interface NoiseLayer extends LayerBase {
  kind: 'noise';
  color: NoiseColor;
}

export interface ToneLayer extends LayerBase {
  kind: 'tone';
  wave: Waveform;
  freq: number;
  freqEnd: number;
  glide: number;
  /** FM（只對 sine）：調變頻率 = freq × fmRatio，調變指數 fmDepth。 */
  fmRatio: number;
  fmDepth: number;
  /** 額外的正弦泛音（頻率倍率；第 k 個振幅 1/(k+2)）：金屬、玻璃。 */
  partials: number[];
}

export type SynthLayer = NoiseLayer | ToneLayer;

export interface SynthReverb {
  /** 濕聲比例 0..1。 */
  mix: number;
  /** RT60（s）。 */
  decay: number;
  /** 空間大小（梳狀濾波延遲倍率）。 */
  size: number;
  /** 高頻阻尼 0..1。 */
  damp: number;
}

export interface SynthVary {
  /** 變體間的音高偏移（比例）。 */
  pitch: number;
  /** 時間（包絡、滑音）偏移（比例）。 */
  time: number;
  /** 濾波頻率偏移（比例）。 */
  filter: number;
  /** 各圖層音量偏移（比例）。 */
  gain: number;
}

export interface SynthRecipe {
  /** 緩衝長度（s，含殘響尾巴；循環音為一個循環的長度）。 */
  duration: number;
  /** 正規化後的峰值（dBFS）。 */
  peakDb: number;
  layers: SynthLayer[];
  reverb?: SynthReverb;
  vary: SynthVary;
  loop?: boolean;
}

export type AudioBusName = 'sfx' | 'ui' | 'music';

/** 一種音效：配方 + 播放規則。 */
export interface SoundDef {
  recipe: SynthRecipe;
  /** 預渲染的變體數（3–5；循環音 1–2）。 */
  variants: number;
  bus: AudioBusName;
  /** 發聲上限的類別（AUDIO_CONFIG.voices.categories）。 */
  category: string;
  /** 音量（dB）。 */
  gainDb: number;
  /** 優先序（高的可以搶占低的）。 */
  priority: number;
  /** 節流：同一音效最短間隔（s）。 */
  minInterval: number;
  /** 同一音效的同時發聲上限（0 = 只受類別限制）。 */
  maxInstances: number;
  /** 世界音源（呼叫端會給位置；沒給時以 2D 播放）。 */
  spatial?: boolean;
}

// ── 欄位規格（面板範圍 = 驗證範圍）───────────────────────

const n = (label: string, min: number, max: number, step: number): ParamSpec => ({ label, min, max, step });

/** 依欄位名稱（路徑最後一段）決定的範圍；面板與 validateRecipe 共用。 */
export const SYNTH_FIELD_SPECS: Readonly<Record<string, ParamSpec>> = {
  duration: n('長度 s', 0.02, 6, 0.01),
  peakDb: n('峰值 dBFS', -30, 0, 0.5),
  gain: n('音量', 0, 4, 0.01),
  delay: n('延遲 s', 0, 2, 0.001),
  drive: n('飽和', 0, 4, 0.01),
  amFreq: n('AM Hz', 0, 200, 0.1),
  amDepth: n('AM 深度', 0, 1, 0.01),
  attack: n('起音 s', 0, 2, 0.001),
  hold: n('保持 s', 0, 4, 0.001),
  decay: n('衰減 s', 0.001, 6, 0.001),
  freq: n('頻率 Hz', 10, 20000, 1),
  freqEnd: n('結束頻率 Hz', 10, 20000, 1),
  glide: n('滑音 s', 0, 2, 0.001),
  sweep: n('掃頻 s', 0, 2, 0.001),
  q: n('Q', 0.1, 30, 0.05),
  lfoFreq: n('LFO Hz', 0, 20, 0.01),
  lfoDepth: n('LFO 深度', 0, 0.95, 0.01),
  fmRatio: n('FM 倍率', 0, 8, 0.01),
  fmDepth: n('FM 指數', 0, 20, 0.05),
  partials: n('泛音倍率', 0.1, 16, 0.01),
  mix: n('殘響比例', 0, 1, 0.01),
  size: n('空間', 0.1, 2, 0.01),
  damp: n('阻尼', 0, 1, 0.01),
  pitch: n('變體音高', 0, 0.3, 0.005),
  time: n('變體時間', 0, 0.5, 0.005),
  filter: n('變體濾波', 0, 0.5, 0.005),
};

export const SYNTH_ENUMS = {
  color: ['white', 'pink', 'brown'],
  type: ['lowpass', 'highpass', 'bandpass'],
  wave: ['sine', 'triangle', 'saw', 'square'],
} as const;

/** 配方中所有數值欄位的路徑（例如 layers.0.filter.freq、layers.1.partials.0）；面板代理與驗證使用。 */
export function recipeNumericPaths(recipe: SynthRecipe): string[] {
  const out: string[] = [];
  const walk = (obj: unknown, prefix: string): void => {
    if (typeof obj === 'number') {
      out.push(prefix);
      return;
    }
    if (Array.isArray(obj)) {
      obj.forEach((v, i) => walk(v, prefix ? `${prefix}.${i}` : String(i)));
      return;
    }
    if (typeof obj === 'object' && obj !== null) {
      for (const [k, v] of Object.entries(obj)) walk(v, prefix ? `${prefix}.${k}` : k);
    }
  };
  walk(recipe, '');
  return out;
}

/** 路徑對應的欄位規格：取最後一個非數字段（partials.0 → partials）。 */
export function fieldSpecFor(path: string): ParamSpec | undefined {
  const parts = path.split('.');
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i]!;
    if (!/^\d+$/.test(p)) {
      // vary.gain 與圖層 gain 同名但範圍不同
      if (p === 'gain' && parts[i - 1] === 'vary') return n('變體音量', 0, 0.5, 0.005);
      return SYNTH_FIELD_SPECS[p];
    }
  }
  return undefined;
}

export function getPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const p of path.split('.')) {
    if (typeof cur !== 'object' || cur === null) return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

export function setPath(obj: unknown, path: string, value: unknown): void {
  const parts = path.split('.');
  let cur: unknown = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (typeof cur !== 'object' || cur === null) return;
    cur = (cur as Record<string, unknown>)[parts[i]!];
  }
  if (typeof cur === 'object' && cur !== null) (cur as Record<string, unknown>)[parts[parts.length - 1]!] = value;
}

/** 驗證配方；回傳錯誤訊息（空陣列 = 合法）。不丟例外。 */
export function validateRecipe(recipe: unknown, label = 'recipe'): string[] {
  const errors: string[] = [];
  if (typeof recipe !== 'object' || recipe === null) return [`${label} 必須是物件`];
  const r = recipe as Partial<SynthRecipe>;
  if (!Array.isArray(r.layers) || r.layers.length === 0) errors.push(`${label}.layers 至少要有一個圖層`);
  if (typeof r.vary !== 'object' || r.vary === null) errors.push(`${label}.vary 必須是物件`);
  for (const path of recipeNumericPaths(r as SynthRecipe)) {
    const v = getPath(r, path) as number;
    const spec = fieldSpecFor(path);
    if (!Number.isFinite(v)) errors.push(`${label}.${path} 不是有限數值`);
    else if (!spec) errors.push(`${label}.${path} 是不認識的欄位`);
    else if ((spec.min !== undefined && v < spec.min) || (spec.max !== undefined && v > spec.max)) {
      errors.push(`${label}.${path} = ${v} 超出範圍 ${spec.min}–${spec.max}`);
    }
  }
  const required = ['duration', 'peakDb'] as const;
  for (const k of required) if (typeof r[k] !== 'number') errors.push(`${label}.${k} 必須是數值`);
  (r.layers ?? []).forEach((layer, i) => {
    const L = layer as Partial<SynthLayer> & Record<string, unknown>;
    const p = `${label}.layers.${i}`;
    if (L.kind !== 'noise' && L.kind !== 'tone') errors.push(`${p}.kind 必須是 noise 或 tone`);
    for (const k of ['gain', 'delay', 'drive', 'amFreq', 'amDepth']) if (typeof L[k] !== 'number') errors.push(`${p}.${k} 必須是數值`);
    const env = L.env as Partial<SynthEnvelope> | undefined;
    if (!env || typeof env.attack !== 'number' || typeof env.hold !== 'number' || typeof env.decay !== 'number') {
      errors.push(`${p}.env 需要 attack、hold、decay`);
    }
    if (L.kind === 'noise' && !(SYNTH_ENUMS.color as readonly string[]).includes(String(L.color))) errors.push(`${p}.color 不合法`);
    if (L.kind === 'tone') {
      if (!(SYNTH_ENUMS.wave as readonly string[]).includes(String(L.wave))) errors.push(`${p}.wave 不合法`);
      for (const k of ['freq', 'freqEnd', 'glide', 'fmRatio', 'fmDepth']) if (typeof L[k] !== 'number') errors.push(`${p}.${k} 必須是數值`);
      if (!Array.isArray(L.partials)) errors.push(`${p}.partials 必須是陣列`);
    }
    if (L.filter !== undefined) {
      const f = L.filter as Partial<SynthFilter>;
      if (!(SYNTH_ENUMS.type as readonly string[]).includes(String(f.type))) errors.push(`${p}.filter.type 不合法`);
      for (const k of ['freq', 'freqEnd', 'sweep', 'q', 'lfoFreq', 'lfoDepth'] as const) {
        if (typeof f[k] !== 'number') errors.push(`${p}.filter.${k} 必須是數值`);
      }
    }
    if (typeof L.delay === 'number' && typeof r.duration === 'number' && L.delay >= r.duration) {
      errors.push(`${p}.delay 不能超過配方長度`);
    }
  });
  return errors;
}

/** 驗證音效定義（配方 + 播放規則）。 */
export function validateSoundDef(id: string, def: Readonly<SoundDef>): string[] {
  const errors = validateRecipe(def.recipe, id);
  if (!Number.isInteger(def.variants) || def.variants < 1 || def.variants > 8) errors.push(`${id}.variants 必須是 1–8 的整數`);
  if (!def.recipe.loop && (def.variants < 3 || def.variants > 5)) errors.push(`${id}.variants：單次音效需要 3–5 個變體`);
  if (def.bus !== 'sfx' && def.bus !== 'ui' && def.bus !== 'music') errors.push(`${id}.bus 不合法`);
  if (!Number.isFinite(def.gainDb) || def.gainDb < -60 || def.gainDb > 12) errors.push(`${id}.gainDb 超出 -60–12`);
  if (!Number.isFinite(def.minInterval) || def.minInterval < 0 || def.minInterval > 5) errors.push(`${id}.minInterval 超出 0–5`);
  if (!Number.isInteger(def.maxInstances) || def.maxInstances < 0) errors.push(`${id}.maxInstances 必須是非負整數`);
  if (!Number.isFinite(def.priority)) errors.push(`${id}.priority 必須是數值`);
  if (typeof def.category !== 'string' || def.category === '') errors.push(`${id}.category 不能是空的`);
  return errors;
}

// ── 變體與武器參數 ───────────────────────────────────────

export function cloneRecipe(recipe: Readonly<SynthRecipe>): SynthRecipe {
  return JSON.parse(JSON.stringify(recipe)) as SynthRecipe;
}

/** 0..1 的亂數來源（core/Rng 的 float 相容）。 */
export interface RandomSource {
  float(): number;
}

const jitter = (rng: RandomSource, amount: number): number => 1 + (rng.float() * 2 - 1) * amount;

/**
 * 產生一個變體：所有音高（振盪器頻率）× (1 ± vary.pitch)，濾波頻率 × (1 ± vary.filter)，
 * 包絡與滑音時間 × (1 ± vary.time)，每個圖層音量 × (1 ± vary.gain)。結果夾在欄位範圍內。
 */
export function varyRecipe(recipe: Readonly<SynthRecipe>, rng: RandomSource): SynthRecipe {
  const out = cloneRecipe(recipe);
  const v = recipe.vary;
  const pitch = jitter(rng, v.pitch);
  const time = jitter(rng, v.time);
  const filt = jitter(rng, v.filter);
  const clampField = (key: string, x: number): number => {
    const s = SYNTH_FIELD_SPECS[key];
    return s ? Math.min(s.max ?? x, Math.max(s.min ?? x, x)) : x;
  };
  for (const L of out.layers) {
    L.gain = clampField('gain', L.gain * jitter(rng, v.gain));
    if (!out.loop) {
      L.env.hold = clampField('hold', L.env.hold * time);
      L.env.decay = clampField('decay', L.env.decay * time);
    }
    if (L.kind === 'tone') {
      L.freq = clampField('freq', L.freq * pitch);
      L.freqEnd = clampField('freqEnd', L.freqEnd * pitch);
      L.glide = clampField('glide', L.glide * time);
    }
    if (L.filter) {
      L.filter.freq = clampField('freq', L.filter.freq * filt);
      L.filter.freqEnd = clampField('freqEnd', L.filter.freqEnd * filt);
      L.filter.sweep = clampField('sweep', L.filter.sweep * time);
    }
  }
  return out;
}

/**
 * 武器開火配方：以 WeaponDef.audio.params 調整基礎配方（M2 生成的武器沿用）。
 * pitch：所有音高與濾波頻率倍率；body／crack／charge：對應標籤圖層的音量倍率（charge 預設 0 = 關閉）；
 * tail：殘響比例與長度倍率。未知的參數忽略。
 */
export function weaponFireRecipe(base: Readonly<SynthRecipe>, params: Readonly<Record<string, number>>): SynthRecipe {
  const out = cloneRecipe(base);
  const num = (k: string, d: number): number => {
    const x = params[k];
    return typeof x === 'number' && Number.isFinite(x) ? x : d;
  };
  const pitch = Math.min(4, Math.max(0.25, num('pitch', 1)));
  const scale: Record<string, number> = {
    body: Math.max(0, num('body', 1)),
    crack: Math.max(0, num('crack', 1)),
    charge: Math.max(0, num('charge', 0)),
  };
  const tail = Math.max(0, num('tail', 0.5));
  const cl = (key: string, x: number): number => {
    const s = SYNTH_FIELD_SPECS[key]!;
    return Math.min(s.max!, Math.max(s.min!, x));
  };
  out.layers = out.layers.filter((L) => !(L.tag === 'charge' && scale.charge === 0));
  for (const L of out.layers) {
    const k = L.tag ? scale[L.tag] : undefined;
    if (k !== undefined) L.gain = cl('gain', L.gain * k);
    if (L.kind === 'tone') {
      L.freq = cl('freq', L.freq * pitch);
      L.freqEnd = cl('freqEnd', L.freqEnd * pitch);
    }
    if (L.filter) {
      L.filter.freq = cl('freq', L.filter.freq * pitch);
      L.filter.freqEnd = cl('freqEnd', L.filter.freqEnd * pitch);
    }
  }
  if (out.reverb) {
    // tail 0.5 = 配方原值；0 = 乾聲；1 = 比例與長度都 ×2（上限依欄位範圍）
    out.reverb.mix = cl('mix', out.reverb.mix * tail * 2);
    out.reverb.decay = cl('decay', out.reverb.decay * (0.5 + tail));
  }
  return out;
}

/** 武器參數的簽章（快取 key；參數改變時重新渲染）。 */
export function weaponSoundKey(fire: string, params: Readonly<Record<string, number>>): string {
  const keys = Object.keys(params).sort();
  let s = `fire.${fire}`;
  for (const k of keys) s += `|${k}=${params[k]}`;
  return s;
}

// ── 建構輔助（補齊預設值，資料保持完整，面板才找得到每個欄位）──

type LayerInit = Partial<Omit<LayerBase, 'env' | 'filter'>> & {
  env?: Partial<SynthEnvelope>;
  filter?: Partial<SynthFilter> & { type: FilterType; freq: number };
};

function env(e: Partial<SynthEnvelope> | undefined): SynthEnvelope {
  return { attack: e?.attack ?? 0.001, hold: e?.hold ?? 0, decay: e?.decay ?? 0.1 };
}

function filter(f: LayerInit['filter']): SynthFilter | undefined {
  if (!f) return undefined;
  return {
    type: f.type,
    freq: f.freq,
    freqEnd: f.freqEnd ?? f.freq,
    sweep: f.sweep ?? 0,
    q: f.q ?? 0.707,
    lfoFreq: f.lfoFreq ?? 0,
    lfoDepth: f.lfoDepth ?? 0,
  };
}

function base(init: LayerInit): Omit<LayerBase, 'filter'> & { filter?: SynthFilter } {
  const out: Omit<LayerBase, 'filter'> & { filter?: SynthFilter } = {
    gain: init.gain ?? 1,
    delay: init.delay ?? 0,
    env: env(init.env),
    drive: init.drive ?? 0,
    amFreq: init.amFreq ?? 0,
    amDepth: init.amDepth ?? 0,
  };
  if (init.tag !== undefined) out.tag = init.tag;
  const f = filter(init.filter);
  if (f) out.filter = f;
  return out;
}

export function noise(color: NoiseColor, init: LayerInit = {}): NoiseLayer {
  return { kind: 'noise', color, ...base(init) };
}

export function tone(
  wave: Waveform,
  freq: number,
  init: LayerInit & { freqEnd?: number; glide?: number; fmRatio?: number; fmDepth?: number; partials?: number[] } = {},
): ToneLayer {
  return {
    kind: 'tone',
    wave,
    freq,
    freqEnd: init.freqEnd ?? freq,
    glide: init.glide ?? 0,
    fmRatio: init.fmRatio ?? 0,
    fmDepth: init.fmDepth ?? 0,
    partials: init.partials ? [...init.partials] : [],
    ...base(init),
  };
}

function recipe(
  duration: number,
  layers: SynthLayer[],
  opts: { reverb?: Partial<SynthReverb>; vary?: Partial<SynthVary>; peakDb?: number; loop?: boolean } = {},
): SynthRecipe {
  const out: SynthRecipe = {
    duration,
    peakDb: opts.peakDb ?? -1,
    layers,
    vary: { pitch: 0.04, time: 0.1, filter: 0.12, gain: 0.1, ...opts.vary },
  };
  if (opts.reverb) out.reverb = { mix: 0.2, decay: 0.8, size: 0.6, damp: 0.4, ...opts.reverb };
  if (opts.loop) out.loop = true;
  return out;
}

interface DefInit {
  variants?: number;
  bus?: AudioBusName;
  gainDb?: number;
  priority?: number;
  minInterval?: number;
  maxInstances?: number;
  spatial?: boolean;
}

function sound(category: string, r: SynthRecipe, init: DefInit = {}): SoundDef {
  const out: SoundDef = {
    recipe: r,
    variants: init.variants ?? (r.loop ? 1 : 4),
    bus: init.bus ?? 'sfx',
    category,
    gainDb: init.gainDb ?? 0,
    priority: init.priority ?? 50,
    minInterval: init.minInterval ?? 0,
    maxInstances: init.maxInstances ?? 0,
  };
  if (init.spatial) out.spatial = true;
  return out;
}

// ── 音效清單 ─────────────────────────────────────────────

/** 武器開火的基礎配方（WeaponDef.audio.fire → fire.<id>；再以 audio.params 調整）。 */
export const WEAPON_FIRE_RECIPES: Readonly<Record<string, SynthRecipe>> = {
  // 突擊步槍：乾脆的中頻爆裂 + 短促低頻 + 機件聲
  rifle: recipe(
    0.75,
    [
      noise('white', { tag: 'crack', gain: 1, env: { decay: 0.11 }, filter: { type: 'bandpass', freq: 2600, freqEnd: 1100, sweep: 0.04, q: 0.8 } }),
      tone('sine', 190, { tag: 'body', freqEnd: 55, glide: 0.03, gain: 1.1, env: { decay: 0.16 }, drive: 0.6 }),
      noise('white', { tag: 'crack', gain: 0.35, env: { decay: 0.035 }, filter: { type: 'highpass', freq: 5000 } }),
      tone('triangle', 1450, { gain: 0.08, delay: 0.02, env: { decay: 0.05 }, partials: [2.7, 4.2] }),
    ],
    { reverb: { mix: 0.22, decay: 0.7, size: 0.7 }, vary: { pitch: 0.03, filter: 0.08 } },
  ),
  // 霰彈槍：寬、重的低頻與粗糙中頻
  shotgun: recipe(
    1.3,
    [
      tone('sine', 130, { tag: 'body', freqEnd: 38, glide: 0.06, gain: 1.3, env: { decay: 0.32 }, drive: 0.9 }),
      noise('white', { tag: 'crack', gain: 0.9, env: { decay: 0.22 }, filter: { type: 'bandpass', freq: 1500, freqEnd: 500, sweep: 0.08, q: 0.6 } }),
      noise('brown', { tag: 'body', gain: 0.8, env: { decay: 0.4 }, filter: { type: 'lowpass', freq: 900, freqEnd: 250, sweep: 0.2 } }),
    ],
    { reverb: { mix: 0.3, decay: 1.2, size: 0.9 }, vary: { pitch: 0.03 } },
  ),
  // 重型手炮：高能量的爆裂 + 金屬餘響
  handcannon: recipe(
    1.1,
    [
      tone('sine', 150, { tag: 'body', freqEnd: 42, glide: 0.045, gain: 1.2, env: { decay: 0.26 }, drive: 1.1 }),
      noise('white', { tag: 'crack', gain: 1, env: { decay: 0.14 }, filter: { type: 'bandpass', freq: 3200, freqEnd: 900, sweep: 0.05, q: 1 } }),
      tone('triangle', 880, { gain: 0.12, delay: 0.005, env: { decay: 0.25 }, partials: [2.31, 3.87] }),
    ],
    { reverb: { mix: 0.28, decay: 1.0, size: 0.85 } },
  ),
  // 磁軌狙擊槍：電磁「啪嚓」+ 下滑的嗡鳴 + 長尾巴；charge 圖層為啟動的上升音
  railgun: recipe(
    1.6,
    [
      tone('saw', 1800, { tag: 'charge', freqEnd: 5200, glide: 0.03, gain: 0.25, env: { attack: 0.002, decay: 0.05 }, filter: { type: 'lowpass', freq: 7000 } }),
      noise('white', { tag: 'crack', gain: 0.9, env: { decay: 0.08 }, filter: { type: 'highpass', freq: 2800 } }),
      tone('square', 1600, { tag: 'crack', freqEnd: 140, glide: 0.07, gain: 0.35, env: { decay: 0.3 }, filter: { type: 'lowpass', freq: 5000, freqEnd: 900, sweep: 0.15 } }),
      tone('sine', 95, { tag: 'body', freqEnd: 32, glide: 0.08, gain: 1.1, env: { decay: 0.45 }, drive: 0.7 }),
      tone('sine', 420, { gain: 0.25, env: { attack: 0.01, decay: 0.6 }, fmRatio: 1.41, fmDepth: 2.5, amFreq: 31, amDepth: 0.4 }),
    ],
    { reverb: { mix: 0.4, decay: 1.5, size: 1.1, damp: 0.3 } },
  ),
  // 電漿發射器：低沉的「噗咻」+ 氣泡感 FM
  plasma: recipe(
    1.0,
    [
      tone('saw', 320, { tag: 'body', freqEnd: 85, glide: 0.1, gain: 0.8, env: { attack: 0.004, decay: 0.32 }, filter: { type: 'lowpass', freq: 2400, freqEnd: 380, sweep: 0.12, q: 2 } }),
      tone('sine', 230, { gain: 0.6, freqEnd: 140, glide: 0.12, env: { decay: 0.28 }, fmRatio: 1.5, fmDepth: 3 }),
      noise('pink', { tag: 'crack', gain: 0.6, env: { decay: 0.2 }, filter: { type: 'bandpass', freq: 900, freqEnd: 400, sweep: 0.1, q: 0.9 } }),
    ],
    { reverb: { mix: 0.28, decay: 0.9, size: 0.8 } },
  ),
};

/** 武器開火音效的播放規則（每把武器共用）。 */
export const WEAPON_FIRE_DEF: Omit<SoundDef, 'recipe'> = {
  variants: 4,
  bus: 'sfx',
  category: 'weapon',
  gainDb: -2,
  priority: 90,
  minInterval: 0.02,
  maxInstances: 4,
};

const click = (freq: number, decay: number, gain = 1, delay = 0): NoiseLayer =>
  noise('white', { gain, delay, env: { decay }, filter: { type: 'bandpass', freq, q: 1.6 } });
const thud = (freq: number, decay: number, gain = 1, delay = 0): ToneLayer =>
  tone('sine', freq, { freqEnd: freq * 0.55, glide: decay * 0.4, gain, delay, env: { decay } });
const ring = (freq: number, decay: number, gain: number, partials: number[], delay = 0): ToneLayer =>
  tone('triangle', freq, { gain, delay, env: { decay }, partials });

/** 全部音效（武器開火另外由 WEAPON_FIRE_RECIPES 產生，id 為 fire.<archetype>）。 */
export const SOUND_DEFS: Record<string, SoundDef> = {
  // ── 武器 ──
  dryFire: sound('weapon', recipe(0.1, [click(3200, 0.018), tone('sine', 2400, { gain: 0.3, env: { decay: 0.012 } })]), {
    gainDb: -6,
    minInterval: 0.08,
  }),
  'reload.magOut': sound('weapon', recipe(0.28, [click(1800, 0.05), ring(620, 0.07, 0.25, [2.7, 5.1]), click(2600, 0.03, 0.6, 0.045)]), {
    gainDb: -5,
  }),
  'reload.magIn': sound('weapon', recipe(0.22, [click(2400, 0.03), thud(210, 0.06, 0.8), ring(980, 0.05, 0.18, [2.2])]), { gainDb: -4 }),
  'reload.cellOut': sound(
    'weapon',
    recipe(0.3, [
      tone('sine', 1300, { freqEnd: 380, glide: 0.05, gain: 0.5, env: { decay: 0.15 }, fmRatio: 2, fmDepth: 1.5 }),
      click(2000, 0.04, 0.7),
    ]),
    { gainDb: -6 },
  ),
  'reload.cellIn': sound(
    'weapon',
    recipe(0.35, [
      click(2600, 0.03),
      tone('sine', 420, { freqEnd: 1500, glide: 0.08, gain: 0.45, delay: 0.02, env: { attack: 0.01, decay: 0.2 } }),
      thud(180, 0.05, 0.6),
    ]),
    { gainDb: -5 },
  ),
  'reload.cylinderOpen': sound('weapon', recipe(0.25, [click(2200, 0.03), ring(1350, 0.09, 0.3, [1.9, 3.3]), click(1500, 0.04, 0.5, 0.06)]), {
    gainDb: -5,
  }),
  'reload.cylinderClose': sound('weapon', recipe(0.3, [click(1900, 0.03), thud(260, 0.06, 0.8), ring(1700, 0.12, 0.3, [2.4, 3.9])]), {
    gainDb: -4,
  }),
  'reload.rack': sound('weapon', recipe(0.32, [click(2000, 0.035), ring(800, 0.05, 0.2, [2.5]), click(1500, 0.04, 0.9, 0.08), thud(240, 0.05, 0.5, 0.08)]), {
    gainDb: -4,
  }),
  'reload.shell': sound('weapon', recipe(0.2, [click(1200, 0.04, 0.8), thud(300, 0.05, 0.9), click(3000, 0.015, 0.3, 0.01)]), {
    gainDb: -6,
  }),
  'reload.pumpBack': sound(
    'weapon',
    recipe(0.25, [noise('white', { gain: 0.7, env: { attack: 0.01, decay: 0.06 }, filter: { type: 'bandpass', freq: 900, q: 1.2 } }), click(1600, 0.04, 0.9, 0.04)]),
    { gainDb: -4 },
  ),
  'reload.pumpForward': sound('weapon', recipe(0.25, [click(1300, 0.04), thud(220, 0.06, 0.8, 0.01), ring(700, 0.06, 0.15, [2.3])]), {
    gainDb: -4,
  }),
  'swap.out': sound(
    'weapon',
    recipe(0.3, [noise('pink', { gain: 0.6, env: { attack: 0.02, decay: 0.12 }, filter: { type: 'bandpass', freq: 1500, q: 0.7 } }), click(2200, 0.03, 0.5, 0.1)]),
    { gainDb: -9, minInterval: 0.05 },
  ),
  'swap.in': sound(
    'weapon',
    recipe(0.3, [noise('pink', { gain: 0.5, env: { attack: 0.015, decay: 0.1 }, filter: { type: 'bandpass', freq: 1800, q: 0.7 } }), ring(1500, 0.05, 0.3, [2.1], 0.06), click(2600, 0.025, 0.6, 0.06)]),
    { gainDb: -7, minInterval: 0.05 },
  ),
  'ads.in': sound('weapon', recipe(0.2, [noise('pink', { gain: 0.6, env: { attack: 0.03, decay: 0.08 }, filter: { type: 'lowpass', freq: 1400 } }), click(3000, 0.012, 0.25, 0.04)]), {
    gainDb: -12,
    minInterval: 0.08,
  }),
  'ads.out': sound('weapon', recipe(0.18, [noise('pink', { gain: 0.6, env: { attack: 0.02, decay: 0.07 }, filter: { type: 'lowpass', freq: 1900 } })]), {
    gainDb: -14,
    minInterval: 0.08,
  }),
  'melee.swing': sound(
    'weapon',
    recipe(0.32, [noise('white', { gain: 1, env: { attack: 0.05, decay: 0.15 }, filter: { type: 'bandpass', freq: 500, freqEnd: 2200, sweep: 0.08, q: 1.5 } })]),
    { gainDb: -6 },
  ),
  'melee.hit': sound('weapon', recipe(0.4, [thud(160, 0.12, 1.2), click(1200, 0.06, 0.8), ring(520, 0.1, 0.15, [2.6])], { reverb: { mix: 0.15, decay: 0.5 } }), {
    gainDb: -2,
  }),
  'plasma.flight': sound(
    'weapon',
    recipe(
      1.2,
      [
        tone('sine', 180, { gain: 0.7, fmRatio: 0.5, fmDepth: 2, amFreq: 10, amDepth: 0.3 }),
        noise('pink', { gain: 0.5, filter: { type: 'bandpass', freq: 750, q: 1.2, lfoFreq: 2.5, lfoDepth: 0.3 } }),
      ],
      { loop: true, vary: { pitch: 0.05 } },
    ),
    { gainDb: -6, spatial: true },
  ),
  explosion: sound(
    'explosion',
    recipe(
      2.2,
      [
        tone('sine', 85, { freqEnd: 28, glide: 0.15, gain: 1.3, env: { decay: 0.8 }, drive: 1.3 }),
        noise('brown', { gain: 1.1, env: { decay: 1.2 }, filter: { type: 'lowpass', freq: 1600, freqEnd: 260, sweep: 0.3 } }),
        noise('white', { gain: 0.5, env: { decay: 0.18 }, filter: { type: 'bandpass', freq: 2500, q: 0.8 }, amFreq: 43, amDepth: 0.5 }),
      ],
      { reverb: { mix: 0.38, decay: 1.8, size: 1.2 } },
    ),
    { gainDb: 0, priority: 85, maxInstances: 3, spatial: true },
  ),
  impact: sound('impact', recipe(0.14, [click(3200, 0.03, 0.9), ring(2300, 0.04, 0.2, [1.7, 2.9])]), {
    gainDb: -14,
    priority: 10,
    minInterval: 0.025,
    spatial: true,
  }),

  // ── 移動 ──
  'step.metal': sound('footstep', recipe(0.22, [thud(125, 0.05, 1), click(1800, 0.04, 0.7), ring(1100, 0.07, 0.12, [2.4])]), {
    gainDb: -11,
    minInterval: 0.07,
  }),
  'step.grate': sound('footstep', recipe(0.22, [thud(140, 0.04, 0.8), noise('white', { gain: 0.8, env: { decay: 0.07 }, filter: { type: 'bandpass', freq: 2400, q: 2 }, amFreq: 60, amDepth: 0.7 })]), {
    gainDb: -11,
    minInterval: 0.07,
  }),
  'step.glass': sound('footstep', recipe(0.26, [thud(150, 0.04, 0.6), tone('sine', 3200, { gain: 0.25, env: { decay: 0.08 }, partials: [1.6, 2.3] }), noise('white', { gain: 0.3, env: { decay: 0.02 }, filter: { type: 'highpass', freq: 5000 } })]), {
    gainDb: -12,
    minInterval: 0.07,
  }),
  jump: sound(
    'movement',
    recipe(0.26, [
      noise('pink', { gain: 0.7, env: { attack: 0.01, decay: 0.1 }, filter: { type: 'bandpass', freq: 900, q: 0.8 } }),
      thud(140, 0.04, 0.6),
      tone('sine', 600, { freqEnd: 950, glide: 0.04, gain: 0.12, env: { decay: 0.08 } }),
    ]),
    { gainDb: -10, minInterval: 0.05 },
  ),
  doubleJump: sound(
    'movement',
    recipe(0.5, [
      noise('white', { gain: 0.9, env: { attack: 0.005, decay: 0.25 }, filter: { type: 'bandpass', freq: 800, freqEnd: 280, sweep: 0.1, q: 0.9 } }),
      thud(95, 0.15, 0.9),
      noise('brown', { gain: 0.6, env: { decay: 0.3 }, filter: { type: 'lowpass', freq: 600 } }),
    ]),
    { gainDb: -6, minInterval: 0.05 },
  ),
  jet: sound(
    'movement',
    recipe(
      1.4,
      [
        noise('brown', { gain: 1, filter: { type: 'lowpass', freq: 1100, q: 0.8, lfoFreq: 0.7, lfoDepth: 0.15 } }),
        noise('white', { gain: 0.35, filter: { type: 'bandpass', freq: 2500, q: 0.7 }, amFreq: 23, amDepth: 0.25 }),
        tone('sine', 72, { gain: 0.4, amFreq: 7, amDepth: 0.2 }),
      ],
      { loop: true },
    ),
    { gainDb: -8 },
  ),
  'land.light': sound('movement', recipe(0.26, [thud(115, 0.08, 1), noise('white', { gain: 0.6, env: { decay: 0.05 }, filter: { type: 'bandpass', freq: 1000, q: 0.9 } })]), {
    gainDb: -8,
    minInterval: 0.08,
  }),
  'land.heavy': sound(
    'movement',
    recipe(
      0.85,
      [
        tone('sine', 80, { freqEnd: 34, glide: 0.08, gain: 1.3, env: { decay: 0.3 }, drive: 1.2 }),
        noise('white', { gain: 0.6, env: { decay: 0.22 }, filter: { type: 'lowpass', freq: 1600, freqEnd: 500, sweep: 0.1 } }),
        ring(410, 0.4, 0.12, [2.1, 3.7]),
      ],
      { reverb: { mix: 0.18, decay: 0.7 } },
    ),
    { gainDb: -3, minInterval: 0.1 },
  ),
  'slide.start': sound('movement', recipe(0.38, [noise('white', { gain: 0.8, env: { attack: 0.01, decay: 0.2 }, filter: { type: 'bandpass', freq: 1400, freqEnd: 3000, sweep: 0.1, q: 1 } }), thud(120, 0.05, 0.6)]), {
    gainDb: -8,
    minInterval: 0.1,
  }),
  slide: sound(
    'movement',
    recipe(
      1.0,
      [
        noise('white', { gain: 0.8, filter: { type: 'bandpass', freq: 2200, q: 0.8, lfoFreq: 7, lfoDepth: 0.25 } }),
        noise('brown', { gain: 0.6, filter: { type: 'lowpass', freq: 420 } }),
      ],
      { loop: true },
    ),
    { gainDb: -12 },
  ),
  wallRun: sound(
    'movement',
    recipe(
      1.0,
      [
        noise('white', { gain: 0.7, filter: { type: 'bandpass', freq: 1600, q: 1.4, lfoFreq: 3, lfoDepth: 0.3 }, amFreq: 6, amDepth: 0.45 }),
        noise('brown', { gain: 0.5, filter: { type: 'lowpass', freq: 320 } }),
      ],
      { loop: true },
    ),
    { gainDb: -13 },
  ),
  wallJump: sound(
    'movement',
    recipe(0.42, [thud(150, 0.08, 1), noise('pink', { gain: 0.7, env: { attack: 0.01, decay: 0.18 }, filter: { type: 'bandpass', freq: 1200, q: 0.8 } }), ring(900, 0.1, 0.15, [2.6])]),
    { gainDb: -7, minInterval: 0.05 },
  ),
  mantle: sound(
    'movement',
    recipe(0.48, [
      click(1400, 0.06, 0.8),
      thud(200, 0.06, 0.7),
      noise('pink', { gain: 0.6, delay: 0.12, env: { attack: 0.02, decay: 0.15 }, filter: { type: 'bandpass', freq: 900, q: 0.8 } }),
    ]),
    { gainDb: -8, minInterval: 0.1 },
  ),
  dash: sound(
    'movement',
    recipe(
      0.5,
      [
        noise('white', { gain: 1, env: { attack: 0.005, decay: 0.22 }, filter: { type: 'bandpass', freq: 400, freqEnd: 3000, sweep: 0.08, q: 1.2 } }),
        tone('sine', 220, { freqEnd: 80, glide: 0.1, gain: 0.5, env: { decay: 0.15 } }),
      ],
      { reverb: { mix: 0.15, decay: 0.5 } },
    ),
    { gainDb: -4, minInterval: 0.05 },
  ),
  'grapple.fire': sound(
    'movement',
    recipe(0.36, [
      tone('saw', 900, { freqEnd: 300, glide: 0.1, gain: 0.4, env: { decay: 0.2 }, filter: { type: 'lowpass', freq: 4000 } }),
      click(2400, 0.03, 0.8),
      noise('white', { gain: 0.3, env: { decay: 0.05 }, filter: { type: 'highpass', freq: 4000 } }),
    ]),
    { gainDb: -7, minInterval: 0.05 },
  ),
  'grapple.attach': sound('movement', recipe(0.5, [ring(700, 0.25, 0.4, [2.3, 4.1]), click(2500, 0.04, 0.9), thud(160, 0.06, 0.8)]), {
    gainDb: -5,
    minInterval: 0.05,
  }),
  'grapple.reel': sound(
    'movement',
    recipe(
      0.75,
      [
        tone('saw', 140, { gain: 0.6, amFreq: 32, amDepth: 0.9, filter: { type: 'bandpass', freq: 1800, q: 1.2 } }),
        noise('white', { gain: 0.3, filter: { type: 'highpass', freq: 3000 }, amFreq: 32, amDepth: 0.8 }),
      ],
      { loop: true },
    ),
    { gainDb: -10 },
  ),
  'grapple.release': sound('movement', recipe(0.2, [click(3000, 0.05, 0.7), tone('sine', 1200, { freqEnd: 600, glide: 0.04, gain: 0.3, env: { decay: 0.06 } })]), {
    gainDb: -9,
    minInterval: 0.05,
  }),
  wind: sound(
    'ambient',
    recipe(
      4.0,
      [
        noise('pink', { gain: 1, filter: { type: 'bandpass', freq: 520, q: 0.5, lfoFreq: 0.5, lfoDepth: 0.4 } }),
        noise('white', { gain: 0.25, filter: { type: 'highpass', freq: 3000, lfoFreq: 0.75, lfoDepth: 0.3 } }),
      ],
      { loop: true },
    ),
    { gainDb: -10 },
  ),
  abilityReady: sound('feedback', recipe(0.16, [tone('sine', 1320, { gain: 0.6, env: { decay: 0.08 } }), tone('sine', 1980, { gain: 0.4, delay: 0.04, env: { decay: 0.08 } })]), {
    gainDb: -16,
    minInterval: 0.1,
  }),

  // ── 戰鬥回饋 ──
  hit: sound('feedback', recipe(0.08, [tone('sine', 2600, { gain: 0.8, env: { decay: 0.03 } }), noise('white', { gain: 0.3, env: { decay: 0.012 }, filter: { type: 'highpass', freq: 6000 } })]), {
    gainDb: -8,
    priority: 70,
    minInterval: 0.03,
    maxInstances: 2,
  }),
  'hit.crit': sound('feedback', recipe(0.16, [tone('sine', 4200, { gain: 0.7, env: { decay: 0.08 }, partials: [1.5] }), tone('sine', 2600, { gain: 0.4, env: { decay: 0.03 } })]), {
    gainDb: -7,
    priority: 72,
    minInterval: 0.03,
    maxInstances: 2,
  }),
  'hit.kill': sound(
    'feedback',
    recipe(0.45, [tone('sine', 900, { freqEnd: 620, glide: 0.06, gain: 0.8, env: { decay: 0.15 } }), tone('sine', 1800, { gain: 0.4, env: { decay: 0.12 } }), click(3000, 0.03, 0.5)], {
      reverb: { mix: 0.2, decay: 0.6 },
    }),
    { gainDb: -6, priority: 80, minInterval: 0.05, maxInstances: 2 },
  ),
  shieldBreak: sound(
    'feedback',
    recipe(
      0.9,
      [
        noise('white', { gain: 0.8, env: { decay: 0.3 }, filter: { type: 'highpass', freq: 4000 }, amFreq: 37, amDepth: 0.5 }),
        tone('sine', 2800, { gain: 0.35, env: { decay: 0.35 }, partials: [1.37, 1.93, 2.71] }),
        tone('sine', 320, { freqEnd: 100, glide: 0.08, gain: 0.7, env: { decay: 0.2 } }),
      ],
      { reverb: { mix: 0.3, decay: 0.9 } },
    ),
    { gainDb: -3, priority: 88, minInterval: 0.2 },
  ),
  'hurt.shield': sound('feedback', recipe(0.26, [tone('sine', 520, { freqEnd: 200, glide: 0.04, gain: 0.7, env: { decay: 0.1 }, fmRatio: 3, fmDepth: 2 }), click(2000, 0.06, 0.6)]), {
    gainDb: -7,
    priority: 75,
    minInterval: 0.05,
  }),
  'hurt.health': sound('feedback', recipe(0.32, [tone('sine', 125, { freqEnd: 52, glide: 0.06, gain: 1.1, env: { decay: 0.15 }, drive: 1 }), noise('brown', { gain: 0.6, env: { decay: 0.1 }, filter: { type: 'lowpass', freq: 800 } })]), {
    gainDb: -5,
    priority: 78,
    minInterval: 0.05,
  }),
  heartbeat: sound('feedback', recipe(0.6, [thud(62, 0.12, 1), thud(55, 0.14, 0.8, 0.22)], { vary: { pitch: 0.02, time: 0.05 } }), {
    gainDb: -6,
    priority: 60,
    minInterval: 0.25,
  }),
  shieldRecharge: sound(
    'feedback',
    recipe(0.6, [tone('sine', 420, { freqEnd: 1250, glide: 0.18, gain: 0.5, env: { attack: 0.05, decay: 0.4 }, amFreq: 18, amDepth: 0.3 })]),
    { gainDb: -14, minInterval: 0.5 },
  ),
  death: sound(
    'feedback',
    recipe(
      1.8,
      [
        tone('saw', 200, { freqEnd: 48, glide: 0.4, gain: 0.6, env: { decay: 1.0 }, filter: { type: 'lowpass', freq: 800 } }),
        noise('brown', { gain: 0.6, env: { decay: 0.8 }, filter: { type: 'lowpass', freq: 600 } }),
      ],
      { reverb: { mix: 0.45, decay: 1.6 } },
    ),
    { gainDb: -4, priority: 95, minInterval: 0.5 },
  ),
  revive: sound(
    'feedback',
    recipe(1.0, [tone('sine', 300, { freqEnd: 600, glide: 0.25, gain: 0.5, env: { attack: 0.1, decay: 0.5 } }), tone('sine', 450, { freqEnd: 900, glide: 0.25, gain: 0.35, env: { attack: 0.1, decay: 0.5 } })], {
      reverb: { mix: 0.35, decay: 1.0 },
    }),
    { gainDb: -10, priority: 60, minInterval: 0.5 },
  ),

  // ── 敵人（M1-12 訓練無人機；M3 的敵人沿用）──
  'enemy.fire': sound(
    'enemy',
    recipe(0.42, [tone('sine', 700, { freqEnd: 280, glide: 0.08, gain: 0.7, env: { decay: 0.2 }, fmRatio: 1.5, fmDepth: 2 }), noise('pink', { gain: 0.5, env: { decay: 0.1 }, filter: { type: 'bandpass', freq: 1200, q: 1 } })], {
      reverb: { mix: 0.15, decay: 0.6 },
    }),
    { gainDb: -6, priority: 65, minInterval: 0.03, spatial: true },
  ),
  'enemy.impact': sound('enemy', recipe(0.36, [noise('white', { gain: 0.8, env: { decay: 0.15 }, filter: { type: 'bandpass', freq: 1800, q: 1 } }), thud(300, 0.1, 0.6)]), {
    gainDb: -8,
    priority: 40,
    minInterval: 0.03,
    spatial: true,
  }),
  'explosion.small': sound(
    'explosion',
    recipe(
      1.4,
      [
        tone('sine', 120, { freqEnd: 40, glide: 0.1, gain: 1.1, env: { decay: 0.5 }, drive: 1 }),
        noise('brown', { gain: 1, env: { decay: 0.7 }, filter: { type: 'lowpass', freq: 2000, freqEnd: 400, sweep: 0.2 } }),
        noise('white', { gain: 0.4, env: { decay: 0.12 }, filter: { type: 'bandpass', freq: 3000, q: 0.8 }, amFreq: 51, amDepth: 0.5 }),
      ],
      { reverb: { mix: 0.3, decay: 1.2 } },
    ),
    { gainDb: -2, priority: 80, maxInstances: 3, spatial: true },
  ),

  // ── 介面（M1-14 的選單使用）──
  'ui.hover': sound('ui', recipe(0.06, [tone('sine', 1800, { gain: 0.5, env: { decay: 0.03 } })]), {
    variants: 3,
    bus: 'ui',
    gainDb: -18,
    minInterval: 0.03,
  }),
  'ui.click': sound('ui', recipe(0.08, [tone('sine', 1200, { gain: 0.6, env: { decay: 0.04 } }), click(4000, 0.01, 0.3)]), {
    variants: 3,
    bus: 'ui',
    gainDb: -12,
    minInterval: 0.03,
  }),
  'ui.confirm': sound('ui', recipe(0.26, [tone('sine', 880, { gain: 0.6, env: { decay: 0.08 } }), tone('sine', 1320, { gain: 0.6, delay: 0.06, env: { decay: 0.12 } })]), {
    variants: 3,
    bus: 'ui',
    gainDb: -12,
    minInterval: 0.05,
  }),
  'ui.back': sound('ui', recipe(0.26, [tone('sine', 1320, { gain: 0.5, env: { decay: 0.08 } }), tone('sine', 880, { gain: 0.6, delay: 0.06, env: { decay: 0.12 } })]), {
    variants: 3,
    bus: 'ui',
    gainDb: -12,
    minInterval: 0.05,
  }),
};

/** 武器開火音效的 id（WeaponDef.audio.fire；未知的回退到 rifle）。 */
export function weaponFireSoundId(fire: string): string {
  return `fire.${fire in WEAPON_FIRE_RECIPES ? fire : 'rifle'}`;
}

/** 預設武器開火音效（params 用原型預設值時的定義；實際播放以 WeaponDef.audio.params 渲染）。 */
export function weaponFireDef(fire: string, params: Readonly<Record<string, number>> = {}): SoundDef {
  const baseRecipe = WEAPON_FIRE_RECIPES[fire] ?? WEAPON_FIRE_RECIPES.rifle!;
  return { ...WEAPON_FIRE_DEF, recipe: weaponFireRecipe(baseRecipe, params) };
}
