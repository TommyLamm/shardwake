// 程序貼圖（M1-09）：金屬面板接縫、格線（保留速度感）、危險條紋、六角網格、發光線條遮罩。
// - 像素由純函式產生（generatePattern，不需要 Canvas／DOM，可無頭測試、結果可重現）。
//   一張貼圖代表 tileMeters（5 m）見方，與 LevelBuilder 的「公尺 / tileMeters」世界 UV 對齊，相鄰面的接縫接得起來。
// - 每個圖樣輸出四層：albedo（灰階或彩色，乘材質底色）、surface（G = 粗糙度倍率、B = 金屬度倍率）、
//   normal（由高度圖以中央差分換算的切線空間法線）、glow（發光遮罩，乘材質的 emissive 顏色與強度）。
// - TextureCache：同一個圖樣規格只生成一次（key = 規格 JSON + 尺寸）；貼圖生成 mipmap、使用最大 anisotropy。
// 文字類貼圖（全息看板）需要字型，改用 Canvas（見 world/HoloBoards.ts）。
import * as THREE from 'three';
import { GREYBOX_CONFIG, makeGridPixels, type GreyboxConfig } from '@/world/Greybox';

export interface TextureConfig {
  /** 貼圖邊長（像素，2 的次方）。 */
  size: number;
  /** 一張貼圖代表幾公尺（必須與 LevelVisuals.uvTileMeters 相同）。 */
  tileMeters: number;
  /** anisotropy 上限（0 = 使用顯示卡最大值）。 */
  maxAnisotropy: number;
}

export const TEXTURE_CONFIG: TextureConfig = {
  size: 512,
  tileMeters: GREYBOX_CONFIG.tileMeters,
  maxAnisotropy: 0,
};

/** 金屬面板：接縫凹槽、倒角高光、角落螺栓、每片亮度變化；可加細格線與發光線。 */
export interface PanelPattern {
  kind: 'panel';
  /** 面板尺寸（m，需能整除 tileMeters）。 */
  panelW: number;
  panelH: number;
  /** 接縫寬（m）。 */
  seamWidth: number;
  /** 細格線間距（m，0 = 無；保留速度感）。 */
  gridMeters: number;
  /** 細格線寬（m）與亮度增量。 */
  gridWidth: number;
  gridLevel: number;
  /** 底色亮度（0–1）與每片面板的亮度變化（±）。 */
  base: number;
  variation: number;
  /** 細雜訊（±）。 */
  noise: number;
  /** 角落螺栓（0 = 無）：與角落距離（m）與半徑（m）。 */
  boltInset: number;
  boltRadius: number;
  /** 發光線：在 tile 邊界（每 tileMeters）畫線，寬度（m，0 = 無）。 */
  glowWidth: number;
  /** 面板接縫也發光的比例（0–1，乘在接縫遮罩上）。 */
  seamGlow: number;
  /** 法線強度。 */
  bump: number;
  /** 粗糙度倍率：面板／接縫。 */
  roughPanel: number;
  roughSeam: number;
  seed: number;
}

/** 六角網格：邊線、偶爾填滿的格子；邊線可發光。 */
export interface HexPattern {
  kind: 'hex';
  /** 每 tile 的六角格欄數（x 方向週期數）；y 方向自動取最接近的整數讓格子近似正六角形。 */
  columns: number;
  /** 邊線寬（以格子半徑 1 為單位，約 0–0.2）。 */
  lineWidth: number;
  base: number;
  lineLevel: number;
  /** 填滿較亮的格子比例。 */
  fillChance: number;
  fillLevel: number;
  noise: number;
  /** 邊線發光強度（0–1）。 */
  lineGlow: number;
  bump: number;
  roughPanel: number;
  roughSeam: number;
  seed: number;
}

/** 45° 危險條紋（彩色）。 */
export interface HazardPattern {
  kind: 'hazard';
  /** 條紋週期（m，tileMeters 需為其整數倍）。 */
  period: number;
  /** 亮色所占比例。 */
  duty: number;
  colorA: number;
  colorB: number;
  /** 磨損雜訊。 */
  wear: number;
  /** 亮色條紋的發光強度（0–1）。 */
  glow: number;
  seed: number;
}

/** 發光線條遮罩：間距 spacing 的格線（albedo 為白、glow 為線）。 */
export interface LinesPattern {
  kind: 'lines';
  spacing: number;
  width: number;
  /** 線外的亮度（0–1）。 */
  base: number;
}

/** M1-04 的灰盒格線（保留給除錯與比較）。 */
export interface GridPattern {
  kind: 'grid';
  config?: Partial<GreyboxConfig>;
}

export type PatternSpec = PanelPattern | HexPattern | HazardPattern | LinesPattern | GridPattern;

export interface PatternPixels {
  size: number;
  /** RGBA，sRGB。 */
  albedo: Uint8Array;
  /** RGBA：R = 1、G = 粗糙度倍率、B = 金屬度倍率（線性）。 */
  surface: Uint8Array;
  /** RGBA：切線空間法線。 */
  normal: Uint8Array;
  /** RGBA：發光遮罩（灰階，sRGB）。 */
  glow: Uint8Array;
  /** glow 是否有任何非零像素。 */
  hasGlow: boolean;
}

// ── 小工具 ─────────────────────────────────────────────

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

function smooth(e0: number, e1: number, x: number): number {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}

/** 整數雜湊 → [0, 1)。 */
export function hash2(x: number, y: number, seed = 0): number {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** 線覆蓋率：距離 d（m）在線寬 w（m）內為 1，邊緣以 1 像素（px m）淡出。 */
function lineMask(d: number, w: number, px: number): number {
  if (w <= 0) return 0;
  return clamp01((w / 2 + px / 2 - d) / Math.max(px, 1e-9));
}

/** 到最近的週期格線的距離（m）。 */
function distToLine(m: number, spacing: number): number {
  const r = m / spacing;
  return Math.abs(r - Math.round(r)) * spacing;
}

function toByte(v: number): number {
  return Math.round(clamp01(v) * 255);
}

/** 由高度圖（可重複貼）以中央差分產生法線貼圖。 */
export function heightToNormal(height: Float32Array, size: number, strength: number, out?: Uint8Array): Uint8Array {
  const data = out ?? new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    const y0 = ((y - 1 + size) % size) * size;
    const y1 = ((y + 1) % size) * size;
    for (let x = 0; x < size; x++) {
      const x0 = (x - 1 + size) % size;
      const x1 = (x + 1) % size;
      const dx = (height[y * size + x1]! - height[y * size + x0]!) * 0.5 * strength;
      const dy = (height[y1 + x]! - height[y0 + x]!) * 0.5 * strength;
      const inv = 1 / Math.hypot(dx, dy, 1);
      const i = (y * size + x) * 4;
      data[i] = toByte((-dx * inv) * 0.5 + 0.5);
      data[i + 1] = toByte((-dy * inv) * 0.5 + 0.5);
      data[i + 2] = toByte(inv * 0.5 + 0.5);
      data[i + 3] = 255;
    }
  }
  return data;
}

interface Layers {
  size: number;
  albedo: Uint8Array;
  surface: Uint8Array;
  glow: Uint8Array;
  height: Float32Array;
  hasGlow: boolean;
}

function allocLayers(size: number): Layers {
  const n = size * size;
  return {
    size,
    albedo: new Uint8Array(n * 4),
    surface: new Uint8Array(n * 4),
    glow: new Uint8Array(n * 4),
    height: new Float32Array(n),
    hasGlow: false,
  };
}

function writePixel(L: Layers, i: number, r: number, g: number, b: number, rough: number, metal: number, glow: number): void {
  const j = i * 4;
  L.albedo[j] = toByte(r);
  L.albedo[j + 1] = toByte(g);
  L.albedo[j + 2] = toByte(b);
  L.albedo[j + 3] = 255;
  L.surface[j] = 255;
  L.surface[j + 1] = toByte(rough);
  L.surface[j + 2] = toByte(metal);
  L.surface[j + 3] = 255;
  const gb = toByte(glow);
  L.glow[j] = gb;
  L.glow[j + 1] = gb;
  L.glow[j + 2] = gb;
  L.glow[j + 3] = 255;
  if (gb > 0) L.hasGlow = true;
}

// ── 圖樣 ───────────────────────────────────────────────

function panelPixels(p: PanelPattern, size: number, tile: number): Layers {
  const L = allocLayers(size);
  const px = tile / size;
  const cols = Math.max(1, Math.round(tile / p.panelW));
  const rows = Math.max(1, Math.round(tile / p.panelH));
  const pw = tile / cols;
  const ph = tile / rows;
  for (let y = 0; y < size; y++) {
    const v = (y + 0.5) * px;
    const j = Math.floor(v / ph);
    const dv = v - j * ph;
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) * px;
      const i = Math.floor(u / pw);
      const du = u - i * pw;
      const edge = Math.min(du, pw - du, dv, ph - dv);
      const seam = lineMask(edge, p.seamWidth, px);
      // 倒角：接縫外側 1.5 倍接縫寬的範圍略亮（上、右側）略暗（下、左側），配合法線看起來有厚度。
      const bevel = 1 - smooth(p.seamWidth * 0.5, p.seamWidth * 2, edge);
      const cell = hash2(((i % cols) + cols) % cols, ((j % rows) + rows) % rows, p.seed);
      let a = p.base + (cell - 0.5) * 2 * p.variation;
      a += (hash2(x, y, p.seed + 7) - 0.5) * 2 * p.noise;
      let h = 1 - seam;
      h -= bevel * 0.15;
      if (p.gridMeters > 0) {
        const g = Math.max(lineMask(distToLine(u, p.gridMeters), p.gridWidth, px), lineMask(distToLine(v, p.gridMeters), p.gridWidth, px));
        a += g * p.gridLevel;
      }
      if (p.boltRadius > 0) {
        const bx = Math.min(Math.abs(du - p.boltInset), Math.abs(pw - p.boltInset - du));
        const by = Math.min(Math.abs(dv - p.boltInset), Math.abs(ph - p.boltInset - dv));
        const bd = Math.hypot(bx, by);
        const bolt = 1 - smooth(p.boltRadius - px, p.boltRadius + px, bd);
        a += bolt * 0.12;
        h += bolt * 0.35;
      }
      a *= 1 - seam * 0.55;
      const tileEdge = Math.min(distToLine(u, tile), distToLine(v, tile));
      const glow = Math.max(lineMask(tileEdge, p.glowWidth, px), seam * p.seamGlow);
      const idx = y * size + x;
      L.height[idx] = h;
      writePixel(L, idx, a, a, a, p.roughPanel + (cell - 0.5) * 0.1 + seam * (p.roughSeam - p.roughPanel), 1, glow);
    }
  }
  return L;
}

/** 六角格：回傳 (到邊線的距離, 格子 id x, 格子 id y)。p 的單位：x 週期 1、y 週期 √3（格子外接圓半徑約 0.577）。 */
export function hexCell(px: number, py: number): { edge: number; cx: number; cy: number } {
  const rx = 1;
  const ry = Math.sqrt(3);
  const ax = (((px % rx) + rx) % rx) - rx / 2;
  const ay = (((py % ry) + ry) % ry) - ry / 2;
  const bx = ((((px - rx / 2) % rx) + rx) % rx) - rx / 2;
  const by = ((((py - ry / 2) % ry) + ry) % ry) - ry / 2;
  const useA = ax * ax + ay * ay < bx * bx + by * by;
  const gx = useA ? ax : bx;
  const gy = useA ? ay : by;
  const cx = px - gx;
  const cy = py - gy;
  // 尖頂六角形：到中心的「六角距離」，邊線在 0.5。
  const qx = Math.abs(gx);
  const qy = Math.abs(gy);
  const d = Math.max(qx * 0.5 + qy * (Math.sqrt(3) / 2), qx);
  return { edge: 0.5 - d, cx, cy };
}

function hexPixels(p: HexPattern, size: number): Layers {
  const L = allocLayers(size);
  const cols = Math.max(1, Math.round(p.columns));
  const rows = Math.max(1, Math.round(cols / Math.sqrt(3)));
  const pxUnits = cols / size; // 一個像素在 p 空間的寬度（x）
  for (let y = 0; y < size; y++) {
    const py = ((y + 0.5) / size) * rows * Math.sqrt(3);
    for (let x = 0; x < size; x++) {
      const pxp = ((x + 0.5) / size) * cols;
      const c = hexCell(pxp, py);
      const line = lineMask(c.edge, p.lineWidth, pxUnits * 1.5);
      const idX = Math.round(c.cx * 2);
      const idY = Math.round((c.cy * 2) / Math.sqrt(3));
      const wrapX = ((idX % (cols * 2)) + cols * 2) % (cols * 2);
      const wrapY = ((idY % (rows * 2)) + rows * 2) % (rows * 2);
      const r = hash2(wrapX, wrapY, p.seed);
      const fill = r < p.fillChance ? 1 : 0;
      let a = p.base + fill * p.fillLevel + (hash2(x, y, p.seed + 3) - 0.5) * 2 * p.noise;
      a += line * (p.lineLevel - a);
      const idx = y * size + x;
      L.height[idx] = 1 - line * 0.8 + fill * 0.1;
      writePixel(L, idx, a, a, a, p.roughPanel + line * (p.roughSeam - p.roughPanel), 1, line * p.lineGlow);
    }
  }
  return L;
}

function rgb(hex: number): [number, number, number] {
  return [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
}

function hazardPixels(p: HazardPattern, size: number, tile: number): Layers {
  const L = allocLayers(size);
  const px = tile / size;
  const period = tile / Math.max(1, Math.round(tile / p.period));
  const a = rgb(p.colorA);
  const b = rgb(p.colorB);
  for (let y = 0; y < size; y++) {
    const v = (y + 0.5) * px;
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) * px;
      const s = (u + v) / period;
      const f = s - Math.floor(s);
      // 條紋邊緣 1 px 淡化。
      const edgePx = px / period;
      const onA = smooth(-edgePx, edgePx, f) * (1 - smooth(p.duty - edgePx, p.duty + edgePx, f));
      const wear = 1 - hash2(x >> 2, y >> 2, p.seed) * p.wear;
      const r = (b[0] + (a[0] - b[0]) * onA) * wear;
      const g = (b[1] + (a[1] - b[1]) * onA) * wear;
      const bb = (b[2] + (a[2] - b[2]) * onA) * wear;
      const idx = y * size + x;
      L.height[idx] = 1;
      writePixel(L, idx, r, g, bb, 0.7 - onA * 0.1, 0.4, onA * p.glow);
    }
  }
  return L;
}

function linesPixels(p: LinesPattern, size: number, tile: number): Layers {
  const L = allocLayers(size);
  const px = tile / size;
  const spacing = tile / Math.max(1, Math.round(tile / p.spacing));
  for (let y = 0; y < size; y++) {
    const v = (y + 0.5) * px;
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) * px;
      const m = Math.max(lineMask(distToLine(u, spacing), p.width, px), lineMask(distToLine(v, spacing), p.width, px));
      const idx = y * size + x;
      L.height[idx] = 1;
      const a = p.base + (1 - p.base) * m;
      writePixel(L, idx, a, a, a, 1, 1, m);
    }
  }
  return L;
}

function gridLayers(p: GridPattern, size: number): Layers {
  const cfg: GreyboxConfig = { ...GREYBOX_CONFIG, ...p.config, textureSize: size };
  const px = makeGridPixels(cfg);
  const L = allocLayers(size);
  L.albedo.set(px);
  for (let i = 0; i < size * size; i++) {
    L.height[i] = 1;
    L.surface[i * 4] = 255;
    L.surface[i * 4 + 1] = 255;
    L.surface[i * 4 + 2] = 255;
    L.surface[i * 4 + 3] = 255;
    L.glow[i * 4 + 3] = 255;
  }
  return L;
}

/** 產生圖樣的像素（純函式；相同規格與尺寸結果相同）。 */
export function generatePattern(spec: PatternSpec, size = TEXTURE_CONFIG.size, tileMeters = TEXTURE_CONFIG.tileMeters): PatternPixels {
  let L: Layers;
  let bump = 0;
  switch (spec.kind) {
    case 'panel':
      L = panelPixels(spec, size, tileMeters);
      bump = spec.bump;
      break;
    case 'hex':
      L = hexPixels(spec, size);
      bump = spec.bump;
      break;
    case 'hazard':
      L = hazardPixels(spec, size, tileMeters);
      break;
    case 'lines':
      L = linesPixels(spec, size, tileMeters);
      break;
    case 'grid':
      L = gridLayers(spec, size);
      break;
  }
  // 高度以「像素」為單位換算斜率：bump 為 1 時，接縫邊緣約 45°。
  const normal = heightToNormal(L.height, size, bump);
  return { size, albedo: L.albedo, surface: L.surface, normal, glow: L.glow, hasGlow: L.hasGlow };
}

/** 圖樣快取的 key（規格欄位排序後的 JSON + 尺寸）。 */
export function patternKey(spec: PatternSpec, size: number): string {
  const keys = Object.keys(spec).sort();
  const parts = keys.map((k) => `${k}=${JSON.stringify((spec as unknown as Record<string, unknown>)[k])}`);
  return `${parts.join(';')}@${size}`;
}

// ── GPU 貼圖 ───────────────────────────────────────────

export interface PatternTextures {
  key: string;
  map: THREE.DataTexture;
  surface: THREE.DataTexture;
  normal: THREE.DataTexture;
  /** 沒有任何發光像素時為 null。 */
  glow: THREE.DataTexture | null;
}

export function makeDataTexture(data: Uint8Array, size: number, colorSpace: THREE.ColorSpace, anisotropy: number): THREE.DataTexture {
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = anisotropy;
  tex.colorSpace = colorSpace;
  tex.needsUpdate = true;
  return tex;
}

export type PatternFactory = (spec: PatternSpec, size: number, anisotropy: number, key: string) => PatternTextures;

export const defaultPatternFactory: PatternFactory = (spec, size, anisotropy, key) => {
  const px = generatePattern(spec, size);
  const map = makeDataTexture(px.albedo, size, THREE.SRGBColorSpace, anisotropy);
  const surface = makeDataTexture(px.surface, size, THREE.NoColorSpace, anisotropy);
  const normal = makeDataTexture(px.normal, size, THREE.NoColorSpace, anisotropy);
  const glow = px.hasGlow ? makeDataTexture(px.glow, size, THREE.SRGBColorSpace, anisotropy) : null;
  map.name = `${spec.kind}:map`;
  surface.name = `${spec.kind}:surface`;
  normal.name = `${spec.kind}:normal`;
  if (glow) glow.name = `${spec.kind}:glow`;
  return { key, map, surface, normal, glow };
};

/** 程序貼圖快取：相同規格只生成一次。 */
export class TextureCache {
  private readonly entries = new Map<string, PatternTextures>();
  /** 實際生成次數（測試、除錯用）。 */
  generated = 0;
  /** 累計生成時間（毫秒）。 */
  generateMs = 0;

  constructor(
    readonly config: TextureConfig = TEXTURE_CONFIG,
    private anisotropy = 1,
    private readonly factory: PatternFactory = defaultPatternFactory,
  ) {}

  /** 顯示卡的最大 anisotropy（之後新生成的貼圖使用，config.maxAnisotropy > 0 時取較小者）。 */
  setMaxAnisotropy(max: number): void {
    this.anisotropy = this.config.maxAnisotropy > 0 ? Math.min(this.config.maxAnisotropy, max) : max;
  }

  get size(): number {
    return this.entries.size;
  }

  get(spec: PatternSpec): PatternTextures {
    const size = this.config.size;
    const key = patternKey(spec, size);
    let e = this.entries.get(key);
    if (!e) {
      const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
      e = this.factory(spec, size, this.anisotropy, key);
      this.generateMs += (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
      this.generated++;
      this.entries.set(key, e);
    }
    return e;
  }

  /** 所有貼圖（預熱時先上傳到 GPU）。 */
  textures(): THREE.Texture[] {
    const out: THREE.Texture[] = [];
    for (const e of this.entries.values()) {
      out.push(e.map, e.surface, e.normal);
      if (e.glow) out.push(e.glow);
    }
    return out;
  }

  /** 丟掉某個規格的快取（調參面板改了圖樣參數後重建）；回傳是否存在。 */
  invalidate(spec: PatternSpec): boolean {
    const key = patternKey(spec, this.config.size);
    const e = this.entries.get(key);
    if (!e) return false;
    disposePattern(e);
    this.entries.delete(key);
    return true;
  }

  dispose(): void {
    for (const e of this.entries.values()) disposePattern(e);
    this.entries.clear();
  }
}

function disposePattern(e: PatternTextures): void {
  e.map.dispose();
  e.surface.dispose();
  e.normal.dispose();
  e.glow?.dispose();
}
