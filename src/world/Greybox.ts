// 灰盒外觀（M1-09 換成正式材質庫）：
// - 程序格線貼圖：每格 tileMeters（5 m）一張，1 m 細線、5 m 粗線；mipmap + 最大 anisotropy，高速移動時看得出速度。
//   貼圖像素由純函式 makeGridPixels() 產生（DataTexture，不需要 Canvas，可無頭測試）。
// - 材質表 GREYBOX_MATERIALS：每個材質 id 的底色、表面類型與預設旗標（各區用不同底色）。
// - GreyboxVisuals：LevelBuilder 的外觀來源（材質快取、看板文字）。
// - 灰盒燈光與霧：半球光 + 1 盞方向光（無陰影；M1-09 加陰影、天空與後處理）。
import * as THREE from 'three';
import type { SurfaceType } from '@/physics/SurfaceRegistry';
import type { LevelLabel } from '@/world/LevelData';

export interface GreyboxConfig {
  /** 一張格線貼圖代表幾公尺（粗線間距）。 */
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
  /** anisotropy 上限（0 = 使用顯示卡最大值）。 */
  maxAnisotropy: number;
  roughness: number;
  metalness: number;
  /** 灰盒燈光。 */
  hemiIntensity: number;
  sunIntensity: number;
  /** 霧（線性）。 */
  fogNear: number;
  fogFar: number;
  clearColor: number;
}

export const GREYBOX_CONFIG: GreyboxConfig = {
  tileMeters: 5,
  textureSize: 512,
  fineLinePx: 3,
  boldLinePx: 7,
  baseLevel: 0.5,
  fineLevel: 0.72,
  boldLevel: 0.95,
  maxAnisotropy: 0,
  roughness: 0.85,
  metalness: 0.05,
  hemiIntensity: 1.6,
  sunIntensity: 1.8,
  fogNear: 90,
  fogFar: 320,
  clearColor: 0x0a0f18,
};

export interface GreyboxMaterialDef {
  label: string;
  color: number;
  surface: SurfaceType;
  wallRunnable?: boolean;
  grappleable?: boolean;
  /** 自發光顏色（標線、抓鉤點）。 */
  emissive?: number;
  /** 不貼格線（玻璃、標線）。 */
  noGrid?: boolean;
  /** 半透明（玻璃）。 */
  opacity?: number;
}

/** 灰盒材質表（可在調參面板改底色）。 */
export const GREYBOX_MATERIALS = {
  floor: { label: '一般地板', color: 0x56606c, surface: 'concrete' },
  wall: { label: '外牆', color: 0x4a5566, surface: 'metal', wallRunnable: true, grappleable: true },
  spawn: { label: '出生區', color: 0x3f8a92, surface: 'metal' },
  range: { label: '靶場', color: 0x8a6a48, surface: 'concrete' },
  marker: { label: '標線', color: 0xffa040, surface: 'metal', emissive: 0xff8a20, noGrid: true },
  wallrun: { label: '跑牆區', color: 0x5a62b8, surface: 'metal', wallRunnable: true },
  pit: { label: '深坑', color: 0x2a2f3a, surface: 'metal' },
  slide: { label: '滑鏟區', color: 0x4a8a5c, surface: 'metal' },
  climb: { label: '攀爬區', color: 0x9a8a46, surface: 'concrete' },
  platform: { label: '浮台區', color: 0x8a4a92, surface: 'grate' },
  tower: { label: '高塔', color: 0x4a74a8, surface: 'metal', wallRunnable: true, grappleable: true },
  grapple: { label: '抓鉤點', color: 0x46d8ea, surface: 'metal', grappleable: true, emissive: 0x1a8a9a },
  arena: { label: '戰區', color: 0x9a4a4a, surface: 'concrete' },
  cover: { label: '掩體', color: 0x6a6068, surface: 'metal' },
  grate: { label: '格柵', color: 0x5c6670, surface: 'grate' },
  glass: { label: '玻璃', color: 0x9ad8ff, surface: 'glass', noGrid: true, opacity: 0.35 },
  hazard: { label: '警示', color: 0xff7a1a, surface: 'hazard', emissive: 0x6a2a00 },
} satisfies Record<string, GreyboxMaterialDef>;

export type GreyboxMaterialId = keyof typeof GREYBOX_MATERIALS;

/** 材質表查詢（LevelBuilder 用來決定表面類型與預設旗標）。 */
export type MaterialTable = Readonly<Record<string, GreyboxMaterialDef>>;

export const GREYBOX_MATERIAL_TABLE: MaterialTable = GREYBOX_MATERIALS;

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

/** LevelBuilder 的外觀來源介面（灰盒實作見 GreyboxVisuals；M1-09 換成正式材質庫）。 */
export interface LevelVisuals {
  /** 材質 id → 共用材質（同一個 id 永遠回傳同一個物件）。 */
  material(id: string): THREE.Material;
  /**
   * 看板（沒有文字繪製能力時回傳 null）。回傳物件的材質與貼圖歸關卡所有（卸載時釋放）；
   * 共用的幾何體要設 userData.sharedGeometry = true。
   */
  label?(label: LevelLabel): THREE.Object3D | null;
  /** 格線 UV 的尺度：一張貼圖代表幾公尺。 */
  readonly uvTileMeters: number;
}

/** 無頭測試用：每個材質 id 一個 MeshBasicMaterial，不建立貼圖與看板。 */
export class PlainVisuals implements LevelVisuals {
  readonly uvTileMeters: number;
  private readonly cache = new Map<string, THREE.MeshBasicMaterial>();
  constructor(
    private readonly table: MaterialTable = GREYBOX_MATERIAL_TABLE,
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

export class GreyboxVisuals implements LevelVisuals {
  readonly uvTileMeters: number;
  private gridTexture: THREE.DataTexture;
  private readonly materials = new Map<string, THREE.MeshStandardMaterial>();
  /** 所有看板共用的平面（不要個別釋放；userData.sharedGeometry = true）。 */
  private readonly labelGeometry = new THREE.PlaneGeometry(1, 1);
  private anisotropy: number;

  constructor(
    readonly table: Record<string, GreyboxMaterialDef> = GREYBOX_MATERIALS,
    readonly cfg: GreyboxConfig = GREYBOX_CONFIG,
    maxAnisotropy = 1,
  ) {
    this.uvTileMeters = cfg.tileMeters;
    this.anisotropy = cfg.maxAnisotropy > 0 ? Math.min(cfg.maxAnisotropy, maxAnisotropy) : maxAnisotropy;
    this.gridTexture = createGridTexture(cfg, this.anisotropy);
  }

  material(id: string): THREE.Material {
    let m = this.materials.get(id);
    if (!m) {
      const def = this.table[id];
      m = new THREE.MeshStandardMaterial({ name: id });
      this.materials.set(id, m);
      this.applyDef(m, def);
    }
    return m;
  }

  private applyDef(m: THREE.MeshStandardMaterial, def: GreyboxMaterialDef | undefined): void {
    m.color.setHex(def?.color ?? 0xff00ff);
    m.map = def?.noGrid ? null : this.gridTexture;
    m.emissive.setHex(def?.emissive ?? 0x000000);
    m.emissiveIntensity = def?.emissive ? 1 : 0;
    m.roughness = this.cfg.roughness;
    m.metalness = this.cfg.metalness;
    const opacity = def?.opacity ?? 1;
    m.transparent = opacity < 1;
    m.opacity = opacity;
    m.depthWrite = opacity >= 1;
    m.needsUpdate = true;
  }

  /** 調參面板改了材質表或格線設定後套用（格線像素變更時重建貼圖）。 */
  refresh(rebuildTexture = false): void {
    if (rebuildTexture) {
      const old = this.gridTexture;
      this.gridTexture = createGridTexture(this.cfg, this.anisotropy);
      old.dispose();
    }
    for (const [id, m] of this.materials) this.applyDef(m, this.table[id]);
  }

  label(label: LevelLabel): THREE.Object3D | null {
    const made = makeTextTexture(label.text, { sub: label.sub, color: label.color });
    if (!made) return null;
    const mat = new THREE.MeshBasicMaterial({ map: made.texture, transparent: true, alphaTest: 0.05, fog: true });
    const mesh = new THREE.Mesh(this.labelGeometry, mat);
    const textHeight = label.height ?? 1;
    const h = textHeight * (made.lines === 2 ? 1.9 : 1.45);
    mesh.scale.set(h * made.aspect, h, 1);
    mesh.position.set(label.pos[0], label.pos[1], label.pos[2]);
    mesh.rotation.y = (label.yaw * Math.PI) / 180;
    mesh.name = `label:${label.text}`;
    mesh.userData.sharedGeometry = true;
    return mesh;
  }

  dispose(): void {
    for (const m of this.materials.values()) m.dispose();
    this.materials.clear();
    this.gridTexture.dispose();
    this.labelGeometry.dispose();
  }
}

/** 灰盒燈光、霧與背景（固定燈光數量）。回傳的物件已加入 scene。 */
export function createGreyboxEnvironment(
  scene: THREE.Scene,
  cfg: GreyboxConfig = GREYBOX_CONFIG,
): { hemi: THREE.HemisphereLight; sun: THREE.DirectionalLight; apply(): void } {
  const hemi = new THREE.HemisphereLight(0xb8c8e0, 0x1a2230, cfg.hemiIntensity);
  const sun = new THREE.DirectionalLight(0xfff4e6, cfg.sunIntensity);
  sun.position.set(40, 100, 25);
  scene.add(hemi, sun, sun.target);
  const apply = (): void => {
    hemi.intensity = cfg.hemiIntensity;
    sun.intensity = cfg.sunIntensity;
    scene.background = new THREE.Color(cfg.clearColor);
    scene.fog = new THREE.Fog(cfg.clearColor, cfg.fogNear, cfg.fogFar);
  };
  apply();
  return { hemi, sun, apply };
}
