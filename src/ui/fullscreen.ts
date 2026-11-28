// 全螢幕按鈕（M1-14）：只在沒有嵌入 iframe 時顯示（嵌入平台時交給平台的全螢幕按鈕），
// 而且只在玩家點擊的事件處理中呼叫 requestFullscreen（瀏覽器要求使用者手勢）。不呼叫 Keyboard Lock。
// Esc 離開全螢幕由瀏覽器處理；fullscreenchange 時通知 UI 更新按鈕文字。

type Listenable = Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;

export interface FullscreenDocument extends Listenable {
  readonly fullscreenEnabled?: boolean;
  readonly fullscreenElement?: unknown;
  exitFullscreen?(): Promise<void>;
}

export interface FullscreenTarget {
  requestFullscreen?(options?: { navigationUI?: 'auto' | 'hide' | 'show' }): Promise<void>;
}

/** 是否顯示遊戲自己的全螢幕按鈕。 */
export function fullscreenButtonVisible(embedded: boolean, enabled: boolean, hasApi: boolean): boolean {
  return !embedded && enabled && hasApi;
}

export interface FullscreenControlOptions {
  embedded: boolean;
  doc?: FullscreenDocument;
  target?: FullscreenTarget;
}

export class FullscreenControl {
  readonly embedded: boolean;
  private readonly doc: FullscreenDocument;
  private readonly target: FullscreenTarget;
  private readonly listeners = new Set<(active: boolean) => void>();
  lastError: string | null = null;

  constructor(options: FullscreenControlOptions) {
    this.embedded = options.embedded;
    this.doc = options.doc ?? (document as unknown as FullscreenDocument);
    this.target = options.target ?? (document.documentElement as unknown as FullscreenTarget);
    this.doc.addEventListener('fullscreenchange', this.handleChange);
  }

  /** 遊戲自己的全螢幕按鈕是否可用（沒有嵌入、瀏覽器允許）。 */
  get available(): boolean {
    return fullscreenButtonVisible(this.embedded, this.doc.fullscreenEnabled === true, typeof this.target.requestFullscreen === 'function');
  }

  get active(): boolean {
    return this.doc.fullscreenElement != null;
  }

  onChange(listener: (active: boolean) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** 切換全螢幕（必須在玩家點擊的事件處理中同步呼叫）。回傳是否成功。 */
  async toggle(): Promise<boolean> {
    this.lastError = null;
    try {
      if (this.active) {
        await this.doc.exitFullscreen?.();
        return true;
      }
      if (!this.available) return false;
      await this.target.requestFullscreen!({ navigationUI: 'hide' });
      return true;
    } catch (err) {
      this.lastError = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      return false;
    }
  }

  dispose(): void {
    this.doc.removeEventListener('fullscreenchange', this.handleChange);
    this.listeners.clear();
  }

  private readonly handleChange = (): void => {
    const a = this.active;
    for (const l of this.listeners) l(a);
  };
}
