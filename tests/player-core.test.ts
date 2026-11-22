// M1-05：移動純函式、狀態機與 MovementConfig／調參面板規格。
import { describe, expect, it, vi } from 'vitest';
import { MOVEMENT_CONFIG, MOVEMENT_PANEL, defaultMovementConfig, type MovementConfig } from '@/player/MovementConfig';
import {
  accelerate,
  applyFriction,
  applyOverspeedDrag,
  clampHorizontalSpeed,
  clipVelocity,
  inputAngleFromForward,
  jumpSpeedFor,
  rotateHorizontalTowards,
  slopeGravityHorizontal,
  wishDirection,
} from '@/player/movementMath';
import { StateMachine, type MoveState } from '@/player/StateMachine';
import { angleToWallTangent, mantleProgress, wallRunGravityAt } from '@/player/wallStates';
import { ProbeKind, ProbeLog } from '@/player/WallSensor';

const v3 = (x = 0, y = 0, z = 0): { x: number; y: number; z: number } => ({ x, y, z });

describe('movementMath', () => {
  it('jumpSpeedFor：v = √(2gh)，最高點 = v² / 2g', () => {
    const v = jumpSpeedFor(1.3, 24);
    expect(v).toBeCloseTo(Math.sqrt(62.4), 9);
    expect((v * v) / (2 * 24)).toBeCloseTo(1.3, 9);
    expect(jumpSpeedFor(-1, 24)).toBe(0);
  });

  it('accelerate：沿期望方向補到 wishSpeed 為止，每步最多 accel × wishSpeed × dt', () => {
    const v = v3();
    expect(accelerate(v, 1, 0, 10, 12, 1 / 120)).toBeCloseTo(1, 9);
    expect(v.x).toBeCloseTo(1, 9);
    v.x = 9.5;
    accelerate(v, 1, 0, 10, 12, 1 / 120);
    expect(v.x).toBeCloseTo(10, 9);
    // 已達速：不再增加，也不會減速。
    v.x = 12;
    expect(accelerate(v, 1, 0, 10, 12, 1 / 120)).toBe(0);
    expect(v.x).toBe(12);
    // capSpeed（Quake 空中）：只看 v·wish 是否小於上限，補速量仍用完整 wishSpeed 計算。
    const a = v3(0, 0, -10);
    accelerate(a, 1, 0, 7.5, 2.5, 1 / 120, 1.2);
    expect(a.x).toBeCloseTo((2.5 * 7.5) / 120, 9);
    expect(a.z).toBe(-10);
  });

  it('applyFriction：低速以 stopSpeed 計算、不反向；只影響水平', () => {
    const v = v3(3, 5, 4);
    const next = applyFriction(v, 6, 4, 1 / 120);
    expect(next).toBeCloseTo(5 - 5 * 6 * (1 / 120), 9);
    expect(v.y).toBe(5);
    const slow = v3(0.01, 0, 0);
    expect(applyFriction(slow, 6, 4, 1 / 120)).toBe(0);
    expect(slow.x).toBe(0);
  });

  it('rotateHorizontalTowards：限制角度、保持速率、夾角超過錐形不轉', () => {
    const v = v3(0, 0, -10);
    const turned = rotateHorizontalTowards(v, -1, 0, Math.PI / 8);
    expect(turned).toBeCloseTo(Math.PI / 8, 9);
    expect(Math.hypot(v.x, v.z)).toBeCloseTo(10, 9);
    // 正好 90°（純側移）也會轉。
    const s = v3(0, 0, -10);
    expect(rotateHorizontalTowards(s, 1, 0, 0.1)).toBeCloseTo(0.1, 9);
    // 背後方向：不轉。
    const b = v3(0, 0, -10);
    expect(rotateHorizontalTowards(b, 0, 1, 0.1)).toBe(0);
    expect(b.z).toBe(-10);
    // 已對齊：不轉超過。
    const c = v3(0, 0, -10);
    rotateHorizontalTowards(c, -0.01, -1, 1);
    expect(Math.atan2(c.x, c.z)).toBeCloseTo(Math.atan2(-0.01, -1), 9);
  });

  it('applyOverspeedDrag：只衰減超出軟上限的部分，與步長無關', () => {
    const a = v3(32, 0, 0);
    for (let i = 0; i < 120; i++) applyOverspeedDrag(a, 22, 2, 1 / 120);
    const b = v3(32, 0, 0);
    for (let i = 0; i < 30; i++) applyOverspeedDrag(b, 22, 2, 1 / 30);
    expect(a.x).toBeCloseTo(22 + 10 * Math.exp(-2), 9);
    expect(b.x).toBeCloseTo(a.x, 9);
    const c = v3(10, 0, 0);
    applyOverspeedDrag(c, 22, 2, 1);
    expect(c.x).toBe(10);
  });

  it('clipVelocity：只移除朝法線內側的分量', () => {
    const v = v3(-5, 0, -5);
    expect(clipVelocity(v, 0, 0, 1)).toBe(5);
    expect(v).toEqual({ x: -5, y: 0, z: 0 });
    const away = v3(0, 0, 3);
    expect(clipVelocity(away, 0, 0, 1)).toBe(0);
    expect(away.z).toBe(3);
  });

  it('clampHorizontalSpeed、slopeGravityHorizontal、inputAngleFromForward、wishDirection', () => {
    const v = v3(6, 1, 8);
    expect(clampHorizontalSpeed(v, 5)).toBe(5);
    expect(Math.hypot(v.x, v.z)).toBeCloseTo(5, 9);
    expect(v.y).toBe(1);
    // 15° 坡、法線朝 +Z 傾斜：水平分量 = g sinθ cosθ，指向 +Z（下坡）。
    const th = (15 * Math.PI) / 180;
    const out = slopeGravityHorizontal(24, 0, Math.cos(th), Math.sin(th), { x: 0, z: 0 });
    expect(out.z).toBeCloseTo(24 * Math.sin(th) * Math.cos(th), 9);
    expect(out.x).toBe(0);
    expect(inputAngleFromForward(0, 1)).toBe(0);
    expect(inputAngleFromForward(1, 1)).toBeCloseTo(Math.PI / 4, 9);
    expect(inputAngleFromForward(0, -1)).toBeCloseTo(Math.PI, 9);
    // yaw 0 面向 -Z；yaw π/2 面向 -X；右方 = (cos, -sin)。
    const w = { x: 0, z: 0 };
    wishDirection(0, 1, 0, w);
    expect(w.x).toBeCloseTo(0, 9);
    expect(w.z).toBeCloseTo(-1, 9);
    wishDirection(0, 1, Math.PI / 2, w);
    expect(w.x).toBeCloseTo(-1, 9);
    wishDirection(1, 0, 0, w);
    expect(w.x).toBeCloseTo(1, 9);
    expect(w.z).toBeCloseTo(0, 9);
  });
});

describe('StateMachine', () => {
  interface Ctx {
    speed: number;
    flag: boolean;
    log: string[];
  }
  function makeState(id: string): MoveState<Ctx> {
    return {
      id,
      enter: (c, prev) => c.log.push(`enter ${id} from ${prev}`),
      step: (c) => c.log.push(`step ${id}`),
      exit: (c, next) => c.log.push(`exit ${id} to ${next}`),
    };
  }

  it('轉換依 phase 與 priority 評估，每個階段最多一次，enter／exit 順序正確', () => {
    const ctx: Ctx = { speed: 10, flag: true, log: [] };
    const onChange = vi.fn();
    const m = new StateMachine(ctx, onChange);
    m.addState(makeState('a')).addState(makeState('b')).addState(makeState('c'));
    m.addTransition({ from: 'a', to: 'b', phase: 'post', when: (c) => c.flag });
    m.addTransition({ from: 'a', to: 'c', phase: 'post', priority: 5, when: (c) => c.speed > 5, name: '快 → c' });
    m.addTransition({ from: '*', to: 'a', phase: 'pre', when: () => true });
    m.set('a');
    expect(onChange).not.toHaveBeenCalled();
    expect(m.evaluate('pre')).toBeNull(); // 已在 a。
    expect(m.evaluate('post')).toBe('c');
    expect(m.lastTransition).toBe('快 → c');
    expect(onChange).toHaveBeenCalledWith('a', 'c');
    expect(ctx.log).toEqual(['enter a from null', 'exit a to c', 'enter c from a']);
    expect(m.previousId).toBe('a');
    expect(m.evaluate('pre')).toBe('a');
    ctx.speed = 0;
    expect(m.evaluate('post')).toBe('b');
  });

  it('新增狀態只需註冊狀態與規則；狀態時間累計，set(force) 重新進入', () => {
    const ctx: Ctx = { speed: 0, flag: false, log: [] };
    const m = new StateMachine(ctx);
    m.addState(makeState('ground'));
    m.set('ground');
    m.step(0.5);
    expect(m.timeInState).toBeCloseTo(0.5, 9);
    // 「後續計畫」加入新狀態。
    m.addState(makeState('wallRun'));
    m.addTransition({ from: ['ground'], to: 'wallRun', phase: 'post', priority: 20, when: (c) => c.flag });
    expect(m.evaluate('post')).toBeNull();
    ctx.flag = true;
    expect(m.evaluate('post')).toBe('wallRun');
    expect(m.timeInState).toBe(0);
    expect(m.stateIds).toEqual(['ground', 'wallRun']);
    ctx.log.length = 0;
    m.set('wallRun', true);
    expect(ctx.log).toEqual(['exit wallRun to wallRun', 'enter wallRun from wallRun']);
    expect(() => m.addState(makeState('ground'))).toThrow();
    expect(() => m.set('nope')).toThrow();
  });

  it('指向未註冊狀態的規則被略過', () => {
    const ctx: Ctx = { speed: 0, flag: true, log: [] };
    const m = new StateMachine(ctx);
    m.addState(makeState('a'));
    m.addTransition({ from: 'a', to: 'missing', phase: 'post', when: () => true });
    m.set('a');
    expect(m.evaluate('post')).toBeNull();
  });
});

describe('MovementConfig', () => {
  it('預設值符合計畫（M1-05）', () => {
    const c = defaultMovementConfig();
    expect(c).toMatchObject({
      standHeight: 1.8,
      crouchHeight: 1.0,
      radius: 0.35,
      standEyeHeight: 1.65,
      crouchEyeHeight: 0.95,
      crouchTransitionTime: 0.12,
      skinOffset: 0.01,
      autostepHeight: 0.35,
      snapToGround: 0.3,
      maxSlopeClimbDeg: 50,
      minSlopeSlideDeg: 55,
      runSpeed: 7.5,
      sprintSpeed: 10.5,
      sprintConeDeg: 50,
      crouchSpeed: 3.5,
      groundAccel: 12,
      friction: 6,
      landingFrictionGraceSteps: 1,
      jumpHeight: 1.3,
      gravity: 24,
      coyoteTime: 0.12,
      jumpBufferTime: 0.15,
      airAccel: 2.5,
      airWishSpeedCap: 1.2,
      airSpeedSoftCap: 22,
      airOverspeedDrag: 2,
      slideMinSpeed: 7,
      slideBoost: 3.5,
      slideBoostCooldown: 1.2,
      slideFriction: 0.8,
      slideSlopeFactor: 1,
      slideSteerDegPerSec: 90,
      slideEndSpeed: 4.5,
    });
    // 複本與原物件分離。
    c.runSpeed = 99;
    expect(MOVEMENT_CONFIG.runSpeed).toBe(7.5);
  });

  it('調參面板綁定所有參數，每個都有範圍、步進與標籤，預設值在範圍內', () => {
    const bound = new Set<string>();
    for (const group of MOVEMENT_PANEL) {
      expect(group.folder.startsWith('移動/')).toBe(true);
      for (const [key, spec] of Object.entries(group.schema)) {
        expect(bound.has(key), key).toBe(false);
        bound.add(key);
        expect(spec!.label, key).toBeTruthy();
        expect(spec!.min, key).toBeDefined();
        expect(spec!.max, key).toBeDefined();
        expect(spec!.step, key).toBeDefined();
        const value = MOVEMENT_CONFIG[key as keyof MovementConfig];
        expect(value, key).toBeGreaterThanOrEqual(spec!.min!);
        expect(value, key).toBeLessThanOrEqual(spec!.max!);
      }
    }
    expect([...bound].sort()).toEqual(Object.keys(MOVEMENT_CONFIG).sort());
  });
});

describe('跑牆與攀爬（M1-06）', () => {
  it('預設值符合計畫', () => {
    expect(defaultMovementConfig()).toMatchObject({
      wallDetectExtra: 0.35,
      wallMaxNormalY: 0.15,
      wallRunMinSpeed: 6,
      wallRunMaxAngleDeg: 50,
      wallRunMinHeight: 0.6,
      wallRunSameWallCooldown: 0.4,
      wallRunEntrySpeed: 10.5,
      wallRunMaxRiseSpeed: 3,
      wallRunGravity: 8,
      wallRunGravityRampTime: 1.2,
      wallRunMaxTime: 1.8,
      wallRunEndSpeed: 5,
      wallJumpAlongScale: 0.9,
      wallJumpNormalSpeed: 7,
      wallJumpUpSpeed: 7.5,
      mantleReach: 0.6,
      mantleMinHeight: 0.5,
      mantleMaxHeight: 2.0,
      mantleMaxSlopeDeg: 30,
      mantleMaxRiseSpeed: 4,
      mantleDuration: 0.28,
      mantleExitSpeedKeep: 0.6,
      mantleExitMinSpeed: 4,
    });
    const folders = MOVEMENT_PANEL.map((g) => g.folder);
    expect(folders).toEqual(expect.arrayContaining(['移動/跑牆', '移動/蹬牆跳', '移動/攀爬']));
  });

  it('純函式：重力曲線、攀爬路徑進度、與牆面切線的夾角', () => {
    expect(wallRunGravityAt(-1, 8, 1.2, 2)).toBe(0);
    expect(wallRunGravityAt(0.3, 8, 1.2, 2)).toBeCloseTo(0.5, 9);
    expect(wallRunGravityAt(1, 8, 0, 2)).toBe(8);
    const out = { up: 0, forward: 0 };
    expect(mantleProgress(0, 0.6, out)).toEqual({ up: 0, forward: 0 });
    expect(mantleProgress(0.3, 0.6, out).up).toBeCloseTo(0.75, 9);
    expect(out.forward).toBe(0);
    mantleProgress(0.6, 0.6, out);
    expect(out.up).toBe(1);
    expect(out.forward).toBe(0);
    expect(mantleProgress(0.8, 0.6, out).forward).toBeCloseTo(0.5, 9);
    expect(mantleProgress(1, 0.6, out)).toEqual({ up: 1, forward: 1 });
    expect(angleToWallTangent(0, -1, -1, 0)).toBeCloseTo(0, 9);
    expect(angleToWallTangent(Math.sin(0.5), -Math.cos(0.5), -1, 0)).toBeCloseTo(0.5, 9);
    expect(angleToWallTangent(1, 0, -1, 0)).toBeCloseTo(Math.PI / 2, 9);
  });

  it('ProbeLog 只在開啟時記錄，容量固定', () => {
    const log = new ProbeLog();
    const o = { x: 0, y: 1, z: 2 };
    log.push(o, 1, 1, 1, ProbeKind.valid);
    expect(log.count).toBe(0);
    log.enabled = true;
    for (let i = 0; i < ProbeLog.capacity + 5; i++) log.push(o, i, 0, 0, ProbeKind.miss);
    expect(log.count).toBe(ProbeLog.capacity);
    expect(Array.from(log.data.slice(0, 7))).toEqual([0, 1, 2, 0, 0, 0, ProbeKind.miss]);
    const rev = log.revision;
    log.clear();
    expect(log.count).toBe(0);
    expect(log.revision).toBeGreaterThan(rev);
  });
});
