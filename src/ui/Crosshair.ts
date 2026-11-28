// 動態準星（M1-11；M1-14 組合進 HUD）：依武器類型使用不同樣式（十字／圓／點），大小精確反映實際散布：
//   半徑（px）= tan(散布) / tan(垂直 FOV / 2) × (畫面高度 / 2)
// 散布用 WeaponManager.currentSpread()（下一發會用的散布半角，含開鏡、移動、空中與連射擴散）；霰彈另外加上彈丸圖案的最大半徑。
// 垂直 FOV 是世界相機這一畫面的實際值（含動態 FOV 與開鏡縮放），所以開鏡時準星跟著縮小；狙擊鏡開鏡完成時淡出。
// 以 DOM 繪製（CSS 變數控制半徑，值改變時才寫入），不佔 draw call。
import { SystemOrder, type GameSystem } from '@/core/Game';
import { DEG2RAD, lerp } from '@/core/math';
import type { ConfigSchema } from '@/debug/DebugPanel';
import type { WeaponDef } from '@/weapons/WeaponDef';

export type CrosshairStyle = 'cross' | 'circle' | 'dot';
export const CROSSHAIR_STYLES: readonly CrosshairStyle[] = ['cross', 'circle', 'dot'];

/** 散布半角（度）在畫面上的半徑（px）。 */
export function crosshairRadiusPx(spreadDeg: number, vFovDeg: number, heightPx: number): number {
  const half = Math.tan((vFovDeg * DEG2RAD) / 2);
  if (!(half > 0) || !(heightPx > 0) || !(spreadDeg > 0)) return 0;
  return (Math.tan(Math.min(89, spreadDeg) * DEG2RAD) / half) * (heightPx / 2);
}

/** 相機空間方向（-z 前）在畫面上離中心的距離（px）：彈著點檢查用（與 crosshairRadiusPx 同一個投影）。 */
export function screenRadiusPx(x: number, y: number, z: number, vFovDeg: number, heightPx: number): number {
  const half = Math.tan((vFovDeg * DEG2RAD) / 2);
  if (!(z < 0) || !(half > 0)) return Infinity;
  return (Math.hypot(x, y) / -z / half) * (heightPx / 2);
}

/** 彈丸圖案的最大半徑（度；沒有圖案為 0）。 */
export function patternRadiusDeg(def: Readonly<WeaponDef>): number {
  let r = 0;
  for (const p of def.spread.pelletPattern ?? []) r = Math.max(r, Math.hypot(p[0], p[1]));
  return r;
}

/** 準星要涵蓋的角度（度）：散布 + 彈丸圖案半徑。 */
export function effectiveSpreadDeg(def: Readonly<WeaponDef>, spreadDeg: number): number {
  return Math.max(0, spreadDeg) + patternRadiusDeg(def);
}

export interface CrosshairConfig {
  /** 每種武器原型的樣式；未列出的用 defaultStyle。 */
  styles: Record<string, CrosshairStyle>;
  defaultStyle: CrosshairStyle;
  color: string;
  /** 線粗、線長、點大小（px）。 */
  thickness: number;
  lineLength: number;
  dotSize: number;
  /** 十字的最小間隙（px；散布為 0 時十字仍看得清楚）。 */
  minGap: number;
  /** 不透明度：腰射、開鏡完成時。 */
  opacity: number;
  adsOpacity: number;
  /** 外框陰影（深色描邊，亮背景也看得到）。 */
  outline: boolean;
}

export const CROSSHAIR_CONFIG: CrosshairConfig = {
  styles: { assaultRifle: 'cross', shotgun: 'circle', handCannon: 'cross', railSniper: 'dot', plasmaLauncher: 'circle' },
  defaultStyle: 'cross',
  color: '#e8fbff',
  thickness: 2,
  lineLength: 8,
  dotSize: 3,
  minGap: 3,
  opacity: 0.9,
  adsOpacity: 0.45,
  outline: true,
};

export const CROSSHAIR_PANEL: ConfigSchema<CrosshairConfig> = {
  defaultStyle: { label: '預設樣式', options: { 十字: 'cross', 圓: 'circle', 點: 'dot' } },
  color: { label: '顏色' },
  thickness: { label: '線粗 px', min: 1, max: 6, step: 0.5 },
  lineLength: { label: '線長 px', min: 2, max: 30, step: 0.5 },
  dotSize: { label: '點 px', min: 1, max: 10, step: 0.5 },
  minGap: { label: '最小間隙 px', min: 0, max: 20, step: 0.5 },
  opacity: { label: '不透明度', min: 0, max: 1, step: 0.05 },
  adsOpacity: { label: '開鏡不透明度', min: 0, max: 1, step: 0.05 },
  outline: { label: '深色描邊' },
};

export function crosshairStyleFor(archetype: string | undefined, cfg: Readonly<CrosshairConfig> = CROSSHAIR_CONFIG): CrosshairStyle {
  const s = archetype ? cfg.styles[archetype] : undefined;
  return s && CROSSHAIR_STYLES.includes(s) ? s : cfg.defaultStyle;
}

/** 每畫面的輸入。 */
export interface CrosshairInput {
  visible: boolean;
  style: CrosshairStyle;
  /** 準星要涵蓋的角度（度，effectiveSpreadDeg）。 */
  spreadDeg: number;
  /** 世界相機的垂直 FOV（度，含開鏡縮放）。 */
  vFovDeg: number;
  /** 開鏡進度（曲線後）0..1。 */
  ads: number;
  /** 狙擊鏡遮罩 0..1（1 = 準星完全淡出）。 */
  scope: number;
}

export interface CrosshairOptions {
  container: HTMLElement;
  getInput: () => Readonly<CrosshairInput> | null;
  /** 畫面高度（CSS px）。 */
  getHeight: () => number;
  config?: CrosshairConfig;
}

export class Crosshair implements GameSystem {
  readonly name = 'crosshair';
  readonly order = SystemOrder.ui;
  readonly config: CrosshairConfig;
  readonly root: HTMLDivElement;
  /** 目前的半徑（px）與不透明度（測試、監看）。 */
  radius = 0;
  opacity = 0;
  style: CrosshairStyle = 'cross';
  private readonly options: CrosshairOptions;
  private written = { r: -1, o: -1, style: '', color: '', th: -1, len: -1, dot: -1, gap: -1, outline: true as boolean | null };

  constructor(options: CrosshairOptions) {
    this.options = options;
    this.config = options.config ?? CROSSHAIR_CONFIG;
    const root = document.createElement('div');
    root.className = 'sw-crosshair';
    root.setAttribute('aria-hidden', 'true');
    for (const cls of ['sw-ch-line sw-ch-up', 'sw-ch-line sw-ch-down', 'sw-ch-line sw-ch-left', 'sw-ch-line sw-ch-right', 'sw-ch-ring', 'sw-ch-dot']) {
      const i = document.createElement('i');
      i.className = cls;
      root.appendChild(i);
    }
    options.container.appendChild(root);
    this.root = root;
    this.written.outline = null;
  }

  render(): void {
    const input = this.options.getInput();
    const cfg = this.config;
    let r = 0;
    let o = 0;
    let style = this.style;
    if (input && input.visible) {
      style = input.style;
      r = crosshairRadiusPx(input.spreadDeg, input.vFovDeg, this.options.getHeight());
      o = lerp(cfg.opacity, cfg.adsOpacity, input.ads) * (1 - input.scope);
    }
    this.radius = r;
    this.opacity = o;
    this.style = style;
    const w = this.written;
    const s = this.root.style;
    if (Math.abs(r - w.r) > 0.05) {
      s.setProperty('--sw-ch-r', `${r.toFixed(2)}px`);
      s.setProperty('--sw-ch-gap', `${Math.max(cfg.minGap, r).toFixed(2)}px`);
      w.r = r;
    }
    if (Math.abs(o - w.o) > 0.005) {
      s.opacity = o.toFixed(3);
      w.o = o;
    }
    if (style !== w.style) {
      this.root.dataset.style = style;
      w.style = style;
    }
    if (cfg.color !== w.color || cfg.thickness !== w.th || cfg.lineLength !== w.len || cfg.dotSize !== w.dot || cfg.minGap !== w.gap || cfg.outline !== w.outline) {
      s.setProperty('--sw-ch-color', cfg.color);
      s.setProperty('--sw-ch-th', `${cfg.thickness}px`);
      s.setProperty('--sw-ch-len', `${cfg.lineLength}px`);
      s.setProperty('--sw-ch-dot', `${cfg.dotSize}px`);
      s.setProperty('--sw-ch-gap', `${Math.max(cfg.minGap, r).toFixed(2)}px`);
      this.root.classList.toggle('sw-ch-outline', cfg.outline);
      w.color = cfg.color;
      w.th = cfg.thickness;
      w.len = cfg.lineLength;
      w.dot = cfg.dotSize;
      w.gap = cfg.minGap;
      w.outline = cfg.outline;
    }
  }

  dispose(): void {
    this.root.remove();
  }
}
