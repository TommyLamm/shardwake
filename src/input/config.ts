// 輸入系統的可調數值（集中於設定資料，並在調參面板「輸入」資料夾註冊）。
// 玩家層級的偏好（靈敏度、DPI、Y 軸反轉、按住／切換、自動衝刺）在 core/Settings.ts；
// 這裡是開發者調校用的常數。物件刻意保持可變：調參面板直接改寫欄位。

export interface InputConfig {
  /** 每個滑鼠 count 轉動的角度（度）＝ 此值 × 靈敏度。Source／Apex 尺度為 0.022。 */
  degreesPerCount: number;
  /** pitch 上下限（度）。 */
  pitchLimitDeg: number;
  /** 優先要求原始輸入（requestPointerLock({ unadjustedMovement: true })），不支援時自動退回。 */
  preferRawInput: boolean;
  /**
   * 跳動過濾：單一事件位移（count）超過此值，且前一個事件不大（見 spikeNeighborRatio）時丟棄。
   * 只在一般鎖定（非原始輸入）時啟用，除非 spikeFilterRaw 為 true。0 = 停用。
   */
  spikeThreshold: number;
  /** 前一個事件位移 ≥ spikeThreshold × 此比例時視為連續快速甩動，不丟棄。 */
  spikeNeighborRatio: number;
  /** 原始輸入時也套用跳動過濾。 */
  spikeFilterRaw: boolean;
  /** 滾輪累積多少像素算一格（觸控板會送很多小事件）。 */
  wheelNotchPx: number;
  /** deltaMode = 行 時，每行換算的像素。 */
  wheelLinePx: number;
  /** deltaMode = 頁 時，每頁換算的像素。 */
  wheelPagePx: number;
  /** 超過此毫秒沒有滾輪事件時清空累積量。 */
  wheelResetMs: number;
  /** Chrome 在解除鎖定後約 1 秒內拒絕重新鎖定；UI 在此期間提示稍候（毫秒）。 */
  relockCooldownMs: number;
}

export const INPUT_CONFIG: InputConfig = {
  degreesPerCount: 0.022,
  pitchLimitDeg: 89,
  preferRawInput: true,
  spikeThreshold: 400,
  spikeNeighborRatio: 0.25,
  spikeFilterRaw: false,
  wheelNotchPx: 50,
  wheelLinePx: 40,
  wheelPagePx: 800,
  wheelResetMs: 250,
  relockCooldownMs: 1100,
};

/**
 * 遊玩中一律 preventDefault 的按鍵（即使沒有綁定動作）：避免空白鍵／方向鍵捲動、Tab 換焦點、
 * Alt 啟動選單列、Firefox 的 ' 與 / 快速搜尋。
 */
export const ALWAYS_PREVENT_CODES: ReadonlySet<string> = new Set([
  'Tab',
  'Space',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'AltLeft',
  'AltRight',
  'Quote',
  'Slash',
  'Backspace',
  'ContextMenu',
]);
