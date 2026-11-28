// 武器管理（M1-10，Game 系統 order = weapons，在玩家之後、物理之前）：
// 5 個欄位（1–5）、滾輪循環、Q 切回上一把；切槍時間 = 舊槍 swapOut ＋ 新槍 swapIn；開鏡；近戰（V）；
// 衝刺轉射擊（自動衝刺時按開火，先在 sprintToFire 內退出衝刺）；後座偏移與回正；開火時呼叫 Ballistics。
//
// 每個固定步（step）：
//   1. 壓槍吸收：玩家這一步的視角變化先抵掉後座偏移（RecoilState.absorb），轉進玩家視角（畫面不跳）。
//   2. 讀輸入：開火、開鏡、換彈、近戰、切槍（1–5、滾輪、Q）、手動衝刺鍵。
//   3. 切槍、近戰（突進吸附、命中判定）、開鏡進度、投射物推進。
//   4. 目前武器 step：射擊時間戳、換彈、散布；每發 shoot() → 後座回正到該時間 → 沿「視線＋後座＋散布」射擊 → 加後座。
//   5. 後座回正到步結束，寫入 view.setOffset（最終視角 viewYaw／viewPitch = 玩家視角 + 偏移）。
// 渲染（render）：開鏡進度插值 → CameraRig.fovZoom（FOV 縮放）與 mouse.scale（開鏡靈敏度：焦距換算 × 使用者倍率）。
//
// 武器的狀態（HUD 讀 state）：idle／firing／reloading／swapping／meleeing。
import * as THREE from 'three';
import type { Hitbox } from '@/combat/Damage';
import type { EventBus } from '@/core/EventBus';
import type { GameEvents } from '@/core/events';
import { SystemOrder, type GameSystem } from '@/core/Game';
import { DEG2RAD, RAD2DEG, clamp, clamp01, lerp, moveTowards, wrapAngle } from '@/core/math';
import { Rng } from '@/core/Rng';
import type { HoldToggle } from '@/core/Settings';
import { isHeld, wasPressed, type InputFrame } from '@/input/InputFrame';
import type { Vec3Like } from '@/physics/Physics';
import { defaultLoadout } from '@/weapons/archetypes';
import type { Ballistics, ShotContext } from '@/weapons/Ballistics';
import { Weapon, type ReloadEndReason, type ReloadKind, type WeaponListener } from '@/weapons/Weapon';
import { WEAPON_SYSTEM_CONFIG, type WeaponSystemConfig } from '@/weapons/WeaponConfig';
import { adsSensitivityRatio, shotInterval, zoomedFov, type WeaponDef } from '@/weapons/WeaponDef';
import { RecoilState, adsEase, aimDirection, baseSpread, sampleSpreadOffset } from '@/weapons/weaponMath';

export const WEAPON_SLOTS = 5;

export type WeaponPhase = 'idle' | 'firing' | 'reloading' | 'swapping' | 'meleeing';

/** 武器系統需要的玩家介面（PlayerController 符合）。 */
export interface WeaponPlayer {
  /** 這一步是否在衝刺（PlayerController.isSprinting）。 */
  isSprinting(): boolean;
  readonly state: { readonly state: string; readonly grounded: boolean; readonly speed: number };
  /** 這一步的眼睛位置（射擊起點）。 */
  eyeNow(out: THREE.Vector3): THREE.Vector3;
  /** 速度（近戰突進直接改寫水平分量）。 */
  readonly velocity: Vec3Like;
}

/** 視角（InputSystem.view：ViewAngles）。 */
export interface RecoilView {
  readonly yaw: number;
  readonly pitch: number;
  readonly pitchLimit?: number;
  setOffset(yaw: number, pitch: number): void;
  set(yaw: number, pitch: number): void;
}

export interface WeaponSettings {
  adsSensitivity: number;
  adsMode: HoldToggle;
  autoSprint: boolean;
}

/** 開鏡縮放的目標（CameraRig 符合）。 */
export interface ZoomTarget {
  fovZoom: number;
  readonly state: { readonly baseHorizontalFov: number };
}

export interface WeaponManagerOptions {
  getFrame: () => Readonly<InputFrame>;
  view: RecoilView;
  /** 目前操控的玩家；回傳 null（除錯飛行）時不能射擊、不處理輸入，只推進投射物。 */
  getPlayer: () => WeaponPlayer | null;
  ballistics?: Ballistics | null;
  bus?: EventBus<GameEvents> | undefined;
  config?: WeaponSystemConfig;
  /** 初始裝備（預設 5 把原型）。 */
  loadout?: WeaponDef[];
  rng?: Rng;
  getSettings?: () => Readonly<WeaponSettings>;
  /** 強制關閉切換模式的開鏡（input.builder.setToggle）。 */
  setToggle?: (action: 'ads', on: boolean) => void;
  /** 開鏡靈敏度：每畫面寫入 scale（input.mouse）。 */
  mouse?: { scale: number } | null;
  /** 開鏡縮放：每畫面寫入 fovZoom（CameraRig）。 */
  camera?: ZoomTarget | null;
}

/** HUD／準星／音效讀取的唯讀狀態（每步更新）。 */
export interface WeaponHudState {
  /** 目前手持的欄位 0..4（切槍中為正在收或掏的那一把）。 */
  slot: number;
  weaponId: string;
  name: string;
  phase: WeaponPhase;
  ammo: number;
  mag: number;
  /** 備彈（無限為 Infinity）。 */
  reserve: number;
  reloadKind: ReloadKind | null;
  reloadProgress: number;
  /** 開鏡進度 0..1（固定步；畫面用 renderAds）。 */
  ads: number;
  /** 目前的散布半角（度；準星大小）。 */
  spread: number;
  /** 切槍進度 0..1（不在切槍時為 1）；swapTo 為目標欄位。 */
  swapProgress: number;
  swapTo: number;
  /** 近戰冷卻剩餘比例 1 → 0。 */
  meleeCooldown: number;
  /** 後座偏移（度，視角慣例）。 */
  recoilPitch: number;
  recoilYaw: number;
  /** 距下一發可以射擊的時間（s，0 = 可以）。 */
  nextShotIn: number;
  shotsFired: number;
}

interface SwapState {
  active: boolean;
  phase: 'out' | 'in';
  from: number;
  to: number;
  start: number;
  outEnd: number;
  inEnd: number;
}

interface MeleeState {
  active: boolean;
  start: number;
  hitTime: number;
  end: number;
  resolved: boolean;
  lunge: boolean;
  target: Hitbox | null;
}

const _eye = new THREE.Vector3();
const _dir = { x: 0, y: 0, z: -1 };
const _center = { x: 0, y: 0, z: -1 };
const _offset = { x: 0, y: 0 };
const _pellet = { x: 0, y: 0 };
const _kick = { pitch: 0, yaw: 0 };
const _absorb = { pitch: 0, yaw: 0 };
const _target = { x: 0, y: 0, z: 0 };
const _neg = { x: 0, y: 0, z: 0 };

export class WeaponManager implements GameSystem {
  readonly name = 'weapons';
  readonly order = SystemOrder.weapons;
  readonly config: WeaponSystemConfig;
  readonly slots: (Weapon | null)[] = [];
  readonly recoil = new RecoilState();
  readonly rng: Rng;
  readonly state: WeaponHudState;
  /** 模擬時間（s；只在 step 中前進）。 */
  time = 0;
  /** 開鏡進度 0..1（上一步與這一步，插值用）與畫面插值後的值。 */
  ads = 0;
  previousAds = 0;
  renderAds = 0;
  /** 目前手持的欄位（切槍中，收槍階段為舊槍、掏槍階段為新槍）。 */
  activeSlot = 0;
  /** Q：切回上一把的欄位。 */
  lastSlot = 0;
  readonly swap: SwapState = { active: false, phase: 'out', from: 0, to: 0, start: 0, outEnd: 0, inEnd: 0 };
  readonly melee: MeleeState = { active: false, start: 0, hitTime: 0, end: 0, resolved: true, lunge: false, target: null };
  meleeCooldownUntil = Number.NEGATIVE_INFINITY;
  /** 近戰中按的切槍（動作結束後執行；-1 = 沒有）。 */
  private pendingSlot = -1;
  /** 最近一次衝刺的步結束時間 + sprintToFire：在這之前不能射擊。 */
  sprintReadyTime = Number.NEGATIVE_INFINITY;
  /** 切槍、近戰結束的時間（同一步內結束後可以接著射擊）。 */
  private swapDoneTime = Number.NEGATIVE_INFINITY;
  private meleeDoneTime = Number.NEGATIVE_INFINITY;
  shotId = 0;
  private meleeId = 0;
  private recoilTime = 0;
  private adsTarget = 0;
  private hasPrevView = false;
  private prevYaw = 0;
  private prevPitch = 0;
  /** 這一步瞄準用的玩家視角（壓槍吸收後）。 */
  private aimYaw = 0;
  private aimPitch = 0;
  private stepEnd = 0;
  private lowered = false;
  private readonly unsubs: (() => void)[] = [];
  private readonly listener: WeaponListener;
  private readonly shot: ShotContext;
  private readonly meleeShot: ShotContext;
  private readonly ev: {
    fire: GameEvents['weapon:fire'];
    dry: GameEvents['weapon:dryFire'];
    reloadStart: GameEvents['weapon:reloadStart'];
    reloadShell: GameEvents['weapon:reloadShell'];
    reloadEnd: GameEvents['weapon:reloadEnd'];
    swap: GameEvents['weapon:swap'];
    ads: GameEvents['weapon:ads'];
    melee: GameEvents['weapon:melee'];
  };
  /** 這一步的開火回呼（重複使用，避免每步建立閉包）。 */
  private readonly shootFn: (time: number, spread: number) => void;
  private currentFrame: Readonly<InputFrame> | null = null;

  constructor(private readonly options: WeaponManagerOptions) {
    this.config = options.config ?? WEAPON_SYSTEM_CONFIG;
    this.rng = options.rng ?? new Rng('shardwake:weapons');
    const v3 = (): Vec3Like => ({ x: 0, y: 0, z: 0 });
    this.ev = {
      fire: {
        weaponId: '',
        slot: 0,
        shotId: 0,
        time: 0,
        origin: v3(),
        dir: v3(),
        pellets: 1,
        ammo: 0,
        mag: 0,
        spread: 0,
        ads: 0,
        mode: 'auto',
        firstShot: false,
        recoilPitch: 0,
        recoilYaw: 0,
      },
      dry: { weaponId: '', slot: 0 },
      reloadStart: { weaponId: '', slot: 0, kind: 'tactical', duration: 0, ammo: 0, time: 0 },
      reloadShell: { weaponId: '', slot: 0, ammo: 0, time: 0 },
      reloadEnd: { weaponId: '', slot: 0, completed: false, refilled: false, reason: 'done', ammo: 0, time: 0 },
      swap: { phase: 'out', fromId: '', toId: '', fromSlot: 0, toSlot: 0, duration: 0 },
      ads: { weaponId: '', active: false, forced: false },
      melee: { phase: 'start', lunge: false, damage: 0 },
    };
    this.listener = {
      reloadStart: (w, kind, duration, time) => {
        const e = this.ev.reloadStart;
        e.weaponId = w.id;
        e.slot = this.slotOf(w);
        e.kind = kind;
        e.duration = duration;
        e.ammo = w.ammo;
        e.time = time;
        this.options.bus?.emit('weapon:reloadStart', e);
      },
      reloadShell: (w, time) => {
        const e = this.ev.reloadShell;
        e.weaponId = w.id;
        e.slot = this.slotOf(w);
        e.ammo = w.ammo;
        e.time = time;
        this.options.bus?.emit('weapon:reloadShell', e);
      },
      reloadEnd: (w, completed, refilled, reason, time) => {
        const e = this.ev.reloadEnd;
        e.weaponId = w.id;
        e.slot = this.slotOf(w);
        e.completed = completed;
        e.refilled = refilled;
        e.reason = reason;
        e.ammo = w.ammo;
        e.time = time;
        this.options.bus?.emit('weapon:reloadEnd', e);
      },
      dryFire: (w) => {
        const e = this.ev.dry;
        e.weaponId = w.id;
        e.slot = this.slotOf(w);
        this.options.bus?.emit('weapon:dryFire', e);
      },
    };
    const loadout = options.loadout ?? defaultLoadout();
    for (let i = 0; i < WEAPON_SLOTS; i++) {
      const def = loadout[i];
      this.slots.push(def ? new Weapon(def, this.listener, this.config) : null);
    }
    this.activeSlot = Math.max(0, this.slots.findIndex((w) => w !== null));
    this.lastSlot = this.activeSlot;
    this.shot = { shotId: 0, weaponId: '', source: 'player', def: null as unknown as WeaponDef, perks: [], perkCtx: null };
    this.meleeShot = { shotId: 0, weaponId: 'melee', source: 'player', def: null as unknown as WeaponDef, perks: [], perkCtx: null };
    this.shootFn = (time, spread) => this.shoot(time, spread);
    this.state = {
      slot: this.activeSlot,
      weaponId: '',
      name: '',
      phase: 'idle',
      ammo: 0,
      mag: 0,
      reserve: 0,
      reloadKind: null,
      reloadProgress: 0,
      ads: 0,
      spread: 0,
      swapProgress: 1,
      swapTo: this.activeSlot,
      meleeCooldown: 0,
      recoilPitch: 0,
      recoilYaw: 0,
      nextShotIn: 0,
      shotsFired: 0,
    };
    const bus = options.bus;
    if (bus) {
      this.unsubs.push(
        bus.on('player:respawn', () => this.onRespawn()),
        bus.on('physics:reset', () => this.options.ballistics?.clear()),
      );
    }
    this.publish(null);
  }

  // ── 查詢 ───────────────────────────────────────────────

  get active(): Weapon | null {
    return this.slots[this.activeSlot] ?? null;
  }

  get ballistics(): Ballistics | null {
    return this.options.ballistics ?? null;
  }

  /** 目前的散布半角（度；準星大小）。 */
  currentSpread(): number {
    const w = this.active;
    if (!w) return 0;
    return w.spreadAt(this.time, this.baseSpreadFor(w.def, this.options.getPlayer()));
  }

  /** 開鏡時的地面移動速度倍率（PlayerController 的 getMoveSpeedScale）。 */
  get moveSpeedScale(): number {
    const w = this.active;
    return w ? lerp(1, w.def.handling.adsMoveSpeedMult, this.ads) : 1;
  }

  get phase(): WeaponPhase {
    return this.state.phase;
  }

  // ── 裝備 ───────────────────────────────────────────────

  /** 把 WeaponDef 裝進欄位（M2 的拾取與換裝）；null 清空欄位。回傳新的 Weapon。 */
  equip(slot: number, def: WeaponDef | null): Weapon | null {
    if (slot < 0 || slot >= WEAPON_SLOTS) return null;
    const old = this.slots[slot];
    if (old?.reloading) old.cancelReload(this.time, 'other');
    const w = def ? new Weapon(def, this.listener, this.config) : null;
    this.slots[slot] = w;
    if (slot === this.activeSlot && !w) {
      const next = this.slots.findIndex((x) => x !== null);
      if (next >= 0) this.activeSlot = next;
    }
    this.publish(this.options.getPlayer());
    return w;
  }

  /** 要求切到欄位（0..4）；和按 1–5 相同。 */
  selectSlot(slot: number): boolean {
    return this.requestSwap(slot, this.time);
  }

  // ── Game 系統 ──────────────────────────────────────────

  fixedUpdate(dt: number): void {
    this.step(dt);
  }

  /** 推進一個固定步（無頭測試直接呼叫）。 */
  step(dt: number): void {
    if (!(dt > 0)) return;
    const t0 = this.time;
    const t1 = t0 + dt;
    this.stepEnd = t1;
    this.previousAds = this.ads;
    const f = this.options.getFrame();
    this.currentFrame = f;
    const player = this.options.getPlayer();
    const cfg = this.config;

    // 1. 壓槍吸收（玩家這一步的視角變化）。
    this.aimYaw = f.yaw;
    this.aimPitch = f.pitch;
    if (this.hasPrevView && player && cfg.recoilCompensation) {
      const dPitch = (f.pitch - this.prevPitch) * RAD2DEG;
      const dYaw = wrapAngle(f.yaw - this.prevYaw) * RAD2DEG;
      const t = this.recoil.absorb(dPitch, dYaw, _absorb);
      if (t.pitch !== 0 || t.yaw !== 0) {
        this.aimYaw = wrapAngle(f.yaw + t.yaw * DEG2RAD);
        this.aimPitch = f.pitch + t.pitch * DEG2RAD;
        const view = this.options.view;
        view.set(view.yaw + t.yaw * DEG2RAD, view.pitch + t.pitch * DEG2RAD);
      }
    }
    this.prevYaw = this.aimYaw;
    this.prevPitch = this.aimPitch;
    this.hasPrevView = true;

    if (!player) {
      this.options.ballistics?.step(dt);
      this.finishStep(t1);
      this.publish(null);
      return;
    }

    const settings = this.options.getSettings?.();
    const moveState = player.state.state;
    this.lowered = moveState === 'mantle';

    // 2. 衝刺轉射擊、手動衝刺鍵。
    const weapon0 = this.active;
    if (player.isSprinting() && moveState === 'ground') {
      this.sprintReadyTime = t1 + (weapon0?.def.handling.sprintToFire ?? 0);
    }
    if (settings && !settings.autoSprint && wasPressed(f, 'sprint')) {
      this.options.setToggle?.('ads', false);
      if (cfg.sprintCancelsReload && weapon0?.reloading) weapon0.cancelReload(t0, 'sprint');
    }

    // 3. 切槍。
    this.readSlotInput(f, t0);
    this.advanceSwap(t1);

    // 近戰。
    if (wasPressed(f, 'melee') && !this.swap.active && !this.melee.active && t0 >= this.meleeCooldownUntil - 1e-9) {
      this.startMelee(t0, player);
    }
    this.advanceMelee(t0, t1, player);
    if (!this.melee.active && this.pendingSlot >= 0) {
      const slot = this.pendingSlot;
      this.pendingSlot = -1;
      this.requestSwap(slot, Math.max(t0, this.meleeDoneTime));
      this.advanceSwap(t1);
    }

    // 開鏡。
    const adsHeld = isHeld(f, 'ads');
    const blocked = this.swap.active || this.melee.active || this.lowered || moveState === 'dash';
    if (blocked && adsHeld) this.options.setToggle?.('ads', false);
    const target = adsHeld && !blocked && this.active ? 1 : 0;
    if (target !== this.adsTarget) {
      this.adsTarget = target;
      const e = this.ev.ads;
      e.weaponId = this.active?.id ?? '';
      e.active = target === 1;
      e.forced = target === 0 && adsHeld && blocked;
      this.options.bus?.emit('weapon:ads', e);
    }
    const adsTime = this.active?.def.handling.adsTime ?? 0.2;
    this.ads = adsTime > 0 ? moveTowards(this.ads, this.adsTarget, dt / adsTime) : this.adsTarget;

    // 投射物（這一步新開火的投射物在生成時自己推進剩下的時間）。
    this.options.ballistics?.step(dt);

    // 4. 目前武器。
    const weapon = this.active;
    if (weapon) {
      const swapReady = this.swap.active ? Number.POSITIVE_INFINITY : this.swapDoneTime;
      const meleeReady = this.melee.active ? Number.POSITIVE_INFINITY : this.meleeDoneTime;
      const readyTime = this.lowered ? Number.POSITIVE_INFINITY : Math.max(this.sprintReadyTime, swapReady, meleeReady);
      weapon.step({
        t0,
        dt,
        fireHeld: isHeld(f, 'fire'),
        firePressed: wasPressed(f, 'fire'),
        reloadPressed: wasPressed(f, 'reload'),
        readyTime,
        canReload: !this.swap.active && !this.melee.active,
        baseSpread: this.baseSpreadFor(weapon.def, player),
        shoot: this.shootFn,
      });
    }

    // 5. 後座回正到步結束、寫入視角偏移。
    this.finishStep(t1);
    this.publish(player);
  }

  render(alpha: number): void {
    const a = clamp01(alpha);
    this.renderAds = lerp(this.previousAds, this.ads, a);
    const w = this.active;
    const eased = adsEase(this.renderAds, this.config.adsZoomEase);
    const zoom = w ? lerp(1, w.def.handling.adsZoom, eased) : 1;
    const cam = this.options.camera;
    if (cam) cam.fovZoom = zoom;
    const mouse = this.options.mouse;
    if (mouse) {
      const hip = cam && cam.state.baseHorizontalFov > 0 ? cam.state.baseHorizontalFov : 103;
      const user = this.options.getSettings?.().adsSensitivity ?? 1;
      mouse.scale = adsSensitivityRatio(hip, zoomedFov(hip, zoom)) * lerp(1, user, eased);
    }
  }

  dispose(): void {
    for (const u of this.unsubs.splice(0)) u();
    const cam = this.options.camera;
    if (cam) cam.fovZoom = 1;
    if (this.options.mouse) this.options.mouse.scale = 1;
  }

  // ── 內部：射擊 ─────────────────────────────────────────

  private baseSpreadFor(def: Readonly<WeaponDef>, player: WeaponPlayer | null): number {
    if (!player) return baseSpread(def.spread, this.ads, 0, false);
    const st = player.state;
    const airborne = !st.grounded && st.state !== 'wallRun';
    return baseSpread(def.spread, this.ads, st.speed / Math.max(0.01, this.config.spreadMoveRefSpeed), airborne);
  }

  private shoot(time: number, spread: number): void {
    const weapon = this.active;
    const player = this.options.getPlayer();
    if (!weapon || !player) return;
    const def = weapon.def;
    // 後座回正到這一發的時間，再以目前偏移決定瞄準方向（這一發的後座在射擊後才加上）。
    this.recoil.recover(this.recoilTime, time);
    this.recoilTime = Math.max(this.recoilTime, time);
    const lim = this.options.view.pitchLimit ?? 89 * DEG2RAD;
    const yaw = this.aimYaw + this.recoil.yaw * DEG2RAD;
    const pitch = clamp(this.aimPitch + this.recoil.pitch * DEG2RAD, -lim, lim);
    player.eyeNow(_eye);
    const shot = this.shot;
    shot.shotId = ++this.shotId;
    shot.weaponId = def.id;
    shot.def = def;
    shot.perks = weapon.perkHooks;
    shot.perkCtx = weapon.perkHooks.length > 0 ? weapon.perkContext(time) : null;
    // 整體散布：一次隨機偏移套在整個彈丸圖案上；沒有圖案的多彈丸各自隨機。
    sampleSpreadOffset(this.rng, spread, _offset);
    aimDirection(yaw, pitch, _offset.x, _offset.y, _center);
    const pellets = Math.max(1, Math.floor(def.fire.pellets));
    const pattern = def.spread.pelletPattern;
    const bal = this.options.ballistics;
    const remaining = Math.max(0, this.stepEnd - time);
    for (let i = 0; i < pellets; i++) {
      let dir: Vec3Like = _center;
      if (pellets > 1) {
        const p = pattern?.[i];
        if (p) aimDirection(yaw, pitch, _offset.x + p[0], _offset.y + p[1], _dir);
        else {
          sampleSpreadOffset(this.rng, spread, _pellet);
          aimDirection(yaw, pitch, _pellet.x, _pellet.y, _dir);
        }
        dir = _dir;
      }
      if (bal) {
        if (def.projectile) bal.spawnProjectile(_eye, dir, shot, remaining);
        else bal.hitscan(_eye, dir, shot, i);
      }
    }
    const kick = this.recoil.kick(time, def.recoil, this.ads, shotInterval(def), this.rng, _kick);
    const e = this.ev.fire;
    e.weaponId = def.id;
    e.slot = this.activeSlot;
    e.shotId = shot.shotId;
    e.time = time;
    e.origin.x = _eye.x;
    e.origin.y = _eye.y;
    e.origin.z = _eye.z;
    e.dir.x = _center.x;
    e.dir.y = _center.y;
    e.dir.z = _center.z;
    e.pellets = pellets;
    e.ammo = weapon.ammo;
    e.mag = def.ammo.mag;
    e.spread = spread;
    e.ads = this.ads;
    e.mode = def.fire.mode;
    e.firstShot = this.recoil.lastWasFirst;
    e.recoilPitch = kick.pitch;
    e.recoilYaw = kick.yaw;
    this.options.bus?.emit('weapon:fire', e);
  }

  private finishStep(t1: number): void {
    this.recoil.recover(this.recoilTime, t1);
    this.recoilTime = t1;
    this.options.view.setOffset(this.recoil.yaw * DEG2RAD, this.recoil.pitch * DEG2RAD);
    this.time = t1;
  }

  // ── 內部：切槍 ─────────────────────────────────────────

  private readSlotInput(f: Readonly<InputFrame>, t: number): void {
    const slotActions = ['weapon1', 'weapon2', 'weapon3', 'weapon4', 'weapon5'] as const;
    for (let i = 0; i < slotActions.length; i++) {
      if (wasPressed(f, slotActions[i]!)) {
        this.requestSwap(i, t);
        return;
      }
    }
    if (wasPressed(f, 'weaponLast')) {
      this.requestSwap(this.lastSlot, t);
      return;
    }
    const next = wasPressed(f, 'weaponNext');
    const prev = wasPressed(f, 'weaponPrev');
    if (next !== prev) this.requestSwap(this.cycleFrom(this.swap.active ? this.swap.to : this.activeSlot, next ? 1 : -1), t);
  }

  /** 從 slot 往 step 方向找下一個有武器的欄位（循環）。 */
  cycleFrom(slot: number, step: 1 | -1): number {
    for (let k = 1; k <= WEAPON_SLOTS; k++) {
      const i = (((slot + step * k) % WEAPON_SLOTS) + WEAPON_SLOTS) % WEAPON_SLOTS;
      if (this.slots[i]) return i;
    }
    return slot;
  }

  private requestSwap(slot: number, t: number): boolean {
    if (slot < 0 || slot >= WEAPON_SLOTS || !this.slots[slot]) return false;
    if (this.melee.active) {
      // 近戰動作中：記下來，動作結束時再切。
      this.pendingSlot = slot;
      return true;
    }
    const sw = this.swap;
    if (!sw.active && slot === this.activeSlot) return false;
    if (sw.active && slot === sw.to) return false;
    const toDef = this.slots[slot]!.def;
    if (sw.active && sw.phase === 'out') {
      // 收槍中改變目標：收槍時間不變，掏槍換成新目標。
      sw.to = slot;
      sw.inEnd = sw.outEnd + toDef.handling.swapIn;
      this.emitSwap('out', sw.inEnd - t);
      return true;
    }
    const cur = this.active;
    let outTime = cur?.def.handling.swapOut ?? 0;
    if (sw.active && sw.phase === 'in') {
      // 掏槍中再切：只需要收回已經掏出的比例。
      const len = cur?.def.handling.swapIn ?? 0;
      const progress = len > 0 ? clamp01((t - sw.outEnd) / len) : 1;
      outTime *= progress;
    }
    if (cur?.reloading) cur.cancelReload(t, 'swap');
    this.lastSlot = this.activeSlot;
    sw.active = true;
    sw.phase = 'out';
    sw.from = this.activeSlot;
    sw.to = slot;
    sw.start = t;
    sw.outEnd = t + outTime;
    sw.inEnd = sw.outEnd + toDef.handling.swapIn;
    this.emitSwap('out', sw.inEnd - t);
    return true;
  }

  private advanceSwap(t1: number): void {
    const sw = this.swap;
    if (!sw.active) return;
    if (sw.phase === 'out' && sw.outEnd <= t1 + 1e-9) {
      this.activeSlot = sw.to;
      sw.phase = 'in';
      this.emitSwap('in', sw.inEnd - sw.outEnd);
    }
    if (sw.phase === 'in' && sw.inEnd <= t1 + 1e-9) {
      sw.active = false;
      this.swapDoneTime = sw.inEnd;
      this.emitSwap('done', 0);
    }
  }

  private emitSwap(phase: 'out' | 'in' | 'done', duration: number): void {
    const bus = this.options.bus;
    if (!bus) return;
    const sw = this.swap;
    const e = this.ev.swap;
    e.phase = phase;
    e.fromSlot = sw.from;
    e.toSlot = sw.to;
    e.fromId = this.slots[sw.from]?.id ?? '';
    e.toId = this.slots[sw.to]?.id ?? '';
    e.duration = duration;
    bus.emit('weapon:swap', e);
  }

  // ── 內部：近戰 ─────────────────────────────────────────

  private forward(out: Vec3Like): Vec3Like {
    const lim = this.options.view.pitchLimit ?? 89 * DEG2RAD;
    return aimDirection(
      this.aimYaw + this.recoil.yaw * DEG2RAD,
      clamp(this.aimPitch + this.recoil.pitch * DEG2RAD, -lim, lim),
      0,
      0,
      out,
    );
  }

  private startMelee(t: number, player: WeaponPlayer): void {
    const cfg = this.config;
    const w = this.active;
    if (w?.reloading) w.cancelReload(t, 'melee');
    const m = this.melee;
    m.active = true;
    m.start = t;
    m.hitTime = t + cfg.meleeHitTime;
    m.end = t + Math.max(cfg.meleeDuration, cfg.meleeHitTime);
    m.resolved = false;
    m.target = null;
    m.lunge = false;
    this.meleeCooldownUntil = t + cfg.meleeCooldown;
    const bal = this.options.ballistics;
    if (bal) {
      player.eyeNow(_eye);
      const found = bal.findMeleeTarget(_eye, this.forward(_dir), cfg.meleeRange, cfg.meleeConeDeg, cfg.meleeHitTolerance, _target);
      if (found) {
        m.target = found.hitbox;
        m.lunge = found.distance > cfg.meleeLungeMinDist;
      }
    }
    const e = this.ev.melee;
    e.phase = 'start';
    e.lunge = m.lunge;
    e.damage = 0;
    this.options.bus?.emit('weapon:melee', e);
  }

  private advanceMelee(t0: number, t1: number, player: WeaponPlayer): void {
    const m = this.melee;
    if (!m.active) return;
    const cfg = this.config;
    // 突進吸附：命中判定前，水平速度朝目標。
    if (m.lunge && !m.resolved && m.target && m.target.target.alive && t0 < m.hitTime) {
      player.eyeNow(_eye);
      m.target.target.getCenter(_target);
      const dx = _target.x - _eye.x;
      const dz = _target.z - _eye.z;
      const d = Math.hypot(dx, dz);
      if (d > cfg.meleeLungeStopDist && d > 1e-6) {
        player.velocity.x = (dx / d) * cfg.meleeLungeSpeed;
        player.velocity.z = (dz / d) * cfg.meleeLungeSpeed;
      } else m.lunge = false;
    }
    if (!m.resolved && m.hitTime <= t1 + 1e-9) {
      m.resolved = true;
      this.resolveMelee(player);
    }
    if (m.end <= t1 + 1e-9) {
      m.active = false;
      this.meleeDoneTime = m.end;
    }
  }

  private resolveMelee(player: WeaponPlayer): void {
    const cfg = this.config;
    const bal = this.options.ballistics;
    let damage = 0;
    if (bal) {
      player.eyeNow(_eye);
      const fwd = this.forward(_dir);
      const found = bal.findMeleeTarget(_eye, fwd, cfg.meleeRange, cfg.meleeConeDeg, cfg.meleeHitTolerance, _target);
      if (found) {
        const s = this.meleeShot;
        s.shotId = -++this.meleeId;
        const dir = _center;
        dir.x = _target.x - _eye.x;
        dir.y = _target.y - _eye.y;
        dir.z = _target.z - _eye.z;
        const l = Math.hypot(dir.x, dir.y, dir.z) || 1;
        dir.x /= l;
        dir.y /= l;
        dir.z /= l;
        _neg.x = -dir.x;
        _neg.y = -dir.y;
        _neg.z = -dir.z;
        bal.deal(found.hitbox, cfg.meleeDamage, 'melee', _target, _neg, dir, found.distance, s);
        damage = cfg.meleeDamage;
      }
    }
    const e = this.ev.melee;
    e.phase = damage > 0 ? 'hit' : 'miss';
    e.lunge = this.melee.lunge;
    e.damage = damage;
    this.options.bus?.emit('weapon:melee', e);
  }

  // ── 內部：狀態 ─────────────────────────────────────────

  private onRespawn(): void {
    this.recoil.reset();
    this.options.view.setOffset(0, 0);
    this.ads = this.previousAds = this.renderAds = 0;
    this.hasPrevView = false;
    this.melee.active = false;
  }

  private slotOf(w: Weapon): number {
    const i = this.slots.indexOf(w);
    return i >= 0 ? i : this.activeSlot;
  }

  private publish(player: WeaponPlayer | null): void {
    const s = this.state;
    const w = this.active;
    const t = this.time;
    s.slot = this.activeSlot;
    s.weaponId = w?.id ?? '';
    s.name = w?.def.name ?? '';
    s.ammo = w?.ammo ?? 0;
    s.mag = w?.def.ammo.mag ?? 0;
    s.reserve = w?.reserve ?? 0;
    s.reloadKind = w?.reloading ? w.reload.kind : null;
    s.reloadProgress = w ? w.reloadProgress(t) : 0;
    s.ads = this.ads;
    s.spread = w ? w.spreadAt(t, this.baseSpreadFor(w.def, player)) : 0;
    const sw = this.swap;
    s.swapProgress = sw.active && sw.inEnd > sw.start ? clamp01((t - sw.start) / (sw.inEnd - sw.start)) : 1;
    s.swapTo = sw.active ? sw.to : this.activeSlot;
    const cd = this.config.meleeCooldown;
    s.meleeCooldown = cd > 0 ? clamp01((this.meleeCooldownUntil - t) / cd) : 0;
    s.recoilPitch = this.recoil.pitch;
    s.recoilYaw = this.recoil.yaw;
    s.nextShotIn = w ? Math.max(0, w.nextShotTime - t) : 0;
    s.shotsFired = w?.shotsFired ?? 0;
    const f = this.currentFrame;
    s.phase = sw.active
      ? 'swapping'
      : this.melee.active
        ? 'meleeing'
        : w?.reloading
          ? 'reloading'
          : w && (t < w.nextShotTime || (f !== null && isHeld(f, 'fire') && w.ammo > 0))
            ? 'firing'
            : 'idle';
  }
}

export type { ReloadEndReason };
