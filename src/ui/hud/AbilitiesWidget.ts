// HUD 左下（生命條下方）：Dash 充能格、噴射燃料條、抓鉤冷卻環。讀 player.abilities.state（M1-07）。
// 能力被關閉（調參面板「移動/能力開關」）時隱藏對應元件；燃料滿且一段時間沒用時淡出燃料條。
import { t } from '@/i18n';
import type { AbilityState } from '@/player/Abilities';
import { ClassSlot, StyleSlot, TextSlot, VisibleSlot, h, scaleXSlot, svg } from '@/ui/dom';
import type { HudFrame, HudWidget } from '@/ui/Hud';
import { HUD_CONFIG, type HudAbilityConfig } from '@/ui/HudConfig';
import type { HudLayout } from '@/ui/hudMath';
import { chargePips, cooldownProgress, ringDashOffset } from '@/ui/hudMath';

export interface AbilitiesWidgetOptions {
  getAbilities: () => Readonly<AbilityState> | null;
  /** 抓鉤按鍵的顯示名稱（冷卻環中央）。 */
  getGrappleKey: () => string;
  config?: HudAbilityConfig;
}

interface Pip {
  root: HTMLElement;
  fill: StyleSlot;
  full: ClassSlot;
}

export class AbilitiesWidget implements HudWidget {
  readonly id = 'abilities';
  readonly anchor = 'bottomLeft' as const;
  readonly order = 1;
  readonly root: HTMLElement;
  private readonly cfg: HudAbilityConfig;
  private readonly dashBox: HTMLElement;
  private readonly dashVisible: VisibleSlot;
  private readonly pipsEl: HTMLElement;
  private pips: Pip[] = [];
  private readonly pipValues: number[] = [];
  private readonly jetVisible: VisibleSlot;
  private readonly jetFill: StyleSlot;
  private readonly jetActive: ClassSlot;
  private readonly jetFaded: ClassSlot;
  private readonly grappleVisible: VisibleSlot;
  private readonly ring: SVGCircleElement;
  private readonly ringOffset: StyleSlot;
  private readonly grappleReady: ClassSlot;
  private readonly grappleActive: ClassSlot;
  private readonly grappleKey: TextSlot;
  private circumference = 0;
  private jetIdle = 0;

  constructor(private readonly options: AbilitiesWidgetOptions) {
    this.cfg = options.config ?? HUD_CONFIG.abilities;
    this.pipsEl = h('div', { class: 'sw-pips' });
    this.dashBox = h('div', { class: 'sw-ability sw-ability-dash' }, [h('span', { class: 'sw-ability-label', text: t('hud.dash') }), this.pipsEl]);
    this.dashVisible = new VisibleSlot(this.dashBox);

    const jetFillEl = h('i', { class: 'sw-bar-fill' });
    const jetBox = h('div', { class: 'sw-ability sw-ability-jet' }, [
      h('span', { class: 'sw-ability-label', text: t('hud.jet') }),
      h('div', { class: 'sw-bar-track sw-jet-track' }, [jetFillEl]),
    ]);
    this.jetVisible = new VisibleSlot(jetBox);
    this.jetFill = scaleXSlot(jetFillEl);
    this.jetActive = new ClassSlot(jetBox, 'is-active');
    this.jetFaded = new ClassSlot(jetBox, 'is-faded');

    const ringSvg = svg('svg', { class: 'sw-ring', viewBox: '0 0 40 40' });
    ringSvg.append(svg('circle', { class: 'sw-ring-bg', cx: '20', cy: '20', r: '17' }));
    this.ring = svg('circle', { class: 'sw-ring-fg', cx: '20', cy: '20', r: '17', transform: 'rotate(-90 20 20)' });
    ringSvg.append(this.ring);
    const keyEl = h('span', { class: 'sw-ring-key' });
    const grappleBox = h('div', { class: 'sw-ability sw-ability-grapple' }, [
      h('div', { class: 'sw-ring-wrap' }, [ringSvg, keyEl]),
      h('span', { class: 'sw-ability-label', text: t('hud.grapple') }),
    ]);
    this.grappleVisible = new VisibleSlot(grappleBox);
    this.circumference = 2 * Math.PI * 17;
    this.ring.style.strokeDasharray = this.circumference.toFixed(2);
    this.ringOffset = new StyleSlot(this.ring, 'stroke-dashoffset', (v) => v.toFixed(2), 0.05);
    this.grappleReady = new ClassSlot(grappleBox, 'is-ready');
    this.grappleActive = new ClassSlot(grappleBox, 'is-active');
    this.grappleKey = new TextSlot(keyEl);

    this.root = h('div', { class: 'sw-abilities sw-hud-panel' }, [this.dashBox, jetBox, grappleBox]);
  }

  layout(l: Readonly<HudLayout>): void {
    this.root.style.setProperty('--sw-ring-size', `${(this.cfg.grappleRingRadius * 2 * l.scale).toFixed(1)}px`);
  }

  update(frame: Readonly<HudFrame>): void {
    const a = this.options.getAbilities();
    if (!a) return;
    // Dash
    this.dashVisible.set(a.dash.enabled);
    if (a.dash.enabled) {
      const values = chargePips(a.dash.charges, a.dash.maxCharges, a.dash.rechargeProgress, this.pipValues);
      if (this.pips.length !== values.length) this.buildPips(values.length);
      for (let i = 0; i < values.length; i++) {
        const p = this.pips[i]!;
        p.fill.set(values[i]!);
        p.full.set(values[i]! >= 1);
      }
    }
    // 噴射
    const jet = a.jet;
    this.jetVisible.set(jet.enabled);
    if (jet.enabled) {
      this.jetFill.set(jet.fraction);
      this.jetActive.set(jet.active);
      const full = jet.fraction >= 0.999 && !jet.active;
      this.jetIdle = full ? this.jetIdle + frame.dt : 0;
      this.jetFaded.set(this.cfg.jetHideDelay > 0 && full && this.jetIdle >= this.cfg.jetHideDelay);
    }
    // 抓鉤
    const g = a.grapple;
    this.grappleVisible.set(g.enabled);
    if (g.enabled) {
      const active = g.phase !== 'idle';
      const progress = active ? 1 : cooldownProgress(g.cooldown, g.cooldownTotal);
      this.ringOffset.set(ringDashOffset(progress, this.circumference));
      this.grappleReady.set(g.ready);
      this.grappleActive.set(active);
      this.grappleKey.set(this.options.getGrappleKey());
    }
  }

  private buildPips(n: number): void {
    this.pips = [];
    this.pipsEl.replaceChildren();
    for (let i = 0; i < n; i++) {
      const fill = h('i', { class: 'sw-pip-fill' });
      const root = h('span', { class: 'sw-pip' }, [fill]);
      this.pipsEl.append(root);
      this.pips.push({ root, fill: new StyleSlot(fill, 'transform', (v) => `scaleY(${v.toFixed(3)})`, 0.002), full: new ClassSlot(root, 'is-full') });
    }
  }
}
