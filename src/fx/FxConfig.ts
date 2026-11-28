// 武器特效的表現數值（M1-11）：每種武器原型一組風格、每種表面一組命中顏色、共用的池上限與爆炸參數。
// 調參面板「武器表現/特效…」直接改寫這些物件，下一次生成就生效（池上限除外：改了要重新整理頁面）。
// 顏色為 sRGB hex；強度 × 顏色 > 1（線性）才會被 Bloom 抓到（M1-09 的發光規則）。
import type { ConfigSchema } from '@/debug/DebugPanel';
import type { SurfaceType } from '@/physics/SurfaceRegistry';

export interface WeaponFxStyle {
  /** 槍口閃光：顏色、強度、大小（m，viewmodel 尺度）、持續時間（s）、世界點光源亮度。 */
  flashColor: string;
  flashIntensity: number;
  flashSize: number;
  flashTime: number;
  flashLight: number;
  /** 曳光：顏色、強度、寬度（m）、存在時間（s）、前進速度（m/s；0 = 整條立即出現）、拖尾長度（m）、每顆彈丸畫曳光的機率。 */
  tracerColor: string;
  tracerIntensity: number;
  tracerWidth: number;
  tracerLife: number;
  tracerSpeed: number;
  tracerLength: number;
  tracerChance: number;
  /** 命中火花：顆數、初速（m/s）、大小（m）、存在時間（s）。 */
  impactSparks: number;
  impactSpeed: number;
  impactSize: number;
  impactLife: number;
  /** 彈孔大小（m；0 = 不留彈孔）。 */
  decalSize: number;
}

const base: WeaponFxStyle = {
  flashColor: '#ffb070',
  flashIntensity: 5,
  flashSize: 0.16,
  flashTime: 0.05,
  flashLight: 8,
  tracerColor: '#ffc27a',
  tracerIntensity: 6,
  tracerWidth: 0.025,
  tracerLife: 0.07,
  tracerSpeed: 700,
  tracerLength: 9,
  tracerChance: 1,
  impactSparks: 7,
  impactSpeed: 6,
  impactSize: 0.018,
  impactLife: 0.32,
  decalSize: 0.09,
};

/** 依武器原型（WeaponDef.archetype）的特效風格；未知原型用 default。 */
export const WEAPON_FX_STYLES: Record<string, WeaponFxStyle> = {
  default: { ...base },
  assaultRifle: { ...base },
  shotgun: {
    ...base,
    flashSize: 0.24,
    flashLight: 12,
    tracerWidth: 0.014,
    tracerLife: 0.05,
    tracerLength: 5,
    tracerChance: 0.6,
    impactSparks: 3,
    impactSpeed: 4.5,
    decalSize: 0.06,
  },
  handCannon: {
    ...base,
    flashColor: '#ffa050',
    flashSize: 0.22,
    flashLight: 12,
    tracerWidth: 0.035,
    tracerIntensity: 8,
    tracerLength: 12,
    impactSparks: 14,
    impactSpeed: 8,
    impactSize: 0.022,
    decalSize: 0.12,
  },
  railSniper: {
    ...base,
    flashColor: '#7ff0ff',
    flashIntensity: 6,
    flashSize: 0.2,
    flashLight: 10,
    tracerColor: '#7ff0ff',
    tracerIntensity: 7,
    tracerWidth: 0.05,
    tracerLife: 0.45,
    tracerSpeed: 0,
    tracerLength: 0,
    impactSparks: 20,
    impactSpeed: 10,
    impactSize: 0.024,
    impactLife: 0.45,
    decalSize: 0.14,
  },
  plasmaLauncher: {
    ...base,
    flashColor: '#c08bff',
    flashIntensity: 6,
    flashSize: 0.26,
    flashLight: 10,
    tracerColor: '#c08bff',
    tracerChance: 0,
    impactSparks: 0,
    decalSize: 0,
  },
};

export function fxStyleFor(archetype: string | undefined): WeaponFxStyle {
  return (archetype ? WEAPON_FX_STYLES[archetype] : undefined) ?? WEAPON_FX_STYLES.default!;
}

/** 命中表面：火花顏色與強度、是否留彈孔。發光表面（energy：抓鉤點、標線）換成青色火花。 */
export interface SurfaceImpactStyle {
  color: string;
  intensity: number;
  decal: boolean;
  /** 火花數倍率。 */
  sparks: number;
}

export const SURFACE_IMPACT: Record<SurfaceType, SurfaceImpactStyle> = {
  metal: { color: '#ffb36b', intensity: 5, decal: true, sparks: 1 },
  grate: { color: '#ffb36b', intensity: 5, decal: true, sparks: 1 },
  concrete: { color: '#ff9a5a', intensity: 3.5, decal: true, sparks: 0.7 },
  glass: { color: '#bfe8ff', intensity: 4, decal: true, sparks: 0.8 },
  energy: { color: '#39e6ff', intensity: 7, decal: false, sparks: 1.4 },
  hazard: { color: '#ff8a20', intensity: 5, decal: true, sparks: 1 },
};

export interface FxConfig {
  /** 池上限（啟動時建立；改了要重新整理）。 */
  maxSparks: number;
  maxTracers: number;
  maxDecals: number;
  maxExplosions: number;
  maxBolts: number;
  /** 火花重力倍率與拖尾（每 m/s 拉長的長度，s）。 */
  sparkGravity: number;
  sparkStretch: number;
  /** 低畫質時火花與曳光數量倍率。 */
  lowQualityMult: number;
  /** 彈孔：高溫邊緣持續時間（s）與離表面的距離（m）。 */
  decalHeatTime: number;
  decalLift: number;
  /** 爆炸：球殼持續時間（s）、顏色、強度；火花數、速度；焦痕大小倍率（× 半徑）；閃光點光源亮度與時間。 */
  explosionLife: number;
  explosionColor: string;
  explosionIntensity: number;
  explosionSparks: number;
  explosionSparkSpeed: number;
  explosionScorch: number;
  /** 焦痕剛留下時的高溫光（0..1）。 */
  explosionScorchHeat: number;
  explosionLight: number;
  explosionLightTime: number;
  /** 世界點光源的衰減距離（m）：槍口與爆炸。 */
  muzzleLightDistance: number;
  explosionLightDistance: number;
  /** 電漿投射物：發光半徑（× 碰撞半徑）、拖尾長度（m）、顏色與強度。 */
  boltGlowScale: number;
  boltTrail: number;
  boltColor: string;
  boltIntensity: number;
  /** 電漿撞擊火花顏色。 */
  boltSparkColor: string;
}

export const FX_CONFIG: FxConfig = {
  maxSparks: 768,
  maxTracers: 96,
  maxDecals: 96,
  maxExplosions: 8,
  maxBolts: 32,
  sparkGravity: 1,
  sparkStretch: 0.012,
  lowQualityMult: 0.5,
  decalHeatTime: 1.2,
  decalLift: 0.004,
  explosionLife: 0.45,
  explosionColor: '#b36bff',
  explosionIntensity: 4,
  explosionSparks: 48,
  explosionSparkSpeed: 11,
  explosionScorch: 0.45,
  explosionScorchHeat: 0.25,
  explosionLight: 40,
  explosionLightTime: 0.25,
  muzzleLightDistance: 9,
  explosionLightDistance: 14,
  boltGlowScale: 2.2,
  boltTrail: 1.6,
  boltColor: '#c08bff',
  boltIntensity: 6,
  boltSparkColor: '#d6a8ff',
};

/** 面板：共用參數（池上限唯讀說明在 description）。 */
export const FX_PANEL: ConfigSchema<FxConfig> = {
  sparkGravity: { label: '火花重力倍率', min: 0, max: 3, step: 0.05 },
  sparkStretch: { label: '火花拖尾 s', min: 0, max: 0.05, step: 0.001 },
  lowQualityMult: { label: '低畫質數量倍率', min: 0, max: 1, step: 0.05 },
  decalHeatTime: { label: '彈孔高溫 s', min: 0, max: 5, step: 0.05 },
  decalLift: { label: '彈孔離面 m', min: 0, max: 0.05, step: 0.0005 },
  explosionLife: { label: '爆炸時間 s', min: 0.05, max: 2, step: 0.01 },
  explosionColor: { label: '爆炸顏色' },
  explosionIntensity: { label: '爆炸強度', min: 0, max: 20, step: 0.1 },
  explosionSparks: { label: '爆炸火花', min: 0, max: 200, step: 1 },
  explosionSparkSpeed: { label: '爆炸火花速度', min: 0, max: 40, step: 0.5 },
  explosionScorch: { label: '焦痕 × 半徑', min: 0, max: 2, step: 0.01 },
  explosionScorchHeat: { label: '焦痕高溫', min: 0, max: 1, step: 0.01 },
  explosionLight: { label: '爆炸閃光亮度', min: 0, max: 200, step: 1 },
  explosionLightTime: { label: '爆炸閃光 s', min: 0.01, max: 1, step: 0.01 },
  muzzleLightDistance: { label: '槍口光距離 m', min: 1, max: 30, step: 0.5 },
  explosionLightDistance: { label: '爆炸光距離 m', min: 1, max: 50, step: 0.5 },
  boltGlowScale: { label: '電漿發光 × 半徑', min: 0.5, max: 6, step: 0.1 },
  boltTrail: { label: '電漿拖尾 m', min: 0, max: 6, step: 0.05 },
  boltColor: { label: '電漿顏色' },
  boltIntensity: { label: '電漿強度', min: 0, max: 20, step: 0.1 },
  boltSparkColor: { label: '電漿火花色' },
};

export const FX_STYLE_PANEL: ConfigSchema<WeaponFxStyle> = {
  flashColor: { label: '閃光顏色' },
  flashIntensity: { label: '閃光強度', min: 0, max: 20, step: 0.1 },
  flashSize: { label: '閃光大小 m', min: 0, max: 1, step: 0.005 },
  flashTime: { label: '閃光時間 s', min: 0.01, max: 0.3, step: 0.005 },
  flashLight: { label: '槍口光亮度', min: 0, max: 60, step: 0.5 },
  tracerColor: { label: '曳光顏色' },
  tracerIntensity: { label: '曳光強度', min: 0, max: 20, step: 0.1 },
  tracerWidth: { label: '曳光寬 m', min: 0.002, max: 0.2, step: 0.001 },
  tracerLife: { label: '曳光時間 s', min: 0.01, max: 1.5, step: 0.005 },
  tracerSpeed: { label: '曳光速度 m/s', min: 0, max: 3000, step: 10, description: '0 = 整條立即出現' },
  tracerLength: { label: '拖尾長 m', min: 0, max: 60, step: 0.5, description: '0 = 從槍口畫到命中點' },
  tracerChance: { label: '曳光機率', min: 0, max: 1, step: 0.05, description: '霰彈可降量' },
  impactSparks: { label: '命中火花數', min: 0, max: 60, step: 1 },
  impactSpeed: { label: '火花速度 m/s', min: 0, max: 30, step: 0.1 },
  impactSize: { label: '火花大小 m', min: 0.002, max: 0.1, step: 0.001 },
  impactLife: { label: '火花時間 s', min: 0.05, max: 2, step: 0.01 },
  decalSize: { label: '彈孔大小 m', min: 0, max: 0.5, step: 0.005 },
};
