// Pointer Lock：在玩家點擊（使用者手勢）時鎖定滑鼠。
// - 優先 requestPointerLock({ unadjustedMovement: true }) 取得原始輸入（不受系統滑鼠加速影響）；
//   瀏覽器不支援（NotSupportedError、同步丟例外）時退回一般鎖定，此時 rawInput = false，
//   滑鼠視角會啟用跳動過濾。舊版 API 不回傳 Promise 時也視為一般鎖定。
// - 監聽 pointerlockchange／pointerlockerror；非遊戲主動解除的解鎖（Esc、失焦）回報 intentional = false，
//   由 LockFlow 通知 Game 暫停。Esc 解鎖由瀏覽器控制；Chrome 解鎖後約 1 秒內無法重新鎖定，
//   UI 依 inCooldown 提示「點擊繼續」並在失敗時請玩家再點一次。
// - 不呼叫 navigator.keyboard.lock()。
import type { EventBus } from '@/core/EventBus';
import type { GameEvents } from '@/core/events';
import { INPUT_CONFIG, type InputConfig } from '@/input/config';

type Listenable = Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;

export interface PointerLockDocument extends Listenable {
  readonly pointerLockElement: unknown;
  exitPointerLock?(): void;
}

export interface PointerLockTarget {
  requestPointerLock?(options?: { unadjustedMovement?: boolean }): Promise<void> | void;
}

export interface PointerLockOptions {
  target: PointerLockTarget;
  doc?: PointerLockDocument;
  bus?: EventBus<GameEvents>;
  config?: Pick<InputConfig, 'preferRawInput' | 'relockCooldownMs'>;
  /** 鎖定狀態改變。intentional：解鎖是遊戲自己呼叫 exit() 造成的。 */
  onChange?: (locked: boolean, intentional: boolean) => void;
  /** 鎖定失敗（例如 Chrome 的重新鎖定冷卻、iframe 沒有 allow-pointer-lock）。 */
  onError?: (message: string) => void;
  now?: () => number;
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  if (typeof err === 'object' && err !== null && 'name' in err) return String((err as { name: unknown }).name);
  return String(err);
}

function isNotSupported(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { name?: unknown }).name === 'NotSupportedError';
}

export class PointerLock {
  /** 目前鎖定是否為原始輸入（unadjustedMovement）。未鎖定或未知時為 false。 */
  rawInput = false;
  /** 最近一次解除鎖定的時間（毫秒，now()）。 */
  lastUnlockAt = Number.NEGATIVE_INFINITY;
  /** 最近一次錯誤訊息（成功鎖定後清空）。 */
  lastError: string | null = null;

  private readonly target: PointerLockTarget;
  private readonly doc: PointerLockDocument;
  private readonly bus: EventBus<GameEvents> | undefined;
  private readonly config: Pick<InputConfig, 'preferRawInput' | 'relockCooldownMs'>;
  private readonly onChange: ((locked: boolean, intentional: boolean) => void) | undefined;
  private readonly onError: ((message: string) => void) | undefined;
  private readonly now: () => number;
  private wasLocked = false;
  private expectingUnlock = false;
  private pending: Promise<boolean> | null = null;
  /** 這次請求是否以原始輸入成功（在 pointerlockchange 之前就可能知道）。 */
  private requestRaw = false;
  /** requestPointerLock 回傳 Promise（新版 API）：錯誤由 Promise 回報，忽略 pointerlockerror 事件。 */
  private promiseApi = false;

  constructor(options: PointerLockOptions) {
    this.target = options.target;
    this.doc = options.doc ?? (document as unknown as PointerLockDocument);
    this.bus = options.bus;
    this.config = options.config ?? INPUT_CONFIG;
    this.onChange = options.onChange;
    this.onError = options.onError;
    this.now = options.now ?? (() => performance.now());
    this.doc.addEventListener('pointerlockchange', this.handleChange);
    this.doc.addEventListener('pointerlockerror', this.handleError);
  }

  /** 瀏覽器是否提供 Pointer Lock。 */
  get supported(): boolean {
    return typeof this.target.requestPointerLock === 'function';
  }

  get locked(): boolean {
    return this.doc.pointerLockElement === this.target && this.doc.pointerLockElement !== null;
  }

  /** 是否正在等待鎖定結果。 */
  get requesting(): boolean {
    return this.pending !== null;
  }

  /** 剛解除鎖定、瀏覽器可能還不允許重新鎖定。 */
  get inCooldown(): boolean {
    return this.now() - this.lastUnlockAt < this.config.relockCooldownMs;
  }

  /** 請求鎖定（必須在使用者手勢的事件處理中呼叫）。回傳是否成功。 */
  request(): Promise<boolean> {
    if (this.locked) return Promise.resolve(true);
    if (!this.supported) {
      this.fail('此瀏覽器不支援滑鼠鎖定');
      return Promise.resolve(false);
    }
    this.pending ??= this.doRequest().finally(() => {
      this.pending = null;
    });
    return this.pending;
  }

  /** 由遊戲主動解除鎖定（不會被視為玩家暫停）。 */
  exit(): void {
    if (!this.locked) return;
    this.expectingUnlock = true;
    try {
      this.doc.exitPointerLock?.();
    } catch (err) {
      this.expectingUnlock = false;
      console.warn('[shardwake] exitPointerLock 失敗', err);
    }
  }

  dispose(): void {
    this.doc.removeEventListener('pointerlockchange', this.handleChange);
    this.doc.removeEventListener('pointerlockerror', this.handleError);
  }

  private async doRequest(): Promise<boolean> {
    const req = this.target.requestPointerLock!.bind(this.target);
    this.requestRaw = false;
    try {
      if (this.config.preferRawInput) {
        try {
          const r = req({ unadjustedMovement: true });
          if (r && typeof (r as Promise<void>).then === 'function') {
            this.promiseApi = true;
            await r;
            this.requestRaw = true;
          }
          // 舊版 API 不回傳 Promise：無法得知是否為原始輸入，視為一般鎖定（啟用跳動過濾）。
        } catch (err) {
          if (!isNotSupported(err) && !(err instanceof TypeError)) throw err;
          console.info('[shardwake] 不支援原始滑鼠輸入（unadjustedMovement），改用一般鎖定');
          const r = req();
          if (r && typeof (r as Promise<void>).then === 'function') {
            this.promiseApi = true;
            await r;
          }
        }
      } else {
        const r = req();
        if (r && typeof (r as Promise<void>).then === 'function') {
          this.promiseApi = true;
          await r;
        }
      }
    } catch (err) {
      this.fail(errorMessage(err));
      return false;
    }
    // Promise 版：resolve 時已鎖定。舊版：等 pointerlockchange（鎖定與否由事件決定）。
    if (this.locked) {
      if (this.rawInput !== this.requestRaw) {
        this.rawInput = this.requestRaw;
        this.bus?.emit('input:pointerlock', { locked: true, raw: this.rawInput });
      }
      return true;
    }
    const ok = await this.waitForChange();
    if (!ok) this.fail('滑鼠鎖定失敗');
    return ok;
  }

  /** 舊版 API（或 Promise 先於事件 resolve）：等 pointerlockchange 或 pointerlockerror（最多 1 秒）。 */
  private waitForChange(): Promise<boolean> {
    return new Promise((resolve) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const done = (): void => {
        if (timer !== undefined) clearTimeout(timer);
        this.doc.removeEventListener('pointerlockchange', done);
        this.doc.removeEventListener('pointerlockerror', done);
        resolve(this.locked);
      };
      this.doc.addEventListener('pointerlockchange', done);
      this.doc.addEventListener('pointerlockerror', done);
      timer = setTimeout(done, 1000);
    });
  }

  private fail(message: string): void {
    this.lastError = message;
    this.bus?.emit('input:pointerlock', { locked: this.locked, raw: this.rawInput, error: message });
    this.onError?.(message);
  }

  private readonly handleChange = (): void => {
    const locked = this.locked;
    if (locked === this.wasLocked) return;
    this.wasLocked = locked;
    let intentional = false;
    if (locked) {
      this.lastError = null;
      this.rawInput = this.requestRaw;
    } else {
      intentional = this.expectingUnlock;
      this.expectingUnlock = false;
      this.rawInput = false;
      this.lastUnlockAt = this.now();
    }
    this.bus?.emit('input:pointerlock', { locked, raw: this.rawInput });
    this.onChange?.(locked, intentional);
  };

  private readonly handleError = (): void => {
    // Promise 版的失敗由 doRequest 回報，避免重複（Chrome 在 Promise reject 之後還會發出 pointerlockerror）。
    if (this.pending || this.promiseApi) return;
    this.fail('滑鼠鎖定失敗');
  };
}
