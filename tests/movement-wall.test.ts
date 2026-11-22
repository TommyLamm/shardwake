// M1-06 移動驗收：跑牆、蹬牆跳、攀爬（Rapier 無頭世界＋腳本輸入）。
import * as THREE from 'three';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Physics } from '@/physics/Physics';
import { MOVEMENT_CONFIG } from '@/player/MovementConfig';
import { MovementDebug } from '@/player/MovementDebug';
import type { AirResetReason } from '@/player/PlayerController';
import { wallRunGravityAt } from '@/player/wallStates';
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
const FLOOR = floorBox('floor', -60, 60, -120, 30);
/** 右側（+X）可跑牆的長牆：牆面 x = 2、法線 (−1, 0, 0)、高 10 m、z[-100, 10]。 */
const RIGHT_WALL = boxMinMax('wall-r', [2, 0, -100], [3, 10, 10], 'wallrun');

/** 傳送到空中並給定速度（只用來快速建立「已經在空中、貼近牆面」的情境）。 */
function launch(s: MovementSim, pos: [number, number, number], vel: [number, number, number], yaw = 0): void {
  s.player.teleport({ x: pos[0], y: pos[1], z: pos[2] }, yaw);
  s.player.velocity.set(vel[0], vel[1], vel[2]);
}

/** 跑牆重力曲線下的高度（解析解）：g(t) = G (t/T)^2（t ≤ T），之後固定為 G。 */
function wallRunHeight(y0: number, vy0: number, t: number): number {
  const G = cfg.wallRunGravity;
  const T = cfg.wallRunGravityRampTime;
  expect(cfg.wallRunGravityCurve).toBe(2);
  if (t <= T) return y0 + vy0 * t - (G * t ** 4) / (12 * T * T);
  const yT = y0 + vy0 * T - (G * T * T) / 12;
  const vT = vy0 - (G * T) / 3;
  const u = t - T;
  return yT + vT * u - 0.5 * G * u * u;
}

describe('跑牆', () => {
  it('以 8 m/s 斜向跳向側牆會進入跑牆，最多持續 1.8 s，期間高度變化符合重力曲線', () => {
    const s = sim({ primitives: [FLOOR, RIGHT_WALL], config: { sprintSpeed: 8 }, spawn: { pos: [-2, 0, 5], yaw: -30 * D } });
    s.settle();
    s.input.down('moveForward');
    // 斜向（偏右 30°）衝刺到 8 m/s，離牆面約 1 m 時起跳。
    s.runUntil((x) => x.player.position.x >= 2 - cfg.radius - 0.95, 3);
    expect(s.speed).toBeCloseTo(8, 2);
    s.input.tap('jump');
    expect(s.runUntil((x) => x.state === 'wallRun', 1)).not.toBeNull();
    const p = s.player;
    const start = s.eventsNamed('player:wallRunStart');
    expect(start).toHaveLength(1);
    expect(start[0]!.payload).toMatchObject({ side: 'right', normal: { x: -1, y: 0, z: 0 } });
    // 進入：沿牆速度至少 10.5 m/s、上升最多保留 3 m/s、離地 ≥ 0.6 m。
    expect(p.preMoveVelocity.length()).toBeGreaterThan(7.9);
    expect(s.speed).toBeCloseTo(cfg.wallRunEntrySpeed, 3);
    expect(Math.abs(p.velocity.x)).toBeLessThan(1e-6);
    expect(p.velocity.y).toBeCloseTo(cfg.wallRunMaxRiseSpeed, 6);
    expect(p.position.y).toBeGreaterThanOrEqual(cfg.wallRunMinHeight);
    const y0 = p.position.y;
    const vy0 = p.velocity.y;
    const t0 = s.time;
    let maxErr = 0;
    let maxGap = 0;
    while (s.state === 'wallRun' && s.time - t0 < 3) {
      s.step();
      if (s.state !== 'wallRun') break;
      maxErr = Math.max(maxErr, Math.abs(p.position.y - wallRunHeight(y0, vy0, s.time - t0)));
      expect(s.speed).toBeGreaterThan(cfg.wallRunEntrySpeed - 0.05);
      if (s.time - t0 > 0.3) maxGap = Math.max(maxGap, 2 - (p.position.x + cfg.radius));
    }
    const duration = s.time - t0;
    expect(duration).toBeGreaterThan(cfg.wallRunMaxTime - 2 * s.dt);
    expect(duration).toBeLessThanOrEqual(cfg.wallRunMaxTime + s.dt);
    expect(maxErr).toBeLessThan(0.01);
    // 貼附力讓膠囊在 0.3 s 內貼上牆面（之後間隙 ≤ 3 cm）。
    expect(maxGap).toBeLessThan(0.03);
    expect(s.state).toBe('air');
    expect(s.eventsNamed('player:wallRunEnd').at(-1)!.payload).toMatchObject({ reason: 'timeout' });
  });

  it('重力曲線：0 → 8 m/s²（1.2 s 內），之後固定', () => {
    expect(wallRunGravityAt(0, 8, 1.2, 2)).toBe(0);
    expect(wallRunGravityAt(0.6, 8, 1.2, 2)).toBeCloseTo(2, 9);
    expect(wallRunGravityAt(1.2, 8, 1.2, 2)).toBeCloseTo(8, 9);
    expect(wallRunGravityAt(5, 8, 1.2, 2)).toBe(8);
    expect(wallRunGravityAt(0.6, 8, 1.2, 1)).toBeCloseTo(4, 9);
  });

  it('蹬牆跳：速度 = 沿牆 × 0.9 ＋ 法線 × 7 ＋ 上方 × 7.5，離牆方向正確', () => {
    const s = sim({ primitives: [FLOOR, RIGHT_WALL] });
    launch(s, [1.6, 3, 0], [0, 0, -11]);
    s.input.down('moveForward');
    s.step();
    expect(s.state).toBe('wallRun');
    s.run(0.3);
    const along = -s.player.velocity.z;
    s.input.tap('jump');
    s.step();
    const v = s.player.velocity;
    const n = { x: -1, z: 0 };
    expect(s.state).toBe('air');
    expect(v.x * n.x + v.z * n.z).toBeCloseTo(cfg.wallJumpNormalSpeed, 4);
    expect(v.x * n.x + v.z * n.z).toBeGreaterThan(0);
    expect(-v.z).toBeCloseTo(along * cfg.wallJumpAlongScale, 4);
    // 起跳步已套重力。
    expect(v.y).toBeCloseTo(cfg.wallJumpUpSpeed - cfg.gravity * s.dt, 6);
    const jump = s.eventsNamed('player:wallJump');
    expect(jump).toHaveLength(1);
    expect(jump[0]!.payload).toMatchObject({ normal: { x: -1, y: 0, z: 0 }, grace: false });
    expect(s.eventsNamed('player:wallRunEnd').at(-1)!.payload).toMatchObject({ reason: 'jump' });
    // 之後離開牆面。
    const x0 = s.player.position.x;
    s.run(0.2);
    expect(s.player.position.x).toBeLessThan(x0 - 1);
  });

  it('蹬牆跳：視線離開牆面時往視線方向偏轉（水平速率不變、離牆分量變大）', () => {
    const speeds: number[] = [];
    const normals: number[] = [];
    for (const yawDeg of [0, 60]) {
      const s = sim({ primitives: [FLOOR, RIGHT_WALL] });
      launch(s, [1.6, 3, 0], [0, 0, -11], yawDeg * D);
      s.input.down('moveForward');
      s.run(0.3);
      expect(s.state).toBe('wallRun');
      s.input.tap('jump');
      s.step();
      const v = s.player.velocity;
      speeds.push(Math.hypot(v.x, v.z));
      normals.push(-v.x);
    }
    // yaw 60°（往左、背向右牆）：視線與牆面法線的內積 sin60°，偏轉權重 0.5 × 0.87。
    expect(speeds[1]).toBeCloseTo(speeds[0]!, 2);
    expect(normals[0]).toBeCloseTo(cfg.wallJumpNormalSpeed, 4);
    expect(normals[1]!).toBeGreaterThan(cfg.wallJumpNormalSpeed + 1.2);
  });

  it('同一面牆 0.4 s 內不能重貼；超過 0.4 s 可以；著地後重置', () => {
    const s = sim({ primitives: [FLOOR, RIGHT_WALL] });
    launch(s, [1.6, 6, 0], [0, 2, -11]);
    s.input.down('moveForward');
    s.step();
    expect(s.state).toBe('wallRun');
    s.run(0.2);
    // 放開前進 → 離開跑牆（仍貼著牆往前飛）。
    s.input.up('moveForward');
    s.step();
    expect(s.state).toBe('air');
    expect(s.eventsNamed('player:wallRunEnd').at(-1)!.payload).toMatchObject({ reason: 'released' });
    const left = s.time;
    s.input.down('moveForward');
    const t = s.runUntil((x) => x.state === 'wallRun', 1);
    expect(t).not.toBeNull();
    const elapsed = s.time - left;
    expect(elapsed).toBeGreaterThanOrEqual(cfg.wallRunSameWallCooldown - 1e-6);
    expect(elapsed).toBeLessThan(cfg.wallRunSameWallCooldown + 3 * s.dt);
    expect(s.eventsNamed('player:wallRunStart')).toHaveLength(2);

    // 著地後重置：低處離開牆面、0.4 s 內落地，記憶就清除。
    const g = sim({ primitives: [FLOOR, RIGHT_WALL] });
    launch(g, [1.6, 0.9, 0], [0, 0, -11]);
    g.input.down('moveForward');
    g.step();
    expect(g.state).toBe('wallRun');
    const handle = g.player.wallHandle;
    const normal = g.player.wallNormal.clone();
    g.input.down('crouch');
    g.step();
    expect(g.state).toBe('air');
    expect(g.player.isRecentWall(handle, normal)).toBe(true);
    g.input.up('crouch');
    expect(g.runUntil((x) => x.player.grounded, 0.4)).not.toBeNull();
    expect(g.player.isRecentWall(handle, normal)).toBe(false);
  });

  it('離牆後 0.15 s 內按跳仍可蹬牆跳（寬限）；按蹲離牆沒有寬限', () => {
    const s = sim({ primitives: [FLOOR, RIGHT_WALL] });
    launch(s, [1.6, 5, 0], [0, 0, -11]);
    s.input.down('moveForward');
    s.run(0.2);
    s.input.up('moveForward');
    s.step(6);
    expect(s.state).toBe('air');
    s.input.tap('jump');
    s.step();
    const jump = s.eventsNamed('player:wallJump');
    expect(jump).toHaveLength(1);
    expect(jump[0]!.payload).toMatchObject({ grace: true });
    expect(-s.player.velocity.x).toBeCloseTo(cfg.wallJumpNormalSpeed, 4);

    const c = sim({ primitives: [FLOOR, RIGHT_WALL] });
    launch(c, [1.6, 5, 0], [0, 0, -11]);
    c.input.down('moveForward');
    c.run(0.2);
    c.input.down('crouch');
    c.step(2);
    c.input.tap('jump');
    c.step();
    expect(c.eventsNamed('player:wallJump')).toHaveLength(0);
  });

  it('進入條件：太慢、沒按前進、按住蹲、不可跑牆的表面、離地太低、角度太大都不會跑牆', () => {
    const cases: { name: string; prims?: LevelPrimitive[]; pos?: [number, number, number]; vel?: [number, number, number]; hold?: boolean; crouch?: boolean }[] = [
      { name: '太慢', vel: [0, 0, -5] },
      { name: '沒按前進', hold: false },
      { name: '按住蹲', crouch: true },
      { name: '不可跑牆', prims: [FLOOR, boxMinMax('wall-c', [2, 0, -100], [3, 10, 10], 'cover')] },
      { name: '離地太低', pos: [1.6, 0.3, 0] },
      // 速度方向與牆面切線夾角 60°（直直撞向牆）。
      { name: '角度太大', pos: [1.0, 3, 0], vel: [9.5, 0, -5.5] },
    ];
    for (const c of cases) {
      const s = sim({ primitives: c.prims ?? [FLOOR, RIGHT_WALL] });
      launch(s, c.pos ?? [1.6, 3, 0], c.vel ?? [0, 0, -11]);
      if (c.hold !== false) s.input.down('moveForward');
      if (c.crouch) s.input.down('crouch');
      s.run(0.3);
      expect(s.eventsNamed('player:wallRunStart'), c.name).toHaveLength(0);
    }
    // 對照組：條件都符合時會跑牆。
    const ok = sim({ primitives: [FLOOR, RIGHT_WALL] });
    launch(ok, [1.6, 3, 0], [0, 0, -11]);
    ok.input.down('moveForward');
    ok.run(0.3);
    expect(ok.eventsNamed('player:wallRunStart')).toHaveLength(1);
  });

  it('結束條件：牆面結束 → 空中（不會繞過牆端）；按蹲 → 空中；太慢 → 空中；著地 → 地面', () => {
    // 短牆 z[-6, 2]：跑到盡頭就結束，法線不會轉到牆端或背面。
    const s = sim({ primitives: [FLOOR, boxMinMax('short', [2, 0, -6], [3, 10, 2], 'wallrun')] });
    launch(s, [1.6, 4, 1], [0, 0, -11]);
    s.input.down('moveForward');
    s.step();
    expect(s.state).toBe('wallRun');
    while (s.state === 'wallRun') {
      expect(s.player.wallNormal.x).toBeCloseTo(-1, 3);
      s.step();
    }
    expect(s.eventsNamed('player:wallRunEnd').at(-1)!.payload).toMatchObject({ reason: 'wallEnded' });
    expect(s.player.position.z).toBeLessThan(-6 + cfg.radius);

    const c = sim({ primitives: [FLOOR, RIGHT_WALL] });
    launch(c, [1.6, 4, 0], [0, 0, -11]);
    c.input.down('moveForward');
    c.run(0.2);
    c.input.down('crouch');
    c.step();
    expect(c.state).toBe('air');
    expect(c.eventsNamed('player:wallRunEnd').at(-1)!.payload).toMatchObject({ reason: 'crouch' });

    // 撞上沿牆的障礙物而減速。
    const slow = sim({ primitives: [FLOOR, RIGHT_WALL, boxMinMax('block', [0, 0, -6], [2, 10, -5])] });
    launch(slow, [1.6, 4, 0], [0, 0, -11]);
    slow.input.down('moveForward');
    slow.run(1);
    expect(slow.eventsNamed('player:wallRunEnd')[0]!.payload).toMatchObject({ reason: 'slow' });

    const land = sim({ primitives: [FLOOR, RIGHT_WALL], config: { wallRunGravity: 30, wallRunGravityRampTime: 0.1 } });
    launch(land, [1.6, 1.0, 0], [0, 0, -11]);
    land.input.down('moveForward');
    land.step();
    expect(land.state).toBe('wallRun');
    expect(land.runUntil((x) => x.state !== 'wallRun', 1.5)).not.toBeNull();
    expect(land.state).toBe('ground');
    expect(land.eventsNamed('player:wallRunEnd').at(-1)!.payload).toMatchObject({ reason: 'landed' });
  });

  it('跑牆不會硬性歸零速度：進入時把投影前的速度轉到切線（超過 10.5 的部分保留）', () => {
    const s = sim({ primitives: [FLOOR, RIGHT_WALL] });
    // 以 14 m/s、偏向牆面 30° 飛向牆。
    launch(s, [0.8, 3, 0], [14 * Math.sin(30 * D), 0, -14 * Math.cos(30 * D)]);
    s.input.down('moveForward');
    expect(s.runUntil((x) => x.state === 'wallRun', 0.5)).not.toBeNull();
    // 牆面法線 (−1, 0, 0)：切線速度 = 投影前速度的 z 分量（空中控制在接近途中會稍微轉向）。
    expect(s.speed).toBeGreaterThan(12);
    expect(s.speed).toBeCloseTo(Math.abs(s.player.preMoveVelocity.z), 4);
  });

  it('6 m 長廊：左右牆連續跑牆＋蹬牆跳（看向對面的牆起跳）', () => {
    const s = sim({
      primitives: [
        FLOOR,
        boxMinMax('wl', [-4, 0, -100], [-3, 8, 10], 'wallrun'),
        boxMinMax('wr', [3, 0, -100], [4, 8, 10], 'wallrun'),
      ],
      spawn: { pos: [0, 0, 5], yaw: 0 },
    });
    s.settle();
    s.input.down('moveForward');
    s.input.setYaw(20 * D);
    s.runUntil((x) => x.player.position.x <= -3 + cfg.radius + 0.9, 3);
    s.input.tap('jump');
    const sides: string[] = [];
    for (let i = 0; i < 10; i++) {
      const t = s.runUntil((x) => x.state === 'wallRun' || x.player.grounded, 3);
      if (t === null || s.state !== 'wallRun') break;
      sides.push(s.player.state.wallRunSide!);
      s.run(i === 0 ? 0.6 : 0.35);
      if (s.state !== 'wallRun') break;
      s.input.setYaw(s.player.wallNormal.x > 0 ? -40 * D : 40 * D);
      s.input.tap('jump');
      s.step(2);
    }
    expect(sides.length).toBeGreaterThanOrEqual(4);
    for (let i = 1; i < sides.length; i++) expect(sides[i]).not.toBe(sides[i - 1]);
    expect(s.eventsNamed('player:wallJump').length).toBeGreaterThanOrEqual(3);
    expect(s.eventsNamed('player:land').filter((e) => e.time > 0.1 && e.step < s.eventsNamed('player:wallRunStart').at(-1)!.step)).toHaveLength(0);
    expect(s.player.position.z).toBeLessThan(-35);
  });
});

describe('攀爬', () => {
  /** 正前方（-Z）0.4 m 處的箱子（寬 6 m、深 2 m）。 */
  const boxAhead = (h: number, material = 'climb'): LevelPrimitive => boxMinMax(`box-${h}`, [-3, 0, -2.4 - 2], [3, h, -0.4 - cfg.radius], material);

  it('1.2 m 箱：在地面按跳直接攀上（不起跳），0.28 s 內完成、期間不受重力', () => {
    const s = sim({ primitives: [FLOOR, boxAhead(1.2)] });
    s.settle();
    s.clearEvents();
    s.input.tap('jump');
    s.step();
    expect(s.state).toBe('mantle');
    expect(s.eventsNamed('player:jump')).toHaveLength(0);
    const ev = s.eventsNamed('player:mantle');
    expect(ev).toHaveLength(1);
    expect(ev[0]!.payload).toMatchObject({ fromState: 'ground', duration: cfg.mantleDuration });
    expect(ev[0]!.payload.height as number).toBeCloseTo(1.2, 1);
    // 先上後前：前 60% 只往上，之後才往前；高度單調不減。
    const z0 = s.player.position.z;
    let prevY = s.player.position.y;
    const t0 = s.time - s.dt;
    while (s.state === 'mantle') {
      const u = (s.time - t0) / cfg.mantleDuration;
      if (u < cfg.mantleUpFraction - 0.05) expect(Math.abs(s.player.position.z - z0)).toBeLessThan(1e-3);
      expect(s.player.position.y).toBeGreaterThanOrEqual(prevY - 1e-6);
      prevY = s.player.position.y;
      s.step();
    }
    expect(s.time - t0).toBeCloseTo(cfg.mantleDuration, 1);
    expect(s.state).toBe('ground');
    expect(s.player.position.y).toBeCloseTo(1.2, 1);
    expect(s.player.position.z).toBeLessThan(-0.4 - cfg.radius - cfg.radius);
    // 結束：靜止進入 → 向前 4 m/s；不發落地事件。
    expect(s.speed).toBeGreaterThan(cfg.mantleExitMinSpeed - 0.5);
    expect(s.player.velocity.z).toBeLessThan(0);
    expect(s.eventsNamed('player:land')).toHaveLength(0);
  });

  it('衝刺接近時攀爬保留進入前 60% 的水平速度', () => {
    const s = sim({ primitives: [FLOOR, boxMinMax('box', [-3, 0, -12], [3, 1.2, -10])], spawn: { pos: [0, 0, 0], yaw: 0 } });
    s.settle();
    s.input.down('moveForward');
    s.runUntil((x) => x.player.position.z <= -10 + cfg.radius + 0.5, 3);
    expect(s.speed).toBeCloseTo(cfg.sprintSpeed, 2);
    s.input.tap('jump');
    s.step();
    expect(s.state).toBe('mantle');
    s.runUntil((x) => x.state !== 'mantle', 1);
    // 結束當下（地面狀態第一步之前）的速度。
    const exit = s.events.find((e) => e.name === 'player:state' && e.payload.from === 'mantle')!;
    expect(exit).toBeDefined();
    expect(s.player.position.y).toBeCloseTo(1.2, 1);
    // 下一步地面加速會再補速度，所以這裡只檢查不低於 60%。
    expect(s.speed).toBeGreaterThanOrEqual(cfg.sprintSpeed * cfg.mantleExitSpeedKeep - 0.05);
  });

  it('3.0 m 牆：起跳後在空中攀上；4.0 m 牆：單跳攀不上', () => {
    const three = sim({ primitives: [FLOOR, boxAhead(3.0)] });
    three.settle();
    three.input.tap('jump');
    three.input.down('moveForward');
    expect(three.runUntil((x) => x.state === 'mantle', 1)).not.toBeNull();
    expect(three.eventsNamed('player:mantle')[0]!.payload).toMatchObject({ fromState: 'air' });
    expect(three.eventsNamed('player:jump')).toHaveLength(1);
    three.runUntil((x) => x.state !== 'mantle', 1);
    expect(three.player.position.y).toBeCloseTo(3.0, 1);
    expect(three.player.grounded).toBe(true);

    const four = sim({ primitives: [FLOOR, boxAhead(4.0)] });
    four.settle();
    four.input.tap('jump');
    four.input.down('moveForward');
    four.run(1.5);
    expect(four.eventsNamed('player:mantle')).toHaveLength(0);
    expect(four.player.position.y).toBeLessThan(0.1);
    expect(four.state).toBe('ground');
    // 助跑起跳也一樣。
    const run4 = sim({ primitives: [FLOOR, boxMinMax('wall4', [-3, 0, -14], [3, 4, -12])], spawn: { pos: [0, 0, 0], yaw: 0 } });
    run4.settle();
    run4.input.down('moveForward');
    run4.runUntil((x) => x.player.position.z <= -12 + 3, 3);
    run4.input.tap('jump');
    run4.run(1.5);
    expect(run4.eventsNamed('player:mantle')).toHaveLength(0);
    // 助跑起跳的 3.0 m 牆可以。
    const run3 = sim({ primitives: [FLOOR, boxMinMax('wall3', [-3, 0, -14], [3, 3, -12])], spawn: { pos: [0, 0, 0], yaw: 0 } });
    run3.settle();
    run3.input.down('moveForward');
    run3.runUntil((x) => x.player.position.z <= -12 + 3, 3);
    run3.input.tap('jump');
    expect(run3.runUntil((x) => x.state === 'mantle', 1.5)).not.toBeNull();
    run3.runUntil((x) => x.state !== 'mantle', 1);
    expect(run3.eventsNamed('player:mantle')).toHaveLength(1);
    expect(run3.player.position.y).toBeCloseTo(3.0, 1);
  });

  it('不攀爬：邊緣低於 0.5 m（正常起跳）、頂面放不下膠囊、沒按前進、背對牆', () => {
    const low = sim({ primitives: [FLOOR, boxAhead(0.4)] });
    low.settle();
    low.input.tap('jump');
    low.step();
    expect(low.state).toBe('air');
    expect(low.eventsNamed('player:jump')).toHaveLength(1);

    // 1.2 m 箱上方 1.0 m 有天花板：站姿膠囊（1.8 m）放不下。
    const roof = sim({ primitives: [FLOOR, boxAhead(1.2), boxMinMax('roof', [-3, 2.2, -5], [3, 2.6, -0.4 - cfg.radius])] });
    roof.settle();
    roof.input.tap('jump');
    roof.step();
    expect(roof.eventsNamed('player:mantle')).toHaveLength(0);

    const noFwd = sim({ primitives: [FLOOR, boxAhead(3.0)] });
    noFwd.settle();
    noFwd.input.tap('jump');
    noFwd.run(1);
    expect(noFwd.eventsNamed('player:mantle')).toHaveLength(0);

    // 背對 1.2 m 箱按跳：正常起跳。
    const back = sim({ primitives: [FLOOR, boxAhead(1.2)], spawn: { pos: [0, 0, 0], yaw: Math.PI } });
    back.settle();
    back.input.tap('jump');
    back.step();
    expect(back.eventsNamed('player:mantle')).toHaveLength(0);
    expect(back.eventsNamed('player:jump')).toHaveLength(1);
  });

  it('優先序：正面牆有可攀邊緣 → 攀爬；側面牆 → 跑牆（同一面可跑的 2.5 m 牆）', () => {
    const wall = boxMinMax('w', [2, 0, -100], [3, 2.5, 10], 'wallrun');
    // 正面：面向牆（yaw -90° 面向 +X），空中按住前進。
    const front = sim({ primitives: [FLOOR, wall], spawn: { pos: [1.2, 0, 0], yaw: -90 * D } });
    front.settle();
    front.input.tap('jump');
    front.input.down('moveForward');
    expect(front.runUntil((x) => x.state === 'mantle', 0.8)).not.toBeNull();
    front.runUntil((x) => x.state !== 'mantle', 1);
    expect(front.eventsNamed('player:mantle')).toHaveLength(1);
    expect(front.eventsNamed('player:wallRunStart')).toHaveLength(0);
    expect(front.player.position.y).toBeCloseTo(2.5, 1);

    // 側面：沿牆飛行（視線沿牆）→ 跑牆。
    const side = sim({ primitives: [FLOOR, wall] });
    launch(side, [1.6, 1.0, 0], [0, 1, -11]);
    side.input.down('moveForward');
    side.step();
    expect(side.state).toBe('wallRun');
    expect(side.eventsNamed('player:mantle')).toHaveLength(0);
  });

  it('跑牆中正前方出現可攀的邊緣 → 攀爬', () => {
    const s = sim({ primitives: [FLOOR, RIGHT_WALL, boxMinMax('ledge', [-3, 0, -12], [2, 3.5, -10])] });
    launch(s, [1.6, 2.2, 0], [0, 0, -11]);
    s.input.down('moveForward');
    s.step();
    expect(s.state).toBe('wallRun');
    expect(s.runUntil((x) => x.state === 'mantle', 1.5)).not.toBeNull();
    expect(s.eventsNamed('player:wallRunEnd').at(-1)!.payload).toMatchObject({ reason: 'mantle' });
    s.runUntil((x) => x.state !== 'mantle', 1);
    expect(s.player.position.y).toBeCloseTo(3.5, 1);
  });
});

describe('空中能力重置', () => {
  it('著地、開始跑牆、重生時通知監聽者並發出 player:airReset；可取消監聽', () => {
    const s = sim({ primitives: [FLOOR, RIGHT_WALL] });
    const reasons: AirResetReason[] = [];
    const off = s.player.onAirReset((r) => reasons.push(r));
    s.settle();
    expect(reasons).toEqual(['land']);
    launch(s, [1.6, 3, 0], [0, 0, -11]);
    expect(reasons).toEqual(['land', 'respawn']);
    s.input.down('moveForward');
    s.step();
    expect(reasons).toEqual(['land', 'respawn', 'wallRun']);
    s.player.resetAirAbilities('grapple');
    expect(reasons.at(-1)).toBe('grapple');
    expect(s.eventsNamed('player:airReset').map((e) => e.payload.reason)).toEqual(['respawn', 'land', 'respawn', 'wallRun', 'grapple']);
    off();
    s.player.resetAirAbilities('grapple');
    expect(reasons).toHaveLength(4);
  });

  it('PlayerState 帶跑牆側邊、牆面法線與攀爬進度', () => {
    const s = sim({ primitives: [FLOOR, RIGHT_WALL, boxAhead12()] });
    launch(s, [1.6, 3, 0], [0, 0, -11]);
    s.input.down('moveForward');
    s.step();
    expect(s.player.state.wallRunSide).toBe('right');
    expect(s.player.state.wallNormal.x).toBeCloseTo(-1, 6);
    s.input.up('moveForward');
    s.step();
    expect(s.player.state.wallRunSide).toBeNull();
    expect(s.player.state.wallNormal.length()).toBe(0);

    const m = sim({ primitives: [FLOOR, boxAhead12()] });
    m.settle();
    m.input.tap('jump');
    m.step(10);
    expect(m.state).toBe('mantle');
    expect(m.player.state.mantleProgress).toBeGreaterThan(0.2);
    expect(m.player.state.mantleProgress).toBeLessThan(0.6);
  });
});

function boxAhead12(): LevelPrimitive {
  return boxMinMax('box12', [-3, 0, -4.4 - 0.35], [1.0, 1.2, -0.4 - 0.35], 'climb');
}

describe('更新率無關', () => {
  it('跑牆高度曲線與攀爬結果在 60／120／240 Hz 一致', () => {
    const mantleY: number[] = [];
    for (const hz of [60, 120, 240]) {
      const s = sim({ primitives: [FLOOR, RIGHT_WALL], hz });
      launch(s, [1.6, 3, 0], [0, 2, -11]);
      s.input.down('moveForward');
      s.step();
      expect(s.state).toBe('wallRun');
      const y0 = s.player.position.y;
      const vy0 = s.player.velocity.y;
      const t0 = s.time;
      let maxErr = 0;
      while (s.time - t0 < 1.5 && s.state === 'wallRun') {
        s.step();
        maxErr = Math.max(maxErr, Math.abs(s.player.position.y - wallRunHeight(y0, vy0, s.time - t0)));
      }
      expect(s.time - t0, `${hz} Hz`).toBeGreaterThanOrEqual(1.5 - 1e-9);
      expect(maxErr, `${hz} Hz`).toBeLessThan(0.01);
      const m = sim({ primitives: [FLOOR, boxMinMax('b', [-3, 0, -4.75], [3, 1.2, -0.75])], hz });
      m.settle();
      m.input.tap('jump');
      m.run(0.5);
      mantleY.push(m.player.position.y);
    }
    for (const y of mantleY) expect(y).toBeCloseTo(mantleY[0]!, 2);
  });
});

describe('除錯顯示', () => {
  it('開啟「偵測射線」時記錄並繪製牆面／邊緣偵測，關閉時不記錄', () => {
    const s = sim({ primitives: [FLOOR, RIGHT_WALL] });
    const scene = new THREE.Scene();
    const debug = new MovementDebug({ scene, player: s.player, config: { showProbes: false } });
    launch(s, [1.6, 3, 0], [0, 0, -11]);
    s.step();
    expect(s.player.walls.log.count).toBe(0);
    expect(scene.getObjectByName('debug:movementProbes')).toBeUndefined();
    debug.dispose();
    const on = new MovementDebug({ scene, player: s.player, config: { showProbes: true } });
    s.input.down('moveForward');
    s.step();
    expect(s.state).toBe('wallRun');
    expect(s.player.walls.log.count).toBeGreaterThan(0);
    on.render();
    // 追蹤射線 + 牆面法線。
    expect(on.segmentCount).toBeGreaterThanOrEqual(2);
    expect(scene.getObjectByName('debug:movementProbes')).toBeDefined();
    on.dispose();
    expect(scene.getObjectByName('debug:movementProbes')).toBeUndefined();
    expect(s.player.walls.log.enabled).toBe(false);
  });
});
