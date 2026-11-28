// 訓練靶標（M1-12）：靜態假人、移動靶、訓練無人機。都實作 Damageable；受擊碰撞體在 ENEMY 群組、以 registerHitbox 標記部位
// （身體 'body'、頭部／核心 'crit'）。邏輯在固定步（TargetManager.step），外觀在 render（插值）；沒有 visuals 時可無頭測試。
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { registerHitbox, type DamageInfo, type DamageOutcome, type Damageable, type HitZone } from '@/combat/Damage';
import { DroneMotion, RailMotion, TargetLife, type Bounds3 } from '@/combat/targets/targetMath';
import type { DroneConfig, DummyConfig, MoverConfig, TargetFlashConfig } from '@/combat/targets/TargetConfig';
import { DRONE_SHAPE, DUMMY_SHAPE, TargetVisuals, type DroneView, type DummyView } from '@/combat/targets/TargetVisuals';
import { clamp, smoothstep } from '@/core/math';
import type { Rng } from '@/core/Rng';
import { COLLISION_PRESETS } from '@/physics/groups';
import type { Physics, Vec3Like } from '@/physics/Physics';

export type TargetKind = 'dummy' | 'mover' | 'drone';

/** 碰撞體位置的暫存物件（setTranslation 不保存參考；熱迴圈不配置，M1-16）。 */
const COLLIDER_POS: Vec3Like = { x: 0, y: 0, z: 0 };

/** 擊殺時通知（TargetManager 發事件、特效）。 */
export type KillHandler = (target: TrainingTarget, info: Readonly<DamageInfo>) => void;

interface ColliderRec {
  collider: RAPIER.Collider;
  generation: number;
  /** 相對靶標原點的偏移（假人：腳底；無人機：中心）。 */
  readonly offset: THREE.Vector3;
}

export abstract class TrainingTarget implements Damageable {
  abstract readonly kind: TargetKind;
  readonly life: TargetLife;
  /** 命中閃白 0..1。 */
  flash = 0;
  /** 最後一次擊殺的傷害方向（水平；倒下方向）。 */
  readonly killDir = new THREE.Vector3(0, 0, -1);
  onKilled: KillHandler | null = null;
  protected readonly colliders: ColliderRec[] = [];
  protected physics: Physics | null = null;

  constructor(
    readonly id: string,
    maxHealth: number,
    regenDelay: number,
    resetDelay: number,
  ) {
    this.life = new TargetLife({ maxHealth, regenDelay, resetDelay });
  }

  get alive(): boolean {
    return this.life.alive && this.enabled;
  }

  /** 是否啟用（無人機數量與開關；假人永遠啟用）。 */
  get enabled(): boolean {
    return true;
  }

  abstract getCenter(out: Vec3Like): Vec3Like;

  applyDamage(info: Readonly<DamageInfo>): DamageOutcome {
    if (!this.alive) return { dealt: 0, killed: false };
    const out = this.life.damage(info.amount);
    this.flash = 1;
    if (out.killed) {
      this.killDir.set(info.dir.x, 0, info.dir.z);
      if (this.killDir.lengthSq() < 1e-8) this.killDir.set(0, 0, -1);
      this.killDir.normalize();
      this.onKilled?.(this, info);
    }
    return out;
  }

  /** 建立受擊碰撞體（目前的物理世界）。 */
  abstract attach(physics: Physics): void;

  /** 移除碰撞體（世界已重建時忽略）。 */
  detach(): void {
    const p = this.physics;
    if (p) for (const c of this.colliders) p.removeCollider(c.collider, c.generation);
    this.colliders.length = 0;
    this.physics = null;
  }

  protected addCollider(physics: Physics, desc: RAPIER.ColliderDesc, offset: THREE.Vector3, zone: HitZone, multiplier: number): void {
    desc.setCollisionGroups(COLLISION_PRESETS.enemy);
    const collider = physics.createStaticCollider(desc);
    registerHitbox(physics, collider, this, zone, { multiplier, surface: 'metal' });
    this.colliders.push({ collider, generation: physics.generation, offset });
  }

  protected moveColliders(x: number, y: number, z: number): void {
    const p = this.physics;
    if (!p) return;
    for (const c of this.colliders) {
      if (c.generation !== p.generation) continue;
      const t = COLLIDER_POS;
      t.x = x + c.offset.x;
      t.y = y + c.offset.y;
      t.z = z + c.offset.z;
      c.collider.setTranslation(t);
    }
  }

  protected setCollidersEnabled(on: boolean): void {
    const p = this.physics;
    if (!p) return;
    let changed = false;
    for (const c of this.colliders) {
      if (c.generation !== p.generation) continue;
      if (c.collider.isEnabled() !== on) {
        c.collider.setEnabled(on);
        changed = true;
      }
    }
    if (changed) p.markDirty();
  }

  /** 部位倍率改變（調參面板）：重新登記 hitbox。 */
  abstract applyConfig(): void;

  abstract render(alpha: number): void;

  protected updateFlash(dt: number, flash: TargetFlashConfig): void {
    if (this.flash > 0) this.flash = Math.max(0, this.flash - dt / Math.max(1e-3, flash.duration));
  }
}

// ── 靜態假人與移動靶 ───────────────────────────────────

export class DummyTarget extends TrainingTarget {
  readonly kind: TargetKind;
  /** 腳底位置（移動靶為滑台底部；x 隨軌道改變）。 */
  readonly position = new THREE.Vector3();
  readonly previousPosition = new THREE.Vector3();
  readonly rail: RailMotion | null;
  /** 倒下進度 0..1（render 用）。 */
  fall = 0;
  private readonly lift: number;
  private readonly yaw: number;
  private readonly moverCfg: MoverConfig | null;

  constructor(
    id: string,
    pos: Readonly<Vec3Like>,
    yawDeg: number,
    private readonly cfg: DummyConfig,
    private readonly flashCfg: TargetFlashConfig,
    private readonly view: DummyView | null,
    rail: { min: number; max: number; rng: Rng; cfg: MoverConfig } | null = null,
  ) {
    super(id, cfg.maxHealth, cfg.regenDelay, cfg.resetDelay);
    this.kind = rail ? 'mover' : 'dummy';
    this.position.set(pos.x, pos.y, pos.z);
    this.previousPosition.copy(this.position);
    this.yaw = (yawDeg * Math.PI) / 180;
    this.lift = rail ? DUMMY_SHAPE.sledHeight : 0;
    this.rail = rail ? new RailMotion(rail.min, rail.max, rail.rng, rail.cfg, pos.x) : null;
    if (this.rail) this.position.x = this.rail.x;
    this.moverCfg = rail?.cfg ?? null;
    this.render(1);
  }

  getCenter(out: Vec3Like): Vec3Like {
    out.x = this.position.x;
    out.y = this.position.y + this.lift + DUMMY_SHAPE.centerY;
    out.z = this.position.z;
    return out;
  }

  attach(physics: Physics): void {
    this.detach();
    this.physics = physics;
    const s = DUMMY_SHAPE;
    const p = this.position;
    const torso = new THREE.Vector3(0, this.lift + s.torsoY, 0);
    const head = new THREE.Vector3(0, this.lift + s.headY, 0);
    this.addCollider(
      physics,
      RAPIER.ColliderDesc.capsule(s.torsoLength / 2, s.torsoRadius).setTranslation(p.x + torso.x, p.y + torso.y, p.z + torso.z),
      torso,
      'body',
      1,
    );
    this.addCollider(
      physics,
      RAPIER.ColliderDesc.ball(s.headRadius).setTranslation(p.x + head.x, p.y + head.y, p.z + head.z),
      head,
      'crit',
      this.cfg.headMultiplier,
    );
  }

  applyConfig(): void {
    this.life.rules.maxHealth = this.cfg.maxHealth;
    this.life.rules.regenDelay = this.cfg.regenDelay;
    this.life.rules.resetDelay = this.cfg.resetDelay;
    this.life.applyMax();
    if (this.physics) this.attach(this.physics);
  }

  /** 固定步：血量、閃白、倒下、軌道移動。 */
  step(dt: number): 'reset' | null {
    this.previousPosition.copy(this.position);
    this.life.rules.maxHealth = this.cfg.maxHealth;
    this.life.rules.regenDelay = this.cfg.regenDelay;
    this.life.rules.resetDelay = this.cfg.resetDelay;
    const ev = this.life.step(dt);
    this.updateFlash(dt, this.flashCfg);
    const c = this.cfg;
    if (!this.life.alive) this.fall = clamp(this.life.deadTime / Math.max(1e-3, c.fallTime), 0, 1);
    else this.fall = 1 - clamp(this.life.sinceReset / Math.max(1e-3, c.riseTime), 0, 1);
    if (this.rail && this.moverCfg && this.life.alive) {
      this.rail.step(dt, this.moverCfg);
      this.position.x = this.rail.x;
      this.moveColliders(this.position.x, this.position.y, this.position.z);
    }
    return ev === 'reset' ? 'reset' : null;
  }

  render(alpha: number): void {
    const v = this.view;
    if (!v) return;
    const g = v.group;
    g.position.lerpVectors(this.previousPosition, this.position, alpha);
    // 倒下：繞「上 × 擊殺方向」的水平軸，往遠離射手的方向倒（ease-in，站起時 ease-out）。
    const k = smoothstep(0, 1, this.fall);
    const angle = (this.cfg.fallAngle * Math.PI) / 180;
    _axis.set(this.killDir.z, 0, -this.killDir.x);
    _qFall.setFromAxisAngle(_axis, angle * k);
    _qYaw.setFromAxisAngle(_up, this.yaw);
    g.quaternion.copy(_qFall).multiply(_qYaw);
    TargetVisuals.setFlash(v.material, this.flash * this.flash * this.flashCfg.intensity);
  }
}

// ── 訓練無人機 ─────────────────────────────────────────

export class DroneTarget extends TrainingTarget {
  readonly kind = 'drone' as const;
  readonly motion: DroneMotion;
  readonly previousPosition = new THREE.Vector3();
  /** 面向（單位向量，朝玩家）。 */
  readonly facing = new THREE.Vector3(0, 0, 1);
  readonly home: THREE.Vector3;
  /** 啟用（數量與開關）；停用時隱藏、碰撞體關閉。 */
  active = false;
  /** 玩家在戰區內（繞行並開火）。 */
  engaged = false;
  /** 距離下一發的時間（s）。 */
  fireTimer = 0;
  /** 重生後經過的時間（出現動畫）。 */
  appear = 1;
  /** 累計開火數。 */
  shots = 0;
  /** step() 的回傳物件（重複使用，呼叫端不保存）。 */
  private readonly stepResult = { reset: false, fire: false };

  constructor(
    id: string,
    home: Readonly<Vec3Like>,
    private readonly cfg: DroneConfig,
    private readonly flashCfg: TargetFlashConfig,
    private readonly view: DroneView | null,
    readonly rng: Rng,
    angle: number,
  ) {
    super(id, cfg.maxHealth, Infinity, cfg.respawnTime);
    this.home = new THREE.Vector3(home.x, home.y, home.z);
    this.motion = new DroneMotion(home, rng, cfg, angle);
    this.previousPosition.copy(this.home);
    if (view) view.group.visible = false;
  }

  override get enabled(): boolean {
    return this.active;
  }

  get position(): Vec3Like {
    return this.motion.position;
  }

  getCenter(out: Vec3Like): Vec3Like {
    const p = this.motion.position;
    out.x = p.x;
    out.y = p.y;
    out.z = p.z;
    return out;
  }

  /** 核心（弱點）的世界位置。 */
  corePosition(out: Vec3Like): Vec3Like {
    const p = this.motion.position;
    out.x = p.x + this.facing.x * DRONE_SHAPE.coreOffset;
    out.y = p.y + this.facing.y * DRONE_SHAPE.coreOffset;
    out.z = p.z + this.facing.z * DRONE_SHAPE.coreOffset;
    return out;
  }

  attach(physics: Physics): void {
    this.detach();
    this.physics = physics;
    const d = DRONE_SHAPE;
    const p = this.motion.position;
    this.addCollider(physics, RAPIER.ColliderDesc.ball(d.bodyRadius).setTranslation(p.x, p.y, p.z), new THREE.Vector3(), 'body', 1);
    const core = new THREE.Vector3();
    this.addCollider(physics, RAPIER.ColliderDesc.ball(d.coreRadius).setTranslation(p.x, p.y, p.z + d.coreOffset), core, 'crit', this.cfg.coreMultiplier);
    this.syncColliders();
  }

  applyConfig(): void {
    this.life.rules.maxHealth = this.cfg.maxHealth;
    this.life.rules.resetDelay = this.cfg.respawnTime;
    this.life.applyMax();
    if (this.physics) this.attach(this.physics);
  }

  /** 啟用或停用（停用時回到待命點、回滿）。 */
  setActive(on: boolean): void {
    if (on === this.active) return;
    this.active = on;
    if (!on) {
      this.life.reset();
      this.motion.place(this.home);
      this.previousPosition.copy(this.home);
      this.engaged = false;
    } else {
      this.appear = 0;
    }
    this.syncColliders();
  }

  /** 重生：回到待命點。 */
  respawn(): void {
    this.motion.place(this.home);
    this.previousPosition.copy(this.home);
    this.appear = 0;
    this.flash = 0;
    this.syncColliders();
  }

  /** 讓核心碰撞體跟著面向。 */
  syncColliders(): void {
    const p = this.motion.position;
    const core = this.colliders[1];
    if (core) core.offset.copy(this.facing).multiplyScalar(DRONE_SHAPE.coreOffset);
    this.moveColliders(p.x, p.y, p.z);
    this.setCollidersEnabled(this.active && this.life.alive);
  }

  /**
   * 固定步：player 為玩家中心（null = 不在戰區或已死亡，回待命點）；aim 為瞄準點。回傳是否要開火。
   */
  step(dt: number, player: Readonly<Vec3Like> | null, bounds: Bounds3, others: readonly Readonly<Vec3Like>[]): { reset: boolean; fire: boolean } {
    const p = this.motion.position;
    this.previousPosition.set(p.x, p.y, p.z);
    this.life.rules.maxHealth = this.cfg.maxHealth;
    this.life.rules.resetDelay = this.cfg.respawnTime;
    this.updateFlash(dt, this.flashCfg);
    this.appear = Math.min(1, this.appear + dt / 0.35);
    const out = this.stepResult;
    out.reset = false;
    out.fire = false;
    if (!this.active) return out;
    const ev = this.life.step(dt);
    if (ev === 'reset') {
      this.respawn();
      out.reset = true;
      return out;
    }
    if (!this.life.alive) return out;
    const wasEngaged = this.engaged;
    this.engaged = player !== null;
    if (this.engaged && !wasEngaged) this.fireTimer = this.rng.range(this.cfg.firstShotMin, Math.max(this.cfg.firstShotMin, this.cfg.firstShotMax));
    this.motion.step(dt, this.cfg, player, this.home, bounds, others);
    // 面向：有玩家時朝玩家，沒有時朝移動方向（水平）。
    if (player) {
      this.facing.set(player.x - p.x, player.y - p.y, player.z - p.z);
    } else {
      const v = this.motion.velocity;
      this.facing.set(v.x, 0, v.z);
    }
    if (this.facing.lengthSq() < 1e-6) this.facing.set(0, 0, 1);
    this.facing.normalize();
    this.syncColliders();
    let fire = false;
    if (this.engaged) {
      this.fireTimer -= dt;
      if (this.fireTimer <= 0) fire = true;
    }
    out.fire = fire;
    return out;
  }

  /** 開火成功：下一發在 fireInterval 後；沒有視線時 losRetry 後重試。 */
  fired(ok: boolean): void {
    if (ok) {
      this.fireTimer += this.cfg.fireInterval;
      if (this.fireTimer < 0) this.fireTimer = this.cfg.fireInterval;
      this.shots++;
    } else this.fireTimer = this.cfg.losRetry;
  }

  render(alpha: number, lookAt?: Readonly<Vec3Like> | null): void {
    const v = this.view;
    if (!v) return;
    const g = v.group;
    const visible = this.active && this.life.alive;
    g.visible = visible;
    if (!visible) return;
    const p = this.motion.position;
    g.position.set(
      this.previousPosition.x + (p.x - this.previousPosition.x) * alpha,
      this.previousPosition.y + (p.y - this.previousPosition.y) * alpha,
      this.previousPosition.z + (p.z - this.previousPosition.z) * alpha,
    );
    if (lookAt) _look.set(lookAt.x, lookAt.y, lookAt.z);
    else _look.copy(g.position).add(this.facing);
    g.lookAt(_look);
    // 依側向速度輕微傾斜。
    const vel = this.motion.velocity;
    g.rotateZ(clamp(-(vel.x * this.facing.z - vel.z * this.facing.x) * 0.03, -0.35, 0.35));
    const s = 0.2 + 0.8 * smoothstep(0, 1, this.appear);
    g.scale.setScalar(s);
    TargetVisuals.setFlash(v.material, this.flash * this.flash * this.flashCfg.intensity);
  }
}

const _axis = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _qFall = new THREE.Quaternion();
const _qYaw = new THREE.Quaternion();
const _look = new THREE.Vector3();
