// 固定步長模擬迴圈（純邏輯，可單元測試）。
// 每個渲染畫面呼叫 advance(realDt, step)：
//   1. realDt 夾在 [0, maxFrameDt]（切分頁回來不爆衝）。
//   2. 乘上 timeScale（慢動作）後加入累加器。
//   3. 以固定 stepDt 執行 step()，每畫面最多 maxStepsPerFrame 步；超過的時間捨棄（防死亡螺旋）。
//   4. alpha = 累加器剩餘 / stepDt，供渲染在上一步與這一步之間插值。
// 模擬永遠以相同的 stepDt 前進，所以相同總時間（不論畫面更新率）得到相同步數與相同狀態。
// 實際驅動：Game.frame() 由 renderer.setAnimationLoop 每畫面呼叫。
import { LOOP_CONFIG, type FixedLoopConfig } from '@/core/config';

/** 浮點累加的容差：避免 60 × (1/60) 這類累加誤差少算一步。 */
const STEP_EPSILON = 1e-9;

export class FixedLoop {
  /** 慢動作倍率；0 = 凍結模擬，1 = 正常。 */
  timeScale = 1;
  /** 本畫面插值係數，範圍 [0, 1)。 */
  alpha = 0;
  /** 已執行的模擬步數。 */
  stepCount = 0;
  /** 已模擬的時間（秒）= stepCount × stepDt（調整 hz 後依實際步長累加）。 */
  simTime = 0;
  /** 上一畫面夾住後的真實 dt（未乘 timeScale）。 */
  lastRealDt = 0;
  /** 上一畫面的模擬 dt（夾住後乘 timeScale）。 */
  lastScaledDt = 0;
  /** 上一畫面執行的步數。 */
  lastSteps = 0;
  /** 因每畫面步數上限而捨棄的累計時間（秒），供除錯顯示。 */
  droppedTime = 0;

  private accumulator = 0;

  constructor(readonly config: FixedLoopConfig = { ...LOOP_CONFIG }) {}

  /** 固定步長（秒），由 config.hz 決定。 */
  get stepDt(): number {
    return 1 / this.config.hz;
  }

  /**
   * 推進一個渲染畫面。
   * @param realDt 這個畫面的真實經過時間（秒）
   * @param step 每個固定步呼叫一次，參數為 stepDt
   * @returns 本畫面執行的步數
   */
  advance(realDt: number, step: (dt: number) => void): number {
    const { maxStepsPerFrame } = this.config;
    const dt = this.clampFrameDt(realDt);
    const scale = Number.isFinite(this.timeScale) ? Math.max(this.timeScale, 0) : 0;
    this.lastRealDt = dt;
    this.lastScaledDt = dt * scale;
    this.accumulator += this.lastScaledDt;

    const stepDt = this.stepDt;
    let steps = 0;
    while (this.accumulator >= stepDt - STEP_EPSILON && steps < maxStepsPerFrame) {
      step(stepDt);
      this.accumulator -= stepDt;
      this.stepCount++;
      this.simTime += stepDt;
      steps++;
    }
    if (this.accumulator < 0) this.accumulator = 0;
    if (this.accumulator >= stepDt) {
      // 步數上限觸發：只保留不足一步的餘數，捨棄其餘時間。
      const keep = this.accumulator % stepDt;
      this.droppedTime += this.accumulator - keep;
      this.accumulator = keep;
    }
    this.alpha = Math.min(this.accumulator / stepDt, 1 - Number.EPSILON);
    this.lastSteps = steps;
    return steps;
  }

  /**
   * 不推進模擬的畫面（暫停、標題）：只記錄夾住後的真實 dt。
   * 累加器與 alpha 保持不變，恢復後畫面插值無縫接續。
   */
  idle(realDt: number): void {
    this.lastRealDt = this.clampFrameDt(realDt);
    this.lastScaledDt = 0;
    this.lastSteps = 0;
  }

  /** 把真實 dt 夾在 [0, maxFrameDt]；NaN／Infinity 視為 0。 */
  clampFrameDt(realDt: number): number {
    return Number.isFinite(realDt) ? Math.min(Math.max(realDt, 0), this.config.maxFrameDt) : 0;
  }

  /** 清空累加器（例如暫停後恢復、重設關卡），不影響步數統計。 */
  resetAccumulator(): void {
    this.accumulator = 0;
    this.alpha = 0;
  }

  /** 完整重設統計與累加器。 */
  reset(): void {
    this.resetAccumulator();
    this.stepCount = 0;
    this.simTime = 0;
    this.droppedTime = 0;
    this.lastRealDt = 0;
    this.lastScaledDt = 0;
    this.lastSteps = 0;
  }
}
