// 選單共用元件（M1-14）：按鈕、畫面標頭、提示清單、頁籤。M2-05 背包、M4 終端沿用。
import { t } from '@/i18n';
import { h } from '@/ui/dom';
import type { UiSound } from '@/ui/menu/Menu';

export type ButtonVariant = 'primary' | 'default' | 'ghost' | 'danger';

export interface ButtonOptions {
  variant?: ButtonVariant;
  /** 點擊音效；'none' 不出聲（預設 ui.click）。 */
  sound?: UiSound | 'none';
  autofocus?: boolean;
  class?: string;
  title?: string;
}

/** 選單按鈕（type=button，不會提交表單）。 */
export function button(label: string, onClick: (e: MouseEvent) => void, opts: ButtonOptions = {}): HTMLButtonElement {
  const b = h('button', {
    class: `sw-btn sw-btn-${opts.variant ?? 'default'} ${opts.class ?? ''}`.trim(),
    text: label,
    attrs: { type: 'button' },
    onClick,
  });
  if (opts.sound) b.dataset.sound = opts.sound;
  if (opts.autofocus) b.dataset.autofocus = '';
  if (opts.title) b.title = opts.title;
  return b;
}

/** 子畫面的標頭：返回按鈕 + 標題 +（選填）右側內容。 */
export function screenHeader(title: string, onBack: () => void, right?: HTMLElement): HTMLElement {
  const back = button(`‹ ${t('menu.back')}`, () => onBack(), { variant: 'ghost', sound: 'none', class: 'sw-back' });
  back.title = t('menu.escBack');
  return h('header', { class: 'sw-screen-header' }, [back, h('h2', { class: 'sw-screen-title', text: title }), right ?? null]);
}

/** 提示清單：內容（字串陣列）沒變就不動 DOM。 */
export class NotesView {
  readonly root: HTMLElement;
  private key = '';

  constructor(className = 'sw-notes') {
    this.root = h('div', { class: className, attrs: { role: 'status' } });
  }

  set(notes: readonly string[]): void {
    const key = notes.join('\n');
    if (key === this.key) return;
    this.key = key;
    this.root.replaceChildren(...notes.map((n) => h('p', { text: n })));
    this.root.hidden = notes.length === 0;
  }
}

export interface TabDef {
  id: string;
  label: string;
}

/** 頁籤列（role=tablist）；select(id) 切換並呼叫 onChange。 */
export class Tabs {
  readonly root: HTMLElement;
  private readonly buttons = new Map<string, HTMLButtonElement>();
  private _current: string;

  constructor(
    tabs: readonly TabDef[],
    private readonly onChange: (id: string) => void,
    initial?: string,
  ) {
    this.root = h('div', { class: 'sw-tabs', attrs: { role: 'tablist' } });
    for (const tab of tabs) {
      const b = button(tab.label, () => this.select(tab.id), { class: 'sw-tab', variant: 'ghost' });
      b.setAttribute('role', 'tab');
      this.buttons.set(tab.id, b);
      this.root.append(b);
    }
    this._current = initial ?? tabs[0]?.id ?? '';
    this.mark();
  }

  get current(): string {
    return this._current;
  }

  select(id: string): void {
    if (!this.buttons.has(id)) return;
    const changed = id !== this._current;
    this._current = id;
    this.mark();
    if (changed) this.onChange(id);
  }

  /** 循環切換（Q／E 或方向鍵用）。 */
  step(delta: number): void {
    const ids = [...this.buttons.keys()];
    const i = ids.indexOf(this._current);
    const next = ids[(i + delta + ids.length) % ids.length];
    if (next) this.select(next);
  }

  private mark(): void {
    for (const [id, b] of this.buttons) {
      const on = id === this._current;
      b.setAttribute('aria-selected', String(on));
      b.classList.toggle('is-active', on);
    }
  }
}
