import { describe, expect, it } from 'vitest';
import { FixedLoop } from '@/core/FixedLoop';
import { Game, type GameSystem } from '@/core/Game';

/** 簡單的確定性模擬：重力下的拋體 + 每步累加計數。 */
function makeSim() {
  const state = { x: 0, y: 10, vx: 3, vy: 12, steps: 0 };
  const step = (dt: number) => {
    state.vy += -9.81 * dt;
    state.x += state.vx * dt;
    state.y += state.vy * dt;
    state.steps++;
  };
  return { state, step };
}

/** 用指定畫面更新率跑 totalSeconds，回傳最終狀態。 */
function runAtHz(frameHz: number, totalSeconds: number, jitter = 0) {
  const loop = new FixedLoop({ hz: 120, maxFrameDt: 0.1, maxStepsPerFrame: 8 });
  const sim = makeSim();
  const frames = Math.round(frameHz * totalSeconds);
  let t = 0;
  for (let i = 0; i < frames; i++) {
    // 抖動：奇偶畫面交錯加減（畫面數為偶數時總時間不變）。
    const j = i % 2 === 0 ? jitter : -jitter;
    const dt = 1 / frameHz + j;
    t += dt;
    loop.advance(dt, sim.step);
  }
  return { ...sim.state, loop, t };
}

describe('FixedLoop', () => {
  it('60／144／240 Hz 畫面跑相同總時間，得到相同步數與相同狀態', () => {
    const a = runAtHz(60, 2);
    const b = runAtHz(144, 2);
    const c = runAtHz(240, 2);
    expect(a.steps).toBe(240);
    expect(b.steps).toBe(240);
    expect(c.steps).toBe(240);
    // 每步都用相同的 stepDt 積分 → 狀態完全相同（不是近似）。
    expect(b.x).toBe(a.x);
    expect(b.y).toBe(a.y);
    expect(c.x).toBe(a.x);
    expect(c.y).toBe(a.y);
  });

  it('畫面時間有抖動時，相同總時間仍得到相同步數', () => {
    const a = runAtHz(144, 3, 0.002);
    const b = runAtHz(60, 3);
    expect(a.steps).toBe(b.steps);
    expect(a.y).toBe(b.y);
  });

  it('alpha 介於 [0, 1)，為累加器剩餘比例', () => {
    const loop = new FixedLoop({ hz: 100, maxFrameDt: 0.1, maxStepsPerFrame: 8 });
    const steps = loop.advance(0.025, () => {});
    expect(steps).toBe(2);
    expect(loop.alpha).toBeCloseTo(0.5, 9);
    loop.advance(0.004, () => {});
    expect(loop.alpha).toBeCloseTo(0.9, 9);
    expect(loop.alpha).toBeLessThan(1);
  });

  it('單一畫面 dt 上限 0.1 s：切分頁 30 秒回來只模擬 0.1 s 以內', () => {
    const loop = new FixedLoop({ hz: 120, maxFrameDt: 0.1, maxStepsPerFrame: 100 });
    const steps = loop.advance(30, () => {});
    expect(steps).toBe(12);
    expect(loop.lastRealDt).toBe(0.1);
  });

  it('每畫面最多 8 步，多出的時間捨棄（不累積成死亡螺旋）', () => {
    const loop = new FixedLoop({ hz: 120, maxFrameDt: 0.1, maxStepsPerFrame: 8 });
    expect(loop.advance(0.1, () => {})).toBe(8);
    expect(loop.droppedTime).toBeGreaterThan(0.025);
    // 下一個正常畫面不會補跑被捨棄的時間。
    expect(loop.advance(1 / 120, () => {})).toBeLessThanOrEqual(2);
    expect(loop.alpha).toBeLessThan(1);
  });

  it('timeScale 慢動作：步長不變、步數按比例減少；0 凍結', () => {
    const loop = new FixedLoop({ hz: 120, maxFrameDt: 0.1, maxStepsPerFrame: 8 });
    const dts: number[] = [];
    loop.timeScale = 0.25;
    for (let i = 0; i < 120; i++) loop.advance(1 / 120, (dt) => dts.push(dt));
    expect(dts.length).toBe(30);
    expect(new Set(dts)).toEqual(new Set([1 / 120]));
    loop.timeScale = 0;
    expect(loop.advance(0.05, () => {})).toBe(0);
  });

  it('負值、NaN、Infinity 的 dt 不推進模擬', () => {
    const loop = new FixedLoop({ hz: 120, maxFrameDt: 0.1, maxStepsPerFrame: 8 });
    expect(loop.advance(-1, () => {})).toBe(0);
    expect(loop.advance(Number.NaN, () => {})).toBe(0);
    expect(loop.advance(Number.POSITIVE_INFINITY, () => {})).toBe(0);
  });
});

describe('Game 主迴圈與分頁切換', () => {
  it('playing 中長時間沒有畫面（切分頁 30 秒）回來：只跑有限步數，位置不瞬移', () => {
    const game = new Game();
    const body = { x: 0, prevX: 0 };
    const mover: GameSystem = {
      name: 'mover',
      fixedUpdate(dt) {
        body.prevX = body.x;
        body.x += 5 * dt; // 5 m/s
      },
    };
    game.addSystem(mover);
    game.setMode('title');
    game.start();
    let now = 0;
    game.frame(now);
    for (let i = 0; i < 120; i++) game.frame((now += 1000 / 120));
    const before = body.x;
    const steps = game.frame((now += 30_000));
    expect(steps).toBe(8);
    expect(body.x - before).toBeCloseTo(5 * 8 * (1 / 120), 9);
    // 之後恢復正常節奏。
    expect(game.frame((now += 1000 / 120))).toBeLessThanOrEqual(2);
  });
});
