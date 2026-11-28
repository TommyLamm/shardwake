// M1-12 靶標、玩家受擊與戰鬥回饋：傷害管線、靶標、無人機與能量球、玩家生命、DPS 計、命中回饋的純邏輯。
import { beforeAll, describe, expect, it } from 'vitest';
import { computeDamage, copyDamageInfo, createDamageInfo, damageSourcePosition, falloffMultiplier, splashMultiplier, type DamageInfo } from '@/combat/Damage';
import { DpsMeter, estimateWeaponDps } from '@/combat/DpsMeter';
import { HitConfirm, HitConfirmSystem, hitKindOf, strongerHit } from '@/combat/HitConfirm';
import { HostileBolts } from '@/combat/HostileBolts';
import { NEVER, PLAYER_HEALTH_PANEL, PlayerHealth, defaultPlayerHealthConfig } from '@/combat/PlayerHealth';
import { closestSegmentParams, pointSegmentDistanceSq, sweepSphereCapsule } from '@/combat/sweep';
import { dpsBoardLines } from '@/combat/targets/DpsBoard';
import {
  DRONE_PANEL,
  DUMMY_PANEL,
  FLASH_PANEL,
  MAX_DRONES,
  MOVER_PANEL,
  TARGET_CONFIG,
  TRAINING_TARGET_LAYOUT,
  defaultTargetConfig,
  type TargetLayout,
} from '@/combat/targets/TargetConfig';
import { TargetManager, type TargetPlayerInfo } from '@/combat/targets/TargetManager';
import { DummyTarget } from '@/combat/targets/Targets';
import { DroneMotion, RailMotion, TargetLife } from '@/combat/targets/targetMath';
import { DRONE_SHAPE, DUMMY_SHAPE, buildDroneBodyGeometry, buildDummyBodyGeometry } from '@/combat/targets/TargetVisuals';
import { EventBus } from '@/core/EventBus';
import type { GameEvents } from '@/core/events';
import { DEG2RAD } from '@/core/math';
import { Rng } from '@/core/Rng';
import { SETTINGS_SCHEMA, defaultSettings, parseSettings } from '@/core/Settings';
import { Physics, type Vec3Like } from '@/physics/Physics';
import {
  DAMAGE_NUMBER_PANEL,
  FEEDBACK_CONFIG,
  HIT_CAMERA_PANEL,
  HIT_MARKER_PANEL,
  INDICATOR_PANEL,
  SCREEN_DAMAGE_PANEL,
  defaultFeedbackConfig,
} from '@/ui/FeedbackConfig';
import {
  DamageIndicatorModel,
  DamageNumberModel,
  damageIndicatorAngle,
  damageNumberStyle,
  formatDamage,
  hitMarkerStyle,
  hitTrauma,
  lowHealthIntensity,
} from '@/ui/feedbackMath';
import { ARCHETYPES, createArchetype, defaultLoadout } from '@/weapons/archetypes';
import { Ballistics, type ShotContext } from '@/weapons/Ballistics';
import type { WeaponDef } from '@/weapons/WeaponDef';
import { WeaponSim, addWall } from './helpers/weaponSim';

beforeAll(async () => {
  await Physics.init();
});

const RATES = [60, 120, 240] as const;

// ── 共用工具 ─────────────────────────────────────────────

/** 不散布、不後座的武器（命中判定精確打在準心）。 */
function steady(id: string, mutate?: (d: WeaponDef) => void): WeaponDef {
  const d = createArchetype(id)!;
  d.spread.hip = d.spread.ads = d.spread.perShot = d.spread.max = 0;
  d.recoil.pitchPerShot = [0, 0];
  d.recoil.yawPerShot = [0, 0];
  d.recoil.yawBias = 0;
  d.recoil.maxClimb = 0;
  mutate?.(d);
  return d;
}

function loadoutWith(first: WeaponDef): WeaponDef[] {
  const l = defaultLoadout();
  l[0] = first;
  return l;
}

const EYE = { x: 0, y: 1.65, z: 0 };

/** 只有一個假人（腳底 (0, 0, -distance)）的佈置；其餘清空。 */
function layoutWithDummy(distance: number, extra: Partial<TargetLayout> = {}): TargetLayout {
  return {
    dummies: [{ id: 'd0', pos: [0, 0, -distance], yaw: 0 }],
    rails: [],
    arena: { zoneId: 'arena', min: [-40, 1, -40], max: [40, 20, 40], home: [[0, 8, -30]] },
    board: TRAINING_TARGET_LAYOUT.board,
    ...extra,
  };
}

/** 從 EYE 看向 (0, y, -distance) 的 pitch。 */
function pitchTo(y: number, distance: number): number {
  return Math.atan2(y - EYE.y, distance);
}

function shotContext(def: WeaponDef, shotId = 1): ShotContext {
  return { shotId, weaponId: def.id, source: 'player', def, perks: [], perkCtx: null };
}

/** 玩家資訊（腳底 feet、站姿 1.8 m、半徑 0.35）。 */
function playerAt(feet: Vec3Like): TargetPlayerInfo & { feet: Vec3Like } {
  return {
    feet,
    height: 1.8,
    radius: 0.35,
    get center() {
      return { x: feet.x, y: feet.y + 0.9, z: feet.z };
    },
    get eye() {
      return { x: feet.x, y: feet.y + 1.65, z: feet.z };
    },
  };
}

// ── 傷害計算管線 ─────────────────────────────────────────

describe('傷害計算管線（computeDamage）', () => {
  const base = { base: 20, distance: 0, falloffStart: 10, falloffEnd: 30, minMult: 0.5, critMult: 2, zone: 'body' as const };

  it('爆頭倍率：弱點 × critMult，身體不變；部位倍率乘在最後', () => {
    expect(computeDamage(base).amount).toBe(20);
    const crit = computeDamage({ ...base, zone: 'crit' });
    expect(crit.isCrit).toBe(true);
    expect(crit.crit).toBe(2);
    expect(crit.amount).toBe(40);
    expect(computeDamage({ ...base, zone: 'crit', zoneMultiplier: 1.5 }).amount).toBe(60);
    expect(computeDamage({ ...base, zoneMultiplier: 0.5 }).amount).toBe(10);
  });

  it('距離衰減：start 內全額、中間線性、end 外 minMult；與 falloffMultiplier 一致', () => {
    expect(computeDamage({ ...base, distance: 5 }).amount).toBe(20);
    expect(computeDamage({ ...base, distance: 10 }).amount).toBe(20);
    expect(computeDamage({ ...base, distance: 20 }).amount).toBeCloseTo(15, 12);
    expect(computeDamage({ ...base, distance: 30 }).amount).toBe(10);
    expect(computeDamage({ ...base, distance: 500 }).amount).toBe(10);
    // 爆頭與衰減相乘。
    expect(computeDamage({ ...base, distance: 20, zone: 'crit' }).amount).toBeCloseTo(30, 12);
    for (const d of [0, 7, 12.5, 29.9, 31]) expect(computeDamage({ ...base, distance: d }).falloff).toBe(falloffMultiplier(d, 10, 30, 0.5));
  });

  it('範圍傷害：中心 1、半徑處 minMult、線性；不算弱點也不套用距離衰減', () => {
    const splash = { radius: 4, minMult: 0.25 };
    const at = (d: number, zone: 'body' | 'crit' = 'body') => computeDamage({ ...base, base: 70, distance: d, zone, splash });
    expect(at(0).amount).toBe(70);
    expect(at(2).amount).toBeCloseTo(70 * 0.625, 12);
    expect(at(4).amount).toBeCloseTo(70 * 0.25, 12);
    expect(at(9).amount).toBeCloseTo(70 * 0.25, 12);
    expect(at(2, 'crit').isCrit).toBe(false);
    expect(at(2, 'crit').amount).toBeCloseTo(70 * 0.625, 12);
    expect(splashMultiplier(1, 4, 0.25)).toBeCloseTo(0.8125, 12);
  });

  it('damageSourcePosition 由命中點、方向、距離倒推出攻擊者位置', () => {
    const info = createDamageInfo();
    Object.assign(info.point, { x: 1, y: 2, z: -10 });
    Object.assign(info.dir, { x: 0, y: 0, z: -1 });
    info.distance = 10;
    expect(damageSourcePosition(info, { x: 0, y: 0, z: 0 })).toEqual({ x: 1, y: 2, z: 0 });
  });
});

// ── Ballistics × 假人 ───────────────────────────────────

describe('假人受擊（Rapier）', () => {
  function rangeWith(distance: number) {
    const physics = new Physics();
    const bus = new EventBus<GameEvents>();
    const bal = new Ballistics({ physics, bus });
    const targets = new TargetManager({ physics, bus, layout: layoutWithDummy(distance), config: defaultTargetConfig(), dronesEnabled: () => false });
    targets.build();
    const damage: DamageInfo[] = [];
    bus.on('combat:damage', (d) => damage.push(copyDamageInfo(d)));
    return { physics, bus, bal, targets, damage, dummy: targets.dummies[0]! };
  }

  it('頭部是弱點：步槍爆頭 18 × 1.8，身體 18；10 m 內不衰減', () => {
    const r = rangeWith(10);
    const def = steady('assault_rifle');
    const dir = { x: 0, y: 0, z: -1 };
    const toHead = { x: 0, y: DUMMY_SHAPE.headY - EYE.y, z: -10 };
    const l = Math.hypot(toHead.y, toHead.z);
    r.bal.hitscan(EYE, { x: 0, y: toHead.y / l, z: toHead.z / l }, shotContext(def));
    const toBody = { y: DUMMY_SHAPE.torsoY - EYE.y, z: -10 };
    const lb = Math.hypot(toBody.y, toBody.z);
    r.bal.hitscan(EYE, { x: 0, y: toBody.y / lb, z: toBody.z / lb }, shotContext(def, 2));
    expect(r.damage).toHaveLength(2);
    expect(r.damage[0]!.zone).toBe('crit');
    expect(r.damage[0]!.isCrit).toBe(true);
    expect(r.damage[0]!.amount).toBeCloseTo(18 * 1.8, 9);
    expect(r.damage[1]!.zone).toBe('body');
    expect(r.damage[1]!.amount).toBe(18);
    expect(r.damage[0]!.target).toBe(r.dummy);
    expect(r.dummy.life.health).toBeCloseTo(1000 - 18 * 1.8 - 18, 9);
    void dir;
    r.physics.dispose();
  });

  it('距離衰減：步槍在 45 m 打身體 = 18 × 0.8；手炮在 75 m 爆頭 = 60 × 0.7 × 2', () => {
    const r = rangeWith(45);
    const def = steady('assault_rifle');
    const y = DUMMY_SHAPE.torsoY - EYE.y;
    const l = Math.hypot(y, 45);
    r.bal.hitscan(EYE, { x: 0, y: y / l, z: -45 / l }, shotContext(def));
    expect(r.damage[0]!.amount).toBeCloseTo(18 * falloffMultiplier(r.damage[0]!.distance, 30, 60, 0.6), 9);
    expect(r.damage[0]!.amount).toBeLessThan(18 * 0.82);
    expect(r.damage[0]!.amount).toBeGreaterThan(18 * 0.78);
    r.physics.dispose();
    const r2 = rangeWith(75);
    const hc = steady('hand_cannon');
    const hy = DUMMY_SHAPE.headY - EYE.y;
    const hl = Math.hypot(hy, 75);
    r2.bal.hitscan(EYE, { x: 0, y: hy / hl, z: -75 / hl }, shotContext(hc));
    expect(r2.damage[0]!.zone).toBe('crit');
    expect(r2.damage[0]!.amount).toBeCloseTo(60 * 0.7 * 2, 9);
    r2.physics.dispose();
  });

  it('範圍傷害：電漿爆炸點在假人前 1 m，依「爆炸點 → 假人中心」距離衰減', () => {
    const r = rangeWith(10);
    const pl = createArchetype('plasma_launcher')!;
    const pd = pl.projectile!;
    const center = r.dummy.getCenter({ x: 0, y: 0, z: 0 });
    const blast = { x: 0, y: center.y, z: -9 };
    r.bal.explode(blast, { x: 0, y: 0, z: 1 }, pd.splashRadius, pd, shotContext(pl));
    expect(r.damage).toHaveLength(1);
    const d = Math.hypot(0, 0, center.z - (blast.z + r.bal.config.explosionLift));
    expect(r.damage[0]!.kind).toBe('splash');
    expect(r.damage[0]!.isCrit).toBe(false);
    expect(r.damage[0]!.amount).toBeCloseTo(pd.splashDamage * splashMultiplier(d, pd.splashRadius, pd.splashMinMult), 9);
    r.physics.dispose();
  });

  it('擊殺後倒下、不再擋子彈；1.5 s 後重置回滿；2.5 s 未受傷回滿（與步長無關）', () => {
    for (const hz of RATES) {
      const r = rangeWith(10);
      const killed: string[] = [];
      const resets: string[] = [];
      r.bus.on('target:killed', (e) => killed.push(`${e.id}:${e.kind}`));
      r.bus.on('target:reset', (e) => resets.push(e.id));
      const dummy = r.dummy;
      const dt = 1 / hz;
      // 受傷後 2.4 s 還沒回滿、2.5 s 回滿。
      const info = createDamageInfo();
      info.amount = 300;
      dummy.applyDamage(info);
      for (let i = 0; i < Math.round(2.4 * hz); i++) r.targets.step(dt);
      expect(dummy.life.health).toBe(700);
      for (let i = 0; i < Math.round(0.11 * hz); i++) r.targets.step(dt);
      expect(dummy.life.health).toBe(1000);
      // 擊殺：一發 1000。
      info.amount = 1200;
      info.dir.z = -1;
      const out = dummy.applyDamage(info);
      expect(out).toEqual({ dealt: 1000, killed: true });
      expect(dummy.alive).toBe(false);
      expect(killed).toEqual(['d0:dummy']);
      // 死亡的假人不擋子彈。
      const def = steady('assault_rifle');
      const res = r.bal.hitscan(EYE, { x: 0, y: 0, z: -1 }, shotContext(def));
      expect(res.targetCount).toBe(0);
      for (let i = 0; i < Math.round(0.4 * hz); i++) r.targets.step(dt);
      expect(dummy.fall).toBe(1);
      for (let i = 0; i < Math.round(1.0 * hz); i++) r.targets.step(dt);
      expect(dummy.alive).toBe(false);
      for (let i = 0; i < Math.round(0.11 * hz); i++) r.targets.step(dt);
      expect(dummy.alive).toBe(true);
      expect(dummy.life.health).toBe(1000);
      expect(resets).toEqual(['d0']);
      r.physics.dispose();
    }
  });

  it('調參面板改血量：applyConfig 後存活的假人回滿到新上限', () => {
    const r = rangeWith(10);
    r.targets.config.dummy.maxHealth = 2500;
    r.targets.applyConfig();
    expect(r.dummy.life.health).toBe(2500);
    r.targets.config.dummy.headMultiplier = 2;
    r.targets.applyConfig();
    const def = steady('assault_rifle');
    const y = DUMMY_SHAPE.headY - EYE.y;
    const l = Math.hypot(y, 10);
    r.bal.hitscan(EYE, { x: 0, y: y / l, z: -10 / l }, shotContext(def));
    expect(r.damage[0]!.amount).toBeCloseTo(18 * 1.8 * 2, 9);
    r.physics.dispose();
  });
});

// ── 靶標純邏輯 ───────────────────────────────────────────

describe('TargetLife／RailMotion／DroneMotion', () => {
  it('TargetLife：受傷、擊殺、重置；不回復時（Infinity）不回滿', () => {
    const life = new TargetLife({ maxHealth: 150, regenDelay: Infinity, resetDelay: 5 });
    expect(life.damage(100)).toEqual({ dealt: 100, killed: false });
    for (let i = 0; i < 1200; i++) life.step(1 / 120);
    expect(life.health).toBe(50);
    expect(life.damage(80)).toEqual({ dealt: 50, killed: true });
    expect(life.damage(10)).toEqual({ dealt: 0, killed: false });
    let ev: string | null = null;
    let t = 0;
    while (!ev && t < 10) {
      ev = life.step(1 / 120);
      t += 1 / 120;
    }
    expect(ev).toBe('reset');
    expect(t).toBeCloseTo(5, 1);
    expect(life.health).toBe(150);
  });

  it('移動靶：留在軌道內、速度在 3–8 m/s、會隨機變向；60 與 240 Hz 軌跡一致', () => {
    const cfg = TARGET_CONFIG.mover;
    const run = (hz: number) => {
      const m = new RailMotion(-10, 10, new Rng('rail'), cfg, 0);
      const xs: number[] = [];
      let flips = 0;
      let lastDir = m.dir;
      for (let i = 0; i < 20 * hz; i++) {
        m.step(1 / hz, cfg);
        expect(m.x).toBeGreaterThanOrEqual(-10);
        expect(m.x).toBeLessThanOrEqual(10);
        expect(m.speed).toBeGreaterThanOrEqual(3);
        expect(m.speed).toBeLessThanOrEqual(8);
        if (m.dir !== lastDir) flips++;
        lastDir = m.dir;
        if (i % hz === hz - 1) xs.push(m.x);
      }
      return { xs, flips };
    };
    const a = run(60);
    const b = run(240);
    expect(a.flips).toBeGreaterThan(5);
    for (let i = 0; i < a.xs.length; i++) expect(b.xs[i]!).toBeCloseTo(a.xs[i]!, 6);
  });

  it('無人機：繞玩家 12–25 m、高度 6–11 m、留在戰區內、彼此保持距離', () => {
    const cfg = TARGET_CONFIG.drone;
    const bounds = { min: [-60, 1, -60] as const, max: [60, 20, 60] as const };
    const player = { x: 0, y: 0.9, z: 0 };
    const drones = [0, 1, 2].map((i) => new DroneMotion({ x: i * 6, y: 8, z: -30 }, new Rng(`d${i}`), cfg, (i * Math.PI * 2) / 3));
    let minSep = Infinity;
    const radii: number[] = [];
    for (let i = 0; i < 120 * 30; i++) {
      for (const d of drones) d.step(1 / 120, cfg, player, { x: 0, y: 8, z: -30 }, bounds, drones.filter((o) => o !== d).map((o) => o.position));
      if (i > 120 * 6) {
        for (const d of drones) {
          radii.push(Math.hypot(d.position.x, d.position.z));
          expect(d.position.y).toBeGreaterThan(cfg.heightMin - 1.5);
          expect(d.position.y).toBeLessThan(cfg.heightMax + 1.5);
        }
        for (let a = 0; a < 3; a++)
          for (let b = a + 1; b < 3; b++) {
            const p = drones[a]!.position;
            const q = drones[b]!.position;
            minSep = Math.min(minSep, Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z));
          }
      }
    }
    expect(Math.min(...radii)).toBeGreaterThan(cfg.orbitRadiusMin - 3);
    expect(Math.max(...radii)).toBeLessThan(cfg.orbitRadiusMax + 3);
    expect(minSep).toBeGreaterThan(2);
    // 範圍外的玩家：目標點夾在戰區內。
    const d = new DroneMotion({ x: 0, y: 8, z: 0 }, new Rng('x'), cfg);
    const small = { min: [-5, 1, -5] as const, max: [5, 10, 5] as const };
    for (let i = 0; i < 600; i++) d.step(1 / 120, cfg, { x: 100, y: 0, z: 100 }, { x: 0, y: 8, z: 0 }, small);
    expect(d.position.x).toBeLessThanOrEqual(5);
    expect(d.position.z).toBeLessThanOrEqual(5);
  });

  it('外觀幾何：假人與無人機都能合併；受擊碰撞體與外觀尺寸一致', () => {
    const g = buildDummyBodyGeometry(false);
    g.computeBoundingBox();
    expect(g.boundingBox!.max.y).toBeCloseTo(DUMMY_SHAPE.headY + DUMMY_SHAPE.headRadius, 2);
    expect(g.boundingBox!.max.x).toBeLessThanOrEqual(0.39);
    const dg = buildDroneBodyGeometry();
    dg.computeBoundingBox();
    expect(dg.boundingBox!.max.z).toBeLessThan(DRONE_SHAPE.coreOffset + DRONE_SHAPE.coreRadius + 0.05);
    expect(DRONE_SHAPE.coreOffset + DRONE_SHAPE.coreRadius).toBeGreaterThan(DRONE_SHAPE.bodyRadius);
  });
});

// ── 掃掠與能量球 ─────────────────────────────────────────

describe('能量球（sweep 與 HostileBolts）', () => {
  it('pointSegmentDistance／closestSegmentParams 正確', () => {
    const a = { x: 0, y: 0, z: 0 };
    const b = { x: 0, y: 2, z: 0 };
    expect(pointSegmentDistanceSq(1, 1, 0, a, b)).toBeCloseTo(1, 12);
    expect(pointSegmentDistanceSq(0, 5, 0, a, b)).toBeCloseTo(9, 12);
    const c = closestSegmentParams({ x: -1, y: 1, z: 1 }, { x: 1, y: 1, z: 1 }, a, b);
    expect(c.s).toBeCloseTo(0.5, 12);
    expect(c.t).toBeCloseTo(0.5, 12);
    expect(c.distSq).toBeCloseTo(1, 12);
  });

  it('sweepSphereCapsule 與暴力取樣一致，起點重疊回傳 0，錯開回傳 null', () => {
    const a = { x: 0, y: 0.35, z: 0 };
    const b = { x: 0, y: 1.45, z: 0 };
    const rng = new Rng('sweep');
    for (let k = 0; k < 200; k++) {
      const from = { x: rng.range(-3, 3), y: rng.range(-1, 3), z: rng.range(2, 4) };
      const seg = { x: rng.range(-3, 3), y: rng.range(-1, 1), z: rng.range(-6, -2) };
      const t = sweepSphereCapsule(from, seg, 0.3, a, b, 0.35);
      let brute: number | null = null;
      for (let i = 0; i <= 4000; i++) {
        const s = i / 4000;
        if (pointSegmentDistanceSq(from.x + seg.x * s, from.y + seg.y * s, from.z + seg.z * s, a, b) <= 0.65 * 0.65) {
          brute = s;
          break;
        }
      }
      if (brute === null) expect(t).toBeNull();
      else expect(Math.abs(t! - brute)).toBeLessThan(5e-4);
    }
    expect(sweepSphereCapsule({ x: 0.2, y: 1, z: 0 }, { x: 0, y: 0, z: -1 }, 0.3, a, b, 0.35)).toBe(0);
  });

  it('打中靜止的玩家：傷害進 PlayerHealth、發出 combat:damage 與 enemy:projectile；命中位置與步長無關', () => {
    const hits = RATES.map((hz) => {
      const bus = new EventBus<GameEvents>();
      const health = new PlayerHealth({ bus, config: defaultPlayerHealthConfig() });
      const p = playerAt({ x: 0, y: 0, z: 0 });
      const cap = { a: { x: 0, y: 0.35, z: 0 }, b: { x: 0, y: 1.45, z: 0 }, radius: 0.35 };
      const bolts = new HostileBolts({ bus, getPlayerCapsule: () => cap, getPlayerTarget: () => health });
      const dmg: DamageInfo[] = [];
      const phases: string[] = [];
      let hitZ = NaN;
      bus.on('combat:damage', (d) => dmg.push(copyDamageInfo(d)));
      bus.on('enemy:projectile', (e) => {
        phases.push(e.phase);
        hitZ = e.position.z;
      });
      bolts.spawn('drone-0', { x: 0, y: 1, z: -18 }, { x: 0, y: 0, z: 1 }, 18, 15, 0.3, 4);
      let t = 0;
      while (bolts.activeCount > 0 && t < 3) {
        bolts.step(1 / hz);
        t += 1 / hz;
      }
      expect(dmg).toHaveLength(1);
      expect(dmg[0]!.target).toBe(health);
      expect(dmg[0]!.source).toBe('drone-0');
      expect(health.state.shield).toBe(85);
      expect(phases).toEqual(['hitPlayer']);
      void p;
      // 傷害來源位置（受擊方向指示）倒推回發射點。
      expect(damageSourcePosition(dmg[0]!, { x: 0, y: 0, z: 0 }).z).toBeCloseTo(-18, 6);
      expect(t).toBeCloseTo((18 - 0.65) / 18, 1);
      return hitZ;
    });
    // 接觸時球心離膠囊軸 0.65 m（球半徑 0.3 + 膠囊 0.35）。
    for (const z of hits) expect(z).toBeCloseTo(-0.65, 3);
  });

  it('掩體擋得住；側移 10 m/s 的玩家（Dash、滑鏟、跑牆的速度都更快）可以閃開', () => {
    const physics = new Physics();
    addWall(physics, { x: 0, y: 1, z: -5 }, { x: 2, y: 2, z: 0.2 });
    const bus = new EventBus<GameEvents>();
    const health = new PlayerHealth({ bus, config: defaultPlayerHealthConfig() });
    const cap = { a: { x: 0, y: 0.35, z: 0 }, b: { x: 0, y: 1.45, z: 0 }, radius: 0.35 };
    const bolts = new HostileBolts({ physics, bus, getPlayerCapsule: () => cap, getPlayerTarget: () => health });
    const phases: string[] = [];
    bus.on('enemy:projectile', (e) => phases.push(e.phase));
    bolts.spawn('drone-0', { x: 0, y: 1, z: -18 }, { x: 0, y: 0, z: 1 }, 18, 15, 0.3, 4);
    for (let i = 0; i < 240; i++) bolts.step(1 / 120);
    expect(phases).toEqual(['impact']);
    expect(health.state.shield).toBe(100);
    physics.dispose();
    // 閃避：能量球對準起點，玩家以 10 m/s 側移。
    const bolts2 = new HostileBolts({ bus, getPlayerCapsule: () => cap, getPlayerTarget: () => health });
    phases.length = 0;
    bolts2.spawn('drone-0', { x: 0, y: 1, z: -15 }, { x: 0, y: 0, z: 1 }, 18, 15, 0.3, 2);
    for (let i = 0; i < 260; i++) {
      cap.a.x += 10 / 120;
      cap.b.x += 10 / 120;
      bolts2.step(1 / 120);
    }
    expect(phases).toEqual(['expire']);
    expect(health.state.shield).toBe(100);
  });
});

// ── 訓練無人機（TargetManager × Rapier）─────────────────

describe('訓練無人機', () => {
  function arena(opts: { enabled?: boolean; zone?: string | null; count?: number; onRespawn?: () => void } = {}) {
    const physics = new Physics();
    const bus = new EventBus<GameEvents>();
    const cfg = defaultTargetConfig();
    cfg.drone.count = opts.count ?? 2;
    const health = new PlayerHealth({ bus, config: defaultPlayerHealthConfig(), ...(opts.onRespawn ? { onRespawn: opts.onRespawn } : {}) });
    const feet = { x: 0, y: 0, z: 0 };
    const player = playerAt(feet);
    let zone: string | null = opts.zone === undefined ? 'arena' : opts.zone;
    const layout: TargetLayout = {
      ...layoutWithDummy(10),
      dummies: [],
      arena: { zoneId: 'arena', min: [-40, 1, -40], max: [40, 20, 40], home: [[-10, 8, -30], [10, 8, -30], [0, 9, -32]] },
    };
    const targets = new TargetManager({
      physics,
      bus,
      config: cfg,
      layout,
      getPlayer: () => (health.alive ? player : null),
      getPlayerTarget: () => health,
      getZoneId: () => zone,
      dronesEnabled: () => opts.enabled ?? true,
    });
    targets.build();
    const fires: string[] = [];
    bus.on('enemy:fire', (e) => fires.push(e.source));
    const run = (seconds: number, hz = 120) => {
      for (let i = 0; i < Math.round(seconds * hz); i++) {
        targets.step(1 / hz);
        health.step(1 / hz);
        physics.step(1 / hz);
      }
    };
    return { physics, bus, targets, health, fires, run, setZone: (z: string | null) => (zone = z), feet, cfg };
  }

  it('預先建立 6 架、依數量與設定啟用；不在戰區時不開火', () => {
    const a = arena({ zone: null, count: 2 });
    expect(a.targets.drones).toHaveLength(MAX_DRONES);
    expect(a.targets.drones.filter((d) => d.active)).toHaveLength(2);
    a.run(6);
    expect(a.fires).toHaveLength(0);
    a.cfg.drone.count = 4;
    a.targets.applyConfig();
    a.run(0.01);
    expect(a.targets.drones.filter((d) => d.active)).toHaveLength(4);
    a.physics.dispose();
    const off = arena({ enabled: false });
    off.run(4);
    expect(off.targets.drones.filter((d) => d.active)).toHaveLength(0);
    expect(off.fires).toHaveLength(0);
    off.physics.dispose();
  });

  it('進入戰區：每架約每 1.5 s 發一顆 18 m/s 的能量球，打中靜止的玩家', () => {
    const a = arena({ count: 2 });
    a.health.config.invulnerable = true;
    const damaged: number[] = [];
    a.bus.on('player:damaged', (e) => damaged.push(e.amount));
    a.run(10.5);
    const per = (id: string) => a.fires.filter((f) => f === id).length;
    // 首發延遲 0.6–1.6 s，之後 1.5 s 一發：10.5 s 內 6–7 發。
    expect(per('drone-0')).toBeGreaterThanOrEqual(6);
    expect(per('drone-0')).toBeLessThanOrEqual(7);
    expect(per('drone-1')).toBeGreaterThanOrEqual(6);
    expect(damaged.length).toBeGreaterThanOrEqual(8);
    expect(damaged.every((x) => x === 15)).toBe(true);
    // 無人機在玩家 12–25 m（± 加速過渡）。
    for (const d of a.targets.drones.filter((x) => x.active)) {
      const r = Math.hypot(d.position.x - a.feet.x, d.position.z - a.feet.z);
      expect(r).toBeGreaterThan(8);
      expect(r).toBeLessThan(28);
    }
    a.physics.dispose();
  });

  it('核心是弱點；150 HP 擊毀後爆炸事件、碰撞體關閉，5 s 後重生', () => {
    const a = arena({ count: 1, zone: null });
    const drone = a.targets.drones[0]!;
    a.run(0.1);
    const killed: string[] = [];
    const reset: string[] = [];
    a.bus.on('target:killed', (e) => killed.push(e.kind));
    a.bus.on('target:reset', (e) => reset.push(e.id));
    const bal = new Ballistics({ physics: a.physics, bus: a.bus });
    const dmg: DamageInfo[] = [];
    a.bus.on('combat:damage', (d) => dmg.push(copyDamageInfo(d)));
    // 從核心正前方 10 m 射擊（無人機面向移動方向；用 facing 決定位置）。
    const core = drone.corePosition({ x: 0, y: 0, z: 0 });
    const f = drone.facing;
    const from = { x: core.x + f.x * 10, y: core.y + f.y * 10, z: core.z + f.z * 10 };
    const def = steady('hand_cannon');
    a.physics.syncQueries();
    bal.hitscan(from, { x: -f.x, y: -f.y, z: -f.z }, shotContext(def));
    expect(dmg[0]!.zone).toBe('crit');
    expect(dmg[0]!.amount).toBeCloseTo(120, 9);
    // 從側面打身體。
    const side = { x: f.z, y: 0, z: -f.x };
    const c = drone.getCenter({ x: 0, y: 0, z: 0 });
    bal.hitscan({ x: c.x + side.x * 10, y: c.y, z: c.z + side.z * 10 }, { x: -side.x, y: 0, z: -side.z }, shotContext(def, 2));
    expect(dmg[1]!.zone).toBe('body');
    expect(dmg[1]!.isKill).toBe(true);
    expect(killed).toEqual(['drone']);
    expect(drone.alive).toBe(false);
    a.physics.syncQueries();
    const miss = bal.hitscan({ x: c.x + side.x * 10, y: c.y, z: c.z + side.z * 10 }, { x: -side.x, y: 0, z: -side.z }, shotContext(def, 3));
    expect(miss.targetCount).toBe(0);
    a.run(4.9);
    expect(drone.alive).toBe(false);
    a.run(0.2);
    expect(drone.alive).toBe(true);
    expect(drone.life.health).toBe(150);
    expect(reset).toEqual(['drone-0']);
    a.physics.dispose();
  });

  it('玩家被打到死亡：0.8 s 淡出後重生（onRespawn）、護盾與生命回滿；死亡中無人機不開火', () => {
    let respawns = 0;
    const a = arena({ count: 3, onRespawn: () => respawns++ });
    a.cfg.drone.boltDamage = 60;
    const health = a.health;
    const died: number[] = [];
    a.bus.on('player:died', (e) => died.push(e.deaths));
    let t = 0;
    while (health.alive && t < 20) {
      a.run(1 / 120);
      t += 1 / 120;
    }
    expect(died).toEqual([1]);
    expect(health.state.dying).toBe(true);
    const firesAtDeath = a.fires.length;
    a.run(0.78);
    expect(respawns).toBe(0);
    expect(a.fires.length).toBe(firesAtDeath);
    expect(health.state.fade).toBeGreaterThan(0.95);
    a.run(0.03);
    expect(respawns).toBe(1);
    expect(health.alive).toBe(true);
    expect(health.state.shield).toBe(100);
    expect(health.state.health).toBe(100);
    a.physics.dispose();
  });
});

// ── 玩家生命 ─────────────────────────────────────────────

describe('PlayerHealth', () => {
  function hit(h: PlayerHealth, amount: number, from: Vec3Like = { x: -10, y: 1, z: 0 }): void {
    const info = createDamageInfo();
    info.amount = amount;
    Object.assign(info.point, { x: 0, y: 1, z: 0 });
    const l = Math.hypot(-from.x, 1 - from.y, -from.z) || 1;
    Object.assign(info.dir, { x: -from.x / l, y: (1 - from.y) / l, z: -from.z / l });
    info.distance = l;
    info.source = 'test';
    h.applyDamage(info);
  }

  it('先扣護盾、溢出扣生命；shieldBroken 只在打破那一下；sourcePos 為攻擊者位置', () => {
    const bus = new EventBus<GameEvents>();
    const h = new PlayerHealth({ bus, config: defaultPlayerHealthConfig() });
    const evs: GameEvents['player:damaged'][] = [];
    bus.on('player:damaged', (e) => evs.push(JSON.parse(JSON.stringify(e)) as GameEvents['player:damaged']));
    hit(h, 60);
    hit(h, 60);
    hit(h, 30);
    expect(evs.map((e) => [e.shieldDamage, e.healthDamage, e.shieldBroken])).toEqual([
      [60, 0, false],
      [40, 20, true],
      [0, 30, false],
    ]);
    expect(h.state.health).toBe(50);
    expect(evs[0]!.sourcePos.x).toBeCloseTo(-10, 9);
    expect(evs[0]!.sourcePos.z).toBeCloseTo(0, 9);
  });

  it('護盾：3 s 未受傷後每秒回 40；生命：5 s 後每秒回 6（與步長無關）', () => {
    for (const hz of RATES) {
      const bus = new EventBus<GameEvents>();
      const h = new PlayerHealth({ bus, config: defaultPlayerHealthConfig() });
      const phases: string[] = [];
      bus.on('player:shield', (e) => phases.push(e.phase));
      hit(h, 130);
      const step = (s: number) => {
        for (let i = 0; i < Math.round(s * hz); i++) h.step(1 / hz);
      };
      step(3);
      expect(h.state.shield).toBeCloseTo(0, 6);
      step(1);
      expect(h.state.shield).toBeCloseTo(40, 6);
      step(1);
      expect(h.state.shield).toBeCloseTo(80, 6);
      expect(h.state.health).toBeCloseTo(70, 6);
      step(1);
      expect(h.state.shield).toBe(100);
      expect(h.state.health).toBeCloseTo(76, 6);
      expect(phases).toEqual(['recharge', 'full']);
    }
  });

  it('無敵模式：照常發出受擊事件（blocked），不扣血；kill／refill／reset', () => {
    const bus = new EventBus<GameEvents>();
    const cfg = defaultPlayerHealthConfig();
    cfg.invulnerable = true;
    const h = new PlayerHealth({ bus, config: cfg });
    const evs: boolean[] = [];
    bus.on('player:damaged', (e) => evs.push(e.blocked));
    hit(h, 500);
    expect(evs).toEqual([true]);
    expect(h.state.shield).toBe(100);
    expect(h.alive).toBe(true);
    h.kill();
    expect(h.alive).toBe(false);
    hit(h, 10);
    expect(evs).toHaveLength(1);
    h.reset();
    expect(h.alive).toBe(true);
    expect(h.state.sinceDamage).toBe(NEVER);
    cfg.invulnerable = false;
    hit(h, 20);
    h.refill();
    expect(h.state.shield).toBe(100);
  });

  it('面板涵蓋所有數值欄位', () => {
    for (const key of Object.keys(defaultPlayerHealthConfig())) expect(PLAYER_HEALTH_PANEL).toHaveProperty(key);
  });
});

// ── DPS 計 ───────────────────────────────────────────────

describe('DPS 計', () => {
  it('注入的傷害序列：10 發/s × 18 → 交戰 5 s 後滾動 DPS 180；開始時用實際經過時間', () => {
    const m = new DpsMeter();
    let t = 0;
    const at: Record<string, number> = {};
    for (let i = 0; i <= 80; i++) {
      t = i * 0.1;
      m.record(t, 18, i % 4 === 0, 'assault_rifle');
      if (i === 20) at.t2 = m.dps(t);
      if (i === 60) at.t6 = m.dps(t);
    }
    // t = 2：21 發 × 18 ÷ 2 s。
    expect(at.t2).toBeCloseTo((21 * 18) / 2, 9);
    // t = 6：(1, 6] 內 50 發 × 18 ÷ 5 s。
    expect(at.t6).toBeCloseTo((50 * 18) / 5, 9);
    expect(m.total).toBe(81 * 18);
    expect(m.hits).toBe(81);
    expect(m.crits).toBe(21);
    expect(m.critRate).toBeCloseTo(21 / 81, 12);
    // 停火後視窗內的傷害逐漸移出。
    expect(m.dps(10.5)).toBeCloseTo((25 * 18) / 5, 9);
    expect(m.dps(14)).toBe(0);
    const snap = m.snapshot(8);
    expect(snap.duration).toBeCloseTo(8, 9);
    expect(dpsBoardLines(snap, '突擊步槍')[0]).toContain('DPS');
  });

  it('閒置超過 5 s 後的下一筆傷害開始新的交戰（總傷害、爆頭率歸零）；手動重設', () => {
    const m = new DpsMeter();
    m.record(0, 100, true);
    m.record(1, 100, false);
    expect(m.total).toBe(200);
    m.record(6.5, 50, false);
    expect(m.total).toBe(50);
    expect(m.crits).toBe(0);
    expect(m.dps(6.5)).toBe(50);
    m.reset();
    expect(m.dps(7)).toBe(0);
    expect(m.hits).toBe(0);
  });

  it('容量不足時自動擴充（霰彈高頻）', () => {
    const m = new DpsMeter(undefined, 8);
    for (let i = 0; i < 100; i++) m.record(i * 0.01, 1, false);
    expect(m.windowDamage(0.99)).toBe(100);
  });

  it('實測 DPS（無頭，WeaponSim × 假人 10 m，不散布）與預估一致', () => {
    const rows: string[] = [];
    for (const id of ['assault_rifle', 'hand_cannon', 'rail_sniper']) {
      const physics = new Physics();
      const bus = new EventBus<GameEvents>();
      const bal = new Ballistics({ physics, bus });
      const targets = new TargetManager({ physics, bus, layout: layoutWithDummy(10), config: defaultTargetConfig(), dronesEnabled: () => false });
      targets.config.dummy.maxHealth = 1e9;
      targets.build();
      targets.applyConfig();
      const def = steady(id);
      const sim = new WeaponSim({ loadout: loadoutWith(def), ballistics: bal, bus });
      sim.view.set(0, pitchTo(DUMMY_SHAPE.torsoY, 10));
      // 半自動：每兩步按一次（扳機緩衝讓它以最高射速射擊）。量測整數個「打空 → 換彈」循環。
      const est = estimateWeaponDps(def, { distance: 10 });
      const seconds = 3 * est.cycle - 0.01;
      for (let i = 0; i < Math.round(seconds * 120); i++) {
        // 換彈中不按（補彈點後按開火會取消剩下的換彈，見 M1-10；預估用完整換彈時間）。
        const reloading = sim.manager.state.phase === 'reloading';
        if (def.fire.mode === 'auto') sim.input.down('fire');
        else if (i % 2 === 0 && !reloading) sim.input.down('fire');
        else sim.input.up('fire');
        sim.step();
        targets.step(sim.dt);
        physics.step(sim.dt);
      }
      const measured = targets.dps.total / seconds;
      rows.push(`${id}: measured ${measured.toFixed(1)} sustained est ${est.sustained.toFixed(1)} burst ${est.burst.toFixed(1)} hits ${targets.dps.hits} t ${seconds.toFixed(2)}`);
      if (process.env.SW_DPS_TABLE) console.log(rows[rows.length - 1]);
      expect(measured).toBeGreaterThan(est.sustained * 0.97);
      expect(measured).toBeLessThan(est.sustained * 1.03);
      physics.dispose();
    }
    if (process.env.SW_DPS_TABLE) console.log(rows.join('\n'));
  });

  it('預估：步槍 180 爆發；霰彈 10 顆彈丸與逐發裝填；電漿含範圍傷害', () => {
    const [ar, sg, , , pl] = ARCHETYPES;
    expect(estimateWeaponDps(ar!).burst).toBeCloseTo(180, 9);
    const sge = estimateWeaponDps(sg!, { distance: 5 });
    expect(sge.perShot).toBe(120);
    expect(sge.cycle).toBeCloseTo(6 / (80 / 60) + 6 * 0.45, 9);
    expect(estimateWeaponDps(pl!, { splashMult: 1 }).perShot).toBe(160);
  });
});

// ── 命中確認與回饋純邏輯 ─────────────────────────────────

describe('命中確認（combat:hit）', () => {
  it('霰彈 10 顆彈丸同一步只發一次；擊殺 > 爆頭 > 一般；自傷不算', () => {
    const bus = new EventBus<GameEvents>();
    const self = new PlayerHealth({ bus });
    const sys = new HitConfirmSystem({ bus, getSelf: () => self });
    const hits: GameEvents['combat:hit'][] = [];
    bus.on('combat:hit', (e) => hits.push({ ...e }));
    const info = createDamageInfo();
    const dummy = { id: 'x', alive: true, getCenter: (o: Vec3Like) => o, applyDamage: () => ({ dealt: 0, killed: false }) };
    info.target = dummy;
    for (let i = 0; i < 10; i++) {
      info.amount = 12;
      info.isCrit = i === 3;
      bus.emit('combat:damage', info);
    }
    info.target = self;
    bus.emit('combat:damage', info);
    sys.fixedUpdate();
    sys.fixedUpdate();
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ kind: 'crit', hits: 10, crits: 1, kills: 0, amount: 120 });
    info.target = dummy;
    info.isKill = true;
    info.isCrit = false;
    bus.emit('combat:damage', info);
    sys.flush();
    expect(hits[1]!.kind).toBe('kill');
    expect(strongerHit('kill', 'hit')).toBe('kill');
    expect(hitKindOf({ isKill: false, isCrit: true })).toBe('crit');
    const hc = new HitConfirm();
    expect(hc.flush()).toBeNull();
  });
});

describe('命中標記、傷害數字、受擊方向', () => {
  const cfg = defaultFeedbackConfig();

  it('命中標記：爆頭黃色較大、擊殺紅色放大並震動、時間到消失', () => {
    const hit = hitMarkerStyle(cfg.hitMarker, 'hit', 0.02);
    const crit = hitMarkerStyle(cfg.hitMarker, 'crit', 0.02);
    const kill = hitMarkerStyle(cfg.hitMarker, 'kill', 0.02);
    expect(hit.color).toBe(cfg.hitMarker.colorHit);
    expect(crit.color).toBe(cfg.hitMarker.colorCrit);
    expect(kill.color).toBe(cfg.hitMarker.colorKill);
    expect(crit.size).toBeGreaterThan(hit.size);
    expect(kill.size).toBeGreaterThan(crit.size);
    expect(kill.scale).toBeGreaterThan(hit.scale);
    expect(Math.hypot(kill.shakeX, kill.shakeY)).toBeGreaterThan(0);
    expect(hit.shakeX).toBe(0);
    expect(hitMarkerStyle(cfg.hitMarker, 'hit', cfg.hitMarker.duration + 0.01).visible).toBe(false);
    expect(hitMarkerStyle(cfg.hitMarker, 'kill', cfg.hitMarker.duration + 0.01).visible).toBe(true);
    // 擊殺後段回到 1 倍。
    expect(hitMarkerStyle(cfg.hitMarker, 'kill', cfg.hitMarker.killDuration * 0.5).scale).toBe(1);
  });

  it('傷害數字：合併開啟時同一目標的傷害累加；關閉時各自顯示；爆頭分開；過期移除', () => {
    const n = cfg.numbers;
    const m = new DamageNumberModel(48);
    const a = {};
    const b = {};
    m.add(n, 0, a, 18, false, false, 0, 1, -10, true);
    m.add(n, 0.1, a, 18, false, false, 0, 1, -10, true);
    m.add(n, 0.2, a, 32.4, true, false, 0, 1.6, -10, true);
    m.add(n, 0.2, b, 18, false, false, 5, 1, -10, true);
    expect(m.activeCount).toBe(3);
    const merged = m.items.find((x) => x.active && x.key === a && !x.crit)!;
    expect(merged.amount).toBe(36);
    expect(merged.bump).toBe(1);
    // 超過合併時間：新的數字。
    m.add(n, 0.1 + n.mergeWindow + 0.01, a, 18, false, false, 0, 1, -10, true);
    expect(m.activeCount).toBe(4);
    m.update(n, 0.1 + n.life + 0.001, 0.016);
    expect(m.items.filter((x) => x.active && x.key === a && !x.crit && x.amount === 36)).toHaveLength(0);
    const off = new DamageNumberModel(48);
    for (let i = 0; i < 10; i++) off.add(n, 0, a, 12, false, false, 0, 1, -5, false);
    expect(off.activeCount).toBe(10);
    expect(formatDamage(32.4)).toBe('32');
    expect(formatDamage(0.5)).toBe('0.5');
  });

  it('傷害數字池固定 48 個：滿了回收最舊的', () => {
    const m = new DamageNumberModel(FEEDBACK_CONFIG.numbers.capacity);
    expect(m.items).toHaveLength(48);
    for (let i = 0; i < 60; i++) m.add(cfg.numbers, i * 0.001, {}, i + 1, false, false, 0, 0, 0, false);
    expect(m.activeCount).toBe(48);
    const amounts = m.items.map((x) => x.amount).sort((p, q) => p - q);
    expect(amounts[0]).toBe(13);
    expect(amounts[47]).toBe(60);
  });

  it('傷害數字樣式：往上飄、爆頭放大、遠處縮小、最後淡出', () => {
    const n = cfg.numbers;
    const m = new DamageNumberModel(4);
    const it0 = m.add(n, 0, {}, 10, false, false, 0, 0, 0, false);
    const it1 = m.add(n, 0, {}, 10, true, false, 0, 0, 0, false);
    const s0 = damageNumberStyle(n, it0, 0.3, 10);
    const s1 = damageNumberStyle(n, it1, 0.3, 10);
    expect(s0.dy).toBeLessThan(0);
    expect(s1.scale / s0.scale).toBeCloseTo(n.critScale, 9);
    expect(s1.color).toBe(n.colorCrit);
    expect(damageNumberStyle(n, it0, 0.3, 60).scale).toBeLessThan(s0.scale);
    expect(damageNumberStyle(n, it0, n.life * 0.99, 10).opacity).toBeLessThan(0.1);
  });

  it('受擊方向：從左邊被打 → 左（−90°）；右 → +90°；前 → 0；後 → ±180°；轉頭後跟著轉', () => {
    const deg = (r: number) => (r * 180) / Math.PI;
    // yaw 0 時 forward = -Z、right = +X。
    expect(deg(damageIndicatorAngle(0, 0, 0, -10, 0))).toBeCloseTo(-90, 9);
    expect(deg(damageIndicatorAngle(0, 0, 0, 10, 0))).toBeCloseTo(90, 9);
    expect(deg(damageIndicatorAngle(0, 0, 0, 0, -10))).toBeCloseTo(0, 9);
    expect(Math.abs(deg(damageIndicatorAngle(0, 0, 0, 0, 10)))).toBeCloseTo(180, 9);
    // 往左轉 90°（yaw = +90°，forward = -X）：原本在左邊（-X）的攻擊者變成正前方。
    expect(deg(damageIndicatorAngle(90 * DEG2RAD, 0, 0, -10, 0))).toBeCloseTo(0, 9);
    for (const yaw of [0.3, 1.7, -2.4]) {
      // 視角的左方（-right）一定是 -90°。
      const rx = Math.cos(yaw);
      const rz = -Math.sin(yaw);
      expect(deg(damageIndicatorAngle(yaw, 3, 4, 3 - rx * 7, 4 - rz * 7))).toBeCloseTo(-90, 9);
    }
  });

  it('受擊方向指示：同方向合併、不同方向各自一個、到時淡出', () => {
    const ic = cfg.indicator;
    const m = new DamageIndicatorModel(ic.slots);
    m.add(ic, 0, 0, 0, 0, -10, 0, 0.5, false);
    m.add(ic, 0.1, 0, 0, 0, -10, 1, 0.5, false);
    m.add(ic, 0.1, 0, 0, 0, 10, 0, 0.5, false);
    expect(m.slots.filter((s) => s.active)).toHaveLength(2);
    expect(m.opacity(ic, m.slots[0]!, 0.15)).toBeGreaterThan(0.5);
    m.update(ic, 0.1 + ic.duration);
    expect(m.slots.filter((s) => s.active)).toHaveLength(0);
  });

  it('低生命暗角與受擊震動', () => {
    expect(lowHealthIntensity(1, 0.4)).toBe(0);
    expect(lowHealthIntensity(0.4, 0.4)).toBe(0);
    expect(lowHealthIntensity(0, 0.4)).toBe(1);
    expect(lowHealthIntensity(0.2, 0.4)).toBeCloseTo(0.5, 9);
    const c = cfg.camera;
    expect(hitTrauma(0, false, c)).toBe(0);
    expect(hitTrauma(15, false, c)).toBeCloseTo(c.traumaBase + 15 * c.traumaPerDamage, 12);
    expect(hitTrauma(1000, true, c)).toBeCloseTo(c.traumaMax + c.shieldBreakTrauma, 12);
  });
});

// ── 設定與面板 ───────────────────────────────────────────

describe('設定與調參面板', () => {
  it('新設定欄位有預設值；舊存檔（沒有這些欄位）補預設值且不壞', () => {
    const d = defaultSettings();
    expect([d.hitMarkers, d.damageNumbers, d.damageNumberMerge, d.trainingDrones]).toEqual([true, true, true, true]);
    const old = parseSettings({ version: 1, values: { sensitivity: 3, adsSensitivity: 0.8, somethingNew: 1 } });
    expect(old.settings.sensitivity).toBe(3);
    expect(old.settings.trainingDrones).toBe(true);
    expect(old.settings.damageNumberMerge).toBe(true);
    expect(old.extra).toEqual({ somethingNew: 1 });
    expect(old.dirty).toBe(true);
    expect(SETTINGS_SCHEMA.trainingDrones.type).toBe('boolean');
  });

  it('面板涵蓋靶標與回饋的每個數值欄位', () => {
    const t = defaultTargetConfig();
    for (const k of Object.keys(t.dummy)) expect(DUMMY_PANEL).toHaveProperty(k);
    for (const k of Object.keys(t.mover)) expect(MOVER_PANEL).toHaveProperty(k);
    for (const k of Object.keys(t.drone)) expect(DRONE_PANEL).toHaveProperty(k);
    for (const k of Object.keys(t.flash)) expect(FLASH_PANEL).toHaveProperty(k);
    const f = defaultFeedbackConfig();
    for (const k of Object.keys(f.hitMarker)) expect(HIT_MARKER_PANEL).toHaveProperty(k);
    for (const k of Object.keys(f.numbers).filter((x) => x !== 'capacity')) expect(DAMAGE_NUMBER_PANEL).toHaveProperty(k);
    for (const k of Object.keys(f.indicator).filter((x) => x !== 'slots')) expect(INDICATOR_PANEL).toHaveProperty(k);
    for (const k of Object.keys(f.screen)) expect(SCREEN_DAMAGE_PANEL).toHaveProperty(k);
    for (const k of Object.keys(f.camera)) expect(HIT_CAMERA_PANEL).toHaveProperty(k);
  });

  it('訓練場擺放：假人在 10／25／50／75 m 標線、移動靶軌道在靶場內、戰區包含待命點', () => {
    const L = TRAINING_TARGET_LAYOUT;
    const dists = L.dummies.map((d) => 40 - d.pos[2]).sort((a, b) => a - b);
    expect(dists).toEqual([10, 10, 25, 50, 75]);
    for (const d of L.dummies) {
      expect(d.pos[0]).toBeGreaterThan(-80);
      expect(d.pos[0]).toBeLessThan(-50);
    }
    for (const r of L.rails) {
      expect(r.xMin).toBeGreaterThan(-80);
      expect(r.xMax).toBeLessThan(-50);
    }
    for (const h of L.arena.home) for (let i = 0; i < 3; i++) {
      expect(h[i]).toBeGreaterThanOrEqual(L.arena.min[i]!);
      expect(h[i]).toBeLessThanOrEqual(L.arena.max[i]!);
    }
    expect(DummyTarget).toBeDefined();
  });
});
