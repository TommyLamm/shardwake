// 畫質預設（M1-09）：低／中／高各自的渲染比例、陰影、Bloom、SMAA。
// 玩家只選等級（設定 quality，存在 shardwake:settings:v1）；各等級的內容是設定資料，可在調參面板「視覺/畫質預設」調整
// （開發調校用，不存檔）。resolveQualityPreset() 把表中的值夾在合法範圍內，給渲染端直接使用。

export type QualityLevel = 'low' | 'medium' | 'high';

export const QUALITY_LEVELS: readonly QualityLevel[] = ['low', 'medium', 'high'];

export type SmaaQuality = 'low' | 'medium' | 'high' | 'ultra';

export interface QualityPreset {
  /** 渲染比例（乘在像素比上），0.5–1。 */
  renderScale: number;
  /** 方向光陰影。 */
  shadows: boolean;
  /** 陰影貼圖邊長（像素，2 的次方，512–4096）。 */
  shadowMapSize: number;
  /** Bloom（只抓發光處）。 */
  bloom: boolean;
  /** SMAA 反鋸齒（renderer 內建 MSAA 已關閉）。 */
  smaa: boolean;
  /** SMAA 品質。 */
  smaaQuality: SmaaQuality;
}

export const QUALITY_PRESETS: Record<QualityLevel, QualityPreset> = {
  low: { renderScale: 0.67, shadows: false, shadowMapSize: 1024, bloom: false, smaa: false, smaaQuality: 'low' },
  medium: { renderScale: 0.85, shadows: true, shadowMapSize: 1024, bloom: true, smaa: true, smaaQuality: 'medium' },
  high: { renderScale: 1, shadows: true, shadowMapSize: 2048, bloom: true, smaa: true, smaaQuality: 'high' },
};

export const RENDER_SCALE_RANGE = { min: 0.5, max: 1 } as const;
export const SHADOW_MAP_RANGE = { min: 512, max: 4096 } as const;

/** 最接近的 2 的次方（夾在範圍內）。 */
export function nearestPowerOfTwo(x: number, min: number, max: number): number {
  if (!Number.isFinite(x) || x <= 0) return min;
  const p = 2 ** Math.round(Math.log2(x));
  return Math.min(max, Math.max(min, p));
}

/** 取得等級的預設（複製並夾住數值；未知等級視為 high）。 */
export function resolveQualityPreset(
  level: string,
  table: Readonly<Record<QualityLevel, QualityPreset>> = QUALITY_PRESETS,
): QualityPreset {
  const src = (QUALITY_LEVELS as readonly string[]).includes(level) ? table[level as QualityLevel] : table.high;
  const scale = Number.isFinite(src.renderScale) ? src.renderScale : 1;
  const smaaQuality: SmaaQuality = (['low', 'medium', 'high', 'ultra'] as const).includes(src.smaaQuality)
    ? src.smaaQuality
    : 'high';
  return {
    renderScale: Math.min(RENDER_SCALE_RANGE.max, Math.max(RENDER_SCALE_RANGE.min, scale)),
    shadows: Boolean(src.shadows),
    shadowMapSize: nearestPowerOfTwo(src.shadowMapSize, SHADOW_MAP_RANGE.min, SHADOW_MAP_RANGE.max),
    bloom: Boolean(src.bloom),
    smaa: Boolean(src.smaa),
    smaaQuality,
  };
}

/** 兩個預設中，需要重建後處理管線的欄位是否不同（Bloom、SMAA 開關或品質）。 */
export function postPassesChanged(a: QualityPreset, b: QualityPreset): boolean {
  return a.bloom !== b.bloom || a.smaa !== b.smaa || (a.smaa && a.smaaQuality !== b.smaaQuality);
}
