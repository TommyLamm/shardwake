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

  // ── input（M1-03）────────────────────────────────────
  /** 滑鼠鎖定狀態改變或鎖定失敗（error 有值）。raw：是否為原始輸入（unadjustedMovement）。 */
  'input:pointerlock': { locked: boolean; raw: boolean; error?: string | undefined };
  /** 按鍵綁定變更（已存檔）。 */
  'input:bindings': Record<string, never>;

  // ── physics（M1-04）──────────────────────────────────
  /** 物理世界重建（換關卡）；舊的 Collider 與 handle 全部失效。 */
  'physics:reset': Record<string, never>;

  // ── world：Level（M1-04）─────────────────────────────
  /** 關卡載入完成（碰撞體與網格都已建立）。 */
  'level:loaded': { id: string; name: string };
  /** 關卡卸載（物理世界重建前）。 */
  'level:unloaded': { id: string };
  /** 追蹤對象（玩家或自由相機）進入／離開區域；event 為區域資料指定的觸發事件名稱。 */
  'level:zone': { levelId: string; zoneId: string; entered: boolean; event?: string | undefined };
  /** 追蹤對象落入 killVolume，回到檢查點。 */
  'level:respawn': { levelId: string; checkpointId: string };

  // ── player：移動（M1-05）──────────────────────────────
  // payload 物件由 PlayerController 重複使用：要保存請自行複製。
  /** 移動狀態切換（ground／air／slide，之後加 wallRun、mantle、dash、grapple）。 */
  'player:state': { from: string; to: string };
  /** 起跳（地面、土狼時間或滑鏟中）。 */
  'player:jump': { fromState: string; coyote: boolean };
  /** 落地；impactSpeed 為落地前的下落速度（m/s，正值）。 */
  'player:land': { impactSpeed: number; surface: string };
  /** 開始滑鏟；boosted 表示這次有推進（不在冷卻中）。 */
  'player:slideStart': { speed: number; boosted: boolean };
  /** 結束滑鏟。 */
  'player:slideEnd': { speed: number };
  /** 姿勢改變（蹲下或起身）。 */
  'player:crouch': { crouched: boolean };
  /** 腳步（地面移動每走 footstepStride 公尺一次）；surface 為腳下表面材質。 */
  'player:footstep': { surface: string; speed: number };
  /** 落入 killVolume 後回到檢查點（速度歸零）；pos 為重生的腳底位置。 */
  'player:respawn': { pos: { x: number; y: number; z: number } };

  // ── debug ──────────────────────────────────────────────
  /** 調參面板開啟或關閉。 */
  'debug:panel': { open: boolean };
}

export type GameEventName = keyof GameEvents;
