// 核心執行框架的可調數值（集中於設定資料，並在調參面板「核心」資料夾註冊）。
// 物件刻意保持可變：調參面板直接改寫欄位，系統每次使用時讀取最新值。

export interface FixedLoopConfig {
  /** 固定模擬頻率（Hz）。 */
  hz: number;
  /** 單一畫面最多計入的真實時間（秒）；切分頁回來或卡頓時不爆衝。 */
  maxFrameDt: number;
  /** 每個畫面最多執行的模擬步數（防死亡螺旋）；超過的時間直接捨棄。 */
  maxStepsPerFrame: number;
}

export const LOOP_CONFIG: FixedLoopConfig = {
  hz: 120,
  maxFrameDt: 0.1,
  maxStepsPerFrame: 8,
};

export interface ViewportConfig {
  /** devicePixelRatio 上限；實際像素比 = min(dpr, 上限) × 畫質的渲染比例。 */
  maxPixelRatio: number;
}

export const VIEWPORT_CONFIG: ViewportConfig = {
  maxPixelRatio: 1,
};

export interface StatsConfig {
  /** FPS／frame time 的取樣視窗（毫秒）。 */
  sampleMs: number;
}

export const STATS_CONFIG: StatsConfig = {
  sampleMs: 500,
};

export interface DebugConfig {
  /** 調參面板唯讀監看值的更新間隔（毫秒）。 */
  monitorIntervalMs: number;
  /** FPS 圖的列高（Tweakpane rows）。 */
  fpsGraphRows: number;
}

export const DEBUG_CONFIG: DebugConfig = {
  monitorIntervalMs: 200,
  fpsGraphRows: 3,
};
