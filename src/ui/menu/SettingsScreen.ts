// 設定畫面（M1-14）：頁籤（控制、畫面、鏡頭、回饋、音效）＋依 SETTINGS_PAGES 產生的控制項。
// 改動立即呼叫 SettingsStore.update（驗證、夾住範圍、存檔、通知各系統套用）；其他地方（調參面板）改了設定也會同步回來。
// 「恢復預設」只重設目前頁籤的欄位。儲存不可用時顯示提示，設定照常套用（只保留到關閉頁面）。
import type { Settings, SettingsKey, SettingsStore } from '@/core/Settings';
import { t, tDynamic } from '@/i18n';
import { cmPer360 } from '@/input/Mouse';
import { ClassSlot, TextSlot, h } from '@/ui/dom';
import type { Menu, MenuScreen } from '@/ui/menu/Menu';
import { NotesView, Tabs, button, screenHeader } from '@/ui/menu/parts';
import {
  SETTINGS_PAGES,
  controlKind,
  findPage,
  formatSettingValue,
  inputText,
  optionLabel,
  pageKeys,
  parseSettingInput,
  snapToStep,
  specOf,
  type SettingItem,
} from '@/ui/menu/settingsPages';

interface Control {
  key: SettingsKey;
  refresh(): void;
}

export interface SettingsScreenOptions {
  settings: SettingsStore;
  /** 設定是否會保存（儲存不可用時顯示提示）。 */
  isPersistent: () => boolean;
}

let uid = 0;

export class SettingsScreen implements MenuScreen {
  readonly id = 'settings';
  private tabs: Tabs | null = null;
  private body: HTMLElement | null = null;
  private readonly pages = new Map<string, { el: HTMLElement; controls: Control[] }>();
  private readonly notes = new NotesView('sw-notes sw-settings-notes');
  private readonly status: TextSlot;
  private readonly statusEl: HTMLElement;
  private statusTimer = 0;
  private visible = false;
  private dirty = false;

  constructor(private readonly options: SettingsScreenOptions) {
    this.statusEl = h('span', { class: 'sw-settings-status' });
    this.status = new TextSlot(this.statusEl);
    options.settings.onChange(() => {
      if (this.visible) this.refreshAll();
      else this.dirty = true;
    });
  }

  /** 目前的頁籤 id。 */
  get currentTab(): string {
    return this.tabs?.current ?? SETTINGS_PAGES[0]!.id;
  }

  build(menu: Menu): HTMLElement {
    this.body = h('div', { class: 'sw-screen-body sw-settings-body' });
    this.tabs = new Tabs(
      SETTINGS_PAGES.map((p) => ({ id: p.id, label: t(p.labelKey) })),
      (id) => this.showPage(id),
    );
    const reset = button(t('menu.resetDefaults'), () => this.resetTab(), { variant: 'ghost' });
    const el = h('section', { class: 'sw-panel sw-sub-screen sw-settings-screen' }, [
      screenHeader(t('settings.title'), () => menu.back()),
      this.tabs.root,
      this.body,
      h('footer', { class: 'sw-screen-footer' }, [
        h('span', { class: 'sw-settings-autosave', text: t('settings.autoSave') }),
        this.statusEl,
        reset,
      ]),
      this.notes.root,
    ]);
    this.showPage(this.tabs.current);
    return el;
  }

  onShow(): void {
    this.visible = true;
    if (this.dirty) this.refreshAll();
    this.dirty = false;
  }

  onHide(): void {
    this.visible = false;
  }

  update(realDt: number): void {
    this.notes.set(this.options.isPersistent() ? [] : [t('note.storageUnavailable')]);
    if (this.statusTimer > 0) {
      this.statusTimer -= realDt;
      if (this.statusTimer <= 0) this.status.set('');
    }
  }

  handleKey(e: KeyboardEvent): boolean {
    // 頁籤切換：在輸入框外按 Q／E 或 [／]。
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'SELECT')) return false;
    if (e.code === 'BracketLeft' || e.code === 'PageUp') {
      this.tabs?.step(-1);
      return true;
    }
    if (e.code === 'BracketRight' || e.code === 'PageDown') {
      this.tabs?.step(1);
      return true;
    }
    return false;
  }

  /** 切換頁籤（自動化測試也用）。 */
  showPage(id: string): void {
    const page = findPage(id);
    if (!page || !this.body) return;
    let entry = this.pages.get(id);
    if (!entry) {
      const controls: Control[] = [];
      const el = h('div', { class: 'sw-settings-page', dataset: { page: id }, attrs: { role: 'tabpanel' } });
      for (const item of page.items) {
        const { row, control } = this.buildRow(item);
        el.append(row);
        controls.push(control);
      }
      entry = { el, controls };
      this.pages.set(id, entry);
    }
    for (const [pid, p] of this.pages) p.el.hidden = pid !== id;
    if (!entry.el.isConnected) this.body.append(entry.el);
    for (const c of entry.controls) c.refresh();
    if (this.tabs && this.tabs.current !== id) this.tabs.select(id);
  }

  private resetTab(): void {
    const page = findPage(this.currentTab);
    if (!page) return;
    this.options.settings.reset(pageKeys(page));
    this.refreshAll();
    this.flash(t('settings.resetTabDone', { tab: t(page.labelKey) }));
  }

  private flash(text: string): void {
    this.status.set(text);
    this.statusTimer = 2.5;
  }

  private refreshAll(): void {
    for (const p of this.pages.values()) for (const c of p.controls) c.refresh();
  }

  private buildRow(item: SettingItem): { row: HTMLElement; control: Control } {
    const key = item.key;
    const id = `sw-set-${key}-${uid++}`;
    const label = h('label', { class: 'sw-set-label', text: tDynamic(`setting.${key}`, specOf(key).label), attrs: { for: id } });
    const hint = h('span', { class: 'sw-set-hint', text: tDynamic(`settingHint.${key}`, '') });
    const control = this.buildControl(item, id);
    const row = h('div', { class: 'sw-set-row', dataset: { key } }, [h('div', { class: 'sw-set-text' }, [label, hint]), control.el]);
    return { row, control };
  }

  private buildControl(item: SettingItem, id: string): Control & { el: HTMLElement } {
    const key = item.key;
    const store = this.options.settings;
    const spec = specOf(key);
    const kind = controlKind(item);
    const get = (): unknown => store.get(key);
    const set = (v: unknown): void => {
      store.update({ [key]: v } as Partial<Settings>);
    };

    if (spec.type === 'boolean') {
      const b = button('', () => set(!get()), { class: 'sw-toggle' });
      b.id = id;
      const text = new TextSlot(b);
      const on = new ClassSlot(b, 'is-on');
      return {
        key,
        el: h('div', { class: 'sw-set-control' }, [b]),
        refresh: () => {
          const v = Boolean(get());
          text.set(v ? t('settings.on') : t('settings.off'));
          on.set(v);
          b.setAttribute('aria-pressed', String(v));
        },
      };
    }

    if (spec.type === 'enum') {
      if (kind === 'select') {
        const sel = h('select', { class: 'sw-select', attrs: { id } });
        for (const opt of spec.options) sel.append(h('option', { text: optionLabel(key, opt), attrs: { value: opt } }));
        sel.addEventListener('change', () => set(sel.value));
        return {
          key,
          el: h('div', { class: 'sw-set-control' }, [sel]),
          refresh: () => {
            const v = String(get());
            if (sel.value !== v) sel.value = v;
          },
        };
      }
      const group = h('div', { class: 'sw-choice', attrs: { role: 'radiogroup', id } });
      const buttons = spec.options.map((opt) => {
        const b = button(optionLabel(key, opt), () => set(opt), { class: 'sw-choice-btn' });
        b.setAttribute('role', 'radio');
        b.dataset.value = opt;
        group.append(b);
        return { b, on: new ClassSlot(b, 'is-on'), opt };
      });
      return {
        key,
        el: h('div', { class: 'sw-set-control' }, [group]),
        refresh: () => {
          const v = String(get());
          for (const x of buttons) {
            x.on.set(x.opt === v);
            x.b.setAttribute('aria-checked', String(x.opt === v));
          }
        },
      };
    }

    // 數字：滑桿 + 輸入框（或只有輸入框）。
    const input = h('input', {
      class: 'sw-num-input sw-num',
      attrs: { type: 'text', inputmode: 'decimal', autocomplete: 'off', spellcheck: 'false', id },
    });
    const unit = h('span', { class: 'sw-num-unit' });
    const unitText = new TextSlot(unit);
    const parts: HTMLElement[] = [];
    let range: HTMLInputElement | null = null;
    if (kind === 'slider') {
      range = h('input', {
        class: 'sw-range',
        attrs: { type: 'range', min: String(spec.min), max: String(spec.max), step: String(spec.step), 'aria-labelledby': id },
      });
      const r = range;
      r.addEventListener('input', () => set(snapToStep(key, Number(r.value))));
      parts.push(r);
    }
    const commit = (): void => {
      const v = parseSettingInput(key, input.value, item.format);
      if (v !== undefined) set(v);
      refresh();
    };
    input.addEventListener('change', commit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        commit();
        input.blur();
      }
    });
    parts.push(h('span', { class: 'sw-num-box' }, [input, unit]));
    let extra: TextSlot | null = null;
    if (item.extra === 'cm360') {
      const ex = h('span', { class: 'sw-set-extra sw-num', attrs: { title: t('settings.cm360Label') } });
      extra = new TextSlot(ex);
      parts.push(ex);
    }
    const unitOf = (): string => {
      const f = item.format;
      return f === 'percent' ? '%' : f === 'degrees' ? '°' : f === 'multiplier' ? '×' : '';
    };
    const refresh = (): void => {
      const v = Number(get());
      if (range && Number(range.value) !== v) range.value = String(v);
      if (document.activeElement !== input) {
        const text = inputText(key, v, item.format);
        if (input.value !== text) input.value = text;
      }
      unitText.set(unitOf());
      input.title = formatSettingValue(key, v, item.format);
      if (extra) {
        const cm = cmPer360(store.get('sensitivity'), store.get('mouseDpi'));
        extra.set(t('settings.cm360', { cm: Number.isFinite(cm) ? cm.toFixed(1) : '—' }));
      }
    };
    return { key, el: h('div', { class: `sw-set-control sw-set-${kind}` }, parts), refresh };
  }
}
