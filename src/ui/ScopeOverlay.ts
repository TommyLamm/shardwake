// 狙擊鏡遮罩（M1-11）：瞄具為 scope 的武器開鏡完成時，顯示圓形視野外的黑色遮罩與十字分劃（DOM + CSS 漸層，不佔 draw call）。
// 世界的 FOV 縮放由 CameraRig.fovZoom（M1-10）處理，viewmodel 在同時隱藏（Viewmodel.state.scope）。
import { SystemOrder, type GameSystem } from '@/core/Game';

export interface ScopeOverlayOptions {
  container: HTMLElement;
  /** 遮罩程度 0..1（Viewmodel.state.scope）。 */
  getAmount: () => number;
}

export class ScopeOverlay implements GameSystem {
  readonly name = 'scopeOverlay';
  readonly order = SystemOrder.ui;
  readonly root: HTMLDivElement;
  amount = 0;
  private written = -1;

  constructor(private readonly options: ScopeOverlayOptions) {
    const root = document.createElement('div');
    root.className = 'sw-scope';
    root.setAttribute('aria-hidden', 'true');
    root.innerHTML =
      '<div class="sw-scope-lens"><i class="sw-scope-h"></i><i class="sw-scope-v"></i>' +
      '<i class="sw-scope-ring"></i><i class="sw-scope-dot"></i></div>';
    root.hidden = true;
    options.container.appendChild(root);
    this.root = root;
  }

  render(): void {
    const a = Math.min(1, Math.max(0, this.options.getAmount()));
    this.amount = a;
    if (Math.abs(a - this.written) < 0.005) return;
    this.written = a;
    this.root.hidden = a <= 0;
    this.root.style.opacity = a.toFixed(3);
  }

  dispose(): void {
    this.root.remove();
  }
}
