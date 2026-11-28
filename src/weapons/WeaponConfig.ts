// 武器系統的共用參數（不屬於單把武器的數值）：近戰、射程、散布參考速度、換彈與開鏡規則、投射物池。
// 單把武器的數值在 WeaponDef（archetypes.ts）；兩者都可在調參面板「武器」調整。
import type { ConfigSchema } from '@/debug/DebugPanel';

export interface WeaponSystemConfig {
  // ── 近戰（V）──
  meleeDamage: number;
  /** 偵測範圍（m）：眼睛前方的球形範圍。 */
  meleeRange: number;
  /** 錐形半角（度）。 */
  meleeConeDeg: number;
  /** 冷卻（s，從出手算起）。 */
  meleeCooldown: number;
  /** 出手到判定命中的時間（s）。 */
  meleeHitTime: number;
  /** 整個近戰動作時間（s；這段時間內不能射擊、開鏡）。 */
  meleeDuration: number;
  /** 目標距離超過此值才突進吸附（m）。 */
  meleeLungeMinDist: number;
  /** 突進速度（m/s，水平）。 */
  meleeLungeSpeed: number;
  /** 突進到距離目標這麼近就停（m）。 */
  meleeLungeStopDist: number;
  /** 命中判定時允許的額外距離（m；突進後目標仍在範圍外一點點也算命中）。 */
  meleeHitTolerance: number;
  // ── 射擊 ──
  /** hitscan 最大射程（m）。 */
  hitscanRange: number;
  /** 散布的移動倍率在這個水平速度時達到滿值（m/s，約為跑速）。 */
  spreadMoveRefSpeed: number;
  /** 投射物池大小（同時存在的上限，超過時回收最舊的）。 */
  projectilePoolSize: number;
  /** 爆炸點沿表面法線抬起的距離（m；視線檢查不會被爆炸所在的牆面擋住）。 */
  explosionLift: number;
  // ── 規則 ──
  /** 彈匣打空時自動換彈。 */
  autoReload: boolean;
  /** 換彈已過補彈點後按開火：取消剩下的動作直接射擊。 */
  fireCancelsReloadAfterAmmoPoint: boolean;
  /** 手動衝刺模式按下衝刺鍵時取消換彈（自動衝刺不取消，見實作紀錄）。 */
  sprintCancelsReload: boolean;
  /** 壓槍吸收：玩家朝後座反方向轉動的量先抵掉後座偏移，回正只回正剩下的部分。 */
  recoilCompensation: boolean;
  /** 開鏡過渡的平滑（0 = 線性；1 = smoothstep）。只影響 FOV 縮放與靈敏度換算，不影響散布內插。 */
  adsZoomEase: number;
}

export const WEAPON_SYSTEM_CONFIG: WeaponSystemConfig = {
  meleeDamage: 55,
  meleeRange: 3.5,
  meleeConeDeg: 35,
  meleeCooldown: 0.6,
  meleeHitTime: 0.12,
  meleeDuration: 0.4,
  meleeLungeMinDist: 1.4,
  meleeLungeSpeed: 14,
  meleeLungeStopDist: 1.1,
  meleeHitTolerance: 0.5,
  hitscanRange: 500,
  spreadMoveRefSpeed: 7.5,
  projectilePoolSize: 32,
  explosionLift: 0.05,
  autoReload: true,
  fireCancelsReloadAfterAmmoPoint: true,
  sprintCancelsReload: true,
  recoilCompensation: true,
  adsZoomEase: 1,
};

export function defaultWeaponSystemConfig(): WeaponSystemConfig {
  return { ...WEAPON_SYSTEM_CONFIG };
}

export const WEAPON_SYSTEM_PANEL: readonly { folder: string; schema: ConfigSchema<WeaponSystemConfig> }[] = [
  {
    folder: '武器/系統：近戰',
    schema: {
      meleeDamage: { label: '傷害', min: 0, max: 500, step: 1 },
      meleeRange: { label: '範圍 m', min: 0.5, max: 8, step: 0.1 },
      meleeConeDeg: { label: '錐形半角°', min: 5, max: 90, step: 1 },
      meleeCooldown: { label: '冷卻 s', min: 0, max: 3, step: 0.05 },
      meleeHitTime: { label: '命中判定 s', min: 0, max: 1, step: 0.01 },
      meleeDuration: { label: '動作時間 s', min: 0.05, max: 2, step: 0.01 },
      meleeLungeMinDist: { label: '突進門檻 m', min: 0, max: 8, step: 0.1 },
      meleeLungeSpeed: { label: '突進速度 m/s', min: 0, max: 40, step: 0.5 },
      meleeLungeStopDist: { label: '突進停止 m', min: 0, max: 4, step: 0.05 },
      meleeHitTolerance: { label: '命中容差 m', min: 0, max: 2, step: 0.05 },
    },
  },
  {
    folder: '武器/系統：射擊與規則',
    schema: {
      hitscanRange: { label: 'hitscan 射程 m', min: 10, max: 2000, step: 10 },
      spreadMoveRefSpeed: { label: '散布移動參考速度', min: 0.5, max: 20, step: 0.1, description: 'm/s；達到此速度時套用滿額 moveMult' },
      explosionLift: { label: '爆炸點抬起 m', min: 0, max: 0.5, step: 0.01 },
      autoReload: { label: '空倉自動換彈' },
      fireCancelsReloadAfterAmmoPoint: { label: '補彈後開火取消換彈' },
      sprintCancelsReload: { label: '手動衝刺取消換彈', description: '只在手動衝刺模式按下衝刺鍵時取消；自動衝刺不取消' },
      recoilCompensation: { label: '壓槍吸收後座', description: '玩家朝反方向轉動時先抵掉後座偏移，回正不會把壓槍的量再拉回去' },
      adsZoomEase: { label: '開鏡縮放平滑', min: 0, max: 1, step: 0.05 },
    },
  },
];
