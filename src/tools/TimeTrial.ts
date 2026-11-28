// 跑酷計時賽（M1-15）：起點門 → 依序通過的環形檢查點 → 終點；分段時間、最佳成績（`shardwake:besttimes:v1`）。
//
// - 路線取自關卡的檢查點（course 'parkour'，依 order 排序）：第一個是起點門、最後一個是終點，中間依序通過。
// - 判定：每個固定步以「上一步 → 這一步」的身體中心線段與檢查點球（半徑 radius × radiusScale）求交，
//   進入球的那一刻（線段上的比例）換算成步內的精確時間，結果與步長、畫面更新率無關。只計「從外面進入」。
// - 起點：待命或完成後，從外面進入起點門就開始計時（時間從進入的那一刻算起）；終點同理停止。
// - 重來（restartCourse，預設 T）：在固定步讀 InputFrame（錄影會錄到，所以重播也會重來），把玩家送到路線起點、計時歸零。
// - 最佳成績：真實遊玩完成時更新（重播中預設不更新）；成績帶調參指紋，M5-05 排行榜只接受標準參數的成績。
import type { EventBus } from '@/core/EventBus';
import type { GameEvents } from '@/core/events';
import { SystemOrder, type GameSystem } from '@/core/Game';
import type { GameStorage } from '@/core/Storage';
import { wasPressed, type InputFrame } from '@/input/InputFrame';
import type { Vec3Like } from '@/physics/Physics';
import type { RespawnTarget } from '@/player/PlayerController';
import { TOOLS_CONFIG, type TrialToolConfig } from '@/tools/ToolsConfig';
import type { TimerState } from '@/ui/hudMath';
import type { Checkpoint } from '@/world/LevelData';

export const BEST_TIMES_KEY = 'besttimes:v1';
export const BEST_TIMES_VERSION = 1;
/** 成績格式版本（M5-05 排行榜上傳用）。 */
export const TRIAL_RESULT_VERSION = 1;

export interface CourseGate {
  id: string;
  /** 顯示名稱（HUD 分段）。 */
  label: string;
  center: { x: number; y: number; z: number };
  radius: number;
}

export interface CourseDef {
  id: string;
  name: string;
  /** gates[0] 為起點門，最後一個為終點。 */
  gates: CourseGate[];
  /** 重來時的位置（腳底）與面向（弧度）。 */
  restart: RespawnTarget;
}

/** 由關卡檢查點建立路線（course 相符、依 order 排序；少於 2 個時回傳 null）。 */
export function courseFromCheckpoints(
  checkpoints: readonly Checkpoint[],
  id: string,
  name: string,
  restart: RespawnTarget,
  label: (cp: Checkpoint, index: number, count: number) => string = (_cp, i, n) => (i === 0 ? '起點' : i === n - 1 ? '終點' : `${i}/${n - 2}`),
): CourseDef | null {
  const cps = checkpoints.filter((c) => c.course === id).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  if (cps.length < 2) return null;
  return {
    id,
    name,
    restart,
    gates: cps.map((c, i) => ({ id: c.id, label: label(c, i, cps.length), center: { x: c.pos[0], y: c.pos[1], z: c.pos[2] }, radius: c.radius ?? 3 })),
  };
}

/**
 * 線段 p0 → p1 從球外進入球（中心 c、半徑 r）的比例 t ∈ (0, 1]；p0 已在球內或沒有進入時回傳 null。
 */
export function segmentEnterSphere(p0: Readonly<Vec3Like>, p1: Readonly<Vec3Like>, c: Readonly<Vec3Like>, r: number): number | null {
  const fx = p0.x - c.x;
  const fy = p0.y - c.y;
  const fz = p0.z - c.z;
  const cc = fx * fx + fy * fy + fz * fz - r * r;
  if (cc <= 0) return null;
  const dx = p1.x - p0.x;
  const dy = p1.y - p0.y;
  const dz = p1.z - p0.z;
  const a = dx * dx + dy * dy + dz * dz;
  if (a <= 1e-18) return null;
  const b = 2 * (fx * dx + fy * dy + fz * dz);
  const disc = b * b - 4 * a * cc;
  if (disc < 0) return null;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  return t >= 0 && t <= 1 ? t : null;
}

export interface TrialSplit {
  gateId: string;
  label: string;
  /** 從起點算起的時間（s）。 */
  time: number;
  /** 與最佳成績同一分段的差（s；沒有最佳時為 null）。 */
  delta: number | null;
}

/** 最佳成績（本機存檔）。 */
export interface BestRecord {
  time: number;
  /** 每個檢查點（含終點，不含起點）的累計時間。 */
  splits: number[];
  date: string;
  gameVersion?: string;
  /** 調參指紋（tools/tuning.ts 的 tuningFingerprint）與是否為標準參數。 */
  tuning: string;
  standard: boolean;
}

/** 完成一次計時賽的成績（`course:finish` 事件；M5-05 排行榜上傳的資料）。 */
export interface TimeTrialResult {
  version: typeof TRIAL_RESULT_VERSION;
  courseId: string;
  levelId: string;
  /** 總時間（s，毫秒以下為精確值；上傳時建議取整到毫秒）。 */
  time: number;
  /** 檢查點累計時間（含終點）。 */
  splits: number[];
  /** 模擬頻率（Hz）。 */
  hz: number;
  /** 調參指紋與是否為標準參數（排行榜只收標準）。 */
  tuning: string;
  standard: boolean;
  /** 是否由錄影重播產生（排行榜不收）。 */
  replay: boolean;
  /** 是否刷新本機最佳。 */
  isBest: boolean;
  previousBest: number | null;
  date: string;
  gameVersion?: string;
}

export type TrialPhase = 'idle' | 'running' | 'finished';

/** 計時賽本體（純邏輯）：每步傳入身體中心的上一步與這一步位置。 */
export class CourseRun {
  phase: TrialPhase = 'idle';
  /** 目前時間（s；running 時遞增，finished 時為總時間）。 */
  time = 0;
  /** 下一個要通過的檢查點索引。 */
  next = 0;
  readonly splits: TrialSplit[] = [];
  /** 完成後經過的時間（HUD 保留顯示）。 */
  sinceFinish = 0;

  constructor(
    readonly course: CourseDef,
    private readonly config: TrialToolConfig = TOOLS_CONFIG.trial,
  ) {}

  /** 回到待命（下一次進入起點門開始）。 */
  reset(): void {
    this.phase = 'idle';
    this.time = 0;
    this.next = 0;
    this.splits.length = 0;
    this.sinceFinish = 0;
  }

  /**
   * 推進一步。回傳這一步發生的事：'start'、'split'（通過中間檢查點）、'finish'，或 null。
   * best 用來算分段差。
   */
  step(dt: number, p0: Readonly<Vec3Like>, p1: Readonly<Vec3Like>, best: Readonly<BestRecord> | null): 'start' | 'split' | 'finish' | null {
    const gates = this.course.gates;
    const scale = this.config.radiusScale;
    if (this.phase === 'running') this.time += dt;
    else if (this.phase === 'finished') this.sinceFinish += dt;
    if (this.phase !== 'running') {
      const g = gates[0]!;
      const t = segmentEnterSphere(p0, p1, g.center, g.radius * scale);
      if (t === null) return null;
      this.reset();
      this.phase = 'running';
      // 進入起點門之後這一步剩下的時間。
      this.time = (1 - t) * dt;
      this.next = 1;
      return 'start';
    }
    const g = gates[this.next];
    if (!g) return null;
    const t = segmentEnterSphere(p0, p1, g.center, g.radius * scale);
    if (t === null) return null;
    const at = this.time - (1 - t) * dt;
    const idx = this.next - 1;
    const bestAt = best?.splits[idx];
    this.splits.push({ gateId: g.id, label: g.label, time: at, delta: bestAt !== undefined ? at - bestAt : null });
    this.next++;
    if (this.next >= gates.length) {
      this.phase = 'finished';
      this.time = at;
      this.sinceFinish = 0;
      return 'finish';
    }
    return 'split';
  }
}

interface StoredBest {
  version: number;
  courses: Record<string, unknown>;
  [extra: string]: unknown;
}

function isPlainObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

/** 解析一筆最佳成績（不合法時回傳 null）。 */
export function parseBestRecord(x: unknown, gateCount?: number): BestRecord | null {
  if (!isPlainObject(x)) return null;
  const time = x.time;
  const splits = x.splits;
  if (typeof time !== 'number' || !Number.isFinite(time) || time <= 0) return null;
  if (!Array.isArray(splits) || !splits.every((s) => typeof s === 'number' && Number.isFinite(s))) return null;
  if (gateCount !== undefined && splits.length !== gateCount - 1) return null;
  return {
    time,
    splits: splits as number[],
    date: typeof x.date === 'string' ? x.date : '',
    ...(typeof x.gameVersion === 'string' ? { gameVersion: x.gameVersion } : {}),
    tuning: typeof x.tuning === 'string' ? x.tuning : '',
    standard: x.standard === true,
  };
}

/** 本機最佳成績（`shardwake:besttimes:v1`：{ version, courses: { [courseId]: BestRecord } }；不認識的欄位保留）。 */
export class BestTimes {
  private records = new Map<string, BestRecord>();
  private raw: StoredBest = { version: BEST_TIMES_VERSION, courses: {} };

  constructor(private readonly storage: GameStorage | null) {
    const data = storage?.getJSON<StoredBest>(BEST_TIMES_KEY) ?? null;
    if (data && isPlainObject(data) && isPlainObject(data.courses)) {
      this.raw = { ...data, version: BEST_TIMES_VERSION, courses: { ...data.courses } };
      for (const [id, rec] of Object.entries(data.courses)) {
        const r = parseBestRecord(rec);
        if (r) this.records.set(id, r);
      }
    }
  }

  get(courseId: string, gateCount?: number): BestRecord | null {
    const r = this.records.get(courseId) ?? null;
    if (r && gateCount !== undefined && r.splits.length !== gateCount - 1) return null;
    return r;
  }

  /** 成績比最佳好（或沒有最佳）時寫入；回傳是否刷新與寫入結果。 */
  submit(courseId: string, record: BestRecord, gateCount: number): { isBest: boolean; persistent: boolean; error?: string } {
    const prev = this.get(courseId, gateCount);
    if (prev && prev.time <= record.time) return { isBest: false, persistent: true };
    this.records.set(courseId, record);
    this.raw.courses[courseId] = record;
    return { isBest: true, ...this.persist() };
  }

  clear(courseId: string): void {
    this.records.delete(courseId);
    delete this.raw.courses[courseId];
    this.persist();
  }

  private persist(): { persistent: boolean; error?: string } {
    if (!this.storage) return { persistent: false };
    const r = this.storage.trySetString(BEST_TIMES_KEY, JSON.stringify(this.raw));
    return r.ok ? { persistent: r.persistent } : { persistent: false, error: r.error ?? '寫入失敗' };
  }
}

export interface TimeTrialSystemOptions {
  getFrame: () => Readonly<InputFrame>;
  /** 身體中心（null = 玩家不在控制中）。 */
  getCenter: (out: Vec3Like) => Vec3Like | null;
  /** 目前關卡的路線（換關卡時重新讀取；沒有路線時 null）。 */
  getCourse: () => CourseDef | null;
  getLevelId: () => string | null;
  /** 把玩家送到路線起點（重來）。 */
  restartPlayer: (target: RespawnTarget) => void;
  /** HUD 計時器狀態（hudTimer.state）。 */
  timer?: TimerState | null;
  best: BestTimes;
  /** 是否在重播中（重播的成績不更新最佳）。 */
  isReplay?: () => boolean;
  /** 目前的調參指紋與是否標準。 */
  getTuning?: () => { fingerprint: string; standard: boolean };
  getHz?: () => number;
  bus?: EventBus<GameEvents> | undefined;
  config?: TrialToolConfig;
  gameVersion?: string;
  now?: () => Date;
  /** 起點門附近幾公尺內顯示計時器（待命時）。 */
  showNearStart?: number;
}

/** 計時賽 Game 系統（order world：在玩家與物理之後，讀這一步的位置）。 */
export class TimeTrialSystem implements GameSystem {
  readonly name = 'timeTrial';
  readonly order = SystemOrder.world + 10;
  readonly config: TrialToolConfig;
  run: CourseRun | null = null;
  lastResult: TimeTrialResult | null = null;
  private readonly prev = { x: 0, y: 0, z: 0 };
  private readonly cur = { x: 0, y: 0, z: 0 };
  private hasPrev = false;
  private courseRef: CourseDef | null = null;

  constructor(private readonly options: TimeTrialSystemOptions) {
    this.config = options.config ?? TOOLS_CONFIG.trial;
  }

  get course(): CourseDef | null {
    return this.courseRef;
  }

  get best(): BestRecord | null {
    const c = this.courseRef;
    return c ? this.options.best.get(c.id, c.gates.length) : null;
  }

  /** 回到待命並清掉上一步位置（傳送、重播開始後呼叫，避免把瞬移當成穿過檢查點）。 */
  reset(): void {
    this.run?.reset();
    this.hasPrev = false;
    this.writeTimer();
  }

  /** 重來：送回起點並待命（restartCourse 動作、選單按鈕）。 */
  restart(): boolean {
    const c = this.ensureCourse();
    if (!c || !this.run) return false;
    this.options.restartPlayer(c.restart);
    this.run.reset();
    this.hasPrev = false;
    this.options.bus?.emit('course:reset', { courseId: c.id });
    this.writeTimer();
    return true;
  }

  clearBest(): void {
    const c = this.courseRef;
    if (c) this.options.best.clear(c.id);
    this.writeTimer();
  }

  fixedUpdate(dt: number): void {
    const c = this.ensureCourse();
    if (!c || !this.run) return;
    if (wasPressed(this.options.getFrame(), 'restartCourse')) {
      this.restart();
      return;
    }
    const p = this.options.getCenter(this.cur);
    if (!p) {
      this.hasPrev = false;
      return;
    }
    if (this.hasPrev) {
      const best = this.best;
      const ev = this.run.step(dt, this.prev, p, best);
      if (ev) this.handle(ev, c, best);
    }
    this.prev.x = p.x;
    this.prev.y = p.y;
    this.prev.z = p.z;
    this.hasPrev = true;
  }

  update(): void {
    this.writeTimer();
  }

  private ensureCourse(): CourseDef | null {
    const c = this.options.getCourse();
    if (c !== this.courseRef) {
      this.courseRef = c;
      this.run = c ? new CourseRun(c, this.config) : null;
      this.hasPrev = false;
    }
    return c;
  }

  private handle(ev: 'start' | 'split' | 'finish', c: CourseDef, best: BestRecord | null): void {
    const run = this.run!;
    const bus = this.options.bus;
    if (ev === 'start') {
      bus?.emit('course:start', { courseId: c.id });
      return;
    }
    const last = run.splits[run.splits.length - 1]!;
    if (ev === 'split') {
      bus?.emit('course:split', { courseId: c.id, index: run.splits.length, gateId: last.gateId, time: last.time, delta: last.delta });
      return;
    }
    const tuning = this.options.getTuning?.() ?? { fingerprint: '', standard: true };
    const replay = this.options.isReplay?.() ?? false;
    const date = (this.options.now ?? (() => new Date()))().toISOString();
    const splits = run.splits.map((s) => s.time);
    let isBest = false;
    if (!replay || this.config.recordBestInReplay) {
      const record: BestRecord = {
        time: run.time,
        splits,
        date,
        ...(this.options.gameVersion ? { gameVersion: this.options.gameVersion } : {}),
        tuning: tuning.fingerprint,
        standard: tuning.standard,
      };
      isBest = this.options.best.submit(c.id, record, c.gates.length).isBest;
    }
    const result: TimeTrialResult = {
      version: TRIAL_RESULT_VERSION,
      courseId: c.id,
      levelId: this.options.getLevelId() ?? '',
      time: run.time,
      splits,
      hz: this.options.getHz?.() ?? 120,
      tuning: tuning.fingerprint,
      standard: tuning.standard,
      replay,
      isBest,
      previousBest: best?.time ?? null,
      date,
      ...(this.options.gameVersion ? { gameVersion: this.options.gameVersion } : {}),
    };
    this.lastResult = result;
    bus?.emit('course:finish', result);
  }

  private writeTimer(): void {
    const timer = this.options.timer;
    const run = this.run;
    if (!timer) return;
    if (!run) {
      timer.visible = false;
      return;
    }
    const best = this.best;
    timer.best = best?.time ?? null;
    timer.running = run.phase === 'running';
    timer.time = run.phase === 'idle' ? 0 : run.time;
    const splits = timer.splits;
    if (splits.length !== run.splits.length) {
      splits.length = 0;
      for (const s of run.splits) splits.push({ label: s.label, time: s.time, delta: s.delta });
    }
    let visible = run.phase === 'running' || (run.phase === 'finished' && run.sinceFinish < this.config.finishHoldSeconds);
    if (!visible && this.hasPrev && this.courseRef) {
      const near = this.options.showNearStart ?? 12;
      const g = this.courseRef.gates[0]!.center;
      visible = Math.hypot(this.prev.x - g.x, this.prev.z - g.z) < near;
    }
    timer.visible = visible;
  }
}
