// 命中標記（M1-12；M1-14 組合進 HUD）：畫面中心的 X。一般命中白色、爆頭黃色較大、擊殺紅色並短暫放大與輕微震動。
// 由 `combat:hit`（每步彙總一次）觸發；新命中的優先度不低於目前顯示中的才會取代（擊殺不會被同時的一般命中蓋掉）。
// DOM（CSS 變數），值改變時才寫入，不佔 draw call。設定「命中標記」可關閉。
import type { EventBus } from '@/core/EventBus';
import type { GameEvents } from '@/core/events';
import { SystemOrder, type FrameInfo, type GameSystem } from '@/core/Game';
import { strongerHit } from '@/combat/HitConfirm';
import { FEEDBACK_CONFIG, type HitMarkerConfig } from '@/ui/FeedbackConfig';
import { hitMarkerStyle, type HitMarkerStyle, type MarkerKind } from '@/ui/feedbackMath';

export interface HitMarkerOptions {
  container: HTMLElement;
  bus: EventBus<GameEvents>;
  config?: HitMarkerConfig;
  isEnabled?: () => boolean;
}

export class HitMarker implements GameSystem {
  readonly name = 'hitMarker';
  readonly order = SystemOrder.ui;
  readonly root: HTMLElement;
  readonly config: HitMarkerConfig;
  kind: MarkerKind = 'hit';
  age = Infinity;
  /** 累計觸發次數（除錯、測試）。 */
  readonly counts = { hit: 0, crit: 0, kill: 0 };
  private readonly style: HitMarkerStyle = { visible: false, opacity: 0, size: 0, scale: 1, color: '', shakeX: 0, shakeY: 0 };
  private readonly off: () => void;
  private written = { o: -1, size: -1, color: '', sx: 0, sy: 0, th: -1, gap: -1 };

  constructor(private readonly options: HitMarkerOptions) {
    this.config = options.config ?? FEEDBACK_CONFIG.hitMarker;
    const root = document.createElement('div');
    root.className = 'sw-hitmarker';
    root.setAttribute('aria-hidden', 'true');
    for (const cls of ['sw-hm-a', 'sw-hm-b', 'sw-hm-c', 'sw-hm-d']) {
      const i = document.createElement('i');
      i.className = cls;
      root.appendChild(i);
    }
    options.container.appendChild(root);
    this.root = root;
    this.off = options.bus.on('combat:hit', (e) => this.trigger(e.kind));
  }

  /** 顯示命中標記（kind 不比目前顯示中的弱時才取代）。 */
  trigger(kind: MarkerKind): void {
    if (this.options.isEnabled && !this.options.isEnabled()) return;
    this.counts[kind]++;
    const showing = this.age < this.durationOf(this.kind);
    this.kind = showing ? strongerHit(this.kind, kind) : kind;
    this.age = 0;
  }

  private durationOf(kind: MarkerKind): number {
    const c = this.config;
    return kind === 'kill' ? c.killDuration : kind === 'crit' ? c.critDuration : c.duration;
  }

  render(_alpha: number, frame: Readonly<FrameInfo>): void {
    if (this.age < Infinity) this.age += frame.realDt;
    const st = hitMarkerStyle(this.config, this.kind, this.age, this.style);
    const w = this.written;
    const s = this.root.style;
    const o = st.visible ? st.opacity : 0;
    if (Math.abs(o - w.o) > 0.004) {
      s.opacity = o.toFixed(3);
      w.o = o;
    }
    if (!st.visible) return;
    if (Math.abs(st.size - w.size) > 0.05) {
      s.setProperty('--sw-hm-len', `${st.size.toFixed(2)}px`);
      w.size = st.size;
    }
    if (st.color !== w.color) {
      s.setProperty('--sw-hm-color', st.color);
      w.color = st.color;
    }
    if (this.config.thickness !== w.th || this.config.gap !== w.gap) {
      s.setProperty('--sw-hm-th', `${this.config.thickness}px`);
      s.setProperty('--sw-hm-gap', `${this.config.gap}px`);
      w.th = this.config.thickness;
      w.gap = this.config.gap;
    }
    if (st.shakeX !== w.sx || st.shakeY !== w.sy) {
      s.transform = `translate(${st.shakeX.toFixed(2)}px, ${st.shakeY.toFixed(2)}px)`;
      w.sx = st.shakeX;
      w.sy = st.shakeY;
    }
  }

  dispose(): void {
    this.off();
    this.root.remove();
  }
}
