// 畫面角落的 FPS／frame time（由設定 showFps 開關）。
// FrameTimeSampler 是純邏輯（可測試）：在取樣視窗內累計畫面間隔與每畫面 CPU 時間。
import { STATS_CONFIG, type StatsConfig } from '@/core/config';
import type { FrameInfo, GameSystem } from '@/core/Game';
import { SystemOrder } from '@/core/Game';

export interface FrameSample {
  /** 平均 FPS。 */
  fps: number;
  /** 平均畫面間隔（毫秒）。 */
  frameMs: number;
  /** 視窗內最長的畫面間隔（毫秒），抓卡頓用。 */
  maxFrameMs: number;
  /** 平均每畫面 CPU 時間（毫秒，主迴圈開始到 render 結束）。 */
  cpuMs: number;
}

export class FrameTimeSampler {
  private windowStart: number | null = null;
  private lastFrame: number | null = null;
  private frames = 0;
  private maxInterval = 0;
  private cpuTotal = 0;
  readonly latest: FrameSample = { fps: 0, frameMs: 0, maxFrameMs: 0, cpuMs: 0 };

  constructor(readonly config: StatsConfig = STATS_CONFIG) {}

  /**
   * 記錄一個畫面。nowMs 為畫面開始時間，cpuMs 為該畫面的工作時間。
   * 取樣視窗結束時更新 latest 並回傳 true。
   */
  record(nowMs: number, cpuMs = 0): boolean {
    if (this.lastFrame !== null) this.maxInterval = Math.max(this.maxInterval, nowMs - this.lastFrame);
    this.lastFrame = nowMs;
    if (this.windowStart === null) {
      this.windowStart = nowMs;
      return false;
    }
    this.frames++;
    this.cpuTotal += cpuMs;
    const elapsed = nowMs - this.windowStart;
    if (elapsed < this.config.sampleMs) return false;
    const s = this.latest;
    s.fps = (this.frames * 1000) / elapsed;
    s.frameMs = elapsed / this.frames;
    s.maxFrameMs = this.maxInterval;
    s.cpuMs = this.cpuTotal / this.frames;
    this.windowStart = nowMs;
    this.frames = 0;
    this.maxInterval = 0;
    this.cpuTotal = 0;
    return true;
  }

  /** 中斷取樣（例如切分頁回來），避免把離開的時間算進去。 */
  reset(): void {
    this.windowStart = null;
    this.lastFrame = null;
    this.frames = 0;
    this.maxInterval = 0;
    this.cpuTotal = 0;
  }
}

export function formatFrameSample(s: Readonly<FrameSample>): string {
  return `FPS ${s.fps.toFixed(0).padStart(3, ' ')}  ${s.frameMs.toFixed(2)} ms\nmax ${s.maxFrameMs.toFixed(1)} ms  cpu ${s.cpuMs.toFixed(2)} ms`;
}

export interface StatsOptions {
  container: HTMLElement;
  visible: boolean;
  now?: () => number;
}

/**
 * 角落 FPS 顯示。作為 Game 系統：update 階段（最前面）記下畫面開始時間，
 * render 階段（debug 順序，在 renderer.render 之後）計算 CPU 時間。
 */
export class StatsOverlay implements GameSystem {
  readonly name = 'stats';
  readonly order = SystemOrder.debug;
  readonly sampler: FrameTimeSampler;
  private readonly el: HTMLDivElement;
  private readonly now: () => number;
  private frameStart = 0;
  private _visible: boolean;

  constructor(options: StatsOptions, config: StatsConfig = STATS_CONFIG) {
    this.sampler = new FrameTimeSampler(config);
    this.now = options.now ?? (() => performance.now());
    this.el = document.createElement('div');
    this.el.className = 'sw-fps';
    this.el.textContent = 'FPS --';
    this._visible = options.visible;
    this.el.hidden = !options.visible;
    options.container.appendChild(this.el);
  }

  get visible(): boolean {
    return this._visible;
  }

  setVisible(visible: boolean): void {
    this._visible = visible;
    this.el.hidden = !visible;
    if (visible) this.sampler.reset();
  }

  /** 由主迴圈在每個畫面最開始呼叫（Game.frame 之前）。 */
  beginFrame(nowMs: number = this.now()): void {
    this.frameStart = nowMs;
  }

  render(_alpha: number, _frame: Readonly<FrameInfo>): void {
    if (!this._visible) return;
    const end = this.now();
    if (this.sampler.record(this.frameStart, end - this.frameStart)) {
      this.el.textContent = formatFrameSample(this.sampler.latest);
    }
  }

  dispose(): void {
    this.el.remove();
  }
}
