// M1-09 視覺風格與後處理：畫質預設、設定預設值、程序貼圖與快取、材質表與材質庫、全息看板裝箱、
// 天空與巨構生成、陰影 texel 對齊、色差脈衝、預熱清單、LevelBuilder 的陰影旗標與看板批次、訓練場發光條。
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import {
  QUALITY_LEVELS,
  QUALITY_PRESETS,
  nearestPowerOfTwo,
  postPassesChanged,
  resolveQualityPreset,
} from '@/core/quality';
import { defaultSettings, parseSettings, SettingsStore } from '@/core/Settings';
import { GameStorage, type StorageBackend } from '@/core/Storage';
import { describePasses, PulseEnvelope } from '@/fx/PostFX';
import {
  buildWarmupProxies,
  collectMaterials,
  collectTextures,
  createProxyGeometry,
  registerWarmup,
  shaderWarmup,
  WarmupRegistry,
} from '@/fx/Warmup';
import { PlainVisuals, type LevelVisuals } from '@/world/Greybox';
import { applyHoloUniforms, createHoloUniforms, HOLO_CONFIG, labelWorldSize, packShelves } from '@/world/HoloBoards';
import { buildLevel } from '@/world/LevelBuilder';
import type { LevelData, LevelLabel } from '@/world/LevelData';
import { snapToShadowTexels, sunDirection } from '@/world/Lighting';
import { LEVEL_MATERIALS, LEVEL_MATERIAL_TABLE, materialShadowFlags, PATTERNS, type LevelMaterialDef } from '@/world/MaterialDefs';
import { MaterialLibrary } from '@/world/Materials';
import { createTrainingGroundData } from '@/world/levels/TrainingGround';
import { buildMegastructureGeometry, generateMegastructure, generateStars, MEGASTRUCTURE_CONFIG } from '@/world/Sky';
import {
  generatePattern,
  heightToNormal,
  hexCell,
  patternKey,
  TextureCache,
  type PatternTextures,
  type PatternSpec,
} from '@/world/Textures';

class MemBackend implements StorageBackend {
  data = new Map<string, string>();
  get length() {
    return this.data.size;
  }
  key(i: number) {
    return [...this.data.keys()][i] ?? null;
  }
  getItem(k: string) {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.data.set(k, v);
  }
  removeItem(k: string) {
    this.data.delete(k);
  }
}

describe('畫質預設', () => {
  it('三個等級：高 = 全開 2048 陰影、渲染比例 1；低 = 關陰影／Bloom／SMAA；渲染比例都在 0.5–1', () => {
    expect(QUALITY_LEVELS).toEqual(['low', 'medium', 'high']);
    const high = resolveQualityPreset('high');
    expect(high).toMatchObject({ renderScale: 1, shadows: true, shadowMapSize: 2048, bloom: true, smaa: true });
    const low = resolveQualityPreset('low');
    expect(low).toMatchObject({ shadows: false, bloom: false, smaa: false });
    for (const level of QUALITY_LEVELS) {
      const q = resolveQualityPreset(level);
      expect(q.renderScale).toBeGreaterThanOrEqual(0.5);
      expect(q.renderScale).toBeLessThanOrEqual(1);
    }
    // 中畫質介於兩者之間。
    expect(resolveQualityPreset('medium').renderScale).toBeGreaterThan(low.renderScale);
    expect(resolveQualityPreset('medium').renderScale).toBeLessThan(high.renderScale);
  });

  it('解析時夾住數值、陰影尺寸取 2 的次方、未知等級視為高；回傳複本', () => {
    const table = {
      ...QUALITY_PRESETS,
      low: { ...QUALITY_PRESETS.low, renderScale: 0.1, shadowMapSize: 1500 },
      medium: { ...QUALITY_PRESETS.medium, renderScale: Number.NaN, shadowMapSize: 99999 },
    };
    expect(resolveQualityPreset('low', table)).toMatchObject({ renderScale: 0.5, shadowMapSize: 2048 });
    expect(resolveQualityPreset('medium', table)).toMatchObject({ renderScale: 1, shadowMapSize: 4096 });
    expect(resolveQualityPreset('ultra')).toEqual(resolveQualityPreset('high'));
    const a = resolveQualityPreset('high');
    a.renderScale = 0.5;
    expect(QUALITY_PRESETS.high.renderScale).toBe(1);
    expect(nearestPowerOfTwo(700, 512, 4096)).toBe(512);
    expect(nearestPowerOfTwo(800, 512, 4096)).toBe(1024);
    expect(nearestPowerOfTwo(-1, 512, 4096)).toBe(512);
  });

  it('後處理 pass 組成：Bloom／SMAA 開關才需要重建；色差與色調映射永遠在主合成 pass', () => {
    const high = resolveQualityPreset('high');
    const low = resolveQualityPreset('low');
    expect(postPassesChanged(high, high)).toBe(false);
    expect(postPassesChanged(high, low)).toBe(true);
    expect(postPassesChanged(high, { ...high, renderScale: 0.6, shadows: false })).toBe(false);
    expect(postPassesChanged(high, { ...high, smaaQuality: 'low' })).toBe(true);
    expect(describePasses(high)).toEqual(['render', 'viewmodel*', 'effects(chromaticAberration+bloom+toneMapping+vignette)', 'smaa']);
    expect(describePasses(low)).toEqual(['render', 'viewmodel*', 'effects(chromaticAberration+toneMapping+vignette)']);
  });

  it('設定：新欄位「畫面色差」預設開啟；舊存檔（沒有這個欄位）補預設值，其餘值保留', () => {
    expect(defaultSettings().chromaticAberration).toBe(true);
    const old = { version: 1, values: { quality: 'low', fovHorizontal: 95, speedLines: false } };
    const p = parseSettings(old);
    expect(p.settings).toMatchObject({ quality: 'low', fovHorizontal: 95, speedLines: false, chromaticAberration: true });
    expect(p.dirty).toBe(true);
    const ls = new MemBackend();
    ls.setItem('shardwake:settings:v1', JSON.stringify(old));
    const store = new SettingsStore(new GameStorage({ backend: () => ls }));
    expect(store.get('quality')).toBe('low');
    expect(store.qualityPreset).toEqual(resolveQualityPreset('low'));
    const saved = JSON.parse(ls.getItem('shardwake:settings:v1')!);
    expect(saved.version).toBe(1);
    expect(saved.values.chromaticAberration).toBe(true);
    expect(saved.values.fovHorizontal).toBe(95);
  });
});

describe('程序貼圖', () => {
  const size = 64;

  it('相同規格結果相同（可重現）；四層資料尺寸正確', () => {
    const a = generatePattern(PATTERNS.floorPanel, size);
    const b = generatePattern(PATTERNS.floorPanel, size);
    expect(a.albedo).toEqual(b.albedo);
    expect(a.normal).toEqual(b.normal);
    for (const layer of [a.albedo, a.surface, a.normal, a.glow]) expect(layer.length).toBe(size * size * 4);
  });

  it('面板：tile 邊界有發光線、面板中央沒有；接縫比面板暗；左右邊緣可無縫重複', () => {
    const p = generatePattern(PATTERNS.floorPanel, 256);
    const s = 256;
    const at = (layer: Uint8Array, x: number, y: number) => layer[(y * s + x) * 4]!;
    expect(p.hasGlow).toBe(true);
    expect(at(p.glow, 0, 100)).toBeGreaterThan(100);
    expect(at(p.glow, 64, 64)).toBe(0);
    // 2.5 m 的面板接縫在像素 128 附近（256 px / 5 m）。
    expect(at(p.albedo, 128, 70)).toBeLessThan(at(p.albedo, 70, 70));
    // 可重複：tile 的兩側邊緣都落在接縫上（比內側暗），重複貼時接縫寬度一致。
    for (const y of [30, 70, 200]) {
      expect(at(p.albedo, 0, y)).toBeLessThan(at(p.albedo, 20, y));
      expect(at(p.albedo, s - 1, y)).toBeLessThan(at(p.albedo, s - 20, y));
      expect(at(p.glow, 0, y)).toBe(at(p.glow, s - 1, y));
    }
  });

  it('六角網格：格子中心離邊線最遠（0.5）；邊線發光；危險條紋有兩種顏色', () => {
    expect(hexCell(0.5, Math.sqrt(3) / 2).edge).toBeCloseTo(0.5, 6);
    expect(hexCell(0, 0).edge).toBeCloseTo(0.5, 6);
    expect(hexCell(0.5, 0).edge).toBeCloseTo(0, 6);
    const hex = generatePattern(PATTERNS.hexPlate, size);
    expect(hex.hasGlow).toBe(true);
    const hz = generatePattern(PATTERNS.hazardStripes, size);
    const colors = new Set<string>();
    for (let i = 0; i < size * size; i++) colors.add(`${hz.albedo[i * 4]! > 128 ? 'A' : 'B'}`);
    expect(colors).toEqual(new Set(['A', 'B']));
  });

  it('發光線條遮罩與灰盒格線：lines 只在線上發光；grid 沿用 M1-04 格線', () => {
    const l = generatePattern({ kind: 'lines', spacing: 1, width: 0.05, base: 0.2 }, 100);
    expect(l.glow[(50 * 100 + 0) * 4]).toBeGreaterThan(0);
    expect(l.glow[(50 * 100 + 10) * 4]).toBe(0);
    const g = generatePattern({ kind: 'grid' }, 64);
    expect(g.hasGlow).toBe(false);
  });

  it('平坦高度圖 → 法線朝上 (128,128,255)；斜坡往低處傾', () => {
    const flat = heightToNormal(new Float32Array(16).fill(1), 4, 2);
    expect([flat[0], flat[1], flat[2]]).toEqual([128, 128, 255]);
    const ramp = new Float32Array(16);
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) ramp[y * 4 + x] = x === 1 ? 0 : x === 2 ? 1 : 0.5;
    const n = heightToNormal(ramp, 4, 1);
    // 第 1、2 欄之間往 +x 升高：x = 1 的像素 (h(2) − h(0)) > 0 → 法線 x 分量 < 0.5。
    expect(n[(0 * 4 + 1) * 4]!).toBeLessThan(128);
  });

  it('快取：同一規格只生成一次（欄位順序不影響 key）；invalidate 後重新生成；dispose 釋放', () => {
    const factory = vi.fn(
      (spec: PatternSpec, sz: number, _aniso: number, key: string): PatternTextures => ({
        key,
        map: new THREE.DataTexture(new Uint8Array(4), 1, 1),
        surface: new THREE.DataTexture(new Uint8Array(4), 1, 1),
        normal: new THREE.DataTexture(new Uint8Array(4), 1, 1),
        glow: spec.kind === 'panel' && sz > 0 ? new THREE.DataTexture(new Uint8Array(4), 1, 1) : null,
      }),
    );
    const cache = new TextureCache({ size: 32, tileMeters: 5, maxAnisotropy: 4 }, 1, factory);
    cache.setMaxAnisotropy(16);
    const a = cache.get(PATTERNS.floorPanel);
    const reordered = Object.fromEntries(Object.entries(PATTERNS.floorPanel).reverse()) as PatternSpec;
    expect(patternKey(reordered, 32)).toBe(patternKey(PATTERNS.floorPanel, 32));
    expect(cache.get(reordered)).toBe(a);
    expect(cache.get({ ...PATTERNS.floorPanel })).toBe(a);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(factory.mock.calls[0]![2]).toBe(4); // anisotropy 取 config 上限與顯示卡最大值的較小者
    cache.get(PATTERNS.hazardStripes);
    expect(cache.size).toBe(2);
    expect(cache.textures()).toHaveLength(4 + 3);
    const dispose = vi.spyOn(a.map, 'dispose');
    expect(cache.invalidate(PATTERNS.floorPanel)).toBe(true);
    expect(dispose).toHaveBeenCalled();
    expect(cache.get(PATTERNS.floorPanel)).not.toBe(a);
    expect(cache.generated).toBe(3);
    cache.dispose();
    expect(cache.size).toBe(0);
  });
});

describe('材質表與材質庫', () => {
  it('材質表：圖樣都存在；發光條強度 > 1；訓練場用到的材質都有定義', () => {
    for (const [id, def] of Object.entries(LEVEL_MATERIALS) as [string, LevelMaterialDef][]) {
      if (def.pattern) expect(PATTERNS[def.pattern], id).toBeDefined();
      if (def.kind === 'glow') expect(def.emissiveIntensity ?? 1, id).toBeGreaterThan(1);
    }
    const used = new Set(createTrainingGroundData().primitives.map((p) => p.material));
    for (const id of used) expect(LEVEL_MATERIAL_TABLE[id], id).toBeDefined();
    expect(materialShadowFlags(LEVEL_MATERIALS.floor)).toEqual({ cast: true, receive: true });
    expect(materialShadowFlags(LEVEL_MATERIALS.glowCyan)).toEqual({ cast: false, receive: false });
    expect(materialShadowFlags(LEVEL_MATERIALS.glass)).toEqual({ cast: false, receive: true });
  });

  it('材質庫：同一個 id 同一個材質；standard 有貼圖與發光遮罩；glow 的線性顏色 > 1；共用貼圖', () => {
    const lib = new MaterialLibrary({ textureConfig: { size: 32, tileMeters: 5, maxAnisotropy: 0 }, maxAnisotropy: 8 });
    const floor = lib.material('floor') as THREE.MeshStandardMaterial;
    expect(lib.material('floor')).toBe(floor);
    expect(floor).toBeInstanceOf(THREE.MeshStandardMaterial);
    expect(floor.map).not.toBeNull();
    expect(floor.normalMap).not.toBeNull();
    expect(floor.roughnessMap).toBe(floor.metalnessMap);
    expect(floor.emissiveMap).not.toBeNull();
    expect(floor.emissiveIntensity).toBeGreaterThan(0);
    expect(floor.map!.anisotropy).toBe(8);
    const arena = lib.material('arena') as THREE.MeshStandardMaterial;
    expect(arena.map).toBe(floor.map); // 同一個圖樣共用貼圖
    const glow = lib.material('glowCyan') as THREE.MeshBasicMaterial;
    expect(glow).toBeInstanceOf(THREE.MeshBasicMaterial);
    expect(Math.max(glow.color.r, glow.color.g, glow.color.b)).toBeGreaterThan(1);
    const glass = lib.material('glass') as THREE.MeshStandardMaterial;
    expect(glass.transparent).toBe(true);
    expect(glass.depthWrite).toBe(false);
    expect(lib.glowMaterial(0xff00ff, 3)).toBe(lib.glowMaterial(0xff00ff, 3));
    expect(lib.shadowFlags('wall')).toEqual({ cast: true, receive: true });
    // 調參：改發光強度後 refresh 套用。
    const def = lib.table.floor!;
    const before = def.emissiveIntensity;
    def.emissiveIntensity = 2.5;
    lib.refresh();
    expect(floor.emissiveIntensity).toBe(2.5);
    def.emissiveIntensity = before;
    lib.refresh();
    // 沒有 document（無頭測試）時看板回傳 null。
    expect(lib.labels([{ text: '測試', pos: [0, 0, 0], yaw: 0 }])).toBeNull();
    expect(lib.all().length).toBeGreaterThanOrEqual(4);
    lib.update(0.5);
    expect(lib.holoUniforms.uTime.value).toBeCloseTo(0.5);
    lib.dispose();
  });
});

describe('全息看板', () => {
  it('貨架式裝箱：不重疊、不超出寬度、保留原順序；太寬時回傳 null', () => {
    const sizes = [
      { w: 600, h: 200 },
      { w: 900, h: 150 },
      { w: 300, h: 230 },
      { w: 1200, h: 120 },
      { w: 500, h: 200 },
      { w: 700, h: 90 },
    ];
    const r = packShelves(sizes, 2048, 4)!;
    expect(r.rects).toHaveLength(sizes.length);
    r.rects.forEach((a, i) => {
      expect(a.w).toBe(sizes[i]!.w);
      expect(a.x + a.w).toBeLessThanOrEqual(2048);
      expect(a.y + a.h).toBeLessThanOrEqual(r.height);
      r.rects.forEach((b, j) => {
        if (i >= j) return;
        const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
        expect(overlap).toBe(false);
      });
    });
    expect(packShelves([{ w: 3000, h: 10 }], 2048)).toBeNull();
    expect(packShelves([], 2048)).toEqual({ rects: [], height: 0 });
  });

  it('世界尺寸沿用 M1-04 的比例；共用 uniform 寫入設定與時間', () => {
    const label: LevelLabel = { text: 'A', pos: [0, 0, 0], yaw: 0, height: 2 };
    expect(labelWorldSize(label, 3, 1)).toEqual({ w: 2 * 1.45 * 3, h: 2 * 1.45 });
    expect(labelWorldSize({ ...label, height: undefined }, 2, 2).h).toBeCloseTo(1.9);
    const u = createHoloUniforms();
    applyHoloUniforms(u, HOLO_CONFIG, 1234.5);
    expect(u.uTime.value).toBeCloseTo(234.5);
    expect(u.uIntensity.value).toBe(HOLO_CONFIG.intensity);
    expect(HOLO_CONFIG.intensity).toBeGreaterThan(1);
  });
});

describe('天空', () => {
  it('星點：單位方向、最低到地平線下 5°、固定種子可重現', () => {
    const a = generateStars(500, 7);
    const b = generateStars(500, 7);
    expect(a.dirs).toEqual(b.dirs);
    const minY = Math.sin((-5 * Math.PI) / 180);
    for (let i = 0; i < 500; i++) {
      const x = a.dirs[i * 3]!;
      const y = a.dirs[i * 3 + 1]!;
      const z = a.dirs[i * 3 + 2]!;
      expect(Math.hypot(x, y, z)).toBeCloseTo(1, 5);
      expect(y).toBeGreaterThanOrEqual(minY - 1e-6);
    }
    expect(generateStars(500, 8).dirs).not.toEqual(a.dirs);
  });

  it('巨構：可重現；都在場地外的環帶（遠裁切 900 m 內）；有發光窗格；幾何頂點數 = 梁數 × 24', () => {
    const a = generateMegastructure(42);
    const b = generateMegastructure(42);
    expect(a).toEqual(b);
    expect(a.beams.length).toBeGreaterThan(100);
    expect(a.windows.length).toBeGreaterThan(20);
    const cfg = MEGASTRUCTURE_CONFIG;
    for (const beam of a.beams) {
      const r = Math.hypot(beam.center[0], beam.center[2]);
      expect(r).toBeGreaterThan(cfg.radiusMin - cfg.cellMax * 3);
      // 最遠點 + 場地角落（約 113 m）仍在遠裁切 900 m 內。
      expect(Math.hypot(beam.center[0], beam.center[1], beam.center[2]) + beam.size[2] + 113).toBeLessThan(900);
    }
    const geo = buildMegastructureGeometry(a);
    expect(geo.structure.getAttribute('position').count).toBe(a.beams.length * 24);
    expect(geo.windows.getAttribute('position').count).toBe(a.windows.length * 4);
    expect(geo.heights.every((h) => h >= 0 && h <= 1)).toBe(true);
  });
});

describe('燈光與陰影', () => {
  it('光線方向為單位向量、往下；方位 0 = 光源在北方（光往南、+Z）', () => {
    const d = sunDirection(0, 45);
    expect(d.length()).toBeCloseTo(1, 6);
    expect(d.y).toBeLessThan(0);
    expect(d.z).toBeGreaterThan(0);
    expect(Math.abs(d.x)).toBeLessThan(1e-9);
  });

  it('陰影中心對齊 texel：垂直光線的兩軸是 texel 的整數倍、沿光線不變；texel 內移動結果不變', () => {
    const dir = sunDirection(215, 52);
    const texel = 90 / 2048;
    const c = new THREE.Vector3(12.3456, 1.7, -40.987);
    const s = snapToShadowTexels(c, dir, texel);
    // 光線方向的分量不變。
    expect(s.dot(dir)).toBeCloseTo(c.dot(dir), 6);
    // 偏移量垂直光線、小於半個 texel 對角線。
    const delta = s.clone().sub(c);
    expect(Math.abs(delta.dot(dir))).toBeLessThan(1e-6);
    expect(delta.length()).toBeLessThanOrEqual(texel * Math.SQRT1_2 + 1e-9);
    // 再對齊一次不變（已經在格點上）。
    expect(snapToShadowTexels(s, dir, texel).distanceTo(s)).toBeLessThan(1e-6);
    // 沿光線方向移動（不改變光空間的兩軸）結果只沿光線改變。
    const moved = snapToShadowTexels(c.clone().addScaledVector(dir, 3), dir, texel);
    expect(moved.clone().sub(s).sub(dir.clone().multiplyScalar(3)).length()).toBeLessThan(1e-6);
    // texel 為 0 時不對齊。
    expect(snapToShadowTexels(c, dir, 0).distanceTo(c)).toBeLessThan(1e-9);
  });
});

describe('色差脈衝', () => {
  it('包絡：加入後為強度，(1 − t/T)² 衰減到 0；多個脈衝取最大；強度夾在 0..1', () => {
    const e = new PulseEnvelope(2);
    expect(e.value).toBe(0);
    e.add(0.5, 1);
    expect(e.value).toBeCloseTo(0.5);
    e.advance(0.5);
    expect(e.value).toBeCloseTo(0.5 * 0.25);
    e.add(2, 0.2); // 夾在 1
    expect(e.value).toBeCloseTo(1);
    e.advance(0.1);
    expect(e.value).toBeCloseTo(0.25);
    e.advance(1);
    expect(e.value).toBe(0);
    e.add(0.3, 0);
    e.add(-1, 1);
    expect(e.value).toBe(0);
  });

  it('容量滿時取代剩餘值最小的脈衝；clear 歸零', () => {
    const e = new PulseEnvelope(2);
    e.add(0.9, 10);
    e.add(0.2, 10);
    e.add(0.5, 10); // 取代 0.2
    expect(e.value).toBeCloseTo(0.9);
    e.advance(9.999);
    e.add(0.4, 1); // 取代即將結束的 0.9
    expect(e.value).toBeCloseTo(0.4, 3);
    e.clear();
    expect(e.value).toBe(0);
  });
});

describe('著色器預熱清單', () => {
  it('registerWarmup：重複加入只算一次，回傳取消函式', () => {
    const r = new WarmupRegistry();
    const m = new THREE.MeshBasicMaterial();
    const off = r.register(m);
    r.register(m);
    expect(r.size).toBe(1);
    off();
    expect(r.has(m)).toBe(false);
    const g = new THREE.MeshStandardMaterial();
    const offGlobal = registerWarmup(g);
    expect(shaderWarmup.has(g)).toBe(true);
    offGlobal();
    expect(shaderWarmup.has(g)).toBe(false);
  });

  it('代理物件：材質 → 共用三角形；物件 → 保留類型（Points、InstancedMesh），不動原本的父子關係', () => {
    const geo = createProxyGeometry();
    const tex = new THREE.Texture();
    const mat = new THREE.MeshStandardMaterial({ map: tex });
    const root = new THREE.Group();
    const parent = new THREE.Group();
    parent.add(root);
    const points = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial());
    const inst = new THREE.InstancedMesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial(), 3);
    root.add(points, inst);
    points.visible = false;
    const proxies = buildWarmupProxies([mat, root], geo);
    expect(proxies.children).toHaveLength(3);
    const [m0, p1, i2] = proxies.children as [THREE.Mesh, THREE.Points, THREE.InstancedMesh];
    expect(m0.geometry).toBe(geo);
    expect(m0.material).toBe(mat);
    expect(p1).toBeInstanceOf(THREE.Points);
    expect(p1.visible).toBe(true);
    expect(i2).toBeInstanceOf(THREE.InstancedMesh);
    expect(i2.geometry).toBe(inst.geometry);
    expect(root.parent).toBe(parent);
    expect(points.parent).toBe(root);
    const mats = collectMaterials(proxies);
    expect(mats.size).toBe(3);
    const shader = new THREE.ShaderMaterial({ uniforms: { uMap: { value: tex }, uOther: { value: 1 } } });
    const texes = collectTextures([...mats, shader]);
    expect([...texes]).toEqual([tex]);
  });
});

describe('LevelBuilder 與訓練場（M1-09）', () => {
  const data: LevelData = {
    id: 'v',
    name: 'v',
    version: 1,
    primitives: [
      { id: 'floor', type: 'box', material: 'floor', pos: [0, -0.5, 0], size: [10, 1, 10] },
      { id: 'strip', type: 'box', material: 'glowCyan', pos: [0, 0.1, 0], size: [1, 0.1, 0.1], flags: { noCollide: true } },
    ],
    spawnPoints: [{ id: 's', pos: [0, 0, 0], yaw: 0 }],
    checkpoints: [],
    killVolumes: [],
    zones: [],
    labels: [
      { text: 'A', pos: [0, 2, 0], yaw: 0 },
      { text: 'B', pos: [2, 2, 0], yaw: 0 },
    ],
  };

  it('陰影旗標來自 visuals.shadowFlags；看板優先用 labels() 批次建立，卸載時呼叫 userData.dispose', () => {
    const plain = new PlainVisuals();
    const disposed = vi.fn();
    const visuals: LevelVisuals = {
      uvTileMeters: 5,
      material: (id) => plain.material(id),
      shadowFlags: (id) => materialShadowFlags(LEVEL_MATERIAL_TABLE[id]),
      label: () => {
        throw new Error('不應該逐一建立');
      },
      labels: (labels) => {
        const g = new THREE.Group();
        g.userData.labelCount = labels.length;
        g.userData.dispose = disposed;
        return g;
      },
    };
    const build = buildLevel(data, { visuals });
    const floor = build.meshes.find((m) => m.name.endsWith(':floor'))!;
    const strip = build.meshes.find((m) => m.name.endsWith(':glowCyan'))!;
    expect([floor.castShadow, floor.receiveShadow]).toEqual([true, true]);
    expect([strip.castShadow, strip.receiveShadow]).toEqual([false, false]);
    expect(build.labels).toHaveLength(1);
    expect(build.stats.labels).toBe(2);
    build.dispose();
    expect(disposed).toHaveBeenCalledOnce();
    // 沒有 shadowFlags 的外觀（PlainVisuals）：不投射、不接收。
    const b2 = buildLevel(data);
    expect(b2.meshes.every((m) => !m.castShadow && !m.receiveShadow)).toBe(true);
    b2.dispose();
  });

  it('訓練場發光條：全部無碰撞、使用發光材質；各分區地板使用不同材質與發光色', () => {
    const tg = createTrainingGroundData();
    const strips = tg.primitives.filter((p) => p.id?.startsWith('glow-'));
    expect(strips.length).toBeGreaterThan(40);
    for (const p of strips) {
      expect(p.flags?.noCollide, p.id).toBe(true);
      expect(LEVEL_MATERIAL_TABLE[p.material]?.kind, p.id).toBe('glow');
    }
    const floors = tg.primitives.filter((p) => p.id?.startsWith('floor-')).map((p) => p.material);
    expect(new Set(floors).size).toBeGreaterThanOrEqual(7);
    const accents = new Set(floors.map((m) => LEVEL_MATERIAL_TABLE[m]?.emissive).filter((x) => x !== undefined));
    expect(accents.size).toBeGreaterThanOrEqual(3);
    // 中文看板（含中央廣場方向指示）。
    expect(tg.labels.some((l) => l.text.includes('跑牆長廊') && l.text.includes('◀'))).toBe(true);
  });
});
