import RAPIER from '@dimforge/rapier3d-compat';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { EventBus } from '@/core/EventBus';
import type { GameEvents } from '@/core/events';
import { Game } from '@/core/Game';
import {
  ALL_GROUPS,
  COLLISION_PRESETS,
  CollisionGroup,
  QueryMask,
  groupMask,
  groupsInteract,
  interactionGroups,
  queryGroups,
  splitInteractionGroups,
} from '@/physics/groups';
import { Physics, PhysicsSystem } from '@/physics/Physics';
import { DEFAULT_SURFACE, SurfaceRegistry, isSurfaceType } from '@/physics/SurfaceRegistry';

beforeAll(async () => {
  await Physics.init();
});

describe('碰撞群組', () => {
  it('membership 在高 16 位元、filter 在低 16 位元，結果為無號整數', () => {
    const g = interactionGroups(CollisionGroup.LOOT, CollisionGroup.WORLD | CollisionGroup.PLAYER);
    expect(g).toBeGreaterThanOrEqual(0);
    expect(splitInteractionGroups(g)).toEqual({ membership: CollisionGroup.LOOT, filter: 0b11 });
    // 第 15 位元的 membership 也不會變成負數。
    expect(interactionGroups(1 << 15, ALL_GROUPS)).toBe(0x8000ffff);
  });

  it('群組位元互不重疊，groupMask 可混用名稱與位元', () => {
    const bits = Object.values(CollisionGroup);
    expect(new Set(bits).size).toBe(bits.length);
    expect(bits.reduce((a, b) => a | b, 0)).toBe(0b1111111);
    expect(groupMask('WORLD', 'ENEMY', CollisionGroup.LOOT)).toBe(0b1000101);
  });

  it('預設組合符合規則：投射物不撞玩家、觸發區只對玩家、碎片只撞世界', () => {
    const P = COLLISION_PRESETS;
    expect(groupsInteract(P.player, P.world)).toBe(true);
    expect(groupsInteract(P.player, P.enemy)).toBe(true);
    expect(groupsInteract(P.projectile, P.enemy)).toBe(true);
    expect(groupsInteract(P.projectile, P.player)).toBe(false);
    expect(groupsInteract(P.trigger, P.player)).toBe(true);
    expect(groupsInteract(P.trigger, P.enemy)).toBe(false);
    expect(groupsInteract(P.debris, P.world)).toBe(true);
    expect(groupsInteract(P.debris, P.player)).toBe(false);
    expect(groupsInteract(P.loot, P.player)).toBe(true);
  });

  it('查詢 groups 只依 mask 決定命中對象', () => {
    expect(groupsInteract(queryGroups(QueryMask.world), COLLISION_PRESETS.world)).toBe(true);
    expect(groupsInteract(queryGroups(CollisionGroup.ENEMY), COLLISION_PRESETS.world)).toBe(false);
    // 觸發區的 filter 只有 PLAYER，但查詢 membership 為全部，仍查得到。
    expect(groupsInteract(queryGroups(CollisionGroup.TRIGGER), COLLISION_PRESETS.trigger)).toBe(true);
  });
});

describe('SurfaceRegistry', () => {
  it('登記、查詢、預設值與移除', () => {
    const reg = new SurfaceRegistry();
    expect(reg.get(3)).toBeUndefined();
    expect(reg.getOrDefault(3)).toBe(DEFAULT_SURFACE);
    const info = reg.register(3, { wallRunnable: true, surface: 'grate', owner: 'wall-a' });
    expect(info).toEqual({ wallRunnable: true, grappleable: false, surface: 'grate', owner: 'wall-a' });
    expect(reg.isWallRunnable(3)).toBe(true);
    expect(reg.isGrappleable(3)).toBe(false);
    expect(reg.size).toBe(1);
    expect(reg.remove(3)).toBe(true);
    expect(reg.isWallRunnable(3)).toBe(false);
    reg.register(1, {});
    reg.clear();
    expect(reg.size).toBe(0);
    expect(isSurfaceType('glass')).toBe(true);
    expect(isSurfaceType('wood')).toBe(false);
  });
});

function makeWorld(): { physics: Physics; floor: RAPIER.Collider; wall: RAPIER.Collider } {
  const physics = new Physics();
  const floor = physics.createStaticCollider(
    RAPIER.ColliderDesc.cuboid(10, 0.5, 10).setTranslation(0, -0.5, 0).setCollisionGroups(COLLISION_PRESETS.world),
    { surface: 'concrete', owner: 'floor' },
  );
  const wall = physics.createStaticCollider(
    RAPIER.ColliderDesc.cuboid(0.5, 3, 5).setTranslation(5, 3, 0).setCollisionGroups(COLLISION_PRESETS.world),
    { surface: 'metal', wallRunnable: true, grappleable: true, owner: 'wall' },
  );
  return { physics, floor, wall };
}

describe('Physics 查詢', () => {
  it('未初始化前不能建立（init 可重複呼叫）', async () => {
    await expect(Physics.init()).resolves.toBeUndefined();
    expect(Physics.ready).toBe(true);
    expect(Physics.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('raycast 命中正確的 collider，並查得到表面旗標（建立後不必先 step）', () => {
    const { physics, floor, wall } = makeWorld();
    const down = physics.raycast({ x: 1, y: 5, z: 1 }, { x: 0, y: -2, z: 0 }, 100);
    expect(down).not.toBeNull();
    expect(down!.collider.handle).toBe(floor.handle);
    expect(down!.distance).toBeCloseTo(5, 4);
    expect(down!.point.y).toBeCloseTo(0, 4);
    expect(down!.normal.y).toBeCloseTo(1, 4);
    expect(down!.surface).toMatchObject({ surface: 'concrete', owner: 'floor', wallRunnable: false });

    const side = physics.raycast({ x: 0, y: 2, z: 0 }, { x: 1, y: 0, z: 0 }, 50);
    expect(side!.collider.handle).toBe(wall.handle);
    expect(side!.point.x).toBeCloseTo(4.5, 4);
    expect(side!.normal.x).toBeCloseTo(-1, 4);
    expect(side!.surface?.wallRunnable).toBe(true);
    expect(side!.surface?.grappleable).toBe(true);
    physics.dispose();
  });

  it('raycast：maxDist、mask、exclude 與零方向', () => {
    const { physics, wall } = makeWorld();
    const o = { x: 0, y: 2, z: 0 };
    const d = { x: 1, y: 0, z: 0 };
    expect(physics.raycast(o, d, 4)).toBeNull();
    expect(physics.raycast(o, d, 50, CollisionGroup.ENEMY)).toBeNull();
    expect(physics.raycast(o, d, 50, QueryMask.world, wall)).toBeNull();
    expect(physics.raycast(o, { x: 0, y: 0, z: 0 }, 50)).toBeNull();
    physics.dispose();
  });

  it('查詢結果物件重複使用（不配置新的結果物件）', () => {
    const { physics } = makeWorld();
    const a = physics.raycast({ x: 0, y: 5, z: 0 }, { x: 0, y: -1, z: 0 }, 100);
    const pointRef = a!.point;
    const b = physics.raycast({ x: 2, y: 3, z: 0 }, { x: 0, y: -1, z: 0 }, 100);
    expect(b).toBe(a);
    expect(b!.point).toBe(pointRef);
    expect(b!.distance).toBeCloseTo(3, 4);
    physics.dispose();
  });

  it('shapeCast：球往牆掃掠，距離 = 牆面 − 半徑；命中點與法線在牆上', () => {
    const { physics, wall } = makeWorld();
    const ball = new RAPIER.Ball(0.5);
    const hit = physics.shapeCast(ball, { x: 0, y: 2, z: 0 }, { x: 3, y: 0, z: 0 }, 20);
    expect(hit!.collider.handle).toBe(wall.handle);
    expect(hit!.distance).toBeCloseTo(4, 2);
    expect(hit!.point.x).toBeCloseTo(4.5, 2);
    expect(hit!.normal.x).toBeCloseTo(-1, 3);
    expect(hit!.surface?.wallRunnable).toBe(true);
    expect(physics.shapeCast(ball, { x: 0, y: 2, z: 0 }, { x: -1, y: 0, z: 0 }, 20)).toBeNull();
    physics.dispose();
  });

  it('overlap：回傳重疊數量並放進重複使用的陣列；limit 可提早停止', () => {
    const { physics, floor, wall } = makeWorld();
    const ball = new RAPIER.Ball(0.6);
    expect(physics.overlap(ball, { x: 0, y: 3, z: 0 })).toBe(0);
    expect(physics.overlap(ball, { x: 4.6, y: 0.2, z: 0 })).toBe(2);
    const handles = physics.overlapResults.map((c) => c.handle).sort();
    expect(handles).toEqual([floor.handle, wall.handle].sort());
    expect(physics.overlap(ball, { x: 4.6, y: 0.2, z: 0 }, QueryMask.world, undefined, null, 1)).toBe(1);
    expect(physics.overlap(ball, { x: 4.6, y: 0.2, z: 0 }, QueryMask.world, undefined, wall)).toBe(1);
    physics.dispose();
  });

  it('世界重力只作用在動態物件；PhysicsSystem 每個固定步推進', () => {
    const physics = new Physics();
    const body = physics.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 10, 0));
    physics.world.createCollider(RAPIER.ColliderDesc.ball(0.2), body);
    const game = new Game();
    game.addSystem(new PhysicsSystem(physics));
    game.setMode('title');
    game.start();
    for (let i = 0; i < 60; i++) game.tick(1 / 60);
    expect(physics.stepCount).toBe(120);
    // 1 秒自由落體約 4.9 m（世界重力 -9.81）。
    expect(body.translation().y).toBeCloseTo(10 - 4.905, 0);
    game.dispose();
    expect(physics.isDisposed).toBe(true);
  });

  it('resetWorld：建立新世界、清空表面、代數加一並發出事件；舊代的碰撞體不會誤刪新世界的同號碰撞體', () => {
    const bus = new EventBus<GameEvents>();
    const onReset = vi.fn();
    bus.on('physics:reset', onReset);
    const physics = new Physics({ bus });
    const oldWorld = physics.world;
    const old = physics.createStaticCollider(RAPIER.ColliderDesc.cuboid(1, 1, 1), { owner: 'old' });
    const gen = physics.generation;
    physics.resetWorld();
    expect(onReset).toHaveBeenCalledTimes(1);
    expect(physics.world).not.toBe(oldWorld);
    expect(physics.generation).toBe(gen + 1);
    expect(physics.surfaces.size).toBe(0);
    const fresh = physics.createStaticCollider(RAPIER.ColliderDesc.cuboid(1, 1, 1), { owner: 'new' });
    expect(fresh.handle).toBe(old.handle);
    physics.removeCollider(old, gen);
    expect(physics.world.getCollider(fresh.handle)).toBeTruthy();
    expect(physics.raycast({ x: 0, y: 5, z: 0 }, { x: 0, y: -1, z: 0 }, 10)?.surface?.owner).toBe('new');
    physics.removeCollider(fresh);
    expect(physics.raycast({ x: 0, y: 5, z: 0 }, { x: 0, y: -1, z: 0 }, 10)).toBeNull();
    physics.dispose();
  });

  it('sensor（觸發區）預設不擋 raycast，overlap 預設查得到', () => {
    const physics = new Physics();
    physics.createStaticCollider(
      RAPIER.ColliderDesc.cuboid(2, 2, 2).setSensor(true).setCollisionGroups(COLLISION_PRESETS.trigger),
    );
    expect(physics.raycast({ x: 0, y: 5, z: 0 }, { x: 0, y: -1, z: 0 }, 10, QueryMask.all)).toBeNull();
    expect(physics.overlap(new RAPIER.Ball(0.1), { x: 0, y: 0, z: 0 }, CollisionGroup.TRIGGER)).toBe(1);
    physics.dispose();
  });
});
