// perk hook 介面（M1-10 只保留介面；M2-02 的行為詞綴在這裡註冊實作）。
// WeaponDef.perks 是資料（id + 參數）；registerPerk(id, factory) 提供實作，Weapon 在設定 WeaponDef 時解析。
// 沒有註冊的 id 會被忽略（只警告一次），所以存檔裡較新版本的 perk 不會讓舊版本壞掉。
import type { DamageInfo } from '@/combat/Damage';
import type { WeaponDef, WeaponPerkRef } from '@/weapons/WeaponDef';

/** hook 呼叫時的武器狀態（唯讀）。 */
export interface PerkContext {
  readonly def: Readonly<WeaponDef>;
  readonly ammo: number;
  readonly time: number;
}

export interface WeaponPerkHooks {
  /** 每次開火（扣彈後）。 */
  onFire?(ctx: PerkContext): void;
  /** 傷害套用到目標前：回傳修正後的傷害量。 */
  modifyDamage?(ctx: PerkContext, info: Readonly<DamageInfo>): number;
  /** 傷害套用後（info.isKill 已決定）。 */
  onHit?(ctx: PerkContext, info: Readonly<DamageInfo>): void;
  /** 換彈完成（彈匣補滿時）。 */
  onReload?(ctx: PerkContext): void;
}

export type PerkFactory = (params: Readonly<Record<string, number>>) => WeaponPerkHooks;

const registry = new Map<string, PerkFactory>();
const warned = new Set<string>();

/** 註冊 perk 實作；回傳取消註冊的函式。 */
export function registerPerk(id: string, factory: PerkFactory): () => void {
  registry.set(id, factory);
  return () => {
    if (registry.get(id) === factory) registry.delete(id);
  };
}

/** 把 perk 參照解析成 hook 清單（未註冊的 id 略過）。 */
export function resolvePerks(refs: readonly WeaponPerkRef[]): WeaponPerkHooks[] {
  const out: WeaponPerkHooks[] = [];
  for (const ref of refs) {
    const factory = registry.get(ref.id);
    if (!factory) {
      if (!warned.has(ref.id)) {
        warned.add(ref.id);
        console.warn(`[shardwake] 未知的武器 perk「${ref.id}」，已略過`);
      }
      continue;
    }
    out.push(factory(ref.params ?? {}));
  }
  return out;
}
