// 錯誤處理（M1-16）：啟動與執行中的致命錯誤分類、WebGL 偵測、各啟動階段的包裝與遊戲迴圈的例外防護。
// 純邏輯（不碰 DOM），可無頭測試；畫面由 ui/ErrorScreen.ts 顯示，main.ts 組裝。
//
// - FatalKind：webgl（瀏覽器不能建立 WebGL 2）、contextLost（執行中顯示卡內容遺失）、physics（Rapier WASM 初始化失敗）、
//   load（遊戲檔案下載失敗）、boot（其他啟動錯誤）、runtime（遊戲迴圈連續丟例外）。
// - 啟動流程的每個 await 都經 runStage()：失敗時轉成帶階段的 FatalError，最後由 boot().catch 顯示錯誤畫面（不會白畫面）。

export type FatalKind = 'webgl' | 'contextLost' | 'physics' | 'load' | 'boot' | 'runtime';

export const FATAL_KINDS: readonly FatalKind[] = ['webgl', 'contextLost', 'physics', 'load', 'boot', 'runtime'];

/** 帶分類與啟動階段的錯誤。 */
export class FatalError extends Error {
  readonly kind: FatalKind;
  /** 發生的啟動階段（例如「物理引擎」「著色器預熱」）；執行中的錯誤為 null。 */
  readonly stage: string | null;

  constructor(kind: FatalKind, message: string, options: { stage?: string | null; cause?: unknown } = {}) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'FatalError';
    this.kind = kind;
    this.stage = options.stage ?? null;
  }
}

export interface ErrorReport {
  kind: FatalKind;
  stage: string | null;
  /** 給玩家看的技術細節（錯誤名稱與訊息，一行一個原因）。 */
  detail: string;
}

/** 錯誤物件轉成一行文字（Error → 「名稱: 訊息」；其他值 → String）。 */
export function describeError(err: unknown): string {
  if (err instanceof Error) return err.message ? `${err.name}: ${err.message}` : err.name;
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err) ?? String(err);
  } catch {
    return String(err);
  }
}

/** 依錯誤內容猜測分類（不是 FatalError 時使用）。 */
export function guessKind(err: unknown, fallback: FatalKind = 'boot'): FatalKind {
  const text = describeError(err).toLowerCase();
  if (/webgl|creating webgl context|getcontext/.test(text)) return 'webgl';
  if (/webassembly|wasm|rapier/.test(text)) return 'physics';
  if (/failed to fetch dynamically imported module|importing a module script failed|error loading dynamically imported module|chunkloaderror/.test(text))
    return 'load';
  return fallback;
}

/** 把任何錯誤整理成錯誤畫面需要的資訊（cause 鏈最多展開 3 層）。 */
export function classifyError(err: unknown, fallback: FatalKind = 'boot'): ErrorReport {
  const kind = err instanceof FatalError ? err.kind : guessKind(err, fallback);
  const stage = err instanceof FatalError ? err.stage : null;
  const lines: string[] = [];
  let cur: unknown = err;
  for (let i = 0; i < 4 && cur !== undefined && cur !== null; i++) {
    lines.push(describeError(cur));
    cur = cur instanceof Error ? (cur as Error & { cause?: unknown }).cause : undefined;
  }
  return { kind, stage, detail: lines.join('\n') };
}

/**
 * 執行一個啟動階段：同步丟出或非同步拒絕都轉成 FatalError（kind 為 FatalError 本身的分類，
 * 否則先依內容猜測，猜不出時用 kind 參數）。
 */
export async function runStage<T>(stage: string, kind: FatalKind, fn: () => T | Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof FatalError) throw err;
    const k = kind === 'boot' ? guessKind(err, 'boot') : kind;
    throw new FatalError(k, `${stage}失敗：${describeError(err)}`, { stage, cause: err });
  }
}

export interface WebGLProbe {
  ok: boolean;
  /** 不可用的原因（ok = false 時）。 */
  reason: string | null;
}

/** 最小的 canvas 介面（無頭測試可用假物件）。 */
export interface CanvasLike {
  getContext(type: string, attrs?: Record<string, unknown>): unknown;
}

/**
 * 偵測 WebGL 2（three r187 只支援 WebGL 2）。建立 context 失敗或丟例外都視為不可用；
 * 成功時以 WEBGL_lose_context 立即釋放，避免多佔一個 context。
 */
export function probeWebGL2(createCanvas: () => CanvasLike): WebGLProbe {
  try {
    const canvas = createCanvas();
    const gl = canvas.getContext('webgl2', { failIfMajorPerformanceCaveat: false }) as {
      getExtension?(name: string): { loseContext?(): void } | null;
    } | null;
    if (!gl) return { ok: false, reason: '瀏覽器沒有提供 WebGL 2（getContext 回傳 null）' };
    gl.getExtension?.('WEBGL_lose_context')?.loseContext?.();
    return { ok: true, reason: null };
  } catch (err) {
    return { ok: false, reason: describeError(err) };
  }
}

export interface FrameGuardOptions {
  /** 連續幾個畫面丟例外就視為致命（停止迴圈並顯示錯誤畫面）。 */
  maxConsecutive?: number;
  onFatal: (err: unknown) => void;
  /** 記錄錯誤（預設 console.error）；同一串連續錯誤只記第一個。 */
  log?: (message: string, err: unknown) => void;
}

/**
 * 遊戲迴圈的例外防護：three 的 setAnimationLoop 在回呼丟例外時不會排下一個畫面（畫面凍結）。
 * run() 吃掉例外並記錄；偶發的錯誤（例如單一畫面的事件處理器出錯）下一畫面照常繼續，
 * 連續 maxConsecutive 個畫面都出錯時呼叫 onFatal 一次，之後 run() 不再執行。
 */
export class FrameGuard {
  readonly maxConsecutive: number;
  private consecutive = 0;
  private _fatal = false;
  /** 累計被吃掉的例外數（除錯用）。 */
  errors = 0;

  constructor(private readonly options: FrameGuardOptions) {
    this.maxConsecutive = Math.max(1, Math.floor(options.maxConsecutive ?? 3));
  }

  get fatal(): boolean {
    return this._fatal;
  }

  /** 執行一個畫面；回傳是否成功（已致命時直接回傳 false）。 */
  run(fn: () => void): boolean {
    if (this._fatal) return false;
    try {
      fn();
      this.consecutive = 0;
      return true;
    } catch (err) {
      this.errors++;
      this.consecutive++;
      if (this.consecutive === 1) (this.options.log ?? defaultLog)('[shardwake] 畫面更新發生錯誤', err);
      if (this.consecutive >= this.maxConsecutive) {
        this._fatal = true;
        this.options.onFatal(err);
      }
      return false;
    }
  }
}

function defaultLog(message: string, err: unknown): void {
  console.error(message, err);
}
