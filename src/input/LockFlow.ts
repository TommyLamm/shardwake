// 滑鼠鎖定與遊戲模式的接線：
//   點擊（標題／暫停）→ 請求鎖定 → 鎖定成功才開始或恢復遊戲。
//   非遊戲主動的解鎖（Esc、失焦）→ 暫停（原因 pointerlock）；UI 顯示「點擊繼續」。
//   暫停動作（Esc 鍵送到遊戲時）→ 暫停並解除鎖定。
//   遊戲進入非遊玩模式（切分頁、失焦自動暫停、返回標題）→ 解除鎖定。
//   開調參面板 → 解除鎖定但不暫停（可邊看邊調、用鍵盤操作）；點擊畫面重新鎖定，用按鍵關閉面板時嘗試重新鎖定。
// 不使用鎖定（瀏覽器不支援，或網址 #nolock 的開發模式）時，點擊直接開始／恢復，但沒有滑鼠視角。
import type { GameMode, PauseReason } from '@/core/events';

export interface LockFlowGame {
  readonly mode: GameMode;
  start(): boolean;
  resume(): boolean;
  pause(reason?: PauseReason): boolean;
}

export interface LockFlowLock {
  readonly supported: boolean;
  readonly locked: boolean;
  readonly lastError: string | null;
  request(): Promise<boolean>;
  exit(): void;
}

export interface LockFlowOptions {
  game: LockFlowGame;
  lock: LockFlowLock;
  /** 是否使用滑鼠鎖定（預設為 lock.supported）。 */
  useLock?: boolean;
  /** 狀態改變（UI 更新）。 */
  onUpdate?: () => void;
}

export class LockFlow {
  readonly useLock: boolean;
  /** 最近一次鎖定失敗的訊息（成功鎖定或模式改變後清空）。 */
  error: string | null = null;
  private readonly game: LockFlowGame;
  private readonly lock: LockFlowLock;
  private readonly onUpdate: () => void;

  constructor(options: LockFlowOptions) {
    this.game = options.game;
    this.lock = options.lock;
    this.useLock = (options.useLock ?? true) && options.lock.supported;
    this.onUpdate = options.onUpdate ?? (() => {});
  }

  /** 遊玩中但沒有鎖定（例如開著調參面板）：需要點擊才有滑鼠視角。 */
  get needsRelock(): boolean {
    return this.useLock && this.game.mode === 'playing' && !this.lock.locked;
  }

  /** 玩家點擊遊戲畫面（必須在使用者手勢的事件處理中呼叫）。 */
  async click(): Promise<void> {
    const mode = this.game.mode;
    if (mode === 'boot') return;
    if (!this.useLock) {
      if (mode === 'title') this.game.start();
      else if (mode === 'paused') this.game.resume();
      return;
    }
    if (this.lock.locked) return;
    const ok = await this.lock.request();
    if (ok) {
      this.afterLocked();
    } else {
      this.error = this.lock.lastError ?? '滑鼠鎖定失敗';
      this.onUpdate();
    }
  }

  /** PointerLock 的 onChange。 */
  lockChanged(locked: boolean, intentional: boolean): void {
    if (locked) {
      this.afterLocked();
      return;
    }
    if (!intentional && this.game.mode === 'playing') this.game.pause('pointerlock');
    this.onUpdate();
  }

  /** 暫停動作（Esc 鍵送到遊戲時）。 */
  pauseRequested(): void {
    if (this.game.mode === 'playing') this.game.pause('user');
    this.lock.exit();
  }

  /** 遊戲模式改變。 */
  modeChanged(to: GameMode): void {
    if (to !== 'playing') this.lock.exit();
    this.error = null;
    this.onUpdate();
  }

  /** 調參面板開關。 */
  debugPanelChanged(open: boolean): void {
    if (!this.useLock) return;
    if (open) this.lock.exit();
    else if (this.game.mode === 'playing' && !this.lock.locked) void this.click();
  }

  private afterLocked(): void {
    this.error = null;
    if (this.game.mode === 'title') this.game.start();
    else if (this.game.mode === 'paused') this.game.resume();
    this.onUpdate();
  }
}
