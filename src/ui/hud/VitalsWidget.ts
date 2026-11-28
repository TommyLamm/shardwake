// HUD 左下：護盾與生命條（含受擊延遲條）。讀 PlayerHealth.state（M1-12），不持有邏輯。
import type { PlayerHealthState } from '@/combat/PlayerHealth';
import { t } from '@/i18n';
import { ClassSlot, TextSlot, h, scaleXSlot, type StyleSlot } from '@/ui/dom';
import type { HudFrame, HudWidget } from '@/ui/Hud';
import { HUD_CONFIG, type HudVitalsConfig } from '@/ui/HudConfig';
import { DelayedBar, formatCount, fraction } from '@/ui/hudMath';

interface BarView {
  root: HTMLElement;
  bar: DelayedBar;
  fill: StyleSlot;
  trail: StyleSlot;
  num: TextSlot;
  empty: ClassSlot;
}

function makeBar(kind: 'shield' | 'health', label: string, cfg: HudVitalsConfig): BarView {
  const fillEl = h('i', { class: 'sw-bar-fill' });
  const trailEl = h('i', { class: 'sw-bar-trail' });
  const numEl = h('span', { class: 'sw-bar-num sw-num' });
  const root = h('div', { class: `sw-bar sw-bar-${kind}` }, [
    h('span', { class: 'sw-bar-label', text: label }),
    h('div', { class: 'sw-bar-track' }, [trailEl, fillEl]),
    numEl,
  ]);
  return {
    root,
    bar: new DelayedBar(cfg),
    fill: scaleXSlot(fillEl),
    trail: scaleXSlot(trailEl),
    num: new TextSlot(numEl),
    empty: new ClassSlot(root, 'is-empty'),
  };
}

export interface VitalsWidgetOptions {
  getHealth: () => Readonly<PlayerHealthState> | null;
  config?: HudVitalsConfig;
}

export class VitalsWidget implements HudWidget {
  readonly id = 'vitals';
  readonly anchor = 'bottomLeft' as const;
  readonly order = 0;
  readonly root: HTMLElement;
  readonly shield: BarView;
  readonly health: BarView;
  private readonly cfg: HudVitalsConfig;
  private readonly recharging: ClassSlot;
  private readonly low: ClassSlot;

  constructor(private readonly options: VitalsWidgetOptions) {
    this.cfg = options.config ?? HUD_CONFIG.vitals;
    this.shield = makeBar('shield', t('hud.shield'), this.cfg);
    this.health = makeBar('health', t('hud.health'), this.cfg);
    this.root = h('div', { class: 'sw-vitals sw-hud-panel' }, [this.shield.root, this.health.root]);
    this.recharging = new ClassSlot(this.shield.root, 'is-recharging');
    this.low = new ClassSlot(this.health.root, 'is-low');
  }

  update(frame: Readonly<HudFrame>): void {
    const s = this.options.getHealth();
    if (!s) return;
    this.apply(this.shield, s.shield, s.maxShield, frame.dt);
    this.apply(this.health, s.health, s.maxHealth, frame.dt);
    this.recharging.set(s.shieldRecharging);
    this.low.set(s.alive && fraction(s.health, s.maxHealth) <= this.cfg.lowHealthFraction);
  }

  reset(): void {
    const s = this.options.getHealth();
    this.shield.bar.reset(s ? fraction(s.shield, s.maxShield) : 1);
    this.health.bar.reset(s ? fraction(s.health, s.maxHealth) : 1);
  }

  private apply(v: BarView, value: number, max: number, dt: number): void {
    v.bar.update(fraction(value, max), dt);
    v.fill.set(v.bar.value);
    v.trail.set(v.bar.trail);
    v.num.set(formatCount(Math.ceil(value - 1e-6)));
    v.empty.set(!(value > 0));
  }
}
