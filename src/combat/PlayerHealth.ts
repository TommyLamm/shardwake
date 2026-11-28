// 玩家生命與護盾（M1-12）：Damageable 實作（敵方投射物、自傷都打在這裡）、回復、死亡與重生流程。
//
// - 傷害先扣護盾，溢出的部分扣生命（同一筆可以同時打破護盾並扣血）。
// - 護盾：最後一次受傷 shieldRegenDelay 秒後，以每秒 shieldRegenRate 回復。生命：healthRegenDelay 秒後以 healthRegenRate 慢速回復（原型）。
// - 生命歸零 → 死亡（dying）：deathFadeTime 秒淡出後呼叫 onRespawn（呼叫端負責傳送到出生點），護盾與生命回滿、發出 `player:revived`，
//   之後 reviveFadeTime 秒淡入。死亡中不再受傷。
// - 無敵模式（config.invulnerable，調參面板）：照常發出 `player:damaged`（blocked = true，受擊方向指示仍會出現），不扣護盾與生命。
// - 模擬以固定步推進（Game 系統 order combat）；所有數值在 PLAYER_HEALTH_CONFIG，調參面板「戰鬥/玩家」可調。
import { damageSourcePosition, type DamageInfo, type DamageOutcome, type Damageable } from '@/combat/Damage';
import type { EventBus } from '@/core/EventBus';
import type { GameEvents } from '@/core/events';
import { SystemOrder, type GameSystem } from '@/core/Game';
import type { ConfigSchema } from '@/debug/DebugPanel';
import type { Vec3Like } from '@/physics/Physics';

export type RespawnMode = 'spawn' | 'checkpoint';

export interface PlayerHealthConfig {
  maxShield: number;
  maxHealth: number;
  /** 最後一次受傷後多久開始回復護盾（s）與回復速度（每秒）。 */
  shieldRegenDelay: number;
  shieldRegenRate: number;
  /** 最後一次受傷後多久開始回復生命（s）與回復速度（每秒；原型中慢速回復，0 = 不回復）。 */
  healthRegenDelay: number;
  healthRegenRate: number;
  /** 死亡淡出時間（s；結束時重生）與重生後淡入時間（s）。 */
  deathFadeTime: number;
  reviveFadeTime: number;
  /** 重生位置：出生點或最近的檢查點（main.ts 的 onRespawn 讀取）。 */
  respawnAt: RespawnMode;
  /** 無敵模式（調參面板）：照常顯示受擊回饋，不扣護盾與生命。 */
  invulnerable: boolean;
}

export const PLAYER_HEALTH_CONFIG: PlayerHealthConfig = {
  maxShield: 100,
  maxHealth: 100,
  shieldRegenDelay: 3,
  shieldRegenRate: 40,
  healthRegenDelay: 5,
  healthRegenRate: 6,
  deathFadeTime: 0.8,
  reviveFadeTime: 0.45,
  respawnAt: 'spawn',
  invulnerable: false,
};

export function defaultPlayerHealthConfig(): PlayerHealthConfig {
  return { ...PLAYER_HEALTH_CONFIG };
}

export const PLAYER_HEALTH_PANEL: ConfigSchema<PlayerHealthConfig> = {
  invulnerable: { label: '無敵模式', description: '受擊回饋照常顯示，不扣護盾與生命' },
  maxShield: { label: '護盾上限', min: 0, max: 500, step: 5 },
  maxHealth: { label: '生命上限', min: 1, max: 500, step: 5 },
  shieldRegenDelay: { label: '護盾回復延遲 s', min: 0, max: 10, step: 0.1 },
  shieldRegenRate: { label: '護盾回復 /s', min: 0, max: 200, step: 1 },
  healthRegenDelay: { label: '生命回復延遲 s', min: 0, max: 20, step: 0.1 },
  healthRegenRate: { label: '生命回復 /s', min: 0, max: 100, step: 0.5, description: '原型中慢速回復；0 = 不回復' },
  deathFadeTime: { label: '死亡淡出 s', min: 0.05, max: 3, step: 0.05 },
  reviveFadeTime: { label: '重生淡入 s', min: 0, max: 3, step: 0.05 },
  respawnAt: { label: '重生位置', options: { 出生點: 'spawn', 最近檢查點: 'checkpoint' } },
};

export interface PlayerHealthState {
  shield: number;
  health: number;
  maxShield: number;
  maxHealth: number;
  alive: boolean;
  /** 死亡中（淡出）。 */
  dying: boolean;
  /** 距離最後一次受傷的時間（s；沒有受過傷時為很大的值 NEVER）。 */
  sinceDamage: number;
  /** 護盾回復中。 */
  shieldRecharging: boolean;
  /** 畫面淡出量 0..1（死亡淡出、重生淡入；UI 使用）。 */
  fade: number;
  /** 累計死亡次數。 */
  deaths: number;
  /** 模擬時間（s）。 */
  time: number;
}

export interface PlayerHealthOptions {
  bus?: EventBus<GameEvents> | undefined;
  config?: PlayerHealthConfig;
  /** 玩家中心（範圍傷害距離、近戰）；沒有玩家時回傳 null。 */
  getCenter?: (out: Vec3Like) => Vec3Like | null;
  /** 死亡淡出結束時呼叫（傳送到出生點、清掉投射物等）。 */
  onRespawn?: () => void;
}

const v3 = (): Vec3Like => ({ x: 0, y: 0, z: 0 });
/** 「沒有受過傷」的 sinceDamage（有限值，避免 Infinity − Infinity）。 */
export const NEVER = 1e6;

export class PlayerHealth implements Damageable, GameSystem {
  readonly name = 'playerHealth';
  readonly order = SystemOrder.combat;
  readonly id = 'player';
  readonly config: PlayerHealthConfig;
  readonly state: PlayerHealthState;
  private reviveTimer = Infinity;
  private deathTimer = 0;
  private readonly evDamaged: GameEvents['player:damaged'];
  private readonly evDied: GameEvents['player:died'] = { source: '', weaponId: '', deaths: 0 };
  private readonly evRevived: GameEvents['player:revived'] = { deaths: 0 };
  private readonly evShield: GameEvents['player:shield'] = { phase: 'recharge', shield: 0 };

  constructor(private readonly options: PlayerHealthOptions = {}) {
    this.config = options.config ?? PLAYER_HEALTH_CONFIG;
    const c = this.config;
    this.state = {
      shield: c.maxShield,
      health: c.maxHealth,
      maxShield: c.maxShield,
      maxHealth: c.maxHealth,
      alive: true,
      dying: false,
      sinceDamage: NEVER,
      shieldRecharging: false,
      fade: 0,
      deaths: 0,
      time: 0,
    };
    this.evDamaged = {
      amount: 0,
      shieldDamage: 0,
      healthDamage: 0,
      shield: 0,
      health: 0,
      shieldBroken: false,
      blocked: false,
      dir: v3(),
      sourcePos: v3(),
      source: '',
      weaponId: '',
    };
  }

  get alive(): boolean {
    return this.state.alive;
  }

  /** 生命比例 0..1（低生命暗角用）。 */
  get healthFraction(): number {
    const s = this.state;
    return s.maxHealth > 0 ? Math.max(0, Math.min(1, s.health / s.maxHealth)) : 0;
  }

  get shieldFraction(): number {
    const s = this.state;
    return s.maxShield > 0 ? Math.max(0, Math.min(1, s.shield / s.maxShield)) : 0;
  }

  getCenter(out: Vec3Like): Vec3Like {
    const c = this.options.getCenter?.(out) ?? null;
    if (!c) {
      out.x = 0;
      out.y = 0;
      out.z = 0;
    }
    return out;
  }

  /** 套用一筆傷害（info 只在呼叫期間有效）。 */
  applyDamage(info: Readonly<DamageInfo>): DamageOutcome {
    const s = this.state;
    if (!s.alive) return { dealt: 0, killed: false };
    const amount = Math.max(0, info.amount);
    if (!(amount > 0)) return { dealt: 0, killed: false };
    const c = this.config;
    const ev = this.evDamaged;
    ev.amount = amount;
    ev.blocked = c.invulnerable;
    ev.shieldBroken = false;
    ev.shieldDamage = 0;
    ev.healthDamage = 0;
    if (!c.invulnerable) {
      const shieldBefore = s.shield;
      const toShield = Math.min(s.shield, amount);
      s.shield -= toShield;
      const toHealth = Math.min(s.health, amount - toShield);
      s.health -= toHealth;
      ev.shieldDamage = toShield;
      ev.healthDamage = toHealth;
      ev.shieldBroken = shieldBefore > 0 && s.shield <= 0;
      if (s.shield < 1e-9) s.shield = 0;
      if (s.health < 1e-9) s.health = 0;
      s.sinceDamage = 0;
      s.shieldRecharging = false;
    }
    ev.shield = s.shield;
    ev.health = s.health;
    copy(ev.dir, info.dir);
    damageSourcePosition(info, ev.sourcePos);
    ev.source = info.source;
    ev.weaponId = info.weaponId;
    this.options.bus?.emit('player:damaged', ev);
    const killed = !c.invulnerable && s.health <= 0;
    if (killed) this.die(info.source, info.weaponId);
    return { dealt: ev.shieldDamage + ev.healthDamage, killed };
  }

  /** 立即死亡（調參面板測試、M3 的即死陷阱）。 */
  kill(source = 'debug', weaponId = ''): void {
    if (!this.state.alive) return;
    this.state.shield = 0;
    this.state.health = 0;
    this.die(source, weaponId);
  }

  /** 護盾與生命回滿（不改變存活狀態；死亡中呼叫無效）。 */
  refill(): void {
    const s = this.state;
    if (!s.alive) return;
    this.syncMax();
    s.shield = s.maxShield;
    s.health = s.maxHealth;
    s.shieldRecharging = false;
  }

  /** 完全重設（換關卡）：存活、回滿、沒有淡出。 */
  reset(): void {
    const s = this.state;
    this.syncMax();
    s.alive = true;
    s.dying = false;
    s.shield = s.maxShield;
    s.health = s.maxHealth;
    s.sinceDamage = NEVER;
    s.shieldRecharging = false;
    s.fade = 0;
    this.deathTimer = 0;
    this.reviveTimer = Infinity;
  }

  fixedUpdate(dt: number): void {
    this.step(dt);
  }

  /** 推進一個固定步（無頭測試直接呼叫）。 */
  step(dt: number): void {
    if (!(dt > 0)) return;
    const s = this.state;
    const c = this.config;
    s.time += dt;
    this.syncMax();
    if (s.dying) {
      this.deathTimer += dt;
      s.fade = c.deathFadeTime > 0 ? Math.min(1, this.deathTimer / c.deathFadeTime) : 1;
      if (this.deathTimer >= c.deathFadeTime) this.revive();
      return;
    }
    if (this.reviveTimer < Infinity) {
      this.reviveTimer += dt;
      s.fade = c.reviveFadeTime > 0 ? Math.max(0, 1 - this.reviveTimer / c.reviveFadeTime) : 0;
      if (s.fade <= 0) this.reviveTimer = Infinity;
    }
    const before = s.sinceDamage;
    s.sinceDamage += dt;
    // 回復從延遲到期的那一刻起算（與步長無關）。
    if (s.shield < s.maxShield && c.shieldRegenRate > 0) {
      const active = Math.max(0, s.sinceDamage - Math.max(before, c.shieldRegenDelay));
      if (s.sinceDamage >= c.shieldRegenDelay && !s.shieldRecharging) {
        s.shieldRecharging = true;
        this.evShield.phase = 'recharge';
        this.evShield.shield = s.shield;
        this.options.bus?.emit('player:shield', this.evShield);
      }
      if (active > 0) {
        s.shield = Math.min(s.maxShield, s.shield + c.shieldRegenRate * active);
        if (s.shield >= s.maxShield) {
          s.shieldRecharging = false;
          this.evShield.phase = 'full';
          this.evShield.shield = s.shield;
          this.options.bus?.emit('player:shield', this.evShield);
        }
      }
    }
    if (s.health < s.maxHealth && c.healthRegenRate > 0) {
      const active = Math.max(0, s.sinceDamage - Math.max(before, c.healthRegenDelay));
      if (active > 0) s.health = Math.min(s.maxHealth, s.health + c.healthRegenRate * active);
    }
  }

  private syncMax(): void {
    const s = this.state;
    const c = this.config;
    s.maxShield = Math.max(0, c.maxShield);
    s.maxHealth = Math.max(1, c.maxHealth);
    if (s.shield > s.maxShield) s.shield = s.maxShield;
    if (s.health > s.maxHealth) s.health = s.maxHealth;
  }

  private die(source: string, weaponId: string): void {
    const s = this.state;
    s.alive = false;
    s.dying = true;
    s.shieldRecharging = false;
    s.deaths++;
    this.deathTimer = 0;
    this.reviveTimer = Infinity;
    const ev = this.evDied;
    ev.source = source;
    ev.weaponId = weaponId;
    ev.deaths = s.deaths;
    this.options.bus?.emit('player:died', ev);
  }

  private revive(): void {
    const s = this.state;
    s.dying = false;
    s.alive = true;
    this.syncMax();
    s.shield = s.maxShield;
    s.health = s.maxHealth;
    s.sinceDamage = NEVER;
    s.fade = 1;
    this.deathTimer = 0;
    this.reviveTimer = 0;
    this.options.onRespawn?.();
    this.evRevived.deaths = s.deaths;
    this.options.bus?.emit('player:revived', this.evRevived);
  }
}

function copy(dst: Vec3Like, src: Readonly<Vec3Like>): void {
  dst.x = src.x;
  dst.y = src.y;
  dst.z = src.z;
}
