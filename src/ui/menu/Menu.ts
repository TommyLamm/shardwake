// 選單與畫面框架（M1-14；Game 系統 name 'menu'、order ui）：DOM + CSS。
//
// - 導覽由 MenuNav（純邏輯）決定：遊戲模式 title／paused 開啟對應的根畫面，push／back 進出子畫面。
// - 畫面（MenuScreen）以 register() 註冊，第一次顯示時才 build() 建立 DOM；之後的計畫（M2-05 背包、M4 終端）
//   沿用同一套：註冊畫面 → menu.open(id)（或 nav.push）→ Esc／返回按鈕 back()。
// - 鍵盤：選單開啟時在 window 的 capture 階段先看 keydown——目前畫面的 handleKey() 優先（例如按鍵配置頁的等待輸入），
//   其次 Esc = 返回上一層（在根畫面不動作，避免 Esc 解鎖進入暫停後又被同一個 Esc 切走）。選單吃掉的按鍵不會再送到輸入系統。
// - 點擊背景：根畫面的 backdropAction（標題 = 開始、暫停 = 繼續；兩者都在點擊事件中請求滑鼠鎖定）。
// - 介面音效：滑過按鈕 ui.hover、點擊 ui.click（data-sound="none" 的按鈕不出聲，開始／繼續的 ui.confirm 由音效綁定在模式切換時播放）、
//   返回 ui.back。
// - 遊玩中未鎖定滑鼠（開著調參面板）時，畫面下方顯示不擋點擊的「點擊畫面恢復滑鼠視角」。
// - <html> 上的 data-sw-menu（目前畫面 id 或 none）與 data-sw-overlay（full／hint／hidden）供自動化測試。
import { SystemOrder, type FrameInfo, type GameSystem } from '@/core/Game';
import { h } from '@/ui/dom';
import type { MenuStatus } from '@/ui/menu/menuStatus';
import { MenuNav } from '@/ui/menu/MenuNav';

export type UiSound = 'ui.hover' | 'ui.click' | 'ui.confirm' | 'ui.back';

export interface MenuScreen {
  readonly id: string;
  /** 建立 DOM（第一次顯示時呼叫一次）。 */
  build(menu: Menu): HTMLElement;
  onShow?(): void;
  onHide?(): void;
  /** 顯示中每畫面呼叫（真實時間）；只在內容改變時寫 DOM。 */
  update?(realDt: number): void;
  /** 選單開啟時的每個 keydown（Esc 也會先經過這裡）；回傳 true 表示已處理。 */
  handleKey?(e: KeyboardEvent): boolean;
  /** 根畫面：點擊背景時的動作。 */
  backdropAction?(): void;
  dispose?(): void;
}

export interface MenuOptions {
  container: HTMLElement;
  nav?: MenuNav;
  playSound?: (id: UiSound) => void;
  /** 狀態提示（標題／暫停畫面下方的提示、遊玩中的小提示）。 */
  getStatus: () => MenuStatus;
  win?: Pick<Window, 'addEventListener' | 'removeEventListener'>;
}

interface Entry {
  screen: MenuScreen;
  el: HTMLElement | null;
}

export class Menu implements GameSystem {
  readonly name = 'menu';
  readonly order = SystemOrder.ui;
  readonly nav: MenuNav;
  readonly root: HTMLDivElement;
  readonly stage: HTMLDivElement;
  readonly hint: HTMLDivElement;
  private readonly screens = new Map<string, Entry>();
  private shown: string | null = null;
  private readonly win: Pick<Window, 'addEventListener' | 'removeEventListener'>;
  private lastHover: Element | null = null;
  private hoverAt = -Infinity;
  private hintText: string | null = null;
  private overlayState = '';

  constructor(private readonly options: MenuOptions) {
    this.nav = options.nav ?? new MenuNav();
    this.win = options.win ?? window;
    this.stage = h('div', { class: 'sw-menu-stage' });
    this.root = h('div', { class: 'sw-menu', hidden: true }, [h('div', { class: 'sw-menu-backdrop' }), this.stage]);
    this.hint = h('div', { class: 'sw-hint', hidden: true });
    options.container.append(this.root, this.hint);
    this.nav.onChange(() => this.sync());
    this.root.addEventListener('click', this.handleClick);
    this.root.addEventListener('pointerover', this.handleHover);
    this.win.addEventListener('keydown', this.handleKeyDown as EventListener, { capture: true });
    this.sync();
  }

  /** 註冊畫面（同 id 取代舊的）。 */
  register(screen: MenuScreen): MenuScreen {
    const old = this.screens.get(screen.id);
    if (old?.el) old.el.remove();
    this.screens.set(screen.id, { screen, el: null });
    if (this.nav.current === screen.id) this.sync();
    return screen;
  }

  getScreen<T extends MenuScreen>(id: string): T | undefined {
    return this.screens.get(id)?.screen as T | undefined;
  }

  /** 目前顯示的畫面 id。 */
  get current(): string | null {
    return this.nav.current;
  }

  get isOpen(): boolean {
    return this.nav.isOpen;
  }

  /** 開啟子畫面（設定、按鍵配置…）。 */
  open(id: string): boolean {
    if (!this.screens.has(id)) return false;
    return this.nav.push(id);
  }

  /** 返回上一層（有返回時播放 ui.back）。 */
  back(): boolean {
    const ok = this.nav.back();
    if (ok) this.sound('ui.back');
    return ok;
  }

  sound(id: UiSound): void {
    this.options.playSound?.(id);
  }

  get status(): MenuStatus {
    return this.options.getStatus();
  }

  update(_dt: number, frame: Readonly<FrameInfo>): void {
    if (this.nav.isOpen) {
      const id = this.shown;
      if (id) this.screens.get(id)?.screen.update?.(frame.realDt);
    }
    // 遊玩中未鎖定的小提示（內容沒變就不動 DOM）。
    const hint = this.nav.isOpen ? null : this.options.getStatus().hint;
    if (hint !== this.hintText) {
      this.hintText = hint;
      this.hint.hidden = hint === null;
      if (hint !== null) this.hint.textContent = hint;
      this.syncOverlayData();
    }
  }

  dispose(): void {
    this.win.removeEventListener('keydown', this.handleKeyDown as EventListener, { capture: true });
    for (const e of this.screens.values()) e.screen.dispose?.();
    this.root.remove();
    this.hint.remove();
  }

  // ── 內部 ───────────────────────────────────────────────

  private sync(): void {
    const next = this.nav.current;
    const doc = typeof document !== 'undefined' ? document : null;
    if (next !== this.shown) {
      const prev = this.shown ? this.screens.get(this.shown) : undefined;
      if (prev?.el) {
        prev.el.hidden = true;
        prev.screen.onHide?.();
      }
      this.shown = null;
      const entry = next ? this.screens.get(next) : undefined;
      if (entry) {
        if (!entry.el) {
          entry.el = entry.screen.build(this);
          entry.el.classList.add('sw-screen');
          entry.el.dataset.screen = entry.screen.id;
          this.stage.append(entry.el);
        }
        entry.el.hidden = false;
        this.shown = next;
        entry.screen.onShow?.();
        entry.screen.update?.(0);
        this.focusFirst(entry.el);
      }
    }
    const open = this.nav.isOpen;
    this.root.hidden = !open;
    this.root.dataset.root = this.nav.root ?? '';
    if (!open && doc) {
      // 關閉時移除焦點，避免遊玩中 Space／Enter 觸發隱藏的按鈕。
      const active = doc.activeElement as HTMLElement | null;
      if (active && this.root.contains(active)) active.blur();
    }
    if (doc) doc.documentElement.dataset.swMenu = this.shown ?? 'none';
    this.syncOverlayData();
  }

  private syncOverlayData(): void {
    const state = this.nav.isOpen ? 'full' : this.hintText !== null ? 'hint' : 'hidden';
    if (state === this.overlayState || typeof document === 'undefined') return;
    this.overlayState = state;
    document.documentElement.dataset.swOverlay = state;
  }

  private focusFirst(el: HTMLElement): void {
    // 嵌入平台的 iframe 不允許沒有使用者操作時移動焦點（focus-without-user-activation）：
    // 只在玩家剛操作過（點擊按鈕、按鍵）時自動聚焦，模式改變（解鎖、失焦）開啟的選單不搶焦點。
    const ua = (typeof navigator !== 'undefined' ? navigator : undefined) as { userActivation?: { isActive: boolean } } | undefined;
    if (ua?.userActivation && !ua.userActivation.isActive) return;
    const target = el.querySelector<HTMLElement>('[data-autofocus]') ?? el.querySelector<HTMLElement>('button:not([disabled])');
    target?.focus({ preventScroll: true });
  }

  private readonly handleKeyDown = (e: KeyboardEvent): void => {
    if (!this.nav.isOpen) return;
    const screen = this.shown ? this.screens.get(this.shown)?.screen : undefined;
    if (screen?.handleKey?.(e)) {
      e.preventDefault();
      e.stopImmediatePropagation();
      return;
    }
    if (e.code === 'Escape' || e.key === 'Escape') {
      if (!e.repeat) this.back();
      e.stopImmediatePropagation();
    }
  };

  private readonly handleClick = (e: MouseEvent): void => {
    const target = e.target as Element | null;
    if (!target) return;
    const button = target.closest('button');
    if (button && this.root.contains(button)) {
      const s = button.dataset.sound;
      if (s !== 'none' && !button.disabled) this.sound((s as UiSound | undefined) ?? 'ui.click');
      return;
    }
    // 點擊背景（不在面板內）：根畫面的動作（開始／繼續）。
    if (target.closest('.sw-panel')) return;
    if (!this.nav.atRoot || !this.shown) return;
    this.screens.get(this.shown)?.screen.backdropAction?.();
  };

  private readonly handleHover = (e: PointerEvent): void => {
    const button = (e.target as Element | null)?.closest('button') ?? null;
    if (!button) {
      this.lastHover = null;
      return;
    }
    if (button === this.lastHover || button.disabled) return;
    this.lastHover = button;
    const now = performance.now();
    if (now - this.hoverAt < 40) return;
    this.hoverAt = now;
    this.sound('ui.hover');
  };
}
