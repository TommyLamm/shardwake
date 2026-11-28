// HUD 右下：武器名、彈匣／備彈、射擊模式、換彈進度與欄位列。讀 WeaponManager.state（M1-10）。
import { t } from '@/i18n';
import { ClassSlot, DataSlot, TextSlot, VisibleSlot, h, scaleXSlot, type StyleSlot } from '@/ui/dom';
import type { HudFrame, HudWidget } from '@/ui/Hud';
import { HUD_CONFIG, type HudWeaponConfig } from '@/ui/HudConfig';
import { ammoTone, fireModeKey, formatCount } from '@/ui/hudMath';
import type { WeaponHudState } from '@/weapons/WeaponManager';

export interface WeaponWidgetOptions {
  getWeapon: () => Readonly<WeaponHudState> | null;
  /** 目前武器的射擊模式（WeaponDef.fire.mode）。 */
  getFireMode: () => string | null;
  /** 欄位 0..4 是否有武器（欄位列）。 */
  getSlotFilled: (slot: number) => boolean;
  /** 換彈按鍵的顯示名稱（彈匣打空時的提示）。 */
  getReloadKey: () => string;
  slotCount?: number;
  config?: HudWeaponConfig;
}

export class WeaponWidget implements HudWidget {
  readonly id = 'weapon';
  readonly anchor = 'bottomRight' as const;
  readonly order = 0;
  readonly root: HTMLElement;
  private readonly cfg: HudWeaponConfig;
  private readonly name: TextSlot;
  private readonly mode: TextSlot;
  private readonly ammo: TextSlot;
  private readonly reserve: TextSlot;
  private readonly tone: DataSlot;
  private readonly reloadBox: VisibleSlot;
  private readonly reloadFill: StyleSlot;
  private readonly prompt: TextSlot;
  private readonly promptVisible: VisibleSlot;
  private readonly slots: { active: ClassSlot; filled: ClassSlot }[] = [];
  private readonly visible: VisibleSlot;
  private readonly swapping: ClassSlot;

  constructor(private readonly options: WeaponWidgetOptions) {
    this.cfg = options.config ?? HUD_CONFIG.weapon;
    const nameEl = h('div', { class: 'sw-weapon-name' });
    const modeEl = h('span', { class: 'sw-weapon-mode' });
    const ammoEl = h('span', { class: 'sw-ammo sw-num' });
    const reserveEl = h('span', { class: 'sw-reserve sw-num' });
    const fillEl = h('i', { class: 'sw-bar-fill' });
    const reloadEl = h('div', { class: 'sw-reload' }, [
      h('span', { class: 'sw-reload-label', text: t('hud.reloading') }),
      h('div', { class: 'sw-bar-track' }, [fillEl]),
    ]);
    const promptEl = h('div', { class: 'sw-reload-prompt' });
    const slotRow = h('div', { class: 'sw-slots' });
    const n = options.slotCount ?? 5;
    for (let i = 0; i < n; i++) {
      const el = h('span', { class: 'sw-slot sw-num', text: String(i + 1) });
      slotRow.append(el);
      this.slots.push({ active: new ClassSlot(el, 'is-active'), filled: new ClassSlot(el, 'is-filled') });
    }
    const ammoRow = h('div', { class: 'sw-ammo-row' }, [ammoEl, h('span', { class: 'sw-ammo-sep', text: '/' }), reserveEl]);
    this.root = h('div', { class: 'sw-weapon sw-hud-panel' }, [
      slotRow,
      nameEl,
      ammoRow,
      h('div', { class: 'sw-weapon-meta' }, [modeEl]),
      reloadEl,
      promptEl,
    ]);
    this.name = new TextSlot(nameEl);
    this.mode = new TextSlot(modeEl);
    this.ammo = new TextSlot(ammoEl);
    this.reserve = new TextSlot(reserveEl);
    this.tone = new DataSlot(ammoRow, 'tone');
    this.reloadBox = new VisibleSlot(reloadEl);
    this.reloadFill = scaleXSlot(fillEl);
    this.prompt = new TextSlot(promptEl);
    this.promptVisible = new VisibleSlot(promptEl);
    this.visible = new VisibleSlot(this.root);
    this.swapping = new ClassSlot(this.root, 'is-swapping');
  }

  update(_frame: Readonly<HudFrame>): void {
    const w = this.options.getWeapon();
    const has = Boolean(w && w.weaponId);
    this.visible.set(has);
    if (!w || !has) return;
    this.name.set(w.name);
    this.mode.set(t(fireModeKey(this.options.getFireMode() ?? '')));
    this.ammo.set(formatCount(w.ammo));
    this.reserve.set(formatCount(w.reserve, t('hud.infinite')));
    const tone = ammoTone(w.ammo, w.mag, this.cfg.lowAmmoFraction);
    this.tone.set(tone);
    const reloading = w.phase === 'reloading';
    this.reloadBox.set(reloading);
    if (reloading) this.reloadFill.set(w.reloadProgress);
    const showPrompt = !reloading && tone === 'empty' && w.reserve > 0;
    this.promptVisible.set(showPrompt);
    if (showPrompt) this.prompt.set(t('hud.reloadPrompt', { key: this.options.getReloadKey() }));
    this.swapping.set(w.phase === 'swapping');
    const activeSlot = w.phase === 'swapping' ? w.swapTo : w.slot;
    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i]!;
      s.active.set(i === activeSlot);
      s.filled.set(this.options.getSlotFilled(i));
    }
  }
}
