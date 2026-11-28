// 標題、暫停與操作說明畫面（M1-14）。按鈕只呼叫 MenuActions（main.ts 接到 LockFlow 與訓練場重設），畫面不持有遊戲邏輯。
import { t } from '@/i18n';
import type { Bindings } from '@/input/Bindings';
import { TextSlot, VisibleSlot, h } from '@/ui/dom';
import type { FullscreenControl } from '@/ui/fullscreen';
import type { Menu, MenuScreen } from '@/ui/menu/Menu';
import { HELP_TIPS, controlsRows } from '@/ui/menu/menuStatus';
import { NotesView, button, screenHeader } from '@/ui/menu/parts';

/** 選單按鈕觸發的動作（main.ts 實作）。開始與繼續必須在點擊事件中同步呼叫（滑鼠鎖定需要使用者手勢）。 */
export interface MenuActions {
  /** 標題 → 開始（鎖定滑鼠並啟用音效）。 */
  start(): void;
  /** 暫停 → 繼續（重新鎖定滑鼠）。 */
  resume(): void;
  /** 回到最近的檢查點（卡住時），然後繼續。 */
  resetPosition(): void;
  /** 重新開始訓練（出生點、回滿、靶標與 DPS 計重設），然後繼續。 */
  restartTraining(): void;
  /** 返回標題（下次開始為新的一局）。 */
  toTitle(): void;
}

export const SCREEN = {
  title: 'title',
  pause: 'pause',
  settings: 'settings',
  controls: 'controls',
  help: 'help',
} as const;

/** 全螢幕按鈕：只在沒有嵌入時顯示；文字隨狀態切換。 */
function fullscreenButton(fs: FullscreenControl, notes: { error: string | null }): { el: HTMLButtonElement; refresh(): void } {
  const el = button(t('menu.fullscreen'), () => {
    void fs.toggle().then((ok) => {
      notes.error = ok || !fs.lastError ? null : t('menu.fullscreenFailed', { reason: fs.lastError });
    });
  });
  const label = new TextSlot(el);
  const vis = new VisibleSlot(el);
  const refresh = (): void => {
    vis.set(fs.available || fs.active);
    label.set(fs.active ? t('menu.exitFullscreen') : t('menu.fullscreen'));
  };
  fs.onChange(() => refresh());
  refresh();
  return { el, refresh };
}

export interface RootScreenDeps {
  actions: MenuActions;
  fullscreen: FullscreenControl;
  version: string;
}

export class TitleScreen implements MenuScreen {
  readonly id = SCREEN.title;
  private notes = new NotesView();
  private fsError = { error: null as string | null };
  private menuRef: Menu | null = null;

  constructor(private readonly deps: RootScreenDeps) {}

  build(menu: Menu): HTMLElement {
    this.menuRef = menu;
    const a = this.deps.actions;
    const fs = fullscreenButton(this.deps.fullscreen, this.fsError);
    return h('section', { class: 'sw-root-screen sw-title-screen' }, [
      h('div', { class: 'sw-brand' }, [
        h('div', { class: 'sw-brand-mark', attrs: { 'aria-hidden': 'true' } }),
        h('h1', { class: 'sw-brand-title' }, [
          h('span', { class: 'sw-brand-zh', text: t('game.title') }),
          h('span', { class: 'sw-brand-latin', text: t('game.titleLatin') }),
        ]),
        h('p', { class: 'sw-brand-tagline', text: t('game.tagline') }),
      ]),
      h('div', { class: 'sw-panel sw-root-panel' }, [
        button(t('menu.start'), () => a.start(), { variant: 'primary', sound: 'none', autofocus: true, class: 'sw-btn-start' }),
        h('p', { class: 'sw-root-hint', text: t('menu.startHint') }),
        h('div', { class: 'sw-btn-row' }, [
          button(t('menu.settings'), () => menu.open(SCREEN.settings)),
          button(t('menu.controls'), () => menu.open(SCREEN.controls)),
          button(t('menu.help'), () => menu.open(SCREEN.help)),
          fs.el,
        ]),
        this.notes.root,
      ]),
      h('footer', { class: 'sw-root-footer sw-num', text: t('game.version', { version: this.deps.version }) }),
    ]);
  }

  onShow(): void {
    this.fsError.error = null;
  }

  update(): void {
    const notes = [...(this.menuRef?.status.notes ?? [])];
    if (this.fsError.error) notes.unshift(this.fsError.error);
    this.notes.set(notes);
  }

  backdropAction(): void {
    this.deps.actions.start();
  }
}

export class PauseScreen implements MenuScreen {
  readonly id = SCREEN.pause;
  private notes = new NotesView();
  private fsError = { error: null as string | null };
  private menuRef: Menu | null = null;

  constructor(private readonly deps: RootScreenDeps) {}

  build(menu: Menu): HTMLElement {
    this.menuRef = menu;
    const a = this.deps.actions;
    const fs = fullscreenButton(this.deps.fullscreen, this.fsError);
    return h('section', { class: 'sw-root-screen sw-pause-screen' }, [
      h('div', { class: 'sw-panel sw-root-panel sw-pause-panel' }, [
        h('h2', { class: 'sw-pause-title', text: t('menu.paused') }),
        button(t('menu.resume'), () => a.resume(), { variant: 'primary', sound: 'none', autofocus: true, class: 'sw-btn-resume' }),
        h('p', { class: 'sw-root-hint', text: t('menu.resumeHint') }),
        h('div', { class: 'sw-btn-col' }, [
          button(t('menu.settings'), () => menu.open(SCREEN.settings)),
          button(t('menu.controls'), () => menu.open(SCREEN.controls)),
          button(t('menu.help'), () => menu.open(SCREEN.help)),
          h('hr', { class: 'sw-sep' }),
          button(t('menu.resetPosition'), () => a.resetPosition(), { sound: 'none' }),
          button(t('menu.restartTraining'), () => a.restartTraining(), { sound: 'none' }),
          button(t('menu.toTitle'), () => a.toTitle(), { variant: 'danger', sound: 'ui.back' }),
          fs.el,
        ]),
        this.notes.root,
      ]),
    ]);
  }

  onShow(): void {
    this.fsError.error = null;
  }

  update(): void {
    const notes = [...(this.menuRef?.status.notes ?? [])];
    if (this.fsError.error) notes.unshift(this.fsError.error);
    this.notes.set(notes);
  }

  backdropAction(): void {
    this.deps.actions.resume();
  }
}

export class HelpScreen implements MenuScreen {
  readonly id = SCREEN.help;
  private table: HTMLElement | null = null;
  private key = '';

  constructor(private readonly bindings: Bindings) {}

  build(menu: Menu): HTMLElement {
    this.table = h('dl', { class: 'sw-help-table' });
    return h('section', { class: 'sw-panel sw-sub-screen sw-help-screen' }, [
      screenHeader(t('help.title'), () => menu.back()),
      h('div', { class: 'sw-screen-body' }, [
        this.table,
        h(
          'ul',
          { class: 'sw-help-tips' },
          HELP_TIPS.map((k) => h('li', { text: t(k) })),
        ),
      ]),
    ]);
  }

  onShow(): void {
    this.refresh();
  }

  private refresh(): void {
    if (!this.table) return;
    const rows = controlsRows(this.bindings);
    const key = JSON.stringify(rows);
    if (key === this.key) return;
    this.key = key;
    this.table.replaceChildren(...rows.flatMap(([label, keys]) => [h('dt', { text: label }), h('dd', { class: 'sw-keycap-text', text: keys })]));
  }
}
