// 每個固定步的輸入快照 InputFrame，以及由輸入事件產生它的 InputFrameBuilder。
//
// 位元語意（每個動作一個位元，見 Actions.ts 的 ACTION_BIT）：
//   held      這一步結束時的（邏輯）按住狀態。
//   pressed   自上一步以來曾經「變成按住」：兩步之間按下又放開也會出現，而且只出現在下一步一次。
//   released  自上一步以來曾經「變成放開」。
// 一個動作綁多個鍵時，任一個鍵按著就算按住；第二個鍵加按不會再產生 pressed。
// 滾輪只有瞬間：同一步同時出現 pressed 與 released，held 永遠為 0。
//
// 按住／切換模式（蹲、開鏡、抓鉤）在這一層轉換，下游只看結果：
//   hold   held = 實體按住；pressed／released 跟著實體按鍵。
//   toggle 每次實體按下翻轉一次狀態；held = 切換狀態，變成開時 pressed、變成關時 released，
//          實體放開不產生任何位元。下游可用 setToggle() 強制關閉（例如衝刺時取消開鏡）。
//
// 停用時（非遊玩模式）只記錄實體按住哪些鍵，不產生 pressed／released，也不翻轉切換狀態；
// 重新啟用時，按住模式的動作直接以「按住」接續（不補 pressed），避免暫停中的按鍵漏進遊戲。
import { ACTIONS, ACTION_BIT, ACTION_INDEX, TOGGLEABLE_ACTIONS, type Action, type HoldMode, type ToggleableAction } from '@/input/Actions';
import type { InputCode } from '@/input/Bindings';

export interface InputFrame {
  /** 移動輸入（正規化，長度 ≤ 1）：x 向右為正，y 向前為正。 */
  move: { x: number; y: number };
  /** 玩家視角 yaw（弧度，不含後座力偏移）。 */
  yaw: number;
  /** 玩家視角 pitch（弧度，不含後座力偏移）。 */
  pitch: number;
  held: number;
  pressed: number;
  released: number;
}

export function createInputFrame(): InputFrame {
  return { move: { x: 0, y: 0 }, yaw: 0, pitch: 0, held: 0, pressed: 0, released: 0 };
}

export function copyInputFrame(dst: InputFrame, src: Readonly<InputFrame>): InputFrame {
  dst.move.x = src.move.x;
  dst.move.y = src.move.y;
  dst.yaw = src.yaw;
  dst.pitch = src.pitch;
  dst.held = src.held;
  dst.pressed = src.pressed;
  dst.released = src.released;
  return dst;
}

export function isHeld(frame: Readonly<InputFrame>, action: Action): boolean {
  return (frame.held & ACTION_BIT[action]) !== 0;
}

export function wasPressed(frame: Readonly<InputFrame>, action: Action): boolean {
  return (frame.pressed & ACTION_BIT[action]) !== 0;
}

export function wasReleased(frame: Readonly<InputFrame>, action: Action): boolean {
  return (frame.released & ACTION_BIT[action]) !== 0;
}

/** 由按住的方向鍵算出移動向量（對角線正規化成長度 1；相反方向互相抵銷）。 */
export function moveVector(held: number, out: { x: number; y: number }): { x: number; y: number } {
  const b = ACTION_BIT;
  let x = 0;
  let y = 0;
  if (held & b.moveRight) x += 1;
  if (held & b.moveLeft) x -= 1;
  if (held & b.moveForward) y += 1;
  if (held & b.moveBack) y -= 1;
  const len = Math.hypot(x, y);
  if (len > 1) {
    x /= len;
    y /= len;
  }
  out.x = x;
  out.y = y;
  return out;
}

/** 代碼 → 動作的查詢（Bindings 符合）。 */
export interface ActionLookup {
  actionsFor(code: InputCode): readonly Action[];
}

export type HoldModes = Record<ToggleableAction, HoldMode>;

export class InputFrameBuilder {
  /** 實體按住的代碼與按下當時對應的動作（綁定在按住期間改變時，放開仍扣回原動作）。 */
  private readonly heldCodes = new Map<InputCode, readonly Action[]>();
  /** 每個動作有幾個實體按鍵按著。 */
  private readonly counts = new Int32Array(ACTIONS.length);
  /** 實體按住（任何模式都是實體狀態）。 */
  private rawHeld = 0;
  /** 切換模式的開關狀態。 */
  private toggleOn = 0;
  /** 自上一步以來的邏輯邊緣。 */
  private pressedAcc = 0;
  private releasedAcc = 0;
  private toggleMask = 0;
  private _enabled = true;
  private readonly modes: HoldModes = { crouch: 'hold', ads: 'hold', grapple: 'hold' };

  constructor(private readonly lookup: ActionLookup) {}

  get enabled(): boolean {
    return this._enabled;
  }

  /** 目前的邏輯按住狀態（按住模式取實體狀態，切換模式取開關）。 */
  get held(): number {
    return ((this.rawHeld & ~this.toggleMask) | (this.toggleOn & this.toggleMask)) >>> 0;
  }

  /** 實體按住的動作（不考慮切換模式）。 */
  get physicalHeld(): number {
    return this.rawHeld >>> 0;
  }

  getMode(action: ToggleableAction): HoldMode {
    return this.modes[action];
  }

  /** 設定按住／切換模式；狀態改變時補上對應的邊緣。 */
  setMode(action: ToggleableAction, mode: HoldMode): void {
    if (this.modes[action] === mode) return;
    const bit = ACTION_BIT[action];
    const before = this.held & bit;
    this.modes[action] = mode;
    this.toggleOn &= ~bit;
    if (mode === 'toggle') this.toggleMask |= bit;
    else this.toggleMask &= ~bit;
    this.edge(bit, before, this.held & bit);
  }

  setModes(modes: Partial<HoldModes>): void {
    for (const a of TOGGLEABLE_ACTIONS) {
      const m = modes[a];
      if (m) this.setMode(a, m);
    }
  }

  /** 強制設定切換模式動作的開關（按住模式時無效）。 */
  setToggle(action: ToggleableAction, on: boolean): void {
    const bit = ACTION_BIT[action];
    if ((this.toggleMask & bit) === 0) return;
    const before = this.held & bit;
    if (on) this.toggleOn |= bit;
    else this.toggleOn &= ~bit;
    if (this._enabled) this.edge(bit, before, this.held & bit);
  }

  /** 啟用／停用（遊玩模式才啟用）。 */
  setEnabled(enabled: boolean): void {
    if (this._enabled === enabled) return;
    this._enabled = enabled;
    this.pressedAcc = 0;
    this.releasedAcc = 0;
  }

  /** 實體按下（重複的 keydown 忽略）。 */
  down(code: InputCode): void {
    if (this.heldCodes.has(code)) return;
    const actions = this.lookup.actionsFor(code);
    this.heldCodes.set(code, actions);
    for (const a of actions) {
      const i = ACTION_INDEX[a];
      if (this.counts[i]!++ === 0) this.rawPress(ACTION_BIT[a]);
    }
  }

  /** 實體放開（沒按著的鍵忽略）。 */
  up(code: InputCode): void {
    const actions = this.heldCodes.get(code);
    if (actions === undefined) return;
    this.heldCodes.delete(code);
    for (const a of actions) {
      const i = ACTION_INDEX[a];
      if (--this.counts[i]! === 0) this.rawRelease(ACTION_BIT[a]);
    }
  }

  /** 瞬間輸入（滾輪）：按下並立即放開。 */
  impulse(code: InputCode): void {
    if (this.heldCodes.has(code)) return;
    this.down(code);
    this.up(code);
  }

  isCodeDown(code: InputCode): boolean {
    return this.heldCodes.has(code);
  }

  /** 放開所有實體按鍵（失焦、暫停、綁定變更時避免卡鍵）。切換狀態保留，除非 resetToggles。 */
  releaseAll(resetToggles = false): void {
    for (const code of [...this.heldCodes.keys()]) this.up(code);
    if (resetToggles) for (const a of TOGGLEABLE_ACTIONS) this.setToggle(a, false);
  }

  /** 放開符合條件的實體按鍵（例如解除滑鼠鎖定時放開所有滑鼠按鍵）。 */
  releaseWhere(predicate: (code: InputCode) => boolean): void {
    for (const code of [...this.heldCodes.keys()]) if (predicate(code)) this.up(code);
  }

  /** 丟棄尚未消耗的邊緣。 */
  clearEdges(): void {
    this.pressedAcc = 0;
    this.releasedAcc = 0;
  }

  /** 產生一個固定步的 InputFrame 並清空邊緣累積。 */
  build(out: InputFrame, yaw: number, pitch: number): InputFrame {
    const held = this.held;
    out.held = held;
    out.pressed = this.pressedAcc >>> 0;
    out.released = this.releasedAcc >>> 0;
    out.yaw = yaw;
    out.pitch = pitch;
    moveVector(held, out.move);
    this.pressedAcc = 0;
    this.releasedAcc = 0;
    return out;
  }

  private rawPress(bit: number): void {
    this.rawHeld |= bit;
    if (!this._enabled) return;
    if (this.toggleMask & bit) {
      const before = this.toggleOn & bit;
      this.toggleOn ^= bit;
      this.edge(bit, before, this.toggleOn & bit);
    } else {
      this.pressedAcc |= bit;
    }
  }

  private rawRelease(bit: number): void {
    this.rawHeld &= ~bit;
    if (!this._enabled || this.toggleMask & bit) return;
    this.releasedAcc |= bit;
  }

  private edge(bit: number, before: number, after: number): void {
    if (before === after || !this._enabled) return;
    if (after) this.pressedAcc |= bit;
    else this.releasedAcc |= bit;
  }
}
