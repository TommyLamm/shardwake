// 鏡頭手感的可調數值（M1-08）：集中在 CAMERA_CONFIG，CameraRig 每個畫面讀取最新值；
// CAMERA_PANEL 列出每個欄位的範圍與說明，依資料夾分組（調參面板「鏡頭」）。
// 玩家可調的開關與強度（動態 FOV、傾斜強度、落地下沉、頭部晃動、震動強度、速度線）在 Settings。
// 單位：公尺、秒、m/s；角度一律用「度」，程式內再換成弧度；頻率為 Hz（彈簧的自然頻率）。
import type { ConfigSchema } from '@/debug/DebugPanel';

export interface CameraConfig {
  // ── 眼高與平滑 ──
  /** 眼高彈簧頻率（Hz，臨界阻尼）：蹲、滑鏟、起身時平滑眼高。 */
  eyeHeightFrequency: number;
  /** 攀爬時垂直位置的跟隨彈簧頻率（Hz，臨界阻尼）；鏡頭落後再追上，避免往上「彈」。 */
  mantleSmoothFrequency: number;
  /** 單一畫面眼睛位移超過此距離（m）視為傳送：所有彈簧與效果直接到位。 */
  teleportSnapDistance: number;
  /** 最終 pitch 上限（度）：視角加上鏡頭效果後夾住，避免翻轉。 */
  maxPitchDeg: number;

  // ── FOV ──
  /** 速度對應：水平速度 fovSpeedMin → fovSpeedMax（m/s）對應 +0 → +fovSpeedBonus（水平度）。 */
  fovSpeedMin: number;
  fovSpeedMax: number;
  fovSpeedBonus: number;
  /** 抓鉤附著中的額外 FOV（水平度）。 */
  fovGrappleBonus: number;
  /** Dash 衝擊：+fovDashKick（水平度），fovKickAttack 內升起，fovDashKickTime 內回落。 */
  fovDashKick: number;
  fovDashKickTime: number;
  /** FOV 衝擊升起時間（s）；addFovKick 共用。 */
  fovKickAttack: number;
  /** 速度與抓鉤 FOV 的平滑（damp 的 lambda，1/s；越大越跟手）。 */
  fovSmoothing: number;
  /** 動態 FOV 的水平上限（度）。 */
  maxHorizontalFov: number;
  /** 垂直 FOV 上限（度）：直向或很窄的畫面時夾住，避免魚眼。 */
  maxVerticalFov: number;

  // ── 傾斜（roll）──
  /** 跑牆傾斜（度，朝牆外）。 */
  wallRunRollDeg: number;
  /** 滑鏟傾斜（度）。 */
  slideRollDeg: number;
  /** 滑鏟傾斜方向：1 = 往左傾、-1 = 往右傾。 */
  slideRollSide: number;
  /** 側移傾斜（度，往移動方向傾）；側向速度達 strafeRollSpeed（m/s）時為滿值。 */
  strafeRollDeg: number;
  strafeRollSpeed: number;
  /** 側向 Dash 的傾斜衝量（度，往 Dash 方向傾）；Dash 方向的側向分量低於 dashRollMinLateral 時不傾斜。 */
  dashRollDeg: number;
  dashRollMinLateral: number;
  /** 狀態傾斜的彈簧頻率（Hz）與阻尼比。 */
  rollFrequency: number;
  rollDampingRatio: number;
  /** addRollImpulse 的彈簧頻率（Hz，臨界阻尼）：衝量的峰值約等於指定角度。 */
  rollImpulseFrequency: number;

  // ── 落地 ──
  /** 落地速度 landMinImpact → landMaxImpact（m/s）對應下沉 0 → landMaxDip（m）。 */
  landMinImpact: number;
  landMaxImpact: number;
  landMaxDip: number;
  /** 下沉到最深時的往下點頭（度）。 */
  landNodDeg: number;
  /** 落地彈簧頻率（Hz）與阻尼比（< 1 會回彈）。 */
  landFrequency: number;
  landDampingRatio: number;
  /** 重落地震動：落地速度 heavyLandMinSpeed → heavyLandMaxSpeed 對應 trauma heavyLandTraumaMin → Max。 */
  heavyLandMinSpeed: number;
  heavyLandMaxSpeed: number;
  heavyLandTraumaMin: number;
  heavyLandTraumaMax: number;

  // ── 頭部晃動 ──
  /** 晃動幅度（m，±）在 bobReferenceSpeed（m/s，衝刺速度）時的值；幅度與速度成正比。 */
  bobVertical: number;
  bobHorizontal: number;
  bobReferenceSpeed: number;
  /** 幅度倍率上限（比參考速度快時）。 */
  bobMaxScale: number;
  /** 每走這段距離（m）一步（垂直擺動一個週期；水平擺動兩步一個週期）。 */
  bobStride: number;
  /** 著地／離地時晃動的淡入淡出（damp 的 lambda，1/s）。 */
  bobBlend: number;

  // ── 創傷式震動 ──
  /** trauma 每秒衰減量（trauma 範圍 0..1）。 */
  traumaDecay: number;
  /** 震動量 = trauma ^ traumaExponent。 */
  traumaExponent: number;
  /** 最大旋轉（度）與位移（m）。 */
  shakeYawDeg: number;
  shakePitchDeg: number;
  shakeRollDeg: number;
  shakeOffset: number;
  /** 雜訊頻率（Hz）。 */
  shakeFrequency: number;
}

export const CAMERA_CONFIG: CameraConfig = {
  eyeHeightFrequency: 9,
  mantleSmoothFrequency: 8,
  teleportSnapDistance: 6,
  maxPitchDeg: 89.5,

  fovSpeedMin: 10,
  fovSpeedMax: 22,
  fovSpeedBonus: 8,
  fovGrappleBonus: 4,
  fovDashKick: 10,
  fovDashKickTime: 0.3,
  fovKickAttack: 0.05,
  fovSmoothing: 6,
  maxHorizontalFov: 150,
  maxVerticalFov: 120,

  wallRunRollDeg: 12,
  slideRollDeg: 3,
  slideRollSide: 1,
  strafeRollDeg: 1,
  strafeRollSpeed: 7.5,
  dashRollDeg: 2,
  dashRollMinLateral: 0.3,
  rollFrequency: 2.5,
  rollDampingRatio: 1,
  rollImpulseFrequency: 4,

  landMinImpact: 3,
  landMaxImpact: 20,
  landMaxDip: 0.12,
  landNodDeg: 2,
  landFrequency: 8,
  landDampingRatio: 0.7,
  heavyLandMinSpeed: 15,
  heavyLandMaxSpeed: 25,
  heavyLandTraumaMin: 0.15,
  heavyLandTraumaMax: 0.45,

  bobVertical: 0.015,
  bobHorizontal: 0.008,
  bobReferenceSpeed: 10.5,
  bobMaxScale: 1.2,
  bobStride: 2.4,
  bobBlend: 10,

  traumaDecay: 1.2,
  traumaExponent: 2,
  shakeYawDeg: 1.5,
  shakePitchDeg: 1.5,
  shakeRollDeg: 2.5,
  shakeOffset: 0.04,
  shakeFrequency: 18,
};

export function defaultCameraConfig(): CameraConfig {
  return { ...CAMERA_CONFIG };
}

/** 調參面板「鏡頭」的分組。 */
export const CAMERA_PANEL: readonly { folder: string; schema: ConfigSchema<CameraConfig> }[] = [
  {
    folder: '鏡頭/FOV',
    schema: {
      fovSpeedMin: { label: '速度起點 m/s', min: 0, max: 40, step: 0.5, description: '水平速度從這裡開始放大 FOV' },
      fovSpeedMax: { label: '速度滿值 m/s', min: 1, max: 60, step: 0.5 },
      fovSpeedBonus: { label: '速度 FOV +°', min: 0, max: 30, step: 0.5, description: '水平度' },
      fovGrappleBonus: { label: '抓鉤 FOV +°', min: 0, max: 30, step: 0.5 },
      fovDashKick: { label: 'Dash 衝擊 +°', min: 0, max: 30, step: 0.5 },
      fovDashKickTime: { label: 'Dash 回落 s', min: 0.02, max: 2, step: 0.01 },
      fovKickAttack: { label: '衝擊升起 s', min: 0, max: 0.5, step: 0.01 },
      fovSmoothing: { label: '平滑 1/s', min: 0.5, max: 40, step: 0.5, description: '速度與抓鉤 FOV 的 damp lambda' },
      maxHorizontalFov: { label: '水平上限°', min: 90, max: 170, step: 1 },
      maxVerticalFov: { label: '垂直上限°', min: 60, max: 150, step: 1, description: '直向畫面時夾住' },
    },
  },
  {
    folder: '鏡頭/傾斜',
    schema: {
      wallRunRollDeg: { label: '跑牆°', min: 0, max: 30, step: 0.5, description: '朝牆外傾斜' },
      slideRollDeg: { label: '滑鏟°', min: 0, max: 15, step: 0.25 },
      slideRollSide: { label: '滑鏟方向', options: { 往左: 1, 往右: -1 } },
      strafeRollDeg: { label: '側移°', min: 0, max: 10, step: 0.1 },
      strafeRollSpeed: { label: '側移滿值 m/s', min: 0.5, max: 20, step: 0.5 },
      dashRollDeg: { label: '側向 Dash°', min: 0, max: 15, step: 0.25 },
      dashRollMinLateral: { label: 'Dash 側向門檻', min: 0, max: 1, step: 0.05 },
      rollFrequency: { label: '彈簧 Hz', min: 0.2, max: 20, step: 0.1 },
      rollDampingRatio: { label: '阻尼比', min: 0.1, max: 2, step: 0.05 },
      rollImpulseFrequency: { label: '衝量彈簧 Hz', min: 0.5, max: 20, step: 0.1 },
    },
  },
  {
    folder: '鏡頭/落地',
    schema: {
      landMinImpact: { label: '下沉起點 m/s', min: 0, max: 30, step: 0.5 },
      landMaxImpact: { label: '下沉滿值 m/s', min: 1, max: 60, step: 0.5 },
      landMaxDip: { label: '最大下沉 m', min: 0, max: 0.5, step: 0.005 },
      landNodDeg: { label: '點頭°', min: 0, max: 10, step: 0.1 },
      landFrequency: { label: '彈簧 Hz', min: 0.5, max: 30, step: 0.1 },
      landDampingRatio: { label: '阻尼比', min: 0.1, max: 2, step: 0.05 },
      heavyLandMinSpeed: { label: '重落地 m/s', min: 0, max: 60, step: 0.5, description: '超過時加入震動' },
      heavyLandMaxSpeed: { label: '重落地滿值 m/s', min: 1, max: 80, step: 0.5 },
      heavyLandTraumaMin: { label: '重落地 trauma 起', min: 0, max: 1, step: 0.01 },
      heavyLandTraumaMax: { label: '重落地 trauma 滿', min: 0, max: 1, step: 0.01 },
    },
  },
  {
    folder: '鏡頭/頭部晃動',
    schema: {
      bobVertical: { label: '垂直 ±m', min: 0, max: 0.1, step: 0.001, description: '參考速度時的幅度' },
      bobHorizontal: { label: '水平 ±m', min: 0, max: 0.1, step: 0.001 },
      bobReferenceSpeed: { label: '參考速度 m/s', min: 1, max: 30, step: 0.5 },
      bobMaxScale: { label: '幅度上限倍率', min: 0, max: 3, step: 0.05 },
      bobStride: { label: '步距 m', min: 0.5, max: 6, step: 0.1 },
      bobBlend: { label: '淡入淡出 1/s', min: 0.5, max: 40, step: 0.5 },
    },
  },
  {
    folder: '鏡頭/震動',
    schema: {
      traumaDecay: { label: 'trauma 衰減 /s', min: 0.05, max: 10, step: 0.05 },
      traumaExponent: { label: '指數', min: 1, max: 4, step: 0.1, description: '震動量 = trauma^指數' },
      shakeYawDeg: { label: 'yaw°', min: 0, max: 10, step: 0.1 },
      shakePitchDeg: { label: 'pitch°', min: 0, max: 10, step: 0.1 },
      shakeRollDeg: { label: 'roll°', min: 0, max: 15, step: 0.1 },
      shakeOffset: { label: '位移 m', min: 0, max: 0.3, step: 0.005 },
      shakeFrequency: { label: '頻率 Hz', min: 1, max: 60, step: 0.5 },
    },
  },
  {
    folder: '鏡頭/眼高與平滑',
    schema: {
      eyeHeightFrequency: { label: '眼高彈簧 Hz', min: 1, max: 40, step: 0.5, description: '蹲、滑鏟、起身' },
      mantleSmoothFrequency: { label: '攀爬跟隨 Hz', min: 1, max: 40, step: 0.5 },
      teleportSnapDistance: { label: '傳送判定 m', min: 1, max: 50, step: 0.5 },
      maxPitchDeg: { label: 'pitch 上限°', min: 60, max: 89.9, step: 0.1 },
    },
  },
];
