// 武器無頭測試工具（M1-10）：WeaponManager ＋ 腳本輸入 ＋ 假玩家（不需要 Rapier）；
// 需要彈道時另外傳入 Ballistics（Rapier 世界）。後續計畫（M1-11 viewmodel、M1-12 靶標）可沿用。
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { copyDamageInfo, registerHitbox, type DamageInfo, type DamageOutcome, type Damageable, type HitZone } from '@/combat/Damage';
import { EventBus } from '@/core/EventBus';
import type { GameEvents } from '@/core/events';
import { Rng } from '@/core/Rng';
import { ViewAngles } from '@/input/Mouse';
import { COLLISION_PRESETS } from '@/physics/groups';
import type { Physics, Vec3Like } from '@/physics/Physics';
import type { Ballistics } from '@/weapons/Ballistics';
import { defaultWeaponSystemConfig, type WeaponSystemConfig } from '@/weapons/WeaponConfig';
import type { WeaponDef } from '@/weapons/WeaponDef';
import { WeaponManager, type WeaponPlayer, type WeaponSettings } from '@/weapons/WeaponManager';
import { ScriptedInput } from './movementSim';

export class FakePlayer implements WeaponPlayer {
  sprinting = false;
  readonly state = { state: 'ground', grounded: true, speed: 0 };
  readonly eye = new THREE.Vector3(0, 1.65, 0);
  readonly velocity = { x: 0, y: 0, z: 0 };
  isSprinting(): boolean {
    return this.sprinting;
  }
  eyeNow(out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.eye);
  }
}

export interface RecordedWeaponEvent {
  name: keyof GameEvents;
  step: number;
  payload: Record<string, unknown>;
}

const WEAPON_EVENTS: readonly (keyof GameEvents)[] = [
  'weapon:fire',
  'weapon:hitscan',
  'weapon:dryFire',
  'weapon:reloadStart',
  'weapon:reloadShell',
  'weapon:reloadEnd',
  'weapon:swap',
  'weapon:ads',
  'weapon:melee',
  'weapon:projectile',
  'weapon:explosion',
];

export interface WeaponSimOptions {
  hz?: number;
  loadout?: WeaponDef[];
  config?: Partial<WeaponSystemConfig>;
  ballistics?: Ballistics | null;
  bus?: EventBus<GameEvents>;
  settings?: Partial<WeaponSettings>;
  player?: WeaponPlayer;
  seed?: number;
}

export class WeaponSim {
  readonly input = new ScriptedInput();
  readonly view = new ViewAngles();
  readonly player: WeaponPlayer;
  readonly bus: EventBus<GameEvents>;
  readonly events: RecordedWeaponEvent[] = [];
  readonly damage: DamageInfo[] = [];
  readonly manager: WeaponManager;
  readonly settings: WeaponSettings;
  readonly mouse = { scale: 1 };
  readonly camera = { fovZoom: 1, state: { baseHorizontalFov: 103 } };
  readonly toggles: { action: string; on: boolean }[] = [];
  readonly hz: number;
  readonly dt: number;
  stepCount = 0;
  private frame = this.input.build();

  constructor(options: WeaponSimOptions = {}) {
    this.hz = options.hz ?? 120;
    this.dt = 1 / this.hz;
    this.bus = options.bus ?? new EventBus<GameEvents>();
    this.player = options.player ?? new FakePlayer();
    this.settings = { adsSensitivity: 1, adsMode: 'hold', autoSprint: true, ...options.settings };
    this.manager = new WeaponManager({
      getFrame: () => this.frame,
      view: this.view,
      getPlayer: () => this.player,
      ballistics: options.ballistics ?? null,
      bus: this.bus,
      config: { ...defaultWeaponSystemConfig(), ...options.config },
      rng: new Rng(options.seed ?? 1234),
      getSettings: () => this.settings,
      setToggle: (action, on) => this.toggles.push({ action, on }),
      mouse: this.mouse,
      camera: this.camera,
      ...(options.loadout ? { loadout: options.loadout } : {}),
    });
    for (const name of WEAPON_EVENTS) {
      this.bus.on(name, (payload) => {
        this.events.push({ name, step: this.stepCount, payload: JSON.parse(JSON.stringify(payload)) as Record<string, unknown> });
      });
    }
    this.bus.on('combat:damage', (info) => this.damage.push(copyDamageInfo(info)));
  }

  get time(): number {
    return this.manager.time;
  }

  /** 推進 n 步：InputFrame 的視角取自 view（與 InputSystem 相同）。 */
  step(n = 1): void {
    for (let i = 0; i < n; i++) {
      this.input.setYaw(this.view.yaw).setPitch(this.view.pitch);
      this.frame = this.input.build();
      this.stepCount++;
      this.manager.step(this.dt);
    }
  }

  run(seconds: number): void {
    this.step(Math.round(seconds * this.hz));
  }

  runUntil(pred: () => boolean, maxSeconds = 10): number | null {
    const start = this.stepCount;
    for (let i = 0; i < Math.round(maxSeconds * this.hz); i++) {
      this.step();
      if (pred()) return (this.stepCount - start) * this.dt;
    }
    return null;
  }

  eventsNamed(name: keyof GameEvents): RecordedWeaponEvent[] {
    return this.events.filter((e) => e.name === name);
  }

  count(name: keyof GameEvents): number {
    return this.eventsNamed(name).length;
  }
}

/** 測試用靶：記錄受到的傷害；health ≤ 0 時死亡。 */
export class TestTarget implements Damageable {
  alive = true;
  health: number;
  readonly hits: DamageInfo[] = [];
  readonly center: THREE.Vector3;
  constructor(
    readonly id: string,
    center: Vec3Like,
    health = 1e9,
  ) {
    this.center = new THREE.Vector3(center.x, center.y, center.z);
    this.health = health;
  }
  getCenter(out: Vec3Like): Vec3Like {
    out.x = this.center.x;
    out.y = this.center.y;
    out.z = this.center.z;
    return out;
  }
  applyDamage(info: Readonly<DamageInfo>): DamageOutcome {
    const dealt = Math.min(this.health, info.amount);
    this.health -= info.amount;
    this.hits.push(copyDamageInfo(info));
    const killed = this.health <= 0 && this.alive;
    if (killed) this.alive = false;
    return { dealt, killed };
  }
  get total(): number {
    return this.hits.reduce((a, h) => a + h.amount, 0);
  }
}

/** 靜態世界方塊（中心、半邊長）。 */
export function addWall(physics: Physics, center: Vec3Like, half: Vec3Like): RAPIER.Collider {
  const desc = RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z)
    .setTranslation(center.x, center.y, center.z)
    .setCollisionGroups(COLLISION_PRESETS.world);
  return physics.createStaticCollider(desc, { surface: 'concrete' });
}

/** 受擊範圍（球）並登記成 target 的 hitbox。 */
export function addTargetBall(
  physics: Physics,
  target: Damageable,
  center: Vec3Like,
  radius = 0.4,
  zone: HitZone = 'body',
): RAPIER.Collider {
  const desc = RAPIER.ColliderDesc.ball(radius)
    .setTranslation(center.x, center.y, center.z)
    .setCollisionGroups(COLLISION_PRESETS.enemy);
  const c = physics.createStaticCollider(desc);
  registerHitbox(physics, c, target, zone);
  return c;
}
