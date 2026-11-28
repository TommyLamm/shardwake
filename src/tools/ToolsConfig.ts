// 調校工具的可調數值（M1-15）：錄製重播、鬼影、計時賽、示範與慢動作。調參面板「工具/設定」可調整（不存檔）。
import type { ConfigSchema } from '@/debug/DebugPanel';

export interface ReplayToolConfig {
  /** 單段錄影的上限（s）；超過時自動停止錄製。 */
  maxSeconds: number;
  /** 路徑每幾步取一點（鬼影與錄影檔內的原始路徑；120 Hz 時 4 = 每秒 30 點）。 */
  pathStride: number;
  /** 鬼影時間差：在原始路徑上往前找最近點的視窗（步數，避免繞圈路線配到錯的一圈）。 */
  matchWindowSteps: number;
  /** 重播結束後鬼影路徑保留幾秒（0 = 保留到下一次錄製或重播）。 */
  ghostHoldSeconds: number;
  /** 本機最多保存幾段具名錄影。 */
  maxSavedClips: number;
}

export interface TrialToolConfig {
  /** 環形檢查點的觸發半徑倍率（乘上檢查點的 radius）。 */
  radiusScale: number;
  /** 完成後計時器保留幾秒才回到「待命」顯示。 */
  finishHoldSeconds: number;
  /** 重播中是否也更新最佳成績（預設否：重播不是真實遊玩）。 */
  recordBestInReplay: boolean;
}

export interface DemoToolConfig {
  /** 示範結束時，終點位置與錄影終點的容許誤差（m），超過時回報失準。 */
  tolerance: number;
  /** 載入完成後等待幾秒才開始（讓畫面穩定、方便截圖）。 */
  startDelay: number;
}

export interface ToolsConfig {
  replay: ReplayToolConfig;
  trial: TrialToolConfig;
  demo: DemoToolConfig;
}

export const TOOLS_CONFIG: ToolsConfig = {
  replay: { maxSeconds: 120, pathStride: 4, matchWindowSteps: 600, ghostHoldSeconds: 0, maxSavedClips: 12 },
  trial: { radiusScale: 1, finishHoldSeconds: 6, recordBestInReplay: false },
  demo: { tolerance: 0.05, startDelay: 0.5 },
};

export const REPLAY_TOOL_PANEL: ConfigSchema<ReplayToolConfig> = {
  maxSeconds: { label: '錄影上限 s', min: 5, max: 600, step: 5 },
  pathStride: { label: '路徑取樣步數', min: 1, max: 30, step: 1, description: '每幾個固定步記錄一個路徑點（下次錄製生效）' },
  matchWindowSteps: { label: '時間差搜尋視窗', min: 30, max: 6000, step: 30, description: '鬼影時間差往前找最近點的範圍（步）' },
  ghostHoldSeconds: { label: '鬼影保留 s', min: 0, max: 60, step: 1, description: '0 = 保留到下一次錄製或重播' },
  maxSavedClips: { label: '保存片段上限', min: 1, max: 50, step: 1 },
};

export const TRIAL_TOOL_PANEL: ConfigSchema<TrialToolConfig> = {
  radiusScale: { label: '檢查點半徑倍率', min: 0.5, max: 2, step: 0.05 },
  finishHoldSeconds: { label: '完成後顯示 s', min: 1, max: 30, step: 1 },
  recordBestInReplay: { label: '重播也記最佳', description: '預設關閉：只有真實遊玩會更新最佳成績' },
};

export const DEMO_TOOL_PANEL: ConfigSchema<DemoToolConfig> = {
  tolerance: { label: '示範容許誤差 m', min: 0.001, max: 1, step: 0.001 },
  startDelay: { label: '開始延遲 s', min: 0, max: 5, step: 0.1 },
};

/** 慢動作範圍（調參面板「工具/慢動作」）。 */
export const SLOW_MOTION_RANGE = { min: 0.1, max: 1, step: 0.05 } as const;
