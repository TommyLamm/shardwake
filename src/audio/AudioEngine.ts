// 音訊引擎（M1-13）：WebAudio 的匯流排、發聲槽、循環音、空間音源與玩家操作解鎖。
//
// 圖：音源 → 發聲槽 Gain（→ Panner）→ sfx／ui／music 匯流排 → master → 壓縮器 → 限幅器 → destination。
// - AudioContext 在玩家第一次操作（pointerdown／keydown／touchend／click）時才建立；之後的操作若發現 context
//   不在 running（被瀏覽器暫停、iframe autoplay 被擋）就 resume。Web Audio 不可用或建立失敗時進入 unavailable：
//   所有 API 仍可呼叫，只是不發聲（不丟例外）。
// - 分頁隱藏時 suspend，回來時 resume（需要時等下一次玩家操作）。context 不在 running 時 play() 直接丟棄，
//   不會在恢復時一次補播一堆舊聲音。
// - 每次 play 只建立一個 AudioBufferSourceNode（規格上只能播一次）；Gain／Panner 是常駐的發聲槽，
//   數量固定，同時發聲上限與搶占見 audioMath.VoiceAllocator。
// - 音效在載入時以 synth.ts 預渲染成樣本（prerender），解鎖時一次轉成 AudioBuffer。
import { AUDIO_CONFIG, type AudioConfig } from '@/audio/AudioConfig';
import { busGain, dbToGain, pickVariant, randomVariation, Throttle, VoiceAllocator, type Variation } from '@/audio/audioMath';
import { renderVariants } from '@/audio/synth';
import {
  SOUND_DEFS,
  WEAPON_FIRE_RECIPES,
  weaponFireDef,
  weaponSoundKey,
  type AudioBusName,
  type SoundDef,
} from '@/audio/SynthRecipes';
import { Rng } from '@/core/Rng';

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

export interface QuatLike {
  x: number;
  y: number;
  z: number;
  w: number;
}

export interface PlayOptions {
  /** 額外音量（dB）。 */
  gainDb?: number;
  /** 播放速率倍率（乘在隨機變化上）。 */
  rate?: number;
  /** 世界位置：有給時用 3D 發聲槽（HRTF Panner）。 */
  position?: Readonly<Vec3Like>;
  /** 延遲（s，音訊時間）。 */
  delay?: number;
  /** 關閉隨機變化（預設開）。 */
  noVariation?: boolean;
}

export interface LoopHandle {
  readonly id: string;
  /** 目標增益（線性；0 = 淡出，閒置一段時間後停止音源）與播放速率。 */
  set(gain: number, rate?: number): void;
  /** 2D 循環音的聲像 -1..1。 */
  setPan(pan: number): void;
  /** 空間循環音的世界位置。 */
  setPosition(x: number, y: number, z: number): void;
  /** 立即淡出（= set(0)）。 */
  stop(): void;
  /** 音源正在播放（含淡出中）。 */
  readonly active: boolean;
  readonly target: number;
}

export interface AudioSink {
  play(id: string, opts?: PlayOptions): boolean;
  loop(id: string, opts?: { spatial?: boolean }): LoopHandle;
  /** WeaponDef.audio → 開火音效 id（參數組合第一次出現時同步渲染）。 */
  weaponSound(audio: { fire: string; params: Readonly<Record<string, number>> }): string;
}

export type AudioStatus = 'unavailable' | 'locked' | 'suspended' | 'running';

export interface PrerenderReport {
  sounds: number;
  variants: number;
  /** 音訊總長（s）。 */
  seconds: number;
  /** 樣本記憶體（bytes，Float32）。 */
  bytes: number;
  /** 實際運算時間（ms，不含讓出主執行緒的等待）。 */
  ms: number;
  /** 牆鐘時間（ms）。 */
  wallMs: number;
  sampleRate: number;
}

export interface AudioStats {
  plays: number;
  /** context 不在 running（解鎖前、分頁隱藏、被擋）時丟棄的播放。 */
  silent: number;
  throttled: number;
  stolen: number;
  dropped: number;
  unknown: number;
  loopStarts: number;
  /** 解鎖次數與 resume 嘗試。 */
  unlocks: number;
  resumes: number;
  lastPlayed: string;
}

export interface AudioEngineOptions {
  config?: AudioConfig;
  sounds?: Record<string, SoundDef>;
  /** 建立 AudioContext（測試注入假物件）；回傳 null = 不可用。預設用 window.AudioContext。 */
  createContext?: () => AudioContext | null;
  /** 播放變化的亂數種子。 */
  seed?: number;
  log?: (msg: string) => void;
}

interface SoundEntry {
  id: string;
  def: SoundDef;
  data: Float32Array[] | null;
  buffers: AudioBuffer[] | null;
  last: number;
  sampleRate: number;
}

interface Slot {
  gain: GainNode;
  panner: PannerNode | null;
  source: AudioBufferSourceNode | null;
}

interface Pool {
  name: string;
  allocator: VoiceAllocator;
  slots: Slot[];
  spatial: boolean;
}

/** 四元數 → 聽者的前方（-Z）與上方（+Y）。 */
export function listenerAxes(q: Readonly<QuatLike>, forward: Vec3Like, up: Vec3Like): void {
  const { x, y, z, w } = q;
  // 旋轉 (0, 0, -1)
  forward.x = -(2 * (x * z + w * y));
  forward.y = -(2 * (y * z - w * x));
  forward.z = -(1 - 2 * (x * x + y * y));
  // 旋轉 (0, 1, 0)
  up.x = 2 * (x * y - w * z);
  up.y = 1 - 2 * (x * x + z * z);
  up.z = 2 * (y * z + w * x);
}

function defaultCreateContext(): AudioContext | null {
  const g = globalThis as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
  const Ctor = g.AudioContext ?? g.webkitAudioContext;
  if (!Ctor) return null;
  return new Ctor({ latencyHint: 'interactive' });
}

function setParam(param: AudioParam | undefined, value: number): void {
  if (param && Number.isFinite(value) && Math.abs(param.value - value) > 1e-4) param.value = value;
}

function yieldToEventLoop(): Promise<void> {
  // MessageChannel 在背景分頁不像 setTimeout 那樣被節流
  if (typeof MessageChannel !== 'undefined') {
    return new Promise((resolve) => {
      const ch = new MessageChannel();
      ch.port1.onmessage = () => {
        ch.port1.close();
        resolve();
      };
      ch.port2.postMessage(0);
    });
  }
  return new Promise((resolve) => setTimeout(resolve, 0));
}

class LoopVoice implements LoopHandle {
  target = 0;
  rate = 1;
  pan = 0;
  readonly position = { x: 0, y: 0, z: 0 };
  source: AudioBufferSourceNode | null = null;
  gain: GainNode | null = null;
  stereo: StereoPannerNode | null = null;
  panner: PannerNode | null = null;
  scheduledGain = 0;
  scheduledRate = 1;
  zeroSince = -1;

  constructor(
    readonly id: string,
    readonly spatial: boolean,
  ) {}

  get active(): boolean {
    return this.source !== null;
  }

  set(gain: number, rate?: number): void {
    this.target = Number.isFinite(gain) ? Math.max(0, gain) : 0;
    if (rate !== undefined && Number.isFinite(rate) && rate > 0) this.rate = rate;
  }

  setPan(pan: number): void {
    this.pan = Math.max(-1, Math.min(1, pan));
  }

  setPosition(x: number, y: number, z: number): void {
    this.position.x = x;
    this.position.y = y;
    this.position.z = z;
  }

  stop(): void {
    this.target = 0;
  }

  /** 硬停（context 關閉或引擎 dispose）。 */
  kill(): void {
    try {
      this.source?.stop();
    } catch {
      // 已停止
    }
    this.source?.disconnect();
    this.source = null;
    this.scheduledGain = 0;
    this.zeroSince = -1;
  }
}

export class AudioEngine implements AudioSink {
  readonly config: AudioConfig;
  readonly sounds = new Map<string, SoundEntry>();
  readonly defs: Record<string, SoundDef>;
  readonly stats: AudioStats = {
    plays: 0,
    silent: 0,
    throttled: 0,
    stolen: 0,
    dropped: 0,
    unknown: 0,
    loopStarts: 0,
    unlocks: 0,
    resumes: 0,
    lastPlayed: '',
  };
  report: PrerenderReport | null = null;

  private ctx: AudioContext | null = null;
  private failed = false;
  private hidden = false;
  private paused = false;
  private readonly createContext: () => AudioContext | null;
  private readonly rng: Rng;
  private readonly variation: Variation = { rate: 1, gainDb: 0 };
  private readonly throttle = new Throttle();
  private readonly log: (msg: string) => void;
  private readonly volumes = { master: 0.8, sfx: 1, ui: 0.8, music: 0.7 };
  private nodes: {
    master: GainNode;
    buses: Record<AudioBusName, GainNode>;
    comp: DynamicsCompressorNode;
    limiter: DynamicsCompressorNode;
  } | null = null;
  private pools: { p2d: Pool; p3d: Pool; ui: Pool } | null = null;
  private readonly loops: LoopVoice[] = [];
  private readonly warned = new Set<string>();
  private readonly listenerFwd = { x: 0, y: 0, z: -1 };
  private readonly listenerUp = { x: 0, y: 1, z: 0 };
  private detachUnlock: (() => void) | null = null;

  constructor(options: AudioEngineOptions = {}) {
    this.config = options.config ?? AUDIO_CONFIG;
    this.defs = options.sounds ?? SOUND_DEFS;
    this.createContext = options.createContext ?? defaultCreateContext;
    this.rng = new Rng(options.seed ?? 0xa0d10);
    this.log = options.log ?? ((m) => console.info(`[shardwake] ${m}`));
    for (const [id, def] of Object.entries(this.defs)) {
      this.sounds.set(id, { id, def, data: null, buffers: null, last: -1, sampleRate: this.config.synth.sampleRate });
    }
  }

  // ── 狀態 ──────────────────────────────────────────────

  get status(): AudioStatus {
    if (this.failed) return 'unavailable';
    if (!this.ctx) return 'locked';
    return this.ctx.state === 'running' ? 'running' : 'suspended';
  }

  get running(): boolean {
    return this.ctx !== null && this.ctx.state === 'running' && !this.hidden;
  }

  get context(): AudioContext | null {
    return this.ctx;
  }

  get currentTime(): number {
    return this.ctx?.currentTime ?? 0;
  }

  /** 匯流排（M5-06 的音樂接到 bus('music')）；解鎖前為 null。 */
  bus(name: AudioBusName): GainNode | null {
    return this.nodes?.buses[name] ?? null;
  }

  /** 正在播放的發聲數（各池）。 */
  activeVoices(): { p2d: number; p3d: number; ui: number; loops: number; total: number } {
    const now = this.currentTime;
    const p = this.pools;
    const p2d = p ? p.p2d.allocator.activeCount(now) : 0;
    const p3d = p ? p.p3d.allocator.activeCount(now) : 0;
    const ui = p ? p.ui.allocator.activeCount(now) : 0;
    const loops = this.loops.filter((l) => l.active).length;
    return { p2d, p3d, ui, loops, total: p2d + p3d + ui + loops };
  }

  /** 各池的發聲槽配置器（監看與測試）。 */
  get allocators(): { p2d: VoiceAllocator; p3d: VoiceAllocator; ui: VoiceAllocator } | null {
    return this.pools ? { p2d: this.pools.p2d.allocator, p3d: this.pools.p3d.allocator, ui: this.pools.ui.allocator } : null;
  }

  get throttledCount(): number {
    return this.throttle.blocked;
  }

  // ── 預渲染 ────────────────────────────────────────────

  /**
   * 預渲染所有音效（載入時呼叫；分段讓出主執行緒）。weapons：要先渲染的武器音效（WeaponDef.audio）。
   */
  async prerender(weapons: readonly { fire: string; params: Readonly<Record<string, number>> }[] = []): Promise<PrerenderReport> {
    const t0 = performance.now();
    for (const w of weapons) this.registerWeapon(w);
    let work = 0;
    let sliceStart = performance.now();
    for (const entry of this.sounds.values()) {
      if (entry.data || entry.buffers) continue;
      const s = performance.now();
      this.renderEntry(entry);
      const e = performance.now();
      work += e - s;
      if (e - sliceStart > this.config.synth.sliceMs) {
        await yieldToEventLoop();
        sliceStart = performance.now();
      }
    }
    const report = this.measure();
    report.ms = work;
    report.wallMs = performance.now() - t0;
    this.report = report;
    this.log(
      `音效預渲染：${report.sounds} 種、${report.variants} 個變體、${report.seconds.toFixed(1)} s 音訊、` +
        `${(report.bytes / 1048576).toFixed(1)} MiB、${report.ms.toFixed(0)} ms（牆鐘 ${report.wallMs.toFixed(0)} ms）`,
    );
    if (this.ctx) this.uploadAll();
    return report;
  }

  /** 同步預渲染（測試、無頭）。 */
  prerenderSync(): PrerenderReport {
    const t0 = performance.now();
    for (const entry of this.sounds.values()) if (!entry.data && !entry.buffers) this.renderEntry(entry);
    const report = this.measure();
    report.ms = report.wallMs = performance.now() - t0;
    this.report = report;
    return report;
  }

  private measure(): PrerenderReport {
    let variants = 0;
    let samples = 0;
    for (const e of this.sounds.values()) {
      const list = e.data ?? e.buffers;
      if (!list) continue;
      variants += list.length;
      for (const v of list) samples += v.length;
    }
    const sr = this.config.synth.sampleRate;
    return { sounds: this.sounds.size, variants, seconds: samples / sr, bytes: samples * 4, ms: 0, wallMs: 0, sampleRate: sr };
  }

  private renderEntry(entry: SoundEntry): void {
    const sr = this.config.synth.sampleRate;
    entry.data = renderVariants(entry.id, entry.def, sr, this.config.synth.loopCrossfade);
    entry.sampleRate = sr;
    entry.buffers = null;
    entry.last = -1;
    if (this.ctx) this.upload(entry);
  }

  /** 註冊（或取代）一種音效並立即渲染（M3 的敵人、M2 的元素音效）。 */
  register(id: string, def: SoundDef): void {
    const entry: SoundEntry = { id, def, data: null, buffers: null, last: -1, sampleRate: this.config.synth.sampleRate };
    this.sounds.set(id, entry);
    this.renderEntry(entry);
  }

  /** 重新渲染（調參面板改了配方後）；weapon 開火的基礎配方改了用 rebuildWeaponFire。 */
  rebuild(id: string): boolean {
    const entry = this.sounds.get(id);
    if (!entry) return false;
    this.renderEntry(entry);
    return true;
  }

  /** 武器開火的基礎配方改了：重新渲染所有使用這個配方的參數組合。 */
  rebuildWeaponFire(fire: string): number {
    let n = 0;
    for (const entry of this.sounds.values()) {
      if (entry.id === `fire.${fire}` || entry.id.startsWith(`fire.${fire}|`)) {
        const params = parseWeaponKey(entry.id);
        entry.def = { ...entry.def, recipe: weaponFireDef(fire, params).recipe };
        this.renderEntry(entry);
        n++;
      }
    }
    return n;
  }

  /** 全部重新渲染（改了取樣率）。 */
  rebuildAll(): PrerenderReport {
    for (const entry of this.sounds.values()) {
      entry.data = null;
      entry.buffers = null;
    }
    return this.prerenderSync();
  }

  private registerWeapon(audio: { fire: string; params: Readonly<Record<string, number>> }): string {
    const fire = audio.fire in WEAPON_FIRE_RECIPES ? audio.fire : 'rifle';
    const key = weaponSoundKey(fire, audio.params);
    if (!this.sounds.has(key)) {
      this.sounds.set(key, { id: key, def: weaponFireDef(fire, audio.params), data: null, buffers: null, last: -1, sampleRate: this.config.synth.sampleRate });
    }
    return key;
  }

  weaponSound(audio: { fire: string; params: Readonly<Record<string, number>> }): string {
    const key = this.registerWeapon(audio);
    const entry = this.sounds.get(key)!;
    if (!entry.data && !entry.buffers) this.renderEntry(entry);
    return key;
  }

  // ── 解鎖與生命週期 ─────────────────────────────────────

  /** 在 target（預設 window）上監聽玩家操作：第一次建立 AudioContext，之後必要時 resume。 */
  attachUnlock(target: Pick<EventTarget, 'addEventListener' | 'removeEventListener'> = window): () => void {
    this.detachUnlock?.();
    const handler = (): void => this.unlock();
    const types = ['pointerdown', 'keydown', 'touchend', 'click'];
    for (const t of types) target.addEventListener(t, handler, { capture: true, passive: true });
    this.detachUnlock = () => {
      for (const t of types) target.removeEventListener(t, handler, { capture: true });
      this.detachUnlock = null;
    };
    return this.detachUnlock;
  }

  /** 由玩家操作觸發：建立或恢復 AudioContext。永遠不丟例外。 */
  unlock(): void {
    if (this.failed || this.hidden) return;
    if (!this.ctx) {
      let ctx: AudioContext | null = null;
      try {
        ctx = this.createContext();
      } catch (error) {
        this.warnOnce('create', `無法建立 AudioContext，改為靜音：${String(error)}`);
      }
      if (!ctx) {
        this.failed = true;
        this.warnOnce('unavailable', 'Web Audio 不可用，遊戲以靜音進行');
        return;
      }
      this.ctx = ctx;
      this.stats.unlocks++;
      try {
        this.buildGraph(ctx);
        this.uploadAll();
      } catch (error) {
        this.failed = true;
        this.warnOnce('graph', `建立音訊圖失敗，改為靜音：${String(error)}`);
        void this.closeQuietly();
        return;
      }
      this.log(`AudioContext 已建立：${ctx.sampleRate} Hz、state=${ctx.state}`);
    }
    if (this.ctx.state !== 'running') this.resume();
  }

  private resume(): void {
    const ctx = this.ctx;
    if (!ctx || this.hidden || ctx.state === 'closed') return;
    this.stats.resumes++;
    try {
      const p = ctx.resume();
      if (p && typeof p.catch === 'function') p.catch(() => this.warnOnce('resume', 'AudioContext 無法恢復（等待下一次操作）'));
    } catch {
      this.warnOnce('resume', 'AudioContext 無法恢復（等待下一次操作）');
    }
  }

  private async closeQuietly(): Promise<void> {
    try {
      await this.ctx?.close();
    } catch {
      // 忽略
    }
    this.ctx = null;
  }

  /** 分頁隱藏：suspend；回來：resume（瀏覽器不允許時等下一次玩家操作）。 */
  setHidden(hidden: boolean): void {
    this.hidden = hidden;
    const ctx = this.ctx;
    if (!ctx || ctx.state === 'closed') return;
    if (hidden) {
      for (const l of this.loops) l.kill();
      try {
        const p = ctx.suspend();
        if (p && typeof p.catch === 'function') p.catch(() => {});
      } catch {
        // 忽略
      }
    } else this.resume();
  }

  /** 遊戲暫停：音效匯流排壓低（介面不受影響）。循環音由呼叫端歸零。 */
  setPaused(paused: boolean): void {
    if (this.paused === paused) return;
    this.paused = paused;
    this.applyMix();
  }

  /** 玩家音量（0..1；設定 masterVolume／sfxVolume／uiVolume／musicVolume）。 */
  setVolumes(v: Partial<{ master: number; sfx: number; ui: number; music: number }>): void {
    for (const k of ['master', 'sfx', 'ui', 'music'] as const) {
      const x = v[k];
      if (typeof x === 'number' && Number.isFinite(x)) this.volumes[k] = Math.min(1, Math.max(0, x));
    }
    this.applyMix();
  }

  /** 套用混音與動態（調參面板改了 AUDIO_CONFIG.mix／dynamics 後呼叫）。 */
  applyMix(): void {
    const n = this.nodes;
    const ctx = this.ctx;
    if (!n || !ctx) return;
    const m = this.config.mix;
    const now = ctx.currentTime;
    const tau = Math.max(0.001, m.busSmoothing);
    const set = (g: GainNode, value: number): void => {
      g.gain.cancelScheduledValues(now);
      g.gain.setTargetAtTime(value, now, tau);
    };
    set(n.master, busGain(this.volumes.master, m.masterDb, m.volumeCurve));
    set(n.buses.sfx, busGain(this.volumes.sfx, m.sfxDb, m.volumeCurve) * (this.paused ? dbToGain(m.pausedSfxDb) : 1));
    set(n.buses.ui, busGain(this.volumes.ui, m.uiDb, m.volumeCurve));
    set(n.buses.music, busGain(this.volumes.music, m.musicDb, m.volumeCurve));
    const d = this.config.dynamics;
    setParam(n.comp.threshold, d.compThreshold);
    setParam(n.comp.knee, d.compKnee);
    setParam(n.comp.ratio, d.compRatio);
    setParam(n.comp.attack, d.compAttack);
    setParam(n.comp.release, d.compRelease);
    setParam(n.limiter.threshold, d.limiterThreshold);
    setParam(n.limiter.knee, 0);
    setParam(n.limiter.ratio, d.limiterRatio);
    setParam(n.limiter.attack, d.limiterAttack);
    setParam(n.limiter.release, d.limiterRelease);
  }

  /** 套用空間參數到所有 Panner（面板改了 AUDIO_CONFIG.spatial 後呼叫）。 */
  applySpatial(): void {
    if (!this.pools) return;
    for (const s of this.pools.p3d.slots) if (s.panner) this.configurePanner(s.panner);
    for (const l of this.loops) if (l.panner) this.configurePanner(l.panner);
  }

  private buildGraph(ctx: AudioContext): void {
    const limiter = ctx.createDynamicsCompressor();
    limiter.connect(ctx.destination);
    const comp = ctx.createDynamicsCompressor();
    comp.connect(limiter);
    const master = ctx.createGain();
    master.connect(comp);
    const mk = (): GainNode => {
      const g = ctx.createGain();
      g.connect(master);
      return g;
    };
    const buses = { sfx: mk(), ui: mk(), music: mk() };
    this.nodes = { master, buses, comp, limiter };
    const v = this.config.voices;
    const pool = (name: string, size: number, bus: GainNode, spatial: boolean): Pool => {
      const slots: Slot[] = [];
      for (let i = 0; i < size; i++) {
        const gain = ctx.createGain();
        let panner: PannerNode | null = null;
        if (spatial) {
          panner = ctx.createPanner();
          this.configurePanner(panner);
          gain.connect(panner);
          panner.connect(bus);
        } else gain.connect(bus);
        slots.push({ gain, panner, source: null });
      }
      return { name, allocator: new VoiceAllocator(size), slots, spatial };
    };
    this.pools = {
      p2d: pool('2d', Math.max(1, Math.round(v.pool2d)), buses.sfx, false),
      p3d: pool('3d', Math.max(1, Math.round(v.pool3d)), buses.sfx, true),
      ui: pool('ui', Math.max(1, Math.round(v.poolUi)), buses.ui, false),
    };
    this.applyMix();
  }

  private configurePanner(p: PannerNode): void {
    const s = this.config.spatial;
    p.panningModel = s.panningModel;
    p.distanceModel = s.distanceModel;
    p.refDistance = s.refDistance;
    p.maxDistance = s.maxDistance;
    p.rolloffFactor = s.rolloff;
  }

  private upload(entry: SoundEntry): void {
    const ctx = this.ctx;
    if (!ctx || !entry.data) return;
    entry.buffers = entry.data.map((d) => {
      const buf = ctx.createBuffer(1, d.length, entry.sampleRate);
      buf.copyToChannel(d as Float32Array<ArrayBuffer>, 0);
      return buf;
    });
    // 轉成 AudioBuffer 後釋放樣本（記憶體只留一份）
    entry.data = null;
  }

  private uploadAll(): void {
    for (const e of this.sounds.values()) this.upload(e);
  }

  // ── 播放 ──────────────────────────────────────────────

  /** 播放單次音效；被丟棄（未解鎖、節流、發聲數已滿、未知 id）時回傳 false。 */
  play(id: string, opts?: PlayOptions): boolean {
    const ctx = this.ctx;
    const pools = this.pools;
    if (!ctx || !pools || !this.running) {
      this.stats.silent++;
      return false;
    }
    const entry = this.sounds.get(id);
    if (entry && !entry.buffers && entry.data) this.upload(entry);
    if (!entry || !entry.buffers || entry.buffers.length === 0) {
      this.stats.unknown++;
      this.warnOnce(`unknown:${id}`, `未知的音效「${id}」`);
      return false;
    }
    const def = entry.def;
    const now = ctx.currentTime;
    if (!this.throttle.allow(id, now, def.minInterval)) {
      this.stats.throttled++;
      return false;
    }
    const pb = this.config.playback;
    const vari = opts?.noVariation ? { rate: 1, gainDb: 0 } : randomVariation(this.rng, pb.pitchVariation, pb.volumeVariationDb, this.variation);
    const rate = Math.max(0.05, vari.rate * (opts?.rate ?? 1));
    const buffers = entry.buffers;
    const vi = pickVariant(this.rng, buffers.length, entry.last);
    entry.last = vi;
    const buffer = buffers[vi]!;
    const pool = def.bus === 'ui' ? pools.ui : opts?.position ? pools.p3d : pools.p2d;
    const alloc = pool.allocator.allocate(
      {
        soundId: id,
        category: def.category,
        priority: def.priority,
        duration: buffer.duration / rate + (opts?.delay ?? 0),
        maxInstances: def.maxInstances,
        categoryMax: this.config.voices.categories[def.category] ?? 0,
      },
      now,
    );
    if (!alloc) {
      this.stats.dropped++;
      return false;
    }
    const slot = pool.slots[alloc.slot.index]!;
    const g = slot.gain.gain;
    let start = now + Math.max(0, opts?.delay ?? 0);
    g.cancelScheduledValues(now);
    if (alloc.stolen && slot.source) {
      // 先把舊聲音淡出再開始新的（避免爆音）
      const fade = Math.max(0.001, pb.stealFade);
      g.setValueAtTime(g.value, now);
      g.linearRampToValueAtTime(0, now + fade);
      try {
        slot.source.stop(now + fade);
      } catch {
        // 已停止
      }
      start = Math.max(start, now + fade);
      this.stats.stolen++;
    }
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = rate;
    src.connect(slot.gain);
    g.setValueAtTime(dbToGain(def.gainDb + vari.gainDb + (opts?.gainDb ?? 0)), start);
    if (slot.panner && opts?.position) this.setPannerPosition(slot.panner, opts.position.x, opts.position.y, opts.position.z);
    src.start(start);
    slot.source = src;
    this.stats.plays++;
    this.stats.lastPlayed = id;
    return true;
  }

  /** 循環音（噴射、滑鏟、跑牆、收線、風聲、電漿飛行）：回傳常駐的控制物件，以 set(gain) 開關。 */
  loop(id: string, opts: { spatial?: boolean } = {}): LoopHandle {
    const spatial = opts.spatial ?? this.defs[id]?.spatial ?? false;
    const voice = new LoopVoice(id, spatial);
    this.loops.push(voice);
    return voice;
  }

  /** 世界中的移動音源（電漿球）：= loop(id, { spatial: true })。 */
  createEmitter(id: string): LoopHandle {
    return this.loop(id, { spatial: true });
  }

  /** 每畫面：循環音的淡入淡出、速率、位置與閒置停止。 */
  update(): void {
    const ctx = this.ctx;
    if (!ctx || !this.nodes || !this.running) return;
    const now = ctx.currentTime;
    const pb = this.config.playback;
    for (const l of this.loops) this.updateLoop(l, ctx, now, pb);
  }

  private updateLoop(l: LoopVoice, ctx: AudioContext, now: number, pb: AudioConfig['playback']): void {
    const eps = pb.loopGainEpsilon;
    if (!l.source) {
      if (l.target <= eps) return;
      const entry = this.sounds.get(l.id);
      if (entry && !entry.buffers && entry.data) this.upload(entry);
      const buffers = entry?.buffers;
      if (!entry || !buffers || buffers.length === 0) {
        this.warnOnce(`unknown:${l.id}`, `未知的循環音「${l.id}」`);
        l.target = 0;
        return;
      }
      if (!l.gain) {
        l.gain = ctx.createGain();
        l.gain.gain.value = 0;
        const bus = this.nodes!.buses[entry.def.bus];
        if (l.spatial) {
          l.panner = ctx.createPanner();
          this.configurePanner(l.panner);
          l.gain.connect(l.panner);
          l.panner.connect(bus);
        } else if (typeof ctx.createStereoPanner === 'function') {
          l.stereo = ctx.createStereoPanner();
          l.gain.connect(l.stereo);
          l.stereo.connect(bus);
        } else l.gain.connect(bus);
      }
      const vi = pickVariant(this.rng, buffers.length, entry.last);
      entry.last = vi;
      const buf = buffers[vi]!;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.playbackRate.value = l.rate;
      src.connect(l.gain);
      l.gain.gain.cancelScheduledValues(now);
      l.gain.gain.setValueAtTime(0, now);
      l.scheduledGain = 0;
      l.scheduledRate = l.rate;
      // 從隨機位置開始，同一循環音每次聽起來不一樣
      src.start(now, this.rng.float() * buf.duration);
      l.source = src;
      l.zeroSince = -1;
      this.stats.loopStarts++;
    }
    const def = this.sounds.get(l.id)?.def;
    const target = l.target > eps ? l.target * dbToGain(def?.gainDb ?? 0) : 0;
    if (Math.abs(target - l.scheduledGain) > eps * Math.max(0.05, target) || (target === 0 && l.scheduledGain !== 0)) {
      const tau = target > l.scheduledGain ? pb.loopFadeIn : pb.loopFadeOut;
      l.gain!.gain.cancelScheduledValues(now);
      l.gain!.gain.setTargetAtTime(target, now, Math.max(0.001, tau));
      l.scheduledGain = target;
    }
    if (Math.abs(l.rate - l.scheduledRate) > 0.005) {
      l.source.playbackRate.cancelScheduledValues(now);
      l.source.playbackRate.setTargetAtTime(l.rate, now, 0.05);
      l.scheduledRate = l.rate;
    }
    if (l.stereo) setParam(l.stereo.pan, l.pan);
    if (l.panner) this.setPannerPosition(l.panner, l.position.x, l.position.y, l.position.z);
    if (target === 0) {
      if (l.zeroSince < 0) l.zeroSince = now;
      else if (now - l.zeroSince > pb.loopIdleStop) l.kill();
    } else l.zeroSince = -1;
  }

  /** 循環音控制物件（監看）。 */
  get loopHandles(): readonly LoopHandle[] {
    return this.loops;
  }

  /** 把所有循環音的目標設為 0（暫停、死亡）。 */
  silenceLoops(): void {
    for (const l of this.loops) l.target = 0;
  }

  // ── 空間 ──────────────────────────────────────────────

  /** 聽者跟隨相機：位置與朝向（四元數）。每畫面在 camera 之後呼叫。 */
  setListener(position: Readonly<Vec3Like>, quaternion: Readonly<QuatLike>): void {
    const ctx = this.ctx;
    if (!ctx || !this.running) return;
    const L = ctx.listener;
    const f = this.listenerFwd;
    const u = this.listenerUp;
    listenerAxes(quaternion, f, u);
    if (L.positionX) {
      setParam(L.positionX, position.x);
      setParam(L.positionY, position.y);
      setParam(L.positionZ, position.z);
      setParam(L.forwardX, f.x);
      setParam(L.forwardY, f.y);
      setParam(L.forwardZ, f.z);
      setParam(L.upX, u.x);
      setParam(L.upY, u.y);
      setParam(L.upZ, u.z);
    } else {
      const legacy = L as unknown as {
        setPosition?(x: number, y: number, z: number): void;
        setOrientation?(x: number, y: number, z: number, ux: number, uy: number, uz: number): void;
      };
      legacy.setPosition?.(position.x, position.y, position.z);
      legacy.setOrientation?.(f.x, f.y, f.z, u.x, u.y, u.z);
    }
  }

  private setPannerPosition(p: PannerNode, x: number, y: number, z: number): void {
    if (p.positionX) {
      setParam(p.positionX, x);
      setParam(p.positionY, y);
      setParam(p.positionZ, z);
    } else (p as unknown as { setPosition?(x: number, y: number, z: number): void }).setPosition?.(x, y, z);
  }

  // ── 其他 ──────────────────────────────────────────────

  /** 某音效的變體（AudioBuffer 或樣本；分析與離線測試用）。 */
  variants(id: string): readonly (AudioBuffer | Float32Array)[] {
    const e = this.sounds.get(id);
    return e?.buffers ?? e?.data ?? [];
  }

  private warnOnce(key: string, message: string): void {
    if (this.warned.has(key)) return;
    this.warned.add(key);
    console.warn(`[shardwake] ${message}`);
  }

  dispose(): void {
    this.detachUnlock?.();
    for (const l of this.loops) l.kill();
    this.loops.length = 0;
    void this.closeQuietly();
    this.nodes = null;
    this.pools = null;
  }
}

/** 從武器音效 key（fire.rifle|pitch=1|body=0.6）解析參數。 */
export function parseWeaponKey(key: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const part of key.split('|').slice(1)) {
    const [k, v] = part.split('=');
    const x = Number(v);
    if (k && Number.isFinite(x)) out[k] = x;
  }
  return out;
}
