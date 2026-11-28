// 靶標管理（M1-12；Game 系統 name 'targets'、order ai）：建立訓練場的假人、移動靶、無人機與 DPS 計看板，
// 每個固定步推進靶標與敵方能量球，render 插值外觀。M3 的敵人用自己的系統，沿用 Damageable／registerHitbox／HostileBolts 與事件。
//
// - 物理：靶標碰撞體是不掛剛體的碰撞體（移動靶與無人機每步 setTranslation）；固定步順序 ai（400）在 physics（500）之前，
//   下一步的武器（300）射線就能看到新位置。關卡卸載（物理世界重建）時 destroy()、載入後 build()。
// - 無人機：settings「訓練無人機」開、數量 > 0、玩家在戰區（TargetLayout.arena.zoneId）內且存活時繞行並開火；
//   不在戰區時飛回待命點、不開火。每架 1.5 s 一發能量球（HostileBolts），需要對玩家有視線（世界 raycast）。
// - DPS 計：只計入玩家打在假人與移動靶上的傷害（DamageInfo.amount）。
import * as THREE from 'three';
import type { Damageable, DamageInfo } from '@/combat/Damage';
import { DPS_METER_CONFIG, DpsMeter, type DpsSnapshot } from '@/combat/DpsMeter';
import { isPlayerHit } from '@/combat/HitConfirm';
import { HostileBolts, type CapsuleLike } from '@/combat/HostileBolts';
import { DpsBoard } from '@/combat/targets/DpsBoard';
import {
  MAX_DRONES,
  TARGET_CONFIG,
  TRAINING_TARGET_LAYOUT,
  type TargetConfig,
  type TargetLayout,
} from '@/combat/targets/TargetConfig';
import { DroneTarget, DummyTarget, TrainingTarget } from '@/combat/targets/Targets';
import { TargetVisuals, type GlowProvider } from '@/combat/targets/TargetVisuals';
import type { EventBus } from '@/core/EventBus';
import type { GameEvents } from '@/core/events';
import { SystemOrder, type FrameInfo, type GameSystem } from '@/core/Game';
import { Rng } from '@/core/Rng';
import { QueryMask } from '@/physics/groups';
import type { Physics, Vec3Like } from '@/physics/Physics';
import type { HoloUniforms } from '@/world/HoloBoards';

/** 靶標需要的玩家資訊（腳底、身高、半徑、中心、眼睛）。 */
export interface TargetPlayerInfo {
  readonly feet: Readonly<Vec3Like>;
  readonly height: number;
  readonly radius: number;
  readonly center: Readonly<Vec3Like>;
  readonly eye: Readonly<Vec3Like>;
}

export interface TargetManagerOptions {
  physics: Physics;
  bus?: EventBus<GameEvents> | undefined;
  config?: TargetConfig;
  layout?: TargetLayout;
  /** 有場景時建立外觀（沒有時只跑邏輯，無頭測試）。 */
  scene?: THREE.Object3D | null;
  glow?: GlowProvider | null;
  /** 有 holo uniform 時建立 DPS 看板（需要 document）。 */
  holoUniforms?: HoloUniforms | null;
  /** 玩家（沒有、飛行除錯或死亡時回傳 null）。 */
  getPlayer?: () => TargetPlayerInfo | null;
  /** 玩家的受擊目標（能量球的傷害、自傷判定）。 */
  getPlayerTarget?: () => Damageable | null;
  /** 玩家目前所在的區域 id。 */
  getZoneId?: () => string | null;
  /** 設定「訓練無人機」。 */
  dronesEnabled?: () => boolean;
  /** 武器 id → 顯示名稱（DPS 看板）。 */
  weaponName?: (id: string) => string;
  seed?: number;
  boltCapacity?: number;
}

const v3 = (): Vec3Like => ({ x: 0, y: 0, z: 0 });

export class TargetManager implements GameSystem {
  readonly name = 'targets';
  readonly order = SystemOrder.ai;
  readonly config: TargetConfig;
  readonly layout: TargetLayout;
  readonly bolts: HostileBolts;
  readonly dps: DpsMeter;
  readonly visuals: TargetVisuals | null;
  readonly dummies: DummyTarget[] = [];
  readonly drones: DroneTarget[] = [];
  board: DpsBoard | null = null;
  /** 模擬時間（s）。 */
  time = 0;
  /** 玩家在戰區內（無人機交戰中）。 */
  engaged = false;
  private built = false;
  private readonly rng: Rng;
  private readonly offs: (() => void)[] = [];
  private readonly capsule: CapsuleLike = { a: v3(), b: v3(), radius: 0.4 };
  private readonly aim = v3();
  private readonly tmp = v3();
  private readonly tmpB = v3();
  private readonly others: Vec3Like[] = [];
  private readonly snapshotObj: DpsSnapshot = { dps: 0, total: 0, hits: 0, crits: 0, critRate: 0, duration: 0, weaponId: '' };
  private readonly evKilled: GameEvents['target:killed'] = { id: '', kind: '', point: v3(), weaponId: '', isCrit: false };
  private readonly evReset: GameEvents['target:reset'] = { id: '', kind: '' };
  private readonly playerEye = v3();
  private hasPlayerEye = false;
  private rails: THREE.Object3D[] = [];

  constructor(private readonly options: TargetManagerOptions) {
    this.config = options.config ?? TARGET_CONFIG;
    this.layout = options.layout ?? TRAINING_TARGET_LAYOUT;
    this.rng = new Rng(options.seed ?? 'shardwake:targets');
    this.dps = new DpsMeter(DPS_METER_CONFIG);
    this.visuals = options.scene && options.glow ? new TargetVisuals(options.glow, undefined, options.boltCapacity ?? 32) : null;
    if (this.visuals) options.scene!.add(this.visuals.root);
    this.bolts = new HostileBolts({
      physics: options.physics,
      bus: options.bus,
      capacity: options.boltCapacity ?? 32,
      getPlayerCapsule: () => this.playerCapsule(),
      getPlayerTarget: () => options.getPlayerTarget?.() ?? null,
    });
    const bus = options.bus;
    if (bus) {
      this.offs.push(
        bus.on('combat:damage', (info) => this.onDamage(info)),
        bus.on('level:unloaded', () => this.destroy()),
      );
    }
  }

  get isBuilt(): boolean {
    return this.built;
  }

  /** 所有靶標（假人、移動靶、無人機）。 */
  get all(): TrainingTarget[] {
    return [...this.dummies, ...this.drones];
  }

  /** 建立靶標與碰撞體（關卡載入後呼叫；重複呼叫會先清掉）。 */
  build(): void {
    this.destroy();
    const L = this.layout;
    const cfg = this.config;
    const vis = this.visuals;
    for (const d of L.dummies) {
      const t = new DummyTarget(d.id, { x: d.pos[0], y: d.pos[1], z: d.pos[2] }, d.yaw, cfg.dummy, cfg.flash, vis?.createDummy(false) ?? null);
      this.dummies.push(t);
    }
    for (const r of L.rails) {
      const rng = new Rng(`shardwake:target:${r.id}`);
      const start = (r.xMin + r.xMax) / 2;
      const t = new DummyTarget(r.id, { x: start, y: r.y, z: r.z }, 0, cfg.dummy, cfg.flash, vis?.createDummy(true) ?? null, {
        min: r.xMin,
        max: r.xMax,
        rng,
        cfg: cfg.mover,
      });
      this.dummies.push(t);
      if (vis) this.rails.push(vis.createRail(r.xMin, r.xMax, r.y, r.z));
    }
    for (let i = 0; i < MAX_DRONES; i++) {
      const h = L.arena.home[i % L.arena.home.length]!;
      const rng = new Rng(`shardwake:drone:${i}`);
      const t = new DroneTarget(
        `drone-${i}`,
        { x: h[0], y: h[1], z: h[2] },
        cfg.drone,
        cfg.flash,
        vis?.createDrone() ?? null,
        rng,
        (i / MAX_DRONES) * Math.PI * 2,
      );
      this.drones.push(t);
    }
    for (const t of this.all) {
      t.onKilled = (target, info) => this.onKilled(target, info);
      t.attach(this.options.physics);
    }
    this.updateDroneActivation();
    if (vis && this.options.holoUniforms && !this.board) {
      const b = L.board;
      this.board = DpsBoard.create({
        holoUniforms: this.options.holoUniforms,
        pos: b.pos,
        yaw: b.yaw,
        width: b.width,
        height: b.height,
        ...(this.options.weaponName ? { weaponName: this.options.weaponName } : {}),
      });
      if (this.board) vis.root.add(this.board.mesh);
    }
    this.built = true;
  }

  /** 移除所有靶標（關卡卸載）。 */
  destroy(): void {
    for (const t of this.all) {
      t.onKilled = null;
      t.detach();
    }
    this.dummies.length = 0;
    this.drones.length = 0;
    this.bolts.clear();
    this.visuals?.clearTargets();
    this.rails = [];
    if (this.board) {
      this.board.dispose();
      this.board = null;
    }
    this.built = false;
  }

  /** 調參面板改了數值：血量上限、部位倍率、無人機數量。 */
  applyConfig(): void {
    for (const t of this.all) t.applyConfig();
    this.updateDroneActivation();
  }

  /** 全部靶標回滿並站起、無人機回到待命點（面板按鈕、重生）。 */
  resetAll(): void {
    for (const t of this.all) {
      t.life.reset();
      t.flash = 0;
    }
    for (const d of this.drones) d.respawn();
    this.bolts.clear();
  }

  /** 錄影重播的起始狀態（M1-15）：靶標時間與亂數狀態。 */
  captureReplayState(): { time: number; rng: number } {
    return { time: this.time, rng: this.rng.getState() };
  }

  /**
   * 還原起始狀態（M1-15）：已建立的靶標全部重建（移動靶與無人機回到初始位置、亂數由固定種子重來）、
   * 清掉能量球；錄製與重播開始時都呼叫，讓會擋住玩家或開火的靶標從相同狀態出發。
   */
  restoreReplayState(s: Readonly<{ time: number; rng: number }>): void {
    if (this.built) this.build();
    this.bolts.clear();
    this.engaged = false;
    this.time = s.time;
    this.rng.setState(s.rng);
  }

  /** 清掉所有飛行中的能量球（玩家重生）。 */
  clearBolts(): void {
    this.bolts.clear();
  }

  dpsSnapshot(): DpsSnapshot {
    return this.dps.snapshot(this.time, this.snapshotObj);
  }

  fixedUpdate(dt: number): void {
    this.step(dt);
  }

  /** 推進一個固定步（無頭測試直接呼叫）。 */
  step(dt: number): void {
    if (!(dt > 0)) return;
    this.time += dt;
    if (!this.built) return;
    for (const d of this.dummies) {
      if (d.step(dt) === 'reset') this.emitReset(d);
    }
    this.updateDroneActivation();
    const player = this.options.getPlayer?.() ?? null;
    const zone = this.options.getZoneId?.() ?? null;
    const target = this.options.getPlayerTarget?.() ?? null;
    this.engaged = player !== null && zone === this.layout.arena.zoneId && (target ? target.alive : true);
    const center = this.engaged && player ? player.center : null;
    const bounds = this.layout.arena;
    const others = this.others;
    for (const d of this.drones) {
      others.length = 0;
      for (const o of this.drones) if (o !== d && o.active && o.life.alive) others.push(o.position);
      const r = d.step(dt, center, bounds, others);
      if (r.reset) this.emitReset(d);
      if (r.fire && player) d.fired(this.droneFire(d, player));
    }
    this.bolts.step(dt);
  }

  render(alpha: number, frame: Readonly<FrameInfo>): void {
    const vis = this.visuals;
    if (!vis) return;
    for (const d of this.dummies) d.render(alpha);
    const player = this.options.getPlayer?.() ?? null;
    if (player) {
      this.playerEye.x = player.eye.x;
      this.playerEye.y = player.eye.y;
      this.playerEye.z = player.eye.z;
      this.hasPlayerEye = true;
    }
    for (const d of this.drones) d.render(alpha, this.engaged && this.hasPlayerEye ? this.playerEye : null);
    const bolts = vis.bolts;
    const st = vis.style;
    bolts.begin();
    this.bolts.pool.forEachActive((b) => {
      bolts.add(b, alpha, st.boltGlowRadius, st.boltTrail, st.boltColor, st.boltIntensity);
    });
    bolts.end();
    this.board?.update(frame.realDt, this.dpsSnapshot());
  }

  dispose(): void {
    for (const off of this.offs) off();
    this.offs.length = 0;
    this.destroy();
    this.visuals?.dispose();
  }

  // ── 內部 ─────────────────────────────────────────────

  private updateDroneActivation(): void {
    const enabled = this.options.dronesEnabled?.() ?? true;
    const n = enabled ? Math.max(0, Math.min(MAX_DRONES, Math.floor(this.config.drone.count))) : 0;
    this.drones.forEach((d, i) => d.setActive(i < n));
  }

  private playerCapsule(): CapsuleLike | null {
    const p = this.options.getPlayer?.() ?? null;
    if (!p) return null;
    const c = this.capsule;
    const r = Math.max(0.05, p.radius);
    c.radius = r;
    c.a.x = p.feet.x;
    c.a.y = p.feet.y + r;
    c.a.z = p.feet.z;
    c.b.x = p.feet.x;
    c.b.y = p.feet.y + Math.max(r, p.height - r);
    c.b.z = p.feet.z;
    return c;
  }

  /** 無人機開火：從核心朝玩家中心（不預判）；沒有視線時回傳 false。 */
  private droneFire(d: DroneTarget, player: TargetPlayerInfo): boolean {
    const cfg = this.config.drone;
    const from = d.corePosition(this.tmp);
    const aim = this.aim;
    aim.x = player.center.x;
    aim.y = player.center.y + cfg.aimOffsetY;
    aim.z = player.center.z;
    const dir = this.tmpB;
    dir.x = aim.x - from.x;
    dir.y = aim.y - from.y;
    dir.z = aim.z - from.z;
    const dist = Math.hypot(dir.x, dir.y, dir.z);
    if (!(dist > 1e-3)) return false;
    const hit = this.options.physics.raycast(from, dir, dist, QueryMask.world);
    if (hit && hit.distance < dist - 0.3) return false;
    return this.bolts.spawn(d.id, from, dir, cfg.boltSpeed, cfg.boltDamage, cfg.boltRadius, cfg.boltLifetime) !== null;
  }

  private onDamage(info: Readonly<DamageInfo>): void {
    const t = info.target;
    if (!(t instanceof DummyTarget)) return;
    if (!isPlayerHit(info, this.options.getPlayerTarget?.() ?? null)) return;
    this.dps.record(this.time, info.amount, info.isCrit, info.weaponId);
  }

  private onKilled(target: TrainingTarget, info: Readonly<DamageInfo>): void {
    const ev = this.evKilled;
    ev.id = target.id;
    ev.kind = target.kind;
    target.getCenter(ev.point);
    ev.weaponId = info.weaponId;
    ev.isCrit = info.isCrit;
    if (target instanceof DroneTarget) target.syncColliders();
    this.options.bus?.emit('target:killed', ev);
  }

  private emitReset(t: TrainingTarget): void {
    const ev = this.evReset;
    ev.id = t.id;
    ev.kind = t.kind;
    this.options.bus?.emit('target:reset', ev);
  }
}
