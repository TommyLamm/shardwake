// M1-07 移動驗收：二段跳、噴射推進、Dash、抓鉤、狀態優先序、能力修正（Rapier 無頭世界＋腳本輸入）。
import * as THREE from 'three';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { GRAPPLE_ROPE_CONFIG, GrappleRope, ropePoints, ropeShape } from '@/fx/GrappleRope';
import { Physics } from '@/physics/Physics';
import { ChargeTimer, Cooldown, FuelTank, AbilityModifiers } from '@/player/Abilities';
import { viewDirection } from '@/player/Grapple';
import { MOVEMENT_CONFIG } from '@/player/MovementConfig';
import type { LevelPrimitive } from '@/world/LevelData';
import { MovementSim, boxMinMax, floorBox, type MovementSimOptions } from './helpers/movementSim';

beforeAll(async () => {
  await Physics.init();
});

const sims: MovementSim[] = [];
function sim(options: MovementSimOptions): MovementSim {
  const s = new MovementSim(options);
  sims.push(s);
  return s;
}
afterEach(() => {
  for (const s of sims.splice(0)) s.dispose();
});

const cfg = MOVEMENT_CONFIG;
const D = Math.PI / 180;
const FLOOR = floorBox('floor', -100, 100, -150, 60);

/** 傳送到空中並給定速度。 */
function launch(s: MovementSim, pos: [number, number, number], vel: [number, number, number], yaw = 0): void {
  s.player.teleport({ x: pos[0], y: pos[1], z: pos[2] }, yaw);
  s.player.velocity.set(vel[0], vel[1], vel[2]);
}

/** 視線對準世界座標點（從目前的眼睛位置）。 */
function aimAt(s: MovementSim, x: number, y: number, z: number): void {
  const p = s.player.position;
  const eyeY = p.y + s.player.eyeHeight;
  const dx = x - p.x;
  const dy = y - eyeY;
  const dz = z - p.z;
  s.input.setYaw(Math.atan2(-dx, -dz));
  s.input.setPitch(Math.atan2(dy, Math.hypot(dx, dz)));
}

describe('能力計時器與修正介面', () => {
  it('ChargeTimer：依序回充，一次一格', () => {
    const t = new ChargeTimer(
      () => 2,
      () => 1.8,
    );
    expect(t.charges).toBe(2);
    expect(t.use()).toBe(true);
    expect(t.use()).toBe(true);
    expect(t.use()).toBe(false);
    expect(t.update(1.0)).toBe(0);
    expect(t.progress).toBeCloseTo(1 / 1.8, 9);
    expect(t.update(0.8)).toBe(1);
    expect(t.charges).toBe(1);
    expect(t.update(1.79)).toBe(0);
    expect(t.update(0.01)).toBe(1);
    expect(t.full).toBe(true);
    expect(t.progress).toBe(0);
  });

  it('FuelTank 與 Cooldown', () => {
    const f = new FuelTank(
      () => 1,
      () => 0.8,
    );
    expect(f.drain(0.4)).toBeCloseTo(0.4, 9);
    expect(f.drain(2)).toBeCloseTo(0.6, 9);
    expect(f.empty).toBe(true);
    expect(f.recharge(0.5)).toBe(false);
    expect(f.fuel).toBeCloseTo(0.4, 9);
    expect(f.recharge(1)).toBe(true);
    expect(f.fraction).toBe(1);
    const c = new Cooldown();
    expect(c.ready).toBe(true);
    c.start(0.8);
    expect(c.update(0.5)).toBe(false);
    expect(c.progress).toBeCloseTo(0.625, 9);
    expect(c.update(0.3)).toBe(true);
    expect(c.ready).toBe(true);
  });

  it('AbilityModifiers：加值後乘倍率、次數取整數、可移除', () => {
    const m = new AbilityModifiers();
    expect(m.apply('dashCharges', 2)).toBe(2);
    const off = m.add({ stat: 'dashCharges', add: 1, source: 'mod-a' });
    m.add({ stat: 'dashDistance', mul: 1.5, source: 'mod-b' });
    m.add({ stat: 'dashDistance', add: 1, source: 'skill' });
    expect(m.apply('dashCharges', 2)).toBe(3);
    expect(m.apply('dashDistance', 7)).toBeCloseTo(12, 9);
    off();
    expect(m.apply('dashCharges', 2)).toBe(2);
    expect(m.removeSource('mod-b')).toBe(1);
    expect(m.apply('dashDistance', 7)).toBe(8);
    m.clear();
    expect(m.count).toBe(0);
  });

  it('預設值符合計畫；調參面板有能力開關與各能力資料夾', async () => {
    const { MOVEMENT_PANEL } = await import('@/player/MovementConfig');
    expect(cfg).toMatchObject({
      doubleJumpCount: 1,
      doubleJumpSpeed: 7.3,
      doubleJumpRedirect: 0.5,
      jetThrust: 34,
      jetMaxRiseSpeed: 5,
      jetFuel: 1,
      jetRechargeDelay: 0.3,
      jetRechargeRate: 0.8,
      dashCharges: 2,
      dashRechargeTime: 1.8,
      dashDistance: 7,
      dashDuration: 0.15,
      dashExitMinSpeed: 12,
      grappleHookSpeed: 150,
      grappleRange: 45,
      grappleMissCooldown: 0.8,
      grapplePullAccel: 50,
      grappleSteerAccel: 12,
      grappleMaxSpeed: 26,
      grappleGravityScale: 0.4,
      grappleReleaseDistance: 2.5,
      grapplePassDot: -0.2,
      grappleJumpBoost: 5,
      grappleMaxTime: 2.5,
      grappleCooldown: 4,
    });
    const folders = MOVEMENT_PANEL.map((g) => g.folder);
    expect(folders).toEqual(expect.arrayContaining(['移動/能力開關', '移動/二段跳', '移動/噴射', '移動/Dash', '移動/抓鉤']));
    const toggles = MOVEMENT_PANEL.find((g) => g.folder === '移動/能力開關')!.schema;
    expect(Object.keys(toggles).sort()).toEqual(['dashEnabled', 'doubleJumpEnabled', 'grappleEnabled', 'jetEnabled']);
  });

  it('viewDirection：yaw 0 面向 -Z、正值向左；pitch 正值抬頭', () => {
    const o = { x: 0, y: 0, z: 0 };
    viewDirection(0, 0, o);
    expect(o.z).toBeCloseTo(-1, 9);
    viewDirection(Math.PI / 2, 0, o);
    expect(o.x).toBeCloseTo(-1, 9);
    viewDirection(0, Math.PI / 4, o);
    expect(o.y).toBeCloseTo(Math.SQRT1_2, 9);
    expect(o.z).toBeCloseTo(-Math.SQRT1_2, 9);
  });
});

describe('二段跳', () => {
  it('空中按跳：vy = max(vy, 7.3)，約多 1.1 m 高；只有 1 次，著地後重置', () => {
    const s = sim({ primitives: [FLOOR] });
    s.settle();
    s.input.tap('jump');
    s.step();
    s.runUntil((x) => x.player.velocity.y <= 0, 2);
    const apex = s.player.position.y;
    expect(apex).toBeCloseTo(cfg.jumpHeight, 1);
    s.input.tap('jump');
    s.step();
    const dj = s.eventsNamed('player:doubleJump');
    expect(dj).toHaveLength(1);
    expect(dj[0]!.payload).toMatchObject({ speed: cfg.doubleJumpSpeed, remaining: 0 });
    expect(s.eventsNamed('player:jump')).toHaveLength(1);
    let peak = 0;
    s.runUntil((x) => {
      peak = Math.max(peak, x.player.position.y);
      return x.player.velocity.y < 0;
    }, 2);
    const rise = peak - apex;
    // 7.3²／(2 × 24) ≈ 1.11 m
    expect(rise).toBeGreaterThan(1.05);
    expect(rise).toBeLessThan(1.16);
    // 第二次空中按跳沒有效果（次數用完）。
    s.input.tap('jump');
    s.step();
    expect(s.eventsNamed('player:doubleJump')).toHaveLength(1);
    expect(s.player.velocity.y).toBeLessThan(0);
    // 著地後重置。
    s.runUntil((x) => x.player.grounded, 3);
    expect(s.player.abilities.doubleJumpsLeft).toBe(1);
    s.run(0.3);
    s.input.tap('jump');
    s.step();
    s.runUntil((x) => x.player.velocity.y <= 0, 2);
    s.input.tap('jump');
    s.step();
    expect(s.eventsNamed('player:doubleJump')).toHaveLength(2);
  });

  it('水平速度往輸入方向導向一部分（redirect 0.5），不增加總速', () => {
    const s = sim({ primitives: [FLOOR] });
    launch(s, [0, 10, 0], [0, 0, -10]);
    s.step();
    s.input.down('moveRight');
    s.input.tap('jump');
    s.step();
    expect(s.eventsNamed('player:doubleJump')).toHaveLength(1);
    const v = s.player.velocity;
    expect(Math.hypot(v.x, v.z)).toBeCloseTo(10, 2);
    // (0, -1) 與 (1, 0) 各半 → 45°（另有一步的 air control，< 1°）。
    const angle = Math.atan2(v.x, -v.z) / D;
    expect(angle).toBeGreaterThan(44.5);
    expect(angle).toBeLessThan(46);
  });

  it('土狼時間內按跳是土狼起跳（不消耗二段跳）；之後還能二段跳', () => {
    const s = sim({
      primitives: [boxMinMax('ledge', [-20, -1, -10], [0, 5, 10], 'floor'), floorBox('ground', -50, 50, -50, 50)],
      spawn: { pos: [-3, 5, 0], yaw: Math.PI / 2 },
    });
    s.settle();
    s.input.down('moveRight');
    s.runUntil((x) => x.state === 'air', 2);
    s.input.up('moveRight');
    s.run(0.05);
    s.input.tap('jump');
    s.step();
    expect(s.eventsNamed('player:jump')[0]!.payload.coyote).toBe(true);
    expect(s.eventsNamed('player:doubleJump')).toHaveLength(0);
    s.run(0.3);
    s.input.tap('jump');
    s.step();
    expect(s.eventsNamed('player:doubleJump')).toHaveLength(1);
  });

  it('落地保護：落地前 0.12 s 按跳是落地起跳；0.3 s 前按跳是二段跳', () => {
    const dry = sim({ primitives: [FLOOR], spawn: { pos: [0, 4, 0] } });
    dry.runUntil((x) => x.player.grounded, 3);
    const landStep = dry.stepCount;
    for (const [before, kind] of [
      [0.12, 'ground'],
      [0.3, 'double'],
    ] as const) {
      const s = sim({ primitives: [FLOOR], spawn: { pos: [0, 4, 0] } });
      s.step(landStep - Math.round(before * s.hz) - 1);
      s.input.tap('jump');
      s.step();
      s.run(0.6);
      if (kind === 'ground') {
        expect(s.eventsNamed('player:doubleJump'), `${before}`).toHaveLength(0);
        expect(s.eventsNamed('player:jump')[0]!.step - landStep, `${before}`).toBeLessThanOrEqual(1);
      } else {
        expect(s.eventsNamed('player:doubleJump'), `${before}`).toHaveLength(1);
        expect(s.eventsNamed('player:jump'), `${before}`).toHaveLength(0);
      }
    }
  });

  it('4.0 m 牆：二段跳後可以攀上（M1-06 單跳攀不上）', () => {
    const wall = boxMinMax('wall4', [-3, 0, -2.4 - 2], [3, 4, -0.4 - cfg.radius], 'climb');
    const s = sim({ primitives: [FLOOR, wall] });
    s.settle();
    s.input.tap('jump');
    s.input.down('moveForward');
    s.step();
    s.runUntil((x) => x.player.velocity.y <= 0.5, 1);
    expect(s.eventsNamed('player:mantle')).toHaveLength(0);
    s.input.tap('jump');
    expect(s.runUntil((x) => x.state === 'mantle', 1)).not.toBeNull();
    expect(s.eventsNamed('player:doubleJump')).toHaveLength(1);
    s.runUntil((x) => x.state !== 'mantle', 1);
    expect(s.player.position.y).toBeCloseTo(4.0, 1);
    expect(s.player.grounded).toBe(true);
  });

  it('跑牆時重置二段跳', () => {
    const s = sim({ primitives: [FLOOR, boxMinMax('wall-r', [2, 0, -100], [3, 10, 10], 'wallrun')] });
    launch(s, [0.6, 3, 0], [0, 0, -9], 0);
    s.input.tap('jump');
    s.step();
    expect(s.player.abilities.doubleJumpsLeft).toBe(0);
    s.input.down('moveForward');
    s.player.velocity.set(5, s.player.velocity.y, -9);
    expect(s.runUntil((x) => x.state === 'wallRun', 1)).not.toBeNull();
    expect(s.player.abilities.doubleJumpsLeft).toBe(1);
  });

  it('關閉二段跳時空中按跳沒有效果', () => {
    const s = sim({ primitives: [FLOOR], config: { doubleJumpEnabled: false } });
    launch(s, [0, 10, 0], [0, 0, 0]);
    s.step();
    s.input.tap('jump');
    s.step();
    expect(s.eventsNamed('player:doubleJump')).toHaveLength(0);
    expect(s.player.velocity.y).toBeLessThan(0);
  });
});

describe('噴射推進', () => {
  /** 原地跳起、在最高點二段跳並一直按住跳；回傳模擬。 */
  function jetUp(config?: MovementSimOptions['config']): MovementSim {
    const s = sim({ primitives: [FLOOR], config });
    s.settle();
    s.input.tap('jump');
    s.step();
    s.runUntil((x) => x.player.velocity.y <= 0, 2);
    s.input.down('jump');
    s.step();
    return s;
  }

  it('二段跳用完後長按跳：推力讓垂直速度到 5 m/s 為止；燃料 1.0 s 耗盡後沒有推力', () => {
    const s = jetUp();
    expect(s.eventsNamed('player:doubleJump')).toHaveLength(1);
    expect(s.runUntil((x) => x.eventsNamed('player:jetStart').length > 0, 0.5)).not.toBeNull();
    const startTime = s.eventsNamed('player:jetStart')[0]!.time;
    const djTime = s.eventsNamed('player:doubleJump')[0]!.time;
    expect(startTime - djTime).toBeCloseTo(cfg.jetHoldDelay, 1);
    const p = s.player;
    let maxVy = 0;
    let prevFuel = p.abilities.jet.fuel;
    while (s.eventsNamed('player:jetStop').length === 0 && s.time < 5) {
      s.step();
      maxVy = Math.max(maxVy, p.velocity.y);
      if (p.abilities.jetThisStep) {
        // 推進中每秒消耗 1 秒燃料。
        expect(prevFuel - p.abilities.jet.fuel).toBeCloseTo(s.dt, 6);
      }
      prevFuel = p.abilities.jet.fuel;
    }
    const stop = s.eventsNamed('player:jetStop')[0]!;
    expect(stop.payload.reason).toBe('empty');
    expect(stop.time - startTime).toBeCloseTo(cfg.jetFuel, 1);
    expect(maxVy).toBeLessThanOrEqual(cfg.jetMaxRiseSpeed + 1e-6);
    expect(maxVy).toBeGreaterThan(cfg.jetMaxRiseSpeed - 0.01);
    expect(p.abilities.jet.fuel).toBe(0);
    // 耗盡後仍按住跳：純重力。
    const vy0 = p.velocity.y;
    s.step(10);
    expect(p.velocity.y).toBeCloseTo(vy0 - cfg.gravity * 10 * s.dt, 6);
    expect(p.abilities.jetThisStep).toBe(false);
  });

  it('著地後 0.3 s 才以每秒 0.8 回充；放開跳時停止噴射', () => {
    const s = jetUp();
    s.runUntil((x) => x.eventsNamed('player:jetStart').length > 0, 0.5);
    s.run(0.3);
    s.input.up('jump');
    s.step();
    const stop = s.eventsNamed('player:jetStop')[0]!;
    expect(stop.payload.reason).toBe('released');
    const fuelLeft = s.player.abilities.jet.fuel;
    expect(fuelLeft).toBeGreaterThan(0.6);
    expect(fuelLeft).toBeLessThan(0.75);
    s.runUntil((x) => x.player.grounded, 5);
    const landed = s.time;
    s.run(cfg.jetRechargeDelay - 2 * s.dt);
    expect(s.player.abilities.jet.fuel).toBeCloseTo(fuelLeft, 9);
    s.run(0.2 + 2 * s.dt);
    expect(s.player.abilities.jet.fuel).toBeCloseTo(fuelLeft + 0.2 * cfg.jetRechargeRate, 1);
    expect(s.player.state.abilities.jet.recharging).toBe(true);
    s.runUntil((x) => x.player.abilities.jet.full, 3);
    expect(s.time - landed).toBeCloseTo(cfg.jetRechargeDelay + (cfg.jetFuel - fuelLeft) / cfg.jetRechargeRate, 1);
    expect(s.eventsNamed('player:abilityReady').some((e) => e.payload.ability === 'jet')).toBe(true);
  });

  it('燃料耗盡後落地，依規則回充到滿', () => {
    const s = jetUp();
    s.runUntil((x) => x.eventsNamed('player:jetStop').length > 0, 3);
    expect(s.player.abilities.jet.fuel).toBe(0);
    s.input.up('jump');
    s.runUntil((x) => x.player.grounded, 5);
    const landed = s.time;
    s.runUntil((x) => x.player.abilities.jet.fuel > 0, 2);
    expect(s.time - landed).toBeCloseTo(cfg.jetRechargeDelay, 1);
    s.runUntil((x) => x.player.abilities.jet.full, 3);
    expect(s.time - landed).toBeCloseTo(cfg.jetRechargeDelay + cfg.jetFuel / cfg.jetRechargeRate, 1);
  });

  it('跑牆中也回充（不需等待）', () => {
    const s = sim({ primitives: [FLOOR, boxMinMax('wall-r', [2, 0, -100], [3, 10, 10], 'wallrun')] });
    launch(s, [0.6, 3, 0], [5, 2, -9], 0);
    s.player.abilities.jet.fuel = 0.2;
    s.input.down('moveForward');
    expect(s.runUntil((x) => x.state === 'wallRun', 1)).not.toBeNull();
    const f0 = s.player.abilities.jet.fuel;
    s.run(0.5);
    expect(s.state).toBe('wallRun');
    expect(s.player.abilities.jet.fuel - f0).toBeCloseTo(0.5 * cfg.jetRechargeRate, 1);
  });

  it('地面起跳後一直按住跳不會噴射（要在空中按下）；關閉二段跳時空中長按直接噴射', () => {
    const s = sim({ primitives: [FLOOR] });
    s.settle();
    s.input.down('jump');
    s.run(1.2);
    expect(s.eventsNamed('player:jetStart')).toHaveLength(0);
    const n = sim({ primitives: [FLOOR], config: { doubleJumpEnabled: false } });
    launch(n, [0, 10, 0], [0, 0, 0]);
    n.step();
    n.input.down('jump');
    n.run(0.3);
    expect(n.eventsNamed('player:jetStart')).toHaveLength(1);
    expect(n.eventsNamed('player:doubleJump')).toHaveLength(0);
    // 關閉噴射：沒有推力。
    const off = sim({ primitives: [FLOOR], config: { jetEnabled: false, doubleJumpEnabled: false } });
    launch(off, [0, 10, 0], [0, 0, 0]);
    off.step();
    off.input.down('jump');
    off.run(0.3);
    expect(off.eventsNamed('player:jetStart')).toHaveLength(0);
  });

  it('水平推力往輸入方向（少量）', () => {
    const s = sim({ primitives: [FLOOR], config: { doubleJumpEnabled: false } });
    launch(s, [0, 20, 0], [0, 0, 0]);
    s.step();
    s.input.down('jump', 'moveForward');
    s.run(0.12 + 0.5);
    // 0.5 s × 6 m/s² ≈ 3 m/s（另有空中加速）。
    expect(-s.player.velocity.z).toBeGreaterThan(2.5);
    expect(-s.player.velocity.z).toBeLessThan(cfg.jetHorizontalMaxSpeed);
  });
});

describe('Dash', () => {
  it('平地 Dash 位移約 7 m（±5%），0.15 s 內完成；60／120／240 Hz 一致', () => {
    for (const hz of [60, 120, 240, 144]) {
      const s = sim({ primitives: [FLOOR], hz });
      s.settle();
      const z0 = s.player.position.z;
      s.input.tap('dash');
      const t = s.runUntil((x) => x.eventsNamed('player:state').some((e) => e.payload.from === 'dash'), 1);
      expect(t, `${hz}`).not.toBeNull();
      expect(t!, `${hz}`).toBeLessThanOrEqual(cfg.dashDuration + 1 / hz + 1e-9);
      const d = z0 - s.player.position.z;
      expect(d, `${hz}`).toBeGreaterThan(cfg.dashDistance * 0.95);
      expect(d, `${hz}`).toBeLessThan(cfg.dashDistance * 1.05);
      expect(s.player.position.y, `${hz}`).toBeCloseTo(0, 1);
      // 結束：沿 Dash 方向 12 m/s（靜止出發）。
      expect(s.speed, `${hz}`).toBeCloseTo(cfg.dashExitMinSpeed, 1);
      expect(s.state).toBe('ground');
    }
  });

  it('連續兩次 Dash 後第三次無效，1.8 s 後恢復一次', () => {
    const s = sim({ primitives: [FLOOR] });
    s.settle();
    const dashes = (): number => s.eventsNamed('player:dash').length;
    s.input.tap('dash');
    s.runUntil((x) => x.state !== 'dash', 1);
    s.input.tap('dash');
    s.step();
    expect(dashes()).toBe(2);
    s.runUntil((x) => x.state !== 'dash', 1);
    s.input.tap('dash');
    s.step();
    expect(dashes()).toBe(2);
    expect(s.player.abilities.dash.charges).toBe(0);
    const first = s.eventsNamed('player:dash')[0]!.time;
    s.runUntil((x) => x.player.abilities.dash.charges >= 1, 3);
    expect(s.time - first).toBeCloseTo(cfg.dashRechargeTime, 2);
    expect(s.eventsNamed('player:abilityReady')[0]!.payload).toMatchObject({ ability: 'dash', charges: 1 });
    s.input.tap('dash');
    s.step();
    expect(dashes()).toBe(3);
    expect(s.player.abilities.state.dash.charges).toBe(0);
  });

  it('方向 = 輸入方向（相對視角），沒有輸入則向前；空中 Dash 期間無重力、垂直速度歸零', () => {
    const s = sim({ primitives: [FLOOR] });
    launch(s, [0, 10, 0], [0, -6, 0], 30 * D);
    s.step();
    s.input.down('moveRight');
    s.input.tap('dash');
    s.step();
    const ev = s.eventsNamed('player:dash')[0]!;
    const dir = ev.payload.dir as { x: number; z: number };
    // yaw 30°（向左轉）時的右方 = (cos30°, −sin30°)。
    expect(dir.x).toBeCloseTo(Math.cos(30 * D), 6);
    expect(dir.z).toBeCloseTo(-Math.sin(30 * D), 6);
    expect(ev.payload.fromState).toBe('air');
    const y0 = s.player.position.y;
    s.runUntil((x) => x.state !== 'dash', 1);
    expect(Math.abs(s.player.position.y - y0)).toBeLessThan(1e-6);
    expect(s.player.velocity.y).toBe(0);
    expect(s.state).toBe('air');
    s.input.up('moveRight');
    // 沒有輸入：視線前方。
    s.input.tap('dash');
    s.step();
    const dir2 = s.eventsNamed('player:dash')[1]!.payload.dir as { x: number; z: number };
    expect(dir2.x).toBeCloseTo(-Math.sin(30 * D), 6);
    expect(dir2.z).toBeCloseTo(-Math.cos(30 * D), 6);
  });

  it('結束時水平速度 = max(原本沿該方向的速度, 12)', () => {
    const s = sim({ primitives: [FLOOR] });
    launch(s, [0, 10, 0], [0, 0, -18]);
    s.step();
    s.input.tap('dash');
    s.runUntil((x) => x.state !== 'dash', 1);
    expect(s.speed).toBeCloseTo(18 - 0, 0);
    expect(-s.player.velocity.z).toBeGreaterThan(17.5);
    // 往側面 Dash：原本沿該方向的速度為 0 → 12，側向分量不保留。
    const t = sim({ primitives: [FLOOR] });
    launch(t, [0, 10, 0], [0, 0, -18]);
    t.step();
    t.input.down('moveRight');
    t.input.tap('dash');
    t.runUntil((x) => x.state !== 'dash', 1);
    expect(t.player.velocity.x).toBeCloseTo(12, 0);
    expect(Math.abs(t.player.velocity.z)).toBeLessThan(0.5);
  });

  it('跑牆、滑鏟中都能 Dash（中斷該狀態）；地面 Dash 結束時按住蹲 → 接滑鏟', () => {
    // 跑牆中。
    const w = sim({ primitives: [FLOOR, boxMinMax('wall-r', [2, 0, -100], [3, 10, 10], 'wallrun')] });
    launch(w, [0.6, 3, 0], [5, 2, -9], 0);
    w.input.down('moveForward');
    w.runUntil((x) => x.state === 'wallRun', 1);
    w.run(0.2);
    w.input.tap('dash');
    w.step();
    expect(w.state).toBe('dash');
    expect(w.eventsNamed('player:wallRunEnd').at(-1)!.payload.reason).toBe('dash');
    // 滑鏟中 → Dash → 按住蹲 → 滑鏟。
    const s = sim({ primitives: [FLOOR] });
    s.settle();
    s.input.down('moveForward');
    s.run(0.6);
    s.input.down('crouch');
    s.runUntil((x) => x.state === 'slide', 1);
    s.run(0.1);
    s.input.tap('dash');
    s.step();
    expect(s.state).toBe('dash');
    expect(s.eventsNamed('player:slideEnd')).toHaveLength(1);
    s.runUntil((x) => x.state !== 'dash', 1);
    expect(s.state).toBe('slide');
    expect(s.eventsNamed('player:slideStart')).toHaveLength(2);
    expect(s.speed).toBeGreaterThanOrEqual(cfg.dashExitMinSpeed - 0.1);
  });

  it('Dash 撞牆會沿牆滑行、不穿牆', () => {
    const s = sim({ primitives: [FLOOR, boxMinMax('front', [-10, 0, -4], [10, 5, -3], 'cover')] });
    s.settle();
    s.input.tap('dash');
    s.runUntil((x) => x.state !== 'dash', 1);
    expect(s.player.position.z).toBeGreaterThan(-3 + cfg.radius - 0.05);
  });

  it('關閉 Dash 時按 Shift 沒有效果；能力修正增加充能次數', () => {
    const off = sim({ primitives: [FLOOR], config: { dashEnabled: false } });
    off.settle();
    off.input.tap('dash');
    off.run(0.2);
    expect(off.eventsNamed('player:dash')).toHaveLength(0);
    const s = sim({ primitives: [FLOOR] });
    s.settle();
    const remove = s.player.abilities.modifiers.add({ stat: 'dashCharges', add: 1, source: 'test' });
    s.player.abilities.dash.refill();
    for (let i = 0; i < 3; i++) {
      s.input.tap('dash');
      s.step();
      s.runUntil((x) => x.state !== 'dash', 1);
    }
    expect(s.eventsNamed('player:dash')).toHaveLength(3);
    remove();
    s.player.abilities.dash.refill();
    expect(s.player.abilities.dash.charges).toBe(2);
    // 修正 Dash 距離（× 1.5）。
    s.player.abilities.modifiers.add({ stat: 'dashDistance', mul: 1.5 });
    expect(s.player.abilities.stat('dashDistance')).toBeCloseTo(10.5, 9);
    expect(cfg.dashDistance).toBe(7);
  });
});

describe('抓鉤', () => {
  /** 正前方（-Z）dist 公尺處的牆（牆面 z = -dist）。 */
  const wallAt = (dist: number, material = 'grapple'): LevelPrimitive =>
    boxMinMax(`wall-${dist}`, [-15, 0, -dist - 1], [15, 12, -dist], material);

  it('30 m 外的牆可以附著，被拉到 2.5 m 內自動脫鉤', () => {
    const s = sim({ primitives: [FLOOR, wallAt(30)] });
    s.settle();
    s.player.updateGrappleAim();
    expect(s.player.abilities.state.grapple.aimAvailable).toBe(true);
    expect(s.player.abilities.state.grapple.aimDistance).toBeCloseTo(30, 1);
    expect(s.eventsNamed('player:grappleAim')[0]!.payload.available).toBe(true);
    s.input.down('grapple');
    s.step();
    expect(s.eventsNamed('player:grappleFire')).toHaveLength(1);
    expect(s.player.abilities.hook.phase).toBe('flying');
    // 鉤爪 150 m/s：30 m 約 0.2 s。
    const t = s.runUntil((x) => x.state === 'grapple', 1);
    expect(t).not.toBeNull();
    expect(t!).toBeCloseTo(30 / cfg.grappleHookSpeed, 1);
    const attach = s.eventsNamed('player:grappleAttach')[0]!;
    expect(attach.payload.distance as number).toBeCloseTo(30, 1);
    expect(s.eventsNamed('player:airReset').at(-1)!.payload.reason).toBe('grapple');
    let maxSpeed = 0;
    const rel = s.runUntil((x) => {
      maxSpeed = Math.max(maxSpeed, x.player.velocity.length());
      return x.state !== 'grapple';
    }, 3);
    expect(rel).not.toBeNull();
    const release = s.eventsNamed('player:grappleRelease')[0]!;
    expect(release.payload.reason).toBe('close');
    const eye = s.player.position.y + s.player.eyeHeight;
    const anchor = s.player.abilities.hook.anchor;
    expect(Math.hypot(s.player.position.x - anchor.x, eye - anchor.y, s.player.position.z - anchor.z)).toBeLessThan(cfg.grappleReleaseDistance);
    expect(maxSpeed).toBeLessThanOrEqual(cfg.grappleMaxSpeed + 1e-6);
    expect(maxSpeed).toBeGreaterThan(cfg.grappleMaxSpeed - 0.5);
    // 脫鉤保留速度（不硬性歸零），冷卻 4 s。
    expect(s.player.velocity.length()).toBeGreaterThan(20);
    expect(s.player.abilities.grappleCooldown.remaining).toBeCloseTo(cfg.grappleCooldown, 6);
  });

  it('50 m 外落空並進入 0.8 s 冷卻', () => {
    const s = sim({ primitives: [FLOOR, wallAt(50)] });
    s.settle();
    s.player.updateGrappleAim();
    expect(s.player.abilities.state.grapple.aimAvailable).toBe(false);
    s.input.down('grapple');
    const t = s.runUntil((x) => x.eventsNamed('player:grappleMiss').length > 0, 1);
    expect(t).not.toBeNull();
    expect(t!).toBeCloseTo(cfg.grappleRange / cfg.grappleHookSpeed, 1);
    const miss = s.eventsNamed('player:grappleMiss')[0]!;
    expect(miss.payload.reason).toBe('range');
    expect(-(miss.payload.point as { z: number }).z).toBeCloseTo(cfg.grappleRange, 0);
    expect(s.eventsNamed('player:grappleAttach')).toHaveLength(0);
    expect(s.player.abilities.grappleCooldown.remaining).toBeCloseTo(cfg.grappleMissCooldown, 6);
    s.input.up('grapple');
    s.run(cfg.grappleMissCooldown - 3 * s.dt);
    s.input.down('grapple');
    s.step();
    expect(s.eventsNamed('player:grappleFire')).toHaveLength(1);
    s.input.up('grapple');
    s.run(3 * s.dt);
    s.input.down('grapple');
    s.step();
    expect(s.eventsNamed('player:grappleFire')).toHaveLength(2);
    expect(s.eventsNamed('player:abilityReady').some((e) => e.payload.ability === 'grapple')).toBe(true);
  });

  it('打到不可勾的表面落空（surface）；飛行中放開會取消（cancel）', () => {
    const s = sim({ primitives: [FLOOR, wallAt(20, 'cover')] });
    s.settle();
    s.input.down('grapple');
    s.runUntil((x) => x.eventsNamed('player:grappleMiss').length > 0, 1);
    expect(s.eventsNamed('player:grappleMiss')[0]!.payload.reason).toBe('surface');
    const c = sim({ primitives: [FLOOR, wallAt(40)] });
    c.settle();
    c.input.down('grapple');
    c.step(5);
    c.input.up('grapple');
    c.step();
    expect(c.eventsNamed('player:grappleMiss')[0]!.payload.reason).toBe('cancel');
    c.run(0.5);
    expect(c.eventsNamed('player:grappleAttach')).toHaveLength(0);
  });

  it('附著中放開 F 脫鉤（input），冷卻 4 s 後才能再發射', () => {
    const s = sim({ primitives: [FLOOR, wallAt(40)] });
    s.settle();
    s.input.down('grapple');
    s.runUntil((x) => x.state === 'grapple', 1);
    s.run(0.3);
    s.input.up('grapple');
    s.step();
    expect(s.state).not.toBe('grapple');
    expect(s.eventsNamed('player:grappleRelease')[0]!.payload.reason).toBe('input');
    const v = s.player.velocity.length();
    expect(v).toBeGreaterThan(10);
    s.run(cfg.grappleCooldown - 0.1);
    s.input.down('grapple');
    s.step();
    expect(s.eventsNamed('player:grappleFire')).toHaveLength(1);
    s.input.up('grapple');
    s.run(0.15);
    s.input.down('grapple');
    s.step();
    expect(s.eventsNamed('player:grappleFire')).toHaveLength(2);
  });

  it('按跳脫鉤：額外 +5 m/s 上拋並重置二段跳', () => {
    const s = sim({ primitives: [FLOOR, wallAt(40)] });
    launch(s, [0, 6, 0], [0, 0, 0]);
    s.step();
    s.input.tap('jump');
    s.step();
    expect(s.player.abilities.doubleJumpsLeft).toBe(0);
    s.input.down('grapple');
    s.runUntil((x) => x.state === 'grapple', 1);
    expect(s.player.abilities.doubleJumpsLeft).toBe(1);
    s.run(0.3);
    const vy = s.player.velocity.y;
    s.input.tap('jump');
    s.step();
    expect(s.state).toBe('air');
    expect(s.eventsNamed('player:grappleRelease')[0]!.payload.reason).toBe('jump');
    expect(s.player.velocity.y).toBeCloseTo(Math.max(vy, 0) + cfg.grappleJumpBoost - cfg.gravity * s.dt, 0);
    s.input.up('grapple');
    s.run(0.1);
    s.input.tap('jump');
    s.step();
    expect(s.eventsNamed('player:doubleJump')).toHaveLength(2);
  });

  it('附著超過 2.5 s 脫鉤（timeout）；重力 × 0.4', () => {
    const s = sim({ primitives: [FLOOR, boxMinMax('tall', [-15, 0, -41], [15, 60, -40], 'grapple')], config: { grapplePullAccel: 0 } });
    launch(s, [0, 30, 0], [0, 0, 0]);
    aimAt(s, 0, 30, -40);
    s.input.down('grapple');
    s.runUntil((x) => x.state === 'grapple', 1);
    const vy0 = s.player.velocity.y;
    s.step(12);
    // 拉力為 0：只受 0.4 倍重力（繩子還沒拉緊）。
    expect(s.player.velocity.y - vy0).toBeCloseTo(-cfg.gravity * cfg.grappleGravityScale * 12 * s.dt, 3);
    const t0 = s.eventsNamed('player:grappleAttach')[0]!.time;
    s.runUntil((x) => x.state !== 'grapple', 4);
    const rel = s.eventsNamed('player:grappleRelease')[0]!;
    expect(rel.payload.reason).toBe('timeout');
    expect(rel.time - t0).toBeCloseTo(cfg.grappleMaxTime, 1);
  });

  it('繩長約束：與錨點的距離不會變長（可以擺盪）', () => {
    // 錨點在正上方的天花板；拉力 0，往側面移動 → 被繩子拉成擺盪。
    const s = sim({
      primitives: [FLOOR, boxMinMax('ceiling', [-20, 20, -20], [20, 21, 20], 'grapple')],
      config: { grapplePullAccel: 0, grappleMaxTime: 10 },
    });
    launch(s, [0, 10, 0], [8, 0, 0]);
    s.input.setPitch(Math.PI / 2 - 0.01);
    s.input.down('grapple');
    s.runUntil((x) => x.state === 'grapple', 1);
    const hook = s.player.abilities.hook;
    const dist = (): number => {
      const p = s.player.position;
      return Math.hypot(p.x - hook.anchor.x, p.y + s.player.eyeHeight - hook.anchor.y, p.z - hook.anchor.z);
    };
    const d0 = dist();
    let maxD = 0;
    let maxX = 0;
    for (let i = 0; i < 240 && s.state === 'grapple'; i++) {
      s.step();
      maxD = Math.max(maxD, dist());
      maxX = Math.max(maxX, s.player.position.x);
    }
    expect(maxD).toBeLessThan(d0 + 0.02);
    // 有擺盪：往側面走了一段，速度沒有歸零。
    expect(maxX).toBeGreaterThan(2);
    expect(s.player.velocity.length()).toBeGreaterThan(1);
  });

  it('飛越錨點時脫鉤（passed），保留速度', () => {
    // 錨點在細柱上，玩家帶著側向速度被拉過去，從旁邊飛過。
    const s = sim({
      primitives: [FLOOR, boxMinMax('pole', [-0.3, 0, -20.6], [0.3, 14, -20], 'grapple')],
      config: { grappleReleaseDistance: 0.5 },
    });
    launch(s, [0, 8, 0], [14, 0, 0]);
    aimAt(s, 0, 9.65, -20);
    s.input.down('grapple');
    s.runUntil((x) => x.state === 'grapple', 1);
    s.runUntil((x) => x.state !== 'grapple', 3);
    const rel = s.eventsNamed('player:grappleRelease')[0]!;
    expect(rel.payload.reason).toBe('passed');
    expect(s.player.velocity.length()).toBeGreaterThan(15);
  });

  it('攀爬中不能發射；關閉抓鉤時不發射也沒有準星輔助', () => {
    const off = sim({ primitives: [FLOOR, wallAt(20)], config: { grappleEnabled: false } });
    off.settle();
    off.player.updateGrappleAim();
    expect(off.player.abilities.state.grapple.aimAvailable).toBe(false);
    off.input.down('grapple');
    off.run(0.3);
    expect(off.eventsNamed('player:grappleFire')).toHaveLength(0);
    const box = boxMinMax('box', [-3, 0, -2.4 - 2], [3, 1.2, -0.4 - cfg.radius], 'climb');
    const m = sim({ primitives: [FLOOR, box, wallAt(30)] });
    m.settle();
    m.input.tap('jump');
    m.input.down('moveForward');
    m.runUntil((x) => x.state === 'mantle', 1);
    m.input.down('grapple');
    m.step();
    expect(m.eventsNamed('player:grappleFire')).toHaveLength(0);
  });
});

describe('狀態優先序與連招', () => {
  it('抓鉤附著可以打斷 Dash；Dash 不能打斷抓鉤', () => {
    const s = sim({ primitives: [FLOOR, boxMinMax('wall', [-15, 0, -16], [15, 12, -15], 'grapple')] });
    launch(s, [0, 4, 0], [0, 0, 0]);
    s.input.down('grapple');
    s.step();
    s.input.tap('dash');
    s.step();
    expect(s.state).toBe('dash');
    s.runUntil((x) => x.state === 'grapple', 1);
    expect(s.eventsNamed('player:state').some((e) => e.payload.from === 'dash' && e.payload.to === 'grapple')).toBe(true);
    s.input.tap('dash');
    s.step();
    expect(s.state).toBe('grapple');
    expect(s.eventsNamed('player:dash')).toHaveLength(1);
  });

  it('Dash 衝向有邊緣的牆 → 攀爬（攀爬 > Dash），結束速度不用 Dash 期間的位移速度', () => {
    const s = sim({ primitives: [FLOOR, boxMinMax('ledge', [-5, 0, -8], [5, 1.6, -4], 'climb')] });
    launch(s, [0, 0.8, 0], [0, 0, 0]);
    s.input.down('moveForward');
    s.input.tap('dash');
    expect(s.runUntil((x) => x.state === 'mantle', 1)).not.toBeNull();
    expect(s.eventsNamed('player:mantle')[0]!.payload.fromState).toBe('dash');
    s.runUntil((x) => x.state !== 'mantle', 1);
    expect(s.player.position.y).toBeCloseTo(1.6, 1);
    expect(s.speed).toBeLessThan(cfg.dashExitMinSpeed * cfg.mantleExitSpeedKeep + 1);
  });

  it('重生（傳送）時補滿燃料、Dash 充能並清除抓鉤冷卻', () => {
    const s = sim({ primitives: [FLOOR] });
    s.settle();
    s.input.tap('dash');
    s.runUntil((x) => x.state !== 'dash', 1);
    s.player.abilities.jet.fuel = 0;
    s.player.abilities.grappleCooldown.start(4);
    s.player.teleport({ x: 0, y: 0, z: 0 });
    const a = s.player.abilities;
    expect(a.dash.charges).toBe(2);
    expect(a.jet.full).toBe(true);
    expect(a.grappleCooldown.ready).toBe(true);
    expect(s.player.velocity.length()).toBe(0);
  });

  it('連招「滑鏟 → 跳 → 跑牆 → 蹬牆跳 → 二段跳 → Dash → 抓鉤」動量連貫（速度不會硬性歸零）', () => {
    const s = sim({
      primitives: [
        FLOOR,
        boxMinMax('wall-r', [2, 0, -60], [3, 10, 10], 'wallrun'),
        boxMinMax('target', [-12, 18, -56], [-8, 22, -55], 'grapple'),
      ],
      spawn: { pos: [-4, 0, 8], yaw: -25 * D },
    });
    s.settle();
    const speeds: { t: number; v: number; state: string }[] = [];
    const record = (): void => {
      speeds.push({ t: s.time, v: s.speed, state: s.state });
    };
    const run = (sec: number): void => {
      for (let i = 0; i < Math.round(sec * s.hz); i++) {
        s.step();
        record();
      }
    };
    const until = (pred: (x: MovementSim) => boolean, max = 3): void => {
      for (let i = 0; i < max * s.hz; i++) {
        s.step();
        record();
        if (pred(s)) return;
      }
      throw new Error(`連招卡住：狀態 ${s.state}`);
    };
    // 1. 衝刺 → 滑鏟 → 滑鏟中起跳。
    s.input.down('moveForward');
    run(0.6);
    s.input.down('crouch');
    until((x) => x.state === 'slide');
    run(0.15);
    s.input.up('crouch');
    s.input.tap('jump');
    until((x) => x.state === 'air');
    // 2. 跑牆（右牆）。
    until((x) => x.state === 'wallRun');
    run(0.4);
    // 3. 看向左前方蹬牆跳。
    s.input.setYaw(35 * D);
    s.input.tap('jump');
    until((x) => x.eventsNamed('player:wallJump').length > 0);
    run(0.3);
    // 4. 二段跳。
    s.input.tap('jump');
    until((x) => x.eventsNamed('player:doubleJump').length > 0);
    run(0.1);
    // 5. Dash（往前）。
    s.input.tap('dash');
    until((x) => x.state === 'dash');
    until((x) => x.state !== 'dash');
    run(0.05);
    // 6. 抓鉤。
    aimAt(s, -10, 20, -55);
    s.input.down('grapple');
    until((x) => x.state === 'grapple');
    run(0.4);
    const order = s.eventsNamed('player:state').map((e) => e.payload.to as string);
    const want = ['slide', 'air', 'wallRun', 'air', 'dash', 'air', 'grapple'];
    let k = 0;
    for (const st of order) if (st === want[k]) k++;
    expect(k, order.join('→')).toBe(want.length);
    expect(s.eventsNamed('player:land').filter((e) => e.time > 0.1)).toHaveLength(0);
    // 動量連貫：整段水平速度沒有一步掉超過 25%，且在進入跑牆之後一直 ≥ 8 m/s。
    // Dash 期間的速度是位移速度（7 m / 0.15 s ≈ 47 m/s），結束後的速度改和 Dash 之前比較（計畫：max(原速度, 12)）。
    const firstWall = speeds.findIndex((p) => p.state === 'wallRun');
    let beforeDash = 0;
    for (let i = 1; i < speeds.length; i++) {
      const prev = speeds[i - 1]!;
      const cur = speeds[i]!;
      if (cur.state === 'dash' && prev.state !== 'dash') beforeDash = prev.v;
      const ref = prev.state === 'dash' ? beforeDash : prev.v;
      if (cur.state !== 'dash') expect(cur.v, `${cur.t.toFixed(3)} s ${prev.state}→${cur.state}`).toBeGreaterThan(ref * 0.75);
      if (i > firstWall) expect(cur.v, `${cur.t.toFixed(3)} s ${cur.state}`).toBeGreaterThan(8);
    }
    // 速度曲線摘要（實作紀錄用）：每個狀態區段的進入／離開速度。
    const segments: string[] = [];
    for (let i = 0; i < speeds.length; i++) {
      if (i === 0 || speeds[i]!.state !== speeds[i - 1]!.state) segments.push(`${speeds[i]!.state}@${speeds[i]!.t.toFixed(2)}s:${speeds[i]!.v.toFixed(1)}`);
    }
    expect(segments.length).toBeGreaterThanOrEqual(want.length);
    if (process.env.SHARDWAKE_PRINT_COMBO) console.log(segments.join(' → '), `end ${s.speed.toFixed(1)} m/s`);
  });
});

describe('抓鉤繩索視覺', () => {
  it('ropeShape：發射時正弦波逐漸拉直；附著後衰減抖動；idle 不顯示', () => {
    const shape = { amplitude: 0, waves: 0, phase: 0 };
    const c = GRAPPLE_ROPE_CONFIG;
    expect(ropeShape('flying', 0, c, shape).amplitude).toBeCloseTo(c.waveAmplitude, 9);
    expect(shape.waves).toBe(c.waveCount);
    const mid = ropeShape('flying', c.straightenTime / 2, c, shape).amplitude;
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(c.waveAmplitude);
    expect(ropeShape('flying', c.straightenTime, c, shape).amplitude).toBe(0);
    let early = 0;
    for (let t = 0; t < 0.2; t += 0.005) early = Math.max(early, Math.abs(ropeShape('attached', t, c, shape).amplitude));
    let late = 0;
    for (let t = 1; t < 1.2; t += 0.005) late = Math.max(late, Math.abs(ropeShape('attached', t, c, shape).amplitude));
    expect(early).toBeGreaterThan(0.05);
    expect(late).toBeLessThan(early * 0.01);
    expect(shape.waves).toBe(0);
    expect(ropeShape('idle', 0, c, shape).amplitude).toBe(0);
  });

  it('ropePoints：兩端點固定在手與鉤爪，振幅 0 時是直線', () => {
    const out = new Float32Array(11 * 3);
    const a = new THREE.Vector3(0, 1, 0);
    const b = new THREE.Vector3(0, 1, -10);
    ropePoints(out, 10, a, b, { amplitude: 0.5, waves: 2, phase: 0.3 });
    expect([out[0], out[1], out[2]]).toEqual([0, 1, 0]);
    expect(out[30]).toBeCloseTo(0, 6);
    expect(out[32]).toBeCloseTo(-10, 6);
    let maxOff = 0;
    for (let i = 0; i <= 10; i++) maxOff = Math.max(maxOff, Math.abs(out[i * 3]!));
    expect(maxOff).toBeGreaterThan(0.1);
    ropePoints(out, 10, a, b, { amplitude: 0, waves: 2, phase: 0 });
    for (let i = 0; i <= 10; i++) {
      expect(out[i * 3]).toBeCloseTo(0, 9);
      expect(out[i * 3 + 2]).toBeCloseTo(-i, 6);
    }
  });

  it('GrappleRope：發射到收回期間顯示，附著時終點在錨點', () => {
    const s = sim({ primitives: [FLOOR, boxMinMax('wall', [-15, 0, -31], [15, 12, -30], 'grapple')] });
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    const rope = new GrappleRope({ scene, player: s.player, camera });
    expect(scene.children).toContain(rope.line);
    s.settle();
    rope.render(0);
    expect(rope.visible).toBe(false);
    s.input.down('grapple');
    s.step();
    s.player.eyePosition(1, camera.position);
    rope.render(1);
    expect(rope.visible).toBe(true);
    s.runUntil((x) => x.state === 'grapple', 1);
    s.player.eyePosition(1, camera.position);
    rope.render(1);
    const end = rope.point(rope.config.segments, new THREE.Vector3());
    expect(end.distanceTo(s.player.abilities.hook.anchor)).toBeLessThan(1e-4);
    const start = rope.point(0, new THREE.Vector3());
    expect(start.distanceTo(camera.position)).toBeLessThan(0.6);
    s.input.up('grapple');
    s.step();
    expect(s.player.abilities.hook.phase).toBe('retracting');
    rope.render(1);
    expect(rope.visible).toBe(true);
    s.runUntil((x) => x.player.abilities.hook.phase === 'idle', 1);
    rope.render(1);
    expect(rope.visible).toBe(false);
    rope.dispose();
    expect(scene.children).not.toContain(rope.line);
  });
});
