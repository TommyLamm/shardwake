// 關卡材質表（M1-09，取代 M1-04 的灰盒材質表）：純資料，不依賴 Three.js 執行期。
// - 每個材質 id：表面類型與預設旗標（LevelBuilder 用來登記跑牆、抓鉤、材質音效），以及外觀（MaterialLibrary 用）。
// - 外觀種類：standard（PBR，程序貼圖 + 發光線）、glow（不受光的發光條，強度 > 1 讓 Bloom 只抓這些）、glass（半透明反射）。
// - 色彩方向（docs/design.md「美術方向」）：深藍灰金屬基底；青（主）、洋紅（輔）、橘（警示）發光。各分區不同底色與發光主色。
// 數值可在調參面板「視覺/材質」調整（不存檔）。
import type { SurfaceType } from '@/physics/SurfaceRegistry';
import type { HazardPattern, HexPattern, PanelPattern, PatternSpec } from '@/world/Textures';

export type MaterialKind = 'standard' | 'glow' | 'glass';

export interface LevelMaterialDef {
  label: string;
  /** 底色（sRGB hex；standard 乘在貼圖上、glow 為發光色）。 */
  color: number;
  surface: SurfaceType;
  wallRunnable?: boolean;
  grappleable?: boolean;
  /** 外觀種類（預設 standard）。 */
  kind?: MaterialKind;
  /** 程序貼圖（PATTERNS 的 key）；省略時不貼圖。 */
  pattern?: PatternId;
  roughness?: number;
  metalness?: number;
  /** 法線強度（貼圖有法線時）。 */
  normalScale?: number;
  /** 發光色與強度：standard 乘在貼圖的發光遮罩上（沒有遮罩時整面發光）；glow 的強度乘在 color 上。 */
  emissive?: number;
  emissiveIntensity?: number;
  /** 環境反射強度倍率。 */
  envIntensity?: number;
  /** 半透明（glass）。 */
  opacity?: number;
  /** 陰影（預設：standard 投射與接收；glow 都不；glass 只接收）。 */
  castShadow?: boolean;
  receiveShadow?: boolean;
}

/** 材質表查詢（LevelBuilder 用來決定表面類型與預設旗標）。 */
export type MaterialTable = Readonly<Record<string, LevelMaterialDef>>;

// ── 程序貼圖規格 ─────────────────────────────────────────

const floorPanel: PanelPattern = {
  kind: 'panel',
  panelW: 2.5,
  panelH: 2.5,
  seamWidth: 0.035,
  gridMeters: 1.25,
  gridWidth: 0.02,
  gridLevel: 0.09,
  base: 0.55,
  variation: 0.05,
  noise: 0.025,
  boltInset: 0.12,
  boltRadius: 0.022,
  glowWidth: 0.045,
  seamGlow: 0,
  bump: 1.6,
  roughPanel: 0.7,
  roughSeam: 1,
  seed: 11,
};

const wallPanel: PanelPattern = {
  ...floorPanel,
  panelW: 1.25,
  panelH: 2.5,
  gridMeters: 0,
  variation: 0.07,
  boltInset: 0.08,
  glowWidth: 0.04,
  seed: 23,
};

const towerPanel: PanelPattern = {
  ...floorPanel,
  panelW: 2.5,
  panelH: 1.25,
  gridMeters: 0,
  variation: 0.08,
  boltRadius: 0,
  glowWidth: 0.05,
  seed: 37,
};

const coverPanel: PanelPattern = {
  ...floorPanel,
  panelW: 1.25,
  panelH: 1.25,
  gridMeters: 0,
  base: 0.5,
  variation: 0.08,
  boltInset: 0.07,
  glowWidth: 0,
  seamGlow: 0.35,
  seed: 41,
};

const hexPlate: HexPattern = {
  kind: 'hex',
  columns: 7,
  lineWidth: 0.06,
  base: 0.5,
  lineLevel: 0.2,
  fillChance: 0.12,
  fillLevel: 0.08,
  noise: 0.025,
  lineGlow: 0.55,
  bump: 1.2,
  roughPanel: 0.6,
  roughSeam: 0.95,
  seed: 5,
};

const hazardStripes: HazardPattern = {
  kind: 'hazard',
  period: 0.5,
  duty: 0.5,
  colorA: 0xff8a1a,
  colorB: 0x16181c,
  wear: 0.18,
  glow: 0.6,
  seed: 3,
};

/** 程序貼圖規格表（可在調參面板改數值後重建）。 */
export const PATTERNS = {
  floorPanel,
  wallPanel,
  towerPanel,
  coverPanel,
  hexPlate,
  hazardStripes,
} satisfies Record<string, PatternSpec>;

export type PatternId = keyof typeof PATTERNS;

// ── 材質表 ─────────────────────────────────────────────

/** 訓練場與之後關卡共用的材質表。 */
export const LEVEL_MATERIALS = {
  floor: { label: '一般地板', color: 0x4a5464, surface: 'concrete', pattern: 'floorPanel', emissive: 0x39e6ff, emissiveIntensity: 0.8 },
  wall: {
    label: '外牆',
    color: 0x3a4456,
    surface: 'metal',
    wallRunnable: true,
    grappleable: true,
    pattern: 'wallPanel',
    metalness: 0.6,
    emissive: 0x39e6ff,
    emissiveIntensity: 1.2,
  },
  spawn: { label: '出生區', color: 0x3c5a66, surface: 'metal', pattern: 'floorPanel', metalness: 0.5, emissive: 0x39e6ff, emissiveIntensity: 1.2 },
  range: { label: '靶場', color: 0x5e5246, surface: 'concrete', pattern: 'floorPanel', metalness: 0.2, emissive: 0xff8a20, emissiveIntensity: 1.2 },
  marker: { label: '標線', color: 0xff8a20, surface: 'metal', kind: 'glow', emissiveIntensity: 3.5 },
  wallrun: {
    label: '跑牆區',
    color: 0x404a86,
    surface: 'metal',
    wallRunnable: true,
    pattern: 'wallPanel',
    metalness: 0.55,
    emissive: 0xff3df0,
    emissiveIntensity: 1.6,
  },
  pit: { label: '深坑', color: 0x1c2029, surface: 'metal', pattern: 'wallPanel', metalness: 0.5 },
  slide: { label: '滑鏟區', color: 0x36584e, surface: 'metal', pattern: 'floorPanel', metalness: 0.5, roughness: 0.45, emissive: 0x39e6ff, emissiveIntensity: 1.4 },
  climb: { label: '攀爬區', color: 0x5e5838, surface: 'concrete', pattern: 'coverPanel', metalness: 0.25, emissive: 0xff8a20, emissiveIntensity: 1.2 },
  platform: { label: '浮台區', color: 0x52406e, surface: 'grate', pattern: 'hexPlate', metalness: 0.55, emissive: 0xff3df0, emissiveIntensity: 1.4 },
  tower: {
    label: '高塔',
    color: 0x34507a,
    surface: 'metal',
    wallRunnable: true,
    grappleable: true,
    pattern: 'towerPanel',
    metalness: 0.6,
    emissive: 0x39e6ff,
    emissiveIntensity: 1.6,
  },
  grapple: { label: '抓鉤點', color: 0x39e6ff, surface: 'metal', grappleable: true, kind: 'glow', emissiveIntensity: 4 },
  arena: { label: '戰區', color: 0x5a3a44, surface: 'concrete', pattern: 'floorPanel', metalness: 0.3, emissive: 0xff8a20, emissiveIntensity: 1.1 },
  cover: { label: '掩體', color: 0x464c58, surface: 'metal', pattern: 'coverPanel', metalness: 0.6, emissive: 0xff8a20, emissiveIntensity: 1.4 },
  grate: { label: '格柵', color: 0x4a525c, surface: 'grate', pattern: 'hexPlate', metalness: 0.6 },
  glass: { label: '玻璃', color: 0x9ad8ff, surface: 'glass', kind: 'glass', opacity: 0.28, roughness: 0.05, metalness: 0.1, envIntensity: 1.5 },
  hazard: { label: '警示', color: 0xffffff, surface: 'hazard', pattern: 'hazardStripes', metalness: 0.3, emissive: 0xff7a1a, emissiveIntensity: 1.6 },
  glowCyan: { label: '發光條・青', color: 0x39e6ff, surface: 'metal', kind: 'glow', emissiveIntensity: 3.2 },
  glowMagenta: { label: '發光條・洋紅', color: 0xff3df0, surface: 'metal', kind: 'glow', emissiveIntensity: 3.2 },
  glowOrange: { label: '發光條・橘', color: 0xff8a20, surface: 'metal', kind: 'glow', emissiveIntensity: 3.2 },
} satisfies Record<string, LevelMaterialDef>;

export type LevelMaterialId = keyof typeof LEVEL_MATERIALS;

export const LEVEL_MATERIAL_TABLE: MaterialTable = LEVEL_MATERIALS;

/** 預設的 standard 數值。 */
export const MATERIAL_DEFAULTS = {
  roughness: 0.7,
  metalness: 0.4,
  normalScale: 0.6,
  envIntensity: 1,
} as const;

/** 材質的陰影旗標（預設：standard 投射與接收；glow 都不；glass 只接收）。 */
export function materialShadowFlags(def: LevelMaterialDef | undefined): { cast: boolean; receive: boolean } {
  const kind = def?.kind ?? 'standard';
  return {
    cast: def?.castShadow ?? kind === 'standard',
    receive: def?.receiveShadow ?? kind !== 'glow',
  };
}
