// Viewmodel 的表現數值（M1-11）：集中在 VIEWMODEL_CONFIG，Viewmodel 每個畫面讀取最新值；
// VIEWMODEL_PANEL 列出每個欄位的範圍與說明（調參面板「武器表現/槍模…」）。
// 每把武器自己的數值在 WeaponDef：後座踢動 feel.viewKick／kickSpring、開鏡對位 model.adsOffset、換彈時間 ammo.reload*。
// 單位：公尺（viewmodel 相機空間：x 右、y 上、-z 前）、度、秒、Hz（彈簧的自然頻率）。
import type { ConfigSchema } from '@/debug/DebugPanel';

export type Vec3Tuple = [number, number, number];

export interface ViewmodelConfig {
  // ── 相機與擺位 ──
  /** viewmodel 相機的垂直 FOV（度，固定，不受世界 FOV 與開鏡縮放影響）。 */
  fov: number;
  /** 開鏡完成時 viewmodel 相機的垂直 FOV（度；略小 = 槍稍微放大）。 */
  adsFov: number;
  /** 腰射位置（槍模原點＝握把，在相機空間的位置），依槍身類型。 */
  hipRifle: Vec3Tuple;
  hipShotgun: Vec3Tuple;
  hipPistol: Vec3Tuple;
  hipSniper: Vec3Tuple;
  hipLauncher: Vec3Tuple;
  /** 開鏡時瞄具與眼睛的距離（m），依瞄具類型。 */
  eyeReliefIron: number;
  eyeReliefReflex: number;
  eyeReliefScope: number;
  /** 開鏡曲線：0 = 線性、1 = smoothstep。 */
  adsEase: number;
  /** 開鏡時移動類動作（擺動、晃動、姿勢）的保留比例。 */
  adsMotionMult: number;

  // ── 擺動（滑鼠位移的反向延遲）──
  /** 每「度／秒」視角速度造成的擺動角度（度）。 */
  swayPerDegPerSec: number;
  /** 擺動上限（度）。 */
  swayMaxDeg: number;
  /** 擺動彈簧（Hz、阻尼比）。 */
  swayFrequency: number;
  swayDamping: number;
  /** 擺動角度轉成位移（m／度）。 */
  swayPosPerDeg: number;
  /** 擺動的 roll（度／度 yaw 擺動）。 */
  swayRollPerDeg: number;

  // ── 移動晃動（8 字形）──
  /** 參考速度（m/s）時的幅度：左右、上下（m）與 roll（度）。 */
  bobX: number;
  bobY: number;
  bobRollDeg: number;
  /** 每步距離（m）：相位每步前進半圈；衝刺時另外乘 sprintBobStrideMult。 */
  bobStride: number;
  bobReferenceSpeed: number;
  bobMaxScale: number;
  /** 衝刺時的幅度倍率與步距倍率。 */
  sprintBobMult: number;
  sprintBobStrideMult: number;
  /** 晃動淡入淡出（1/s）。 */
  bobBlend: number;
  /** 靜止呼吸：幅度（m）與頻率（Hz）。 */
  idleAmplitude: number;
  idleFrequency: number;

  // ── 姿勢 ──
  /** 姿勢權重彈簧（Hz，臨界阻尼）：衝刺、滑鏟、跑牆、空中、攀爬。 */
  poseFrequency: number;
  /** 衝刺：下壓並側轉。 */
  sprintPos: Vec3Tuple;
  sprintRot: Vec3Tuple;
  /** 滑鏟傾斜（度，roll）與位移。 */
  slideRollDeg: number;
  slidePos: Vec3Tuple;
  /** 跑牆：往牆外偏（m）與傾斜（度）。 */
  wallOffset: number;
  wallRollDeg: number;
  /** 空中微抬（m）與槍口上仰（度）。 */
  airLift: number;
  airPitchDeg: number;
  /** 攀爬：放低（m）與槍口下壓（度）。 */
  mantleDrop: number;
  mantlePitchDeg: number;
  /** 落地彈跳：每 m/s 落地速度的下沉（m），上限（m），彈簧（Hz、阻尼比）。 */
  landPerSpeed: number;
  landMax: number;
  landFrequency: number;
  landDamping: number;

  // ── 後座踢動 ──
  /** 開鏡時的踢動倍率。 */
  kickAdsMult: number;
  /** yaw 與 roll 隨機左右。 */
  kickRandomSide: boolean;
  /** 開火後發光條暗到此比例，在一個射擊間隔內恢復。 */
  glowFireDip: number;

  // ── 換彈（時間軸是換彈進度 0..1，依 reload* 縮放）──
  /** 槍身傾斜：roll（度）、pitch（度）、位移（m）。 */
  reloadRollDeg: number;
  reloadPitchDeg: number;
  reloadPos: Vec3Tuple;
  /** 關鍵影格（進度）：傾斜完成、彈匣拔出、彈匣掉出、新彈匣出現、插入、上膛開始、上膛結束、回正開始。 */
  reloadTiltIn: number;
  reloadMagOut: number;
  reloadMagDrop: number;
  reloadMagShow: number;
  reloadMagSeat: number;
  reloadChargeStart: number;
  reloadChargeEnd: number;
  reloadTiltOut: number;
  /** 彈匣拔出的距離與掉落距離（m，往下）。 */
  magPullDistance: number;
  magDropDistance: number;
  /** 上膛時的後拉（m）與 pitch 跳動（度）；戰術換彈的上膛倍率。 */
  chargeKick: number;
  chargePitchDeg: number;
  tacticalChargeMult: number;
  /** 逐發裝填：傾斜（roll 度）、每發的推入（m）。 */
  shellRollDeg: number;
  shellPos: Vec3Tuple;
  shellPush: number;
  /** 換彈姿勢被打斷時的淡出（1/s）。 */
  reloadBlendOut: number;

  // ── 霰彈泵動 ──
  /** 泵動護木後拉距離（m）與時間點（射擊間隔的比例：開始、拉到底、推回）。 */
  pumpTravel: number;
  pumpStart: number;
  pumpMid: number;
  pumpEnd: number;

  // ── 切槍與近戰 ──
  /** 切槍放下：下移（m）、槍口下壓（度）、roll（度）。 */
  swapDrop: number;
  swapPitchDeg: number;
  swapRollDeg: number;
  /** 近戰前刺：前推（m）、yaw（度，往左）、roll（度）、命中瞬間的峰值位置（動作比例）。 */
  meleeThrust: number;
  meleeYawDeg: number;
  meleeRollDeg: number;
  meleePeak: number;

  // ── 狙擊鏡 ──
  /** 開鏡進度達到此值時顯示瞄準鏡遮罩並隱藏 viewmodel（瞄具為 scope 的武器）。 */
  scopeThreshold: number;
  /** 遮罩淡入的範圍（開鏡進度）。 */
  scopeFade: number;

  // ── 槍口閃光（viewmodel 場景內）──
  /** viewmodel 場景點光源的最大亮度與距離（m）。 */
  flashLightIntensity: number;
  flashLightDistance: number;
  /** viewmodel 場景的半球光與方向光倍率（顏色與方向取自世界燈光）。 */
  hemiScale: number;
  sunScale: number;
}

export const VIEWMODEL_CONFIG: ViewmodelConfig = {
  fov: 60,
  adsFov: 54,
  hipRifle: [0.17, -0.19, -0.34],
  hipShotgun: [0.17, -0.19, -0.32],
  hipPistol: [0.15, -0.17, -0.4],
  hipSniper: [0.17, -0.19, -0.34],
  hipLauncher: [0.18, -0.2, -0.34],
  eyeReliefIron: 0.2,
  eyeReliefReflex: 0.2,
  eyeReliefScope: 0.1,
  adsEase: 1,
  adsMotionMult: 0.18,

  swayPerDegPerSec: 0.012,
  swayMaxDeg: 4,
  swayFrequency: 5,
  swayDamping: 0.75,
  swayPosPerDeg: 0.004,
  swayRollPerDeg: 0.6,

  bobX: 0.008,
  bobY: 0.006,
  bobRollDeg: 0.6,
  bobStride: 2.4,
  bobReferenceSpeed: 7.5,
  bobMaxScale: 1.6,
  sprintBobMult: 1.6,
  sprintBobStrideMult: 1.15,
  bobBlend: 8,
  idleAmplitude: 0.0015,
  idleFrequency: 0.3,

  poseFrequency: 4,
  sprintPos: [0.02, -0.045, 0.03],
  sprintRot: [-14, 22, 12],
  slideRollDeg: 15,
  slidePos: [-0.02, -0.02, 0.01],
  wallOffset: 0.035,
  wallRollDeg: 6,
  airLift: 0.012,
  airPitchDeg: 2,
  mantleDrop: 0.12,
  mantlePitchDeg: -25,
  landPerSpeed: 0.0016,
  landMax: 0.035,
  landFrequency: 6,
  landDamping: 0.45,

  kickAdsMult: 0.45,
  kickRandomSide: true,
  glowFireDip: 0.25,

  reloadRollDeg: -24,
  reloadPitchDeg: 10,
  reloadPos: [-0.03, 0.02, 0.02],
  reloadTiltIn: 0.15,
  reloadMagOut: 0.28,
  reloadMagDrop: 0.42,
  reloadMagShow: 0.48,
  reloadMagSeat: 0.66,
  reloadChargeStart: 0.72,
  reloadChargeEnd: 0.86,
  reloadTiltOut: 0.84,
  magPullDistance: 0.07,
  magDropDistance: 0.45,
  chargeKick: 0.025,
  chargePitchDeg: 4,
  tacticalChargeMult: 0.4,
  shellRollDeg: 18,
  shellPos: [-0.02, 0.015, 0.01],
  shellPush: 0.025,
  reloadBlendOut: 10,

  pumpTravel: 0.06,
  pumpStart: 0.18,
  pumpMid: 0.36,
  pumpEnd: 0.58,

  swapDrop: 0.28,
  swapPitchDeg: -40,
  swapRollDeg: 15,
  meleeThrust: 0.2,
  meleeYawDeg: 12,
  meleeRollDeg: -25,
  meleePeak: 0.3,

  scopeThreshold: 0.94,
  scopeFade: 0.08,

  flashLightIntensity: 3,
  flashLightDistance: 1.5,
  hemiScale: 1,
  sunScale: 0.8,
};

const p3 = (label: string, min: number, max: number, step: number): { label: string; params: Record<string, unknown> } => ({
  label,
  params: { x: { min, max, step }, y: { min, max, step }, z: { min, max, step } },
});

/** 面板分組。Vec3 欄位以 { x, y, z } 代理（見 ViewmodelPanel）。 */
export const VIEWMODEL_PANEL: readonly { folder: string; schema: ConfigSchema<ViewmodelConfig>; vectors?: readonly (keyof ViewmodelConfig)[] }[] = [
  {
    folder: '武器表現/槍模擺位',
    schema: {
      fov: { label: 'FOV°（固定）', min: 30, max: 90, step: 1, description: 'viewmodel 相機垂直 FOV；不受世界 FOV 影響' },
      adsFov: { label: '開鏡 FOV°', min: 30, max: 90, step: 1 },
      eyeReliefIron: { label: '機瞄眼距 m', min: 0.05, max: 0.5, step: 0.005 },
      eyeReliefReflex: { label: '紅點眼距 m', min: 0.05, max: 0.5, step: 0.005 },
      eyeReliefScope: { label: '狙擊鏡眼距 m', min: 0.02, max: 0.5, step: 0.005 },
      adsEase: { label: '開鏡曲線', min: 0, max: 1, step: 0.05, description: '0 = 線性、1 = smoothstep' },
      adsMotionMult: { label: '開鏡動作保留', min: 0, max: 1, step: 0.01, description: '擺動、晃動、姿勢的保留比例' },
    },
    vectors: ['hipRifle', 'hipShotgun', 'hipPistol', 'hipSniper', 'hipLauncher'],
  },
  {
    folder: '武器表現/擺動與晃動',
    schema: {
      swayPerDegPerSec: { label: '擺動 °/(°/s)', min: 0, max: 0.05, step: 0.0005 },
      swayMaxDeg: { label: '擺動上限°', min: 0, max: 15, step: 0.1 },
      swayFrequency: { label: '擺動彈簧 Hz', min: 0.5, max: 20, step: 0.1 },
      swayDamping: { label: '擺動阻尼', min: 0.1, max: 2, step: 0.05 },
      swayPosPerDeg: { label: '擺動位移 m/°', min: 0, max: 0.02, step: 0.0005 },
      swayRollPerDeg: { label: '擺動 roll', min: 0, max: 3, step: 0.05 },
      bobX: { label: '晃動 左右 m', min: 0, max: 0.05, step: 0.0005 },
      bobY: { label: '晃動 上下 m', min: 0, max: 0.05, step: 0.0005 },
      bobRollDeg: { label: '晃動 roll°', min: 0, max: 5, step: 0.05 },
      bobStride: { label: '步距 m', min: 0.5, max: 6, step: 0.1 },
      bobReferenceSpeed: { label: '參考速度 m/s', min: 1, max: 20, step: 0.5 },
      bobMaxScale: { label: '幅度上限倍率', min: 0, max: 4, step: 0.05 },
      sprintBobMult: { label: '衝刺幅度倍率', min: 0, max: 4, step: 0.05 },
      sprintBobStrideMult: { label: '衝刺步距倍率', min: 0.5, max: 2, step: 0.05 },
      bobBlend: { label: '淡入淡出 1/s', min: 0.5, max: 40, step: 0.5 },
      idleAmplitude: { label: '呼吸幅度 m', min: 0, max: 0.01, step: 0.0001 },
      idleFrequency: { label: '呼吸 Hz', min: 0.05, max: 2, step: 0.01 },
    },
  },
  {
    folder: '武器表現/姿勢',
    schema: {
      poseFrequency: { label: '姿勢彈簧 Hz', min: 0.5, max: 20, step: 0.1 },
      slideRollDeg: { label: '滑鏟傾斜°', min: -45, max: 45, step: 0.5 },
      wallOffset: { label: '跑牆外偏 m', min: 0, max: 0.2, step: 0.001 },
      wallRollDeg: { label: '跑牆傾斜°', min: 0, max: 30, step: 0.5 },
      airLift: { label: '空中微抬 m', min: 0, max: 0.1, step: 0.001 },
      airPitchDeg: { label: '空中上仰°', min: -15, max: 15, step: 0.1 },
      mantleDrop: { label: '攀爬放低 m', min: 0, max: 0.4, step: 0.005 },
      mantlePitchDeg: { label: '攀爬下壓°', min: -60, max: 0, step: 0.5 },
      landPerSpeed: { label: '落地 m/(m/s)', min: 0, max: 0.01, step: 0.0001 },
      landMax: { label: '落地上限 m', min: 0, max: 0.15, step: 0.001 },
      landFrequency: { label: '落地彈簧 Hz', min: 0.5, max: 20, step: 0.1 },
      landDamping: { label: '落地阻尼', min: 0.05, max: 2, step: 0.05 },
    },
    vectors: ['sprintPos', 'sprintRot', 'slidePos'],
  },
  {
    folder: '武器表現/後座、換彈與動作',
    schema: {
      kickAdsMult: { label: '開鏡踢動倍率', min: 0, max: 2, step: 0.01 },
      kickRandomSide: { label: 'yaw／roll 隨機左右' },
      glowFireDip: { label: '開火發光暗到', min: 0, max: 1, step: 0.01 },
      reloadRollDeg: { label: '換彈 roll°', min: -60, max: 60, step: 0.5 },
      reloadPitchDeg: { label: '換彈 pitch°', min: -40, max: 40, step: 0.5 },
      reloadTiltIn: { label: '影格：傾斜完成', min: 0, max: 1, step: 0.01 },
      reloadMagOut: { label: '影格：彈匣拔出', min: 0, max: 1, step: 0.01 },
      reloadMagDrop: { label: '影格：彈匣掉出', min: 0, max: 1, step: 0.01 },
      reloadMagShow: { label: '影格：新彈匣出現', min: 0, max: 1, step: 0.01 },
      reloadMagSeat: { label: '影格：插入完成', min: 0, max: 1, step: 0.01 },
      reloadChargeStart: { label: '影格：上膛開始', min: 0, max: 1, step: 0.01 },
      reloadChargeEnd: { label: '影格：上膛結束', min: 0, max: 1, step: 0.01 },
      reloadTiltOut: { label: '影格：回正開始', min: 0, max: 1, step: 0.01 },
      magPullDistance: { label: '彈匣拔出 m', min: 0, max: 0.3, step: 0.005 },
      magDropDistance: { label: '彈匣掉落 m', min: 0, max: 1, step: 0.01 },
      chargeKick: { label: '上膛後拉 m', min: 0, max: 0.1, step: 0.001 },
      chargePitchDeg: { label: '上膛跳動°', min: 0, max: 20, step: 0.1 },
      tacticalChargeMult: { label: '戰術上膛倍率', min: 0, max: 1, step: 0.05 },
      shellRollDeg: { label: '逐發 roll°', min: -45, max: 45, step: 0.5 },
      shellPush: { label: '逐發推入 m', min: 0, max: 0.1, step: 0.001 },
      reloadBlendOut: { label: '中斷淡出 1/s', min: 1, max: 40, step: 0.5 },
      pumpTravel: { label: '泵動行程 m', min: 0, max: 0.2, step: 0.001 },
      pumpStart: { label: '泵動開始', min: 0, max: 1, step: 0.01 },
      pumpMid: { label: '泵動拉到底', min: 0, max: 1, step: 0.01 },
      pumpEnd: { label: '泵動推回', min: 0, max: 1, step: 0.01 },
      swapDrop: { label: '切槍下移 m', min: 0, max: 1, step: 0.01 },
      swapPitchDeg: { label: '切槍下壓°', min: -90, max: 0, step: 0.5 },
      swapRollDeg: { label: '切槍 roll°', min: -45, max: 45, step: 0.5 },
      meleeThrust: { label: '近戰前推 m', min: 0, max: 0.6, step: 0.005 },
      meleeYawDeg: { label: '近戰 yaw°', min: -45, max: 45, step: 0.5 },
      meleeRollDeg: { label: '近戰 roll°', min: -60, max: 60, step: 0.5 },
      meleePeak: { label: '近戰峰值', min: 0.05, max: 0.95, step: 0.01, description: '動作比例（命中判定 0.12 / 0.4 = 0.3）' },
    },
    vectors: ['reloadPos', 'shellPos'],
  },
  {
    folder: '武器表現/狙擊鏡與燈光',
    schema: {
      scopeThreshold: { label: '狙擊鏡出現', min: 0.5, max: 1, step: 0.01, description: '開鏡進度' },
      scopeFade: { label: '遮罩淡入', min: 0.001, max: 0.5, step: 0.005 },
      flashLightIntensity: { label: '槍模閃光亮度', min: 0, max: 30, step: 0.1 },
      flashLightDistance: { label: '槍模閃光距離 m', min: 0.1, max: 10, step: 0.1 },
      hemiScale: { label: '槍模半球光倍率', min: 0, max: 3, step: 0.05 },
      sunScale: { label: '槍模方向光倍率', min: 0, max: 3, step: 0.05 },
    },
  },
];

export { p3 as vectorParams };

/** 預設值的深複製（測試用）。 */
export function defaultViewmodelConfig(): ViewmodelConfig {
  return JSON.parse(JSON.stringify(VIEWMODEL_CONFIG)) as ViewmodelConfig;
}
