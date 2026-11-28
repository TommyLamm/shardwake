// 靶標外觀（M1-12）：全部程序生成。每個靶標 = 一個受光本體網格（合併幾何、每個靶標自己的材質複本，命中時改 emissive 閃白）
// + 一個發光細節網格（共用 MaterialLibrary.glowMaterial，弱點用橘色標示）。同種靶標共用幾何；材質參數相同，
// 只會編譯一次著色器（MeshStandardMaterial + MeshBasicMaterial，載入預熱時已在場景中）。
// 敵方能量球沿用 M1-11 的 PlasmaBolts（同一個著色器），一個 draw call。
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PlasmaBolts } from '@/fx/PlasmaBolts';

/** 提供共用發光材質（MaterialLibrary 實作）。 */
export interface GlowProvider {
  glowMaterial(color: number, intensity: number): THREE.MeshBasicMaterial;
}

export interface TargetVisualStyle {
  bodyColor: number;
  bodyRoughness: number;
  bodyMetalness: number;
  droneColor: number;
  /** 弱點（頭部環、無人機核心）的發光色與強度。 */
  critGlow: number;
  critGlowIntensity: number;
  /** 一般發光細節（胸口、基座、旋翼環）。 */
  trimGlow: number;
  trimGlowIntensity: number;
  railGlow: number;
  railGlowIntensity: number;
  /** 能量球：顏色、強度、發光半徑（m）、拖尾長度（m）。 */
  boltColor: number;
  boltIntensity: number;
  boltGlowRadius: number;
  boltTrail: number;
}

export const TARGET_VISUAL_STYLE: TargetVisualStyle = {
  bodyColor: 0x3b4658,
  bodyRoughness: 0.5,
  bodyMetalness: 0.55,
  droneColor: 0x2b3240,
  critGlow: 0xff8a2a,
  critGlowIntensity: 2.6,
  trimGlow: 0x39e6ff,
  trimGlowIntensity: 1.8,
  railGlow: 0xff4fd8,
  railGlowIntensity: 1.3,
  boltColor: 0xff6a2a,
  boltIntensity: 2.4,
  boltGlowRadius: 0.42,
  boltTrail: 3.2,
};

/** 假人的尺寸（受擊碰撞體也用這組數字，外觀與命中範圍一致）。 */
export const DUMMY_SHAPE = {
  /** 軀幹膠囊：半徑、中段長度、中心高度。 */
  torsoRadius: 0.28,
  torsoLength: 0.54,
  torsoY: 0.9,
  /** 頭：半徑、中心高度。 */
  headRadius: 0.16,
  headY: 1.62,
  /** 移動靶的滑台高度。 */
  sledHeight: 0.12,
  /** 中心（範圍傷害、近戰）高度。 */
  centerY: 1.0,
} as const;

/** 無人機的尺寸（本體球、核心球的半徑與前方偏移）。 */
export const DRONE_SHAPE = {
  bodyRadius: 0.46,
  coreRadius: 0.24,
  coreOffset: 0.4,
} as const;

export interface DummyView {
  readonly group: THREE.Group;
  readonly body: THREE.Mesh;
  readonly glow: THREE.Mesh;
  readonly material: THREE.MeshStandardMaterial;
}

export interface DroneView {
  readonly group: THREE.Group;
  readonly body: THREE.Mesh;
  readonly glow: THREE.Mesh;
  readonly material: THREE.MeshStandardMaterial;
}

function place(g: THREE.BufferGeometry, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): THREE.BufferGeometry {
  if (rx || ry || rz) g.rotateX(rx).rotateY(ry).rotateZ(rz);
  g.translate(x, y, z);
  return g;
}

function merge(parts: THREE.BufferGeometry[], name: string): THREE.BufferGeometry {
  const merged = mergeGeometries(parts, false);
  if (!merged) throw new Error(`TargetVisuals：無法合併 ${name}`);
  merged.name = name;
  merged.computeBoundingSphere();
  for (const p of parts) p.dispose();
  return merged;
}

/** 假人本體（腳底為原點，正面 +Z）；sled = 移動靶的滑台。 */
export function buildDummyBodyGeometry(sled: boolean): THREE.BufferGeometry {
  const s = DUMMY_SHAPE;
  const lift = sled ? s.sledHeight : 0;
  const parts = [
    place(new THREE.CylinderGeometry(0.34, 0.38, 0.06, 20), 0, lift + 0.03, 0),
    place(new THREE.CylinderGeometry(0.05, 0.06, 0.36, 10), 0, lift + 0.24, 0),
    place(new THREE.BoxGeometry(0.36, 0.12, 0.22), 0, lift + 0.42, 0),
    place(new THREE.CapsuleGeometry(s.torsoRadius, s.torsoLength, 6, 14), 0, lift + s.torsoY, 0),
    place(new THREE.CylinderGeometry(0.06, 0.07, 0.1, 10), 0, lift + 1.47, 0),
    place(new THREE.SphereGeometry(s.headRadius, 18, 12), 0, lift + s.headY, 0),
  ];
  if (sled) parts.push(place(new THREE.BoxGeometry(0.95, s.sledHeight, 0.62), 0, s.sledHeight / 2, 0));
  return merge(parts, sled ? 'target:mover-body' : 'target:dummy-body');
}

/** 假人發光細節：頭部弱點環與面罩（橘）、胸口與基座（青）。回傳 [弱點, 細節]。 */
export function buildDummyGlowGeometry(sled: boolean): [THREE.BufferGeometry, THREE.BufferGeometry] {
  const s = DUMMY_SHAPE;
  const lift = sled ? s.sledHeight : 0;
  const crit = merge(
    [
      place(new THREE.TorusGeometry(s.headRadius + 0.008, 0.013, 6, 28), 0, lift + s.headY, 0, Math.PI / 2),
      place(new THREE.BoxGeometry(0.17, 0.035, 0.03), 0, lift + s.headY + 0.025, s.headRadius - 0.012),
    ],
    'target:dummy-crit',
  );
  const trim = merge(
    [
      place(new THREE.BoxGeometry(0.3, 0.03, 0.03), 0, lift + 1.12, s.torsoRadius - 0.006),
      place(new THREE.BoxGeometry(0.3, 0.03, 0.03), 0, lift + 0.7, s.torsoRadius - 0.006),
      place(new THREE.TorusGeometry(0.36, 0.012, 6, 32), 0, lift + 0.065, 0, Math.PI / 2),
    ],
    'target:dummy-trim',
  );
  return [crit, trim];
}

/** 無人機本體（中心為原點，正面 +Z）。 */
export function buildDroneBodyGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const shell = new THREE.SphereGeometry(0.42, 20, 14);
  shell.scale(1, 0.62, 1);
  parts.push(shell);
  parts.push(place(new THREE.CylinderGeometry(0.16, 0.24, 0.1, 16), 0, 0.27, 0));
  parts.push(place(new THREE.BoxGeometry(1.32, 0.05, 0.08), 0, 0.05, 0, 0, Math.PI / 4));
  parts.push(place(new THREE.BoxGeometry(1.32, 0.05, 0.08), 0, 0.05, 0, 0, -Math.PI / 4));
  for (const [x, z] of [
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ] as const) {
    parts.push(place(new THREE.CylinderGeometry(0.15, 0.15, 0.06, 16), x * 0.46, 0.08, z * 0.46));
  }
  // 核心外框（前方的環形支架）。
  parts.push(place(new THREE.CylinderGeometry(0.25, 0.27, 0.08, 20), 0, 0, 0.3, Math.PI / 2));
  return merge(parts, 'target:drone-body');
}

/** 無人機發光：核心（弱點，橘）與旋翼環（青）。 */
export function buildDroneGlowGeometry(): [THREE.BufferGeometry, THREE.BufferGeometry] {
  const d = DRONE_SHAPE;
  const crit = merge([place(new THREE.SphereGeometry(0.2, 16, 12), 0, 0, d.coreOffset)], 'target:drone-core');
  const rings: THREE.BufferGeometry[] = [];
  for (const [x, z] of [
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ] as const) {
    rings.push(place(new THREE.TorusGeometry(0.17, 0.012, 6, 24), x * 0.46, 0.115, z * 0.46, Math.PI / 2));
  }
  rings.push(place(new THREE.TorusGeometry(0.3, 0.01, 6, 32), 0, -0.2, 0, Math.PI / 2));
  return [crit, merge(rings, 'target:drone-trim')];
}

export class TargetVisuals {
  readonly root = new THREE.Group();
  readonly bolts: PlasmaBolts;
  readonly style: TargetVisualStyle;
  private readonly baseMaterial: THREE.MeshStandardMaterial;
  private readonly droneBaseMaterial: THREE.MeshStandardMaterial;
  private readonly geo: {
    dummy: THREE.BufferGeometry;
    mover: THREE.BufferGeometry;
    dummyCrit: THREE.BufferGeometry;
    dummyTrim: THREE.BufferGeometry;
    moverCrit: THREE.BufferGeometry;
    moverTrim: THREE.BufferGeometry;
    drone: THREE.BufferGeometry;
    droneCrit: THREE.BufferGeometry;
    droneTrim: THREE.BufferGeometry;
  };
  private readonly materials: THREE.Material[] = [];
  private readonly extraGeometries: THREE.BufferGeometry[] = [];

  constructor(
    private readonly glow: GlowProvider,
    style: TargetVisualStyle = TARGET_VISUAL_STYLE,
    boltCapacity = 32,
  ) {
    this.style = style;
    this.root.name = 'targets';
    this.baseMaterial = new THREE.MeshStandardMaterial({
      name: 'target:body',
      color: style.bodyColor,
      roughness: style.bodyRoughness,
      metalness: style.bodyMetalness,
      emissive: 0xffffff,
      emissiveIntensity: 0,
    });
    this.droneBaseMaterial = this.baseMaterial.clone();
    this.droneBaseMaterial.name = 'target:drone';
    this.droneBaseMaterial.color.setHex(style.droneColor);
    const [dummyCrit, dummyTrim] = buildDummyGlowGeometry(false);
    const [moverCrit, moverTrim] = buildDummyGlowGeometry(true);
    const [droneCrit, droneTrim] = buildDroneGlowGeometry();
    this.geo = {
      dummy: buildDummyBodyGeometry(false),
      mover: buildDummyBodyGeometry(true),
      dummyCrit,
      dummyTrim,
      moverCrit,
      moverTrim,
      drone: buildDroneBodyGeometry(),
      droneCrit,
      droneTrim,
    };
    this.bolts = new PlasmaBolts(boltCapacity);
    this.bolts.mesh.name = 'target:bolts';
    this.root.add(this.bolts.mesh);
  }

  private critMaterial(): THREE.MeshBasicMaterial {
    return this.glow.glowMaterial(this.style.critGlow, this.style.critGlowIntensity);
  }

  private trimMaterial(): THREE.MeshBasicMaterial {
    return this.glow.glowMaterial(this.style.trimGlow, this.style.trimGlowIntensity);
  }

  /** 建立一個假人（sled = 移動靶）；加入 root。 */
  createDummy(sled: boolean): DummyView {
    const material = this.baseMaterial.clone();
    this.materials.push(material);
    const group = new THREE.Group();
    group.name = sled ? 'target:mover' : 'target:dummy';
    const body = new THREE.Mesh(sled ? this.geo.mover : this.geo.dummy, material);
    body.castShadow = true;
    body.receiveShadow = true;
    const crit = new THREE.Mesh(sled ? this.geo.moverCrit : this.geo.dummyCrit, this.critMaterial());
    const trim = new THREE.Mesh(sled ? this.geo.moverTrim : this.geo.dummyTrim, this.trimMaterial());
    group.add(body, crit, trim);
    this.root.add(group);
    return { group, body, glow: crit, material };
  }

  createDrone(): DroneView {
    const material = this.droneBaseMaterial.clone();
    this.materials.push(material);
    const group = new THREE.Group();
    group.name = 'target:drone';
    const body = new THREE.Mesh(this.geo.drone, material);
    body.castShadow = true;
    const crit = new THREE.Mesh(this.geo.droneCrit, this.critMaterial());
    const trim = new THREE.Mesh(this.geo.droneTrim, this.trimMaterial());
    group.add(body, crit, trim);
    this.root.add(group);
    return { group, body, glow: crit, material };
  }

  /** 移動靶軌道（發光細條與兩端擋塊）。 */
  createRail(xMin: number, xMax: number, y: number, z: number): THREE.Mesh {
    const len = xMax - xMin + 1.2;
    const cx = (xMin + xMax) / 2;
    const g = merge(
      [
        place(new THREE.BoxGeometry(len, 0.03, 0.08), cx, y + 0.015, z - 0.22),
        place(new THREE.BoxGeometry(len, 0.03, 0.08), cx, y + 0.015, z + 0.22),
        place(new THREE.BoxGeometry(0.12, 0.25, 0.6), xMin - 0.6, y + 0.125, z),
        place(new THREE.BoxGeometry(0.12, 0.25, 0.6), xMax + 0.6, y + 0.125, z),
      ],
      'target:rail',
    );
    this.extraGeometries.push(g);
    const mesh = new THREE.Mesh(g, this.glow.glowMaterial(this.style.railGlow, this.style.railGlowIntensity));
    mesh.name = 'target:rail';
    this.root.add(mesh);
    return mesh;
  }

  /** 設定命中閃白（0..1 × 強度）。 */
  static setFlash(material: THREE.MeshStandardMaterial, intensity: number): void {
    material.emissiveIntensity = intensity;
  }

  /** 移除所有靶標網格（保留能量球網格）；換關卡時呼叫。 */
  clearTargets(): void {
    for (const child of [...this.root.children]) if (child !== this.bolts.mesh) this.root.remove(child);
    for (const m of this.materials) m.dispose();
    this.materials.length = 0;
    for (const g of this.extraGeometries) g.dispose();
    this.extraGeometries.length = 0;
  }

  dispose(): void {
    this.clearTargets();
    for (const g of Object.values(this.geo)) g.dispose();
    this.baseMaterial.dispose();
    this.droneBaseMaterial.dispose();
    this.bolts.dispose();
    this.root.removeFromParent();
  }
}
