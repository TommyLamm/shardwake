// 著色器預熱（M1-09）：載入完成時先編譯所有著色器、上傳貼圖，避免第一次進場或第一次看到某個材質時卡頓。
// - 場景內的物件（含隱藏的速度線、抓鉤繩索等）由 renderer.compileAsync(scene, camera) 編譯（three r187 的 compile 走訪全部物件）。
// - 不在場景內的材質與物件（M1-11 的 viewmodel、特效池、之後的敵人）用 registerWarmup(material | object) 加入預熱清單；
//   預熱時為它們建立暫時的代理物件（共用原本的幾何與材質），以主場景的燈光、霧、環境貼圖編譯，結果與實際使用相同。
// - 重要：著色器的編譯參數包含輸出色彩空間與色調映射，它們由「目前的 render target」決定。
//   場景經後處理畫進 HalfFloat buffer（線性、無色調映射），所以預熱時要先 setRenderTarget(後處理的輸入 buffer)，
//   否則編出來的是直接畫到畫面的版本，實際渲染時仍會重新編譯。runWarmup() 的 renderTarget 參數處理這件事。
// - 陰影深度材質與後處理的全螢幕材質在第一次 render 時才編譯；runWarmup() 之後再畫一個畫面（呼叫端負責）。
// - 另一個場景（M1-11 的 viewmodel 場景有自己的燈光）也可以 registerWarmup(scene)：以那個場景自己的燈光與環境編譯，
//   不套用主場景的燈光（否則編出來的燈光數量不同，實際渲染時仍會重新編譯）。
import * as THREE from 'three';

export type WarmupTarget = THREE.Material | THREE.Object3D;

/** 預熱清單（純資料結構，可測試）。 */
export class WarmupRegistry {
  private readonly items = new Set<WarmupTarget>();

  /** 加入預熱清單；回傳取消函式。同一個目標重複加入只算一次。 */
  register(target: WarmupTarget): () => void {
    this.items.add(target);
    return () => {
      this.items.delete(target);
    };
  }

  unregister(target: WarmupTarget): boolean {
    return this.items.delete(target);
  }

  get size(): number {
    return this.items.size;
  }

  has(target: WarmupTarget): boolean {
    return this.items.has(target);
  }

  /** 清單內容（加入順序）。 */
  list(): WarmupTarget[] {
    return [...this.items];
  }

  clear(): void {
    this.items.clear();
  }
}

function isMaterial(x: WarmupTarget): x is THREE.Material {
  return (x as THREE.Material).isMaterial === true;
}

function isScene(x: WarmupTarget): x is THREE.Scene {
  return (x as THREE.Scene).isScene === true;
}

type Renderable = THREE.Mesh | THREE.Points | THREE.Line | THREE.Sprite;

function isRenderable(o: THREE.Object3D): o is Renderable {
  const r = o as Partial<THREE.Mesh & THREE.Points & THREE.Line & THREE.Sprite>;
  return Boolean(r.isMesh || r.isPoints || r.isLine || r.isSprite);
}

/** 代理物件用的三角形（position、normal、uv，與關卡網格的屬性相同）。 */
export function createProxyGeometry(): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1]), 2));
  return g;
}

/**
 * 依預熱清單建立代理群組：材質 → 共用三角形的 Mesh；物件 → 走訪其中的可渲染物件，以 clone(false) 建立同類型的代理
 * （共用幾何與材質，保留 InstancedMesh／SkinnedMesh／Points 等會影響著色器的類型）。
 */
export function buildWarmupProxies(targets: readonly WarmupTarget[], proxyGeometry: THREE.BufferGeometry): THREE.Group {
  const group = new THREE.Group();
  group.name = 'warmup:proxies';
  for (const t of targets) {
    // 場景另外以它自己的燈光編譯（runWarmup）。
    if (isScene(t)) continue;
    if (isMaterial(t)) {
      const m = new THREE.Mesh(proxyGeometry, t);
      m.receiveShadow = true;
      m.castShadow = true;
      group.add(m);
      continue;
    }
    t.traverse((o) => {
      if (!isRenderable(o)) return;
      const proxy = o.clone(false);
      proxy.visible = true;
      group.add(proxy);
    });
  }
  return group;
}

/** 收集材質用到的貼圖（含 ShaderMaterial uniform 中的貼圖）。 */
export function collectTextures(materials: Iterable<THREE.Material>, out: Set<THREE.Texture> = new Set()): Set<THREE.Texture> {
  for (const m of materials) {
    for (const value of Object.values(m)) if ((value as THREE.Texture | null)?.isTexture) out.add(value as THREE.Texture);
    const uniforms = (m as THREE.ShaderMaterial).uniforms;
    if (uniforms) {
      for (const u of Object.values(uniforms)) {
        const v = (u as { value?: unknown } | undefined)?.value as THREE.Texture | undefined;
        if (v?.isTexture) out.add(v);
      }
    }
  }
  return out;
}

/** 收集物件樹中的材質。 */
export function collectMaterials(root: THREE.Object3D, out: Set<THREE.Material> = new Set()): Set<THREE.Material> {
  root.traverse((o) => {
    if (!isRenderable(o)) return;
    const mat = (o as THREE.Mesh).material;
    if (Array.isArray(mat)) for (const m of mat) out.add(m);
    else if (mat) out.add(mat);
  });
  return out;
}

export interface WarmupOptions {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.Camera;
  /** 實際渲染場景時的 render target（後處理的輸入 buffer）；null = 直接畫到畫面。 */
  renderTarget: THREE.WebGLRenderTarget | null;
  registry?: WarmupRegistry;
  /** 額外要上傳的貼圖（例如材質庫的程序貼圖）。 */
  textures?: Iterable<THREE.Texture>;
}

export interface WarmupReport {
  /** 編譯的材質數（場景 + 清單）。 */
  materials: number;
  /** 上傳的貼圖數。 */
  textures: number;
  /** 預熱後的著色器程式數。 */
  programs: number;
  /** 花費時間（毫秒）。 */
  ms: number;
}

let proxyGeometry: THREE.BufferGeometry | null = null;

/** 執行預熱：編譯場景與預熱清單的著色器（等待平行編譯完成）並上傳貼圖。 */
export async function runWarmup(options: WarmupOptions): Promise<WarmupReport> {
  const { renderer, scene, camera } = options;
  const registry = options.registry ?? shaderWarmup;
  const t0 = performance.now();
  proxyGeometry ??= createProxyGeometry();
  const list = registry.list();
  const proxies = buildWarmupProxies(list, proxyGeometry);
  const extraScenes = list.filter(isScene).filter((s) => s !== scene);
  const materials = collectMaterials(scene);
  collectMaterials(proxies, materials);
  for (const s of extraScenes) collectMaterials(s, materials);
  const textures = collectTextures(materials);
  for (const t of options.textures ?? []) textures.add(t);
  const prevTarget = renderer.getRenderTarget();
  renderer.setRenderTarget(options.renderTarget);
  try {
    // 先上傳貼圖（mipmap 生成也在這裡），再編譯。
    for (const t of textures) renderer.initTexture(t);
    await renderer.compileAsync(scene, camera);
    if (proxies.children.length > 0) await renderer.compileAsync(proxies, camera, scene);
    for (const s of extraScenes) await renderer.compileAsync(s, camera);
  } finally {
    renderer.setRenderTarget(prevTarget);
    proxies.clear();
  }
  return {
    materials: materials.size,
    textures: textures.size,
    programs: renderer.info.programs?.length ?? 0,
    ms: performance.now() - t0,
  };
}

/** 全域預熱清單（M1-11 的 viewmodel 與特效材質用 registerWarmup 加入）。 */
export const shaderWarmup = new WarmupRegistry();

/**
 * 把材質、物件或另一個場景加入預熱清單；回傳取消函式。下一次 runWarmup()（載入完成、切換畫質）時編譯。
 * 材質與物件以主場景的燈光編譯；場景（例如 viewmodel 場景）以它自己的燈光編譯（含隱藏的物件）。
 */
export function registerWarmup(target: WarmupTarget): () => void {
  return shaderWarmup.register(target);
}
