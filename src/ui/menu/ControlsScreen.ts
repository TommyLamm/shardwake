// 按鍵配置畫面（M1-14）：每個動作兩欄綁定（主要／次要），點擊一欄後按下新的鍵或滑鼠鍵（含滾輪）。
// 流程邏輯在 rebind.ts 的 RebindSession（純邏輯）；這裡只負責 DOM 與擷取輸入：
// - 鍵盤：由 Menu 的 capture keydown 轉給 handleKey()（不會再送到輸入系統，等待中按 Esc 只取消、不返回）。
// - 滑鼠與滾輪：等待中在 window 的 capture 階段攔下 mousedown／wheel／contextmenu；用滑鼠綁定後吞掉緊接的 click，
//   避免同一下點擊又開始等待另一欄。衝突提示的「取代／取消」按鈕（data-rebind-ui）不當成輸入。
// 綁定存在 shardwake:bindings:v1（Bindings 自動存檔）。
import { t } from '@/i18n';
import { ACTIONS, ACTION_INFO, type Action, type ActionCategory } from '@/input/Actions';
import { MAX_BINDINGS_PER_ACTION, WHEEL_DOWN, WHEEL_UP, keyName, mouseButtonCode, type Bindings } from '@/input/Bindings';
import { ClassSlot, TextSlot, VisibleSlot, h } from '@/ui/dom';
import type { Menu, MenuScreen } from '@/ui/menu/Menu';
import { button, screenHeader } from '@/ui/menu/parts';
import { RebindSession, actionName } from '@/ui/menu/rebind';

const CATEGORY_ORDER: readonly ActionCategory[] = ['move', 'combat', 'weapon', 'system', 'dev'];

interface SlotView {
  action: Action;
  slot: number;
  button: HTMLButtonElement;
  text: TextSlot;
  capturing: ClassSlot;
  conflict: ClassSlot;
  empty: ClassSlot;
}

export interface ControlsScreenOptions {
  bindings: Bindings;
  win?: Window;
  now?: () => number;
}

export class ControlsScreen implements MenuScreen {
  readonly id = 'controls';
  readonly session: RebindSession;
  private readonly slots: SlotView[] = [];
  private menu: Menu | null = null;
  private feedbackEl: HTMLElement | null = null;
  private feedbackText: TextSlot | null = null;
  private feedbackTone: HTMLElement | null = null;
  private conflictActions: VisibleSlot | null = null;
  private renderedVersion = -1;
  private listening = false;
  private guarding = false;
  private suppressClickUntil = 0;
  private suppressContextUntil = 0;
  private readonly win: Window;
  private readonly now: () => number;

  constructor(private readonly options: ControlsScreenOptions) {
    this.session = new RebindSession(options.bindings);
    this.win = options.win ?? window;
    this.now = options.now ?? (() => performance.now());
    options.bindings.onChange(() => this.refresh(true));
  }

  build(menu: Menu): HTMLElement {
    this.menu = menu;
    const list = h('div', { class: 'sw-binds' });
    for (const cat of CATEGORY_ORDER) {
      const actions = ACTIONS.filter((a) => ACTION_INFO[a].category === cat);
      if (actions.length === 0) continue;
      list.append(
        h('div', { class: 'sw-binds-head' }, [
          h('span', { class: 'sw-binds-cat', text: t(`controls.category.${cat}`) }),
          h('span', { class: 'sw-binds-col', text: t('controls.primary') }),
          h('span', { class: 'sw-binds-col', text: t('controls.secondary') }),
        ]),
      );
      for (const a of actions) list.append(this.buildRow(a));
    }
    const replace = button(t('controls.replace'), () => {
      this.session.confirmReplace();
      this.refresh();
    });
    const cancel = button(t('controls.cancel'), () => {
      this.session.cancel();
      this.refresh();
    }, { variant: 'ghost', sound: 'ui.back' });
    const actionsEl = h('span', { class: 'sw-feedback-actions', dataset: { rebindUi: '' } }, [replace, cancel]);
    this.conflictActions = new VisibleSlot(actionsEl);
    const textEl = h('span', { class: 'sw-feedback-text' });
    this.feedbackText = new TextSlot(textEl);
    this.feedbackEl = h('div', { class: 'sw-feedback', attrs: { role: 'status', 'aria-live': 'polite' } }, [textEl, actionsEl]);
    this.feedbackTone = this.feedbackEl;
    const resetAll = button(t('menu.resetAllDefaults'), () => {
      this.session.cancel();
      this.options.bindings.reset();
      this.session.feedback = { tone: 'good', text: t('controls.resetDone') };
      this.session.version++;
      this.refresh(true);
    }, { variant: 'ghost' });
    const el = h('section', { class: 'sw-panel sw-sub-screen sw-controls-screen' }, [
      screenHeader(t('controls.title'), () => menu.back()),
      this.feedbackEl,
      h('div', { class: 'sw-screen-body' }, [list]),
      h('footer', { class: 'sw-screen-footer' }, [h('span', { class: 'sw-settings-autosave', text: t('controls.noteKeyCode') }), resetAll]),
    ]);
    this.refresh(true);
    return el;
  }

  onShow(): void {
    this.attachGuards();
    this.session.feedback = null;
    this.session.version++;
    this.refresh(true);
  }

  onHide(): void {
    if (this.session.active) this.session.cancel();
    this.stopListening();
    this.detachGuards();
  }

  update(): void {
    if (this.session.version !== this.renderedVersion) this.refresh();
  }

  handleKey(e: KeyboardEvent): boolean {
    if (!this.session.active) return false;
    if (e.repeat) return true;
    const code = e.code || (e.key === 'Escape' ? 'Escape' : '');
    if (!code) return true;
    const out = this.session.input(code);
    if (out.kind === 'cancelled') this.menu?.sound('ui.back');
    else if (out.kind === 'bound' || out.kind === 'replaced' || out.kind === 'cleared') this.menu?.sound('ui.confirm');
    this.refresh();
    return true;
  }

  dispose(): void {
    this.stopListening();
    this.detachGuards();
  }

  // ── 內部 ───────────────────────────────────────────────

  private buildRow(action: Action): HTMLElement {
    const cells: HTMLElement[] = [h('span', { class: 'sw-bind-label', text: actionName(action) })];
    for (let slot = 0; slot < MAX_BINDINGS_PER_ACTION; slot++) {
      const b = button('', () => this.startCapture(action, slot), { class: 'sw-bind-slot sw-num', sound: 'none' });
      b.dataset.action = action;
      b.dataset.slot = String(slot);
      this.slots.push({
        action,
        slot,
        button: b,
        text: new TextSlot(b),
        capturing: new ClassSlot(b, 'is-capturing'),
        conflict: new ClassSlot(b, 'is-conflict'),
        empty: new ClassSlot(b, 'is-empty'),
      });
      cells.push(b);
    }
    return h('div', { class: 'sw-bind-row', dataset: { action } }, cells);
  }

  private startCapture(action: Action, slot: number): void {
    if (this.now() < this.suppressClickUntil) return;
    this.session.start(action, slot);
    this.menu?.sound('ui.click');
    this.startListening();
    this.refresh();
  }

  private refresh(force = false): void {
    const s = this.session;
    if (!force && s.version === this.renderedVersion) return;
    this.renderedVersion = s.version;
    const b = this.options.bindings;
    for (const v of this.slots) {
      const codes = b.get(v.action);
      const code = codes[v.slot];
      const capturing = s.isCapturing(v.action, v.slot);
      v.text.set(capturing ? (s.phase === 'conflict' && s.pendingCode ? keyName(s.pendingCode) : t('controls.capturing')) : code ? keyName(code) : t('controls.unbound'));
      v.capturing.set(capturing && s.phase === 'capturing');
      v.conflict.set(capturing && s.phase === 'conflict');
      v.empty.set(!code && !capturing);
      v.button.setAttribute('aria-pressed', String(capturing));
    }
    const fb = s.feedback;
    this.feedbackText?.set(fb?.text ?? '');
    if (this.feedbackTone) this.feedbackTone.dataset.tone = fb?.tone ?? 'none';
    this.conflictActions?.set(s.phase === 'conflict');
    if (s.active) this.startListening();
    else this.stopListening();
  }

  private startListening(): void {
    if (this.listening) return;
    this.listening = true;
    const opts = { capture: true, passive: false } as const;
    this.win.addEventListener('mousedown', this.onMouseDown, opts);
    this.win.addEventListener('wheel', this.onWheel, opts);
  }

  private stopListening(): void {
    if (!this.listening) return;
    this.listening = false;
    this.win.removeEventListener('mousedown', this.onMouseDown, { capture: true });
    this.win.removeEventListener('wheel', this.onWheel, { capture: true });
  }

  /** 顯示中：吞掉用滑鼠綁定後緊接的 click 與右鍵選單（mouseup 之後才發生）。 */
  private attachGuards(): void {
    if (this.guarding) return;
    this.guarding = true;
    this.win.addEventListener('contextmenu', this.onContextMenu, { capture: true });
    this.win.addEventListener('click', this.onClick, { capture: true });
  }

  private detachGuards(): void {
    if (!this.guarding) return;
    this.guarding = false;
    this.win.removeEventListener('contextmenu', this.onContextMenu, { capture: true });
    this.win.removeEventListener('click', this.onClick, { capture: true });
  }

  private readonly onMouseDown = (e: MouseEvent): void => {
    if (!this.session.active) return;
    if ((e.target as Element | null)?.closest?.('[data-rebind-ui]')) return;
    if (e.button < 0 || e.button > 4) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    // 左鍵綁定後吞掉緊接的 click；右鍵綁定後擋下緊接的右鍵選單（右鍵不會產生 click）。
    if (e.button === 0) this.suppressClickUntil = this.now() + 600;
    if (e.button === 2) this.suppressContextUntil = this.now() + 600;
    const out = this.session.input(mouseButtonCode(e.button));
    if (out.kind === 'bound' || out.kind === 'replaced') this.menu?.sound('ui.confirm');
    this.refresh();
  };

  private readonly onWheel = (e: WheelEvent): void => {
    if (!this.session.active || e.deltaY === 0) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const out = this.session.input(e.deltaY > 0 ? WHEEL_DOWN : WHEEL_UP);
    if (out.kind === 'bound' || out.kind === 'replaced') this.menu?.sound('ui.confirm');
    this.refresh();
  };

  private readonly onContextMenu = (e: Event): void => {
    if (this.session.active || this.now() < this.suppressContextUntil) e.preventDefault();
  };

  private readonly onClick = (e: MouseEvent): void => {
    if (this.now() >= this.suppressClickUntil) return;
    if ((e.target as Element | null)?.closest?.('[data-rebind-ui]')) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    this.suppressClickUntil = 0;
  };
}
