// LevelBuilder：LevelData → Rapier 靜態碰撞體 ＋ Three.js 網格（同一份變換資料，包圍盒一致）。
// - box → cuboid；ramp → 旋轉過的 cuboid（坡板）；cylinder → cylinder；trimesh → trimesh（FIX_INTERNAL_EDGES）。
// - 網格先在世界座標生成（含以公尺計的格線 UV），再依材質用 mergeGeometries 合併：
//   每個材質一個 Mesh（一個 draw call），靜態幾何不更新矩陣。
// - 表面資訊（跑牆、抓鉤、材質、owner = 基本體 id）登記到 physics.surfaces。
// - physics 可省略（只產生網格，例如預覽）；visuals 可省略（無頭測試用 PlainVisuals）。
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { COLLISION_PRESETS } from '@/physics/groups';
import type { Physics } from '@/physics/Physics';
import { DEFAULT_SURFACE, type SurfaceInfo } from '@/physics/SurfaceRegistry';
import { GREYBOX_MATERIAL_TABLE, PlainVisuals, type LevelVisuals, type MaterialTable } from '@/world/Greybox';
import {
  CYLINDER_DEFAULT_SEGMENTS,
  RAMP_DEFAULT_THICKNESS,
  degToRad,
  validateLevelData,
  type LevelData,
  type LevelPrimitive,
} from '@/world/LevelData';

export interface BuildOptions {
  /** 物理世界；省略時不建立碰撞體。 */
  physics?: Physics | null;
  /** 外觀來源；省略時用 PlainVisuals（MeshBasicMaterial，無看板）。 */
  visuals?: LevelVisuals;
  /** 材質表（表面類型與預設旗標）。 */
  materials?: MaterialTable;
  /** 碰撞體的 interaction groups（預設 COLLISION_PRESETS.world）。 */
  collisionGroups?: number;
  /** 不建立看板。 */
  skipLabels?: boolean;
}

export interface BuiltPrimitive {
  index: number;
  id: string;
  def: LevelPrimitive;
  /** 碰撞體（noCollide 或沒有 physics 時為 null）。 */
  collider: RAPIER.Collider | null;
  /** 網格（合併前）的世界座標包圍盒。 */
  bounds: THREE.Box3;
  surface: SurfaceInfo;
}

export interface LevelBuildStats {
  primitives: number;
  colliders: number;
  /** 關卡網格數（合併後；每個大約一個 draw call）。 */
  meshes: number;
  labels: number;
  triangles: number;
  vertices: number;
}

export interface LevelBuild {
  readonly root: THREE.Group;
  /** 合併後的網格（每個材質一個）。 */
  readonly meshes: THREE.Mesh[];
  readonly labels: THREE.Object3D[];
  readonly primitives: BuiltPrimitive[];
  readonly colliders: RAPIER.Collider[];
  readonly stats: LevelBuildStats;
  /** 移除碰撞體與表面登記、釋放幾何與看板資源、從場景移除 root。 */
  dispose(): void;
}

// ── 變換 ───────────────────────────────────────────────

const _euler = new THREE.Euler(0, 0, 0, 'YXZ');
const _q = new THREE.Quaternion();
const _qPitch = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _axisX = new THREE.Vector3(1, 0, 0);

/** 基本體的旋轉（不含 ramp 的坡度）。 */
export function primitiveBaseQuat(p: LevelPrimitive, out: THREE.Quaternion = new THREE.Quaternion()): THREE.Quaternion {
  const r = p.rot ?? [0, 0, 0];
  _euler.set(degToRad(r[0]), degToRad(r[1]), degToRad(r[2]), 'YXZ');
  return out.setFromEuler(_euler);
}

/** 坡度角（弧度）與坡板長度。 */
export function rampGeometry(p: { size: readonly [number, number, number] }): { angle: number; length: number } {
  const rise = p.size[1];
  const run = p.size[2];
  return { angle: Math.atan2(rise, run), length: Math.hypot(rise, run) };
}

/**
 * 碰撞體與網格共用的變換（中心位置與旋轉）。ramp 的中心是坡板中心（坡面中線往下半個厚度）。
 */
export function primitiveTransform(
  p: LevelPrimitive,
  outPos: THREE.Vector3 = new THREE.Vector3(),
  outQuat: THREE.Quaternion = new THREE.Quaternion(),
): { pos: THREE.Vector3; quat: THREE.Quaternion } {
  primitiveBaseQuat(p, outQuat);
  outPos.set(p.pos[0], p.pos[1], p.pos[2]);
  if (p.type === 'ramp') {
    const t = p.thickness ?? RAMP_DEFAULT_THICKNESS;
    const { angle } = rampGeometry(p);
    // 坡面中點 (0, rise/2, 0)，坡板法線 (0, cos, sin)；中心 = 中點 − 法線 × 厚度/2。
    _v.set(0, p.size[1] / 2 - (Math.cos(angle) * t) / 2, -(Math.sin(angle) * t) / 2).applyQuaternion(outQuat);
    outPos.add(_v);
    _qPitch.setFromAxisAngle(_axisX, angle);
    outQuat.multiply(_qPitch);
  }
  return { pos: outPos, quat: outQuat };
}

// ── 碰撞體 ─────────────────────────────────────────────

/** 基本體 → Rapier ColliderDesc（已設定位置與旋轉，未設定群組）。 */
export function primitiveColliderDesc(p: LevelPrimitive): RAPIER.ColliderDesc {
  let desc: RAPIER.ColliderDesc;
  switch (p.type) {
    case 'box':
      desc = RAPIER.ColliderDesc.cuboid(p.size[0] / 2, p.size[1] / 2, p.size[2] / 2);
      break;
    case 'ramp': {
      const { length } = rampGeometry(p);
      desc = RAPIER.ColliderDesc.cuboid(p.size[0] / 2, (p.thickness ?? RAMP_DEFAULT_THICKNESS) / 2, length / 2);
      break;
    }
    case 'cylinder':
      desc = RAPIER.ColliderDesc.cylinder(p.size[1] / 2, p.size[0] / 2);
      break;
    case 'trimesh': {
      const built = RAPIER.ColliderDesc.trimesh(
        new Float32Array(p.vertices),
        new Uint32Array(p.indices),
        RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES,
      );
      if (!built) throw new Error(`trimesh 建立失敗：${p.id ?? '(未命名)'}`);
      desc = built;
      break;
    }
  }
  const { pos, quat } = primitiveTransform(p, _v2, _q2);
  desc.setTranslation(pos.x, pos.y, pos.z);
  desc.setRotation({ x: quat.x, y: quat.y, z: quat.z, w: quat.w });
  return desc;
}
const _v2 = new THREE.Vector3();
const _q2 = new THREE.Quaternion();

// ── 網格 ───────────────────────────────────────────────

/** 基本體在自己座標系（primitiveTransform 的中心）中的幾何（含法線，UV 之後重算）。 */
export function primitiveLocalGeometry(p: LevelPrimitive): THREE.BufferGeometry {
  switch (p.type) {
    case 'box':
      return new THREE.BoxGeometry(p.size[0], p.size[1], p.size[2]);
    case 'ramp': {
      const { length } = rampGeometry(p);
      return new THREE.BoxGeometry(p.size[0], p.thickness ?? RAMP_DEFAULT_THICKNESS, length);
    }
    case 'cylinder': {
      const r = p.size[0] / 2;
      return new THREE.CylinderGeometry(r, r, p.size[1], p.segments ?? CYLINDER_DEFAULT_SEGMENTS, 1);
    }
    case 'trimesh':
      return flatTrimeshGeometry(p.vertices, p.indices);
  }
}

/** 由頂點／索引建立平面著色（每個三角形獨立頂點）的帶索引幾何。 */
export function flatTrimeshGeometry(vertices: readonly number[], indices: readonly number[]): THREE.BufferGeometry {
  const pos = new Float32Array(indices.length * 3);
  for (let i = 0; i < indices.length; i++) {
    const v = indices[i]! * 3;
    pos[i * 3] = vertices[v]!;
    pos[i * 3 + 1] = vertices[v + 1]!;
    pos[i * 3 + 2] = vertices[v + 2]!;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(indices.length * 2), 2));
  const index = new Uint32Array(indices.length);
  for (let i = 0; i < index.length; i++) index[i] = i;
  geo.setIndex(new THREE.BufferAttribute(index, 1));
  geo.computeVertexNormals();
  return geo;
}

const _n = new THREE.Vector3();
const _p = new THREE.Vector3();
const _t1 = new THREE.Vector3();
const _t2 = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _one = new THREE.Vector3(1, 1, 1);

/**
 * 把 local 幾何變換到世界座標，並以「公尺 / tileMeters」重算 UV：
 * 依 local 法線的主軸挑兩條 local 切線，轉到世界後與世界座標內積；
 * 沒有旋轉的面會和世界格線對齊（相鄰地板的線接得起來），斜坡沿坡面量測、不拉伸。
 */
export function toWorldWithGridUVs(
  geo: THREE.BufferGeometry,
  pos: THREE.Vector3,
  quat: THREE.Quaternion,
  tileMeters: number,
): THREE.BufferGeometry {
  const position = geo.getAttribute('position');
  const normal = geo.getAttribute('normal');
  let uv = geo.getAttribute('uv') as THREE.BufferAttribute | undefined;
  if (!uv) {
    uv = new THREE.BufferAttribute(new Float32Array(position.count * 2), 2);
    geo.setAttribute('uv', uv);
  }
  const inv = 1 / tileMeters;
  for (let i = 0; i < position.count; i++) {
    _n.set(normal.getX(i), normal.getY(i), normal.getZ(i));
    const ax = Math.abs(_n.x);
    const ay = Math.abs(_n.y);
    const az = Math.abs(_n.z);
    if (ay >= ax && ay >= az) {
      _t1.set(1, 0, 0);
      _t2.set(0, 0, 1);
    } else if (ax >= az) {
      _t1.set(0, 0, 1);
      _t2.set(0, 1, 0);
    } else {
      _t1.set(1, 0, 0);
      _t2.set(0, 1, 0);
    }
    _t1.applyQuaternion(quat);
    _t2.applyQuaternion(quat);
    _p.set(position.getX(i), position.getY(i), position.getZ(i)).applyQuaternion(quat).add(pos);
    uv.setXY(i, _p.dot(_t1) * inv, _p.dot(_t2) * inv);
  }
  uv.needsUpdate = true;
  geo.applyMatrix4(_m.compose(pos, quat, _one));
  geo.clearGroups();
  return geo;
}

/** 基本體 → 世界座標幾何（含格線 UV）。 */
export function primitiveWorldGeometry(p: LevelPrimitive, tileMeters: number): THREE.BufferGeometry {
  const { pos, quat } = primitiveTransform(p, _v3, _q3);
  const geo = primitiveLocalGeometry(p);
  return toWorldWithGridUVs(geo, pos, quat, tileMeters);
}
const _v3 = new THREE.Vector3();
const _q3 = new THREE.Quaternion();

// ── 建構 ───────────────────────────────────────────────

/** 基本體的表面資訊（材質預設 → flags 覆寫）。 */
export function resolveSurface(p: LevelPrimitive, id: string, materials: MaterialTable): SurfaceInfo {
  const def = materials[p.material];
  const f = p.flags ?? {};
  return {
    wallRunnable: f.wallRunnable ?? def?.wallRunnable ?? DEFAULT_SURFACE.wallRunnable,
    grappleable: f.grappleable ?? def?.grappleable ?? DEFAULT_SURFACE.grappleable,
    surface: f.surface ?? def?.surface ?? DEFAULT_SURFACE.surface,
    owner: id,
  };
}

/** 建構關卡。資料不合法時丟出例外（列出所有錯誤）。 */
export function buildLevel(data: LevelData, options: BuildOptions = {}): LevelBuild {
  const materials = options.materials ?? GREYBOX_MATERIAL_TABLE;
  const errors = validateLevelData(data, Object.keys(materials));
  if (errors.length > 0) throw new Error(`關卡「${data.id}」資料不合法：\n${errors.join('\n')}`);

  const physics = options.physics ?? null;
  const ownVisuals = options.visuals ? null : new PlainVisuals(materials);
  const visuals: LevelVisuals = options.visuals ?? ownVisuals!;
  const groups = options.collisionGroups ?? COLLISION_PRESETS.world;
  const generation = physics?.generation ?? 0;

  const root = new THREE.Group();
  root.name = `level:${data.id}`;
  const primitives: BuiltPrimitive[] = [];
  const colliders: RAPIER.Collider[] = [];
  const byMaterial = new Map<string, THREE.BufferGeometry[]>();

  data.primitives.forEach((p, index) => {
    const id = p.id ?? `${data.id}#${index}`;
    const surface = resolveSurface(p, id, materials);
    let collider: RAPIER.Collider | null = null;
    if (physics && !p.flags?.noCollide) {
      const desc = primitiveColliderDesc(p).setCollisionGroups(groups);
      collider = physics.createStaticCollider(desc, surface);
      colliders.push(collider);
    }
    const geo = primitiveWorldGeometry(p, visuals.uvTileMeters);
    geo.computeBoundingBox();
    const bounds = geo.boundingBox!.clone();
    if (p.flags?.noRender) geo.dispose();
    else {
      let list = byMaterial.get(p.material);
      if (!list) byMaterial.set(p.material, (list = []));
      list.push(geo);
    }
    primitives.push({ index, id, def: p, collider, bounds, surface });
  });

  const meshes: THREE.Mesh[] = [];
  let triangles = 0;
  let vertices = 0;
  for (const [materialId, list] of byMaterial) {
    const merged = list.length === 1 ? list[0]! : mergeGeometries(list, false);
    if (!merged) throw new Error(`合併材質「${materialId}」的幾何失敗`);
    if (list.length > 1) for (const g of list) g.dispose();
    merged.computeBoundingBox();
    merged.computeBoundingSphere();
    const mesh = new THREE.Mesh(merged, visuals.material(materialId));
    mesh.name = `level:${data.id}:${materialId}`;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    root.add(mesh);
    meshes.push(mesh);
    vertices += merged.getAttribute('position').count;
    triangles += (merged.index ? merged.index.count : merged.getAttribute('position').count) / 3;
  }

  const labels: THREE.Object3D[] = [];
  if (!options.skipLabels && visuals.label) {
    for (const l of data.labels) {
      const obj = visuals.label(l);
      if (!obj) continue;
      obj.updateMatrix();
      obj.matrixAutoUpdate = false;
      root.add(obj);
      labels.push(obj);
    }
  }
  root.updateMatrixWorld(true);
  if (physics) physics.syncQueries();

  let disposed = false;
  return {
    root,
    meshes,
    labels,
    primitives,
    colliders,
    stats: {
      primitives: primitives.length,
      colliders: colliders.length,
      meshes: meshes.length,
      labels: labels.length,
      triangles,
      vertices,
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (physics && !physics.isDisposed) for (const c of colliders) physics.removeCollider(c, generation);
      for (const m of meshes) m.geometry.dispose();
      for (const obj of labels) {
        obj.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (!mesh.isMesh && !(o as THREE.Sprite).isSprite) return;
          if (!o.userData.sharedGeometry) mesh.geometry?.dispose();
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          for (const mat of mats) {
            (mat as THREE.MeshBasicMaterial).map?.dispose();
            mat.dispose();
          }
        });
      }
      root.removeFromParent();
      ownVisuals?.dispose();
    },
  };
}
