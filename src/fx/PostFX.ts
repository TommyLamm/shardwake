// 後處理管線（M1-09，pmndrs postprocessing）：
//   RenderPass（主場景）
//   → [viewmodel 插入點：M1-11 用 addViewmodelPass() 在這裡加「清深度 + 第二個 RenderPass」]
//   → 主合成 EffectPass：色差 → Bloom（mipmap blur、亮度閾值約 0.8，只抓發光處）→ AgX 色調映射 → 暗角
//   → SMAA EffectPass（在色調映射之後的 LDR 畫面上偵測邊緣）
// - 內部 buffer 用 HalfFloat（HDR，發光材質強度 > 1 才有意義）；顯示卡不支援時退回 8 位元。
// - renderer 本身不做色調映射（NoToneMapping），AgX 由 ToneMappingEffect 執行；曝光沿用 renderer.toneMappingExposure。
// - 色差預設 0，Dash、受擊時以 pulseAberration() 脈衝（PulseEnvelope，純邏輯可測試）。色差在主合成 pass 內，
//   偏移為 0 時著色器跳過額外取樣，不需要切換 pass（切換會讓著色器重新編譯）。
// - 畫質：Bloom、SMAA 的開關改變時重建效果 pass（只在切換畫質時發生，會重新編譯後處理著色器）。
// - renderer.info 的 draw call 統計改為每畫面手動重設（autoReset = false），才會包含所有 pass。
import * as THREE from 'three';
import {
  BlendFunction,
  BloomEffect,
  ChromaticAberrationEffect,
  ClearPass,
  EffectComposer,
  EffectPass,
  type Pass,
  RenderPass,
  SMAAEffect,
  SMAAPreset,
  ToneMappingEffect,
  ToneMappingMode,
  VignetteEffect,
} from 'postprocessing';
import { SystemOrder, type FrameInfo, type GameSystem } from '@/core/Game';
import type { QualityPreset, SmaaQuality } from '@/core/quality';

export interface PostFxConfig {
  /** 曝光（renderer.toneMappingExposure）。 */
  exposure: number;
  bloomIntensity: number;
  /** 亮度閾值（線性 HDR 亮度）：一般受光表面低於此值，只有發光處會泛光。 */
  bloomThreshold: number;
  bloomSmoothing: number;
  bloomRadius: number;
  /** mipmap blur 層數（變更後下次重建 pass 生效）。 */
  bloomLevels: number;
  vignetteOffset: number;
  vignetteDarkness: number;
  /** 色差最大偏移（畫面寬度比例）與中心不受影響的半徑（radial modulation）。 */
  aberrationMax: number;
  aberrationCenter: number;
  /** Dash 觸發的色差脈衝（0–1）與時長（s）。 */
  dashAberration: number;
  dashAberrationTime: number;
}

export const POSTFX_CONFIG: PostFxConfig = {
  exposure: 1,
  bloomIntensity: 1.1,
  bloomThreshold: 0.8,
  bloomSmoothing: 0.12,
  bloomRadius: 0.7,
  bloomLevels: 7,
  vignetteOffset: 0.32,
  vignetteDarkness: 0.55,
  aberrationMax: 0.006,
  aberrationCenter: 0.18,
  dashAberration: 0.55,
  dashAberrationTime: 0.28,
};

/**
 * 色差脈衝包絡：最多 capacity 個同時存在的脈衝，值 = max(強度 × (1 − 經過時間 / 時長)²)，0..1。
 * 固定容量、不配置記憶體；滿了時取代剩餘值最小的脈衝。
 */
export class PulseEnvelope {
  private readonly strength: Float32Array;
  private readonly duration: Float32Array;
  private readonly age: Float32Array;

  constructor(readonly capacity = 4) {
    this.strength = new Float32Array(capacity);
    this.duration = new Float32Array(capacity);
    this.age = new Float32Array(capacity);
  }

  private valueAt(i: number): number {
    const d = this.duration[i]!;
    if (d <= 0) return 0;
    const t = 1 - this.age[i]! / d;
    return t <= 0 ? 0 : this.strength[i]! * t * t;
  }

  /** 加入脈衝（強度夾在 0..1，時長 > 0）。 */
  add(strength: number, duration: number): void {
    const s = Math.min(1, Math.max(0, strength));
    if (s <= 0 || !(duration > 0)) return;
    let slot = 0;
    let lowest = Infinity;
    for (let i = 0; i < this.capacity; i++) {
      const v = this.valueAt(i);
      if (v < lowest) {
        lowest = v;
        slot = i;
      }
    }
    this.strength[slot] = s;
    this.duration[slot] = duration;
    this.age[slot] = 0;
  }

  advance(dt: number): void {
    if (!(dt > 0)) return;
    for (let i = 0; i < this.capacity; i++) {
      if (this.duration[i]! <= 0) continue;
      this.age[i] = this.age[i]! + dt;
      if (this.age[i]! >= this.duration[i]!) this.duration[i] = 0;
    }
  }

  get value(): number {
    let v = 0;
    for (let i = 0; i < this.capacity; i++) v = Math.max(v, this.valueAt(i));
    return v;
  }

  clear(): void {
    this.duration.fill(0);
  }
}

const SMAA_PRESETS: Record<SmaaQuality, SMAAPreset> = {
  low: SMAAPreset.LOW,
  medium: SMAAPreset.MEDIUM,
  high: SMAAPreset.HIGH,
  ultra: SMAAPreset.ULTRA,
};

/** 依畫質列出效果 pass 的組成（純函式，給測試與除錯顯示）。 */
export function describePasses(q: Pick<QualityPreset, 'bloom' | 'smaa'>): string[] {
  const main = ['chromaticAberration', ...(q.bloom ? ['bloom'] : []), 'toneMapping', 'vignette'];
  return ['render', 'viewmodel*', `effects(${main.join('+')})`, ...(q.smaa ? ['smaa'] : [])];
}

export interface ViewmodelPassHandle {
  readonly clear: ClearPass;
  readonly pass: RenderPass;
  /** 從管線移除並釋放。 */
  dispose(): void;
}

export interface PostFxOptions {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.Camera;
  quality: QualityPreset;
  config?: PostFxConfig;
}

export class PostFX implements GameSystem {
  readonly name = 'render';
  readonly order = SystemOrder.render;
  readonly config: PostFxConfig;
  readonly composer: EffectComposer;
  readonly renderPass: RenderPass;
  readonly aberration = new PulseEnvelope();
  /** 實際使用的 buffer 類型（HalfFloat 或退回 8 位元）。 */
  readonly frameBufferType: THREE.TextureDataType;
  /** 設定「畫面色差」。 */
  aberrationEnabled = true;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly camera: THREE.Camera;
  private readonly viewmodelPasses: Pass[] = [];
  private effectPasses: EffectPass[] = [];
  private bloom: BloomEffect | null = null;
  private ca!: ChromaticAberrationEffect;
  private toneMapping!: ToneMappingEffect;
  private vignette!: VignetteEffect;
  private quality: QualityPreset;
  private readonly caOffset = new THREE.Vector2();
  /** 重建效果 pass 的次數（除錯用）。 */
  rebuildCount = 0;

  constructor(options: PostFxOptions) {
    this.renderer = options.renderer;
    this.camera = options.camera;
    this.config = options.config ?? POSTFX_CONFIG;
    this.quality = { ...options.quality };
    const r = this.renderer;
    r.toneMapping = THREE.NoToneMapping;
    r.info.autoReset = false;
    const halfFloatOk = r.extensions.has('EXT_color_buffer_half_float') || r.extensions.has('EXT_color_buffer_float');
    this.frameBufferType = halfFloatOk ? THREE.HalfFloatType : THREE.UnsignedByteType;
    this.composer = new EffectComposer(r, { frameBufferType: this.frameBufferType, multisampling: 0, stencilBuffer: false });
    this.renderPass = new RenderPass(options.scene, options.camera);
    this.composer.addPass(this.renderPass);
    this.buildEffectPasses();
  }

  /** 場景畫進的 buffer（預熱時以它為 render target，讓著色器參數與實際渲染相同）。 */
  get inputBuffer(): THREE.WebGLRenderTarget {
    return this.composer.inputBuffer;
  }

  /** 目前管線的 pass 名稱（除錯用）。 */
  get passNames(): string[] {
    return this.composer.passes.map((p) => p.name);
  }

  private buildEffectPasses(): void {
    for (const p of this.effectPasses) {
      this.composer.removePass(p);
      p.dispose();
    }
    this.effectPasses = [];
    const cfg = this.config;
    const q = this.quality;
    this.ca = new ChromaticAberrationEffect({
      offset: this.caOffset,
      radialModulation: true,
      modulationOffset: cfg.aberrationCenter,
    });
    this.bloom = q.bloom
      ? new BloomEffect({
          blendFunction: BlendFunction.ADD,
          mipmapBlur: true,
          luminanceThreshold: cfg.bloomThreshold,
          luminanceSmoothing: cfg.bloomSmoothing,
          intensity: cfg.bloomIntensity,
          radius: cfg.bloomRadius,
          levels: Math.max(1, Math.round(cfg.bloomLevels)),
        })
      : null;
    this.toneMapping = new ToneMappingEffect({ mode: ToneMappingMode.AGX });
    this.vignette = new VignetteEffect({ offset: cfg.vignetteOffset, darkness: cfg.vignetteDarkness });
    const effects = [this.ca, ...(this.bloom ? [this.bloom] : []), this.toneMapping, this.vignette];
    const main = new EffectPass(this.camera, ...effects);
    main.name = 'effects';
    this.effectPasses.push(main);
    if (q.smaa) {
      const smaa = new EffectPass(this.camera, new SMAAEffect({ preset: SMAA_PRESETS[q.smaaQuality] }));
      smaa.name = 'smaa';
      this.effectPasses.push(smaa);
    }
    for (const p of this.effectPasses) this.composer.addPass(p);
    this.rebuildCount++;
    this.applyConfig();
  }

  /** 套用畫質；Bloom／SMAA 改變時重建效果 pass。回傳是否重建。 */
  applyQuality(q: QualityPreset): boolean {
    const changed = q.bloom !== this.quality.bloom || q.smaa !== this.quality.smaa || q.smaaQuality !== this.quality.smaaQuality;
    this.quality = { ...q };
    if (changed) this.buildEffectPasses();
    return changed;
  }

  /** 把設定寫入效果（調參面板 onChange；bloomLevels 需要 rebuild()）。 */
  applyConfig(): void {
    const cfg = this.config;
    this.renderer.toneMappingExposure = cfg.exposure;
    if (this.bloom) {
      this.bloom.intensity = cfg.bloomIntensity;
      this.bloom.luminanceMaterial.threshold = cfg.bloomThreshold;
      this.bloom.luminanceMaterial.smoothing = cfg.bloomSmoothing;
      this.bloom.mipmapBlurPass.radius = cfg.bloomRadius;
    }
    this.vignette.offset = cfg.vignetteOffset;
    this.vignette.darkness = cfg.vignetteDarkness;
    this.ca.modulationOffset = cfg.aberrationCenter;
  }

  /** 重建效果 pass（例如改了 bloomLevels）。 */
  rebuild(): void {
    this.buildEffectPasses();
  }

  /**
   * M1-11 的 viewmodel 插入點：在主場景之後、效果之前加「清除深度 + RenderPass(scene, camera)」。
   * viewmodel 不會被世界遮住，仍然經過 Bloom、色調映射、SMAA。可加多個（依加入順序畫）。
   */
  addViewmodelPass(scene: THREE.Scene, camera: THREE.Camera): ViewmodelPassHandle {
    const clear = new ClearPass(false, true, false);
    clear.name = 'viewmodel:clearDepth';
    const pass = new RenderPass(scene, camera);
    pass.name = 'viewmodel';
    pass.clear = false;
    pass.ignoreBackground = true;
    pass.skipShadowMapUpdate = true;
    const index = 1 + this.viewmodelPasses.length;
    this.composer.addPass(clear, index);
    this.composer.addPass(pass, index + 1);
    this.viewmodelPasses.push(clear, pass);
    return {
      clear,
      pass,
      dispose: () => {
        for (const p of [clear, pass]) {
          const i = this.viewmodelPasses.indexOf(p);
          if (i >= 0) this.viewmodelPasses.splice(i, 1);
          this.composer.removePass(p);
          p.dispose();
        }
      },
    };
  }

  /** 色差脈衝（Dash、受擊；M1-12 受擊時呼叫）。strength 0..1（乘 aberrationMax），duration 秒。設定關閉時忽略。 */
  pulseAberration(strength: number, duration: number): void {
    if (!this.aberrationEnabled) return;
    this.aberration.add(strength, duration);
  }

  setSize(width: number, height: number): void {
    this.composer.setSize(width, height, false);
  }

  /** 推進色差包絡（模擬 dt）並畫一個畫面。 */
  draw(dt: number): void {
    this.aberration.advance(dt);
    const a = this.aberrationEnabled ? this.aberration.value * this.config.aberrationMax : 0;
    this.caOffset.set(a, a);
    this.ca.offset = this.caOffset;
    this.renderer.info.reset();
    this.composer.render(dt);
  }

  render(_alpha: number, frame: Readonly<FrameInfo>): void {
    this.draw(frame.dt);
  }

  dispose(): void {
    this.composer.dispose();
  }
}
