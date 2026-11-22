// 按鍵綁定：動作 ↔ 輸入代碼。
// - 鍵盤用 KeyboardEvent.code（實體位置，不受輸入法與鍵盤配置影響），例如 KeyW、Space、ShiftLeft。
// - 滑鼠按鍵為 Mouse0～Mouse4（MouseEvent.button：0 左、1 中、2 右、3 側鍵後、4 側鍵前）；
//   滾輪為 WheelUp／WheelDown（只有「按下」瞬間，沒有按住狀態）。
// - 每個動作最多 2 組綁定；同一個代碼只能綁一個動作（衝突偵測，可選擇搶過來）。
// - 拒絕瀏覽器保留鍵（F1、F3、F5、F6、F7、F10、F11、F12）；Escape 只能綁「暫停」
//   （Pointer Lock 的解鎖由瀏覽器控制）。綁 Ctrl 時回傳警告「Ctrl+W 會關閉分頁」。
// - 遊戲不呼叫 navigator.keyboard.lock()。
//
// 存檔（key `shardwake:bindings:v1`）：{ "version": 1, "values": { 動作: [代碼, …] } }
// 只存與預設不同的動作也可以讀，但寫入時存全部；不認識的動作原樣保留並寫回（預覽版與正式版共用儲存）。
import { ACTIONS, ACTION_INFO, isAction, type Action } from '@/input/Actions';
import type { EventBus } from '@/core/EventBus';
import type { GameEvents } from '@/core/events';
import type { GameStorage } from '@/core/Storage';

/** 輸入代碼：KeyboardEvent.code、Mouse0～Mouse4、WheelUp、WheelDown。 */
export type InputCode = string;

export const MAX_BINDINGS_PER_ACTION = 2;
export const BINDINGS_KEY = 'bindings:v1';
export const BINDINGS_VERSION = 1;

/** 瀏覽器保留鍵：不可綁定（說明、搜尋、重新整理、網址列、鍵盤瀏覽、選單、全螢幕、開發者工具）。 */
export const BROWSER_RESERVED_CODES: ReadonlySet<InputCode> = new Set([
  'F1',
  'F3',
  'F5',
  'F6',
  'F7',
  'F10',
  'F11',
  'F12',
]);

/** 只能綁給特定動作的代碼。 */
export const CODES_RESERVED_FOR: Readonly<Record<InputCode, Action>> = { Escape: 'pause' };

export const WHEEL_UP: InputCode = 'WheelUp';
export const WHEEL_DOWN: InputCode = 'WheelDown';

export function mouseButtonCode(button: number): InputCode {
  return `Mouse${button}`;
}

/** 預設綁定（依 docs/design.md 的操作表）。 */
export const DEFAULT_BINDINGS: Readonly<Record<Action, readonly InputCode[]>> = {
  moveForward: ['KeyW'],
  moveBack: ['KeyS'],
  moveLeft: ['KeyA'],
  moveRight: ['KeyD'],
  jump: ['Space'],
  crouch: ['KeyC'],
  sprint: [],
  dash: ['ShiftLeft'],
  grapple: ['KeyF'],
  fire: ['Mouse0'],
  ads: ['Mouse2'],
  reload: ['KeyR'],
  melee: ['KeyV'],
  interact: ['KeyE'],
  weapon1: ['Digit1'],
  weapon2: ['Digit2'],
  weapon3: ['Digit3'],
  weapon4: ['Digit4'],
  weapon5: ['Digit5'],
  weaponNext: [WHEEL_DOWN],
  weaponPrev: [WHEEL_UP],
  weaponLast: ['KeyQ'],
  pause: ['Escape'],
  debugPanel: ['Backquote'],
  recordToggle: ['F8'],
  replayToggle: ['F9'],
  restartCourse: ['KeyT'],
};

const MOUSE_CODE = /^Mouse[0-4]$/;
const KEY_CODE = /^[A-Z][A-Za-z0-9]*$/;

export function isMouseCode(code: InputCode): boolean {
  return MOUSE_CODE.test(code);
}

export function isWheelCode(code: InputCode): boolean {
  return code === WHEEL_UP || code === WHEEL_DOWN;
}

/** 語法上合法的輸入代碼（不檢查保留鍵）。 */
export function isValidCode(code: unknown): code is InputCode {
  if (typeof code !== 'string' || code.length === 0 || code.length > 32) return false;
  if (code === 'Unidentified') return false;
  if (code.startsWith('Mouse')) return MOUSE_CODE.test(code);
  if (code.startsWith('Wheel')) return isWheelCode(code);
  return KEY_CODE.test(code);
}

const NAMED_KEYS: Readonly<Record<string, string>> = {
  Space: '空白鍵',
  Escape: 'Esc',
  Enter: 'Enter',
  Tab: 'Tab',
  Backspace: 'Backspace',
  CapsLock: 'Caps Lock',
  ShiftLeft: '左 Shift',
  ShiftRight: '右 Shift',
  ControlLeft: '左 Ctrl',
  ControlRight: '右 Ctrl',
  AltLeft: '左 Alt',
  AltRight: '右 Alt',
  MetaLeft: '左 Win',
  MetaRight: '右 Win',
  ContextMenu: '選單鍵',
  Backquote: '`',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Insert: 'Insert',
  Delete: 'Delete',
  Home: 'Home',
  End: 'End',
  PageUp: 'Page Up',
  PageDown: 'Page Down',
  NumpadAdd: '數字鍵 +',
  NumpadSubtract: '數字鍵 -',
  NumpadMultiply: '數字鍵 *',
  NumpadDivide: '數字鍵 /',
  NumpadDecimal: '數字鍵 .',
  NumpadEnter: '數字鍵 Enter',
  Mouse0: '滑鼠左鍵',
  Mouse1: '滑鼠中鍵',
  Mouse2: '滑鼠右鍵',
  Mouse3: '滑鼠側鍵（後）',
  Mouse4: '滑鼠側鍵（前）',
  WheelUp: '滾輪上',
  WheelDown: '滾輪下',
};

/** 輸入代碼的顯示名稱（HUD 提示用），例如 KeyW → W、Digit1 → 1、Mouse0 → 滑鼠左鍵。 */
export function keyName(code: InputCode): string {
  const named = NAMED_KEYS[code];
  if (named) return named;
  let m = /^Key([A-Z])$/.exec(code);
  if (m) return m[1]!;
  m = /^Digit(\d)$/.exec(code);
  if (m) return m[1]!;
  m = /^Numpad(\d)$/.exec(code);
  if (m) return `數字鍵 ${m[1]!}`;
  return code;
}

export type BindError = 'invalid' | 'reserved' | 'slot' | 'conflict';

export interface BindingRef {
  action: Action;
  slot: number;
}

export interface BindResult {
  ok: boolean;
  error?: BindError;
  /** 衝突的既有綁定（ok 為 false 時代表被擋下；replace 時代表被移除的綁定）。 */
  conflicts: BindingRef[];
  /** 提示訊息（例如綁 Ctrl）。綁定仍然成功。 */
  warning?: string;
}

export const CTRL_WARNING = 'Ctrl+W 會關閉分頁：按住 Ctrl 時按 W 可能直接關閉遊戲';
export const META_WARNING = 'Windows 鍵可能開啟開始功能表並讓遊戲失去焦點';

/** 檢查一個代碼能否綁給某動作（不含衝突檢查）。 */
export function validateCode(action: Action, code: InputCode): { error?: BindError; warning?: string } {
  if (!isValidCode(code)) return { error: 'invalid' };
  if (BROWSER_RESERVED_CODES.has(code)) return { error: 'reserved' };
  const only = CODES_RESERVED_FOR[code];
  if (only !== undefined && only !== action) return { error: 'reserved' };
  if (code === 'ControlLeft' || code === 'ControlRight') return { warning: CTRL_WARNING };
  if (code === 'MetaLeft' || code === 'MetaRight') return { warning: META_WARNING };
  return {};
}

export type BindingMap = Record<Action, InputCode[]>;

export function defaultBindingMap(): BindingMap {
  const out = {} as BindingMap;
  for (const a of ACTIONS) out[a] = [...DEFAULT_BINDINGS[a]];
  return out;
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

export interface ParsedBindings {
  map: BindingMap;
  extra: Record<string, unknown>;
  version: number;
  /** 需要寫回（修正過不合法內容或補了新動作的預設值）。 */
  dirty: boolean;
}

/**
 * 把存檔內容轉成合法綁定；永遠不丟例外。
 * - 不合法、保留或重複的代碼丟棄（重複時依動作清單順序，先出現的保留）。
 * - 存檔沒有的動作（之後版本新增的動作）補預設值，但跳過已被玩家綁走的代碼。
 */
export function parseBindings(raw: unknown): ParsedBindings {
  if (!isRecord(raw) || !isRecord(raw.values)) {
    return { map: defaultBindingMap(), extra: {}, version: BINDINGS_VERSION, dirty: raw !== null && raw !== undefined };
  }
  const values = raw.values;
  const version =
    typeof raw.version === 'number' && Number.isInteger(raw.version) && raw.version >= 1 ? raw.version : BINDINGS_VERSION;
  let dirty = version !== raw.version;
  const extra: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(values)) if (!isAction(k)) extra[k] = v;

  const map = {} as BindingMap;
  const used = new Set<InputCode>();
  const missing: Action[] = [];
  for (const a of ACTIONS) {
    const v = values[a];
    if (!Array.isArray(v)) {
      missing.push(a);
      map[a] = [];
      continue;
    }
    const codes: InputCode[] = [];
    for (const code of v) {
      if (codes.length >= MAX_BINDINGS_PER_ACTION || !isValidCode(code) || validateCode(a, code).error || used.has(code)) {
        dirty = true;
        continue;
      }
      codes.push(code);
      used.add(code);
    }
    map[a] = codes;
  }
  for (const a of missing) {
    dirty = true;
    map[a] = DEFAULT_BINDINGS[a].filter((code) => !used.has(code));
    for (const code of map[a]) used.add(code);
  }
  return { map, extra, version, dirty };
}

export type BindingsListener = (bindings: Bindings) => void;

export interface BindingsOptions {
  storage?: GameStorage;
  bus?: EventBus<GameEvents>;
}

export class Bindings {
  private map: BindingMap = defaultBindingMap();
  private reverse = new Map<InputCode, Action[]>();
  private extra: Record<string, unknown> = {};
  private version = BINDINGS_VERSION;
  private readonly storage: GameStorage | undefined;
  private readonly bus: EventBus<GameEvents> | undefined;
  private readonly listeners = new Set<BindingsListener>();

  constructor(options: BindingsOptions = {}) {
    this.storage = options.storage;
    this.bus = options.bus;
    this.load();
  }

  /** 動作目前的綁定（最多 2 個）。 */
  get(action: Action): readonly InputCode[] {
    return this.map[action];
  }

  /** 代碼對應的動作（沒有時為空陣列；回傳的陣列不要修改）。 */
  actionsFor(code: InputCode): readonly Action[] {
    return this.reverse.get(code) ?? EMPTY;
  }

  /** 代碼目前綁給哪個動作的哪一格。 */
  find(code: InputCode): BindingRef | undefined {
    for (const a of ACTIONS) {
      const slot = this.map[a].indexOf(code);
      if (slot >= 0) return { action: a, slot };
    }
    return undefined;
  }

  isBound(code: InputCode): boolean {
    return this.reverse.has(code);
  }

  /** 全部綁定的複本。 */
  toMap(): BindingMap {
    const out = {} as BindingMap;
    for (const a of ACTIONS) out[a] = [...this.map[a]];
    return out;
  }

  /**
   * 把代碼綁到動作的第 slot 格（0 或 1；超過目前數量時接在後面）。
   * 代碼已被其他動作使用時：預設回傳 conflict 不變更；replace = true 時從原動作移除後綁定。
   */
  bind(action: Action, slot: number, code: InputCode, options: { replace?: boolean } = {}): BindResult {
    const check = validateCode(action, code);
    if (check.error) return { ok: false, error: check.error, conflicts: [] };
    if (!Number.isInteger(slot) || slot < 0 || slot >= MAX_BINDINGS_PER_ACTION) {
      return { ok: false, error: 'slot', conflicts: [] };
    }
    const owner = this.find(code);
    const conflicts: BindingRef[] = owner && !(owner.action === action) ? [owner] : [];
    if (conflicts.length > 0 && !options.replace) return { ok: false, error: 'conflict', conflicts };
    for (const c of conflicts) this.map[c.action].splice(c.slot, 1);
    const codes = this.map[action].filter((c) => c !== code);
    if (slot < codes.length) codes[slot] = code;
    else codes.push(code);
    this.map[action] = codes.slice(0, MAX_BINDINGS_PER_ACTION);
    this.changed();
    const result: BindResult = { ok: true, conflicts };
    if (check.warning) result.warning = check.warning;
    return result;
  }

  /** 移除動作的第 slot 格。 */
  unbind(action: Action, slot: number): boolean {
    if (slot < 0 || slot >= this.map[action].length) return false;
    this.map[action].splice(slot, 1);
    this.changed();
    return true;
  }

  /** 恢復預設（全部或單一動作；單一動作時預設代碼若被其他動作占用則略過）。 */
  reset(action?: Action): void {
    if (action === undefined) {
      this.map = defaultBindingMap();
    } else {
      this.map[action] = DEFAULT_BINDINGS[action].filter((code) => {
        const owner = this.find(code);
        return owner === undefined || owner.action === action;
      });
    }
    this.changed();
  }

  /** 動作的按鍵顯示名稱，例如「W」、「1／滾輪下」；沒有綁定時為「未綁定」。 */
  labelFor(action: Action, separator = '／'): string {
    const codes = this.map[action];
    return codes.length === 0 ? '未綁定' : codes.map(keyName).join(separator);
  }

  /** 動作的顯示名稱（中文）。 */
  actionLabel(action: Action): string {
    return ACTION_INFO[action].label;
  }

  onChange(listener: BindingsListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** 從儲存重新讀取（不發出變更事件）。 */
  load(): void {
    const parsed = parseBindings(this.storage?.getJSON<unknown>(BINDINGS_KEY) ?? null);
    this.map = parsed.map;
    this.extra = parsed.extra;
    this.version = Math.max(parsed.version, BINDINGS_VERSION);
    this.rebuild();
    if (parsed.dirty) this.save();
  }

  private save(): void {
    this.storage?.setJSON(BINDINGS_KEY, { version: this.version, values: { ...this.extra, ...this.map } });
  }

  private rebuild(): void {
    this.reverse = new Map();
    for (const a of ACTIONS) {
      for (const code of this.map[a]) {
        const list = this.reverse.get(code);
        if (list) list.push(a);
        else this.reverse.set(code, [a]);
      }
    }
  }

  private changed(): void {
    this.rebuild();
    this.save();
    for (const l of this.listeners) l(this);
    this.bus?.emit('input:bindings', {});
  }
}

const EMPTY: readonly Action[] = Object.freeze([]);
