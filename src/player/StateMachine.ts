// 可擴充的移動狀態機：狀態（enter / step / exit）與集中管理的轉換規則。
//
// - 新增狀態（M1-06 WallRun／Mantle、M1-07 Dash／Grapple）只需 addState() 與 addTransition()，
//   不必修改既有狀態。
// - 轉換分兩個階段（PlayerController 每步各評估一次）：
//     'pre'   狀態 step 之前，依輸入與上一步的結果（例如地面按蹲 → 滑鏟）。
//     'post'  移動與地面探測之後，依碰撞結果（例如落地、離地、速度太低結束滑鏟）。
//   每個階段最多發生一次轉換：取 from 符合目前狀態、條件成立、priority 最高者（同 priority 依註冊順序）。
// - 狀態切換永不碰速度：enter／exit 只能調整自身計時器與旗標，速度由各狀態 step 依物理規則改變。
export type TransitionPhase = 'pre' | 'post';

export interface MoveState<Ctx> {
  readonly id: string;
  /** 進入狀態（prev 為前一個狀態 id；初始化時為 null）。 */
  enter?(ctx: Ctx, prev: string | null): void;
  /** 每個固定步：依輸入修改速度（尚未移動）。 */
  step(ctx: Ctx, dt: number): void;
  /** 離開狀態（next 為下一個狀態 id）。 */
  exit?(ctx: Ctx, next: string): void;
}

export interface Transition<Ctx> {
  /** 來源狀態；'*' 表示任何狀態（目標狀態本身除外）。 */
  from: string | readonly string[] | '*';
  to: string;
  phase: TransitionPhase;
  /** 越大越優先（預設 0）。 */
  priority?: number;
  /** 規則名稱（除錯顯示用）。 */
  name?: string;
  when(ctx: Ctx): boolean;
}

interface Registered<Ctx> extends Transition<Ctx> {
  order: number;
}

export class StateMachine<Ctx> {
  private readonly states = new Map<string, MoveState<Ctx>>();
  private readonly transitions: Registered<Ctx>[] = [];
  private _current: MoveState<Ctx> | null = null;
  private _previousId: string | null = null;
  private _timeInState = 0;
  private order = 0;
  /** 最近一次轉換的規則名稱（除錯用）。 */
  lastTransition = '';

  constructor(
    private readonly ctx: Ctx,
    private readonly onChange?: (from: string, to: string) => void,
  ) {}

  addState(state: MoveState<Ctx>): this {
    if (this.states.has(state.id)) throw new Error(`移動狀態「${state.id}」已註冊`);
    this.states.set(state.id, state);
    return this;
  }

  addTransition(t: Transition<Ctx>): this {
    this.transitions.push({ ...t, order: this.order++ });
    this.transitions.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0) || a.order - b.order);
    return this;
  }

  has(id: string): boolean {
    return this.states.has(id);
  }

  get stateIds(): string[] {
    return [...this.states.keys()];
  }

  get current(): MoveState<Ctx> {
    if (!this._current) throw new Error('狀態機尚未設定初始狀態');
    return this._current;
  }

  get currentId(): string {
    return this._current?.id ?? '';
  }

  get previousId(): string | null {
    return this._previousId;
  }

  /** 進入目前狀態後經過的模擬時間（秒）。 */
  get timeInState(): number {
    return this._timeInState;
  }

  is(id: string): boolean {
    return this._current?.id === id;
  }

  /** 直接切換（重生、初始化、強制狀態）；與目前狀態相同時不動作（force 時重新進入）。 */
  set(id: string, force = false): void {
    const next = this.states.get(id);
    if (!next) throw new Error(`沒有移動狀態「${id}」`);
    const prev = this._current;
    if (prev === next && !force) return;
    if (prev) prev.exit?.(this.ctx, id);
    this._previousId = prev?.id ?? null;
    this._current = next;
    this._timeInState = 0;
    next.enter?.(this.ctx, this._previousId);
    if (prev && prev.id !== id) this.onChange?.(prev.id, id);
  }

  /** 評估一個階段的轉換規則；發生轉換時回傳新狀態 id。 */
  evaluate(phase: TransitionPhase): string | null {
    const cur = this._current;
    if (!cur) return null;
    for (const t of this.transitions) {
      if (t.phase !== phase || t.to === cur.id) continue;
      if (!StateMachine.matches(t.from, cur.id)) continue;
      if (!this.states.has(t.to)) continue;
      if (!t.when(this.ctx)) continue;
      this.lastTransition = t.name ?? `${cur.id}→${t.to}`;
      this.set(t.to);
      return t.to;
    }
    return null;
  }

  /** 執行目前狀態的 step，並累計狀態時間。 */
  step(dt: number): void {
    this.current.step(this.ctx, dt);
    this._timeInState += dt;
  }

  private static matches(from: Transition<unknown>['from'], id: string): boolean {
    if (from === '*') return true;
    if (typeof from === 'string') return from === id;
    return from.includes(id);
  }
}
