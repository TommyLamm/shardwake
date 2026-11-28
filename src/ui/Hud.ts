// HUD 框架（M1-14；Game 系統 name 'hud'、order ui）：DOM + CSS。
//
// - 版面：root 蓋住整個遊戲容器（pointer-events: none）；安全區（.sw-hud-safe）寬度 ≤ 高度 × safeMaxAspect 並置中，
//   內有 7 個錨點區域（top、topRight、topLeft、bottomLeft、bottomCenter、bottomRight、center）。依 iframe 短邊縮放：
//   CSS 變數 --sw-hud-scale（元件尺寸都乘這個值）、--sw-hud-margin、--sw-hud-safe-w。尺寸改變時由 Viewport 呼叫 layout()。
// - 元件（HudWidget）：只讀取狀態（建構時傳入 getter）與事件，不持有遊戲邏輯；每畫面 update() 時自行比對，
//   只在值改變時寫入 DOM（ui/dom.ts 的 TextSlot／StyleSlot 等）。新增元件：hud.add(widget)，指定錨點即可。
// - 顯示：setHidden(reason, hidden) 以原因組合（標題畫面、#cover 封面、過場…），任一原因隱藏就隱藏；
//   隱藏時不呼叫元件的 update（不寫 DOM）。
// - 準星、命中標記等既有元件掛在 hud.root（全畫面層）上，跟著 HUD 一起顯示與隱藏。
import { SystemOrder, type FrameInfo, type GameSystem } from '@/core/Game';
import { h } from '@/ui/dom';
import { HUD_CONFIG, type HudConfig } from '@/ui/HudConfig';
import { hudLayout, UpdateThrottle, type HudLayout } from '@/ui/hudMath';

export type HudAnchor = 'top' | 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomCenter' | 'bottomRight' | 'center';
export const HUD_ANCHORS: readonly HudAnchor[] = ['top', 'topLeft', 'topRight', 'bottomLeft', 'bottomCenter', 'bottomRight', 'center'];

/** 每畫面傳給元件的資訊（同一物件重複使用）。 */
export interface HudFrame {
  /** 真實時間 dt（s；暫停時仍前進，UI 動畫用）。 */
  realDt: number;
  /** 模擬 dt（s；暫停時為 0）。 */
  dt: number;
  mode: FrameInfo['mode'];
  /** 目前的 HUD 縮放。 */
  scale: number;
}

export interface HudWidget {
  /** 唯一 id（hud.get(id)）。 */
  readonly id: string;
  readonly anchor: HudAnchor;
  readonly root: HTMLElement;
  /** 同一錨點內的排序（小的在前；預設 0）。 */
  readonly order?: number;
  update(frame: Readonly<HudFrame>): void;
  /** 重新開始、換關卡時清掉暫存狀態（例如延遲條、訊息）。 */
  reset?(): void;
  /** 版面縮放改變（需要用 px 計算尺寸的元件使用）。 */
  layout?(layout: Readonly<HudLayout>): void;
  dispose?(): void;
}

export interface HudOptions {
  container: HTMLElement;
  config?: HudConfig;
}

export class Hud implements GameSystem {
  readonly name = 'hud';
  readonly order = SystemOrder.ui;
  readonly config: HudConfig;
  /** 全畫面層（準星、命中標記等直接掛在這裡）。 */
  readonly root: HTMLDivElement;
  readonly safe: HTMLDivElement;
  readonly regions: Readonly<Record<HudAnchor, HTMLDivElement>>;
  readonly layoutState: HudLayout = { scale: 1, safeWidth: 0, margin: 0 };
  private readonly widgets: HudWidget[] = [];
  private readonly hiddenBy = new Set<string>();
  private readonly frameInfo: HudFrame = { realDt: 0, dt: 0, mode: 'boot', scale: 1 };
  private lastSize = { width: 0, height: 0 };
  private readonly throttle = new UpdateThrottle();

  constructor(options: HudOptions) {
    this.config = options.config ?? HUD_CONFIG;
    const regions = {} as Record<HudAnchor, HTMLDivElement>;
    for (const a of HUD_ANCHORS) regions[a] = h('div', { class: `sw-hud-region sw-hud-${a}` });
    this.regions = regions;
    this.safe = h('div', { class: 'sw-hud-safe' }, HUD_ANCHORS.filter((a) => a !== 'center').map((a) => regions[a]));
    this.root = h('div', { class: 'sw-hud', attrs: { 'aria-hidden': 'true' } }, [this.safe, regions.center]);
    options.container.appendChild(this.root);
  }

  get visible(): boolean {
    return this.hiddenBy.size === 0;
  }

  /** 以原因組合的隱藏（例如 setHidden('mode', true)、setHidden('cover', true)）。 */
  setHidden(reason: string, hidden: boolean): void {
    const before = this.visible;
    if (hidden) this.hiddenBy.add(reason);
    else this.hiddenBy.delete(reason);
    if (before !== this.visible) {
      this.root.hidden = !this.visible;
      // 重新顯示時立即更新（不等下一個節流間隔），隱藏期間的時間不累計。
      this.throttle.reset();
      this.throttle.flush();
    }
  }

  /** 加入元件（同 id 會丟例外）。 */
  add<T extends HudWidget>(widget: T): T {
    if (this.widgets.some((w) => w.id === widget.id)) throw new Error(`HUD 元件 id 重複：${widget.id}`);
    this.widgets.push(widget);
    const region = this.regions[widget.anchor];
    const siblings = this.widgets.filter((w) => w.anchor === widget.anchor).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    const idx = siblings.indexOf(widget);
    const next = siblings[idx + 1];
    if (next && next.root.parentElement === region) region.insertBefore(widget.root, next.root);
    else region.appendChild(widget.root);
    widget.root.dataset.hudWidget = widget.id;
    widget.layout?.(this.layoutState);
    return widget;
  }

  remove(id: string): boolean {
    const i = this.widgets.findIndex((w) => w.id === id);
    if (i < 0) return false;
    const [w] = this.widgets.splice(i, 1);
    w!.root.remove();
    w!.dispose?.();
    return true;
  }

  get<T extends HudWidget = HudWidget>(id: string): T | undefined {
    return this.widgets.find((w) => w.id === id) as T | undefined;
  }

  get widgetIds(): string[] {
    return this.widgets.map((w) => w.id);
  }

  /** 依容器尺寸（CSS px）重新計算縮放與安全區（Viewport.onResize 呼叫；調參面板改版面數值後也呼叫）。 */
  layout(width = this.lastSize.width, height = this.lastSize.height): void {
    this.lastSize.width = width;
    this.lastSize.height = height;
    const l = hudLayout(width, height, this.config.layout, this.layoutState);
    const s = this.root.style;
    s.setProperty('--sw-hud-scale', l.scale.toFixed(4));
    s.setProperty('--sw-hud-margin', `${l.margin.toFixed(1)}px`);
    s.setProperty('--sw-hud-safe-w', `${l.safeWidth.toFixed(1)}px`);
    this.frameInfo.scale = l.scale;
    for (const w of this.widgets) w.layout?.(l);
  }

  /** 重新開始訓練、換關卡：清掉元件的暫存狀態。 */
  reset(): void {
    for (const w of this.widgets) w.reset?.();
    this.throttle.flush();
  }

  update(dt: number, frame: Readonly<FrameInfo>): void {
    if (!this.visible) return;
    // 節流：以 config.updateHz 更新 DOM，元件收到累計的 dt（M1-16）。
    const th = this.throttle;
    if (!th.tick(frame.realDt, dt, this.config.updateHz)) return;
    const f = this.frameInfo;
    f.realDt = th.out.realDt;
    f.dt = th.out.dt;
    f.mode = frame.mode;
    for (let i = 0; i < this.widgets.length; i++) this.widgets[i]!.update(f);
  }

  dispose(): void {
    for (const w of this.widgets) w.dispose?.();
    this.widgets.length = 0;
    this.root.remove();
  }
}
