// 調參面板「視覺」資料夾（M1-09）：畫質預設、後處理、燈光、環境反射、天空與霧、全息看板、材質、圖樣、監看與測試按鈕。
// 玩家可選的畫質等級與「畫面色差」在「設定」資料夾（存檔）；這裡的數值是開發調校用（不存檔）。
import * as THREE from 'three';
import { SystemOrder, type GameSystem } from '@/core/Game';
import { QUALITY_LEVELS, QUALITY_PRESETS, type QualityPreset } from '@/core/quality';
import type { ConfigSchema, DebugPanel } from '@/debug/DebugPanel';
import { describePasses, type PostFX, type PostFxConfig } from '@/fx/PostFX';
import type { WarmupReport } from '@/fx/Warmup';
import type { HoloConfig } from '@/world/HoloBoards';
import type { LightingConfig, SceneLighting } from '@/world/Lighting';
import { PATTERNS, type LevelMaterialDef } from '@/world/MaterialDefs';
import type { EnvironmentConfig, MaterialLibrary } from '@/world/Materials';
import type { Sky, SkyConfig } from '@/world/Sky';
import type { PanelPattern } from '@/world/Textures';

const LEVEL_LABELS = { low: '低', medium: '中', high: '高' } as const;

export const QUALITY_PANEL: ConfigSchema<QualityPreset> = {
  renderScale: { label: '渲染比例', min: 0.5, max: 1, step: 0.01, description: '乘在像素比上' },
  shadows: { label: '陰影' },
  shadowMapSize: { label: '陰影貼圖', options: { '512': 512, '1024': 1024, '2048': 2048, '4096': 4096 } },
  bloom: { label: 'Bloom' },
  smaa: { label: 'SMAA' },
  smaaQuality: { label: 'SMAA 品質', options: { 低: 'low', 中: 'medium', 高: 'high', 極高: 'ultra' } },
};

export const POSTFX_PANEL: ConfigSchema<PostFxConfig> = {
  exposure: { label: '曝光', min: 0.1, max: 4, step: 0.01 },
  bloomIntensity: { label: 'Bloom 強度', min: 0, max: 5, step: 0.01 },
  bloomThreshold: { label: 'Bloom 閾值', min: 0, max: 3, step: 0.01, description: '線性亮度；一般受光表面要低於此值' },
  bloomSmoothing: { label: 'Bloom 平滑', min: 0, max: 1, step: 0.01 },
  bloomRadius: { label: 'Bloom 半徑', min: 0, max: 1, step: 0.01 },
  bloomLevels: { label: 'Bloom 層數', min: 1, max: 10, step: 1, description: '改變時重建效果 pass' },
  vignetteOffset: { label: '暗角範圍', min: 0, max: 1, step: 0.01 },
  vignetteDarkness: { label: '暗角強度', min: 0, max: 1, step: 0.01 },
  aberrationMax: { label: '色差最大偏移', min: 0, max: 0.03, step: 0.0005 },
  aberrationCenter: { label: '色差中心半徑', min: 0, max: 1, step: 0.01 },
  dashAberration: { label: 'Dash 色差', min: 0, max: 1, step: 0.01 },
  dashAberrationTime: { label: 'Dash 色差時長 s', min: 0.01, max: 2, step: 0.01 },
};

export const LIGHTING_PANEL: ConfigSchema<LightingConfig> = {
  hemiSky: { label: '半球光・天', params: { view: 'color' } },
  hemiGround: { label: '半球光・地', params: { view: 'color' } },
  hemiIntensity: { label: '半球光強度', min: 0, max: 5, step: 0.05 },
  sunColor: { label: '方向光顏色', params: { view: 'color' } },
  sunIntensity: { label: '方向光強度', min: 0, max: 8, step: 0.05 },
  sunAzimuth: { label: '方位°', min: 0, max: 360, step: 1 },
  sunElevation: { label: '仰角°', min: 5, max: 90, step: 1 },
  shadowExtent: { label: '陰影範圍 ±m', min: 10, max: 120, step: 1 },
  shadowDistance: { label: '光源距離 m', min: 20, max: 300, step: 5 },
  shadowAhead: { label: '陰影前移 m', min: 0, max: 60, step: 1 },
  shadowBias: { label: '陰影 bias', min: -0.005, max: 0.005, step: 0.0001 },
  shadowNormalBias: { label: '陰影 normalBias', min: 0, max: 0.2, step: 0.005 },
};

export const SKY_PANEL: ConfigSchema<SkyConfig> = {
  zenith: { label: '天頂', params: { view: 'color' } },
  horizon: { label: '地平線', params: { view: 'color' } },
  ground: { label: '地平線下', params: { view: 'color' } },
  gradientPower: { label: '漸層指數', min: 0.1, max: 3, step: 0.01 },
  bandColor: { label: '霧光帶顏色', params: { view: 'color' } },
  bandStrength: { label: '霧光帶強度', min: 0, max: 2, step: 0.01 },
  bandSharpness: { label: '霧光帶銳利度', min: 1, max: 60, step: 0.5 },
  starBrightness: { label: '星點亮度', min: 0, max: 5, step: 0.05 },
  starSize: { label: '星點大小 px', min: 0.5, max: 8, step: 0.1 },
  starTwinkle: { label: '星點閃爍', min: 0, max: 1, step: 0.01 },
  fogColor: { label: '霧顏色', params: { view: 'color' } },
  fogDensity: { label: '霧密度', min: 0, max: 0.02, step: 0.0001, description: '指數霧（FogExp2）' },
  structureColor: { label: '巨構顏色', params: { view: 'color' } },
  structureHazeLow: { label: '巨構霧化・低處', min: 0, max: 1, step: 0.01 },
  structureHazeHigh: { label: '巨構霧化・高處', min: 0, max: 1, step: 0.01 },
  windowIntensity: { label: '窗格強度', min: 0, max: 10, step: 0.05 },
};

export const HOLO_PANEL: ConfigSchema<HoloConfig> = {
  intensity: { label: '發光強度', min: 0, max: 8, step: 0.05 },
  backgroundAlpha: { label: '背景不透明度', min: 0, max: 1, step: 0.01 },
  flicker: { label: '閃爍強度', min: 0, max: 1, step: 0.01 },
  flickerSpeed: { label: '閃爍速度', min: 0, max: 40, step: 0.5 },
  scanAmount: { label: '掃描線強度', min: 0, max: 1, step: 0.01 },
  scanDensity: { label: '掃描線 條/m', min: 1, max: 60, step: 0.5 },
  scanSpeed: { label: '掃描線速度 m/s', min: -5, max: 5, step: 0.05 },
};

const MATERIAL_PANEL: ConfigSchema<LevelMaterialDef> = {
  color: { label: '底色', params: { view: 'color' } },
  emissive: { label: '發光色', params: { view: 'color' } },
  emissiveIntensity: { label: '發光強度', min: 0, max: 10, step: 0.05 },
  roughness: { label: '粗糙度', min: 0, max: 1, step: 0.01 },
  metalness: { label: '金屬度', min: 0, max: 1, step: 0.01 },
};

const PANEL_PATTERN_PANEL: ConfigSchema<PanelPattern> = {
  seamWidth: { label: '接縫寬 m', min: 0, max: 0.2, step: 0.005 },
  gridMeters: { label: '細格線間距 m', min: 0, max: 5, step: 0.25, description: '0 = 無；需能整除 5 m' },
  gridLevel: { label: '細格線亮度', min: 0, max: 0.5, step: 0.01 },
  glowWidth: { label: '發光線寬 m', min: 0, max: 0.3, step: 0.005 },
  base: { label: '底色亮度', min: 0, max: 1, step: 0.01 },
  variation: { label: '面板亮度變化', min: 0, max: 0.3, step: 0.005 },
  bump: { label: '法線強度', min: 0, max: 8, step: 0.1 },
};

export interface VisualPanelDeps {
  panel: DebugPanel;
  postfx: PostFX;
  lighting: SceneLighting;
  sky: Sky;
  library: MaterialLibrary;
  scene: THREE.Scene;
  renderer: THREE.WebGLRenderer;
  environment: EnvironmentConfig;
  /** 目前畫質等級與預設、套用畫質、重新預熱、最後一次預熱結果。 */
  getQualityLevel: () => string;
  applyQuality: () => void;
  warmup: () => void;
  getWarmupReport: () => WarmupReport | null;
}

/** 註冊「視覺」資料夾；回傳更新監看值的 Game 系統。 */
export function bindVisualPanel(d: VisualPanelDeps): GameSystem {
  const { panel, postfx, lighting, sky, library } = d;
  for (const level of QUALITY_LEVELS) {
    panel.bindConfig(`視覺/畫質預設/${LEVEL_LABELS[level]}`, QUALITY_PRESETS[level], QUALITY_PANEL, {
      onChange: () => d.applyQuality(),
    });
  }
  panel.bindConfig('視覺/後處理', postfx.config, POSTFX_PANEL, {
    onChange: (key) => (key === 'bloomLevels' ? postfx.rebuild() : postfx.applyConfig()),
  });
  panel.bindConfig('視覺/燈光', lighting.config, LIGHTING_PANEL, { onChange: () => lighting.apply() });
  panel.bindConfig(
    '視覺/環境反射',
    d.environment,
    { intensity: { label: '環境反射強度', min: 0, max: 3, step: 0.01 } },
    { onChange: () => (d.scene.environmentIntensity = d.environment.intensity) },
  );
  panel.bindConfig('視覺/天空與霧', sky.config, SKY_PANEL, { onChange: () => sky.apply() });
  panel.bindConfig('視覺/全息看板', library.holo, HOLO_PANEL);
  for (const [id, def] of Object.entries(library.table)) {
    const schema: ConfigSchema<LevelMaterialDef> = {};
    const kind = def.kind ?? 'standard';
    schema.color = MATERIAL_PANEL.color!;
    if (kind === 'glow') schema.emissiveIntensity = MATERIAL_PANEL.emissiveIntensity!;
    else {
      if (def.emissive !== undefined) {
        schema.emissive = MATERIAL_PANEL.emissive!;
        schema.emissiveIntensity = MATERIAL_PANEL.emissiveIntensity!;
      }
      schema.roughness = MATERIAL_PANEL.roughness!;
      schema.metalness = MATERIAL_PANEL.metalness!;
    }
    // 沒有寫明的數值先補上預設，面板才能顯示。
    def.roughness ??= 0.7;
    def.metalness ??= 0.4;
    def.emissiveIntensity ??= 1;
    panel.bindConfig(`視覺/材質/${def.label}（${id}）`, def, schema, { onChange: () => library.refresh() });
  }
  for (const id of ['floorPanel', 'wallPanel', 'towerPanel', 'coverPanel'] as const) {
    panel.bindConfig(`視覺/圖樣/${id}`, PATTERNS[id], PANEL_PATTERN_PANEL, { onChange: () => library.refresh(true) });
  }
  panel.bindButtons('視覺/測試', [
    { title: '色差脈衝 0.5', onClick: () => postfx.pulseAberration(0.5, 0.3) },
    { title: '色差脈衝 1.0', onClick: () => postfx.pulseAberration(1, 0.6) },
    { title: '重新預熱著色器', onClick: () => d.warmup() },
  ]);
  const m = {
    quality: '',
    passes: '',
    shadows: '',
    programs: 0,
    warmup: '',
    textures: '',
    sky: '',
    buffer: '',
  };
  panel.bindConfig(
    '視覺/監看',
    m,
    {
      quality: { label: '畫質', readonly: true },
      passes: { label: '後處理', readonly: true },
      shadows: { label: '陰影', readonly: true },
      programs: { label: '著色器程式', readonly: true },
      warmup: { label: '預熱', readonly: true },
      textures: { label: '程序貼圖', readonly: true },
      sky: { label: '天空', readonly: true },
      buffer: { label: 'buffer', readonly: true },
    },
    { expanded: true },
  );
  return {
    name: 'visualMonitor',
    order: SystemOrder.debug,
    update() {
      if (!panel.isOpen) return;
      const q = QUALITY_PRESETS[d.getQualityLevel() as keyof typeof QUALITY_PRESETS];
      m.quality = `${d.getQualityLevel()}・${q ? `${Math.round(q.renderScale * 100)}%` : ''}`;
      m.passes = q ? describePasses(q).join(' → ') : '';
      m.shadows = lighting.shadowsEnabled ? `${lighting.sun.shadow.mapSize.x}px・texel ${(lighting.texelSize * 100).toFixed(1)} cm` : '關';
      m.programs = d.renderer.info.programs?.length ?? 0;
      const w = d.getWarmupReport();
      m.warmup = w ? `${w.materials} 材質・${w.textures} 貼圖・${w.ms.toFixed(0)} ms` : '—';
      m.textures = `${library.textures.generated} 組・${library.textures.generateMs.toFixed(0)} ms`;
      m.sky = `${sky.stats.beams} 梁・${sky.stats.windows} 窗・${sky.stats.stars} 星`;
      m.buffer = postfx.frameBufferType === THREE.HalfFloatType ? 'HalfFloat' : '8 位元';
    },
  };
}
