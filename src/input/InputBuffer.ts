// 通用輸入緩衝：觸發（通常是某動作的 pressed）後保留，直到被消耗或逾時。
// 例如跳躍緩衝：空中按跳，0.15 s 內落地仍會起跳（M1-05）。
//
// 用法（每個固定步，在讀取前先更新）：
//   jumpBuffer.updateFrom(dt, frame, 'jump');
//   if (grounded && jumpBuffer.consume()) jump();
//
// 時間以模擬秒累計（每步加 dt），與畫面更新率無關、可確定重播。
// 觸發當步的年齡為 0；年齡 ≤ window 時仍有效（120 Hz、0.15 s → 觸發後第 18 步仍有效，第 19 步失效）。
import { ACTION_BIT, type Action } from '@/input/Actions';
import type { InputFrame } from '@/input/InputFrame';

const EPS = 1e-9;

export class InputBuffer {
  private age = Number.POSITIVE_INFINITY;
  private readonly getWindow: () => number;

  /** windowSec：保留時間（秒），可傳函式讓它跟著設定資料（調參面板）變動。 */
  constructor(windowSec: number | (() => number)) {
    this.getWindow = typeof windowSec === 'function' ? windowSec : () => windowSec;
  }

  get window(): number {
    return this.getWindow();
  }

  /** 是否有尚未消耗、未逾時的觸發。 */
  get active(): boolean {
    return this.age <= this.getWindow() + EPS;
  }

  /** 觸發後經過的模擬時間（秒；沒有觸發時為 Infinity）。 */
  get elapsed(): number {
    return this.age;
  }

  /** 每個固定步呼叫一次：triggered 時重新開始計時，否則年齡增加 dt。 */
  update(dt: number, triggered: boolean): void {
    if (triggered) this.age = 0;
    else if (this.age !== Number.POSITIVE_INFINITY) this.age += dt;
  }

  /** 以 InputFrame 中某動作的 pressed 位元更新。 */
  updateFrom(dt: number, frame: Readonly<InputFrame>, action: Action): void {
    this.update(dt, (frame.pressed & ACTION_BIT[action]) !== 0);
  }

  /** 直接觸發（年齡歸零）。 */
  push(): void {
    this.age = 0;
  }

  /** 有效時消耗並回傳 true；否則回傳 false。 */
  consume(): boolean {
    if (!this.active) return false;
    this.age = Number.POSITIVE_INFINITY;
    return true;
  }

  clear(): void {
    this.age = Number.POSITIVE_INFINITY;
  }
}
