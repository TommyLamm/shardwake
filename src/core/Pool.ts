// 泛型物件池：預先或按需建立物件，acquire／release 重複使用，熱迴圈不配置記憶體。
// 用盡（使用中數量達 max）時的策略：
//   'recycleOldest'：強制回收最早取出、仍在使用中的物件（適合彈孔、粒子、傷害數字）。
//   'reject'：回傳 null，由呼叫端決定略過（適合不可被搶走的物件）。

export type PoolExhaustedPolicy = 'recycleOldest' | 'reject';

export interface PoolOptions<T> {
  create: () => T;
  /** 物件被取出前（acquire 時）呼叫，重設狀態。 */
  reset?: (obj: T) => void;
  /** 物件歸還時呼叫（例如從場景隱藏）。被強制回收時也會先呼叫。 */
  onRelease?: (obj: T) => void;
  /** 最多同時存在的物件數。 */
  max: number;
  /** 預先建立的數量（≤ max）。 */
  initial?: number;
  whenExhausted?: PoolExhaustedPolicy;
}

export class Pool<T> {
  private readonly free: T[] = [];
  /** 使用中的物件；Set 依插入順序迭代，第一個就是最舊的。 */
  private readonly active = new Set<T>();
  private created = 0;
  private readonly policy: PoolExhaustedPolicy;
  /** 強制回收的累計次數（調參面板可監看，太多代表 max 太小）。 */
  recycledCount = 0;
  /** 因用盡而拒絕的累計次數。 */
  rejectedCount = 0;

  constructor(private readonly options: PoolOptions<T>) {
    if (!Number.isInteger(options.max) || options.max < 1) throw new Error('Pool.max 必須是 ≥ 1 的整數');
    this.policy = options.whenExhausted ?? 'recycleOldest';
    const initial = Math.min(options.initial ?? 0, options.max);
    for (let i = 0; i < initial; i++) {
      this.free.push(options.create());
      this.created++;
    }
  }

  get max(): number {
    return this.options.max;
  }

  get activeCount(): number {
    return this.active.size;
  }

  get freeCount(): number {
    return this.free.length;
  }

  /** 已建立的物件總數（使用中 + 閒置）。 */
  get size(): number {
    return this.created;
  }

  /** 取出一個物件；用盡且策略為 reject 時回傳 null。 */
  acquire(): T | null {
    let obj: T | undefined = this.free.pop();
    if (obj === undefined) {
      if (this.created < this.options.max) {
        obj = this.options.create();
        this.created++;
      } else if (this.policy === 'recycleOldest' && this.active.size > 0) {
        obj = this.active.values().next().value as T;
        this.active.delete(obj);
        this.options.onRelease?.(obj);
        this.recycledCount++;
      } else {
        this.rejectedCount++;
        return null;
      }
    }
    this.options.reset?.(obj);
    this.active.add(obj);
    return obj;
  }

  /** 歸還物件；不屬於使用中的物件（重複歸還）回傳 false。 */
  release(obj: T): boolean {
    if (!this.active.delete(obj)) return false;
    this.options.onRelease?.(obj);
    this.free.push(obj);
    return true;
  }

  releaseAll(): void {
    for (const obj of this.active) {
      this.options.onRelease?.(obj);
      this.free.push(obj);
    }
    this.active.clear();
  }

  isActive(obj: T): boolean {
    return this.active.has(obj);
  }

  /** 依取出順序（舊到新）走訪使用中的物件。回呼內可以 release 目前的物件。 */
  forEachActive(fn: (obj: T) => void): void {
    for (const obj of this.active) fn(obj);
  }
}
