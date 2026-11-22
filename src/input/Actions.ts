// 動作清單：遊戲邏輯只認動作，不認按鍵。每個動作對應 InputFrame 位元遮罩中的一個位元
// （ACTION_BIT），陣列順序就是位元順序：只能在尾端新增，不可重排或刪除（錄影與存檔依賴位元位置）。
// 目前 27 個動作；位元遮罩是 32 位元整數，超過 32 個動作時需改成兩個字（M5 之前不會發生）。

export const ACTIONS = [
  // 移動
  'moveForward',
  'moveBack',
  'moveLeft',
  'moveRight',
  'jump',
  'crouch',
  /** 只在手動衝刺模式（設定 autoSprint = false）使用；預設沒有綁定。 */
  'sprint',
  'dash',
  'grapple',
  // 戰鬥
  'fire',
  'ads',
  'reload',
  'melee',
  'interact',
  // 武器切換
  'weapon1',
  'weapon2',
  'weapon3',
  'weapon4',
  'weapon5',
  'weaponNext',
  'weaponPrev',
  'weaponLast',
  // 系統與開發用
  'pause',
  'debugPanel',
  'recordToggle',
  'replayToggle',
  'restartCourse',
] as const;

export type Action = (typeof ACTIONS)[number];

export type ActionCategory = 'move' | 'combat' | 'weapon' | 'system' | 'dev';

export interface ActionInfo {
  /** 顯示名稱（繁體中文，給 HUD 提示與按鍵設定頁）。 */
  label: string;
  category: ActionCategory;
  /**
   * 即時動作：在按下的當下由事件直接派送（任何模式都有效，例如標題或暫停中開調參面板），
   * 不必等到下一個固定步。仍會出現在 InputFrame 的位元中。
   */
  immediate?: boolean;
  /** 可選「按住／切換」模式（蹲、開鏡、抓鉤）；在 InputFrame 這一層轉換。 */
  toggleable?: boolean;
}

export const ACTION_INFO: Readonly<Record<Action, ActionInfo>> = {
  moveForward: { label: '前進', category: 'move' },
  moveBack: { label: '後退', category: 'move' },
  moveLeft: { label: '左移', category: 'move' },
  moveRight: { label: '右移', category: 'move' },
  jump: { label: '跳躍／噴射', category: 'move' },
  crouch: { label: '蹲下／滑鏟', category: 'move', toggleable: true },
  sprint: { label: '衝刺（手動模式）', category: 'move' },
  dash: { label: 'Dash', category: 'move' },
  grapple: { label: '抓鉤', category: 'move', toggleable: true },
  fire: { label: '射擊', category: 'combat' },
  ads: { label: '開鏡', category: 'combat', toggleable: true },
  reload: { label: '換彈', category: 'combat' },
  melee: { label: '近戰', category: 'combat' },
  interact: { label: '互動', category: 'combat' },
  weapon1: { label: '武器 1', category: 'weapon' },
  weapon2: { label: '武器 2', category: 'weapon' },
  weapon3: { label: '武器 3', category: 'weapon' },
  weapon4: { label: '武器 4', category: 'weapon' },
  weapon5: { label: '武器 5', category: 'weapon' },
  weaponNext: { label: '下一把武器', category: 'weapon' },
  weaponPrev: { label: '上一把武器', category: 'weapon' },
  weaponLast: { label: '切回前一把', category: 'weapon' },
  pause: { label: '暫停', category: 'system', immediate: true },
  debugPanel: { label: '調參面板', category: 'dev', immediate: true },
  recordToggle: { label: '錄製輸入', category: 'dev', immediate: true },
  replayToggle: { label: '重播輸入', category: 'dev', immediate: true },
  restartCourse: { label: '重來計時賽', category: 'system' },
};

/** 可切換「按住／切換」的動作。 */
export type ToggleableAction = 'crouch' | 'ads' | 'grapple';
export const TOGGLEABLE_ACTIONS: readonly ToggleableAction[] = ['crouch', 'ads', 'grapple'];

export type HoldMode = 'hold' | 'toggle';

export const ACTION_INDEX: Readonly<Record<Action, number>> = Object.fromEntries(
  ACTIONS.map((a, i) => [a, i]),
) as Record<Action, number>;

/** 每個動作在位元遮罩中的位元（1 << index）。 */
export const ACTION_BIT: Readonly<Record<Action, number>> = Object.fromEntries(
  ACTIONS.map((a, i) => [a, (1 << i) >>> 0]),
) as Record<Action, number>;

export function isAction(x: unknown): x is Action {
  return typeof x === 'string' && Object.hasOwn(ACTION_INDEX, x);
}

/** 位元遮罩轉成動作名稱清單（除錯顯示、測試用；會配置陣列，不要在熱迴圈使用）。 */
export function actionsInMask(mask: number): Action[] {
  const out: Action[] = [];
  for (let i = 0; i < ACTIONS.length; i++) if ((mask >>> i) & 1) out.push(ACTIONS[i]!);
  return out;
}

/** 動作清單轉成位元遮罩。 */
export function maskOf(...actions: readonly Action[]): number {
  let m = 0;
  for (const a of actions) m = (m | ACTION_BIT[a]) >>> 0;
  return m;
}
