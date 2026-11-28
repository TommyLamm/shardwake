// HUD 的提示類元件（M1-14）：
// - GrappleHintWidget（中央、準星下方）：「可勾取」提示，讀 abilities.grapple.aimAvailable（M1-07 的準星輔助）。
// - TimerWidget（上方）：跑酷計時器，顯示 TimerState（M1-15 的計時賽寫入 hud.timer.state，HUD 只顯示）。
// - MessagesWidget（上方）：提示訊息佇列（hud 訊息 push，自動淡出）。
// - TextWidget：通用的「讀一個字串並顯示」元件（之後的計畫快速加 HUD 資訊用）。
import { t } from '@/i18n';
import type { AbilityState } from '@/player/Abilities';
import { ClassSlot, TextSlot, VisibleSlot, h } from '@/ui/dom';
import type { HudAnchor, HudFrame, HudWidget } from '@/ui/Hud';
import { HUD_CONFIG, type HudConfig } from '@/ui/HudConfig';
import {
  MessageQueue,
  createTimerState,
  formatDelta,
  formatMeters,
  formatTimer,
  type MessageOptions,
  type TimerState,
} from '@/ui/hudMath';

// ── 可勾取 ───────────────────────────────────────────────

export interface GrappleHintOptions {
  getAbilities: () => Readonly<AbilityState> | null;
  getGrappleKey: () => string;
  /** 是否顯示距離（預設讀 HUD_CONFIG.grappleHintDistance）。 */
  config?: Pick<HudConfig, 'grappleHintDistance'>;
}

export class GrappleHintWidget implements HudWidget {
  readonly id = 'grappleHint';
  readonly anchor = 'center' as const;
  readonly root: HTMLElement;
  private readonly visible: VisibleSlot;
  private readonly label: TextSlot;
  private readonly dist: TextSlot;

  constructor(private readonly options: GrappleHintOptions) {
    const labelEl = h('span', { class: 'sw-grapple-hint-label' });
    const distEl = h('span', { class: 'sw-grapple-hint-dist sw-num' });
    this.root = h('div', { class: 'sw-grapple-hint' }, [labelEl, distEl]);
    this.visible = new VisibleSlot(this.root);
    this.label = new TextSlot(labelEl);
    this.dist = new TextSlot(distEl);
    this.root.hidden = true;
  }

  update(frame: Readonly<HudFrame>): void {
    const g = this.options.getAbilities()?.grapple;
    const show = Boolean(g && g.enabled && g.aimAvailable && g.ready && g.phase === 'idle' && frame.mode === 'playing');
    this.visible.set(show);
    if (!show || !g) return;
    this.label.set(t('hud.grappleReady', { key: this.options.getGrappleKey() }));
    const cfg = this.options.config ?? HUD_CONFIG;
    this.dist.set(cfg.grappleHintDistance ? t('hud.grappleDistance', { m: formatMeters(g.aimDistance) }) : '');
  }
}

// ── 計時器 ───────────────────────────────────────────────

export class TimerWidget implements HudWidget {
  readonly id = 'timer';
  readonly anchor = 'top' as const;
  readonly order = 0;
  readonly root: HTMLElement;
  /** 計時賽（M1-15）直接寫入這個物件；HUD 每畫面讀取並只在變化時更新 DOM。 */
  readonly state: TimerState = createTimerState();
  private readonly visible: VisibleSlot;
  private readonly time: TextSlot;
  private readonly best: TextSlot;
  private readonly split: TextSlot;
  private readonly splitTone: ClassSlot;
  private readonly running: ClassSlot;

  constructor() {
    const timeEl = h('div', { class: 'sw-timer-time sw-num' });
    const bestEl = h('div', { class: 'sw-timer-best sw-num' });
    const splitEl = h('div', { class: 'sw-timer-split sw-num' });
    this.root = h('div', { class: 'sw-timer sw-hud-panel' }, [h('div', { class: 'sw-timer-label', text: t('hud.timer') }), timeEl, splitEl, bestEl]);
    this.visible = new VisibleSlot(this.root);
    this.time = new TextSlot(timeEl);
    this.best = new TextSlot(bestEl);
    this.split = new TextSlot(splitEl);
    this.splitTone = new ClassSlot(splitEl, 'is-behind');
    this.running = new ClassSlot(this.root, 'is-running');
    this.root.hidden = true;
  }

  update(): void {
    const s = this.state;
    this.visible.set(s.visible);
    if (!s.visible) return;
    this.time.set(formatTimer(s.time));
    this.running.set(s.running);
    this.best.set(s.best !== null ? t('hud.best', { time: formatTimer(s.best) }) : '');
    const last = s.splits.length > 0 ? s.splits[s.splits.length - 1]! : null;
    this.split.set(last ? `${last.label} ${formatTimer(last.time)}${last.delta !== null ? ` ${formatDelta(last.delta)}` : ''}` : '');
    this.splitTone.set(Boolean(last && last.delta !== null && last.delta > 0));
  }

  reset(): void {
    const s = this.state;
    s.visible = false;
    s.running = false;
    s.time = 0;
    s.splits.length = 0;
  }
}

// ── 提示訊息 ─────────────────────────────────────────────

export class MessagesWidget implements HudWidget {
  readonly id = 'messages';
  readonly anchor = 'top' as const;
  readonly order = 1;
  readonly root: HTMLElement;
  readonly queue: MessageQueue;
  private renderedVersion = -1;
  private readonly els = new Map<number, { el: HTMLElement; opacity: number }>();

  constructor(config: HudConfig = HUD_CONFIG) {
    this.queue = new MessageQueue(config.messages);
    this.root = h('div', { class: 'sw-messages' });
  }

  push(text: string, opts?: MessageOptions): void {
    this.queue.push(text, opts);
  }

  update(frame: Readonly<HudFrame>): void {
    // 用真實時間：暫停中顯示的訊息照常淡出。
    this.queue.update(frame.realDt);
    const q = this.queue;
    if (q.version !== this.renderedVersion) {
      this.renderedVersion = q.version;
      const keep = new Set<number>();
      const children: HTMLElement[] = [];
      for (const m of q.items) {
        keep.add(m.id);
        let entry = this.els.get(m.id);
        if (!entry) {
          entry = { el: h('div', { class: 'sw-message' }), opacity: -1 };
          this.els.set(m.id, entry);
        }
        entry.el.textContent = m.text;
        entry.el.dataset.tone = m.tone;
        children.push(entry.el);
      }
      for (const id of [...this.els.keys()]) if (!keep.has(id)) this.els.delete(id);
      this.root.replaceChildren(...children);
    }
    for (const m of q.items) {
      const entry = this.els.get(m.id);
      if (!entry) continue;
      const o = Math.round(q.opacity(m) * 50) / 50;
      if (o !== entry.opacity) {
        entry.opacity = o;
        entry.el.style.opacity = String(o);
      }
    }
  }

  reset(): void {
    this.queue.clear();
  }
}

// ── 通用文字 ─────────────────────────────────────────────

export interface TextWidgetOptions {
  id: string;
  anchor: HudAnchor;
  order?: number;
  /** 每畫面讀取；回傳 null 時隱藏。 */
  read: () => string | null;
  className?: string;
}

export class TextWidget implements HudWidget {
  readonly id: string;
  readonly anchor: HudAnchor;
  readonly order: number;
  readonly root: HTMLElement;
  private readonly text: TextSlot;
  private readonly visible: VisibleSlot;

  constructor(private readonly options: TextWidgetOptions) {
    this.id = options.id;
    this.anchor = options.anchor;
    this.order = options.order ?? 0;
    this.root = h('div', { class: `sw-hud-text ${options.className ?? ''}`.trim() });
    this.text = new TextSlot(this.root);
    this.visible = new VisibleSlot(this.root);
  }

  update(): void {
    const s = this.options.read();
    this.visible.set(s !== null);
    if (s !== null) this.text.set(s);
  }
}
