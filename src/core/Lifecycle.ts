// 頁面生命週期：切分頁（visibilitychange → hidden）、iframe 失焦（blur）、pagehide 時自動暫停。
// 回到頁面時不自動恢復：恢復需要玩家點擊（Pointer Lock 也需要使用者手勢，M1-03）。
// 另外判斷是否嵌入 iframe（window.self !== window.top），供 UI 決定是否顯示自己的全螢幕按鈕；
// 只比較參考，不讀取 top 的任何屬性（跨來源讀取會丟例外）。
import type { EventBus } from '@/core/EventBus';
import type { GameEvents, PauseReason } from '@/core/events';

type Listenable = Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;

export interface LifecycleDocument extends Listenable {
  readonly visibilityState: DocumentVisibilityState;
}

export interface LifecycleWindow extends Listenable {
  readonly self: unknown;
  readonly top: unknown;
}

/** 是否被嵌入 iframe（平台中為 true）。無法判斷時視為嵌入。 */
export function isEmbedded(win: Pick<LifecycleWindow, 'self' | 'top'>): boolean {
  try {
    return win.self !== win.top;
  } catch {
    return true;
  }
}

export interface LifecycleOptions {
  /** 需要自動暫停時呼叫（Game.pause）。 */
  onAutoPause: (reason: PauseReason) => void;
  bus?: EventBus<GameEvents>;
  doc?: LifecycleDocument;
  win?: LifecycleWindow;
  /** 失焦是否暫停（預設 true）。 */
  pauseOnBlur?: boolean;
}

export class Lifecycle {
  readonly embedded: boolean;
  private readonly doc: LifecycleDocument;
  private readonly win: LifecycleWindow;
  private readonly onAutoPause: (reason: PauseReason) => void;
  private readonly bus: EventBus<GameEvents> | undefined;
  pauseOnBlur: boolean;
  /** 最近一次離開頁面（hidden）的時間戳，回來時可計算離開多久。 */
  hiddenAt: number | null = null;

  constructor(options: LifecycleOptions) {
    this.doc = options.doc ?? document;
    this.win = options.win ?? window;
    this.onAutoPause = options.onAutoPause;
    this.bus = options.bus;
    this.pauseOnBlur = options.pauseOnBlur ?? true;
    this.embedded = isEmbedded(this.win);
    this.doc.addEventListener('visibilitychange', this.handleVisibility);
    this.win.addEventListener('blur', this.handleBlur);
    this.win.addEventListener('focus', this.handleFocus);
    this.win.addEventListener('pagehide', this.handlePageHide);
  }

  get hidden(): boolean {
    return this.doc.visibilityState === 'hidden';
  }

  dispose(): void {
    this.doc.removeEventListener('visibilitychange', this.handleVisibility);
    this.win.removeEventListener('blur', this.handleBlur);
    this.win.removeEventListener('focus', this.handleFocus);
    this.win.removeEventListener('pagehide', this.handlePageHide);
  }

  private readonly handleVisibility = (): void => {
    const hidden = this.hidden;
    this.hiddenAt = hidden ? Date.now() : this.hiddenAt;
    if (hidden) this.onAutoPause('hidden');
    this.bus?.emit('lifecycle:visibility', { hidden });
  };

  private readonly handleBlur = (): void => {
    if (this.pauseOnBlur) this.onAutoPause('blur');
    this.bus?.emit('lifecycle:focus', { focused: false });
  };

  private readonly handleFocus = (): void => {
    this.bus?.emit('lifecycle:focus', { focused: true });
  };

  private readonly handlePageHide = (): void => {
    this.onAutoPause('hidden');
  };
}
