// 固定容量的環狀配置（M1-11 特效池）：每次配置回傳下一個槽位，滿了就從最舊的開始覆蓋（不配置記憶體）。
// 彈孔（上限 96，循環覆蓋）、火花、曳光、爆炸都用它決定寫入 GPU 屬性的槽位。

export class RingAllocator {
  /** 下一個要寫入的槽位。 */
  head = 0;
  /** 已使用過的槽位數（≤ capacity；draw 的 instanceCount）。 */
  filled = 0;
  /** 累計配置次數（覆蓋次數 = total − capacity）。 */
  total = 0;

  constructor(readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1) throw new Error('RingAllocator.capacity 必須是 ≥ 1 的整數');
  }

  /** 配置一個槽位（滿了覆蓋最舊的）。 */
  next(): number {
    const i = this.head;
    this.head = (this.head + 1) % this.capacity;
    if (this.filled < this.capacity) this.filled++;
    this.total++;
    return i;
  }

  /** 被覆蓋過的次數。 */
  get overwritten(): number {
    return Math.max(0, this.total - this.capacity);
  }

  /** 最舊的有效槽位。 */
  get oldest(): number {
    return this.filled < this.capacity ? 0 : this.head;
  }

  reset(): void {
    this.head = 0;
    this.filled = 0;
    this.total = 0;
  }
}

/** 依機率決定要畫幾條（例如霰彈 10 顆彈丸、曳光機率 0.6 → 6 條）：以累積誤差分配，結果可重現、不用亂數。 */
export class FractionalCounter {
  private acc = 0;

  /** 這一次要不要畫（chance 0..1）。 */
  take(chance: number): boolean {
    if (chance >= 1) return true;
    if (!(chance > 0)) return false;
    this.acc += chance;
    if (this.acc >= 1 - 1e-9) {
      this.acc -= 1;
      return true;
    }
    return false;
  }

  /** 把 count × mult 取成整數，誤差累積到下一次（數量倍率：低畫質減量）。 */
  scale(count: number, mult: number): number {
    if (mult >= 1) return Math.max(0, Math.round(count * mult));
    const v = count * Math.max(0, mult) + this.acc;
    const n = Math.floor(v + 1e-9);
    this.acc = v - n;
    return n;
  }
}
