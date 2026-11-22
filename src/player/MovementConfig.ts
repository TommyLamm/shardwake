// 移動手感數值（M1-05；M1-06／M1-07 在同一個檔案擴充）。
// - MOVEMENT_CONFIG 是可變物件：PlayerController 每步讀取最新值，調參面板直接改寫欄位即可生效。
// - MOVEMENT_PANEL 列出每個欄位的範圍、步進與說明文字，依資料夾分組（調參面板「移動」）。
// - 單位：公尺、秒、m/s、m/s²；角度一律用「度」（面板好讀），程式內再換成弧度。
// - 跳躍初速不是參數：由 jumpHeight 與 gravity 反推（v = √(2 g h)），改重力不會改跳躍高度。
import type { ConfigSchema } from '@/debug/DebugPanel';

export interface MovementConfig {
  // ── 膠囊體與角色控制器 ──
  /** 站姿膠囊總高（m）。 */
  standHeight: number;
  /** 蹲姿膠囊總高（m）。 */
  crouchHeight: number;
  /** 膠囊半徑（m）。 */
  radius: number;
  /** 站姿眼高（腳底以上，m）。 */
  standEyeHeight: number;
  /** 蹲姿眼高（m）。 */
  crouchEyeHeight: number;
  /** 站↔蹲的膠囊高度過渡時間（s）。 */
  crouchTransitionTime: number;
  /** KinematicCharacterController 與周圍保持的間隙（m）。 */
  skinOffset: number;
  /** 自動跨上台階的最大高度（m）。 */
  autostepHeight: number;
  /** 跨上台階後需要的最小平面寬度（m）。 */
  autostepMinWidth: number;
  /** 貼地距離（m）：在地面上時，離地小於此距離會被吸回地面（下坡、下台階不騰空）。 */
  snapToGround: number;
  /** 能走上去的最大坡度（度）；也是地面探測判斷「可站立」的上限。 */
  maxSlopeClimbDeg: number;
  /** 超過此坡度會自動往下滑（度）。 */
  minSlopeSlideDeg: number;
  /** 地面探測距離（m）：腳底下方這個距離內有可站立的面就算著地。 */
  groundProbeDistance: number;

  // ── 地面 ──
  /** 跑速（m/s）。 */
  runSpeed: number;
  /** 衝刺速度（m/s）。 */
  sprintSpeed: number;
  /** 自動衝刺：輸入方向在正前方 ± 此角度內才衝刺（度）。 */
  sprintConeDeg: number;
  /** 蹲走速度（m/s）。 */
  crouchSpeed: number;
  /** 地面加速（Source accelerate 係數）。 */
  groundAccel: number;
  /** 地面摩擦（Source friction 係數，1/s）。 */
  friction: number;
  /** 摩擦的最低計算速度（m/s）：速度低於此值時以此值計算摩擦，放開後停得乾脆。 */
  stopSpeed: number;
  /** 落地後幾步不套摩擦（保留連跳動量）。 */
  landingFrictionGraceSteps: number;

  // ── 跳躍 ──
  /** 跳躍高度（m）。 */
  jumpHeight: number;
  /** 玩家重力（m/s²）。 */
  gravity: number;
  /** 土狼時間（s）：走出平台後仍可起跳的時間。 */
  coyoteTime: number;
  /** 跳躍緩衝（s）：落地前按跳，落地時自動起跳。 */
  jumpBufferTime: number;
  /** 斜坡起跳方向：0 = 正上方、1 = 地面法線。 */
  jumpNormalBlend: number;
  /** 最大下落速度（m/s）。 */
  maxFallSpeed: number;

  // ── 空中 ──
  /** 空中加速（Quake air accelerate 係數）。 */
  airAccel: number;
  /** 空中加速的 wishSpeed 上限（m/s）：只在這個速度以內補速度，air strafe 靠它增速。 */
  airWishSpeedCap: number;
  /** 空中控制：每秒把水平速度往輸入方向旋轉的角度（度/s，不增速）。 */
  airControlDegPerSec: number;
  /** 空中水平速度軟上限（m/s）。 */
  airSpeedSoftCap: number;
  /** 超過軟上限部分的阻力（1/s）。 */
  airOverspeedDrag: number;

  // ── 蹲與滑鏟 ──
  /** 進入滑鏟的最低水平速度（m/s）。 */
  slideMinSpeed: number;
  /** 滑鏟推進（m/s）。 */
  slideBoost: number;
  /** 推進冷卻（s）：冷卻中進入滑鏟只滑不加速。 */
  slideBoostCooldown: number;
  /** 推進後的速度上限（m/s）：已經比這快時不再推進，避免連續滑鏟無限加速。 */
  slideBoostMaxSpeed: number;
  /** 滑鏟摩擦（1/s，與速度成正比）。 */
  slideFriction: number;
  /** 下坡時滑鏟摩擦的倍率（坡度達 slideDownhillFullDeg 時完整套用）。 */
  slideDownhillFrictionScale: number;
  /** 下坡摩擦倍率完整套用的坡度（度）；平地到此坡度之間線性過渡。 */
  slideDownhillFullDeg: number;
  /** 坡度加速倍率（× 重力沿坡面分量）。 */
  slideSlopeFactor: number;
  /** 滑鏟轉向速率（度/s）。 */
  slideSteerDegPerSec: number;
  /** 速度低於此值時結束滑鏟（m/s）。 */
  slideEndSpeed: number;

  // ── 腳步 ──
  /** 每走多少公尺發一次腳步事件（m）。 */
  footstepStride: number;
}

export const MOVEMENT_CONFIG: MovementConfig = {
  standHeight: 1.8,
  crouchHeight: 1.0,
  radius: 0.35,
  standEyeHeight: 1.65,
  crouchEyeHeight: 0.95,
  crouchTransitionTime: 0.12,
  skinOffset: 0.01,
  autostepHeight: 0.35,
  autostepMinWidth: 0.15,
  snapToGround: 0.3,
  maxSlopeClimbDeg: 50,
  minSlopeSlideDeg: 55,
  groundProbeDistance: 0.08,

  runSpeed: 7.5,
  sprintSpeed: 10.5,
  sprintConeDeg: 50,
  crouchSpeed: 3.5,
  groundAccel: 12,
  friction: 6,
  stopSpeed: 4,
  landingFrictionGraceSteps: 1,

  jumpHeight: 1.3,
  gravity: 24,
  coyoteTime: 0.12,
  jumpBufferTime: 0.15,
  jumpNormalBlend: 0.25,
  maxFallSpeed: 60,

  airAccel: 2.5,
  airWishSpeedCap: 1.2,
  airControlDegPerSec: 45,
  airSpeedSoftCap: 22,
  airOverspeedDrag: 2,

  slideMinSpeed: 7,
  slideBoost: 3.5,
  slideBoostCooldown: 1.2,
  slideBoostMaxSpeed: 15,
  slideFriction: 0.8,
  slideDownhillFrictionScale: 0.25,
  slideDownhillFullDeg: 10,
  slideSlopeFactor: 1.0,
  slideSteerDegPerSec: 90,
  slideEndSpeed: 4.5,

  footstepStride: 2.4,
};

/** 預設值的複本（重設、測試用）。 */
export function defaultMovementConfig(): MovementConfig {
  return { ...MOVEMENT_CONFIG_DEFAULTS };
}

const MOVEMENT_CONFIG_DEFAULTS: Readonly<MovementConfig> = Object.freeze({ ...MOVEMENT_CONFIG });

/** 調參面板分組：資料夾路徑（「移動/…」）與欄位規格。 */
export const MOVEMENT_PANEL: readonly { folder: string; schema: ConfigSchema<MovementConfig> }[] = [
  {
    folder: '移動/地面',
    schema: {
      runSpeed: { label: '跑速', min: 1, max: 20, step: 0.1, description: 'm/s' },
      sprintSpeed: { label: '衝刺速度', min: 1, max: 25, step: 0.1, description: 'm/s；自動衝刺或按住衝刺鍵' },
      sprintConeDeg: { label: '衝刺角度±°', min: 0, max: 90, step: 1, description: '輸入方向在正前方 ± 此角度內才衝刺' },
      crouchSpeed: { label: '蹲走速度', min: 0.5, max: 10, step: 0.1, description: 'm/s' },
      groundAccel: { label: '加速', min: 1, max: 40, step: 0.5, description: 'Source accelerate：每秒最多補 加速 × 目標速度' },
      friction: { label: '摩擦', min: 0, max: 20, step: 0.1, description: 'Source friction（1/s）' },
      stopSpeed: { label: 'stopSpeed', min: 0, max: 10, step: 0.1, description: 'm/s；低速時以此值計算摩擦，放開後停得乾脆' },
      landingFrictionGraceSteps: { label: '落地免摩擦步數', min: 0, max: 10, step: 1, description: '保留連跳動量' },
    },
  },
  {
    folder: '移動/跳躍',
    schema: {
      jumpHeight: { label: '跳躍高度', min: 0.2, max: 4, step: 0.05, description: 'm；初速由高度與重力反推' },
      gravity: { label: '重力', min: 1, max: 80, step: 0.5, description: 'm/s²（玩家專用，不影響動態物件）' },
      coyoteTime: { label: '土狼時間', min: 0, max: 0.5, step: 0.01, description: 's；走出平台後仍可起跳' },
      jumpBufferTime: { label: '跳躍緩衝', min: 0, max: 0.5, step: 0.01, description: 's；落地前按跳，落地時起跳' },
      jumpNormalBlend: { label: '斜坡起跳法線比例', min: 0, max: 1, step: 0.05, description: '0 = 正上方、1 = 地面法線' },
      maxFallSpeed: { label: '最大下落速度', min: 5, max: 200, step: 1, description: 'm/s' },
    },
  },
  {
    folder: '移動/空中',
    schema: {
      airAccel: { label: '空中加速', min: 0, max: 20, step: 0.1, description: 'Quake air accelerate 係數' },
      airWishSpeedCap: { label: 'wishSpeed 上限', min: 0, max: 10, step: 0.05, description: 'm/s；air strafe 增速的關鍵' },
      airControlDegPerSec: { label: '空中控制°/s', min: 0, max: 360, step: 5, description: '每秒把水平速度往輸入方向旋轉的角度（不增速）' },
      airSpeedSoftCap: { label: '水平軟上限', min: 5, max: 60, step: 0.5, description: 'm/s；空中與滑鏟' },
      airOverspeedDrag: { label: '超速阻力', min: 0, max: 10, step: 0.1, description: '1/s；只作用在超過軟上限的部分' },
    },
  },
  {
    folder: '移動/蹲與滑鏟',
    schema: {
      slideMinSpeed: { label: '滑鏟最低速度', min: 0, max: 20, step: 0.1, description: 'm/s；地面按蹲或空中按住蹲落地' },
      slideBoost: { label: '推進', min: 0, max: 15, step: 0.1, description: 'm/s' },
      slideBoostCooldown: { label: '推進冷卻', min: 0, max: 5, step: 0.05, description: 's；冷卻中只滑不加速' },
      slideBoostMaxSpeed: { label: '推進速度上限', min: 0, max: 40, step: 0.5, description: 'm/s；已比這快時不推進' },
      slideFriction: { label: '滑鏟摩擦', min: 0, max: 5, step: 0.05, description: '1/s（與速度成正比）' },
      slideDownhillFrictionScale: { label: '下坡摩擦倍率', min: 0, max: 1, step: 0.05, description: '下坡時摩擦乘上此倍率' },
      slideDownhillFullDeg: { label: '下坡倍率全開坡度°', min: 0.5, max: 45, step: 0.5 },
      slideSlopeFactor: { label: '坡度加速倍率', min: 0, max: 3, step: 0.05, description: '× 重力沿坡面分量' },
      slideSteerDegPerSec: { label: '轉向°/s', min: 0, max: 360, step: 5 },
      slideEndSpeed: { label: '結束速度', min: 0, max: 15, step: 0.1, description: 'm/s；低於此值結束滑鏟' },
      crouchTransitionTime: { label: '蹲起過渡', min: 0.01, max: 1, step: 0.01, description: 's；膠囊高度過渡時間' },
    },
  },
  {
    folder: '移動/膠囊與碰撞',
    schema: {
      standHeight: { label: '站姿高', min: 1, max: 2.5, step: 0.05, description: 'm' },
      crouchHeight: { label: '蹲姿高', min: 0.75, max: 2, step: 0.05, description: 'm（需 ≥ 2 × 半徑）' },
      radius: { label: '半徑', min: 0.2, max: 0.6, step: 0.01, description: 'm' },
      standEyeHeight: { label: '站姿眼高', min: 0.5, max: 2.4, step: 0.01, description: 'm' },
      crouchEyeHeight: { label: '蹲姿眼高', min: 0.3, max: 2, step: 0.01, description: 'm' },
      skinOffset: { label: '間隙 offset', min: 0.001, max: 0.1, step: 0.001, description: 'm；KinematicCharacterController offset' },
      autostepHeight: { label: '自動台階高', min: 0, max: 1, step: 0.01, description: 'm' },
      autostepMinWidth: { label: '台階最小寬', min: 0, max: 1, step: 0.01, description: 'm' },
      snapToGround: { label: '貼地距離', min: 0, max: 1, step: 0.01, description: 'm' },
      maxSlopeClimbDeg: { label: '最大爬坡°', min: 0, max: 89, step: 1 },
      minSlopeSlideDeg: { label: '最小下滑坡°', min: 0, max: 89, step: 1 },
      groundProbeDistance: { label: '地面探測距離', min: 0.01, max: 0.5, step: 0.01, description: 'm' },
      footstepStride: { label: '腳步間距', min: 0.5, max: 6, step: 0.1, description: 'm；每走這段距離發一次腳步事件' },
    },
  },
];
