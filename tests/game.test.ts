import { describe, expect, it } from 'vitest';
import { EventBus } from '@/core/EventBus';
import type { GameEvents } from '@/core/events';
import { canTransition, Game, SystemOrder, type GameSystem } from '@/core/Game';

function recorder(name: string, order: number, log: string[]): GameSystem {
  return {
    name,
    order,
    init: () => log.push(`${name}.init`),
    fixedUpdate: () => log.push(`${name}.fixed`),
    update: () => log.push(`${name}.update`),
    render: () => log.push(`${name}.render`),
    dispose: () => log.push(`${name}.dispose`),
  };
}

describe('Game 模式狀態機', () => {
  it('boot → title → playing ⇄ paused → title', () => {
    const bus = new EventBus<GameEvents>();
    const seen: string[] = [];
    bus.on('game:mode', ({ from, to, reason }) => seen.push(`${from}>${to}${reason ? `:${reason}` : ''}`));
    const game = new Game({ bus });
    expect(game.mode).toBe('boot');
    expect(game.start()).toBe(false); // boot 不能直接開始
    expect(game.setMode('title')).toBe(true);
    expect(game.start()).toBe(true);
    expect(game.pause('hidden')).toBe(true);
    expect(game.pauseReason).toBe('hidden');
    expect(game.pause('blur')).toBe(false); // 已暫停，不重複切換
    expect(game.resume()).toBe(true);
    expect(game.pauseReason).toBeUndefined();
    expect(game.togglePause()).toBe(true);
    expect(game.setMode('title')).toBe(true);
    expect(seen).toEqual([
      'boot>title',
      'title>playing',
      'playing>paused:hidden',
      'paused>playing',
      'playing>paused:user',
      'paused>title',
    ]);
  });

  it('拒絕不合法的切換', () => {
    expect(canTransition('boot', 'playing')).toBe(false);
    expect(canTransition('title', 'paused')).toBe(false);
    expect(canTransition('paused', 'boot')).toBe(false);
    const game = new Game();
    expect(game.setMode('paused')).toBe(false);
    expect(game.mode).toBe('boot');
  });
});

describe('Game 系統生命週期', () => {
  it('依 order 執行（同 order 依註冊順序），fixed → update → render', () => {
    const log: string[] = [];
    const game = new Game();
    game.addSystem(recorder('render', SystemOrder.render, log));
    game.addSystem(recorder('input', SystemOrder.input, log));
    game.addSystem(recorder('physicsA', SystemOrder.physics, log));
    game.addSystem(recorder('physicsB', SystemOrder.physics, log));
    expect(log).toEqual(['render.init', 'input.init', 'physicsA.init', 'physicsB.init']);
    log.length = 0;
    game.setMode('title');
    game.start();
    game.tick(1 / 120);
    expect(log).toEqual([
      'input.fixed',
      'physicsA.fixed',
      'physicsB.fixed',
      'render.fixed',
      'input.update',
      'physicsA.update',
      'physicsB.update',
      'render.update',
      'input.render',
      'physicsA.render',
      'physicsB.render',
      'render.render',
    ]);
    log.length = 0;
    game.dispose();
    expect(log).toEqual(['render.dispose', 'physicsB.dispose', 'physicsA.dispose', 'input.dispose']);
  });

  it('只有 playing 時跑 fixedUpdate；暫停時 update 的 dt 為 0，但 realDt 照常', () => {
    const game = new Game();
    let fixed = 0;
    let lastDt = -1;
    let lastReal = -1;
    game.addSystem({
      name: 's',
      fixedUpdate: () => fixed++,
      update: (dt, f) => {
        lastDt = dt;
        lastReal = f.realDt;
      },
    });
    game.setMode('title');
    game.tick(0.05);
    expect(fixed).toBe(0);
    expect(lastDt).toBe(0);
    expect(lastReal).toBe(0.05);
    game.start();
    game.tick(0.05);
    expect(fixed).toBe(6);
    expect(lastDt).toBeCloseTo(0.05, 12);
    game.pause();
    game.tick(0.05);
    expect(fixed).toBe(6);
    expect(lastDt).toBe(0);
  });

  it('暫停後恢復，alpha 接續、不補跑暫停期間', () => {
    const game = new Game();
    let fixed = 0;
    game.addSystem({ name: 's', fixedUpdate: () => fixed++ });
    game.setMode('title');
    game.start();
    game.tick(1.5 / 120);
    expect(fixed).toBe(1);
    const alpha = game.frameInfo.alpha;
    expect(alpha).toBeCloseTo(0.5, 9);
    game.pause();
    for (let i = 0; i < 100; i++) game.tick(0.1);
    expect(fixed).toBe(1);
    expect(game.frameInfo.alpha).toBeCloseTo(alpha, 12);
    game.resume();
    game.tick(0.5 / 120);
    expect(fixed).toBe(2);
  });

  it('frame(now) 由時間戳換算 dt，第一個畫面 dt 為 0；resetClock 後重新從 0 開始', () => {
    const game = new Game();
    let fixed = 0;
    game.addSystem({ name: 's', fixedUpdate: () => fixed++ });
    game.setMode('title');
    game.start();
    expect(game.frame(1000)).toBe(0);
    expect(game.frame(1000 + 1000 / 60)).toBe(2);
    game.resetClock();
    expect(game.frame(99_999)).toBe(0);
    expect(fixed).toBe(2);
  });

  it('畫面進行中新增／移除系統，延到畫面結束後才生效', () => {
    const game = new Game();
    const log: string[] = [];
    const late = recorder('late', SystemOrder.ui, log);
    const spawner: GameSystem = {
      name: 'spawner',
      order: SystemOrder.input,
      update: () => {
        if (!game.getSystem('late')) game.addSystem(late);
      },
    };
    game.addSystem(spawner);
    game.setMode('title');
    game.tick(0.01);
    expect(log).toEqual(['late.init']);
    game.tick(0.01);
    expect(log).toEqual(['late.init', 'late.update', 'late.render']);
    expect(game.removeSystem(late)).toBe(true);
    expect(log.at(-1)).toBe('late.dispose');
    expect(game.removeSystem(late)).toBe(false);
  });

  it('系統名稱不可重複', () => {
    const game = new Game();
    game.addSystem({ name: 'a' });
    expect(() => game.addSystem({ name: 'a' })).toThrow();
  });
});
