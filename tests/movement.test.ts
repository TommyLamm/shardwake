// M1-05 移動驗收：Rapier 無頭世界＋腳本輸入。
import * as THREE from 'three';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Physics } from '@/physics/Physics';
import { MOVEMENT_CONFIG } from '@/player/MovementConfig';
import { jumpSpeedFor } from '@/player/movementMath';
import type { LevelPrimitive } from '@/world/LevelData';
import { MovementSim, boxMinMax, floorBox } from './helpers/movementSim';

beforeAll(async () => {
  await Physics.init();
});

const sims: MovementSim[] = [];
function sim(options: ConstructorParameters<typeof MovementSim>[0]): MovementSim {
  const s = new MovementSim(options);
  sims.push(s);
  return s;
}
afterEach(() => {
  for (const s of sims.splice(0)) s.dispose();
});

const FLAT: LevelPrimitive[] = [floorBox('floor', -100, 100, -100, 100)];
const cfg = MOVEMENT_CONFIG;
/** yaw：0 面向 -Z、正值向左；π 面向 +Z、π/2 面向 -X。 */
const FACE_PLUS_Z = Math.PI;

describe('地面移動', () => {
  it('起步 0.15 s 內達到跑速的 95% 以上（側移＝跑速、前進＝衝刺）', () => {
    const s = sim({ primitives: FLAT });
    s.settle();
    expect(s.state).toBe('ground');
    s.input.down('moveRight');
    const tRun = s.runUntil((x) => x.speed >= 0.95 * cfg.runSpeed, 1);
    expect(tRun).not.toBeNull();
    expect(tRun!).toBeLessThanOrEqual(0.15);
    s.run(0.5);
    expect(s.speed).toBeCloseTo(cfg.runSpeed, 3);

    const f = sim({ primitives: FLAT });
    f.settle();
    f.input.down('moveForward');
    const tSprint = f.runUntil((x) => x.speed >= 0.95 * cfg.sprintSpeed, 1);
    expect(tSprint!).toBeLessThanOrEqual(0.15);
    f.run(0.5);
    expect(f.speed).toBeCloseTo(cfg.sprintSpeed, 3);
  });

  it('放開後 0.35 s 內停止（跑速與衝刺都是）', () => {
    for (const action of ['moveRight', 'moveForward'] as const) {
      const s = sim({ primitives: FLAT });
      s.settle();
      s.input.down(action);
      s.run(0.6);
      s.input.up(action);
      const t = s.runUntil((x) => x.speed < 1e-3, 1);
      expect(t, action).not.toBeNull();
      expect(t!, action).toBeLessThanOrEqual(0.35);
    }
  });

  it('自動衝刺：±50° 內衝刺，開火或開鏡降回跑速；關閉自動衝刺時要按衝刺鍵', () => {
    const s = sim({ primitives: FLAT });
    s.settle();
    // 前方偏 45°（W + D）→ 衝刺。
    s.input.down('moveForward', 'moveRight');
    s.run(0.6);
    expect(s.speed).toBeCloseTo(cfg.sprintSpeed, 2);
    s.input.down('fire');
    s.run(0.6);
    expect(s.speed).toBeCloseTo(cfg.runSpeed, 2);
    s.input.up('fire').down('ads');
    s.run(0.6);
    expect(s.speed).toBeCloseTo(cfg.runSpeed, 2);

    const m = sim({ primitives: FLAT, settings: { autoSprint: false } });
    m.settle();
    m.input.down('moveForward');
    m.run(0.6);
    expect(m.speed).toBeCloseTo(cfg.runSpeed, 2);
    m.input.down('sprint');
    m.run(0.6);
    expect(m.speed).toBeCloseTo(cfg.sprintSpeed, 2);
  });

  it('蹲走 3.5 m/s，腳步事件依距離發出並帶表面材質', () => {
    const s = sim({ primitives: FLAT });
    s.settle();
    s.input.down('crouch');
    s.run(0.3);
    expect(s.player.state.crouched).toBe(true);
    expect(s.player.crouchAmount).toBe(1);
    expect(s.player.height).toBeCloseTo(cfg.crouchHeight, 6);
    expect(s.player.state.eyeHeight).toBeCloseTo(cfg.crouchEyeHeight, 6);
    s.clearEvents();
    s.input.down('moveForward');
    s.run(2);
    expect(s.speed).toBeCloseTo(cfg.crouchSpeed, 2);
    const steps = s.eventsNamed('player:footstep');
    const dist = Math.abs(s.player.position.z);
    expect(steps.length).toBeGreaterThanOrEqual(Math.floor(dist / cfg.footstepStride) - 1);
    expect(steps[0]!.payload.surface).toBe('concrete');
  });

  it('蹲下高度在 0.12 s 內平滑過渡', () => {
    const s = sim({ primitives: FLAT });
    s.settle();
    s.input.down('crouch');
    s.step(1);
    const h1 = s.player.height;
    expect(h1).toBeLessThan(cfg.standHeight);
    expect(h1).toBeGreaterThan(cfg.crouchHeight);
    const t = s.runUntil((x) => x.player.crouchAmount >= 1, 1);
    // 第一步已經走了一格：總步數 = ceil(0.12 × 120) = 15 步。
    expect(t! + s.dt).toBeGreaterThanOrEqual(cfg.crouchTransitionTime - 1e-9);
    expect(t! + s.dt).toBeLessThanOrEqual(cfg.crouchTransitionTime + s.dt);
    // 腳底保持在地面。
    expect(s.player.position.y).toBeCloseTo(0, 1);
    expect(s.eventsNamed('player:crouch').map((e) => e.payload.crouched)).toEqual([true]);
  });
});

describe('跳躍', () => {
  /** 原地起跳，回傳最高點（腳底相對起跳時的高度）。 */
  function jumpPeak(hz: number): { peak: number; airTime: number } {
    const s = sim({ primitives: FLAT, hz });
    s.settle();
    const y0 = s.player.position.y;
    s.input.tap('jump');
    s.step();
    expect(s.state).toBe('air');
    let peak = 0;
    const t = s.runUntil((x) => {
      peak = Math.max(peak, x.player.position.y - y0);
      return x.player.grounded;
    }, 3);
    return { peak, airTime: t! };
  }

  it('跳躍最高點約 1.3 m（±3%），60／120／240 Hz 一致', () => {
    const peaks = [60, 120, 240].map((hz) => jumpPeak(hz));
    for (const { peak } of peaks) {
      expect(peak).toBeGreaterThan(cfg.jumpHeight * 0.97);
      expect(peak).toBeLessThan(cfg.jumpHeight * 1.03);
    }
    const ideal = (2 * jumpSpeedFor(cfg.jumpHeight, cfg.gravity)) / cfg.gravity;
    for (const { airTime } of peaks) expect(airTime).toBeCloseTo(ideal, 1);
  });

  it('起跳初速由高度與重力反推；改重力不改跳躍高度', () => {
    const s = sim({ primitives: FLAT, config: { gravity: 40 } });
    s.settle();
    const y0 = s.player.position.y;
    s.input.tap('jump');
    let peak = 0;
    s.runUntil((x) => {
      peak = Math.max(peak, x.player.position.y - y0);
      return x.player.grounded && x.stepCount > 10;
    }, 3);
    expect(peak).toBeGreaterThan(cfg.jumpHeight * 0.97);
    expect(peak).toBeLessThan(cfg.jumpHeight * 1.03);
  });

  /** 高 5 m 的平台（x < 0），往 +X 走出邊緣；回傳離地那一步的模擬。 */
  function walkOffLedge(): MovementSim {
    const s = sim({
      primitives: [boxMinMax('ledge', [-20, -1, -10], [0, 5, 10], 'floor'), floorBox('ground', -50, 50, -50, 50)],
      spawn: { pos: [-3, 5, 0], yaw: Math.PI / 2 },
    });
    s.settle();
    s.input.down('moveRight');
    const t = s.runUntil((x) => x.state === 'air', 2);
    expect(t).not.toBeNull();
    s.input.up('moveRight');
    return s;
  }

  it('土狼時間：離開平台 0.1 s 內按跳可以起跳', () => {
    const s = walkOffLedge();
    s.run(0.1 - s.dt);
    s.input.tap('jump');
    s.step();
    const jumps = s.eventsNamed('player:jump');
    expect(jumps).toHaveLength(1);
    expect(jumps[0]!.payload.coyote).toBe(true);
    expect(s.player.velocity.y).toBeGreaterThan(0);
  });

  it('土狼時間：離開平台 0.2 s 後按跳不能起跳（落地時緩衝也已逾時）', () => {
    const s = walkOffLedge();
    s.run(0.2);
    s.input.tap('jump');
    s.step();
    expect(s.player.velocity.y).toBeLessThan(0);
    s.runUntil((x) => x.player.grounded, 3);
    s.run(0.3);
    expect(s.eventsNamed('player:jump')).toHaveLength(0);
  });

  /** 從 3 m 高處落下；pressBeforeLanding 秒前按跳。回傳落地與起跳的步數。 */
  function bufferedJump(pressBeforeLanding: number | null): { landStep: number; jumpStep: number | null } {
    const dry = sim({ primitives: FLAT, spawn: { pos: [0, 3, 0] } });
    dry.runUntil((x) => x.player.grounded, 3);
    const landStep = dry.stepCount;
    const s = sim({ primitives: FLAT, spawn: { pos: [0, 3, 0] } });
    if (pressBeforeLanding !== null) {
      const pressStep = landStep - Math.round(pressBeforeLanding * s.hz);
      s.step(pressStep - 1);
      s.input.tap('jump');
    }
    s.run(1.5);
    const land = s.eventsNamed('player:land')[0];
    expect(land?.step).toBe(landStep);
    const jump = s.eventsNamed('player:jump')[0];
    return { landStep, jumpStep: jump ? jump.step : null };
  }

  it('跳躍緩衝：落地前 0.12 s 按跳，落地瞬間起跳；0.2 s 前按跳則不會', () => {
    const buffered = bufferedJump(0.12);
    expect(buffered.jumpStep).not.toBeNull();
    // 落地那一步偵測著地，下一個地面步立刻起跳（地面上只停留一步，不套摩擦）。
    expect(buffered.jumpStep! - buffered.landStep).toBeLessThanOrEqual(1);
    expect(bufferedJump(0.2).jumpStep).toBeNull();
    expect(bufferedJump(null).jumpStep).toBeNull();
  });

  it('落地事件帶下落速度與表面；起跳事件標明來源狀態', () => {
    const s = sim({ primitives: FLAT, spawn: { pos: [0, 3, 0] } });
    s.runUntil((x) => x.player.grounded, 3);
    const land = s.eventsNamed('player:land').at(-1)!;
    // 從 3 m 落下：√(2 g h) ≈ 12 m/s（落地前一步的速度，允許一步的誤差）。
    expect(land.payload.impactSpeed as number).toBeCloseTo(Math.sqrt(2 * cfg.gravity * 3), 0);
    expect(land.payload.surface).toBe('concrete');
    s.run(0.1);
    s.input.tap('jump');
    s.step();
    expect(s.eventsNamed('player:jump')[0]!.payload).toEqual({ fromState: 'ground', coyote: false });
    expect(s.eventsNamed('player:state').map((e) => `${e.payload.from}→${e.payload.to}`)).toEqual(['air→ground', 'ground→air']);
  });

  it('連跳：落地後 1 步內不套摩擦，水平速度保留', () => {
    const s = sim({ primitives: FLAT });
    s.settle();
    s.input.down('moveForward');
    s.run(0.6);
    s.input.up('moveForward');
    s.input.tap('jump');
    s.step();
    const v0 = s.speed;
    expect(v0).toBeCloseTo(cfg.sprintSpeed, 1);
    // 空中無輸入：落地前再按跳（緩衝）。
    s.runUntil((x) => x.player.velocity.y < 0 && x.player.position.y < 0.3, 3);
    s.input.tap('jump');
    s.runUntil((x) => x.eventsNamed('player:jump').length >= 2, 1);
    expect(s.speed).toBeCloseTo(v0, 3);
  });

  it('斜坡起跳方向混合地面法線與正上方', () => {
    // 15° 坡，往 -Z 升高。
    const s = sim({
      primitives: [floorBox('floor', -40, 40, -40, 40), { id: 'ramp', type: 'ramp', material: 'slide', pos: [0, 0, 10], size: [10, 5.36, 20] }],
      spawn: { pos: [0, 2.7, 10] },
    });
    s.settle();
    expect(s.player.groundNormal.y).toBeLessThan(0.98);
    s.input.tap('jump');
    s.step();
    const v = s.player.velocity;
    // 法線朝 +Z 傾斜（坡往 -Z 升高），起跳速度帶一點 +Z 分量，垂直分量接近完整初速。
    expect(v.z).toBeGreaterThan(0.1);
    // 起跳步已套用一步重力。
    expect(v.y + cfg.gravity * s.dt).toBeGreaterThan(jumpSpeedFor(cfg.jumpHeight, cfg.gravity) * 0.98);
  });
});

describe('空中', () => {
  it('air strafe：側移＋轉視角可以增速；不按鍵時水平速度不變', () => {
    const s = sim({ primitives: FLAT, spawn: { pos: [0, 200, 0] } });
    s.player.velocity.set(0, 0, -8);
    s.step();
    const v0 = s.speed;
    s.run(0.5);
    expect(s.speed).toBeCloseTo(v0, 6);
    // 往左側移，視角跟著速度轉：讓期望方向與速度的夾角略小於 90°（v·wish 接近 wishSpeed 上限）。
    s.input.down('moveLeft');
    const accelStep = cfg.airAccel * cfg.runSpeed * s.dt;
    for (let i = 0; i < 60; i++) {
      const v = s.player.velocity;
      const speed = Math.hypot(v.x, v.z);
      const delta = Math.asin(Math.min(1, (cfg.airWishSpeedCap - accelStep) / speed));
      // yaw 指向速度方向後往右偏 delta：左側移的期望方向與速度夾 90° − delta。
      s.input.setYaw(Math.atan2(-v.x, -v.z) - delta);
      s.step();
    }
    expect(s.speed).toBeGreaterThan(v0 + 0.5);
  });

  it('air control 不增速；按後退會減速（不會讓速度掉頭）', () => {
    // 關掉 air strafe 加速，只看 air control 的旋轉。
    const s = sim({ primitives: FLAT, spawn: { pos: [0, 200, 0] }, config: { airAccel: 0 } });
    s.player.velocity.set(0, 0, -10);
    s.input.down('moveForward').setYaw(Math.PI / 2); // 面向 -X
    s.run(0.3);
    expect(s.speed).toBeCloseTo(10, 6);
    // 45°/s × 0.3 s ≈ 13.5°：速度往 -X 偏轉。
    const turned = (Math.atan2(-s.player.velocity.x, -s.player.velocity.z) * 180) / Math.PI;
    expect(turned).toBeCloseTo(cfg.airControlDegPerSec * 0.3, 0);
    const b = sim({ primitives: FLAT, spawn: { pos: [0, 200, 0] } });
    b.player.velocity.set(0, 0, -10);
    b.input.down('moveBack');
    b.run(0.3);
    expect(b.speed).toBeLessThan(10);
    expect(b.player.velocity.z).toBeLessThan(0);
  });

  it('水平速度超過 22 m/s 時對超出部分施加阻力', () => {
    const s = sim({ primitives: FLAT, spawn: { pos: [0, 500, 0] } });
    s.player.velocity.set(32, 0, 0);
    s.run(1);
    const expected = cfg.airSpeedSoftCap + 10 * Math.exp(-cfg.airOverspeedDrag * 1);
    expect(s.speed).toBeCloseTo(expected, 1);
  });
});

describe('滑鏟', () => {
  it('進入時有推進；冷卻中的第二次滑鏟沒有推進；冷卻後恢復', () => {
    const s = sim({ primitives: FLAT });
    s.settle();
    s.input.down('moveForward');
    s.run(0.6);
    const before = s.speed;
    s.input.down('crouch');
    s.step();
    expect(s.state).toBe('slide');
    const first = s.eventsNamed('player:slideStart')[0]!;
    expect(first.payload.boosted).toBe(true);
    expect(s.speed).toBeGreaterThan(before + cfg.slideBoost - 0.2);
    // 放開蹲 → 結束滑鏟，回到地面。
    s.run(0.2);
    s.input.up('crouch');
    s.step();
    expect(s.state).toBe('ground');
    expect(s.eventsNamed('player:slideEnd')).toHaveLength(1);
    // 冷卻中（距上次推進 < 1.2 s）再滑：沒有推進。
    s.run(0.3);
    const speed2 = s.speed;
    expect(speed2).toBeGreaterThanOrEqual(cfg.slideMinSpeed);
    s.input.down('crouch');
    s.step();
    expect(s.state).toBe('slide');
    const second = s.eventsNamed('player:slideStart')[1]!;
    expect(second.payload.boosted).toBe(false);
    expect(s.speed).toBeLessThanOrEqual(speed2 + 1e-6);
    s.input.up('crouch');
    s.run(1.3);
    s.input.down('crouch');
    s.step();
    expect(s.eventsNamed('player:slideStart')[2]!.payload.boosted).toBe(true);
  });

  it('速度低於 7 m/s 按蹲只會蹲下；速度低於 4.5 m/s 結束滑鏟並保持蹲姿', () => {
    const s = sim({ primitives: FLAT });
    s.settle();
    s.input.down('moveRight');
    s.run(0.6);
    s.input.up('moveRight');
    s.runUntil((x) => x.speed < 6, 1);
    s.input.down('crouch');
    s.step();
    expect(s.state).toBe('ground');
    expect(s.player.state.crouched).toBe(true);

    const t = sim({ primitives: FLAT });
    t.settle();
    t.input.down('moveForward');
    t.run(0.6);
    t.input.up('moveForward').down('crouch');
    t.step();
    expect(t.state).toBe('slide');
    const dur = t.runUntil((x) => x.state !== 'slide', 5);
    expect(dur).not.toBeNull();
    expect(t.state).toBe('ground');
    expect(t.speed).toBeLessThan(cfg.slideEndSpeed);
    expect(t.speed).toBeGreaterThan(cfg.slideEndSpeed - 0.2);
    expect(t.player.state.crouched).toBe(true);
  });

  it('滑鏟中跳躍保留水平動量；按住蹲落地直接接滑鏟', () => {
    const s = sim({ primitives: FLAT });
    s.settle();
    s.input.down('moveForward');
    s.run(0.6);
    s.input.down('crouch');
    s.step();
    s.run(0.1);
    const v = s.speed;
    s.input.tap('jump');
    s.step();
    expect(s.state).toBe('air');
    expect(s.speed).toBeCloseTo(v, 0);
    expect(s.eventsNamed('player:slideEnd')).toHaveLength(1);
    s.runUntil((x) => x.state !== 'air', 2);
    expect(s.state).toBe('slide');
    expect(s.eventsNamed('player:slideStart')).toHaveLength(2);
    // 第二次在冷卻中（約 0.7 s）→ 沒有推進。
    expect(s.eventsNamed('player:slideStart')[1]!.payload.boosted).toBe(false);
  });

  it('滑鏟轉向速率 90°/s', () => {
    const s = sim({ primitives: FLAT, config: { slideFriction: 0 } });
    s.settle();
    s.input.down('moveForward');
    s.run(0.6);
    s.input.down('crouch');
    s.step();
    const a0 = Math.atan2(s.player.velocity.x, s.player.velocity.z);
    s.input.up('moveForward').down('moveLeft');
    s.run(0.5);
    const a1 = Math.atan2(s.player.velocity.x, s.player.velocity.z);
    let d = Math.abs(a1 - a0);
    if (d > Math.PI) d = 2 * Math.PI - d;
    expect((d * 180) / Math.PI).toBeCloseTo(45, 0);
  });

  /** 15° × 40 m 坡（往 -Z 升高），從坡頂平台往下（+Z）衝刺後在坡上滑鏟。 */
  function slopeSlide(): MovementSim {
    const angle = (15 * Math.PI) / 180;
    const len = 40;
    const rise = len * Math.sin(angle);
    const run = len * Math.cos(angle);
    const s = sim({
      primitives: [
        floorBox('floor', -40, 40, -80, 60),
        { id: 'ramp', type: 'ramp', material: 'slide', pos: [0, 0, 0], size: [12, rise, run], thickness: 0.6 },
        boxMinMax('deck', [-6, 0, -run / 2 - 12], [6, rise, -run / 2], 'slide'),
      ],
      spawn: { pos: [0, rise, -run / 2 - 6], yaw: FACE_PLUS_Z },
    });
    s.settle();
    s.input.down('moveForward');
    const onSlope = s.runUntil((x) => x.player.grounded && x.player.groundNormal.y < 0.98 && x.player.position.z > -run / 2 + 2, 3);
    expect(onSlope).not.toBeNull();
    return s;
  }

  it('15° 下坡滑鏟會加速', () => {
    const s = slopeSlide();
    s.input.up('moveForward').down('crouch');
    s.step();
    expect(s.state).toBe('slide');
    const v0 = s.speed;
    s.run(1);
    expect(s.state).toBe('slide');
    expect(s.speed).toBeGreaterThan(v0 + 1);
    // 對照：平地同樣滑 1 秒會減速。
    const f = sim({ primitives: FLAT });
    f.settle();
    f.input.down('moveForward');
    f.run(0.6);
    f.input.up('moveForward').down('crouch');
    f.step();
    const f0 = f.speed;
    f.run(1);
    expect(f.speed).toBeLessThan(f0);
  });
});

describe('蹲下與頭頂空間', () => {
  it('在矮洞下放開蹲，不會起身卡進天花板；離開矮洞後自動起身', () => {
    // 天花板底面 y = 1.3（低於站姿 1.8、高於蹲姿 1.0），矮洞範圍 z ∈ [-10, -2]。
    const ceilingBottom = 1.3;
    const s = sim({
      primitives: [floorBox('floor', -20, 20, -40, 20), boxMinMax('ceiling', [-5, ceilingBottom, -10], [5, 3, -2])],
      spawn: { pos: [0, 0, 2] },
    });
    s.settle();
    s.input.down('crouch');
    s.run(0.3);
    s.input.down('moveForward');
    s.runUntil((x) => x.player.position.z < -6, 5);
    s.input.up('moveForward', 'crouch');
    s.run(0.5);
    expect(s.player.headBlocked).toBe(true);
    expect(s.player.crouchAmount).toBe(1);
    expect(s.player.height + s.player.position.y).toBeLessThan(ceilingBottom);
    expect(s.player.position.y).toBeCloseTo(0, 1);
    expect(s.player.hasHeadroom()).toBe(false);
    // 不按蹲也維持蹲走速度，往回走出矮洞後起身。
    s.input.down('moveBack');
    s.run(0.3);
    expect(s.speed).toBeCloseTo(cfg.crouchSpeed, 1);
    s.runUntil((x) => x.player.position.z > 0, 5);
    s.run(0.3);
    expect(s.player.crouchAmount).toBe(0);
    expect(s.player.height).toBeCloseTo(cfg.standHeight, 6);
  });
});

describe('碰撞與速度投影', () => {
  it('斜向撞牆會沿牆滑行，不黏牆、不抖動、不加速', () => {
    // 牆面 z = -5（法線 +Z），玩家面向 -Z 左轉 45°，往牆斜跑。
    const s = sim({ primitives: [...FLAT, boxMinMax('wall', [-80, 0, -6], [80, 4, -5])], spawn: { pos: [20, 0, 0] } });
    s.settle();
    s.input.setYaw(Math.PI / 4).down('moveForward');
    s.runUntil((x) => x.player.position.z < -5 + cfg.radius + 0.05, 3);
    s.run(0.2);
    const zs: number[] = [];
    const xs: number[] = [];
    const speeds: number[] = [];
    const vzs: number[] = [];
    for (let i = 0; i < 240; i++) {
      s.step();
      zs.push(s.player.position.z);
      xs.push(s.player.position.x);
      speeds.push(s.speed);
      vzs.push(s.player.velocity.z);
    }
    // 貼在牆前、不穿牆、不抖動：離牆距離只因角色控制器的間隙修正有 ≤ 2–3 cm 的變動，
    // 速度從不被彈離牆面（法線誤差已修正）。
    const zMin = Math.min(...zs);
    const zMax = Math.max(...zs);
    expect(zMin).toBeGreaterThan(-5 + cfg.radius - 0.01);
    expect(zMax - zMin).toBeLessThan(0.03);
    expect(Math.max(...vzs)).toBeLessThan(1e-3);
    // 持續沿牆前進（x 單調遞減），速度穩定且不超過衝刺速度。
    for (let i = 1; i < xs.length; i++) expect(xs[i]!).toBeLessThan(xs[i - 1]!);
    expect(Math.max(...speeds)).toBeLessThanOrEqual(cfg.sprintSpeed + 1e-6);
    expect(Math.min(...speeds)).toBeGreaterThan(cfg.sprintSpeed * 0.9);
    // 往外走就離開牆面（不黏牆）。
    s.input.up('moveForward').down('moveBack');
    s.run(0.5);
    expect(s.player.position.z).toBeGreaterThan(-4);
  });

  it('撞牆不累積速度：正面撞牆後水平速度歸零，放開就停', () => {
    const s = sim({ primitives: [...FLAT, boxMinMax('wall', [-10, 0, -6], [10, 4, -5])], spawn: { pos: [0, 0, 0] } });
    s.settle();
    s.input.down('moveForward');
    s.run(1.5);
    expect(s.player.position.z).toBeGreaterThan(-5 + cfg.radius - 0.001);
    expect(Math.abs(s.player.velocity.z)).toBeLessThan(1);
    s.input.up('moveForward');
    s.run(0.05);
    expect(s.speed).toBeLessThan(0.5);
  });

  it('跳起撞到天花板：垂直速度被投影，不黏在天花板', () => {
    const s = sim({ primitives: [...FLAT, boxMinMax('ceiling', [-5, 2.2, -5], [5, 3, 5])] });
    s.settle();
    s.input.tap('jump');
    s.step();
    s.runUntil((x) => x.player.velocity.y <= 0, 1);
    expect(s.player.position.y + s.player.height).toBeLessThan(2.2 + 1e-3);
    expect(s.time).toBeLessThan(0.3);
    s.runUntil((x) => x.player.grounded, 1);
    expect(s.player.grounded).toBe(true);
  });

  it('autostep：0.3 m 台階直接走上去，不減速；0.5 m 擋住', () => {
    const s = sim({ primitives: [...FLAT, boxMinMax('step', [-10, 0, -20], [10, 0.3, -5], 'floor')], spawn: { pos: [0, 0, 0] } });
    s.settle();
    s.input.down('moveForward');
    s.runUntil((x) => x.player.position.z < -7, 2);
    expect(s.player.position.y).toBeGreaterThan(0.29);
    expect(s.speed).toBeGreaterThan(cfg.sprintSpeed * 0.9);
    const b = sim({ primitives: [...FLAT, boxMinMax('step', [-10, 0, -20], [10, 0.5, -5], 'floor')], spawn: { pos: [0, 0, 0] } });
    b.settle();
    b.input.down('moveForward');
    b.run(1.5);
    expect(b.player.position.z).toBeGreaterThan(-5.1 + cfg.radius - 0.1);
    expect(b.player.position.y).toBeLessThan(0.1);
  });

  it('15° 坡可以走上去並以接近全速爬坡；下坡不騰空', () => {
    const angle = (15 * Math.PI) / 180;
    const run = 20;
    const rise = run * Math.tan(angle);
    const s = sim({
      primitives: [...FLAT, { id: 'ramp', type: 'ramp', material: 'slide', pos: [0, 0, -12], size: [10, rise, run] }],
      spawn: { pos: [0, 0, 0] },
    });
    s.settle();
    s.input.down('moveForward');
    s.runUntil((x) => x.player.position.z < -6, 2);
    s.run(0.4);
    expect(s.player.grounded).toBe(true);
    expect(s.player.groundNormal.y).toBeLessThan(0.98);
    expect(s.speed).toBeGreaterThan(cfg.sprintSpeed * 0.95);
    // 轉身下坡：全程保持著地。
    s.input.setYaw(Math.PI);
    let airborne = 0;
    s.runUntil((x) => {
      if (!x.player.grounded) airborne++;
      return x.player.position.z > -1;
    }, 3);
    expect(airborne).toBe(0);
  });
});

describe('重生與更新率', () => {
  it('落入 killVolume 回到最近檢查點，速度歸零並發出 respawn', () => {
    const s = sim({
      primitives: [boxMinMax('island', [-5, -1, -5], [5, 0, 5], 'floor')],
      checkpoints: [{ id: 'cp', pos: [0, 0, 0], yaw: 90 }],
      killVolumes: [{ id: 'void', pos: [0, -60, 0], size: [400, 60, 400] }],
    });
    s.settle();
    s.input.down('moveRight');
    const t = s.runUntil((x) => x.eventsNamed('player:respawn').length > 0, 5);
    expect(t).not.toBeNull();
    expect(s.player.position.x).toBeCloseTo(0, 1);
    expect(s.player.position.y).toBeCloseTo(0, 1);
    expect(s.player.velocity.length()).toBe(0);
    expect(s.input.yaw).toBeCloseTo(Math.PI / 2, 6);
    expect(s.state).toBe('air');
  });

  it('更新率無關：60／120／240 Hz 跑、跳、滑鏟的軌跡一致', () => {
    const results = [60, 120, 240].map((hz) => {
      const s = sim({ primitives: FLAT, hz });
      s.settle();
      s.input.down('moveForward');
      s.run(0.5);
      s.input.tap('jump');
      s.run(0.8);
      s.input.down('crouch');
      s.run(0.5);
      s.input.up('crouch', 'moveForward');
      s.run(0.5);
      return { z: s.player.position.z, speed: s.speed };
    });
    const [a, b, c] = results;
    expect(Math.abs(a!.z - b!.z)).toBeLessThan(0.15);
    expect(Math.abs(c!.z - b!.z)).toBeLessThan(0.15);
    expect(Math.abs(a!.speed - b!.speed)).toBeLessThan(0.3);
    expect(Math.abs(c!.speed - b!.speed)).toBeLessThan(0.3);
  });

  it('物理世界重建後自動重建膠囊與角色控制器', () => {
    const s = sim({ primitives: FLAT });
    s.settle();
    const old = s.player.capsule;
    s.level.dispose();
    s.physics.resetWorld();
    s.level.build({ physics: s.physics, root: new THREE.Group() });
    s.player.teleport({ x: 3, y: 0, z: 3 });
    s.settle();
    expect(s.player.capsule).not.toBe(old);
    expect(s.player.grounded).toBe(true);
    expect(s.player.position.y).toBeCloseTo(0, 1);
  });
});
