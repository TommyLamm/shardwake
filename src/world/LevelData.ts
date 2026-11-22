// 關卡資料格式：同一份資料同時生成網格與碰撞體（LevelBuilder）。M4 的房間模組沿用這個格式。
//
// 座標與單位：公尺，y 向上；角度一律為「度」。
//   rot = [x, y, z]：以 Euler 'YXZ'（先 yaw、再 pitch、最後 roll）套用。
//   yaw：0 面向 -Z，正值向左轉（與 M1-03 的視角慣例相同）。
// 基本體（primitives）：
//   box       pos = 中心，size = [寬 x, 高 y, 深 z]。
//   ramp      pos = 斜坡底面（腳印）的中心、高度為坡底；size = [寬 x, 上升高度 rise, 水平長度 run]；
//             坡面從 local +Z 端（高 0）升到 -Z 端（高 rise）；碰撞體是旋轉過的 cuboid（厚度 thickness，預設 0.5 m）。
//   cylinder  pos = 中心，size = [直徑, 高, 直徑]（x 與 z 必須相同），軸向 local Y。
//   trimesh   pos／rot 為變換，vertices（local，xyz 攤平）與 indices（三角形）直接給；size 可省略。
// material 為材質 id（灰盒材質表 GREYBOX_MATERIALS，M1-09 換成正式材質庫）；材質決定表面類型與預設旗標，
// flags 可逐一覆寫。
import type { SurfaceType } from '@/physics/SurfaceRegistry';

export type Vec3Tuple = readonly [number, number, number];

export interface PrimitiveFlags {
  /** 可跑牆（未指定時用材質預設）。 */
  wallRunnable?: boolean;
  /** 可抓鉤（未指定時用材質預設）。 */
  grappleable?: boolean;
  /** 覆寫材質的表面類型。 */
  surface?: SurfaceType;
  /** 只有網格、沒有碰撞體（裝飾）。 */
  noCollide?: boolean;
  /** 只有碰撞體、沒有網格（隱形牆）。 */
  noRender?: boolean;
}

interface PrimitiveBase {
  /** 選填的 id（除錯、命中判定的 owner）；未給時由 LevelBuilder 以索引命名。 */
  id?: string;
  pos: Vec3Tuple;
  /** 旋轉（度，Euler YXZ）；預設 [0, 0, 0]。 */
  rot?: Vec3Tuple;
  material: string;
  flags?: PrimitiveFlags;
}

export interface BoxPrimitive extends PrimitiveBase {
  type: 'box';
  size: Vec3Tuple;
}

export interface RampPrimitive extends PrimitiveBase {
  type: 'ramp';
  /** [寬, 上升高度, 水平長度]。 */
  size: Vec3Tuple;
  /** 坡板厚度（公尺），預設 0.5。 */
  thickness?: number;
}

export interface CylinderPrimitive extends PrimitiveBase {
  type: 'cylinder';
  /** [直徑, 高, 直徑]。 */
  size: Vec3Tuple;
  /** 網格的圓周分段數（4 的倍數），預設 24。 */
  segments?: number;
}

export interface TrimeshPrimitive extends PrimitiveBase {
  type: 'trimesh';
  /** local 頂點（x, y, z 攤平）。 */
  vertices: readonly number[];
  /** 三角形索引（每 3 個一個三角形）。 */
  indices: readonly number[];
  size?: Vec3Tuple;
}

export type LevelPrimitive = BoxPrimitive | RampPrimitive | CylinderPrimitive | TrimeshPrimitive;
export type PrimitiveType = LevelPrimitive['type'];

export interface SpawnPoint {
  id: string;
  /** 腳底位置。 */
  pos: Vec3Tuple;
  /** 面向（度）。 */
  yaw: number;
}

export interface Checkpoint {
  id: string;
  /** 重生的腳底位置。 */
  pos: Vec3Tuple;
  yaw: number;
  /** 觸發半徑（公尺），計時賽環形檢查點用（M1-15）；預設 3。 */
  radius?: number;
  /** 所屬路線（例如 'parkour'）；沒有路線的檢查點只當重生點。 */
  course?: string;
  /** 路線中的順序（0 起算）。 */
  order?: number;
  /** 是否當作重生點（預設 true；計時賽的環形檢查點設 false，避免落坑後跳過關卡）。 */
  respawn?: boolean;
}

/** 落入就回到最近檢查點的範圍（軸對齊盒）。 */
export interface KillVolume {
  id: string;
  pos: Vec3Tuple;
  size: Vec3Tuple;
}

export interface Zone {
  id: string;
  /** 顯示名稱（繁體中文）。 */
  name: string;
  /** 範圍（軸對齊盒的中心與大小）。 */
  pos: Vec3Tuple;
  size: Vec3Tuple;
  /** 進入時發出的觸發事件名稱（`level:zone` 的 event 欄位），例如 'arena:enter'。 */
  event?: string;
  /** 傳送目標（除錯傳送、計時賽起點）；未給時用範圍中心的地面。 */
  spawn?: { pos: Vec3Tuple; yaw: number };
}

export interface LevelLabel {
  text: string;
  /** 第二行小字（選填）。 */
  sub?: string;
  /** 看板中心。 */
  pos: Vec3Tuple;
  /** 看板正面朝向（度）：0 = 正面朝 +Z（給面向 -Z 的人看）。 */
  yaw: number;
  /** 主文字高度（公尺），預設 1。 */
  height?: number;
  /** 文字顏色（0xRRGGBB），預設白。 */
  color?: number;
}

export interface LevelData {
  id: string;
  name: string;
  /** 格式版本（目前 1）。 */
  version: 1;
  primitives: readonly LevelPrimitive[];
  spawnPoints: readonly SpawnPoint[];
  checkpoints: readonly Checkpoint[];
  killVolumes: readonly KillVolume[];
  zones: readonly Zone[];
  labels: readonly LevelLabel[];
}

export const RAMP_DEFAULT_THICKNESS = 0.5;
export const CYLINDER_DEFAULT_SEGMENTS = 24;
export const CHECKPOINT_DEFAULT_RADIUS = 3;

// ── 小工具 ─────────────────────────────────────────────

export function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** 點是否在軸對齊盒內（含邊界）。 */
export function boxContains(pos: Vec3Tuple, size: Vec3Tuple, p: { x: number; y: number; z: number }): boolean {
  return (
    Math.abs(p.x - pos[0]) <= size[0] / 2 &&
    Math.abs(p.y - pos[1]) <= size[1] / 2 &&
    Math.abs(p.z - pos[2]) <= size[2] / 2
  );
}

/** 區域的傳送目標：有 spawn 用 spawn，否則用範圍中心的底面。 */
export function zoneSpawn(zone: Zone): { pos: Vec3Tuple; yaw: number } {
  if (zone.spawn) return zone.spawn;
  return { pos: [zone.pos[0], zone.pos[1] - zone.size[1] / 2, zone.pos[2]], yaw: 0 };
}

/** 依路線取出排序好的檢查點。 */
export function courseCheckpoints(data: Pick<LevelData, 'checkpoints'>, course: string): Checkpoint[] {
  return data.checkpoints
    .filter((c) => c.course === course)
    .slice()
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

/** 離 p 最近的重生檢查點（3D 距離，略過 respawn = false）；沒有時回傳 null。 */
export function nearestCheckpoint(
  data: Pick<LevelData, 'checkpoints'>,
  p: { x: number; y: number; z: number },
): Checkpoint | null {
  let best: Checkpoint | null = null;
  let bestD = Infinity;
  for (const c of data.checkpoints) {
    if (c.respawn === false) continue;
    const d = (c.pos[0] - p.x) ** 2 + (c.pos[1] - p.y) ** 2 + (c.pos[2] - p.z) ** 2;
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}

/** p 落在哪個 killVolume（沒有則 null）。 */
export function killVolumeAt(
  data: Pick<LevelData, 'killVolumes'>,
  p: { x: number; y: number; z: number },
): KillVolume | null {
  for (const k of data.killVolumes) if (boxContains(k.pos, k.size, p)) return k;
  return null;
}

/** p 所在的區域（第一個符合者；沒有則 null）。 */
export function zoneAt(data: Pick<LevelData, 'zones'>, p: { x: number; y: number; z: number }): Zone | null {
  for (const z of data.zones) if (boxContains(z.pos, z.size, p)) return z;
  return null;
}

// ── 驗證 ───────────────────────────────────────────────

function finiteTuple(v: unknown): v is Vec3Tuple {
  return Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number' && Number.isFinite(n));
}

function positiveTuple(v: unknown): boolean {
  return finiteTuple(v) && v.every((n) => n > 0);
}

/**
 * 檢查關卡資料，回傳錯誤訊息清單（空陣列 = 合法）。knownMaterials 有給時一併檢查材質 id。
 */
export function validateLevelData(data: LevelData, knownMaterials?: ReadonlySet<string> | readonly string[]): string[] {
  const errors: string[] = [];
  const materials = knownMaterials ? new Set(knownMaterials) : null;
  if (!data.id) errors.push('缺少關卡 id');
  if (data.version !== 1) errors.push(`不支援的關卡格式版本 ${String(data.version)}`);
  const primitiveIds = new Set<string>();
  data.primitives.forEach((p, i) => {
    const where = `primitives[${i}]${p.id ? `（${p.id}）` : ''}`;
    if (p.id) {
      if (primitiveIds.has(p.id)) errors.push(`${where}：id 重複`);
      primitiveIds.add(p.id);
    }
    if (!finiteTuple(p.pos)) errors.push(`${where}：pos 必須是 3 個有限數字`);
    if (p.rot !== undefined && !finiteTuple(p.rot)) errors.push(`${where}：rot 必須是 3 個有限數字`);
    if (materials && !materials.has(p.material)) errors.push(`${where}：未知材質「${p.material}」`);
    switch (p.type) {
      case 'box':
        if (!positiveTuple(p.size)) errors.push(`${where}：box size 必須都 > 0`);
        break;
      case 'ramp':
        if (!positiveTuple(p.size)) errors.push(`${where}：ramp size 必須都 > 0`);
        if (p.thickness !== undefined && !(p.thickness > 0)) errors.push(`${where}：ramp thickness 必須 > 0`);
        break;
      case 'cylinder':
        if (!positiveTuple(p.size)) errors.push(`${where}：cylinder size 必須都 > 0`);
        else if (Math.abs(p.size[0] - p.size[2]) > 1e-9) errors.push(`${where}：cylinder 的 x 與 z 直徑必須相同`);
        if (p.segments !== undefined && (p.segments < 4 || p.segments % 4 !== 0)) {
          errors.push(`${where}：cylinder segments 必須是 ≥ 4 的 4 的倍數`);
        }
        break;
      case 'trimesh': {
        const nv = p.vertices.length;
        if (nv < 9 || nv % 3 !== 0 || !p.vertices.every(Number.isFinite)) {
          errors.push(`${where}：trimesh vertices 長度必須是 3 的倍數（至少一個三角形）且為有限數字`);
        }
        if (p.indices.length < 3 || p.indices.length % 3 !== 0) errors.push(`${where}：trimesh indices 長度必須是 3 的倍數`);
        const count = nv / 3;
        if (p.indices.some((ix) => !Number.isInteger(ix) || ix < 0 || ix >= count)) {
          errors.push(`${where}：trimesh indices 超出範圍`);
        }
        break;
      }
      default:
        errors.push(`${where}：未知的基本體類型 ${String((p as { type?: unknown }).type)}`);
    }
  });
  const uniq = (kind: string, list: readonly { id: string }[]): void => {
    const seen = new Set<string>();
    for (const item of list) {
      if (!item.id) errors.push(`${kind}：缺少 id`);
      else if (seen.has(item.id)) errors.push(`${kind}：id「${item.id}」重複`);
      seen.add(item.id);
    }
  };
  uniq('spawnPoints', data.spawnPoints);
  uniq('checkpoints', data.checkpoints);
  uniq('killVolumes', data.killVolumes);
  uniq('zones', data.zones);
  if (data.spawnPoints.length === 0) errors.push('至少需要一個 spawnPoint');
  for (const s of data.spawnPoints) if (!finiteTuple(s.pos)) errors.push(`spawnPoints「${s.id}」：pos 不合法`);
  for (const c of data.checkpoints) if (!finiteTuple(c.pos)) errors.push(`checkpoints「${c.id}」：pos 不合法`);
  for (const k of data.killVolumes) {
    if (!finiteTuple(k.pos) || !positiveTuple(k.size)) errors.push(`killVolumes「${k.id}」：範圍不合法`);
  }
  for (const z of data.zones) {
    if (!finiteTuple(z.pos) || !positiveTuple(z.size)) errors.push(`zones「${z.id}」：範圍不合法`);
    if (!z.name) errors.push(`zones「${z.id}」：缺少名稱`);
  }
  data.labels.forEach((l, i) => {
    if (!l.text) errors.push(`labels[${i}]：缺少文字`);
    if (!finiteTuple(l.pos)) errors.push(`labels[${i}]：pos 不合法`);
  });
  return errors;
}
