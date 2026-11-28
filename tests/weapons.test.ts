import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { falloffMultiplier } from '@/combat/Damage';
import { EventBus } from '@/core/EventBus';
import type { GameEvents } from '@/core/events';
import { DEG2RAD } from '@/core/math';
import { Rng } from '@/core/Rng';
import { defaultSettings, parseSettings } from '@/core/Settings';
import { Physics } from '@/physics/Physics';
import { ARCHETYPES, createArchetype, defaultLoadout } from '@/weapons/archetypes';
import { Ballistics, type ShotContext } from '@/weapons/Ballistics';
import { defaultWeaponSystemConfig } from '@/weapons/WeaponConfig';
import {
  adsSensitivityRatio,
  cloneWeaponDef,
  validateWeaponDef,
  zoomedFov,
  type WeaponDef,
} from '@/weapons/WeaponDef';
import { WEAPON_FIELDS, exportWeaponJson, readWeaponField, writeWeaponField } from '@/weapons/WeaponPanel';
import { RecoilState, aimDirection, angleBetweenDeg, baseSpread, recoverLinear, sampleSpreadOffset } from '@/weapons/weaponMath';
import { MovementSim, floorBox } from './helpers/movementSim';
import { FakePlayer, TestTarget, WeaponSim, addTargetBall, addWall } from './helpers/weaponSim';

beforeAll(async () => {
  await Physics.init();
});

const RATES = [60, 120, 240] as const;

function arch(id: string, mutate?: (d: WeaponDef) => void): WeaponDef {
  const d = createArchetype(id)!;
  mutate?.(d);
  return d;
}

/** 欄位 0 放指定武器，其餘為原型。 */
function loadoutWith(first: WeaponDef): WeaponDef[] {
  const l = defaultLoadout();
  l[0] = first;
  return l;
}

function fireTimes(sim: WeaponSim): number[] {
  return sim.eventsNamed('weapon:fire').map((e) => e.payload.time as number);
}

/** 推進到模擬時間 ≥ t（下一步的 t0 = t，按鍵會在這一步被讀到）。 */
function runTo(sim: WeaponSim, t: number): void {
  while (sim.time < t - 1e-9) sim.step();
}

// ── 資料 ─────────────────────────────────────────────────

describe('WeaponDef 與原型數值', () => {
  it('5 把原型都通過驗證，數值符合計畫表', () => {
    expect(ARCHETYPES.length).toBe(5);
    for (const d of ARCHETYPES) expect(validateWeaponDef(d)).toEqual({ ok: true, errors: [] });
    const [ar, sg, hc, rs, pl] = ARCHETYPES;
    expect([ar!.fire.mode, ar!.fire.rpm, ar!.damage.base, ar!.damage.critMult, ar!.ammo.mag]).toEqual(['auto', 600, 18, 1.8, 32]);
    expect([ar!.ammo.reloadTactical, ar!.ammo.reloadEmpty]).toEqual([1.6, 2.0]);
    expect([ar!.damage.falloffStart, ar!.damage.falloffEnd, ar!.damage.minMult]).toEqual([30, 60, 0.6]);
    expect([sg!.fire.mode, sg!.fire.rpm, sg!.fire.pellets, sg!.damage.base, sg!.damage.critMult, sg!.ammo.mag]).toEqual([
      'pump', 80, 10, 12, 1.5, 6,
    ]);
    expect([sg!.ammo.reloadPerShell, sg!.damage.falloffStart, sg!.damage.falloffEnd, sg!.damage.minMult]).toEqual([0.45, 8, 20, 0.2]);
    expect(sg!.spread.pelletPattern).toHaveLength(10);
    expect([hc!.fire.mode, hc!.fire.rpm, hc!.damage.base, hc!.damage.critMult, hc!.ammo.mag, hc!.ammo.reloadTactical]).toEqual([
      'semi', 160, 60, 2.0, 8, 1.8,
    ]);
    expect([rs!.fire.rpm, rs!.damage.base, rs!.damage.critMult, rs!.ammo.mag, rs!.ammo.reloadTactical]).toEqual([55, 140, 2.5, 4, 2.4]);
    expect([rs!.damage.penetration + 1, rs!.handling.adsZoom, rs!.spread.hip]).toEqual([3, 4, 3]);
    expect([pl!.fire.rpm, pl!.damage.base, pl!.ammo.mag, pl!.ammo.reloadTactical]).toEqual([70, 90, 4, 2.2]);
    expect(pl!.projectile).toMatchObject({ speed: 45, splashDamage: 70, splashRadius: 4, selfKnockback: 12, selfDamageMult: 0 });
    for (const d of ARCHETYPES) expect(d.perks).toEqual([]);
  });

  it('驗證會指出錯誤欄位', () => {
    const bad = cloneWeaponDef(ARCHETYPES[0]!);
    bad.fire.rpm = 0;
    bad.ammo.mag = 0;
    bad.fire.mode = 'burst';
    bad.spread.pelletPattern = [[0, 0]];
    bad.fire.pellets = 2;
    (bad.ammo as { reserve: unknown }).reserve = 'lots';
    bad.recoil.pitchPerShot = [2, 1];
    bad.model.colors.glow = 'cyan';
    const r = validateWeaponDef(bad);
    expect(r.ok).toBe(false);
    const text = r.errors.join('\n');
    for (const key of ['fire.rpm', 'ammo.mag', 'fire.burstCount', 'fire.burstRpm', 'pelletPattern', 'ammo.reserve', 'recoil.pitchPerShot', 'model.colors.glow']) {
      expect(text).toContain(key);
    }
    expect(validateWeaponDef(null).ok).toBe(false);
    expect(validateWeaponDef({}).ok).toBe(false);
  });

  it('createArchetype 是深複製：改複本不影響原型', () => {
    const d = createArchetype('assault_rifle')!;
    d.recoil.pitchPerShot[0] = 9;
    d.fire.rpm = 1;
    expect(ARCHETYPES[0]!.recoil.pitchPerShot[0]).toBe(0.35);
    expect(ARCHETYPES[0]!.fire.rpm).toBe(600);
    expect(createArchetype('nope')).toBeNull();
  });

  it('設定新增「開鏡靈敏度倍率」，舊存檔補預設值且保留其他值', () => {
    expect(defaultSettings().adsSensitivity).toBe(1);
    const parsed = parseSettings({ version: 1, values: { sensitivity: 3.5, fovHorizontal: 110 } });
    expect(parsed.settings.adsSensitivity).toBe(1);
    expect(parsed.settings.sensitivity).toBe(3.5);
    expect(parsed.settings.fovHorizontal).toBe(110);
    expect(parseSettings({ version: 1, values: { adsSensitivity: 99 } }).settings.adsSensitivity).toBe(3);
  });
});

// ── 數學 ─────────────────────────────────────────────────

describe('武器數學', () => {
  it('瞄準方向：yaw 0 面向 -Z、yaw 正值向左、pitch 正值抬頭；偏移角度正確', () => {
    const o = { x: 0, y: 0, z: 0 };
    aimDirection(0, 0, 0, 0, o);
    expect(o.x).toBeCloseTo(0);
    expect(o.z).toBeCloseTo(-1);
    aimDirection(Math.PI / 2, 0, 0, 0, o);
    expect(o.x).toBeCloseTo(-1);
    aimDirection(0, 0.3, 0, 0, o);
    expect(o.y).toBeCloseTo(Math.sin(0.3));
    const c = { x: 0, y: 0, z: 0 };
    aimDirection(0.7, -0.4, 0, 0, c);
    aimDirection(0.7, -0.4, 3, 0, o);
    expect(angleBetweenDeg(c, o)).toBeCloseTo(3, 6);
    aimDirection(0, 0, 2, 0, o);
    expect(o.x).toBeGreaterThan(0); // 右偏 = +X
    aimDirection(0, 0, 0, 2, o);
    expect(o.y).toBeGreaterThan(0);
  });

  it('散布取樣都在錐形內，圓盤面積均勻', () => {
    const rng = new Rng(7);
    const o = { x: 0, y: 0 };
    let inner = 0;
    for (let i = 0; i < 4000; i++) {
      sampleSpreadOffset(rng, 2, o);
      const r = Math.hypot(o.x, o.y);
      expect(r).toBeLessThanOrEqual(2 + 1e-12);
      if (r < Math.SQRT1_2 * 2) inner++;
    }
    // 半徑 1/√2 內的面積是一半。
    expect(inner / 4000).toBeGreaterThan(0.45);
    expect(inner / 4000).toBeLessThan(0.55);
  });

  it('基礎散布：腰射→開鏡內插、移動與空中倍率', () => {
    const s = ARCHETYPES[0]!.spread;
    expect(baseSpread(s, 0, 0, false)).toBeCloseTo(1.6);
    expect(baseSpread(s, 1, 0, false)).toBeCloseTo(0.25);
    expect(baseSpread(s, 0.5, 0, false)).toBeCloseTo((1.6 + 0.25) / 2);
    expect(baseSpread(s, 0, 1, false)).toBeCloseTo(1.6 * 1.25);
    expect(baseSpread(s, 0, 1, true)).toBeCloseTo(1.6 * 1.25 * 1.5);
    expect(baseSpread(s, 0, 5, false)).toBeCloseTo(1.6 * 1.25); // 移動倍率夾在滿值
  });

  it('線性回復可任意切分', () => {
    let a = 5;
    for (let i = 0; i < 7; i++) a = recoverLinear(a, 3, 0.1);
    expect(a).toBeCloseTo(recoverLinear(5, 3, 0.7), 12);
    expect(recoverLinear(1, 3, 1)).toBe(0);
  });

  it('後座回正：延遲後線性回正，切分方式不影響結果；回正量不超過累積量', () => {
    const recoil = ARCHETYPES[0]!.recoil;
    const make = (): RecoilState => {
      const r = new RecoilState();
      const out = { pitch: 0, yaw: 0 };
      const rng = new Rng(3);
      for (let i = 0; i < 10; i++) r.kick(i * 0.1, recoil, 0, 0.1, rng, out);
      return r;
    };
    const a = make();
    a.recover(0.9, 1.5);
    const b = make();
    for (let t = 0.9; t < 1.5 - 1e-9; t += 0.05) b.recover(t, Math.min(1.5, t + 0.05));
    expect(a.pitch).toBeCloseTo(b.pitch, 9);
    expect(a.yaw).toBeCloseTo(b.yaw, 9);
    // 停火 recoveryDelay 內不回正。
    const c = make();
    const before = c.pitch;
    c.recover(0.9, 0.9 + recoil.recoveryDelay);
    expect(c.pitch).toBe(before);
    c.recover(0.9, 100);
    expect(c.magnitude).toBe(0);
    expect(c.recovered).toBeLessThanOrEqual(c.accumulated + 1e-9);
  });

  it('後座 pitch 累積不超過 maxClimb；第一發倍率', () => {
    const recoil = { ...ARCHETYPES[0]!.recoil, maxClimb: 2, firstShotMult: 0.5 };
    const r = new RecoilState();
    const out = { pitch: 0, yaw: 0 };
    const rng = new Rng(1);
    r.kick(0, recoil, 0, 0.1, rng, out);
    expect(r.lastWasFirst).toBe(true);
    expect(out.pitch).toBeLessThanOrEqual(0.55 * 0.5 + 1e-9);
    r.kick(0.1, recoil, 0, 0.1, rng, out);
    expect(r.lastWasFirst).toBe(false);
    for (let i = 2; i < 30; i++) r.kick(i * 0.1, recoil, 0, 0.1, rng, out);
    expect(r.pitch).toBeLessThanOrEqual(2 + 1e-9);
  });

  it('開鏡 FOV 與靈敏度的焦距換算', () => {
    expect(zoomedFov(90, 1)).toBeCloseTo(90);
    expect(Math.tan((zoomedFov(103, 4) * DEG2RAD) / 2)).toBeCloseTo(Math.tan((103 * DEG2RAD) / 2) / 4, 9);
    expect(adsSensitivityRatio(103, zoomedFov(103, 4))).toBeCloseTo(0.25, 9);
    expect(adsSensitivityRatio(90, zoomedFov(90, 1.3))).toBeCloseTo(1 / 1.3, 9);
  });

  it('距離衰減', () => {
    expect(falloffMultiplier(10, 30, 60, 0.6)).toBe(1);
    expect(falloffMultiplier(45, 30, 60, 0.6)).toBeCloseTo(0.8);
    expect(falloffMultiplier(100, 30, 60, 0.6)).toBe(0.6);
    expect(falloffMultiplier(400, 300, 300, 1)).toBe(1);
  });
});

// ── 射擊節奏（驗收：與步長無關）─────────────────────────

describe('射擊節奏與彈匣', () => {
  it('驗收：600 RPM 在 1/60、1/120、1/240 步長下按住 10 s 都是 100 ± 1 發，開火時間、後座、散布完全一致', () => {
    const results = RATES.map((hz) => {
      const sim = new WeaponSim({ hz, loadout: loadoutWith(arch('assault_rifle', (d) => (d.ammo.mag = 100000))) });
      sim.input.down('fire');
      sim.run(10);
      return {
        count: sim.count('weapon:fire'),
        times: fireTimes(sim),
        recoil: [sim.manager.recoil.pitch, sim.manager.recoil.yaw],
        bloom: sim.manager.active!.bloomAt(sim.time),
        dirs: sim.eventsNamed('weapon:fire').map((e) => e.payload.dir as { x: number; y: number; z: number }),
      };
    });
    for (const r of results) {
      expect(r.count).toBeGreaterThanOrEqual(99);
      expect(r.count).toBeLessThanOrEqual(101);
    }
    const base = results[0]!;
    for (const r of results.slice(1)) {
      expect(r.count).toBe(base.count);
      for (let i = 0; i < r.times.length; i++) expect(r.times[i]).toBeCloseTo(base.times[i]!, 9);
      expect(r.recoil[0]).toBeCloseTo(base.recoil[0]!, 9);
      expect(r.recoil[1]).toBeCloseTo(base.recoil[1]!, 9);
      expect(r.bloom).toBeCloseTo(base.bloom, 9);
      for (let i = 0; i < r.dirs.length; i++) {
        expect(r.dirs[i]!.x).toBeCloseTo(base.dirs[i]!.x, 9);
        expect(r.dirs[i]!.y).toBeCloseTo(base.dirs[i]!.y, 9);
      }
    }
    // 間隔正好是 0.1 s。
    expect(base.times[1]! - base.times[0]!).toBeCloseTo(0.1, 12);
    expect(base.times[99]).toBeCloseTo(9.9, 9);
  });

  it('打空彈匣後自動空倉換彈，換彈完成後同一步內接著射擊（不同步長結果相同）', () => {
    const counts = RATES.map((hz) => {
      const sim = new WeaponSim({ hz });
      sim.input.down('fire');
      sim.run(6);
      const starts = sim.eventsNamed('weapon:reloadStart');
      expect(starts).toHaveLength(1);
      expect(starts[0]!.payload.kind).toBe('empty');
      expect(starts[0]!.payload.duration).toBeCloseTo(2.0);
      const times = fireTimes(sim);
      // 32 發：0..3.1；第 32 發後的週期結束（3.2）開始換彈，5.2 完成後立即射擊。
      expect(times[31]).toBeCloseTo(3.1, 9);
      expect(times[32]).toBeCloseTo(5.2, 9);
      return times.length;
    });
    expect(counts).toEqual([40, 40, 40]);
  });

  it('半自動：按住只發一發；扳機緩衝 0.08 s 內提早按下會在可射擊時發射，太早不會', () => {
    for (const hz of RATES) {
      const sim = new WeaponSim({ hz, loadout: loadoutWith(arch('hand_cannon')) });
      sim.input.down('fire');
      sim.run(1);
      expect(sim.count('weapon:fire')).toBe(1);
      sim.input.up('fire');
      sim.run(0.1);
      // 間隔 0.375 s。上一發在 0；現在 1.1 s → 直接打。
      sim.input.tap('fire');
      const t1 = sim.time;
      sim.step();
      expect(fireTimes(sim)[1]).toBeCloseTo(t1, 9);
      // 提早 0.06 s（緩衝內）：在 t1 + 0.375 發射。
      runTo(sim, t1 + 0.375 - 0.06);
      sim.input.tap('fire');
      sim.run(0.2);
      expect(fireTimes(sim)[2]).toBeCloseTo(t1 + 0.375, 9);
      // 提早 0.15 s（超過緩衝）：不發射。
      runTo(sim, t1 + 0.75 - 0.15);
      sim.input.tap('fire');
      sim.run(0.3);
      expect(sim.count('weapon:fire')).toBe(3);
    }
  });

  it('連發：按一下打一輪（輪內 burstRpm），輪與輪之間依 rpm', () => {
    const burst = arch('assault_rifle', (d) => {
      d.fire.mode = 'burst';
      d.fire.burstCount = 3;
      d.fire.burstRpm = 900;
      d.fire.rpm = 120;
    });
    expect(validateWeaponDef(burst).ok).toBe(true);
    const sim = new WeaponSim({ loadout: loadoutWith(burst) });
    sim.input.tap('fire');
    sim.run(0.3);
    let times = fireTimes(sim);
    expect(times).toHaveLength(3);
    expect(times[1]! - times[0]!).toBeCloseTo(60 / 900, 9);
    expect(times[2]! - times[1]!).toBeCloseTo(60 / 900, 9);
    // 0.3 s 再按（下一輪 0.5 s 才能開始，超過緩衝）→ 不發；0.45 s 按 → 0.5 s 開始下一輪。
    sim.input.tap('fire');
    sim.run(0.15);
    expect(sim.count('weapon:fire')).toBe(3);
    sim.input.tap('fire');
    sim.run(0.4);
    times = fireTimes(sim);
    expect(times).toHaveLength(6);
    expect(times[3]).toBeCloseTo(0.5, 9);
    // 0.85 s 按下（緩衝到 0.93，下一輪 1.0 才能開始）之後一直按住：不會自動連發下一輪。
    sim.input.down('fire');
    sim.run(2);
    expect(sim.count('weapon:fire')).toBe(6);
  });

  it('泵動霰彈槍：一發 10 顆彈丸、間隔 0.75 s', () => {
    const sim = new WeaponSim({ loadout: loadoutWith(arch('scatter_shotgun')) });
    sim.input.down('fire');
    sim.run(0.1);
    sim.input.up('fire');
    // 0.65 s 按（緩衝 0.12 s 到 0.77）→ 0.75 s 發射。
    sim.run(0.55);
    sim.input.tap('fire');
    sim.run(0.5);
    const fires = sim.eventsNamed('weapon:fire');
    expect(fires).toHaveLength(2);
    expect(fires[0]!.payload.pellets).toBe(10);
    expect(fires[1]!.payload.time as number).toBeCloseTo(0.75, 9);
    expect(sim.manager.active!.ammo).toBe(4);
  });

  it('自動衝刺中按開火：先在 sprintToFire 內退出衝刺才射擊', () => {
    for (const hz of RATES) {
      const player = new FakePlayer();
      const sim = new WeaponSim({ hz, player });
      player.sprinting = true;
      sim.run(1);
      // 按開火的那一步玩家就不衝刺了（M1-05：開火時中斷衝刺）。
      player.sprinting = false;
      const press = sim.time;
      sim.input.down('fire');
      sim.run(0.5);
      expect(fireTimes(sim)[0]).toBeCloseTo(press + 0.15, 9);
    }
  });
});

// ── 換彈（驗收）────────────────────────────────────────

describe('換彈', () => {
  function rifleAfterShots(hz: number): WeaponSim {
    const sim = new WeaponSim({ hz });
    sim.input.down('fire');
    sim.run(0.95); // 0..0.9 共 10 發
    sim.input.up('fire');
    sim.run(0.05);
    expect(sim.manager.active!.ammo).toBe(22);
    return sim;
  }

  it('驗收：在 ammoPoint 之前切槍取消 → 不補彈；之後取消 → 已補彈', () => {
    for (const hz of RATES) {
      // 戰術換彈 1.6 s、補彈點 0.7 → 開始後 1.12 s 補彈。
      const a = rifleAfterShots(hz);
      const start = a.time;
      a.input.tap('reload');
      runTo(a, start + 1.0);
      a.input.tap('weapon2');
      a.step();
      const endA = a.eventsNamed('weapon:reloadEnd');
      expect(endA).toHaveLength(1);
      expect(endA[0]!.payload).toMatchObject({ completed: false, refilled: false, reason: 'swap', ammo: 22 });
      expect(a.manager.slots[0]!.ammo).toBe(22);

      const b = rifleAfterShots(hz);
      const startB = b.time;
      b.input.tap('reload');
      runTo(b, startB + 1.2);
      b.input.tap('weapon2');
      b.step();
      const endB = b.eventsNamed('weapon:reloadEnd');
      expect(endB[0]!.payload).toMatchObject({ completed: false, refilled: true, reason: 'swap', ammo: 32 });
      expect(b.manager.slots[0]!.ammo).toBe(32);
    }
  });

  it('換彈完成：戰術 1.6 s；換彈中不能射擊；補彈點後按開火可取消剩下的動作直接射擊', () => {
    const sim = rifleAfterShots(120);
    const start = sim.time;
    sim.input.tap('reload');
    sim.step();
    sim.input.down('fire');
    sim.run(0.5);
    expect(sim.count('weapon:fire')).toBe(10); // 補彈點前按住開火不會射擊、也不會取消
    sim.input.up('fire');
    runTo(sim, start + 1.6 + 0.05);
    const end = sim.eventsNamed('weapon:reloadEnd')[0]!;
    expect(end.payload).toMatchObject({ completed: true, refilled: true, reason: 'done', ammo: 32 });

    // 補彈點後按開火 → 取消並射擊。
    const s2 = rifleAfterShots(120);
    const st2 = s2.time;
    s2.input.tap('reload');
    runTo(s2, st2 + 1.3);
    s2.input.tap('fire');
    s2.step();
    expect(s2.eventsNamed('weapon:reloadEnd')[0]!.payload).toMatchObject({ completed: false, refilled: true, reason: 'fire' });
    expect(s2.count('weapon:fire')).toBe(11);
    expect(s2.manager.active!.ammo).toBe(31);
  });

  it('驗收：霰彈逐發裝填（每發 0.45 s）可被開火中斷，已入膛的彈保留', () => {
    for (const hz of RATES) {
      const sim = new WeaponSim({ hz, loadout: loadoutWith(arch('scatter_shotgun')) });
      sim.input.tap('fire');
      sim.run(0.8);
      sim.input.tap('fire');
      sim.run(0.8);
      sim.input.tap('fire');
      sim.run(0.8);
      expect(sim.manager.active!.ammo).toBe(3);
      const start = sim.time;
      sim.input.tap('reload');
      sim.step();
      expect(sim.eventsNamed('weapon:reloadStart')[0]!.payload.kind).toBe('shell');
      // 1.0 s：第 1 發在 0.315 s、第 2 發在 0.765 s 入膛。
      runTo(sim, start + 1.0);
      expect(sim.count('weapon:reloadShell')).toBe(2);
      expect(sim.manager.active!.ammo).toBe(5);
      sim.input.tap('fire');
      sim.step();
      expect(sim.eventsNamed('weapon:reloadEnd')[0]!.payload).toMatchObject({ completed: false, refilled: true, reason: 'fire' });
      expect(sim.count('weapon:fire')).toBe(4);
      expect(fireTimes(sim)[3]).toBeCloseTo(start + 1.0, 9);
      expect(sim.manager.active!.ammo).toBe(4);
    }
  });

  it('霰彈逐發裝填到滿：6 發空倉從 0 裝滿 = 6 × 0.45 s', () => {
    const sim = new WeaponSim({ loadout: loadoutWith(arch('scatter_shotgun', (d) => (d.fire.rpm = 6000))) });
    for (let i = 0; i < 6; i++) {
      sim.input.tap('fire');
      sim.run(0.02);
    }
    sim.run(4);
    const start = sim.eventsNamed('weapon:reloadStart')[0]!;
    expect(start.payload.duration as number).toBeCloseTo(6 * 0.45, 9);
    const end = sim.eventsNamed('weapon:reloadEnd')[0]!;
    expect(end.payload).toMatchObject({ completed: true, ammo: 6 });
    expect(sim.count('weapon:reloadShell')).toBe(6);
  });

  it('手動衝刺模式按衝刺鍵取消換彈；自動衝刺不取消', () => {
    const sim = rifleAfterShots(120);
    sim.settings.autoSprint = false;
    sim.input.tap('reload');
    sim.run(0.3);
    sim.input.tap('sprint');
    sim.step();
    expect(sim.eventsNamed('weapon:reloadEnd')[0]!.payload).toMatchObject({ reason: 'sprint', refilled: false });
    const auto = rifleAfterShots(120);
    (auto.player as FakePlayer).sprinting = true;
    auto.input.tap('reload');
    auto.run(2);
    expect(auto.eventsNamed('weapon:reloadEnd')[0]!.payload).toMatchObject({ reason: 'done', completed: true });
  });

  it('備彈有限時從備彈扣，備彈用完不能換彈', () => {
    const sim = new WeaponSim({ loadout: loadoutWith(arch('hand_cannon', (d) => (d.ammo.reserve = 5))) });
    for (let i = 0; i < 8; i++) {
      sim.input.tap('fire');
      sim.run(0.4);
    }
    sim.run(2);
    expect(sim.manager.active!.ammo).toBe(5);
    expect(sim.manager.active!.reserve).toBe(0);
    for (let i = 0; i < 5; i++) {
      sim.input.tap('fire');
      sim.run(0.4);
    }
    sim.input.tap('fire');
    sim.run(0.4);
    expect(sim.manager.active!.ammo).toBe(0);
    expect(sim.count('weapon:dryFire')).toBe(1);
  });
});

// ── 散布與後座（驗收）──────────────────────────────────

describe('散布與後座', () => {
  it('驗收：停火後散布回到基礎值（各步長一致）', () => {
    const spreads = RATES.map((hz) => {
      const sim = new WeaponSim({ hz });
      const base = sim.manager.currentSpread();
      expect(base).toBeCloseTo(1.6);
      sim.input.down('fire');
      sim.run(1);
      const firing = sim.manager.currentSpread();
      expect(firing).toBeGreaterThan(base + 0.5);
      expect(firing).toBeLessThanOrEqual(4 + 1e-9);
      sim.input.up('fire');
      sim.run(1);
      expect(sim.manager.currentSpread()).toBeCloseTo(base, 9);
      return firing;
    });
    expect(spreads[1]).toBeCloseTo(spreads[0]!, 9);
    expect(spreads[2]).toBeCloseTo(spreads[0]!, 9);
  });

  it('移動中散布變寬（寬鬆倍率），空中更寬，跑牆不算空中', () => {
    const player = new FakePlayer();
    const sim = new WeaponSim({ player });
    const stand = sim.manager.currentSpread();
    player.state.speed = 10;
    expect(sim.manager.currentSpread()).toBeCloseTo(stand * 1.25);
    player.state.grounded = false;
    player.state.state = 'air';
    expect(sim.manager.currentSpread()).toBeCloseTo(stand * 1.25 * 1.5);
    player.state.state = 'wallRun';
    expect(sim.manager.currentSpread()).toBeCloseTo(stand * 1.25);
  });

  it('驗收：後座回正量不超過累積量；回正後最終視角回到原點，回正期間不再上跳', () => {
    for (const hz of RATES) {
      const sim = new WeaponSim({ hz });
      sim.input.down('fire');
      sim.run(1.5);
      const r = sim.manager.recoil;
      expect(r.pitch).toBeGreaterThan(3);
      expect(sim.view.viewPitch).toBeCloseTo(r.pitch * DEG2RAD, 9);
      expect(sim.view.pitch).toBe(0); // 玩家視角不變，後座只在偏移
      sim.input.up('fire');
      let prev = sim.view.viewPitch;
      for (let i = 0; i < 2 * hz; i++) {
        sim.step();
        expect(sim.view.viewPitch).toBeLessThanOrEqual(prev + 1e-12);
        prev = sim.view.viewPitch;
      }
      expect(r.magnitude).toBe(0);
      expect(r.recovered).toBeLessThanOrEqual(r.accumulated + 1e-9);
      expect(r.recovered + r.absorbed).toBeLessThanOrEqual(r.accumulated + 1e-9);
      expect(sim.view.viewPitch).toBeCloseTo(0, 12);
    }
  });

  it('壓槍吸收：玩家往下壓的量先抵掉後座，回正不會把畫面拉到壓槍位置以下', () => {
    const run = (compensate: boolean): number => {
      const sim = new WeaponSim({ config: { recoilCompensation: compensate } });
      sim.input.down('fire');
      sim.run(1);
      sim.input.up('fire');
      const offset = sim.manager.recoil.pitch;
      expect(offset).toBeGreaterThan(3);
      const before = sim.view.viewPitch;
      // 玩家往下壓 3°（滑鼠）。
      sim.view.rotate(0, -3 * DEG2RAD);
      sim.step();
      if (compensate) {
        // 畫面只照玩家的意思移動 3°（加上這一步內的回正量為 0：仍在回正延遲內）。
        expect(sim.view.viewPitch).toBeCloseTo(before - 3 * DEG2RAD, 9);
        expect(sim.manager.recoil.pitch).toBeCloseTo(offset - 3, 9);
      }
      sim.run(3);
      return sim.view.viewPitch / DEG2RAD;
    };
    // 有吸收：後座 offset 中有 3° 被玩家抵掉，回正後回到原來的瞄準點（0°）。
    expect(run(true)).toBeCloseTo(0, 6);
    // 沒有吸收：回正把整個 offset 拉回，畫面停在壓槍後的位置（-3°）。
    expect(run(false)).toBeCloseTo(-3, 6);
  });

  it('開鏡時後座乘上 adsMult，散布用開鏡值', () => {
    const hip = new WeaponSim();
    hip.input.down('fire');
    hip.run(0.55);
    const ads = new WeaponSim();
    ads.input.down('ads');
    ads.run(0.5);
    expect(ads.manager.ads).toBe(1);
    expect(ads.manager.currentSpread()).toBeCloseTo(0.25);
    ads.input.down('fire');
    ads.run(0.55);
    expect(ads.manager.recoil.accumulated).toBeCloseTo(hip.manager.recoil.accumulated * 0.7, 6);
  });

  it('霰彈：固定彈丸圖案 + 整體散布（彈丸之間的相對角度固定）', () => {
    const physics = new Physics();
    const bus = new EventBus<GameEvents>();
    const bal = new Ballistics({ physics, bus });
    const sim = new WeaponSim({ loadout: loadoutWith(arch('scatter_shotgun')), ballistics: bal, bus });
    sim.input.tap('fire');
    sim.step();
    const pellets = sim.eventsNamed('weapon:hitscan');
    expect(pellets).toHaveLength(10);
    const dirs = pellets.map((p) => {
      const o = p.payload.origin as { x: number; y: number; z: number };
      const e = p.payload.end as { x: number; y: number; z: number };
      const l = Math.hypot(e.x - o.x, e.y - o.y, e.z - o.z);
      return { x: (e.x - o.x) / l, y: (e.y - o.y) / l, z: (e.z - o.z) / l };
    });
    // 中心彈丸與外圈彈丸夾角約 3.4°（圖案半徑），與整體散布無關。
    const angles = dirs.slice(4).map((d) => angleBetweenDeg(dirs[0]!, d));
    for (const a of angles) expect(a).toBeCloseTo(3.4, 1);
    physics.dispose();
  });
});

// ── 開鏡、切槍 ───────────────────────────────────────────

describe('開鏡', () => {
  it('進度 0→1 用 adsTime；FOV 縮放與靈敏度依焦距換算再乘使用者倍率；開鏡減速', () => {
    const sim = new WeaponSim({ settings: { adsSensitivity: 0.5 } });
    sim.input.down('ads');
    sim.run(0.1);
    expect(sim.manager.ads).toBeCloseTo(0.5, 9);
    sim.run(0.2);
    expect(sim.manager.ads).toBe(1);
    sim.manager.render(1);
    expect(sim.camera.fovZoom).toBeCloseTo(1.3, 9);
    expect(sim.mouse.scale).toBeCloseTo((1 / 1.3) * 0.5, 9);
    expect(sim.manager.moveSpeedScale).toBeCloseTo(0.75, 9);
    expect(sim.eventsNamed('weapon:ads')[0]!.payload).toMatchObject({ active: true, forced: false });
    sim.input.up('ads');
    sim.run(0.3);
    sim.manager.render(1);
    expect(sim.camera.fovZoom).toBe(1);
    expect(sim.mouse.scale).toBeCloseTo(1, 12);
  });

  it('狙擊槍開鏡 4×：靈敏度 = tan(adsFov/2) / tan(hipFov/2) = 0.25', () => {
    const sim = new WeaponSim({ loadout: loadoutWith(arch('rail_sniper')) });
    sim.input.down('ads');
    sim.run(0.5);
    sim.manager.render(1);
    expect(sim.camera.fovZoom).toBeCloseTo(4, 9);
    expect(sim.mouse.scale).toBeCloseTo(0.25, 9);
    expect(sim.manager.currentSpread()).toBe(0);
  });

  it('Dash、攀爬時強制退出開鏡（切換模式時關掉切換狀態）；攀爬中不能射擊', () => {
    const player = new FakePlayer();
    const sim = new WeaponSim({ player, settings: { adsMode: 'toggle' } });
    sim.input.down('ads');
    sim.run(0.3);
    expect(sim.manager.ads).toBe(1);
    player.state.state = 'dash';
    sim.step();
    expect(sim.eventsNamed('weapon:ads').at(-1)!.payload).toMatchObject({ active: false, forced: true });
    expect(sim.toggles).toContainEqual({ action: 'ads', on: false });
    sim.run(0.3);
    expect(sim.manager.ads).toBe(0);
    player.state.state = 'mantle';
    sim.input.down('fire');
    sim.run(0.3);
    expect(sim.count('weapon:fire')).toBe(0);
    player.state.state = 'ground';
    sim.run(0.05);
    expect(sim.count('weapon:fire')).toBeGreaterThan(0);
  });
});

describe('切槍', () => {
  it('切槍時間 = 舊槍 swapOut + 新槍 swapIn；完成前不能射擊，緩衝內的開火在完成時發射', () => {
    for (const hz of RATES) {
      const sim = new WeaponSim({ hz });
      sim.input.tap('weapon2');
      sim.step();
      expect(sim.manager.phase).toBe('swapping');
      const swaps = sim.eventsNamed('weapon:swap');
      expect(swaps[0]!.payload).toMatchObject({ phase: 'out', fromSlot: 0, toSlot: 1 });
      expect(swaps[0]!.payload.duration as number).toBeCloseTo(0.25 + 0.45, 9);
      runTo(sim, 0.7 - 0.1);
      sim.input.tap('fire');
      sim.run(0.3);
      const phases = sim.eventsNamed('weapon:swap').map((e) => e.payload.phase);
      expect(phases).toEqual(['out', 'in', 'done']);
      expect(sim.manager.activeSlot).toBe(1);
      expect(fireTimes(sim)[0]).toBeCloseTo(0.7, 9);
    }
  });

  it('Q 切回上一把、滾輪循環；切到目前武器無效', () => {
    const sim = new WeaponSim();
    sim.input.tap('weapon1');
    sim.step();
    expect(sim.count('weapon:swap')).toBe(0);
    sim.input.tap('weapon4');
    sim.run(1.5);
    expect(sim.manager.activeSlot).toBe(3);
    sim.input.tap('weaponLast');
    sim.run(1.5);
    expect(sim.manager.activeSlot).toBe(0);
    sim.input.tap('weaponPrev');
    sim.run(1.5);
    expect(sim.manager.activeSlot).toBe(4);
    sim.input.tap('weaponNext');
    sim.run(1.5);
    expect(sim.manager.activeSlot).toBe(0);
    expect(sim.manager.cycleFrom(0, -1)).toBe(4);
  });

  it('收槍中改變目標：收槍時間不變、改掏新目標', () => {
    const sim = new WeaponSim();
    sim.input.tap('weapon2');
    sim.run(0.1);
    sim.input.tap('weapon3');
    sim.run(1);
    expect(sim.manager.activeSlot).toBe(2);
    const done = sim.eventsNamed('weapon:swap').find((e) => e.payload.phase === 'done')!;
    // 0.25（步槍收槍）+ 0.3（手炮掏槍）。
    expect(done.step * sim.dt).toBeCloseTo(0.55, 1);
  });
});

// ── 彈道（Rapier）──────────────────────────────────────

function shotFor(def: WeaponDef, id = 1): ShotContext {
  return { shotId: id, weaponId: def.id, source: 'player', def, perks: [], perkCtx: null };
}

describe('Hitscan', () => {
  it('命中、弱點倍率、距離衰減；DamageInfo 經 combat:damage 發出', () => {
    const physics = new Physics();
    const bus = new EventBus<GameEvents>();
    const bal = new Ballistics({ physics, bus });
    const near = new TestTarget('near', { x: 0, y: 1.65, z: -20 });
    const far = new TestTarget('far', { x: 3, y: 1.65, z: -45 });
    const head = new TestTarget('head', { x: -3, y: 1.65, z: -10 });
    addTargetBall(physics, near, near.center);
    addTargetBall(physics, far, far.center);
    addTargetBall(physics, head, head.center, 0.3, 'crit');
    const events: GameEvents['combat:damage'][] = [];
    bus.on('combat:damage', (i) => events.push({ ...i }));
    const rifle = createArchetype('assault_rifle')!;
    const eye = { x: 0, y: 1.65, z: 0 };
    const dirTo = (c: { x: number; y: number; z: number }): { x: number; y: number; z: number } => {
      const d = { x: c.x - eye.x, y: c.y - eye.y, z: c.z - eye.z };
      const l = Math.hypot(d.x, d.y, d.z);
      return { x: d.x / l, y: d.y / l, z: d.z / l };
    };
    const r1 = bal.hitscan(eye, dirTo(near.center), shotFor(rifle));
    expect(r1.targetCount).toBe(1);
    expect(near.total).toBeCloseTo(18);
    expect(events[0]).toMatchObject({ isCrit: false, kind: 'hitscan', weaponId: 'assault_rifle', isKill: false, zone: 'body' });
    bal.hitscan(eye, dirTo(far.center), shotFor(rifle));
    const dist = far.hits[0]!.distance;
    expect(far.total).toBeCloseTo(18 * falloffMultiplier(dist, 30, 60, 0.6), 6);
    expect(far.total).toBeLessThan(18);
    bal.hitscan(eye, dirTo(head.center), shotFor(rifle));
    expect(head.total).toBeCloseTo(18 * 1.8);
    expect(head.hits[0]!.isCrit).toBe(true);
    physics.dispose();
  });

  it('不穿牆；穿透上限內穿過多個目標（狙擊槍最多 3 個），死亡目標不擋子彈；擊殺回報 isKill', () => {
    const physics = new Physics();
    const bal = new Ballistics({ physics });
    const eye = { x: 0, y: 1.65, z: 0 };
    const fwd = { x: 0, y: 0, z: -1 };
    const ts = [5, 10, 15, 20].map((z, i) => {
      const t = new TestTarget(`t${i}`, { x: 0, y: 1.65, z: -z }, 100);
      addTargetBall(physics, t, t.center);
      return t;
    });
    const sniper = createArchetype('rail_sniper')!;
    const res = bal.hitscan(eye, fwd, shotFor(sniper));
    expect(res.targetCount).toBe(3);
    expect(ts.map((t) => t.hits.length)).toEqual([1, 1, 1, 0]);
    expect(res.targets[0]!.killed).toBe(true);
    expect(res.targets[1]!.killed).toBe(true);
    expect(ts[0]!.alive).toBe(false);
    // 前 3 個已死亡：下一槍穿過屍體打到第 4 個。
    bal.hitscan(eye, fwd, shotFor(sniper, 2));
    expect(ts[3]!.hits).toHaveLength(1);

    // 牆在第 1、2 個之間：只打到第 1 個，終點在牆上。
    const p2 = new Physics();
    const b2 = new Ballistics({ physics: p2 });
    const a = new TestTarget('a', { x: 0, y: 1.65, z: -5 });
    const b = new TestTarget('b', { x: 0, y: 1.65, z: -10 });
    addTargetBall(p2, a, a.center);
    addTargetBall(p2, b, b.center);
    addWall(p2, { x: 0, y: 1.65, z: -7.5 }, { x: 2, y: 2, z: 0.1 });
    const r2 = b2.hitscan(eye, fwd, shotFor(sniper));
    expect(a.hits).toHaveLength(1);
    expect(b.hits).toHaveLength(0);
    expect(r2.hitWorld).toBe(true);
    expect(r2.end.z).toBeCloseTo(-7.4, 3);
    expect(r2.surface).toBe('concrete');
    // 步槍（不穿透）只打第一個。
    const rifle = createArchetype('assault_rifle')!;
    const r3 = b2.hitscan(eye, fwd, shotFor(rifle));
    expect(r3.targetCount).toBe(1);
    expect(r3.end.z).toBeCloseTo(-4.6, 3);
    physics.dispose();
    p2.dispose();
  });

  it('經 WeaponManager 開火：沿「視線＋後座偏移」射擊，第一發打在準心', () => {
    const physics = new Physics();
    const bus = new EventBus<GameEvents>();
    const bal = new Ballistics({ physics, bus });
    const t = new TestTarget('t', { x: 0, y: 1.65, z: -15 });
    addTargetBall(physics, t, t.center, 0.3);
    const sim = new WeaponSim({
      bus,
      ballistics: bal,
      loadout: loadoutWith(arch('hand_cannon', (d) => (d.spread.hip = 0))),
    });
    sim.input.tap('fire');
    sim.step();
    expect(t.hits).toHaveLength(1);
    expect(t.total).toBeCloseTo(60);
    // 第二發：手炮強烈上跳（2.6–3.2°），回正延遲 0.06 s、30°/s；緊接著打會偏高打不到 0.3 m 的球。
    expect(sim.manager.recoil.pitch).toBeGreaterThan(2.5);
    physics.dispose();
  });
});

describe('投射物與範圍傷害', () => {
  function plasma(mutate?: (d: WeaponDef) => void): WeaponDef {
    return arch('plasma_launcher', mutate);
  }

  function flyUntilDone(bal: Ballistics, dt: number, maxSteps = 2000): void {
    for (let i = 0; i < maxSteps && bal.projectiles.activeCount > 0; i++) bal.step(dt);
  }

  it('驗收：不會穿過 0.2 m 的薄牆（不同步長、速度、半徑）', () => {
    for (const hz of [30, 60, 120, 240]) {
      for (const speed of [45, 300]) {
        for (const radius of [0.15, 0]) {
          const physics = new Physics();
          const bus = new EventBus<GameEvents>();
          const bal = new Ballistics({ physics, bus });
          addWall(physics, { x: 0, y: 1.65, z: -10 }, { x: 3, y: 3, z: 0.1 });
          const behind = new TestTarget('behind', { x: 0, y: 1.65, z: -10.6 });
          addTargetBall(physics, behind, behind.center, 0.4);
          const explosions: { x: number; y: number; z: number }[] = [];
          bus.on('weapon:explosion', (e) => explosions.push({ ...e.point }));
          let minZ = 0;
          bus.on('weapon:projectile', (e) => (minZ = Math.min(minZ, e.position.z)));
          const def = plasma((d) => {
            d.projectile!.speed = speed;
            d.projectile!.radius = radius;
          });
          bal.spawnProjectile({ x: 0, y: 1.65, z: 0 }, { x: 0, y: 0, z: -1 }, shotFor(def), 0);
          let steps = 0;
          while (bal.projectiles.activeCount > 0 && steps < 1000) {
            bal.step(1 / hz);
            bal.projectiles.forEachActive((p) => (minZ = Math.min(minZ, p.position.z)));
            steps++;
          }
          expect(explosions).toHaveLength(1);
          expect(explosions[0]!.z).toBeGreaterThan(-9.9 - 1e-3);
          expect(explosions[0]!.z).toBeCloseTo(-9.9 + radius, 2);
          expect(minZ).toBeGreaterThan(-9.9 - 1e-3);
          expect(behind.hits).toHaveLength(0); // 牆後的目標（中心距爆炸點 < 4 m）被牆擋住
          physics.dispose();
        }
      }
    }
  });

  it('驗收：範圍傷害被牆擋住時不生效；開闊處依距離衰減；直擊另加範圍傷害', () => {
    const physics = new Physics();
    const bus = new EventBus<GameEvents>();
    const bal = new Ballistics({ physics, bus });
    addWall(physics, { x: 0, y: 1.65, z: -10 }, { x: 1, y: 3, z: 0.1 });
    // 牆後 1.5 m（擋住）、牆前側邊 2 m（看得到）。
    const hidden = new TestTarget('hidden', { x: 0, y: 1.65, z: -11.5 });
    const open = new TestTarget('open', { x: 2, y: 1.65, z: -9.5 });
    addTargetBall(physics, hidden, hidden.center);
    addTargetBall(physics, open, open.center);
    const def = plasma();
    bal.spawnProjectile({ x: 0, y: 1.65, z: 0 }, { x: 0, y: 0, z: -1 }, shotFor(def), 0);
    flyUntilDone(bal, 1 / 120);
    expect(hidden.hits).toHaveLength(0);
    expect(open.hits).toHaveLength(1);
    const h = open.hits[0]!;
    expect(h.kind).toBe('splash');
    expect(h.isCrit).toBe(false);
    expect(h.amount).toBeCloseTo(70 * falloffMultiplier(h.distance, 0, 4, 0.25), 6);
    expect(h.amount).toBeLessThan(70);
    expect(h.amount).toBeGreaterThan(70 * 0.25);
    physics.dispose();

    // 直擊：90 + 範圍（中心很近，接近 70）。
    const p2 = new Physics();
    const b2 = new Ballistics({ physics: p2 });
    const direct = new TestTarget('direct', { x: 0, y: 1.65, z: -10 });
    addTargetBall(p2, direct, direct.center, 0.4);
    b2.spawnProjectile({ x: 0, y: 1.65, z: 0 }, { x: 0, y: 0, z: -1 }, shotFor(def), 0);
    flyUntilDone(b2, 1 / 120);
    expect(direct.hits.map((x) => x.kind)).toEqual(['projectile', 'splash']);
    expect(direct.hits[0]!.amount).toBeCloseTo(90);
    expect(direct.hits[1]!.amount).toBeGreaterThan(60);
    p2.dispose();
  });

  it('投射物與步長無關：不同步長的爆炸點與時間一致（生成時推進同一步剩下的時間）', () => {
    const points = RATES.map((hz) => {
      const physics = new Physics();
      const bus = new EventBus<GameEvents>();
      const bal = new Ballistics({ physics, bus });
      addWall(physics, { x: 0, y: 0, z: -30 }, { x: 10, y: 10, z: 0.1 });
      let point = { x: 0, y: 0, z: 0 };
      bus.on('weapon:explosion', (e) => (point = { ...e.point }));
      const sim = new WeaponSim({ hz, bus, ballistics: bal, loadout: loadoutWith(plasma((d) => (d.projectile!.gravity = 9.81))) });
      sim.view.set(0, 10 * DEG2RAD);
      sim.run(0.013);
      sim.input.tap('fire');
      sim.run(2);
      physics.dispose();
      return point;
    });
    for (const p of points.slice(1)) {
      expect(p.y).toBeCloseTo(points[0]!.y, 3);
      expect(p.z).toBeCloseTo(points[0]!.z, 3);
    }
  });

  it('逾時消失不爆炸', () => {
    const physics = new Physics();
    const bus = new EventBus<GameEvents>();
    const bal = new Ballistics({ physics, bus });
    const phases: string[] = [];
    bus.on('weapon:projectile', (e) => phases.push(e.phase));
    let exploded = 0;
    bus.on('weapon:explosion', () => exploded++);
    bal.spawnProjectile({ x: 0, y: 10, z: 0 }, { x: 0, y: 1, z: 0 }, shotFor(plasma()), 0);
    flyUntilDone(bal, 1 / 60);
    expect(phases).toEqual(['spawn', 'expire']);
    expect(exploded).toBe(0);
    physics.dispose();
  });

  it('自身擊退可以火箭跳：朝腳下開火，玩家被往上推，比一般跳躍高', () => {
    const sim = new MovementSim({ primitives: [floorBox('floor', -20, 20, -20, 20)] });
    sim.settle();
    const bus = sim.bus;
    const player = sim.player;
    const bal = new Ballistics({
      physics: sim.physics,
      bus,
      getPlayerCenter: (out) => {
        out.x = player.position.x;
        out.y = player.position.y + player.height / 2;
        out.z = player.position.z;
        return out;
      },
      applyPlayerImpulse: (dv) => player.addImpulse(dv),
    });
    let knock = 0;
    bus.on('weapon:explosion', (e) => (knock = e.selfKnockback));
    const eye = player.eyeNow(new THREE.Vector3());
    bal.spawnProjectile(eye, { x: 0, y: -1, z: 0 }, shotFor(plasma()), 0);
    let maxY = player.position.y;
    const startY = player.position.y;
    for (let i = 0; i < 240; i++) {
      bal.step(sim.dt);
      sim.step();
      maxY = Math.max(maxY, player.position.y);
    }
    expect(knock).toBeGreaterThan(8);
    expect(knock).toBeLessThanOrEqual(12);
    expect(maxY - startY).toBeGreaterThan(1.5);
    expect(sim.eventsNamed('player:land').length).toBeGreaterThan(0);
    sim.dispose();
  });
});

describe('近戰', () => {
  it('前方錐形內的目標：突進吸附、0.12 s 命中 55 傷害；冷卻 0.6 s；錐形外與牆後打不到', () => {
    const physics = new Physics();
    const bus = new EventBus<GameEvents>();
    const bal = new Ballistics({ physics, bus });
    const target = new TestTarget('m', { x: 0, y: 1.65, z: -2.6 });
    addTargetBall(physics, target, target.center, 0.4);
    const player = new FakePlayer();
    const sim = new WeaponSim({ bus, ballistics: bal, player });
    sim.input.tap('melee');
    sim.step();
    expect(sim.eventsNamed('weapon:melee')[0]!.payload).toMatchObject({ phase: 'start', lunge: true });
    expect(player.velocity.z).toBeCloseTo(-14, 6);
    sim.run(0.15);
    expect(target.hits).toHaveLength(1);
    expect(target.hits[0]).toMatchObject({ amount: 55, kind: 'melee', weaponId: 'melee' });
    expect(sim.eventsNamed('weapon:melee')[1]!.payload).toMatchObject({ phase: 'hit', damage: 55 });
    // 冷卻中再按無效。
    sim.input.tap('melee');
    sim.run(0.2);
    expect(sim.count('weapon:melee')).toBe(2);
    sim.run(0.4);
    sim.input.tap('melee');
    sim.run(0.2);
    expect(target.hits).toHaveLength(2);
    physics.dispose();

    // 錐形外（側邊 60°）與牆後：miss。
    const p2 = new Physics();
    const b2 = new Ballistics({ physics: p2 });
    const side = new TestTarget('side', { x: -2.5, y: 1.65, z: -1.4 });
    const walled = new TestTarget('walled', { x: 0, y: 1.65, z: -3 });
    addTargetBall(p2, side, side.center);
    addTargetBall(p2, walled, walled.center);
    addWall(p2, { x: 0, y: 1.65, z: -1.5 }, { x: 0.6, y: 1, z: 0.05 });
    const s2 = new WeaponSim({ ballistics: b2 });
    s2.input.tap('melee');
    s2.run(0.3);
    expect(side.hits).toHaveLength(0);
    expect(walled.hits).toHaveLength(0);
    expect(s2.eventsNamed('weapon:melee')[1]!.payload.phase).toBe('miss');
    p2.dispose();
  });

  it('近戰中按切槍：動作結束後才切（不會被吃掉）', () => {
    const sim = new WeaponSim();
    sim.input.tap('melee');
    sim.step();
    sim.input.tap('weapon3');
    sim.step();
    expect(sim.count('weapon:swap')).toBe(0);
    sim.run(0.4);
    const out = sim.eventsNamed('weapon:swap')[0]!;
    expect(out.payload).toMatchObject({ phase: 'out', toSlot: 2 });
    expect(out.step * sim.dt).toBeCloseTo(0.4, 1);
    sim.run(1);
    expect(sim.manager.activeSlot).toBe(2);
  });

  it('近戰取消換彈、中斷開鏡，動作中不能射擊', () => {
    const sim = new WeaponSim();
    sim.input.down('fire');
    sim.run(0.35);
    sim.input.up('fire');
    sim.input.tap('reload');
    sim.run(0.2);
    sim.input.down('ads');
    sim.run(0.1);
    sim.input.tap('melee');
    sim.input.down('fire');
    sim.step();
    expect(sim.eventsNamed('weapon:reloadEnd')[0]!.payload.reason).toBe('melee');
    expect(sim.manager.phase).toBe('meleeing');
    const shots = sim.count('weapon:fire');
    sim.run(0.3);
    expect(sim.count('weapon:fire')).toBe(shots);
    sim.run(0.2);
    expect(sim.count('weapon:fire')).toBeGreaterThan(shots);
  });
});

// ── 調參面板 ─────────────────────────────────────────────

describe('調參面板「武器」', () => {
  /** WeaponDef 的所有數值／字串／布林葉節點路徑（彈丸圖案、perk 與音效參數除外）。 */
  function leafPaths(obj: unknown, prefix = ''): string[] {
    if (typeof obj !== 'object' || obj === null) return [prefix];
    if (Array.isArray(obj) && prefix.endsWith('pelletPattern')) return [];
    const out: string[] = [];
    for (const [k, v] of Object.entries(obj)) {
      const p = prefix ? `${prefix}.${k}` : k;
      if (p === 'perks' || p === 'audio.params' || p === 'id' || p === 'archetype' || p === 'ammo.type') continue;
      out.push(...leafPaths(v, p));
    }
    return out;
  }

  it('綁定目前武器的所有欄位（每把原型的每個數值欄位都在面板上）', () => {
    const fields = new Set(WEAPON_FIELDS.map((f) => f.path));
    for (const def of ARCHETYPES) {
      for (const p of leafPaths(def)) expect(fields, `${def.id}: ${p}`).toContain(p);
    }
    for (const f of WEAPON_FIELDS) {
      if (f.spec.min !== undefined) expect(f.spec.max).toBeGreaterThan(f.spec.min);
    }
  });

  it('讀寫欄位：陣列段、選填欄位、備彈無限 ↔ -1；修改即時生效', () => {
    const d = createArchetype('assault_rifle')!;
    expect(readWeaponField(d, 'recoil.pitchPerShot.1')).toBe(0.55);
    writeWeaponField(d, 'recoil.pitchPerShot.1', 0.9);
    expect(d.recoil.pitchPerShot[1]).toBe(0.9);
    expect(readWeaponField(d, 'ammo.reserve')).toBe(-1);
    writeWeaponField(d, 'ammo.reserve', 120);
    expect(d.ammo.reserve).toBe(120);
    writeWeaponField(d, 'ammo.reserve', -1);
    expect(d.ammo.reserve).toBe('infinite');
    expect(readWeaponField(d, 'projectile.speed')).toBe(0);
    expect(writeWeaponField(d, 'projectile.speed', 50)).toBe(false);
    expect(d.projectile).toBeUndefined();
    writeWeaponField(d, 'ammo.reloadPerShell', 0.3);
    expect(d.ammo.reloadPerShell).toBe(0.3);
    writeWeaponField(d, 'ammo.reloadPerShell', 0);
    expect('reloadPerShell' in d.ammo).toBe(false);
    expect(validateWeaponDef(d).ok).toBe(true);
    // 匯出的 JSON 可以讀回成合法的 WeaponDef。
    expect(validateWeaponDef(JSON.parse(exportWeaponJson(d))).ok).toBe(true);

    // 改 RPM 下一步就生效。
    const sim = new WeaponSim({ loadout: loadoutWith(arch('assault_rifle', (x) => (x.ammo.mag = 1000))) });
    sim.input.down('fire');
    sim.run(1);
    writeWeaponField(sim.manager.active!.def, 'fire.rpm', 1200);
    const before = sim.count('weapon:fire');
    sim.run(1);
    expect(sim.count('weapon:fire') - before).toBe(20);
  });

  it('系統參數有預設值且在範圍內', () => {
    const cfg = defaultWeaponSystemConfig();
    expect(cfg).toMatchObject({ meleeDamage: 55, meleeRange: 3.5, meleeCooldown: 0.6 });
  });
});
