// 可重現的亂數產生器（mulberry32，32 位元狀態）。
// 相同種子得到相同序列；getState／setState 可保存與還原（錄影重播、程序生成用）。
// 遊戲邏輯中需要可重現的亂數一律用 Rng，不要用 Math.random。

/** 把字串雜湊成 32 位元種子（FNV-1a）。 */
export function hashSeed(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export class Rng {
  private state: number;

  constructor(seed: number | string = 0x5eed) {
    this.state = (typeof seed === 'string' ? hashSeed(seed) : seed) >>> 0;
  }

  /** 下一個 32 位元無號整數。 */
  nextUint32(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  }

  /** [0, 1) 的浮點數。 */
  float(): number {
    return this.nextUint32() / 4294967296;
  }

  /** [min, max) 的浮點數。 */
  range(min: number, max: number): number {
    return min + (max - min) * this.float();
  }

  /** [min, max] 的整數（含兩端）。 */
  int(min: number, max: number): number {
    const lo = Math.ceil(Math.min(min, max));
    const hi = Math.floor(Math.max(min, max));
    return lo + Math.floor(this.float() * (hi - lo + 1));
  }

  /** 以機率 p 回傳 true。 */
  chance(p: number): boolean {
    return this.float() < p;
  }

  /** 隨機回傳 1 或 -1。 */
  sign(): 1 | -1 {
    return this.float() < 0.5 ? -1 : 1;
  }

  /** 從陣列中均勻挑一個；空陣列回傳 undefined。 */
  pick<T>(items: readonly T[]): T | undefined {
    return items.length === 0 ? undefined : items[Math.floor(this.float() * items.length)];
  }

  /**
   * 依權重挑一個；權重 ≤ 0 或非有限值的項目不會被選中。全部無效時回傳 undefined。
   * weights 可以是與 items 對應的陣列，或取權重的函式。
   */
  weighted<T>(items: readonly T[], weights: readonly number[] | ((item: T, index: number) => number)): T | undefined {
    const weightOf = typeof weights === 'function' ? weights : (_: T, i: number) => weights[i] ?? 0;
    let total = 0;
    for (let i = 0; i < items.length; i++) {
      const w = weightOf(items[i]!, i);
      if (w > 0 && Number.isFinite(w)) total += w;
    }
    if (total <= 0) return undefined;
    let r = this.float() * total;
    let last: T | undefined;
    for (let i = 0; i < items.length; i++) {
      const w = weightOf(items[i]!, i);
      if (!(w > 0 && Number.isFinite(w))) continue;
      last = items[i];
      r -= w;
      if (r < 0) return last;
    }
    return last;
  }

  /** 原地洗牌（Fisher–Yates）。 */
  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(this.float() * (i + 1));
      const tmp = items[i]!;
      items[i] = items[j]!;
      items[j] = tmp;
    }
    return items;
  }

  /** 由目前序列衍生一個獨立的子產生器（例如每個房間各一個）。 */
  fork(): Rng {
    return new Rng(this.nextUint32());
  }

  getState(): number {
    return this.state;
  }

  setState(state: number): void {
    this.state = state >>> 0;
  }
}
