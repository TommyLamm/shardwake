// 追蹤遊戲容器（iframe 內的 #app）尺寸，更新 renderer 與相機比例。
// 平台切換顯示模式（一般／沉浸／原生全螢幕）不會重載 iframe，只會改變 iframe 尺寸，
// 所以用 ResizeObserver 追蹤容器，而不是只聽 window resize；另外聽 window resize
// 處理瀏覽器縮放或移到不同螢幕造成的 devicePixelRatio 變化。
// 像素比 = min(devicePixelRatio, maxPixelRatio) × renderScale（renderScale 由畫質設定決定）。
import type { EventBus } from '@/core/EventBus';
import type { GameEvents } from '@/core/events';
import { VIEWPORT_CONFIG, type ViewportConfig } from '@/core/config';

/** renderer 需要的最小介面（WebGLRenderer 符合）。 */
export interface ViewportRenderer {
  setPixelRatio(ratio: number): void;
  setSize(width: number, height: number, updateStyle?: boolean): void;
}

/** 相機需要的最小介面（PerspectiveCamera 符合）。 */
export interface ViewportCamera {
  aspect: number;
  updateProjectionMatrix(): void;
}

export interface ViewportSize {
  width: number;
  height: number;
  pixelRatio: number;
  aspect: number;
}

type ResizeObserverLike = { observe(el: Element): void; disconnect(): void };
type ResizeObserverFactory = (callback: () => void) => ResizeObserverLike;

export interface ViewportOptions {
  container: HTMLElement;
  renderer: ViewportRenderer;
  bus?: EventBus<GameEvents>;
  config?: ViewportConfig;
  renderScale?: number;
  /** 測試用注入；預設使用瀏覽器的 ResizeObserver、window、devicePixelRatio。 */
  createObserver?: ResizeObserverFactory;
  getDevicePixelRatio?: () => number;
  win?: Pick<Window, 'addEventListener' | 'removeEventListener'> | null;
}

export type ViewportListener = (size: Readonly<ViewportSize>) => void;

export class Viewport {
  readonly config: ViewportConfig;
  private readonly container: HTMLElement;
  private readonly renderer: ViewportRenderer;
  private readonly bus: EventBus<GameEvents> | undefined;
  private readonly cameras = new Set<ViewportCamera>();
  private readonly listeners = new Set<ViewportListener>();
  private readonly observer: ResizeObserverLike | null;
  private readonly win: ViewportOptions['win'];
  private readonly getDpr: () => number;
  private _renderScale: number;
  private readonly size: ViewportSize = { width: 0, height: 0, pixelRatio: 0, aspect: 1 };
  /** 尺寸套用次數（除錯、測試用）。 */
  applyCount = 0;

  constructor(options: ViewportOptions) {
    this.container = options.container;
    this.renderer = options.renderer;
    this.bus = options.bus;
    this.config = options.config ?? VIEWPORT_CONFIG;
    this._renderScale = options.renderScale ?? 1;
    this.getDpr =
      options.getDevicePixelRatio ?? (() => (typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1));
    const create: ResizeObserverFactory | null =
      options.createObserver ?? (typeof ResizeObserver !== 'undefined' ? (cb) => new ResizeObserver(cb) : null);
    this.observer = create ? create(this.refresh) : null;
    this.observer?.observe(this.container);
    this.win = options.win !== undefined ? options.win : typeof window !== 'undefined' ? window : null;
    this.win?.addEventListener('resize', this.refresh);
    this.refresh();
  }

  get width(): number {
    return this.size.width;
  }

  get height(): number {
    return this.size.height;
  }

  get aspect(): number {
    return this.size.aspect;
  }

  get pixelRatio(): number {
    return this.size.pixelRatio;
  }

  get current(): Readonly<ViewportSize> {
    return this.size;
  }

  get renderScale(): number {
    return this._renderScale;
  }

  /** 渲染比例（0.25–2）；改變後立即套用。 */
  setRenderScale(scale: number): void {
    const s = Number.isFinite(scale) ? Math.min(Math.max(scale, 0.25), 2) : 1;
    if (s === this._renderScale) return;
    this._renderScale = s;
    this.refresh();
  }

  /** 註冊需要跟著畫面比例更新的相機（立即套用目前比例）。 */
  addCamera(camera: ViewportCamera): void {
    this.cameras.add(camera);
    camera.aspect = this.size.aspect;
    camera.updateProjectionMatrix();
  }

  removeCamera(camera: ViewportCamera): void {
    this.cameras.delete(camera);
  }

  /** 尺寸改變時呼叫（不會立即呼叫一次）。 */
  onResize(listener: ViewportListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** 讀取容器尺寸並在有變化時套用。ResizeObserver、window resize 與設定變更都會呼叫。 */
  readonly refresh = (): void => {
    const width = Math.max(1, Math.floor(this.container.clientWidth));
    const height = Math.max(1, Math.floor(this.container.clientHeight));
    const dpr = this.getDpr();
    const base = Math.min(Number.isFinite(dpr) && dpr > 0 ? dpr : 1, Math.max(this.config.maxPixelRatio, 0.25));
    const pixelRatio = base * this._renderScale;
    const s = this.size;
    if (s.width === width && s.height === height && s.pixelRatio === pixelRatio) return;
    s.width = width;
    s.height = height;
    s.pixelRatio = pixelRatio;
    s.aspect = width / height;
    // canvas 的 CSS 尺寸由樣式表固定為 100%，只更新繪圖緩衝區（updateStyle = false）。
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(width, height, false);
    for (const cam of this.cameras) {
      cam.aspect = s.aspect;
      cam.updateProjectionMatrix();
    }
    this.applyCount++;
    for (const l of this.listeners) l(s);
    this.bus?.emit('viewport:resize', { width, height, pixelRatio, aspect: s.aspect });
  };

  dispose(): void {
    this.observer?.disconnect();
    this.win?.removeEventListener('resize', this.refresh);
    this.cameras.clear();
    this.listeners.clear();
  }
}
