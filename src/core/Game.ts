// 遊戲主體：模式狀態機 + 系統註冊與生命週期 + 固定步長主迴圈。
//
// 模式：boot → title → playing ⇄ paused；playing／paused 可回 title（返回標題）。
//
// 系統生命週期（全部選填）：
//   init(game)        註冊時立即呼叫一次。
//   beginFrame()      每個渲染畫面最先呼叫（任何模式，在固定步之前）；滑鼠視角在這裡套用（M1-03），
//                     讓同一畫面的固定步與渲染都看到最新的 yaw／pitch，不多等一個畫面。
//   fixedUpdate(dt)   只在 playing 模式，每個固定步呼叫（dt = 1 / hz）。
//   update(dt, frame) 每個渲染畫面呼叫一次；dt 為模擬時間（夾住、乘 timeScale；非 playing 時為 0），
//                     frame.realDt 為夾住後的真實時間（UI 動畫等不受暫停影響的效果使用）。
//   render(alpha, frame) 每個渲染畫面最後呼叫；alpha 為固定步之間的插值係數。
//   dispose()         移除系統或 Game.dispose() 時呼叫（反向順序）。
//
// 執行順序（固定，三個階段都依 order 由小到大，同 order 依註冊先後）：
//   100 input    產生 InputFrame（M1-03）
//   200 player   移動、角色控制器（M1-05～M1-07）
//   300 weapons  武器邏輯（M1-10）
//   400 ai       敵人 AI（M3）
//   500 physics  Rapier world.step（M1-04）
//   600 combat   傷害結算、靶標（M1-12）
//   700 world    關卡、拾取、任務流程
//   800 camera   鏡頭（M1-08）
//   900 fx       特效、粒子
//  1000 audio    音效（M1-13）
//  1100 ui       HUD、選單（M1-14）
//  1200 render   renderer.render（M1-09 後處理）
//  1300 debug    Stats、調參面板（在 render 之後讀取 renderer.info）
// 每個畫面：先依序跑 beginFrame，再跑完所有 fixed step（每步內依序跑所有系統的 fixedUpdate），
// 再依序跑 update，最後依序跑 render。
import { EventBus } from '@/core/EventBus';
import type { GameEvents, GameMode, PauseReason } from '@/core/events';
import { FixedLoop } from '@/core/FixedLoop';
import { LOOP_CONFIG, type FixedLoopConfig } from '@/core/config';

export const SystemOrder = {
  input: 100,
  player: 200,
  weapons: 300,
  ai: 400,
  physics: 500,
  combat: 600,
  world: 700,
  camera: 800,
  fx: 900,
  audio: 1000,
  ui: 1100,
  render: 1200,
  debug: 1300,
} as const;

/** 每個渲染畫面的資訊（同一個物件重複使用，不要保存參考）。 */
export interface FrameInfo {
  /** 渲染畫面序號。 */
  frame: number;
  /** 夾住後的真實 dt（秒），不受 timeScale 與暫停影響。 */
  realDt: number;
  /** 模擬 dt（秒）：playing 時為 realDt × timeScale，其他模式為 0。 */
  dt: number;
  /** 本畫面執行的固定步數。 */
  steps: number;
  /** 插值係數 [0, 1)。 */
  alpha: number;
  /** 已模擬時間（秒）。 */
  simTime: number;
  mode: GameMode;
}

export interface GameSystem {
  /** 系統名稱（除錯與錯誤訊息用，需唯一）。 */
  readonly name: string;
  /** 執行順序，建議用 SystemOrder；預設 SystemOrder.world。 */
  readonly order?: number;
  init?(game: Game): void;
  beginFrame?(): void;
  fixedUpdate?(dt: number): void;
  update?(dt: number, frame: Readonly<FrameInfo>): void;
  render?(alpha: number, frame: Readonly<FrameInfo>): void;
  dispose?(): void;
}

/** 合法的模式切換。 */
const TRANSITIONS: Readonly<Record<GameMode, readonly GameMode[]>> = {
  boot: ['title'],
  title: ['playing'],
  playing: ['paused', 'title'],
  paused: ['playing', 'title'],
};

export function canTransition(from: GameMode, to: GameMode): boolean {
  return TRANSITIONS[from].includes(to);
}

export interface GameOptions {
  bus?: EventBus<GameEvents>;
  loop?: FixedLoopConfig;
}

interface Entry {
  system: GameSystem;
  order: number;
  seq: number;
}

export class Game {
  readonly bus: EventBus<GameEvents>;
  readonly loop: FixedLoop;

  private _mode: GameMode = 'boot';
  private _pauseReason: PauseReason | undefined;
  private entries: Entry[] = [];
  private seq = 0;
  private lastNow: number | null = null;
  private inFrame = false;
  private pending: (() => void)[] = [];
  private disposed = false;
  private readonly info: FrameInfo = { frame: 0, realDt: 0, dt: 0, steps: 0, alpha: 0, simTime: 0, mode: 'boot' };

  constructor(options: GameOptions = {}) {
    this.bus = options.bus ?? new EventBus<GameEvents>();
    this.loop = new FixedLoop(options.loop ?? { ...LOOP_CONFIG });
  }

  get mode(): GameMode {
    return this._mode;
  }

  /** 目前暫停的原因（不在 paused 時為 undefined）。 */
  get pauseReason(): PauseReason | undefined {
    return this._pauseReason;
  }

  get frameInfo(): Readonly<FrameInfo> {
    return this.info;
  }

  get systems(): readonly GameSystem[] {
    return this.entries.map((e) => e.system);
  }

  getSystem<T extends GameSystem>(name: string): T | undefined {
    return this.entries.find((e) => e.system.name === name)?.system as T | undefined;
  }

  // ── 模式 ───────────────────────────────────────────────

  /** 切換模式；不合法的切換回傳 false 且不改變狀態。 */
  setMode(to: GameMode, reason?: PauseReason): boolean {
    const from = this._mode;
    if (from === to || !canTransition(from, to)) return false;
    this._mode = to;
    this._pauseReason = to === 'paused' ? (reason ?? 'user') : undefined;
    // 從標題開始新的一局時清空累加器；從暫停恢復則保留（插值無縫接續）。
    if (from === 'title' && to === 'playing') this.loop.resetAccumulator();
    this.info.mode = to;
    this.bus.emit('game:mode', { from, to, reason: this._pauseReason });
    return true;
  }

  /** playing → paused；其他模式不動作。 */
  pause(reason: PauseReason = 'user'): boolean {
    return this._mode === 'playing' ? this.setMode('paused', reason) : false;
  }

  /** paused → playing。 */
  resume(): boolean {
    return this._mode === 'paused' ? this.setMode('playing') : false;
  }

  /** title → playing。 */
  start(): boolean {
    return this._mode === 'title' ? this.setMode('playing') : false;
  }

  togglePause(reason: PauseReason = 'user'): boolean {
    return this._mode === 'paused' ? this.resume() : this.pause(reason);
  }

  // ── 系統 ───────────────────────────────────────────────

  /** 註冊系統並立即呼叫 init。畫面進行中註冊時，延到下一畫面開始前加入。 */
  addSystem<T extends GameSystem>(system: T): T {
    if (this.disposed) throw new Error('Game 已釋放，無法註冊系統');
    if (this.entries.some((e) => e.system === system || e.system.name === system.name)) {
      throw new Error(`系統名稱重複：${system.name}`);
    }
    const run = (): void => {
      const entry: Entry = { system, order: system.order ?? SystemOrder.world, seq: this.seq++ };
      this.entries.push(entry);
      this.entries.sort((a, b) => a.order - b.order || a.seq - b.seq);
      system.init?.(this);
    };
    if (this.inFrame) this.pending.push(run);
    else run();
    return system;
  }

  /** 移除系統並呼叫 dispose。 */
  removeSystem(system: GameSystem): boolean {
    if (!this.entries.some((e) => e.system === system)) return false;
    const run = (): void => {
      const idx = this.entries.findIndex((e) => e.system === system);
      if (idx < 0) return;
      this.entries.splice(idx, 1);
      system.dispose?.();
    };
    if (this.inFrame) this.pending.push(run);
    else run();
    return true;
  }

  // ── 主迴圈 ─────────────────────────────────────────────

  /**
   * 推進一個渲染畫面。由 renderer.setAnimationLoop 呼叫，參數為時間戳（毫秒）。
   * 第一個畫面的 dt 為 0。回傳本畫面的固定步數。
   */
  frame = (nowMs: number): number => {
    if (this.disposed) return 0;
    this.flushPending();
    const realDt = this.lastNow === null ? 0 : (nowMs - this.lastNow) / 1000;
    this.lastNow = nowMs;
    return this.tick(realDt);
  };

  /** 以給定的真實 dt（秒）推進一個畫面（無頭測試與錄影重播用）。 */
  tick(realDt: number): number {
    if (this.disposed) return 0;
    this.flushPending();
    this.inFrame = true;
    const info = this.info;
    const loop = this.loop;
    let steps = 0;
    try {
      const pre = this.entries;
      for (let i = 0; i < pre.length; i++) pre[i]!.system.beginFrame?.();
      if (this._mode === 'playing') {
        steps = loop.advance(realDt, this.runFixedStep);
        info.dt = loop.lastScaledDt;
      } else {
        // 非遊玩模式：不推進模擬，但仍記錄真實 dt 給 UI；alpha 維持暫停前的值。
        loop.idle(realDt);
        info.dt = 0;
      }
      info.frame++;
      info.realDt = loop.lastRealDt;
      info.steps = steps;
      info.alpha = loop.alpha;
      info.simTime = loop.simTime;
      info.mode = this._mode;

      const entries = this.entries;
      for (let i = 0; i < entries.length; i++) entries[i]!.system.update?.(info.dt, info);
      for (let i = 0; i < entries.length; i++) entries[i]!.system.render?.(info.alpha, info);
    } finally {
      this.inFrame = false;
    }
    this.flushPending();
    return steps;
  }

  /** 讓下一個 frame() 的 dt 從 0 開始（例如切回分頁後由外部呼叫）。 */
  resetClock(): void {
    this.lastNow = null;
  }

  dispose(): void {
    if (this.disposed) return;
    this.flushPending();
    for (let i = this.entries.length - 1; i >= 0; i--) this.entries[i]!.system.dispose?.();
    this.entries = [];
    this.disposed = true;
  }

  private readonly runFixedStep = (dt: number): void => {
    const entries = this.entries;
    for (let i = 0; i < entries.length; i++) entries[i]!.system.fixedUpdate?.(dt);
  };

  private flushPending(): void {
    if (this.inFrame || this.pending.length === 0) return;
    const queue = this.pending;
    this.pending = [];
    for (const run of queue) run();
  }
}
