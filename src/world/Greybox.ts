// 灰盒格線與關卡外觀介面（M1-04；M1-09 起正式外觀改由 world/Materials.ts 的 MaterialLibrary 提供）：
// - 程序格線貼圖：每格 tileMeters（5 m）一張，1 m 細線、5 m 粗線。貼圖像素由純函式 makeGridPixels() 產生
//   （DataTexture，不需要 Canvas，可無頭測試）；Textures.ts 的 'grid' 圖樣沿用。
// - LevelVisuals：LevelBuilder 的外觀來源介面；PlainVisuals 為無頭測試用的最簡實作。
// - makeTextTexture：Canvas 文字貼圖（除錯顯示的區域名稱使用）。
// 材質表（表面類型、預設旗標、外觀）在 world/MaterialDefs.ts。
import * as THREE from 'three';
import { LEVEL_MATERIAL_TABLE, type MaterialTable } from '@/world/MaterialDefs';
import type { LevelLabel } from '@/world/LevelData';

export interface GreyboxConfig {
  /** 一張格線貼圖代表幾公尺（粗線間距；也是世界 UV 的尺度）。 */
  tileMeters: number;
  /** 貼圖邊長（像素，2 的次方）。 */
  textureSize: number;
  /** 1 m 細線寬（像素）。 */
  fineLinePx: number;
  /** 5 m 粗線寬（像素）。 */
  boldLinePx: number;
  /** 底色亮度（0–1，乘上材質底色）。 */
  baseLevel: number;
  fineLevel: number;
  boldLevel: number;
}

export const GREYBOX_CONFIG: GreyboxConfig = {
  tileMeters: 5,
  textureSize: 512,
  fineLinePx: 3,
  boldLinePx: 7,
  baseLevel: 0.5,
  fineLevel: 0.72,
  boldLevel: 0.95,
};

// ── 格線貼圖 ───────────────────────────────────────────

function lineCoverage(distPx: number, widthPx: number): number {
  // 線寬內為 1，邊緣 1 px 線性淡出（簡單反鋸齒）。
  return Math.min(1, Math.max(0, widthPx / 2 + 0.5 - distPx));
}

/** 單一軸上某像素中心到細線／粗線的覆蓋率。 */
export function gridCoverageAt(px: number, cfg: GreyboxConfig): { fine: number; bold: number } {
  const size = cfg.textureSize;
  const pxPerMeter = size / cfg.tileMeters;
  const m = ((px + 0.5) / size) * cfg.tileMeters;
  const dFine = Math.abs(m - Math.round(m)) * pxPerMeter;
  const dBold = Math.min(m, cfg.tileMeters - m) * pxPerMeter;
  return { fine: lineCoverage(dFine, cfg.fineLinePx), bold: lineCoverage(dBold, cfg.boldLinePx) };
}

/** 產生格線貼圖的 RGBA 像素（灰階，材質底色相乘）。 */
export function makeGridPixels(cfg: GreyboxConfig = GREYBOX_CONFIG): Uint8Array {
  const size = cfg.textureSize;
  const axis = new Float32Array(size * 2);
  for (let i = 0; i < size; i++) {
    const c = gridCoverageAt(i, cfg);
    axis[i * 2] = c.fine;
    axis[i * 2 + 1] = c.bold;
  }
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const fine = Math.max(axis[x * 2]!, axis[y * 2]!);
      const bold = Math.max(axis[x * 2 + 1]!, axis[y * 2 + 1]!);
      let v = cfg.baseLevel;
      v += (cfg.fineLevel - v) * fine;
      v += (cfg.boldLevel - v) * bold;
      const b = Math.round(Math.min(1, Math.max(0, v)) * 255);
      const i = (y * size + x) * 4;
      data[i] = b;
      data[i + 1] = b;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  }
  return data;
}

export function createGridTexture(cfg: GreyboxConfig = GREYBOX_CONFIG, anisotropy = 1): THREE.DataTexture {
  const tex = new THREE.DataTexture(makeGridPixels(cfg), cfg.textureSize, cfg.textureSize, THREE.RGBAFormat);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = anisotropy;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

// ── 看板文字 ───────────────────────────────────────────

const LABEL_FONT = '"Microsoft JhengHei", "PingFang TC", "Noto Sans TC", sans-serif';

/** 以 Canvas 畫文字貼圖（只在瀏覽器可用；沒有 document 時回傳 null）。 */
export function makeTextTexture(
  text: string,
  options: { sub?: string | undefined; color?: number | undefined; background?: string; border?: string } = {},
): { texture: THREE.CanvasTexture; aspect: number; lines: number } | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const mainPx = 96;
  const subPx = 52;
  const pad = 36;
  const mainFont = `bold ${mainPx}px ${LABEL_FONT}`;
  const subFont = `${subPx}px ${LABEL_FONT}`;
  ctx.font = mainFont;
  let width = ctx.measureText(text).width;
  if (options.sub) {
    ctx.font = subFont;
    width = Math.max(width, ctx.measureText(options.sub).width);
  }
  const w = Math.ceil(width + pad * 2);
  const h = Math.ceil(mainPx * 1.25 + (options.sub ? subPx * 1.3 : 0) + pad * 1.2);
  canvas.width = w;
  canvas.height = h;
  ctx.fillStyle = options.background ?? 'rgba(8, 14, 22, 0.78)';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = options.border ?? 'rgba(57, 230, 255, 0.9)';
  ctx.lineWidth = 6;
  ctx.strokeRect(3, 3, w - 6, h - 6);
  const color = `#${(options.color ?? 0xffffff).toString(16).padStart(6, '0')}`;
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = mainFont;
  const mainY = pad * 0.6 + mainPx * 0.62;
  ctx.fillText(text, w / 2, mainY);
  if (options.sub) {
    ctx.font = subFont;
    ctx.globalAlpha = 0.8;
    ctx.fillText(options.sub, w / 2, mainY + mainPx * 0.62 + subPx * 0.7);
    ctx.globalAlpha = 1;
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return { texture, aspect: w / h, lines: options.sub ? 2 : 1 };
}

// ── 外觀來源 ───────────────────────────────────────────

/** LevelBuilder 的外觀來源介面（正式實作見 world/Materials.ts 的 MaterialLibrary）。 */
export interface LevelVisuals {
  /** 材質 id → 共用材質（同一個 id 永遠回傳同一個物件）。 */
  material(id: string): THREE.Material;
  /**
   * 單一看板（沒有文字繪製能力時回傳 null）。回傳物件的材質與貼圖歸關卡所有（卸載時釋放）；
   * 共用的幾何體要設 userData.sharedGeometry = true。
   */
  label?(label: LevelLabel): THREE.Object3D | null;
  /**
   * 一次建立所有看板（例如合併成一個網格、共用一張文字圖集；優先於 label）。
   * 回傳物件的 userData.labelCount 為看板數；userData.dispose() 存在時卸載改呼叫它。
   */
  labels?(labels: readonly LevelLabel[]): THREE.Object3D | null;
  /** 材質 id 的陰影旗標（省略時不投射、不接收）。 */
  shadowFlags?(id: string): { cast: boolean; receive: boolean };
  /** 格線 UV 的尺度：一張貼圖代表幾公尺。 */
  readonly uvTileMeters: number;
}

/** 無頭測試用：每個材質 id 一個 MeshBasicMaterial，不建立貼圖與看板。 */
export class PlainVisuals implements LevelVisuals {
  readonly uvTileMeters: number;
  private readonly cache = new Map<string, THREE.MeshBasicMaterial>();
  constructor(
    private readonly table: MaterialTable = LEVEL_MATERIAL_TABLE,
    tileMeters = GREYBOX_CONFIG.tileMeters,
  ) {
    this.uvTileMeters = tileMeters;
  }
  material(id: string): THREE.Material {
    let m = this.cache.get(id);
    if (!m) {
      m = new THREE.MeshBasicMaterial({ color: this.table[id]?.color ?? 0xff00ff });
      m.name = id;
      this.cache.set(id, m);
    }
    return m;
  }
  dispose(): void {
    for (const m of this.cache.values()) m.dispose();
    this.cache.clear();
  }
}
