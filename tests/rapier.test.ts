import RAPIER from '@dimforge/rapier3d-compat';
import { beforeAll, describe, expect, it } from 'vitest';

describe('Rapier（單執行緒 compat 版）', () => {
  beforeAll(async () => {
    await RAPIER.init();
  });

  it('能在 Node 初始化並回報版本', () => {
    expect(RAPIER.version()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('不依賴 SharedArrayBuffer 或 cross-origin isolation', () => {
    // compat 版內嵌 WASM、單執行緒；初始化成功即代表不需要 SAB。
    expect(globalThis.crossOriginIsolated ?? false).toBe(false);
  });

  it('能建立空世界並模擬自由落體', () => {
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 10, 0));
    world.createCollider(RAPIER.ColliderDesc.ball(0.5), body);
    for (let i = 0; i < 60; i++) world.step();
    const y = body.translation().y;
    expect(y).toBeLessThan(10);
    expect(y).toBeGreaterThan(0);
    world.free();
  });
});
