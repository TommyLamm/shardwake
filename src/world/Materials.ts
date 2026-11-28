// 材質庫（M1-09）：LevelBuilder 的正式外觀來源（取代 M1-04 的 GreyboxVisuals）。
// - material(id)：依 LEVEL_MATERIALS 建立並快取材質（同一個 id 永遠是同一個物件）。
//   standard = MeshStandardMaterial（程序貼圖：albedo、粗糙度／金屬度、法線、發光遮罩 × 發光色 × 強度）；
//   glow = MeshBasicMaterial，顏色 × 強度 > 1（Bloom 只抓這些與發光線）；glass = 半透明、強環境反射。
// - 環境反射：RoomEnvironment 經 PMREM 產生 scene.environment（setupEnvironment）。
// - labels()：全息看板（HoloBoards）；共用 uniform 在 update() 更新（時間、閃爍、掃描線）。
// - shadowFlags()：standard 投射與接收陰影，glow 都不，glass 只接收。
// - 給 M1-11：武器與特效可用 library.glowMaterial(color, intensity) 取得共用的發光材質，
//   貼圖用 library.textures.get(PATTERNS.xxx 或自訂 PatternSpec)；新材質記得 registerWarmup()。
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import type { LevelVisuals } from '@/world/Greybox';
import {
  applyHoloUniforms,
  buildHoloBoards,
  createHoloUniforms,
  HOLO_CONFIG,
  type HoloConfig,
  type HoloUniforms,
} from '@/world/HoloBoards';
import type { LevelLabel } from '@/world/LevelData';
import {
  LEVEL_MATERIALS,
  MATERIAL_DEFAULTS,
  PATTERNS,
  materialShadowFlags,
  type LevelMaterialDef,
  type PatternId,
} from '@/world/MaterialDefs';
import { TEXTURE_CONFIG, TextureCache, type TextureConfig } from '@/world/Textures';

export interface EnvironmentConfig {
  /** scene.environmentIntensity（環境反射整體強度）。 */
  intensity: number;
  /** RoomEnvironment 的 PMREM sigma。 */
  blur: number;
}

export const ENVIRONMENT_CONFIG: EnvironmentConfig = {
  intensity: 0.35,
  blur: 0.04,
};

/** 以 RoomEnvironment + PMREM 產生環境貼圖並設為 scene.environment；回傳貼圖（卸載時 dispose）。 */
export function setupEnvironment(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  cfg: EnvironmentConfig = ENVIRONMENT_CONFIG,
): THREE.Texture {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const rt = pmrem.fromScene(room, cfg.blur);
  room.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      m.geometry.dispose();
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const mat of mats) mat.dispose();
    }
  });
  pmrem.dispose();
  scene.environment = rt.texture;
  scene.environmentIntensity = cfg.intensity;
  return rt.texture;
}

export interface MaterialLibraryOptions {
  table?: Record<string, LevelMaterialDef>;
  textures?: TextureCache;
  textureConfig?: TextureConfig;
  holo?: HoloConfig;
  /** 顯示卡最大 anisotropy。 */
  maxAnisotropy?: number;
}

export class MaterialLibrary implements LevelVisuals {
  readonly uvTileMeters: number;
  readonly table: Record<string, LevelMaterialDef>;
  readonly textures: TextureCache;
  readonly holo: HoloConfig;
  readonly holoUniforms: HoloUniforms = createHoloUniforms();
  private readonly materials = new Map<string, THREE.Material>();
  private readonly glowMaterials = new Map<string, THREE.MeshBasicMaterial>();
  private readonly anisotropy: number;
  private time = 0;

  constructor(options: MaterialLibraryOptions = {}) {
    this.table = options.table ?? LEVEL_MATERIALS;
    const texCfg = options.textureConfig ?? TEXTURE_CONFIG;
    this.textures = options.textures ?? new TextureCache(texCfg);
    this.anisotropy = Math.max(1, options.maxAnisotropy ?? 1);
    this.textures.setMaxAnisotropy(this.anisotropy);
    this.uvTileMeters = texCfg.tileMeters;
    this.holo = options.holo ?? HOLO_CONFIG;
    applyHoloUniforms(this.holoUniforms, this.holo, 0);
  }

  /** 已建立的材質（預熱、除錯用）。 */
  all(): THREE.Material[] {
    return [...this.materials.values(), ...this.glowMaterials.values()];
  }

  material(id: string): THREE.Material {
    let m = this.materials.get(id);
    if (!m) {
      const def = this.table[id];
      m = this.create(id, def);
      this.materials.set(id, m);
    }
    return m;
  }

  shadowFlags(id: string): { cast: boolean; receive: boolean } {
    return materialShadowFlags(this.table[id]);
  }

  /** 共用的不受光發光材質（M1-11 的特效、viewmodel 細節可用）；顏色 × 強度。 */
  glowMaterial(color: number, intensity: number): THREE.MeshBasicMaterial {
    const key = `${color.toString(16)}:${intensity}`;
    let m = this.glowMaterials.get(key);
    if (!m) {
      m = new THREE.MeshBasicMaterial({ name: `glow:${key}` });
      m.color.setHex(color).multiplyScalar(intensity);
      this.glowMaterials.set(key, m);
    }
    return m;
  }

  private create(id: string, def: LevelMaterialDef | undefined): THREE.Material {
    const kind = def?.kind ?? 'standard';
    let m: THREE.Material;
    if (kind === 'glow') m = new THREE.MeshBasicMaterial({ name: id });
    else m = new THREE.MeshStandardMaterial({ name: id });
    this.applyDef(m, def);
    return m;
  }

  private applyDef(m: THREE.Material, def: LevelMaterialDef | undefined): void {
    const kind = def?.kind ?? 'standard';
    if (kind === 'glow') {
      const b = m as THREE.MeshBasicMaterial;
      b.color.setHex(def?.color ?? 0xff00ff).multiplyScalar(def?.emissiveIntensity ?? 1);
      b.needsUpdate = true;
      return;
    }
    const s = m as THREE.MeshStandardMaterial;
    s.color.setHex(def?.color ?? 0xff00ff);
    s.roughness = def?.roughness ?? MATERIAL_DEFAULTS.roughness;
    s.metalness = def?.metalness ?? MATERIAL_DEFAULTS.metalness;
    s.envMapIntensity = def?.envIntensity ?? MATERIAL_DEFAULTS.envIntensity;
    const pattern = def?.pattern ? this.textures.get(PATTERNS[def.pattern as PatternId]) : null;
    s.map = pattern?.map ?? null;
    s.roughnessMap = pattern?.surface ?? null;
    s.metalnessMap = pattern?.surface ?? null;
    s.normalMap = pattern?.normal ?? null;
    const ns = def?.normalScale ?? MATERIAL_DEFAULTS.normalScale;
    s.normalScale.set(ns, ns);
    const emissive = def?.emissive;
    if (emissive !== undefined && (def?.emissiveIntensity ?? 1) > 0) {
      s.emissive.setHex(emissive);
      s.emissiveIntensity = def?.emissiveIntensity ?? 1;
      s.emissiveMap = pattern ? pattern.glow : null;
      // 有圖樣但沒有發光像素：不發光（避免整面發光）。
      if (pattern && !pattern.glow) s.emissiveIntensity = 0;
    } else {
      s.emissive.setHex(0x000000);
      s.emissiveIntensity = 0;
      s.emissiveMap = null;
    }
    const opacity = def?.opacity ?? 1;
    s.transparent = kind === 'glass' || opacity < 1;
    s.opacity = opacity;
    s.depthWrite = !s.transparent;
    s.needsUpdate = true;
  }

  /**
   * 調參面板改了材質表後套用。rebuildPatterns 為 true 時丟掉圖樣快取重新生成（圖樣參數改變時）。
   * 注意：貼圖有無（例如 emissiveMap 由有變無）會改變著色器，第一次套用時會重新編譯。
   */
  refresh(rebuildPatterns = false): void {
    if (rebuildPatterns) for (const spec of Object.values(PATTERNS)) this.textures.invalidate(spec);
    for (const [id, m] of this.materials) this.applyDef(m, this.table[id]);
  }

  labels(labels: readonly LevelLabel[]): THREE.Object3D | null {
    const built = buildHoloBoards(labels, this.holoUniforms, this.holo, this.anisotropy);
    return built?.mesh ?? null;
  }

  /** 每畫面更新全息看板的共用 uniform（dt 為秒）。 */
  update(dt: number): void {
    this.time += Math.max(0, dt);
    applyHoloUniforms(this.holoUniforms, this.holo, this.time);
  }

  dispose(): void {
    for (const m of this.materials.values()) m.dispose();
    for (const m of this.glowMaterials.values()) m.dispose();
    this.materials.clear();
    this.glowMaterials.clear();
    this.textures.dispose();
  }
}
