// 全遊戲的事件表（集中在這一個檔案）。之後每份計畫把自己的事件加在對應段落，
// 事件名稱用「領域:動作」，payload 一律是普通物件（或 void），由 EventBus 同步派送。
// 熱迴圈內每步都會發的事件，payload 應重複使用同一個物件，避免配置記憶體。
import type { Settings, SettingsKey } from '@/core/Settings';

/** 遊戲模式：boot → title → playing ⇄ paused（paused／playing 可回 title）。 */
export type GameMode = 'boot' | 'title' | 'playing' | 'paused';

/** 進入暫停的原因；UI 依此決定顯示內容（例如「點擊繼續」）。 */
export type PauseReason = 'user' | 'hidden' | 'blur' | 'pointerlock' | 'debug';

export interface GameEvents {
  // ── core：Game ──────────────────────────────────────────
  /** 模式切換後發出。 */
  'game:mode': { from: GameMode; to: GameMode; reason?: PauseReason | undefined };

  // ── core：Settings ─────────────────────────────────────
  /** 設定變更（已驗證、已存檔）後發出；changed 為實際改變的欄位。 */
  'settings:changed': { settings: Readonly<Settings>; changed: readonly SettingsKey[] };

  // ── core：Storage ──────────────────────────────────────
  /** 儲存狀態改變（例如寫入失敗而退回記憶體）；UI 顯示「目前無法存檔」。 */
  'storage:status': { persistent: boolean; reason?: string | undefined };

  // ── core：Viewport ─────────────────────────────────────
  /** 遊戲容器（iframe 內）尺寸或像素比改變後發出；寬高為 CSS 像素。 */
  'viewport:resize': { width: number; height: number; pixelRatio: number; aspect: number };

  // ── core：Lifecycle ────────────────────────────────────
  /** 頁面可見性改變（切分頁、縮小視窗）。 */
  'lifecycle:visibility': { hidden: boolean };
  /** iframe 取得／失去焦點。 */
  'lifecycle:focus': { focused: boolean };

  // ── debug ──────────────────────────────────────────────
  /** 調參面板開啟或關閉。 */
  'debug:panel': { open: boolean };
}

export type GameEventName = keyof GameEvents;
