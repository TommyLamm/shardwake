// 選單導覽狀態機（M1-14，純邏輯、可無頭測試）。
//
// 根畫面由遊戲模式決定：title → 'title'、paused → 'pause'、playing／boot → 關閉。根畫面之上是子畫面堆疊
// （設定、按鍵配置、操作說明；M2-05 的背包、M4 的終端沿用 push／back）。
// - syncMode(mode)：模式改變時呼叫。換到不同的根畫面時清空堆疊；同一個根畫面（例如暫停中又因失焦暫停）保留堆疊。
// - back()：Esc／返回按鈕。堆疊有子畫面時彈出一層並回傳 true；已在根畫面時不動作（回傳 false），
//   所以「Esc 解除滑鼠鎖定 → 進入暫停」之後同一個 Esc 再送到遊戲也不會重複切換。
import type { GameMode } from '@/core/events';

export type MenuRoot = 'title' | 'pause';

export type MenuNavListener = (nav: MenuNav, previous: string | null) => void;

export function rootForMode(mode: GameMode): MenuRoot | null {
  if (mode === 'title') return 'title';
  if (mode === 'paused') return 'pause';
  return null;
}

export class MenuNav {
  private _root: MenuRoot | null = null;
  private readonly _stack: string[] = [];
  private readonly listeners = new Set<MenuNavListener>();
  /** 每次改變遞增。 */
  version = 0;

  get root(): MenuRoot | null {
    return this._root;
  }

  get stack(): readonly string[] {
    return this._stack;
  }

  get isOpen(): boolean {
    return this._root !== null;
  }

  /** 目前顯示的畫面 id（堆疊頂端或根畫面；關閉時為 null）。 */
  get current(): string | null {
    return this._stack.length > 0 ? this._stack[this._stack.length - 1]! : this._root;
  }

  /** 在根畫面（沒有子畫面）。 */
  get atRoot(): boolean {
    return this._root !== null && this._stack.length === 0;
  }

  onChange(listener: MenuNavListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** 依遊戲模式開關根畫面；回傳是否改變。 */
  syncMode(mode: GameMode): boolean {
    const root = rootForMode(mode);
    if (root === this._root) return false;
    const prev = this.current;
    this._root = root;
    this._stack.length = 0;
    this.changed(prev);
    return true;
  }

  /** 開啟子畫面（選單關閉中、或已經是目前畫面時不動作）。 */
  push(screen: string): boolean {
    if (!this.isOpen || screen === this.current || screen === this._root) return false;
    const prev = this.current;
    const existing = this._stack.indexOf(screen);
    // 已在堆疊中：回到那一層（不重複堆疊）。
    if (existing >= 0) this._stack.length = existing + 1;
    else this._stack.push(screen);
    this.changed(prev);
    return true;
  }

  /** 返回上一層；已在根畫面或關閉時回傳 false。 */
  back(): boolean {
    if (this._stack.length === 0) return false;
    const prev = this.current;
    this._stack.pop();
    this.changed(prev);
    return true;
  }

  /** 回到根畫面。 */
  backToRoot(): boolean {
    if (this._stack.length === 0) return false;
    const prev = this.current;
    this._stack.length = 0;
    this.changed(prev);
    return true;
  }

  private changed(prev: string | null): void {
    this.version++;
    for (const l of [...this.listeners]) l(this, prev);
  }
}
