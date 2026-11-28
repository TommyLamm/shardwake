// 輸入系統（Game 系統，order = SystemOrder.input）：
// - DOM 事件（keydown／keyup／mousedown／mouseup／wheel／mousemove）→ InputFrameBuilder 與 MouseLook。
// - beginFrame：每個渲染畫面開頭把累計的滑鼠位移套用到 view（yaw／pitch），不平滑、不加速。
// - fixedUpdate：每個固定步產生一份 InputFrame（input.frame，同一物件重複使用），
//   之後的系統（order > 100）在自己的 fixedUpdate 讀取。
// - 即時動作（暫停、調參面板、錄製／重播）在按下當下由 onAction 派送，任何模式都有效。
// - 遊玩中對遊戲用到的按鍵 preventDefault；失焦、暫停、解除滑鼠鎖定時放開按住的鍵，避免卡鍵。
// 滑鼠按鍵與滾輪只在滑鼠鎖定時計入（取得鎖定的那一下點擊不會開火）。
import type { GameMode } from '@/core/events';
import { SystemOrder, type Game, type GameSystem } from '@/core/Game';
import type { HoldToggle } from '@/core/Settings';
import { ACTION_INFO, type Action } from '@/input/Actions';
import {
  BROWSER_RESERVED_CODES,
  WHEEL_DOWN,
  WHEEL_UP,
  isMouseCode,
  mouseButtonCode,
  type Bindings,
  type InputCode,
} from '@/input/Bindings';
import { ALWAYS_PREVENT_CODES, INPUT_CONFIG, type InputConfig } from '@/input/config';
import { createInputFrame, InputFrameBuilder, type InputFrame } from '@/input/InputFrame';
import { MouseLook, ViewAngles } from '@/input/Mouse';

type Listenable = Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;

/** 輸入系統需要的玩家設定（core/Settings 的子集）。 */
export interface InputSettings {
  sensitivity: number;
  invertY: boolean;
  crouchMode: HoldToggle;
  adsMode: HoldToggle;
  grappleMode: HoldToggle;
}

// ── 事件的最小介面（測試可傳普通物件）─────────────────────

interface Cancelable {
  preventDefault(): void;
  readonly target?: unknown;
}
export interface KeyEventLike extends Cancelable {
  readonly code: string;
  readonly repeat?: boolean;
}
export interface MouseButtonEventLike extends Cancelable {
  readonly button: number;
}
export interface MouseMoveEventLike {
  readonly movementX: number;
  readonly movementY: number;
}
export interface WheelEventLike extends Cancelable {
  readonly deltaY: number;
  readonly deltaMode?: number;
}

export type ActionHandler = (action: Action) => void;

export interface InputSystemOptions {
  bindings: Bindings;
  getSettings: () => InputSettings;
  /** 滑鼠是否鎖定、是否為原始輸入（PointerLock 提供）。 */
  isLocked: () => boolean;
  isRaw?: () => boolean;
  config?: InputConfig;
  /** 鍵盤事件與 blur 的來源（預設 window）；null 表示不掛 DOM 事件（無頭測試）。 */
  win?: Listenable | null;
  /** 滑鼠事件的來源（預設 document）。 */
  doc?: Listenable | null;
  now?: () => number;
  /** 事件目標在這些元素內時不處理（例如調參面板）；預設偵測 .sw-debug。 */
  isUiTarget?: (target: unknown) => boolean;
}

/** 輸入框、可編輯元素：鍵盤事件交給它，不當成遊戲輸入。 */
export function isEditableTarget(target: unknown): boolean {
  const t = target as { tagName?: unknown; isContentEditable?: unknown } | null | undefined;
  if (!t || typeof t !== 'object') return false;
  return t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable === true;
}

function defaultIsUiTarget(target: unknown): boolean {
  const t = target as { closest?: (sel: string) => unknown } | null | undefined;
  return typeof t?.closest === 'function' && t.closest('.sw-debug') != null;
}

export class InputSystem implements GameSystem {
  readonly name = 'input';
  readonly order = SystemOrder.input;

  /** 目前這一步的輸入（每步覆寫同一物件；要保存請 copyInputFrame）。 */
  readonly frame: InputFrame = createInputFrame();
  /** 玩家視角與後座力偏移。 */
  readonly view: ViewAngles;
  readonly mouse: MouseLook;
  readonly builder: InputFrameBuilder;
  readonly bindings: Bindings;
  /** 已產生的 InputFrame 數。 */
  stepCount = 0;
  /**
   * 外部輸入來源（M1-15 錄影重播）：設定後每個固定步照常消耗按鍵邊緣（玩家按鍵不會漏進之後的遊玩），
   * 再由來源覆寫 frame，並把視角設成 frame 的 yaw／pitch；滑鼠位移在 beginFrame 丟棄。
   * 來源回傳 false 表示已結束（清除來源，這一步改用玩家的輸入）。
   */
  private frameSource: ((out: InputFrame) => boolean) | null = null;

  private game: Game | null = null;
  private readonly config: InputConfig;
  private readonly getSettings: () => InputSettings;
  private readonly isLocked: () => boolean;
  private readonly isRaw: () => boolean;
  private readonly win: Listenable | null;
  private readonly doc: Listenable | null;
  private readonly now: () => number;
  private readonly isUiTarget: (target: unknown) => boolean;
  private readonly handlers = new Map<Action, Set<ActionHandler>>();
  private readonly unsubs: (() => void)[] = [];
  private wheelAcc = 0;
  private lastWheelAt = Number.NEGATIVE_INFINITY;

  constructor(options: InputSystemOptions) {
    this.bindings = options.bindings;
    this.getSettings = options.getSettings;
    this.isLocked = options.isLocked;
    this.isRaw = options.isRaw ?? (() => false);
    this.config = options.config ?? INPUT_CONFIG;
    this.now = options.now ?? (() => performance.now());
    this.isUiTarget = options.isUiTarget ?? defaultIsUiTarget;
    this.view = new ViewAngles(this.config);
    this.mouse = new MouseLook(this.config);
    this.builder = new InputFrameBuilder(this.bindings);
    this.builder.setEnabled(false);
    this.syncModes();
    this.win = options.win !== undefined ? options.win : typeof window !== 'undefined' ? window : null;
    this.doc = options.doc !== undefined ? options.doc : typeof document !== 'undefined' ? document : null;
    this.unsubs.push(this.bindings.onChange(() => this.builder.releaseAll()));
  }

  private get mode(): GameMode {
    return this.game?.mode ?? 'boot';
  }

  private get playing(): boolean {
    return this.mode === 'playing';
  }

  init(game: Game): void {
    this.game = game;
    this.builder.setEnabled(game.mode === 'playing');
    this.unsubs.push(game.bus.on('game:mode', ({ to }) => this.handleMode(to)));
    this.attach();
  }

  beginFrame(): void {
    this.syncModes();
    if (this.playing && this.isLocked() && !this.frameSource) this.mouse.applyFrame(this.view, this.getSettings());
    else this.mouse.discard();
  }

  fixedUpdate(): void {
    this.builder.build(this.frame, this.view.yaw, this.view.pitch);
    const source = this.frameSource;
    if (source) {
      if (source(this.frame)) this.view.set(this.frame.yaw, this.frame.pitch);
      else {
        this.frameSource = null;
        this.builder.build(this.frame, this.view.yaw, this.view.pitch);
      }
    }
    this.stepCount++;
  }

  /** 是否由外部來源（錄影重播）提供輸入。 */
  get hasFrameSource(): boolean {
    return this.frameSource !== null;
  }

  /** 設定或清除外部輸入來源（見 frameSource）。 */
  setFrameSource(source: ((out: InputFrame) => boolean) | null): void {
    this.frameSource = source;
    if (source) this.mouse.discard();
  }

  dispose(): void {
    this.detach();
    for (const off of this.unsubs) off();
    this.unsubs.length = 0;
    this.handlers.clear();
  }

  /** 訂閱即時動作（按下當下呼叫，任何模式）；回傳取消函式。 */
  onAction(action: Action, handler: ActionHandler): () => void {
    let set = this.handlers.get(action);
    if (!set) {
      set = new Set();
      this.handlers.set(action, set);
    }
    set.add(handler);
    return () => set.delete(handler);
  }

  /** 放開所有按鍵（失焦、暫停時自動呼叫）。 */
  releaseAll(): void {
    this.builder.releaseAll();
    this.wheelAcc = 0;
  }

  /** 解除滑鼠鎖定時呼叫：放開滑鼠按鍵、丟棄未套用的位移。 */
  handleUnlock(): void {
    this.builder.releaseWhere(isMouseCode);
    this.mouse.discard();
    this.wheelAcc = 0;
  }

  // ── DOM 事件（公開給無頭測試直接呼叫）──────────────────

  readonly handleKeyDown = (e: KeyEventLike): void => {
    if (isEditableTarget(e.target)) return;
    const code = e.code;
    if (!code) return;
    if (this.playing && this.shouldPreventKey(code)) e.preventDefault();
    if (this.builder.isCodeDown(code)) return; // 鍵盤自動重複
    this.builder.down(code);
    this.dispatchImmediate(code);
  };

  readonly handleKeyUp = (e: KeyEventLike): void => {
    const code = e.code;
    if (!code) return;
    if (this.playing && this.shouldPreventKey(code)) e.preventDefault();
    this.builder.up(code);
  };

  readonly handleMouseDown = (e: MouseButtonEventLike): void => {
    if (!this.isLocked() || e.button < 0 || e.button > 4) return;
    e.preventDefault();
    const code = mouseButtonCode(e.button);
    if (this.builder.isCodeDown(code)) return;
    this.builder.down(code);
    this.dispatchImmediate(code);
  };

  readonly handleMouseUp = (e: MouseButtonEventLike): void => {
    if (e.button < 0 || e.button > 4) return;
    // 側鍵（3、4）的 mouseup 會觸發瀏覽器「上一頁／下一頁」；鎖定中一律攔下。
    if (this.isLocked()) e.preventDefault();
    this.builder.up(mouseButtonCode(e.button));
  };

  readonly handleMouseMove = (e: MouseMoveEventLike): void => {
    if (!this.isLocked()) return;
    this.mouse.accumulate(e.movementX, e.movementY, this.isRaw());
  };

  readonly handleWheel = (e: WheelEventLike): void => {
    if (!this.playing || !this.isLocked()) return;
    e.preventDefault();
    const cfg = this.config;
    const unit = e.deltaMode === 1 ? cfg.wheelLinePx : e.deltaMode === 2 ? cfg.wheelPagePx : 1;
    const px = e.deltaY * unit;
    if (px === 0 || !Number.isFinite(px)) return;
    const t = this.now();
    if (t - this.lastWheelAt > cfg.wheelResetMs || Math.sign(px) !== Math.sign(this.wheelAcc)) this.wheelAcc = 0;
    this.lastWheelAt = t;
    this.wheelAcc += px;
    if (Math.abs(this.wheelAcc) >= cfg.wheelNotchPx) {
      const code: InputCode = this.wheelAcc > 0 ? WHEEL_DOWN : WHEEL_UP;
      this.wheelAcc = 0;
      this.builder.impulse(code);
      this.dispatchImmediate(code);
    }
  };

  readonly handleContextMenu = (e: Cancelable): void => {
    if (this.isLocked() || (this.playing && !this.isUiTarget(e.target))) e.preventDefault();
  };

  readonly handleBlur = (): void => {
    this.releaseAll();
  };

  // ── 內部 ───────────────────────────────────────────────

  private shouldPreventKey(code: InputCode): boolean {
    if (code === 'Escape' || BROWSER_RESERVED_CODES.has(code)) return false;
    return ALWAYS_PREVENT_CODES.has(code) || this.bindings.isBound(code);
  }

  private dispatchImmediate(code: InputCode): void {
    const actions = this.bindings.actionsFor(code);
    for (const a of actions) {
      if (!ACTION_INFO[a].immediate) continue;
      const set = this.handlers.get(a);
      if (set) for (const h of [...set]) h(a);
    }
  }

  private handleMode(to: GameMode): void {
    if (to === 'playing') {
      this.builder.setEnabled(true);
      this.builder.clearEdges();
    } else {
      this.builder.setEnabled(false);
      this.releaseAll();
      this.mouse.discard();
    }
  }

  private syncModes(): void {
    const s = this.getSettings();
    const b = this.builder;
    if (b.getMode('crouch') !== s.crouchMode) b.setMode('crouch', s.crouchMode);
    if (b.getMode('ads') !== s.adsMode) b.setMode('ads', s.adsMode);
    if (b.getMode('grapple') !== s.grappleMode) b.setMode('grapple', s.grappleMode);
  }

  private listeners(): [Listenable | null, string, EventListener][] {
    const l = (fn: unknown): EventListener => fn as EventListener;
    return [
      [this.win, 'keydown', l(this.handleKeyDown)],
      [this.win, 'keyup', l(this.handleKeyUp)],
      [this.win, 'blur', l(this.handleBlur)],
      [this.doc, 'mousedown', l(this.handleMouseDown)],
      [this.doc, 'mouseup', l(this.handleMouseUp)],
      [this.doc, 'mousemove', l(this.handleMouseMove)],
      // wheel 需要非 passive 才能 preventDefault（避免捲動串到平台頁）。
      [this.doc, 'wheel', l(this.handleWheel)],
      [this.doc, 'contextmenu', l(this.handleContextMenu)],
    ];
  }

  private attach(): void {
    for (const [target, type, fn] of this.listeners()) target?.addEventListener(type, fn, { passive: false });
  }

  private detach(): void {
    for (const [target, type, fn] of this.listeners()) target?.removeEventListener(type, fn);
  }
}
