// `#demo` 示範（M1-15）：用標準參數重播內建錄影（src/debug/demo-clip.json），自動展示
// 「滑鏟 → 跑牆 → 蹬牆跳 → 二段跳 → Dash → 抓鉤」連招，供自動化驗證與截圖。
// 結果寫在 <html> 的 data-sw-demo（running／done／failed）、data-sw-demo-error（終點誤差 mm）、
// data-sw-demo-combo（ok 或缺少的第一個動作），主控台印出摘要。按 F9 可再看一次。
// 預設參數或關卡改動導致路線失準時（npm test 的示範檢查會失敗），執行 `npm run demo:record` 重新錄製。
import { missingSequence, type ReplayResult, type ReplaySystem } from '@/tools/Replay';
import { TOOLS_CONFIG, type DemoToolConfig } from '@/tools/ToolsConfig';

/** 示範必須依序出現的移動事件。 */
export const DEMO_COMBO = ['slideStart', 'wallRunStart', 'wallJump', 'doubleJump', 'dash', 'grappleAttach'] as const;

export type DemoState = 'idle' | 'running' | 'done' | 'failed';

export interface DemoReport {
  state: DemoState;
  /** 終點誤差（m）。 */
  finalError: number | null;
  /** 缺少的第一個連招動作（null = 全部依序出現）。 */
  missing: string | null;
  error?: string;
}

export interface DemoRunnerOptions {
  replay: ReplaySystem;
  /** 內建錄影（JSON 物件）。 */
  clip: unknown;
  /** 套用標準參數（「標準」預設組合）。 */
  applyStandard: () => void;
  /** 回報狀態（寫進 DOM 標記與提示訊息）。 */
  report: (r: Readonly<DemoReport>) => void;
  config?: DemoToolConfig;
}

export class DemoRunner {
  readonly config: DemoToolConfig;
  private _state: DemoState = 'idle';
  private watching = false;
  private last: DemoReport = { state: 'idle', finalError: null, missing: null };

  constructor(private readonly options: DemoRunnerOptions) {
    this.config = options.config ?? TOOLS_CONFIG.demo;
    options.replay.onChange((phase, result) => {
      if (!this.watching || phase !== 'idle' || !result) return;
      this.watching = false;
      this.finish(result);
    });
  }

  get state(): DemoState {
    return this._state;
  }

  get lastReport(): Readonly<DemoReport> {
    return this.last;
  }

  /** 載入內建錄影、套用標準參數並開始重播（必須已在遊玩模式）。 */
  start(): boolean {
    const r = this.options.replay;
    if (r.phase !== 'idle') r.stop('demo');
    this.options.applyStandard();
    const loaded = r.load(this.options.clip);
    if (!loaded.ok) return this.fail(`內建錄影不合法：${loaded.errors.join('；')}`);
    const started = r.startReplay();
    if (!started.ok) return this.fail(started.error ?? '無法開始重播');
    this._state = 'running';
    this.watching = true;
    this.emit({ state: 'running', finalError: null, missing: null });
    return true;
  }

  private finish(result: ReplayResult): void {
    const missing = missingSequence(result.marks, DEMO_COMBO);
    const ok = result.completed && missing === null && result.finalError !== null && result.finalError <= this.config.tolerance;
    this._state = ok ? 'done' : 'failed';
    this.emit({
      state: this._state,
      finalError: result.finalError,
      missing,
      ...(result.completed ? {} : { error: '示範被中斷' }),
    });
  }

  private fail(error: string): boolean {
    this._state = 'failed';
    this.emit({ state: 'failed', finalError: null, missing: null, error });
    return false;
  }

  private emit(r: DemoReport): void {
    this.last = r;
    this.options.report(r);
  }
}
