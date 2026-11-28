// 傷害資料與可受擊目標（M1-10）。
//
// - Damageable：可受傷害的目標（M1-12 的靶標、M3 的敵人、選填的玩家自身）。
// - Hitbox：碰撞體 → 目標與部位（身體／弱點）。登記在 Physics 的 SurfaceRegistry 的 owner 欄位
//   （registerHitbox），所以物理世界重建（resetWorld）時會一併清空，不另外維護一份表。
//   受擊碰撞體要放在 CollisionGroup.ENEMY（COLLISION_PRESETS.enemy），hitscan 與投射物才打得到。
// - DamageInfo：每一筆傷害（每顆彈丸、每次範圍傷害、每次近戰各一筆），經 EventBus 的 `combat:damage` 發出。
//   payload 物件重複使用：要保存請自行複製。
import type RAPIER from '@dimforge/rapier3d-compat';
import type { Physics, Vec3Like } from '@/physics/Physics';
import type { SurfaceType } from '@/physics/SurfaceRegistry';

/** 命中部位：身體或弱點（爆頭／核心，套用 critMult）。 */
export type HitZone = 'body' | 'crit';

/** 傷害的傳遞方式。 */
export type DamageKind = 'hitscan' | 'projectile' | 'splash' | 'melee';

export interface DamageInfo {
  /** 實際傷害量（已套用距離衰減、弱點倍率、部位倍率、perk 修正）。 */
  amount: number;
  /** 是否命中弱點（爆頭）。 */
  isCrit: boolean;
  /** 命中點（世界座標）；範圍傷害為目標中心。 */
  readonly point: Vec3Like;
  /** 命中表面的法線；範圍傷害為「爆炸點 → 目標」方向的反向。 */
  readonly normal: Vec3Like;
  /** 傷害方向（單位向量：子彈飛行方向、爆炸點 → 目標、近戰揮擊方向）。 */
  readonly dir: Vec3Like;
  /** 造成傷害的一方（'player'；M3 的敵人用自己的 id）。 */
  source: string;
  /** 武器 id；近戰為 'melee'。 */
  weaponId: string;
  /** 這筆傷害是否擊殺目標（目標 applyDamage 的結果）。 */
  isKill: boolean;
  /** 受擊目標。 */
  target: Damageable | null;
  zone: HitZone;
  kind: DamageKind;
  /** 開火序號（同一次開火的所有彈丸、範圍傷害共用，M1-12 可合併傷害數字）。近戰為負值。 */
  shotId: number;
  /** 射擊起點（或爆炸點）到命中點的距離（m）。 */
  distance: number;
}

/** 目標 applyDamage 的結果。 */
export interface DamageOutcome {
  /** 實際扣掉的生命（可小於 amount，例如只剩一點血）。 */
  dealt: number;
  killed: boolean;
}

/** 可受傷害的目標。 */
export interface Damageable {
  readonly id: string;
  /** 已死亡的目標不會再被命中（hitscan 穿過、範圍傷害略過）。 */
  readonly alive: boolean;
  /** 中心點（範圍傷害距離、視線遮擋檢查、近戰鎖定用）。 */
  getCenter(out: Vec3Like): Vec3Like;
  /** 套用傷害；info 只在呼叫期間有效（物件重複使用）。 */
  applyDamage(info: Readonly<DamageInfo>): DamageOutcome;
}

/** 碰撞體對應的目標與部位。 */
export interface Hitbox {
  readonly kind: 'hitbox';
  readonly target: Damageable;
  readonly zone: HitZone;
  /** 額外的部位倍率（例如裝甲 0.5）；預設 1。 */
  readonly multiplier?: number;
}

export function isHitbox(x: unknown): x is Hitbox {
  return typeof x === 'object' && x !== null && (x as { kind?: unknown }).kind === 'hitbox';
}

export function makeHitbox(target: Damageable, zone: HitZone = 'body', multiplier = 1): Hitbox {
  return { kind: 'hitbox', target, zone, multiplier };
}

/** 把碰撞體登記成受擊範圍（owner 存 Hitbox）。回傳登記的 Hitbox。 */
export function registerHitbox(
  physics: Physics,
  collider: RAPIER.Collider,
  target: Damageable,
  zone: HitZone = 'body',
  options: { multiplier?: number; surface?: SurfaceType } = {},
): Hitbox {
  const hitbox = makeHitbox(target, zone, options.multiplier ?? 1);
  physics.surfaces.register(collider.handle, { owner: hitbox, surface: options.surface ?? 'metal' });
  return hitbox;
}

/** 查詢碰撞體的 Hitbox（沒有登記或不是受擊範圍時回傳 null）。 */
export function hitboxOf(physics: Physics, handle: number): Hitbox | null {
  const owner = physics.surfaces.get(handle)?.owner;
  return isHitbox(owner) ? owner : null;
}

export function createDamageInfo(): DamageInfo {
  return {
    amount: 0,
    isCrit: false,
    point: { x: 0, y: 0, z: 0 },
    normal: { x: 0, y: 1, z: 0 },
    dir: { x: 0, y: 0, z: -1 },
    source: 'player',
    weaponId: '',
    isKill: false,
    target: null,
    zone: 'body',
    kind: 'hitscan',
    shotId: 0,
    distance: 0,
  };
}

/** 複製一筆傷害（保存用；target 保留參考）。 */
export function copyDamageInfo(src: Readonly<DamageInfo>, dst: DamageInfo = createDamageInfo()): DamageInfo {
  dst.amount = src.amount;
  dst.isCrit = src.isCrit;
  Object.assign(dst.point, src.point);
  Object.assign(dst.normal, src.normal);
  Object.assign(dst.dir, src.dir);
  dst.source = src.source;
  dst.weaponId = src.weaponId;
  dst.isKill = src.isKill;
  dst.target = src.target;
  dst.zone = src.zone;
  dst.kind = src.kind;
  dst.shotId = src.shotId;
  dst.distance = src.distance;
  return dst;
}

/**
 * 距離衰減倍率：start 以內 1、end 以外 minMult，中間線性。
 * start ≥ end 時視為沒有衰減區間（超過 start 直接 minMult）。
 */
export function falloffMultiplier(distance: number, start: number, end: number, minMult: number): number {
  if (!(distance > start)) return 1;
  if (!(end > start) || distance >= end) return minMult;
  const t = (distance - start) / (end - start);
  return 1 + (minMult - 1) * t;
}
