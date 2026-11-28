// 命中確認（M1-12）：把玩家這一步造成的所有傷害（霰彈每顆彈丸、穿透、範圍）彙總成一個結果，
// 每個固定步最多發一次 `combat:hit`（命中標記、M1-13 的命中音效）。優先順序：擊殺 > 爆頭 > 一般命中。
// 只計入 source 為玩家、目標不是玩家自己的傷害（isPlayerHit 判定，呼叫端可換）。
import type { DamageInfo, Damageable } from '@/combat/Damage';
import type { EventBus } from '@/core/EventBus';
import type { GameEvents } from '@/core/events';
import { SystemOrder, type GameSystem } from '@/core/Game';

export type HitKind = GameEvents['combat:hit']['kind'];

/** 命中種類：擊殺 > 爆頭 > 一般。 */
export function hitKindOf(info: Readonly<Pick<DamageInfo, 'isKill' | 'isCrit'>>): HitKind {
  return info.isKill ? 'kill' : info.isCrit ? 'crit' : 'hit';
}

const RANK: Record<HitKind, number> = { hit: 0, crit: 1, kill: 2 };

/** 兩個命中種類中優先的一個。 */
export function strongerHit(a: HitKind, b: HitKind): HitKind {
  return RANK[b] > RANK[a] ? b : a;
}

export class HitConfirm {
  private readonly summary: GameEvents['combat:hit'] = { kind: 'hit', hits: 0, crits: 0, kills: 0, amount: 0, weaponId: '' };
  private pending = false;

  add(info: Readonly<DamageInfo>): void {
    const s = this.summary;
    if (!this.pending) {
      s.kind = 'hit';
      s.hits = 0;
      s.crits = 0;
      s.kills = 0;
      s.amount = 0;
      s.weaponId = '';
      this.pending = true;
    }
    s.hits++;
    if (info.isCrit) s.crits++;
    if (info.isKill) s.kills++;
    s.amount += info.amount;
    s.kind = strongerHit(s.kind, hitKindOf(info));
    s.weaponId = info.weaponId;
  }

  get hasPending(): boolean {
    return this.pending;
  }

  /** 取出這一步的彙總（沒有命中時 null；回傳的物件重複使用）。 */
  flush(): Readonly<GameEvents['combat:hit']> | null {
    if (!this.pending) return null;
    this.pending = false;
    return this.summary;
  }
}

export interface HitConfirmSystemOptions {
  bus: EventBus<GameEvents>;
  /** 玩家自己（自傷不算命中）。 */
  getSelf?: () => Damageable | null;
}

/** Game 系統（order combat）：訂閱 `combat:damage`，每個固定步結束前發出 `combat:hit`。 */
export class HitConfirmSystem implements GameSystem {
  readonly name = 'hitConfirm';
  readonly order = SystemOrder.combat;
  readonly confirm = new HitConfirm();
  private readonly off: () => void;

  constructor(private readonly options: HitConfirmSystemOptions) {
    this.off = options.bus.on('combat:damage', (info) => {
      if (isPlayerHit(info, options.getSelf?.() ?? null)) this.confirm.add(info);
    });
  }

  fixedUpdate(): void {
    this.flush();
  }

  /** 立即發出（無頭測試、非 playing 模式下的傷害）。 */
  flush(): void {
    const s = this.confirm.flush();
    if (s) this.options.bus.emit('combat:hit', s);
  }

  dispose(): void {
    this.off();
  }
}

/** 玩家造成、打在別的目標身上的傷害。 */
export function isPlayerHit(info: Readonly<DamageInfo>, self: Damageable | null): boolean {
  return info.source === 'player' && info.target !== null && info.target !== self;
}
