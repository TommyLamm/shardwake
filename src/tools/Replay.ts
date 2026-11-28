// 輸入錄製與確定性重播（M1-15；Game 系統 'replay'，order 在關卡之後、鏡頭之前）。
//
// 錄製（F8）：host.captureStart() 擷取起始狀態後立即 host.applyStart() 還原（正規化：結果只依起始狀態決定），
//   之後每個固定步記下 input.frame（不含暫停、調參面板、錄製／重播鍵），每 pathStride 步記下腳底位置，並記錄移動事件。
// 重播（F9）：host.applyStart(clip.start) 回到同一個起始狀態，模擬頻率暫時切成錄影的頻率，
//   InputSystem 的外部來源每步換成錄影的 InputFrame（視角也由錄影決定，滑鼠與按鍵不影響）；
//   畫面更新率、慢動作都不影響結果（固定步）。重播前可以改參數（調參面板、預設組合）比較差異。
// 鬼影：重播時同時記下新路徑；每步在原始路徑上（往前 matchWindowSteps 步內）找最近點，
//   時間差 = 現在的步數 − 那個點的步數（正值 = 比原始慢）。結束時回報終點位置差。
// 壓槍吸收（M1-10）會在固定步中改寫玩家視角：錄影記的是每步開始時的玩家視角（已含前幾步的吸收量），
//   重播時直接採用錄影的視角，吸收量由同樣的後座狀態重新計算，所以參數不變時逐步一致（tests/replay.test.ts 驗證）；
//   改了後座參數再重播時，視角仍照錄影（不會因為新的後座而重新壓槍），屬預期行為。
import type { EventBus } from '@/core/EventBus';
import type { GameEvents } from '@/core/events';
import type { FixedLoop } from '@/core/FixedLoop';
import { SystemOrder, type GameSystem } from '@/core/Game';
import type { InputFrame } from '@/input/InputFrame';
import type { Vec3Like } from '@/physics/Physics';
import {
  CLIP_FORMAT,
  CLIP_VERSION,
  FrameBuffer,
  readFrame,
  roundPath,
  validateClip,
  type DecodedFrames,
  type InputClip,
  type ReplayStart,
} from '@/tools/clip';
import { TOOLS_CONFIG, type ReplayToolConfig } from '@/tools/ToolsConfig';
import type { TuningValues } from '@/tools/tuning';

/** 錄製與重播需要的遊戲介面（tools/replayHost.ts 以遊戲物件實作；測試可替換）。 */
export interface ReplayHost {
  /** 目前關卡 id（沒有關卡時為 null）。 */
  readonly levelId: string | null;
  /** 現在能不能錄製／重播（遊玩中、玩家控制中）。 */
  canRun(): boolean;
  captureStart(): ReplayStart;
  /** 把模擬狀態設成起始狀態；必須只依 start 決定結果。 */
  applyStart(start: Readonly<ReplayStart>): void;
  /** 腳底位置（路徑與終點）。 */
  getFeet(): Readonly<Vec3Like> | null;
  /** 重播期間覆寫影響模擬的設定（null = 還原玩家設定）。 */
  setSimSettings(s: Readonly<{ autoSprint: boolean }> | null): void;
  /** 目前與預設不同的調參數值（存進錄影）。 */
  getTuningDiff(): TuningValues;
}

/** InputSystem 的必要部分。 */
export interface ReplayInput {
  readonly frame: Readonly<InputFrame>;
  setFrameSource(source: ((out: InputFrame) => boolean) | null): void;
}

export type ReplayPhase = 'idle' | 'recording' | 'replaying';

export interface ReplayResult {
  /** 是否播完（false = 中途停止）。 */
  completed: boolean;
  steps: number;
  /** 終點與錄影終點的距離（m；中途停止時為 null）。 */
  finalError: number | null;
  /** 最後的鬼影時間差（s）。 */
  timeDelta: number;
  /** 重播過程中絕對值最大的時間差（s，帶正負號）。 */
  peakTimeDelta: number;
  /** 重播中發生的移動事件。 */
  marks: [number, string][];
}

export interface ReplaySystemOptions {
  input: ReplayInput;
  loop: Pick<FixedLoop, 'config'>;
  host: ReplayHost;
  bus?: EventBus<GameEvents> | undefined;
  config?: ReplayToolConfig;
  gameVersion?: string;
  now?: () => Date;
}

/** 記成 marks 的移動事件（名稱去掉 'player:'）。 */
export const MARK_EVENTS = [
  'player:slideStart',
  'player:wallRunStart',
  'player:wallJump',
  'player:mantle',
  'player:doubleJump',
  'player:jetStart',
  'player:dash',
  'player:grappleAttach',
  'player:grappleRelease',
  'player:respawn',
] as const satisfies readonly (keyof GameEvents)[];

export class ReplaySystem implements GameSystem {
  readonly name = 'replay';
  readonly order = SystemOrder.world + 50;
  readonly config: ReplayToolConfig;

  private _phase: ReplayPhase = 'idle';
  // 錄製
  private buffer: FrameBuffer | null = null;
  private recStart: ReplayStart | null = null;
  private recPath: number[] = [];
  private recStride = 4;
  private recMarks: [number, string][] = [];
  private recHz = 120;
  private pendingName: string | null = null;
  // 目前的錄影（最後錄的或載入的）
  private _clip: InputClip | null = null;
  private frames: DecodedFrames | null = null;
  // 重播
  private cursor = 0;
  private savedHz: number | null = null;
  private replayMarks: [number, string][] = [];
  /** 重播時的新路徑（與 clip.path 同取樣）。 */
  readonly newPath: number[] = [];
  private matchIndex = 0;
  private _timeDelta = 0;
  private peakDelta = 0;
  private _lastResult: ReplayResult | null = null;
  private readonly unsubs: (() => void)[] = [];
  private readonly listeners = new Set<(phase: ReplayPhase, result: ReplayResult | null) => void>();
  /** 鬼影資料版本（路徑改變時加一，畫面依此更新幾何）。 */
  revision = 0;
  /** 是否顯示鬼影（重播開始時打開，clearGhost() 關閉）。 */
  ghostVisible = false;

  private readonly source = (out: InputFrame): boolean => {
    const f = this.frames;
    if (!f || this.cursor >= f.steps) return false;
    readFrame(f, this.cursor++, out);
    return true;
  };

  constructor(private readonly options: ReplaySystemOptions) {
    this.config = options.config ?? TOOLS_CONFIG.replay;
    const bus = options.bus;
    if (bus) {
      for (const name of MARK_EVENTS) this.unsubs.push(bus.on(name, () => this.mark(name.slice('player:'.length))));
      this.unsubs.push(
        bus.on('game:mode', ({ to }) => {
          if (to === 'title') this.stop('mode');
        }),
        bus.on('level:unloaded', () => this.stop('level')),
      );
    }
  }

  get phase(): ReplayPhase {
    return this._phase;
  }

  get recording(): boolean {
    return this._phase === 'recording';
  }

  get replaying(): boolean {
    return this._phase === 'replaying';
  }

  /** 目前的錄影（最後錄的或載入的）。 */
  get clip(): InputClip | null {
    return this._clip;
  }

  /** 錄製中的長度（s）。 */
  get recordedSeconds(): number {
    return this.buffer ? this.buffer.steps / this.recHz : 0;
  }

  /** 重播進度（步）。 */
  get replayStep(): number {
    return this.cursor;
  }

  /** 鬼影時間差（s；正值 = 比原始慢）。 */
  get timeDelta(): number {
    return this._timeDelta;
  }

  get lastResult(): ReplayResult | null {
    return this._lastResult;
  }

  /** 鬼影：原始路徑上對應目前位置的點（路徑點索引）。 */
  get ghostIndex(): number {
    const clip = this._clip;
    if (!clip) return 0;
    const n = clip.path.points.length / 3;
    return Math.min(n - 1, Math.floor(this.cursor / clip.path.stride));
  }

  /** 狀態改變（開始／停止錄製、重播開始／結束）時通知；回傳取消函式。 */
  onChange(listener: (phase: ReplayPhase, result: ReplayResult | null) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** 載入錄影（物件或 JSON 文字）；不合法時回傳錯誤。重播中不能載入。 */
  load(input: unknown): { ok: boolean; errors: string[] } {
    if (this._phase !== 'idle') return { ok: false, errors: ['錄製或重播中，請先停止'] };
    const v = validateClip(input);
    if (!v.ok || !v.clip || !v.frames) return { ok: false, errors: v.errors };
    this._clip = v.clip;
    this.frames = v.frames;
    this.newPath.length = 0;
    this.ghostVisible = false;
    this.revision++;
    return { ok: true, errors: [] };
  }

  // ── 錄製 ───────────────────────────────────────────────

  startRecording(name?: string): boolean {
    if (this._phase === 'replaying') return false;
    if (this._phase === 'recording') return true;
    const host = this.options.host;
    if (!host.canRun() || host.levelId === null) return false;
    const start = host.captureStart();
    host.applyStart(start);
    this.recStart = JSON.parse(JSON.stringify(start)) as ReplayStart;
    this.buffer = new FrameBuffer();
    this.recHz = this.options.loop.config.hz;
    this.recStride = Math.max(1, Math.floor(this.config.pathStride));
    this.recPath = [];
    this.recMarks = [];
    this.pushPoint(this.recPath, host.getFeet());
    this.pendingName = name ?? null;
    this.ghostVisible = false;
    this.newPath.length = 0;
    this.revision++;
    this.setPhase('recording', null);
    return true;
  }

  /** 停止錄製並把結果設成目前的錄影；沒有在錄製時回傳 null。 */
  stopRecording(): InputClip | null {
    if (this._phase !== 'recording' || !this.buffer || !this.recStart) return null;
    const host = this.options.host;
    const buf = this.buffer;
    const feet = host.getFeet();
    const n = buf.steps;
    // 路徑終點：最後一步若不在取樣點上，補上終點。
    if (n % this.recStride !== 0) this.pushPoint(this.recPath, feet);
    const date = (this.options.now ?? (() => new Date()))();
    const clip: InputClip = {
      format: CLIP_FORMAT,
      version: CLIP_VERSION,
      name: this.pendingName ?? `錄影 ${date.toLocaleTimeString('zh-TW', { hour12: false })}`,
      ...(this.options.gameVersion ? { gameVersion: this.options.gameVersion } : {}),
      createdAt: date.toISOString(),
      hz: this.recHz,
      steps: n,
      start: this.recStart,
      frames: buf.encode(),
      path: { stride: this.recStride, points: this.recPath },
      final: { pos: feet ? [feet.x, feet.y, feet.z] : [0, 0, 0] },
      marks: this.recMarks,
      tuning: host.getTuningDiff(),
    };
    this.buffer = null;
    this.recStart = null;
    this._phase = 'idle';
    // 經過 validateClip 解碼，確保之後重播用的資料與匯出／匯入後的完全相同。
    const r = this.load(JSON.parse(JSON.stringify(clip)));
    if (!r.ok) console.warn(`[shardwake] 錄影編碼失敗：${r.errors.join('；')}`);
    this.setPhase('idle', null);
    return r.ok ? this._clip : null;
  }

  // ── 重播 ───────────────────────────────────────────────

  /** 開始重播目前的錄影（錄製中會先停止錄製）。 */
  startReplay(): { ok: boolean; error?: string } {
    if (this._phase === 'recording') this.stopRecording();
    if (this._phase === 'replaying') return { ok: true };
    const clip = this._clip;
    const host = this.options.host;
    if (!clip || !this.frames) return { ok: false, error: '沒有錄影' };
    if (!host.canRun()) return { ok: false, error: '目前不能重播' };
    if (host.levelId !== clip.start.levelId) return { ok: false, error: `錄影的關卡「${clip.start.levelId}」與目前的關卡不同` };
    const loopCfg = this.options.loop.config;
    this.savedHz = loopCfg.hz !== clip.hz ? loopCfg.hz : null;
    loopCfg.hz = clip.hz;
    host.setSimSettings(clip.start.settings);
    host.applyStart(clip.start);
    this.cursor = 0;
    this.matchIndex = 0;
    this._timeDelta = 0;
    this.peakDelta = 0;
    this.replayMarks = [];
    this.newPath.length = 0;
    this.pushPoint(this.newPath, host.getFeet());
    this.ghostVisible = true;
    this.revision++;
    this.options.input.setFrameSource(this.source);
    this.setPhase('replaying', null);
    if (this.frames.steps === 0) this.finishReplay(true);
    return { ok: true };
  }

  /** 停止錄製或重播（reason 只用於除錯）。 */
  stop(_reason = 'user'): void {
    if (this._phase === 'recording') this.stopRecording();
    else if (this._phase === 'replaying') this.finishReplay(false);
  }

  /** 隱藏鬼影路徑。 */
  clearGhost(): void {
    this.ghostVisible = false;
    this.revision++;
  }

  fixedUpdate(): void {
    if (this._phase === 'recording') {
      const buf = this.buffer!;
      buf.push(this.options.input.frame);
      if (buf.steps % this.recStride === 0) this.pushPoint(this.recPath, this.options.host.getFeet());
      if (buf.steps >= this.config.maxSeconds * this.recHz) this.stopRecording();
      return;
    }
    if (this._phase !== 'replaying') return;
    const clip = this._clip!;
    const steps = this.cursor;
    const stride = clip.path.stride;
    const feet = this.options.host.getFeet();
    // 鬼影時間差只在取樣步更新（與原始路徑點對齊，相同軌跡時剛好為 0）。
    if (steps % stride === 0) {
      this.pushPoint(this.newPath, feet);
      if (feet) this.updateTimeDelta(feet, steps, clip);
      this.revision++;
    }
    if (steps >= this.frames!.steps) this.finishReplay(true);
  }

  dispose(): void {
    this.stop('dispose');
    for (const off of this.unsubs.splice(0)) off();
    this.listeners.clear();
  }

  // ── 內部 ───────────────────────────────────────────────

  private finishReplay(completed: boolean): void {
    const clip = this._clip;
    const host = this.options.host;
    this.options.input.setFrameSource(null);
    if (this.savedHz !== null) this.options.loop.config.hz = this.savedHz;
    this.savedHz = null;
    host.setSimSettings(null);
    const feet = host.getFeet();
    if (completed && feet && clip && this.cursor % clip.path.stride !== 0) {
      this.pushPoint(this.newPath, feet);
      this.updateTimeDelta(feet, this.cursor, clip);
    }
    const fp = clip?.final.pos;
    const finalError = completed && feet && fp ? Math.hypot(feet.x - fp[0], feet.y - fp[1], feet.z - fp[2]) : null;
    const result: ReplayResult = { completed, steps: this.cursor, finalError, timeDelta: this._timeDelta, peakTimeDelta: this.peakDelta, marks: this.replayMarks };
    this._lastResult = result;
    this.revision++;
    this.setPhase('idle', result);
  }

  private updateTimeDelta(feet: Readonly<Vec3Like>, step: number, clip: InputClip): void {
    const pts = clip.path.points;
    const n = pts.length / 3;
    if (n === 0) return;
    const stride = clip.path.stride;
    const window = Math.max(1, Math.ceil(this.config.matchWindowSteps / stride));
    let best = this.matchIndex;
    let bestD = Number.POSITIVE_INFINITY;
    const end = Math.min(n - 1, this.matchIndex + window);
    // 原始路徑點 i 對應第 i × stride 步（最後一點是終點 clip.steps）。
    const stepOf = (i: number): number => (i === n - 1 ? clip.steps : Math.min(i * stride, clip.steps));
    // 距離相同（例如站著不動時好幾個點重疊）時，選步數最接近現在的點。
    const TIE = 1e-8;
    for (let i = Math.max(0, this.matchIndex - 1); i <= end; i++) {
      const dx = pts[i * 3]! - feet.x;
      const dy = pts[i * 3 + 1]! - feet.y;
      const dz = pts[i * 3 + 2]! - feet.z;
      const d = dx * dx + dy * dy + dz * dz;
      if (d < bestD - TIE || (Math.abs(d - bestD) <= TIE && Math.abs(stepOf(i) - step) < Math.abs(stepOf(best) - step))) {
        bestD = Math.min(d, bestD);
        best = i;
      }
    }
    this.matchIndex = best;
    this._timeDelta = (step - stepOf(best)) / clip.hz;
    if (Math.abs(this._timeDelta) > Math.abs(this.peakDelta)) this.peakDelta = this._timeDelta;
  }

  private pushPoint(path: number[], feet: Readonly<Vec3Like> | null): void {
    if (!feet) return;
    path.push(roundPath(feet.x), roundPath(feet.y), roundPath(feet.z));
  }

  private mark(name: string): void {
    if (this._phase === 'recording' && this.buffer) this.recMarks.push([this.buffer.steps, name]);
    else if (this._phase === 'replaying') this.replayMarks.push([Math.max(0, this.cursor - 1), name]);
  }

  private setPhase(phase: ReplayPhase, result: ReplayResult | null): void {
    this._phase = phase;
    for (const l of [...this.listeners]) l(phase, result);
  }
}

/** 「必要事件依序出現」檢查（示範連招驗證）：回傳缺少的第一個事件；全部依序出現時回傳 null。 */
export function missingSequence(marks: readonly (readonly [number, string])[], sequence: readonly string[]): string | null {
  let i = 0;
  for (const [, name] of marks) {
    if (i < sequence.length && name === sequence[i]) i++;
  }
  return i < sequence.length ? sequence[i]! : null;
}
