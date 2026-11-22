import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import {
  damp,
  dampAngle,
  fbm1D,
  halfLifeToLambda,
  horizontalToVerticalFov,
  lerpAngle,
  SpringScalar,
  SpringVec3,
  springStep,
  valueNoise1D,
  valueNoise2D,
  verticalToHorizontalFov,
  wrapAngle,
} from '@/core/math';
import { hashSeed, Rng } from '@/core/Rng';

/** 以固定 dt 跑到 totalTime，回傳每 sampleEvery 秒的值。 */
function runSpring(spring: SpringScalar, dt: number, totalTime: number): number {
  const steps = Math.round(totalTime / dt);
  for (let i = 0; i < steps; i++) spring.update(dt);
  return spring.value;
}

describe('damp', () => {
  it('與 dt 無關：1/30 與 1/240 跑相同總時間結果一致', () => {
    let a = 0;
    let b = 0;
    for (let i = 0; i < 30; i++) a = damp(a, 10, 8, 1 / 30);
    for (let i = 0; i < 240; i++) b = damp(b, 10, 8, 1 / 240);
    expect(a).toBeCloseTo(b, 10);
    expect(a).toBeCloseTo(10 * (1 - Math.exp(-8)), 10);
  });

  it('半衰期換算', () => {
    const lambda = halfLifeToLambda(0.2);
    expect(damp(0, 1, lambda, 0.2)).toBeCloseTo(0.5, 12);
  });
});

describe('彈簧（解析解積分）', () => {
  it.each([
    [1, '臨界阻尼'],
    [0.7, '欠阻尼（落地回彈）'],
    [1.6, '過阻尼'],
  ])('dt = 1/30 與 1/240 收斂結果一致（ζ = %s，%s）', (zeta) => {
    const make = () => new SpringScalar({ frequency: 4, dampingRatio: zeta, value: 0, target: 1 });
    for (const t of [0.1, 0.2, 0.5, 1, 2]) {
      const a = runSpring(make(), 1 / 30, t);
      const b = runSpring(make(), 1 / 240, t);
      expect(a).toBeCloseTo(b, 9);
    }
    const settled = runSpring(make(), 1 / 30, 5);
    expect(settled).toBeCloseTo(1, 6);
  });

  it('臨界阻尼不過衝', () => {
    const s = new SpringScalar({ frequency: 6, value: 0, target: 1 });
    let max = 0;
    for (let i = 0; i < 1000; i++) max = Math.max(max, s.update(1 / 240));
    expect(max).toBeLessThanOrEqual(1 + 1e-12);
  });

  it('ζ = 0.7 會過衝一次再回到目標', () => {
    const s = new SpringScalar({ frequency: 8, dampingRatio: 0.7, value: 0, target: 1 });
    let max = 0;
    for (let i = 0; i < 480; i++) max = Math.max(max, s.update(1 / 240));
    expect(max).toBeGreaterThan(1.01);
    expect(s.value).toBeCloseTo(1, 6);
  });

  it('大 dt 不發散（0.5 s、1 s、10 s 一步）', () => {
    for (const zeta of [0.3, 1, 2]) {
      for (const dt of [0.5, 1, 10]) {
        const s = new SpringScalar({ frequency: 12, dampingRatio: zeta, value: 0, target: 1 });
        s.addImpulse(50);
        for (let i = 0; i < 20; i++) {
          s.update(dt);
          expect(Number.isFinite(s.value)).toBe(true);
          expect(Math.abs(s.value)).toBeLessThan(10);
        }
        expect(s.value).toBeCloseTo(1, 3);
      }
    }
  });

  it('衝量：從靜止被推出後回到目標', () => {
    const s = new SpringScalar({ frequency: 8, dampingRatio: 0.7 });
    s.addImpulse(-1.5);
    s.update(1 / 60);
    expect(s.value).toBeLessThan(0);
    for (let i = 0; i < 240; i++) s.update(1 / 60);
    expect(s.value).toBeCloseTo(0, 6);
  });

  it('dt = 0 不改變狀態；係數在 t = 0 為單位矩陣', () => {
    const k = springStep(5, 0.5, 0, { a: 0, b: 0, c: 0, d: 0 });
    expect(k).toEqual({ a: 1, b: 0, c: 0, d: 1 });
    const s = new SpringScalar({ frequency: 5, value: 3, target: 0 });
    s.update(0);
    expect(s.value).toBe(3);
  });

  it('SpringVec3 每軸與 SpringScalar 一致', () => {
    const v = new SpringVec3({ frequency: 3, dampingRatio: 0.8, value: new Vector3(1, -2, 3) });
    v.target.set(0, 0, 0);
    const sx = new SpringScalar({ frequency: 3, dampingRatio: 0.8, value: 1, target: 0 });
    const sy = new SpringScalar({ frequency: 3, dampingRatio: 0.8, value: -2, target: 0 });
    for (let i = 0; i < 50; i++) {
      v.update(1 / 144);
      sx.update(1 / 144);
      sy.update(1 / 144);
    }
    expect(v.value.x).toBeCloseTo(sx.value, 12);
    expect(v.value.y).toBeCloseTo(sy.value, 12);
  });
});

describe('角度', () => {
  it('wrapAngle 包到 (-π, π]', () => {
    expect(wrapAngle(3 * Math.PI)).toBeCloseTo(Math.PI, 12);
    expect(wrapAngle(-Math.PI)).toBeCloseTo(Math.PI, 12);
    expect(wrapAngle(0.5 + 4 * Math.PI)).toBeCloseTo(0.5, 12);
  });

  it('lerpAngle 走最短方向（跨越 ±π）', () => {
    const a = (170 * Math.PI) / 180;
    const b = (-170 * Math.PI) / 180;
    const mid = wrapAngle(lerpAngle(a, b, 0.5));
    expect(Math.abs(mid)).toBeCloseTo(Math.PI, 9);
    expect(lerpAngle(0, 1, 0.25)).toBeCloseTo(0.25, 12);
  });

  it('dampAngle 收斂到目標且與 dt 無關', () => {
    let a = 3;
    let b = 3;
    for (let i = 0; i < 30; i++) a = dampAngle(a, -3, 5, 1 / 30);
    for (let i = 0; i < 240; i++) b = dampAngle(b, -3, 5, 1 / 240);
    expect(a).toBeCloseTo(b, 9);
  });
});

describe('FOV 換算', () => {
  it('水平 ↔ 垂直互為反函數；90° 水平在 1:1 時垂直也是 90°', () => {
    expect(horizontalToVerticalFov(90, 1)).toBeCloseTo(90, 9);
    for (const aspect of [16 / 9, 21 / 9, 4 / 3]) {
      const v = horizontalToVerticalFov(103, aspect);
      expect(v).toBeLessThan(103);
      expect(verticalToHorizontalFov(v, aspect)).toBeCloseTo(103, 9);
    }
    // 103° 水平、16:9 約為 70.5° 垂直。
    expect(horizontalToVerticalFov(103, 16 / 9)).toBeCloseTo(70.53, 1);
  });
});

describe('值雜訊', () => {
  it('範圍 [-1, 1]、可重現、連續', () => {
    let prev = valueNoise1D(0, 7);
    for (let i = 1; i < 2000; i++) {
      const x = i * 0.01;
      const n = valueNoise1D(x, 7);
      expect(n).toBeGreaterThanOrEqual(-1);
      expect(n).toBeLessThanOrEqual(1);
      expect(Math.abs(n - prev)).toBeLessThan(0.05);
      prev = n;
    }
    expect(valueNoise1D(3.3, 7)).toBe(valueNoise1D(3.3, 7));
    expect(valueNoise1D(3.3, 7)).not.toBe(valueNoise1D(3.3, 8));
  });

  it('2D 雜訊與 fbm 在範圍內且有變化', () => {
    const values = new Set<number>();
    for (let i = 0; i < 50; i++) {
      const n = valueNoise2D(i * 0.37, i * 0.21, 1);
      const f = fbm1D(i * 0.13, 4, 2);
      expect(Math.abs(n)).toBeLessThanOrEqual(1);
      expect(Math.abs(f)).toBeLessThanOrEqual(1);
      values.add(Math.round(n * 100));
    }
    expect(values.size).toBeGreaterThan(10);
  });
});

describe('Rng（mulberry32）', () => {
  it('相同種子得到相同序列，不同種子不同', () => {
    const a = new Rng(12345);
    const b = new Rng(12345);
    const c = new Rng(54321);
    const seqA = Array.from({ length: 100 }, () => a.nextUint32());
    const seqB = Array.from({ length: 100 }, () => b.nextUint32());
    const seqC = Array.from({ length: 100 }, () => c.nextUint32());
    expect(seqA).toEqual(seqB);
    expect(seqA).not.toEqual(seqC);
    expect(new Rng('shardwake').float()).toBe(new Rng(hashSeed('shardwake')).float());
  });

  it('getState／setState 可還原序列（錄影重播用）', () => {
    const r = new Rng(1);
    r.float();
    const saved = r.getState();
    const next = [r.float(), r.int(0, 100), r.range(-1, 1)];
    r.setState(saved);
    expect([r.float(), r.int(0, 100), r.range(-1, 1)]).toEqual(next);
  });

  it('float、range、int 在範圍內；int 含兩端', () => {
    const r = new Rng(99);
    const ints = new Set<number>();
    for (let i = 0; i < 5000; i++) {
      const f = r.float();
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThan(1);
      const x = r.range(-2, 3);
      expect(x).toBeGreaterThanOrEqual(-2);
      expect(x).toBeLessThan(3);
      const n = r.int(1, 6);
      expect(Number.isInteger(n)).toBe(true);
      ints.add(n);
    }
    expect([...ints].sort()).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('pick 與 weighted 依權重分布；無效權重不會被選中', () => {
    const r = new Rng(7);
    expect(r.pick([])).toBeUndefined();
    const counts = { a: 0, b: 0, c: 0, z: 0 };
    const items = ['a', 'b', 'c', 'z'] as const;
    for (let i = 0; i < 20000; i++) counts[r.weighted(items, [1, 3, 6, 0])!]++;
    expect(counts.z).toBe(0);
    expect(counts.a / 20000).toBeCloseTo(0.1, 1);
    expect(counts.b / 20000).toBeCloseTo(0.3, 1);
    expect(counts.c / 20000).toBeCloseTo(0.6, 1);
    expect(r.weighted(items, () => 0)).toBeUndefined();
    expect(r.weighted([{ w: 5, id: 'x' }], (it) => it.w)?.id).toBe('x');
  });

  it('shuffle 保留所有元素；fork 產生獨立且可重現的子序列', () => {
    const r = new Rng(3);
    const arr = r.shuffle([1, 2, 3, 4, 5, 6, 7, 8]);
    expect([...arr].sort()).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    const f1 = new Rng(3).fork().float();
    const f2 = new Rng(3).fork().float();
    expect(f1).toBe(f2);
  });
});
