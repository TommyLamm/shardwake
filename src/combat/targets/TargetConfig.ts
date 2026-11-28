// 靶標數值（M1-12）：靜態假人、移動靶、訓練無人機、能量球。全部可在調參面板「戰鬥/靶標」調整（main.ts 綁定）。
// 靶場與戰區的擺放位置在 TRAINING_TARGET_LAYOUT（訓練場的分區座標見 world/levels/TrainingGround.ts）。
import type { ConfigSchema } from '@/debug/DebugPanel';
import { RANGE_FIRING_LINE_Z } from '@/world/levels/TrainingGround';

export interface DummyConfig {
  maxHealth: number;
  /** 未受傷多久後回滿（s）。 */
  regenDelay: number;
  /** 被擊殺後多久重置（站起、回滿；s）。 */
  resetDelay: number;
  /** 倒下與站起的動畫時間（s）。 */
  fallTime: number;
  riseTime: number;
  /** 倒下角度（度）。 */
  fallAngle: number;
  /** 頭部（弱點）的部位倍率（乘在武器 critMult 上；1 = 只用武器的弱點倍率）。 */
  headMultiplier: number;
}

export interface MoverConfig {
  /** 移動速度範圍（m/s）與隨機變向的間隔範圍（s）。 */
  speedMin: number;
  speedMax: number;
  changeMin: number;
  changeMax: number;
  /** 每次變速時反向的機率。 */
  reverseChance: number;
}

export interface DroneConfig {
  /** 數量（0..maxCount；預先建立 maxCount 架）。 */
  count: number;
  maxHealth: number;
  /** 擊毀後重生時間（s）。 */
  respawnTime: number;
  /** 繞玩家飛行的半徑範圍（m）、切線速度（m/s）、高度範圍（m，地面 y = 0）。 */
  orbitRadiusMin: number;
  orbitRadiusMax: number;
  orbitSpeed: number;
  heightMin: number;
  heightMax: number;
  /** 重新挑半徑與高度、反轉繞行方向的間隔範圍（s）與反轉機率。 */
  retargetMin: number;
  retargetMax: number;
  reverseChance: number;
  /** 追目標點：最大速度（m/s）、加速度（m/s²）、追隨增益（1/s）。 */
  maxSpeed: number;
  accel: number;
  followGain: number;
  /** 無人機之間保持的距離（m）。 */
  separation: number;
  /** 開火間隔（s）與啟動後第一發的延遲範圍（s）；沒有視線時每 losRetry 秒重試。 */
  fireInterval: number;
  firstShotMin: number;
  firstShotMax: number;
  losRetry: number;
  /** 能量球：速度（m/s）、傷害、碰撞半徑（m）、存在時間（s）。 */
  boltSpeed: number;
  boltDamage: number;
  boltRadius: number;
  boltLifetime: number;
  /** 瞄準玩家中心以上的高度偏移（m；0 = 中心）。 */
  aimOffsetY: number;
  /** 核心（弱點）的部位倍率。 */
  coreMultiplier: number;
  /** 擊毀爆炸半徑（m，特效與震動）。 */
  explosionRadius: number;
}

export interface TargetFlashConfig {
  /** 命中閃白：峰值發光強度（> 0.8 會被 Bloom 抓到）與衰減時間（s）。 */
  intensity: number;
  duration: number;
}

export interface TargetConfig {
  dummy: DummyConfig;
  mover: MoverConfig;
  drone: DroneConfig;
  flash: TargetFlashConfig;
}

export const TARGET_CONFIG: TargetConfig = {
  dummy: { maxHealth: 1000, regenDelay: 2.5, resetDelay: 1.5, fallTime: 0.35, riseTime: 0.3, fallAngle: 84, headMultiplier: 1 },
  mover: { speedMin: 3, speedMax: 8, changeMin: 0.8, changeMax: 2.2, reverseChance: 0.5 },
  drone: {
    count: 3,
    maxHealth: 150,
    respawnTime: 5,
    orbitRadiusMin: 12,
    orbitRadiusMax: 25,
    orbitSpeed: 5,
    heightMin: 6,
    heightMax: 11,
    retargetMin: 2.5,
    retargetMax: 5.5,
    reverseChance: 0.35,
    maxSpeed: 11,
    accel: 14,
    followGain: 1.6,
    separation: 5,
    fireInterval: 1.5,
    firstShotMin: 0.6,
    firstShotMax: 1.6,
    losRetry: 0.25,
    boltSpeed: 18,
    boltDamage: 15,
    boltRadius: 0.3,
    boltLifetime: 4,
    aimOffsetY: 0.1,
    coreMultiplier: 1,
    explosionRadius: 2.2,
  },
  flash: { intensity: 1.6, duration: 0.12 },
};

/** 預先建立的無人機數（數量上限）。 */
export const MAX_DRONES = 6;

export function defaultTargetConfig(): TargetConfig {
  return {
    dummy: { ...TARGET_CONFIG.dummy },
    mover: { ...TARGET_CONFIG.mover },
    drone: { ...TARGET_CONFIG.drone },
    flash: { ...TARGET_CONFIG.flash },
  };
}

export const DUMMY_PANEL: ConfigSchema<DummyConfig> = {
  maxHealth: { label: '假人／移動靶血量', min: 50, max: 20000, step: 50 },
  regenDelay: { label: '回滿延遲 s', min: 0.1, max: 20, step: 0.1, description: '未受傷多久後回滿' },
  resetDelay: { label: '擊殺後重置 s', min: 0.1, max: 10, step: 0.1 },
  fallTime: { label: '倒下動畫 s', min: 0.05, max: 2, step: 0.05 },
  riseTime: { label: '站起動畫 s', min: 0.05, max: 2, step: 0.05 },
  fallAngle: { label: '倒下角度°', min: 0, max: 90, step: 1 },
  headMultiplier: { label: '頭部部位倍率', min: 0.1, max: 5, step: 0.05, description: '乘在武器弱點倍率上' },
};

export const MOVER_PANEL: ConfigSchema<MoverConfig> = {
  speedMin: { label: '速度下限 m/s', min: 0, max: 20, step: 0.1 },
  speedMax: { label: '速度上限 m/s', min: 0, max: 20, step: 0.1 },
  changeMin: { label: '變向間隔下限 s', min: 0.1, max: 10, step: 0.05 },
  changeMax: { label: '變向間隔上限 s', min: 0.1, max: 10, step: 0.05 },
  reverseChance: { label: '反向機率', min: 0, max: 1, step: 0.05 },
};

export const DRONE_PANEL: ConfigSchema<DroneConfig> = {
  count: { label: '數量', min: 0, max: MAX_DRONES, step: 1 },
  maxHealth: { label: '血量', min: 10, max: 5000, step: 10 },
  respawnTime: { label: '重生時間 s', min: 0.1, max: 30, step: 0.1 },
  orbitRadiusMin: { label: '繞行半徑下限 m', min: 2, max: 40, step: 0.5 },
  orbitRadiusMax: { label: '繞行半徑上限 m', min: 2, max: 40, step: 0.5 },
  orbitSpeed: { label: '繞行切線速度 m/s', min: 0, max: 20, step: 0.1 },
  heightMin: { label: '高度下限 m', min: 1, max: 30, step: 0.5 },
  heightMax: { label: '高度上限 m', min: 1, max: 30, step: 0.5 },
  retargetMin: { label: '換位間隔下限 s', min: 0.2, max: 20, step: 0.1 },
  retargetMax: { label: '換位間隔上限 s', min: 0.2, max: 20, step: 0.1 },
  reverseChance: { label: '反轉繞行機率', min: 0, max: 1, step: 0.05 },
  maxSpeed: { label: '最大速度 m/s', min: 0.5, max: 40, step: 0.5 },
  accel: { label: '加速度 m/s²', min: 0.5, max: 80, step: 0.5 },
  followGain: { label: '追隨增益 1/s', min: 0.1, max: 10, step: 0.1 },
  separation: { label: '互相間距 m', min: 0, max: 20, step: 0.5 },
  fireInterval: { label: '開火間隔 s', min: 0.1, max: 10, step: 0.05 },
  firstShotMin: { label: '首發延遲下限 s', min: 0, max: 5, step: 0.05 },
  firstShotMax: { label: '首發延遲上限 s', min: 0, max: 5, step: 0.05 },
  losRetry: { label: '無視線重試 s', min: 0.05, max: 2, step: 0.05 },
  boltSpeed: { label: '能量球速度 m/s', min: 1, max: 100, step: 0.5 },
  boltDamage: { label: '能量球傷害', min: 0, max: 200, step: 1 },
  boltRadius: { label: '能量球半徑 m', min: 0.02, max: 1.5, step: 0.01 },
  boltLifetime: { label: '能量球存在 s', min: 0.2, max: 15, step: 0.1 },
  aimOffsetY: { label: '瞄準高度偏移 m', min: -1, max: 1, step: 0.05 },
  coreMultiplier: { label: '核心部位倍率', min: 0.1, max: 5, step: 0.05 },
  explosionRadius: { label: '爆炸半徑 m', min: 0.3, max: 8, step: 0.1 },
};

export const FLASH_PANEL: ConfigSchema<TargetFlashConfig> = {
  intensity: { label: '命中閃白強度', min: 0, max: 5, step: 0.05 },
  duration: { label: '閃白時間 s', min: 0.01, max: 1, step: 0.01 },
};

// ── 擺放（訓練場）─────────────────────────────────────────

export interface DummyPlacement {
  id: string;
  /** 腳底位置（地面 y = 0）。 */
  pos: readonly [number, number, number];
  /** 面向（度；0 = 面向 +Z，也就是射擊線）。 */
  yaw: number;
}

export interface RailPlacement {
  id: string;
  /** 軌道的 z、y 與 x 範圍。 */
  z: number;
  y: number;
  xMin: number;
  xMax: number;
}

export interface TargetLayout {
  dummies: readonly DummyPlacement[];
  rails: readonly RailPlacement[];
  /** 無人機戰區（範圍與待命位置）。zoneId 為 TRAINING_ZONES 的區域 id，玩家在區內才啟動。 */
  arena: {
    zoneId: string;
    min: readonly [number, number, number];
    max: readonly [number, number, number];
    /** 無人機的待命點（戰區北側上空，依數量取前 n 個）。 */
    home: readonly (readonly [number, number, number])[];
  };
  /** DPS 計看板：中心位置、面向（度）、寬高（m）。 */
  board: { pos: readonly [number, number, number]; yaw: number; width: number; height: number };
}

const FZ = RANGE_FIRING_LINE_Z;

/** 訓練場的靶標擺放：靶場（射擊線 z = 40）的 10／25／50／75 m 假人與兩條移動靶軌道、戰區的無人機。 */
export const TRAINING_TARGET_LAYOUT: TargetLayout = {
  dummies: [
    { id: 'dummy-10a', pos: [-74, 0, FZ - 10], yaw: 0 },
    { id: 'dummy-10b', pos: [-55, 0, FZ - 10], yaw: 0 },
    { id: 'dummy-25', pos: [-60, 0, FZ - 25], yaw: 0 },
    { id: 'dummy-50', pos: [-68, 0, FZ - 50], yaw: 0 },
    { id: 'dummy-75', pos: [-62, 0, FZ - 75], yaw: 0 },
  ],
  rails: [
    { id: 'mover-18', z: FZ - 18, y: 0, xMin: -77, xMax: -53 },
    { id: 'mover-40', z: FZ - 40, y: 0, xMin: -77, xMax: -53 },
  ],
  arena: {
    zoneId: 'arena',
    min: [23, 1, -31],
    max: [77, 20, 21],
    home: [
      [36, 8, -26],
      [50, 9, -27],
      [64, 8, -26],
      [43, 10, -20],
      [57, 10, -20],
      [70, 9, -14],
    ],
  },
  board: { pos: [-64, 7.6, FZ - 14], yaw: 0, height: 3, width: 6 },
};
