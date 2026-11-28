// 單把武器的執行期狀態（M1-10）：彈藥、射擊節奏、扳機緩衝、連發、換彈、散布擴散。
//
// 與步長無關的做法：所有事件都有精確的模擬時間戳。
// - 射擊：「下一發時間」累加（nextShotTime += 60 / rpm），同一步內可以補多發；第一發的時間 = max(步開始, nextShotTime, readyTime)。
// - 扳機緩衝：按下的那一步記下「緩衝到期時間」= 步開始 + triggerBuffer；到期前任何時間可以射擊都會發射（只發一發）。
// - 換彈：開始時間、補彈點、結束時間都是時間戳；同一步內換彈結束後的剩餘時間可以繼續射擊。
// - 散布擴散：每發加 perShot，以 recoveryPerSec 線性回復（可組合，與切分無關）。
// 開鏡、切槍、近戰、衝刺轉射擊由 WeaponManager 管理，透過 WeaponStepContext.readyTime 告訴武器最早何時可以射擊。
// 後座與彈道也在 WeaponManager（shoot 回呼），武器只決定「何時、以多大散布」開火。
import { WEAPON_SYSTEM_CONFIG, type WeaponSystemConfig } from '@/weapons/WeaponConfig';
import { shotInterval, type WeaponDef } from '@/weapons/WeaponDef';
import { resolvePerks, type PerkContext, type WeaponPerkHooks } from '@/weapons/perks';
import { recoverLinear } from '@/weapons/weaponMath';

export type ReloadKind = 'tactical' | 'empty' | 'shell';
/** 換彈結束原因：done 完成；swap 切槍；sprint 手動衝刺；fire 開火中斷；melee 近戰；other 其他（例如重設）。 */
export type ReloadEndReason = 'done' | 'swap' | 'sprint' | 'fire' | 'melee' | 'other';

export interface WeaponStepContext {
  /** 步開始的模擬時間與步長（s）。 */
  t0: number;
  dt: number;
  fireHeld: boolean;
  firePressed: boolean;
  reloadPressed: boolean;
  /** 最早可以射擊的時間（衝刺轉射擊、切槍完成、近戰結束）；Infinity = 這一步不能射擊。 */
  readyTime: number;
  /** 可以開始換彈（切槍、近戰中為 false）。 */
  canReload: boolean;
  /** 這一步的基礎散布（度，已含開鏡、移動、空中）。 */
  baseSpread: number;
  /** 開火：time 為精確時間戳，spread 為這一發的散布半角（度）。 */
  shoot: (time: number, spread: number) => void;
}

/** 武器事件的接收者（WeaponManager 轉成 EventBus 事件）。 */
export interface WeaponListener {
  reloadStart?(weapon: Weapon, kind: ReloadKind, duration: number, time: number): void;
  reloadShell?(weapon: Weapon, time: number): void;
  reloadEnd?(weapon: Weapon, completed: boolean, refilled: boolean, reason: ReloadEndReason, time: number): void;
  dryFire?(weapon: Weapon, time: number): void;
}

/** 進行中的換彈。 */
export interface ReloadState {
  active: boolean;
  kind: ReloadKind;
  start: number;
  /** 預計結束時間（逐發裝填為「裝滿」的預估時間）。 */
  end: number;
  /** 彈匣式：補彈時間點。 */
  ammoPointTime: number;
  /** 彈匣式：已補彈。逐發：這次換彈至少入膛一發。 */
  refilled: boolean;
  /** 逐發：目前這一發的週期開始、入膛時間、週期結束。 */
  cycleStart: number;
  shellInsertTime: number;
  cycleEnd: number;
  shellInserted: boolean;
  shellsLoaded: number;
}

const MAX_EVENTS_PER_STEP = 4096;
/**
 * 步邊界的容差：剛好落在步結束（t1）的事件留給下一步處理。模擬時間是逐步累加的浮點數，
 * 不加容差時「第 100 發剛好在 10.000 s」會因為 1e-12 級的誤差在某些步長被算進前一步。
 */
const EDGE_EPS = 1e-7;

export class Weapon {
  private _def: WeaponDef;
  ammo: number;
  /** 備彈（無限為 Infinity）。 */
  reserve: number;
  /** 下一發最早可以射擊的時間。 */
  nextShotTime = Number.NEGATIVE_INFINITY;
  lastShotTime = Number.NEGATIVE_INFINITY;
  /** 扳機緩衝到期時間。 */
  bufferUntil = Number.NEGATIVE_INFINITY;
  /** 連發：這一輪剩下的發數與開始時間。 */
  burstLeft = 0;
  burstStart = 0;
  /** 散布擴散（度，基礎散布之上）與它的時間戳。 */
  bloom = 0;
  bloomTime = 0;
  shotsFired = 0;
  readonly reload: ReloadState = {
    active: false,
    kind: 'tactical',
    start: 0,
    end: 0,
    ammoPointTime: 0,
    refilled: false,
    cycleStart: 0,
    shellInsertTime: 0,
    cycleEnd: 0,
    shellInserted: false,
    shellsLoaded: 0,
  };
  perkHooks: WeaponPerkHooks[];
  /** 這一步是否試著開火但打不出來（空倉點擊只發一次）。 */
  private dryFiredForPress = false;
  private lastStepEnd = 0;
  private readonly perkCtx: { def: WeaponDef; ammo: number; time: number };

  constructor(
    def: WeaponDef,
    private readonly listener: WeaponListener = {},
    private readonly config: WeaponSystemConfig = WEAPON_SYSTEM_CONFIG,
  ) {
    this._def = def;
    this.ammo = def.ammo.mag;
    this.reserve = def.ammo.reserve === 'infinite' ? Number.POSITIVE_INFINITY : def.ammo.reserve;
    this.perkHooks = resolvePerks(def.perks);
    this.perkCtx = { def, ammo: this.ammo, time: 0 };
  }

  get def(): WeaponDef {
    return this._def;
  }

  /** 換成新的 WeaponDef（調參面板「重設」、M2 換裝）；彈藥夾在新彈匣內。 */
  set def(def: WeaponDef) {
    this._def = def;
    this.perkHooks = resolvePerks(def.perks);
    this.perkCtx.def = def;
    this.clampAmmo();
  }

  get id(): string {
    return this._def.id;
  }

  get reloading(): boolean {
    return this.reload.active;
  }

  get isShellReload(): boolean {
    return this._def.ammo.reloadPerShell !== undefined;
  }

  /** 換彈進度 0..1（沒有換彈時為 0）。 */
  reloadProgress(time: number): number {
    const r = this.reload;
    if (!r.active) return 0;
    const len = r.end - r.start;
    return len > 0 ? Math.min(1, Math.max(0, (time - r.start) / len)) : 1;
  }

  /** 目前的散布擴散（不改變狀態）。停火 recoveryDelay 後才回復。 */
  bloomAt(time: number): number {
    const start = Math.max(this.bloomTime, this.lastShotTime + this._def.spread.recoveryDelay);
    return recoverLinear(this.bloom, this._def.spread.recoveryPerSec, time - start);
  }

  /** 這一發會用的散布半角（度）。 */
  spreadAt(time: number, baseSpread: number): number {
    return Math.min(this._def.spread.max, baseSpread + this.bloomAt(time));
  }

  /** 彈匣上限改小時夾住彈藥（調參面板修改）。 */
  clampAmmo(): void {
    const mag = Math.max(1, Math.floor(this._def.ammo.mag));
    if (this.ammo > mag) this.ammo = mag;
    const reserve = this._def.ammo.reserve;
    if (reserve === 'infinite') this.reserve = Number.POSITIVE_INFINITY;
    else if (!Number.isFinite(this.reserve)) this.reserve = reserve;
  }

  /** 補滿彈匣（除錯、重生）。 */
  refill(): void {
    this.ammo = this._def.ammo.mag;
  }

  canStartReload(): boolean {
    return !this.reload.active && this.ammo < this._def.ammo.mag && this.reserve > 0;
  }

  /** 在 time 開始換彈（已經在換彈、彈匣已滿或沒有備彈時回傳 false）。 */
  startReload(time: number): boolean {
    if (!this.canStartReload()) return false;
    const a = this._def.ammo;
    const r = this.reload;
    const empty = this.ammo <= 0;
    r.active = true;
    r.start = time;
    r.refilled = false;
    r.shellsLoaded = 0;
    this.burstLeft = 0;
    if (a.reloadPerShell !== undefined) {
      r.kind = 'shell';
      const prep = empty ? a.reloadEmpty : a.reloadTactical;
      r.cycleStart = time + prep;
      r.cycleEnd = r.cycleStart + a.reloadPerShell;
      r.shellInsertTime = r.cycleStart + a.reloadPerShell * a.reloadAmmoPoint;
      r.shellInserted = false;
      const need = Math.min(a.mag - this.ammo, this.reserve);
      r.end = r.cycleStart + a.reloadPerShell * need;
      r.ammoPointTime = r.shellInsertTime;
    } else {
      r.kind = empty ? 'empty' : 'tactical';
      const duration = empty ? a.reloadEmpty : a.reloadTactical;
      r.end = time + duration;
      r.ammoPointTime = time + duration * a.reloadAmmoPoint;
    }
    this.listener.reloadStart?.(this, r.kind, r.end - r.start, time);
    return true;
  }

  /** 在 time 取消換彈：補彈點之前取消不補彈，之後已補彈（逐發裝填保留已入膛的彈）。 */
  cancelReload(time: number, reason: ReloadEndReason): void {
    const r = this.reload;
    if (!r.active) return;
    // 確保 time 之前的事件都處理過（同一步內取消）。
    this.advanceReload(time);
    if (!r.active) return;
    r.active = false;
    this.listener.reloadEnd?.(this, false, r.refilled, reason, time);
  }

  /**
   * 推進換彈到 t1（處理補彈與逐發入膛）。回傳結束時間（在 t1 之前或剛好在 t1 結束）；仍在換彈中回傳 Infinity。
   */
  private advanceReload(t1: number): number {
    const r = this.reload;
    if (!r.active) return Number.NEGATIVE_INFINITY;
    const a = this._def.ammo;
    if (r.kind !== 'shell') {
      if (!r.refilled && r.ammoPointTime <= t1) this.refillFromReserve(r.ammoPointTime);
      if (r.end <= t1) {
        if (!r.refilled) this.refillFromReserve(r.end);
        r.active = false;
        this.listener.reloadEnd?.(this, true, true, 'done', r.end);
        return r.end;
      }
      return Number.POSITIVE_INFINITY;
    }
    const per = a.reloadPerShell ?? 0.5;
    for (let guard = 0; guard < 1000; guard++) {
      if (!r.shellInserted && r.shellInsertTime <= t1) {
        if (this.ammo < a.mag && this.reserve > 0) {
          this.ammo++;
          if (Number.isFinite(this.reserve)) this.reserve--;
          r.shellsLoaded++;
          r.refilled = true;
          this.listener.reloadShell?.(this, r.shellInsertTime);
        }
        r.shellInserted = true;
      }
      if (r.cycleEnd > t1) return Number.POSITIVE_INFINITY;
      // 這一發的週期結束：滿了就結束，否則開始下一發。
      if (this.ammo >= a.mag || this.reserve <= 0) {
        r.active = false;
        this.firePerk('onReload', r.cycleEnd);
        this.listener.reloadEnd?.(this, true, r.refilled, 'done', r.cycleEnd);
        return r.cycleEnd;
      }
      r.cycleStart = r.cycleEnd;
      r.cycleEnd = r.cycleStart + per;
      r.shellInsertTime = r.cycleStart + per * a.reloadAmmoPoint;
      r.shellInserted = false;
    }
    return Number.POSITIVE_INFINITY;
  }

  private refillFromReserve(time: number): void {
    const a = this._def.ammo;
    const take = Math.min(a.mag - this.ammo, this.reserve);
    if (take > 0) {
      this.ammo += take;
      if (Number.isFinite(this.reserve)) this.reserve -= take;
    }
    this.reload.refilled = true;
    this.firePerk('onReload', time);
  }

  /** 扳機在 time 是否要求射擊。 */
  private wantsFire(time: number, fireHeld: boolean): boolean {
    const mode = this._def.fire.mode;
    if (mode === 'burst' && this.burstLeft > 0) return true;
    if (time <= this.bufferUntil + 1e-9) return true;
    return mode === 'auto' && fireHeld;
  }

  /** 推進一個固定步。 */
  step(ctx: WeaponStepContext): void {
    const def = this._def;
    const t0 = ctx.t0;
    const t1 = t0 + ctx.dt;
    if (ctx.firePressed) {
      this.bufferUntil = t0 + def.fire.triggerBuffer;
      this.dryFiredForPress = false;
    }
    // 換彈中按開火：逐發裝填直接中斷；彈匣式在補彈點之後可以取消剩下的動作。
    if (this.reload.active && ctx.firePressed && ctx.readyTime < t1) {
      this.advanceReload(t0);
      if (this.reload.active) {
        if (this.reload.kind === 'shell' && this.ammo > 0) this.cancelReload(t0, 'fire');
        else if (this.reload.kind !== 'shell' && this.reload.refilled && this.config.fireCancelsReloadAfterAmmoPoint) {
          this.cancelReload(t0, 'fire');
        }
      }
    }
    if (ctx.reloadPressed && ctx.canReload) this.startReload(t0);

    let t = t0;
    for (let guard = 0; guard < MAX_EVENTS_PER_STEP; guard++) {
      if (this.reload.active) {
        const end = this.advanceReload(t1);
        if (end === Number.POSITIVE_INFINITY) break;
        t = Math.max(t, end);
        continue;
      }
      // 空倉：射擊週期結束後自動換彈。
      if (this.ammo <= 0) {
        const at = Math.max(t, this.nextShotTime);
        if (this.config.autoReload && ctx.canReload && this.reserve > 0) {
          if (at < t1 - EDGE_EPS) {
            this.startReload(at);
            t = at;
            continue;
          }
          break;
        }
        if (at < t1 - EDGE_EPS && this.wantsFire(at, ctx.fireHeld) && !this.dryFiredForPress && ctx.readyTime < t1) {
          this.dryFiredForPress = true;
          this.bufferUntil = Number.NEGATIVE_INFINITY;
          this.listener.dryFire?.(this, Math.max(at, ctx.readyTime));
        }
        break;
      }
      const ts = Math.max(t, this.nextShotTime, ctx.readyTime);
      if (!(ts < t1 - EDGE_EPS)) break;
      if (!this.wantsFire(ts, ctx.fireHeld)) break;
      this.fireAt(ts, ctx);
      t = ts;
    }
    // 緩衝過期就清掉（避免很久以後的時間比較誤差）。
    if (this.bufferUntil < t1 && this.bufferUntil !== Number.NEGATIVE_INFINITY && t1 - this.bufferUntil > 1) {
      this.bufferUntil = Number.NEGATIVE_INFINITY;
    }
    this.settleBloom(t1);
    this.lastStepEnd = t1;
  }

  /** 把擴散回復結算到 time（停火 recoveryDelay 之後的部分才回復；可任意切分）。 */
  settleBloom(time: number): void {
    if (time <= this.bloomTime) return;
    this.bloom = this.bloomAt(time);
    this.bloomTime = time;
  }

  private fireAt(ts: number, ctx: WeaponStepContext): void {
    const def = this._def;
    const fire = def.fire;
    this.settleBloom(ts);
    const spread = Math.min(def.spread.max, ctx.baseSpread + this.bloom);
    this.ammo--;
    this.shotsFired++;
    this.lastShotTime = ts;
    this.bloom = Math.min(this.bloom + def.spread.perShot, def.spread.max);
    // 節奏。
    const interval = shotInterval(def);
    if (fire.mode === 'burst') {
      const inner = 60 / (fire.burstRpm ?? fire.rpm);
      if (this.burstLeft <= 0) {
        this.burstLeft = Math.max(1, Math.floor(fire.burstCount ?? 1));
        this.burstStart = ts;
        this.bufferUntil = Number.NEGATIVE_INFINITY;
      }
      this.burstLeft--;
      this.nextShotTime = this.burstLeft > 0 ? ts + inner : Math.max(ts + inner, this.burstStart + interval);
      if (this.ammo <= 0) this.burstLeft = 0;
    } else {
      // 按住全自動時 ts == nextShotTime：nextShotTime += interval，保證 RPM 與步長無關。
      this.nextShotTime = ts + interval;
      if (fire.mode !== 'auto' || ts <= this.bufferUntil) this.bufferUntil = Number.NEGATIVE_INFINITY;
    }
    this.firePerk('onFire', ts);
    ctx.shoot(ts, spread);
  }

  /** 重設到滿彈、沒有進行中的動作（重生、除錯）。 */
  reset(time: number): void {
    if (this.reload.active) this.cancelReload(time, 'other');
    this.refill();
    this.nextShotTime = Number.NEGATIVE_INFINITY;
    this.bufferUntil = Number.NEGATIVE_INFINITY;
    this.burstLeft = 0;
    this.bloom = 0;
    this.bloomTime = time;
  }

  /**
   * 錄影重播的起點（M1-15）：取消換彈並清除所有計時狀態（包含 reset() 不清的上一發時間與連發），
   * 彈藥設為指定值；結果只依參數決定。
   */
  resetForReplay(time: number, ammo: number, reserve: number): void {
    if (this.reload.active) this.cancelReload(time, 'other');
    this.reload.active = false;
    this.reload.refilled = false;
    this.reload.shellInserted = false;
    this.reload.shellsLoaded = 0;
    this.nextShotTime = Number.NEGATIVE_INFINITY;
    this.lastShotTime = Number.NEGATIVE_INFINITY;
    this.bufferUntil = Number.NEGATIVE_INFINITY;
    this.burstLeft = 0;
    this.burstStart = 0;
    this.bloom = 0;
    this.bloomTime = time;
    this.shotsFired = 0;
    this.dryFiredForPress = false;
    this.lastStepEnd = time;
    this.ammo = ammo;
    this.reserve = reserve;
    this.clampAmmo();
  }

  /** perk hook 用的唯讀狀態。 */
  perkContext(time: number): PerkContext {
    this.perkCtx.ammo = this.ammo;
    this.perkCtx.time = time;
    return this.perkCtx;
  }

  private firePerk(hook: 'onFire' | 'onReload', time: number): void {
    if (this.perkHooks.length === 0) return;
    const ctx = this.perkContext(time);
    for (const h of this.perkHooks) h[hook]?.(ctx);
  }

  /** 最後一次 step 結束的時間（除錯）。 */
  get lastStepTime(): number {
    return this.lastStepEnd;
  }
}
