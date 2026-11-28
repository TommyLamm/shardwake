// HUD 的版面與樣式參數（M1-14）：集中在設定資料，調參面板「介面/HUD」可調（不存檔）。
// 顏色與線條在 hud.css 的 CSS 變數；這裡放會影響邏輯或版面的數值。
import type { ConfigSchema } from '@/debug/DebugPanel';

export interface HudLayoutConfig {
  /** 以 iframe 短邊縮放：scale = 短邊 / refShortSide × userScale，夾在 [minScale, maxScale]。 */
  refShortSide: number;
  minScale: number;
  maxScale: number;
  /** 玩家 HUD 縮放（M5-07 的無障礙設定接這裡）。 */
  userScale: number;
  /** HUD 安全區的最大寬高比：超寬螢幕時左右角落的元件往中間收（21:9 以上不會跑到視野邊緣）。 */
  safeMaxAspect: number;
  /** 安全區邊距（px，乘 scale 前）。 */
  margin: number;
  /** 選單的縮放範圍（同樣以 refShortSide 為基準）。 */
  menuMinScale: number;
  menuMaxScale: number;
}

export interface HudVitalsConfig {
  /** 受擊延遲條：扣血後多久開始追上（s）與追上的速度（每秒佔滿條的比例）。 */
  trailDelay: number;
  trailRate: number;
  /** 生命低於這個比例時生命條改為警示色並閃爍。 */
  lowHealthFraction: number;
}

export interface HudAbilityConfig {
  /** 噴射燃料滿且未使用超過這個時間（s）後淡出燃料條；0 = 永遠顯示。 */
  jetHideDelay: number;
  /** 抓鉤冷卻環的半徑（px，乘 scale 前）。 */
  grappleRingRadius: number;
}

export interface HudWeaponConfig {
  /** 彈匣低於這個比例時彈藥數字改為警示色。 */
  lowAmmoFraction: number;
}

export interface HudMessageConfig {
  /** 每則提示的預設顯示時間（s）與淡出時間（s）。 */
  duration: number;
  fadeOut: number;
  /** 同時顯示的最多則數。 */
  maxVisible: number;
  /** 開始遊戲後「按 Esc 暫停」提示的時間（s；0 = 不顯示）。 */
  pauseHintDuration: number;
}

export interface HudConfig {
  layout: HudLayoutConfig;
  vitals: HudVitalsConfig;
  abilities: HudAbilityConfig;
  weapon: HudWeaponConfig;
  messages: HudMessageConfig;
  /** 「可勾取」提示是否顯示距離。 */
  grappleHintDistance: boolean;
}

export const HUD_CONFIG: HudConfig = {
  layout: { refShortSide: 1080, minScale: 0.72, maxScale: 1.8, userScale: 1, safeMaxAspect: 2.1, margin: 32, menuMinScale: 0.8, menuMaxScale: 1.6 },
  vitals: { trailDelay: 0.45, trailRate: 0.9, lowHealthFraction: 0.4 },
  abilities: { jetHideDelay: 1.5, grappleRingRadius: 15 },
  weapon: { lowAmmoFraction: 0.25 },
  messages: { duration: 2.4, fadeOut: 0.35, maxVisible: 3, pauseHintDuration: 4 },
  grappleHintDistance: true,
};

export const HUD_LAYOUT_PANEL: ConfigSchema<HudLayoutConfig> = {
  refShortSide: { label: '參考短邊 px', min: 480, max: 2160, step: 10, description: 'scale = 短邊 / 參考短邊' },
  minScale: { label: '最小縮放', min: 0.3, max: 2, step: 0.01 },
  maxScale: { label: '最大縮放', min: 0.5, max: 4, step: 0.01 },
  userScale: { label: 'HUD 縮放倍率', min: 0.5, max: 2, step: 0.05, description: 'M5-07 的玩家設定' },
  safeMaxAspect: { label: '安全區最大寬高比', min: 1.2, max: 4, step: 0.05 },
  margin: { label: '邊距 px', min: 0, max: 120, step: 1 },
  menuMinScale: { label: '選單最小縮放', min: 0.3, max: 2, step: 0.01 },
  menuMaxScale: { label: '選單最大縮放', min: 0.5, max: 4, step: 0.01 },
};

export const HUD_VITALS_PANEL: ConfigSchema<HudVitalsConfig> = {
  trailDelay: { label: '延遲條等待 s', min: 0, max: 3, step: 0.05 },
  trailRate: { label: '延遲條速度 /s', min: 0.05, max: 10, step: 0.05 },
  lowHealthFraction: { label: '低生命比例', min: 0, max: 1, step: 0.01 },
};

export const HUD_ABILITY_PANEL: ConfigSchema<HudAbilityConfig> = {
  jetHideDelay: { label: '燃料條淡出 s', min: 0, max: 10, step: 0.1, description: '0 = 永遠顯示' },
  grappleRingRadius: { label: '抓鉤環半徑 px', min: 6, max: 40, step: 0.5 },
};

export const HUD_WEAPON_PANEL: ConfigSchema<HudWeaponConfig> = {
  lowAmmoFraction: { label: '低彈藥比例', min: 0, max: 1, step: 0.01 },
};

export const HUD_MESSAGE_PANEL: ConfigSchema<HudMessageConfig> = {
  duration: { label: '顯示時間 s', min: 0.3, max: 10, step: 0.1 },
  fadeOut: { label: '淡出 s', min: 0, max: 2, step: 0.05 },
  maxVisible: { label: '最多則數', min: 1, max: 8, step: 1 },
  pauseHintDuration: { label: '暫停提示 s', min: 0, max: 20, step: 0.5 },
};
