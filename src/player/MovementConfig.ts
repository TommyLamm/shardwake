// 移動手感數值（M1-05 基礎移動、M1-06 跑牆／蹬牆跳／攀爬、M1-07 二段跳／噴射／Dash／抓鉤與能力開關）。
// 能力數值的「實際值」由 Abilities.stat() 讀取：裝備模組（M2-06）與技能（M5-01）透過 AbilityModifiers 修正，
// 不直接改寫這個物件（這裡是基礎值，給調參面板調整）。
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

  // ── 牆面偵測與跑牆（M1-06）──
  /** 側面牆偵測距離 = 膠囊半徑 + 此值（m）：空中每步往左右（相對速度方向）做水平 shape cast。 */
  wallDetectExtra: number;
  /** 可跑牆的牆面法線 |n.y| 上限（越小越要求垂直）。 */
  wallMaxNormalY: number;
  /** 進入跑牆的最低水平速度（m/s）。 */
  wallRunMinSpeed: number;
  /** 進入跑牆時，速度方向與牆面切線的最大夾角（度）。 */
  wallRunMaxAngleDeg: number;
  /** 進入跑牆的最低離地高度（腳底到下方地面，m）。 */
  wallRunMinHeight: number;
  /** 離開同一面牆後多久才能再貼上（s；著地後重置）。 */
  wallRunSameWallCooldown: number;
  /** 進入跑牆時沿牆速度至少為此值（m/s）。 */
  wallRunEntrySpeed: number;
  /** 進入跑牆時最多保留的上升速度（m/s）。 */
  wallRunMaxRiseSpeed: number;
  /** 進入跑牆時最多保留的下落速度（m/s，正值；0 = 貼牆時止住下墜）。 */
  wallRunMaxEntryFallSpeed: number;
  /** 跑牆重力的最終值（m/s²）。 */
  wallRunGravity: number;
  /** 跑牆重力從 0 增加到最終值的時間（s）。 */
  wallRunGravityRampTime: number;
  /** 跑牆重力曲線的指數：g = 最終值 × (t / 增加時間)^指數（1 = 線性、2 = 先慢後快）。 */
  wallRunGravityCurve: number;
  /** 朝牆面的貼附加速度（m/s²）。 */
  wallRunStickAccel: number;
  /** 朝牆面的貼附速度上限（m/s）。 */
  wallRunStickMaxSpeed: number;
  /** 跑牆最長時間（s）。 */
  wallRunMaxTime: number;
  /** 水平速度低於此值時結束跑牆（m/s）。 */
  wallRunEndSpeed: number;

  // ── 蹬牆跳（M1-06）──
  /** 蹬牆跳保留的沿牆速度比例。 */
  wallJumpAlongScale: number;
  /** 蹬牆跳沿牆面法線（離牆）的速度（m/s）。 */
  wallJumpNormalSpeed: number;
  /** 蹬牆跳的向上速度（m/s）。 */
  wallJumpUpSpeed: number;
  /** 視線離開牆面時，蹬牆跳水平方向往視線偏轉的權重（0 = 不偏轉、1 = 完全朝視線）。 */
  wallJumpLookInfluence: number;
  /** 跑牆結束（牆面結束、放開前進、逾時）後仍可蹬牆跳的時間（s）。 */
  wallJumpGraceTime: number;

  // ── 攀爬（M1-06）──
  /** 前方牆偵測距離（膠囊表面往前，m）。 */
  mantleReach: number;
  /** 視線與牆面法線（反向）的最大夾角（度）：正面牆才攀爬。 */
  mantleMaxFacingDeg: number;
  /** 邊緣高度下限（腳底以上，m）。 */
  mantleMinHeight: number;
  /** 邊緣高度上限（腳底以上，m）。 */
  mantleMaxHeight: number;
  /** 邊緣頂面最大坡度（度）。 */
  mantleMaxSlopeDeg: number;
  /** 上升速度低於此值才會攀爬（m/s）。 */
  mantleMaxRiseSpeed: number;
  /** 攀爬動作時間（s）。 */
  mantleDuration: number;
  /** 攀爬動作中「往上」段佔的比例（其餘為「往前」段）。 */
  mantleUpFraction: number;
  /** 結束時保留進入前水平速度的比例。 */
  mantleExitSpeedKeep: number;
  /** 結束時向前速度下限（m/s）。 */
  mantleExitMinSpeed: number;

  // ── 能力開關（M1-07；調參面板比較手感用）──
  /** 啟用二段跳。 */
  doubleJumpEnabled: boolean;
  /** 啟用噴射推進。 */
  jetEnabled: boolean;
  /** 啟用 Dash。 */
  dashEnabled: boolean;
  /** 啟用抓鉤。 */
  grappleEnabled: boolean;

  // ── 二段跳（M1-07）──
  /** 空中跳躍次數（著地、跑牆、抓鉤時重置）。 */
  doubleJumpCount: number;
  /** 二段跳的垂直速度（m/s）：vy = max(vy, 此值)。 */
  doubleJumpSpeed: number;
  /** 水平速度往輸入方向重新導向的比例（0..1，不增加水平速率）。 */
  doubleJumpRedirect: number;
  /** 落地保護（s）：下落中、預估這段時間內會著地時，按跳保留給落地起跳（跳躍緩衝），不消耗二段跳。 */
  doubleJumpLandingGuard: number;

  // ── 噴射推進（M1-07）──
  /** 向上推力（m/s²，重力另計）。 */
  jetThrust: number;
  /** 推力造成的垂直速度上限（m/s）：垂直速度到此值以上不再推。 */
  jetMaxRiseSpeed: number;
  /** 水平推力（m/s²，往輸入方向）。 */
  jetHorizontalAccel: number;
  /** 水平推力的目標速度（沿輸入方向的速度到此值為止，m/s）。 */
  jetHorizontalMaxSpeed: number;
  /** 燃料容量（s）。 */
  jetFuel: number;
  /** 著地多久後開始回充（s）；跑牆中直接回充。 */
  jetRechargeDelay: number;
  /** 回充速度（燃料秒數 / 秒）。 */
  jetRechargeRate: number;
  /** 長按多久才啟動噴射（s，從按下跳算起；二段跳那一下也算）。 */
  jetHoldDelay: number;

  // ── Dash（M1-07）──
  /** 充能次數。 */
  dashCharges: number;
  /** 每次充能時間（s，依序回充）。 */
  dashRechargeTime: number;
  /** 位移距離（m）。 */
  dashDistance: number;
  /** 動作時間（s）；期間無重力、垂直速度歸零。 */
  dashDuration: number;
  /** 結束時沿 Dash 方向的水平速度下限（m/s）；原本沿該方向更快時保留。 */
  dashExitMinSpeed: number;

  // ── 抓鉤（M1-07）──
  /** 鉤爪飛行速度（m/s）。 */
  grappleHookSpeed: number;
  /** 射程（m，從相機沿視線）。 */
  grappleRange: number;
  /** 落空（或飛行中取消）後的冷卻（s）。 */
  grappleMissCooldown: number;
  /** 朝錨點的加速度（m/s²）。 */
  grapplePullAccel: number;
  /** 輸入轉向加速度（m/s²，水平）。 */
  grappleSteerAccel: number;
  /** 速度上限（m/s）：拉力與轉向不會讓速率超過此值（進入時已更快則保留）。 */
  grappleMaxSpeed: number;
  /** 附著時的重力倍率。 */
  grappleGravityScale: number;
  /** 與錨點距離小於此值時自動脫鉤（m）。 */
  grappleReleaseDistance: number;
  /** 越過錨點判定：速度方向與錨點方向的內積小於此值時脫鉤。 */
  grapplePassDot: number;
  /** 附著中按跳脫鉤的額外上拋速度（m/s）。 */
  grappleJumpBoost: number;
  /** 最長附著時間（s）。 */
  grappleMaxTime: number;
  /** 脫鉤後的冷卻（s）。 */
  grappleCooldown: number;

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

  wallDetectExtra: 0.35,
  wallMaxNormalY: 0.15,
  wallRunMinSpeed: 6,
  wallRunMaxAngleDeg: 50,
  wallRunMinHeight: 0.6,
  wallRunSameWallCooldown: 0.4,
  wallRunEntrySpeed: 10.5,
  wallRunMaxRiseSpeed: 3,
  wallRunMaxEntryFallSpeed: 0,
  wallRunGravity: 8,
  wallRunGravityRampTime: 1.2,
  wallRunGravityCurve: 2,
  wallRunStickAccel: 20,
  wallRunStickMaxSpeed: 2,
  wallRunMaxTime: 1.8,
  wallRunEndSpeed: 5,

  wallJumpAlongScale: 0.9,
  wallJumpNormalSpeed: 7,
  wallJumpUpSpeed: 7.5,
  wallJumpLookInfluence: 0.5,
  wallJumpGraceTime: 0.15,

  mantleReach: 0.6,
  mantleMaxFacingDeg: 45,
  mantleMinHeight: 0.5,
  mantleMaxHeight: 2.0,
  mantleMaxSlopeDeg: 30,
  mantleMaxRiseSpeed: 4,
  mantleDuration: 0.28,
  mantleUpFraction: 0.6,
  mantleExitSpeedKeep: 0.6,
  mantleExitMinSpeed: 4,

  doubleJumpEnabled: true,
  jetEnabled: true,
  dashEnabled: true,
  grappleEnabled: true,

  doubleJumpCount: 1,
  doubleJumpSpeed: 7.3,
  doubleJumpRedirect: 0.5,
  doubleJumpLandingGuard: 0.15,

  jetThrust: 34,
  jetMaxRiseSpeed: 5,
  jetHorizontalAccel: 6,
  jetHorizontalMaxSpeed: 8,
  jetFuel: 1.0,
  jetRechargeDelay: 0.3,
  jetRechargeRate: 0.8,
  jetHoldDelay: 0.12,

  dashCharges: 2,
  dashRechargeTime: 1.8,
  dashDistance: 7,
  dashDuration: 0.15,
  dashExitMinSpeed: 12,

  grappleHookSpeed: 150,
  grappleRange: 45,
  grappleMissCooldown: 0.8,
  grapplePullAccel: 50,
  grappleSteerAccel: 12,
  grappleMaxSpeed: 26,
  grappleGravityScale: 0.4,
  grappleReleaseDistance: 2.5,
  grapplePassDot: -0.2,
  grappleJumpBoost: 5,
  grappleMaxTime: 2.5,
  grappleCooldown: 4,

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
    folder: '移動/跑牆',
    schema: {
      wallDetectExtra: { label: '牆面偵測距離', min: 0.05, max: 1.5, step: 0.01, description: 'm；膠囊半徑 + 此值內的側面牆' },
      wallMaxNormalY: { label: '牆面 |n.y| 上限', min: 0, max: 0.5, step: 0.01, description: '越小越要求垂直' },
      wallRunMinSpeed: { label: '進入最低速度', min: 0, max: 20, step: 0.1, description: 'm/s（水平）' },
      wallRunMaxAngleDeg: { label: '進入最大夾角°', min: 5, max: 89, step: 1, description: '速度方向與牆面切線' },
      wallRunMinHeight: { label: '最低離地高度', min: 0, max: 3, step: 0.05, description: 'm' },
      wallRunSameWallCooldown: { label: '同牆重貼冷卻', min: 0, max: 3, step: 0.05, description: 's；著地後重置' },
      wallRunEntrySpeed: { label: '進入沿牆速度下限', min: 0, max: 25, step: 0.1, description: 'm/s' },
      wallRunMaxRiseSpeed: { label: '進入保留上升', min: 0, max: 10, step: 0.1, description: 'm/s' },
      wallRunMaxEntryFallSpeed: { label: '進入保留下落', min: 0, max: 30, step: 0.1, description: 'm/s；0 = 貼牆時止住下墜' },
      wallRunGravity: { label: '跑牆重力', min: 0, max: 40, step: 0.1, description: 'm/s²（最終值）' },
      wallRunGravityRampTime: { label: '重力增加時間', min: 0.01, max: 5, step: 0.05, description: 's；從 0 增加到最終值' },
      wallRunGravityCurve: { label: '重力曲線指數', min: 0.25, max: 4, step: 0.05, description: '1 = 線性、2 = 先慢後快' },
      wallRunStickAccel: { label: '貼附加速度', min: 0, max: 100, step: 1, description: 'm/s²；朝牆面' },
      wallRunStickMaxSpeed: { label: '貼附速度上限', min: 0, max: 10, step: 0.1, description: 'm/s' },
      wallRunMaxTime: { label: '最長時間', min: 0.1, max: 10, step: 0.05, description: 's' },
      wallRunEndSpeed: { label: '結束速度', min: 0, max: 20, step: 0.1, description: 'm/s；低於此值結束跑牆' },
    },
  },
  {
    folder: '移動/蹬牆跳',
    schema: {
      wallJumpAlongScale: { label: '沿牆速度比例', min: 0, max: 1.5, step: 0.05 },
      wallJumpNormalSpeed: { label: '離牆速度', min: 0, max: 20, step: 0.1, description: 'm/s（牆面法線方向）' },
      wallJumpUpSpeed: { label: '向上速度', min: 0, max: 20, step: 0.1, description: 'm/s' },
      wallJumpLookInfluence: { label: '視線偏轉權重', min: 0, max: 1, step: 0.05, description: '視線離開牆面時往視線方向偏轉' },
      wallJumpGraceTime: { label: '離牆後可蹬時間', min: 0, max: 0.5, step: 0.01, description: 's；牆面結束或放開前進後' },
    },
  },
  {
    folder: '移動/攀爬',
    schema: {
      mantleReach: { label: '前方偵測距離', min: 0.05, max: 2, step: 0.01, description: 'm（膠囊表面往前）' },
      mantleMaxFacingDeg: { label: '面向牆最大夾角°', min: 5, max: 89, step: 1, description: '視線與牆面；超過時視為側面牆' },
      mantleMinHeight: { label: '邊緣高度下限', min: 0, max: 2, step: 0.05, description: 'm（腳底以上）' },
      mantleMaxHeight: { label: '邊緣高度上限', min: 0.5, max: 4, step: 0.05, description: 'm（腳底以上）' },
      mantleMaxSlopeDeg: { label: '頂面最大坡度°', min: 0, max: 60, step: 1 },
      mantleMaxRiseSpeed: { label: '上升速度上限', min: 0, max: 20, step: 0.1, description: 'm/s；上升比這快時不攀爬' },
      mantleDuration: { label: '動作時間', min: 0.05, max: 1.5, step: 0.01, description: 's' },
      mantleUpFraction: { label: '往上段比例', min: 0.1, max: 0.9, step: 0.05, description: '先上後前' },
      mantleExitSpeedKeep: { label: '保留水平速度', min: 0, max: 1.5, step: 0.05, description: '× 進入前水平速度' },
      mantleExitMinSpeed: { label: '結束向前速度下限', min: 0, max: 15, step: 0.1, description: 'm/s' },
    },
  },
  {
    folder: '移動/能力開關',
    schema: {
      doubleJumpEnabled: { label: '二段跳' },
      jetEnabled: { label: '噴射推進' },
      dashEnabled: { label: 'Dash' },
      grappleEnabled: { label: '抓鉤' },
    },
  },
  {
    folder: '移動/二段跳',
    schema: {
      doubleJumpCount: { label: '空中跳躍次數', min: 0, max: 5, step: 1, description: '著地、跑牆、抓鉤時重置' },
      doubleJumpSpeed: { label: '垂直速度', min: 0, max: 20, step: 0.1, description: 'm/s；vy = max(vy, 此值)，7.3 約 1.1 m' },
      doubleJumpRedirect: { label: '往輸入方向導向', min: 0, max: 1, step: 0.05, description: '水平速度往輸入方向轉的比例（不增速）' },
      doubleJumpLandingGuard: { label: '落地保護', min: 0, max: 0.5, step: 0.01, description: 's；快著地時按跳保留給落地起跳' },
    },
  },
  {
    folder: '移動/噴射',
    schema: {
      jetThrust: { label: '向上推力', min: 0, max: 100, step: 0.5, description: 'm/s²（重力另計，34 − 24 = 淨上升 10）' },
      jetMaxRiseSpeed: { label: '推力垂直速度上限', min: 0, max: 20, step: 0.1, description: 'm/s' },
      jetHorizontalAccel: { label: '水平推力', min: 0, max: 40, step: 0.5, description: 'm/s²（往輸入方向）' },
      jetHorizontalMaxSpeed: { label: '水平推力目標速度', min: 0, max: 25, step: 0.1, description: 'm/s' },
      jetFuel: { label: '燃料', min: 0, max: 5, step: 0.05, description: 's' },
      jetRechargeDelay: { label: '著地回充延遲', min: 0, max: 3, step: 0.05, description: 's；跑牆中直接回充' },
      jetRechargeRate: { label: '回充速度', min: 0, max: 5, step: 0.05, description: '燃料秒數 / 秒' },
      jetHoldDelay: { label: '長按啟動時間', min: 0, max: 0.5, step: 0.01, description: 's；從按下跳算起' },
    },
  },
  {
    folder: '移動/Dash',
    schema: {
      dashCharges: { label: '充能次數', min: 0, max: 5, step: 1 },
      dashRechargeTime: { label: '每次充能時間', min: 0, max: 10, step: 0.05, description: 's（依序回充）' },
      dashDistance: { label: '位移距離', min: 0, max: 20, step: 0.1, description: 'm' },
      dashDuration: { label: '動作時間', min: 0.02, max: 1, step: 0.01, description: 's；期間無重力' },
      dashExitMinSpeed: { label: '結束速度下限', min: 0, max: 30, step: 0.1, description: 'm/s（沿 Dash 方向）' },
    },
  },
  {
    folder: '移動/抓鉤',
    schema: {
      grappleHookSpeed: { label: '鉤爪速度', min: 10, max: 500, step: 5, description: 'm/s' },
      grappleRange: { label: '射程', min: 5, max: 150, step: 1, description: 'm（從相機沿視線）' },
      grappleMissCooldown: { label: '落空冷卻', min: 0, max: 5, step: 0.05, description: 's' },
      grapplePullAccel: { label: '拉力', min: 0, max: 200, step: 1, description: 'm/s²（朝錨點）' },
      grappleSteerAccel: { label: '輸入轉向', min: 0, max: 60, step: 0.5, description: 'm/s²' },
      grappleMaxSpeed: { label: '速度上限', min: 1, max: 80, step: 0.5, description: 'm/s' },
      grappleGravityScale: { label: '重力倍率', min: 0, max: 1.5, step: 0.05 },
      grappleReleaseDistance: { label: '自動脫鉤距離', min: 0, max: 10, step: 0.1, description: 'm' },
      grapplePassDot: { label: '越過錨點內積', min: -1, max: 1, step: 0.05, description: '速度方向·錨點方向小於此值時脫鉤' },
      grappleJumpBoost: { label: '跳躍脫鉤上拋', min: 0, max: 20, step: 0.1, description: 'm/s' },
      grappleMaxTime: { label: '最長附著', min: 0.1, max: 10, step: 0.05, description: 's' },
      grappleCooldown: { label: '脫鉤冷卻', min: 0, max: 20, step: 0.1, description: 's' },
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
