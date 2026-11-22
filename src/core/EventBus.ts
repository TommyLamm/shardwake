// 型別安全的事件匯流排：emit 時同步派送給所有監聽者（依註冊順序）。
// 監聽者清單採寫入時複製（copy-on-write）：on／off 會配置新陣列，emit 不配置記憶體，
// 而且派送途中新增或移除監聽者不影響本次派送。
import type { GameEvents } from '@/core/events';

export type EventHandler<P> = (payload: P) => void;

/** payload 為 void 的事件可省略參數。 */
type EmitArgs<P> = [P] extends [void] ? [] | [payload?: P] : [payload: P];

export type ErrorReporter = (eventName: string, error: unknown) => void;

const defaultReporter: ErrorReporter = (name, error) => {
  console.error(`[shardwake] 事件「${name}」的監聽者丟出例外`, error);
};

export class EventBus<E extends object = GameEvents> {
  private readonly handlers = new Map<keyof E, readonly EventHandler<never>[]>();

  /** 監聽者丟出例外時呼叫；預設寫到主控台，不中斷其他監聽者。 */
  constructor(private readonly onError: ErrorReporter = defaultReporter) {}

  /** 註冊監聽者，回傳取消函式。同一個函式重複註冊只算一次。 */
  on<K extends keyof E>(name: K, handler: EventHandler<E[K]>): () => void {
    const list = this.handlers.get(name) ?? [];
    if (!list.includes(handler as EventHandler<never>)) {
      this.handlers.set(name, [...list, handler as EventHandler<never>]);
    }
    return () => this.off(name, handler);
  }

  /** 只觸發一次的監聽者。回傳的取消函式可在觸發前取消。 */
  once<K extends keyof E>(name: K, handler: EventHandler<E[K]>): () => void {
    const wrapper: EventHandler<E[K]> = (payload) => {
      this.off(name, wrapper);
      handler(payload);
    };
    return this.on(name, wrapper);
  }

  off<K extends keyof E>(name: K, handler: EventHandler<E[K]>): void {
    const list = this.handlers.get(name);
    if (!list) return;
    const next = list.filter((h) => h !== handler);
    if (next.length === 0) this.handlers.delete(name);
    else if (next.length !== list.length) this.handlers.set(name, next);
  }

  /** 同步派送；回傳收到事件的監聽者數量。 */
  emit<K extends keyof E>(name: K, ...args: EmitArgs<E[K]>): number {
    const list = this.handlers.get(name) as readonly EventHandler<E[K]>[] | undefined;
    if (!list) return 0;
    const payload = args[0] as E[K];
    for (let i = 0; i < list.length; i++) {
      try {
        list[i]!(payload);
      } catch (error) {
        this.onError(String(name), error);
      }
    }
    return list.length;
  }

  listenerCount<K extends keyof E>(name: K): number {
    return this.handlers.get(name)?.length ?? 0;
  }

  /** 移除某個事件（或全部事件）的所有監聽者。 */
  clear(name?: keyof E): void {
    if (name === undefined) this.handlers.clear();
    else this.handlers.delete(name);
  }
}
