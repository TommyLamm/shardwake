// 碰撞群組（Rapier InteractionGroups：高 16 位元 = 所屬群組 membership，低 16 位元 = 會與哪些群組互動 filter）。
// 兩個碰撞體互動的條件：a 的 membership ∩ b 的 filter ≠ ∅，且 b 的 membership ∩ a 的 filter ≠ ∅。
// 位元只能在尾端新增（存檔／錄影不依賴，但後續計畫的資料表會引用名稱）。
export const CollisionGroup = {
  /** 靜態關卡幾何（地板、牆、平台）。 */
  WORLD: 1 << 0,
  /** 玩家膠囊（M1-05）。 */
  PLAYER: 1 << 1,
  /** 敵人（M3）。 */
  ENEMY: 1 << 2,
  /** 投射物（M1-10）。 */
  PROJECTILE: 1 << 3,
  /** 觸發區（sensor）：檢查點、區域、拾取範圍。 */
  TRIGGER: 1 << 4,
  /** 碎片、彈殼等動態小物件（只和世界碰撞）。 */
  DEBRIS: 1 << 5,
  /** 掉落物（M2-03）。 */
  LOOT: 1 << 6,
} as const;

export type CollisionGroupName = keyof typeof CollisionGroup;

/** 全部 16 個群組位元。 */
export const ALL_GROUPS = 0xffff;

/** 由群組名稱或位元組出遮罩。 */
export function groupMask(...groups: (CollisionGroupName | number)[]): number {
  let mask = 0;
  for (const g of groups) mask |= typeof g === 'number' ? g : CollisionGroup[g];
  return mask & ALL_GROUPS;
}

/** 產生 Rapier interaction groups（無號 32 位元整數）。 */
export function interactionGroups(membership: number, filter: number = ALL_GROUPS): number {
  return (((membership & ALL_GROUPS) << 16) | (filter & ALL_GROUPS)) >>> 0;
}

/** 拆回 membership／filter（除錯顯示與測試用）。 */
export function splitInteractionGroups(groups: number): { membership: number; filter: number } {
  return { membership: (groups >>> 16) & ALL_GROUPS, filter: groups & ALL_GROUPS };
}

/** 兩組 interaction groups 是否會互動（與 Rapier 的規則相同）。 */
export function groupsInteract(a: number, b: number): boolean {
  return ((a >>> 16) & b & ALL_GROUPS) !== 0 && ((b >>> 16) & a & ALL_GROUPS) !== 0;
}

/**
 * 查詢（raycast／shapeCast／overlap）用的 groups：membership 設為全部，讓碰撞體自己的 filter 不會擋掉查詢，
 * 只用 mask 決定要命中哪些群組。
 */
export function queryGroups(mask: number): number {
  return interactionGroups(ALL_GROUPS, mask);
}

/** 各類碰撞體的預設 interaction groups。 */
export const COLLISION_PRESETS = {
  world: interactionGroups(CollisionGroup.WORLD, ALL_GROUPS),
  player: interactionGroups(
    CollisionGroup.PLAYER,
    CollisionGroup.WORLD | CollisionGroup.ENEMY | CollisionGroup.TRIGGER | CollisionGroup.LOOT,
  ),
  enemy: interactionGroups(
    CollisionGroup.ENEMY,
    CollisionGroup.WORLD | CollisionGroup.PLAYER | CollisionGroup.ENEMY | CollisionGroup.PROJECTILE,
  ),
  projectile: interactionGroups(CollisionGroup.PROJECTILE, CollisionGroup.WORLD | CollisionGroup.ENEMY),
  trigger: interactionGroups(CollisionGroup.TRIGGER, CollisionGroup.PLAYER),
  debris: interactionGroups(CollisionGroup.DEBRIS, CollisionGroup.WORLD),
  loot: interactionGroups(CollisionGroup.LOOT, CollisionGroup.WORLD | CollisionGroup.PLAYER),
} as const;

/** 常用的查詢遮罩。 */
export const QueryMask = {
  /** 只查靜態世界（地面探測、跑牆、抓鉤、攀爬）。 */
  world: CollisionGroup.WORLD,
  /** 會擋住視線／子彈的東西。 */
  hitscan: CollisionGroup.WORLD | CollisionGroup.ENEMY,
  /** 玩家移動會撞到的東西。 */
  playerMove: CollisionGroup.WORLD | CollisionGroup.ENEMY,
  all: ALL_GROUPS,
} as const;
