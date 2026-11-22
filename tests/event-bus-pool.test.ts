import { describe, expect, it, vi } from 'vitest';
import { EventBus } from '@/core/EventBus';
import { Pool } from '@/core/Pool';

interface TestEvents {
  hit: { amount: number };
  ping: void;
}

describe('EventBus', () => {
  it('emit 同步派送給所有監聽者（依註冊順序），off 後不再收到', () => {
    const bus = new EventBus<TestEvents>();
    const log: string[] = [];
    const a = (e: { amount: number }) => log.push(`a${e.amount}`);
    bus.on('hit', a);
    bus.on('hit', (e) => log.push(`b${e.amount}`));
    expect(bus.emit('hit', { amount: 1 })).toBe(2);
    expect(log).toEqual(['a1', 'b1']);
    bus.off('hit', a);
    bus.emit('hit', { amount: 2 });
    expect(log).toEqual(['a1', 'b1', 'b2']);
  });

  it('once 只觸發一次；on 回傳的取消函式有效；void 事件可省略參數', () => {
    const bus = new EventBus<TestEvents>();
    const once = vi.fn();
    bus.once('ping', once);
    const unsub = bus.on('ping', () => {});
    bus.emit('ping');
    bus.emit('ping');
    expect(once).toHaveBeenCalledTimes(1);
    expect(bus.listenerCount('ping')).toBe(1);
    unsub();
    expect(bus.listenerCount('ping')).toBe(0);
    expect(bus.emit('ping')).toBe(0);
  });

  it('派送途中移除或新增監聽者，不影響本次派送', () => {
    const bus = new EventBus<TestEvents>();
    const log: string[] = [];
    const b = () => log.push('b');
    bus.on('ping', () => {
      log.push('a');
      bus.off('ping', b);
      bus.on('ping', () => log.push('c'));
    });
    bus.on('ping', b);
    bus.emit('ping');
    expect(log).toEqual(['a', 'b']);
  });

  it('監聽者丟出例外時回報錯誤並繼續派送', () => {
    const errors: string[] = [];
    const bus = new EventBus<TestEvents>((name) => errors.push(name));
    const after = vi.fn();
    bus.on('hit', () => {
      throw new Error('boom');
    });
    bus.on('hit', after);
    bus.emit('hit', { amount: 1 });
    expect(errors).toEqual(['hit']);
    expect(after).toHaveBeenCalledOnce();
  });
});

describe('Pool', () => {
  it('acquire／release 重複使用物件，reset 在取出時呼叫', () => {
    let created = 0;
    const pool = new Pool({ create: () => ({ id: created++, v: 0 }), reset: (o) => (o.v = 0), max: 4, initial: 2 });
    expect(pool.size).toBe(2);
    const a = pool.acquire()!;
    a.v = 9;
    expect(pool.release(a)).toBe(true);
    expect(pool.release(a)).toBe(false); // 重複歸還
    const b = pool.acquire()!;
    expect(b).toBe(a);
    expect(b.v).toBe(0);
    expect(created).toBe(2);
  });

  it('用盡時 recycleOldest 回收最早取出的物件', () => {
    const released: number[] = [];
    let n = 0;
    const pool = new Pool({ create: () => ({ id: n++ }), onRelease: (o) => released.push(o.id), max: 3 });
    const items = [pool.acquire()!, pool.acquire()!, pool.acquire()!];
    expect(items.map((o) => o.id)).toEqual([0, 1, 2]);
    const d = pool.acquire()!;
    expect(d.id).toBe(0);
    expect(released).toEqual([0]);
    expect(pool.recycledCount).toBe(1);
    // 0 剛被重新取出，現在最舊的是 1。
    expect(pool.acquire()!.id).toBe(1);
    expect(pool.activeCount).toBe(3);
  });

  it('用盡時 reject 回傳 null', () => {
    const pool = new Pool({ create: () => ({}), max: 2, whenExhausted: 'reject' });
    expect(pool.acquire()).not.toBeNull();
    expect(pool.acquire()).not.toBeNull();
    expect(pool.acquire()).toBeNull();
    expect(pool.rejectedCount).toBe(1);
  });

  it('releaseAll 與 forEachActive（走訪中可歸還）', () => {
    const pool = new Pool({ create: () => ({ alive: true }), max: 5 });
    for (let i = 0; i < 4; i++) pool.acquire();
    let visited = 0;
    pool.forEachActive((o) => {
      visited++;
      if (visited % 2 === 0) pool.release(o);
    });
    expect(visited).toBe(4);
    expect(pool.activeCount).toBe(2);
    pool.releaseAll();
    expect(pool.activeCount).toBe(0);
    expect(pool.freeCount).toBe(4);
  });

  it('max 必須是正整數', () => {
    expect(() => new Pool({ create: () => ({}), max: 0 })).toThrow();
  });
});
