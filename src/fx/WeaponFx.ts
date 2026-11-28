// 武器特效（M1-11）：把武器事件轉成特效，並提供給敵人、元素（M2-02）沿用的生成 API。
//   weapon:fire       → 世界中的槍口點光源閃一下（預先建立的固定點光源，只調亮度；槍模上的閃光在 Viewmodel）
//   weapon:hitscan    → 曳光（槍口 → 終點，霰彈依 tracerChance 降量）、命中火花（依表面換顏色）、彈孔貼花
//   weapon:explosion  → 擴散球殼、火花、焦痕、爆炸點光源（鏡頭震動與色差在 main.ts）
//   combat:damage（近戰）→ 火花
//   投射物池（Ballistics.projectiles）→ 每畫面畫電漿球與拖尾（剛射出時外觀往槍口偏）
// 全部是固定容量的 GPU 實例化網格（每種一個 draw call，沒有特效時隱藏），生成時只寫入一個槽位，不配置記憶體。
// 曳光需要「這一畫面」的槍口位置（Viewmodel 在 fx 順序先更新），所以命中事件先排進佇列，render 時才生成。
// 時間以 frame.dt 推進（暫停時凍結）。所有網格在建構時加入世界場景（隱藏），載入預熱時一起編譯。
import * as THREE from 'three';
import type { EventBus } from '@/core/EventBus';
import type { GameEvents } from '@/core/events';
import { SystemOrder, type FrameInfo, type GameSystem } from '@/core/Game';
import { clamp01 } from '@/core/math';
import { Rng } from '@/core/Rng';
import { Decals } from '@/fx/Decals';
import { Explosions } from '@/fx/Explosions';
import { FX_CONFIG, SURFACE_IMPACT, fxStyleFor, type FxConfig, type WeaponFxStyle } from '@/fx/FxConfig';
import { PlasmaBolts, type BoltSource } from '@/fx/PlasmaBolts';
import { FractionalCounter } from '@/fx/ring';
import { Sparks, type SparkSpawn } from '@/fx/Sparks';
import { Tracers, type TracerSpawn } from '@/fx/Tracers';
import { isSurfaceType, type SurfaceType } from '@/physics/SurfaceRegistry';
import type { Vec3Like } from '@/physics/Physics';

/** 槍口位置的來源（Viewmodel 符合）。 */
export interface MuzzleSource {
  muzzleWorld(out: THREE.Vector3): THREE.Vector3;
}

/** 投射物來源（Ballistics 符合）。 */
export interface BoltPool {
  readonly projectiles: { forEachActive(fn: (p: BoltSource & { def: { projectile?: { radius: number } } }) => void): void };
}

export interface WeaponFxOptions {
  scene: THREE.Scene;
  bus?: EventBus<GameEvents> | undefined;
  muzzle?: MuzzleSource | null;
  ballistics?: BoltPool | null;
  /** weaponId → 武器原型（特效風格）；找不到時用 default。 */
  getArchetype?: (weaponId: string) => string | undefined;
  /** 目前畫質（低畫質時火花與曳光減量）。 */
  getQuality?: () => string;
  config?: FxConfig;
  rng?: Rng;
}

export interface ImpactOptions {
  /** 火花數倍率（× 風格與表面的數量）。 */
  scale?: number;
  /** 覆寫顏色與強度（例如元素命中）。 */
  color?: THREE.ColorRepresentation;
  intensity?: number;
  /** 是否留彈孔（預設依表面）。 */
  decal?: boolean;
  /** 特效風格（預設 default）。 */
  style?: WeaponFxStyle;
}

export interface ExplosionOptions {
  color?: THREE.ColorRepresentation;
  intensity?: number;
  sparks?: number;
  scorch?: boolean;
  light?: boolean;
}

interface PendingTracer {
  end: THREE.Vector3;
  style: WeaponFxStyle;
}

const MAX_PENDING = 64;
const _muzzle = new THREE.Vector3();
const _shift = new THREE.Vector3();
const _spark: SparkSpawn = { count: 0, speed: 0, size: 0, life: 0, color: 0xffffff, intensity: 1 };
const _tracer: TracerSpawn = { color: 0xffffff, intensity: 1, width: 0.02, life: 0.1, speed: 0, length: 0 };
const _lift = { x: 0, y: 0, z: 0 };

export class WeaponFx implements GameSystem {
  readonly name = 'weaponFx';
  /** 在 Viewmodel（fx）之後：曳光要用這一畫面的槍口位置。 */
  readonly order = SystemOrder.fx + 10;
  readonly config: FxConfig;
  readonly root = new THREE.Group();
  readonly sparks: Sparks;
  readonly tracers: Tracers;
  readonly decals: Decals;
  readonly explosions: Explosions;
  readonly bolts: PlasmaBolts;
  /** 預先建立的世界點光源（只調亮度；數量固定，不會讓材質重新編譯）。 */
  readonly muzzleLight = new THREE.PointLight(0xffb070, 0, 9, 2);
  readonly explosionLight = new THREE.PointLight(0xb36bff, 0, 14, 2);
  /** 特效時間（s，frame.dt 累加）。 */
  time = 0;
  /** 統計（監看）。 */
  readonly stats = { tracers: 0, impacts: 0, decals: 0, explosions: 0 };
  private readonly options: WeaponFxOptions;
  private readonly rng: Rng;
  private readonly pending: PendingTracer[] = [];
  private pendingCount = 0;
  private readonly tracerCounter = new FractionalCounter();
  private readonly sparkCounter = new FractionalCounter();
  private muzzleFlashAge = Infinity;
  private muzzleFlashPeak = 0;
  private muzzleFlashTime = 0.05;
  private muzzleFlashPending = false;
  private explosionAge = Infinity;
  private explosionPeak = 0;
  private readonly unsubs: (() => void)[] = [];

  constructor(options: WeaponFxOptions) {
    this.options = options;
    this.config = options.config ?? FX_CONFIG;
    this.rng = options.rng ?? new Rng('shardwake:fx');
    const rand = (): number => this.rng.float();
    const c = this.config;
    this.sparks = new Sparks(c.maxSparks, rand);
    this.tracers = new Tracers(c.maxTracers);
    this.decals = new Decals(c.maxDecals, rand);
    this.explosions = new Explosions(c.maxExplosions);
    this.bolts = new PlasmaBolts(c.maxBolts);
    this.root.name = 'fx:weapons';
    this.muzzleLight.name = 'fx:muzzleLight';
    this.explosionLight.name = 'fx:explosionLight';
    this.root.add(this.decals.mesh, this.sparks.mesh, this.tracers.mesh, this.explosions.mesh, this.bolts.mesh, this.muzzleLight, this.explosionLight);
    options.scene.add(this.root);
    for (let i = 0; i < MAX_PENDING; i++) this.pending.push({ end: new THREE.Vector3(), style: fxStyleFor(undefined) });

    const bus = options.bus;
    if (bus) {
      this.unsubs.push(
        bus.on('weapon:fire', ({ weaponId }) => this.onFire(weaponId)),
        bus.on('weapon:hitscan', (e) => this.onHitscan(e)),
        bus.on('weapon:explosion', ({ point, normal, radius }) => this.spawnExplosion(point, normal, radius)),
        bus.on('combat:damage', (d) => {
          if (d.kind === 'melee') this.spawnImpact(d.point, d.normal, 'metal', { scale: 1.5, decal: false });
        }),
      );
    }
  }

  private styleFor(weaponId: string): WeaponFxStyle {
    return fxStyleFor(this.options.getArchetype?.(weaponId));
  }

  private get qualityMult(): number {
    return this.options.getQuality?.() === 'low' ? this.config.lowQualityMult : 1;
  }

  private onFire(weaponId: string): void {
    const style = this.styleFor(weaponId);
    this.muzzleFlashPending = true;
    this.muzzleFlashAge = 0;
    this.muzzleFlashPeak = style.flashLight;
    this.muzzleFlashTime = Math.max(0.02, style.flashTime * 1.2);
    this.muzzleLight.color.set(style.flashColor);
  }

  private onHitscan(e: Readonly<GameEvents['weapon:hitscan']>): void {
    const style = this.styleFor(e.weaponId);
    // 曳光：霰彈依機率降量（低畫質再減半）。
    const chance = style.tracerChance < 1 ? style.tracerChance * this.qualityMult : style.tracerChance;
    if (chance > 0 && this.tracerCounter.take(chance)) {
      if (this.pendingCount < MAX_PENDING) {
        const p = this.pending[this.pendingCount++]!;
        p.end.set(e.end.x, e.end.y, e.end.z);
        p.style = style;
      }
    }
    if (e.hitWorld) {
      const surface: SurfaceType = isSurfaceType(e.surface) ? e.surface : 'metal';
      this.spawnImpact(e.end, e.normal, surface, { style });
    } else if (e.targets > 0) {
      // 打到目標（命中標記與受擊回饋在 M1-12）：少量火花、不留彈孔。
      this.spawnImpact(e.end, e.normal, 'metal', { style, scale: 0.6, decal: false });
    }
  }

  // ── 公開 API（敵人、元素特效沿用）──────────────────────

  /** 命中特效：依表面換顏色的火花，並視表面留彈孔。 */
  spawnImpact(point: Readonly<Vec3Like>, normal: Readonly<Vec3Like>, surface: SurfaceType = 'metal', opts: ImpactOptions = {}): void {
    const style = opts.style ?? fxStyleFor(undefined);
    const surf = SURFACE_IMPACT[surface] ?? SURFACE_IMPACT.metal;
    const count = this.sparkCounter.scale(style.impactSparks * surf.sparks * (opts.scale ?? 1), this.qualityMult);
    if (count > 0) {
      _spark.count = count;
      _spark.speed = style.impactSpeed;
      _spark.speedJitter = 0.6;
      _spark.spread = 0.8;
      _spark.size = style.impactSize;
      _spark.life = style.impactLife;
      _spark.color = opts.color ?? surf.color;
      _spark.intensity = opts.intensity ?? surf.intensity;
      _spark.gravity = 1;
      this.sparks.spawn(this.time, point, normal, _spark);
    }
    const decal = opts.decal ?? surf.decal;
    if (decal && style.decalSize > 0) this.spawnDecal(point, normal, style.decalSize, 1);
    this.stats.impacts++;
  }

  /** 彈孔貼花（size 為直徑，m）。 */
  spawnDecal(point: Readonly<Vec3Like>, normal: Readonly<Vec3Like>, size: number, heat = 1): void {
    this.decals.spawn(this.time, point, normal, size, heat);
    this.stats.decals = this.decals.count;
  }

  /** 曳光（from → to）；style 省略時用 default 風格。 */
  spawnTracer(from: Readonly<Vec3Like>, to: Readonly<Vec3Like>, style: Readonly<WeaponFxStyle> = fxStyleFor(undefined)): void {
    _tracer.color = style.tracerColor;
    _tracer.intensity = style.tracerIntensity;
    _tracer.width = style.tracerWidth;
    _tracer.life = style.tracerLife;
    _tracer.speed = style.tracerSpeed;
    _tracer.length = style.tracerLength;
    this.tracers.spawn(this.time, from, to, _tracer);
    this.stats.tracers++;
  }

  /** 爆炸：擴散球殼、火花、焦痕、閃光點光源。 */
  spawnExplosion(point: Readonly<Vec3Like>, normal: Readonly<Vec3Like>, radius: number, opts: ExplosionOptions = {}): void {
    const c = this.config;
    _lift.x = point.x + normal.x * 0.1;
    _lift.y = point.y + normal.y * 0.1;
    _lift.z = point.z + normal.z * 0.1;
    this.explosions.spawn(this.time, _lift, Math.max(0.3, radius), c.explosionLife, opts.color ?? c.explosionColor, opts.intensity ?? c.explosionIntensity);
    const n = this.sparkCounter.scale(opts.sparks ?? c.explosionSparks, this.qualityMult);
    if (n > 0) {
      _spark.count = n;
      _spark.speed = c.explosionSparkSpeed;
      _spark.speedJitter = 0.7;
      _spark.spread = 1.4;
      _spark.size = 0.03;
      _spark.life = 0.6;
      _spark.color = c.boltSparkColor;
      _spark.intensity = 6;
      _spark.gravity = 0.6;
      this.sparks.spawn(this.time, point, normal, _spark);
    }
    if (opts.scorch ?? true) {
      const size = radius * c.explosionScorch * 2;
      if (size > 0) this.spawnDecal(point, normal, size, c.explosionScorchHeat);
    }
    if (opts.light ?? true) {
      this.explosionAge = 0;
      this.explosionPeak = c.explosionLight;
      this.explosionLight.color.set(opts.color ?? c.explosionColor);
      this.explosionLight.position.set(_lift.x + normal.x * 0.4, _lift.y + normal.y * 0.4, _lift.z + normal.z * 0.4);
    }
    this.stats.explosions++;
  }

  render(alpha: number, frame: Readonly<FrameInfo>): void {
    this.advance(frame.dt, alpha);
  }

  /** 推進 dt 秒並更新所有特效（無頭測試直接呼叫）。 */
  advance(dt: number, alpha = 1): void {
    if (dt > 0) this.time += dt;
    const c = this.config;
    const muzzle = this.options.muzzle;
    // 排隊的曳光：從這一畫面的槍口出發。
    if (this.pendingCount > 0 || this.muzzleFlashPending) {
      if (muzzle) muzzle.muzzleWorld(_muzzle);
      else _muzzle.set(0, 0, 0);
      for (let i = 0; i < this.pendingCount; i++) {
        const p = this.pending[i]!;
        this.spawnTracer(_muzzle, p.end, p.style);
      }
      this.pendingCount = 0;
      if (this.muzzleFlashPending) {
        this.muzzleLight.position.copy(_muzzle);
        this.muzzleFlashPending = false;
      }
    }
    // 槍口與爆炸點光源（固定存在，只調亮度）。
    this.muzzleFlashAge += dt;
    const mf = this.muzzleFlashAge < this.muzzleFlashTime ? 1 - this.muzzleFlashAge / this.muzzleFlashTime : 0;
    this.muzzleLight.intensity = this.muzzleFlashPeak * mf;
    this.muzzleLight.distance = c.muzzleLightDistance;
    this.explosionAge += dt;
    const ef = clamp01(1 - this.explosionAge / Math.max(0.01, c.explosionLightTime));
    this.explosionLight.intensity = this.explosionPeak * ef * ef;
    this.explosionLight.distance = c.explosionLightDistance;

    // 電漿投射物。
    const bolts = this.bolts;
    bolts.begin();
    const pool = this.options.ballistics?.projectiles;
    if (pool) {
      let haveMuzzle = false;
      pool.forEachActive((p) => {
        if (!haveMuzzle) {
          if (muzzle) muzzle.muzzleWorld(_muzzle);
          else _muzzle.set(p.origin.x, p.origin.y, p.origin.z);
          haveMuzzle = true;
        }
        const radius = Math.max(0.05, p.def.projectile?.radius ?? 0.15) * c.boltGlowScale;
        _shift.set(_muzzle.x - p.origin.x, _muzzle.y - p.origin.y, _muzzle.z - p.origin.z);
        const dx = p.position.x - p.origin.x;
        const dy = p.position.y - p.origin.y;
        const dz = p.position.z - p.origin.z;
        const w = clamp01(1 - Math.hypot(dx, dy, dz) / 8);
        bolts.add(p, alpha, radius, c.boltTrail, c.boltColor, c.boltIntensity, _shift, w * w);
      });
    }
    bolts.end();

    this.sparks.update(this.time, c.sparkGravity, c.sparkStretch);
    this.tracers.update(this.time);
    this.decals.update(this.time, c.decalHeatTime, c.decalLift);
    this.explosions.update(this.time);
  }

  /** 清除所有特效（換關卡、重設）。 */
  clear(): void {
    this.sparks.clear();
    this.tracers.clear();
    this.decals.clear();
    this.explosions.clear();
    this.pendingCount = 0;
    this.stats.decals = 0;
  }

  dispose(): void {
    for (const u of this.unsubs.splice(0)) u();
    this.root.removeFromParent();
    this.sparks.dispose();
    this.tracers.dispose();
    this.decals.dispose();
    this.explosions.dispose();
    this.bolts.dispose();
  }
}
