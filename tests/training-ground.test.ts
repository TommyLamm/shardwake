import * as THREE from 'three';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { FreeCamera, lookDirection, rightDirection } from '@/camera/FreeCamera';
import { EventBus } from '@/core/EventBus';
import type { GameEvents } from '@/core/events';
import { Game } from '@/core/Game';
import { ACTION_BIT } from '@/input/Actions';
import { createInputFrame } from '@/input/InputFrame';
import { Physics, type PhysicsHit } from '@/physics/Physics';
import { GREYBOX_MATERIAL_TABLE } from '@/world/Greybox';
import { DataLevel, LevelManager } from '@/world/Level';
import { courseCheckpoints, validateLevelData, zoneSpawn } from '@/world/LevelData';
import {
  CLIMB_WALL_HEIGHTS,
  PLATFORM_GAPS,
  PLATFORM_TOP,
  RANGE_DISTANCES,
  SLIDE_SLOPE,
  TOWER_HEIGHTS,
  TRAINING_GROUND_ID,
  TrainingGround,
  createTrainingGroundData,
} from '@/world/levels/TrainingGround';
import { colliderBounds } from './helpers/colliderBounds';

let physics: Physics;
let level: TrainingGround;
let manager: LevelManager;
const bus = new EventBus<GameEvents>();
const scene = new THREE.Scene();

beforeAll(async () => {
  await Physics.init();
  physics = new Physics({ bus });
  manager = new LevelManager({ physics, scene, bus });
  level = new TrainingGround();
  await manager.load(level);
});

afterAll(() => {
  manager.dispose();
  physics.dispose();
});

const DOWN = { x: 0, y: -1, z: 0 };

/** 從高處往下打，回傳命中高度與擁有者（數值複製出來，結果物件會被重複使用）。 */
function probeDown(x: number, z: number, fromY = 100): { y: number; owner: unknown; hit: PhysicsHit } | null {
  const hit = physics.raycast({ x, y: fromY, z }, DOWN, 200);
  return hit ? { y: hit.point.y, owner: hit.surface?.owner, hit } : null;
}

describe('訓練場資料', () => {
  it('資料合法、約 160 × 160 m', () => {
    const data = createTrainingGroundData();
    expect(validateLevelData(data, Object.keys(GREYBOX_MATERIAL_TABLE))).toEqual([]);
    expect(data.id).toBe(TRAINING_GROUND_ID);
    const floorBounds = new THREE.Box3();
    for (const p of level.built!.primitives) if (p.id.startsWith('floor-')) floorBounds.union(p.bounds);
    expect(floorBounds.max.x - floorBounds.min.x).toBe(160);
    expect(floorBounds.max.z - floorBounds.min.z).toBe(160);
  });

  it('靜態幾何已合併：網格 + 看板 < 80（draw call 預算）', () => {
    const built = level.built!;
    const drawables = built.stats.meshes + level.data.labels.length;
    expect(drawables).toBeLessThan(80);
    expect(built.stats.colliders).toBe(level.data.primitives.filter((p) => !p.flags?.noCollide).length);
    expect(built.stats.meshes).toBe(new Set(level.data.primitives.map((p) => p.material)).size);
  });

  it('每個碰撞體與它的網格包圍盒一致', () => {
    for (const p of level.built!.primitives) {
      if (!p.collider) continue;
      const cb = colliderBounds(physics, p.collider);
      const tol = p.def.type === 'cylinder' ? p.def.size[0] * 0.02 : 2e-3;
      expect(cb.min.distanceTo(p.bounds.min), p.id).toBeLessThan(tol * 2);
      expect(cb.max.distanceTo(p.bounds.max), p.id).toBeLessThan(tol * 2);
    }
  });

  it('地板四角與各區中心都站得住（y = 0）', () => {
    for (const [x, z] of [
      [-79, -79],
      [79, -79],
      [-79, 79],
      [79, 79],
      [0, 20],
    ] as const) {
      expect(probeDown(x, z)?.y, `${x},${z}`).toBeCloseTo(0, 4);
    }
  });

  it('跑牆長廊：兩面平行牆、長 40 m、高 6 m、可跑牆', () => {
    for (const x of [-38, -31]) {
      const top = probeDown(x + 0.5, 10);
      expect(top?.y).toBeCloseTo(6, 4);
      expect(top?.hit.surface?.wallRunnable).toBe(true);
    }
    const hitW = physics.raycast({ x: -34, y: 3, z: 10 }, { x: -1, y: 0, z: 0 }, 10)!;
    expect(hitW.point.x).toBeCloseTo(-37, 4);
    expect(hitW.surface?.wallRunnable).toBe(true);
    const hitE = physics.raycast({ x: -34, y: 3, z: 10 }, { x: 1, y: 0, z: 0 }, 10)!;
    expect(hitE.point.x).toBeCloseTo(-31, 4);
    // 長度：沿牆內側往北、往南打出去，兩端點相距 40 m。
    const wall = level.built!.primitives.find((p) => p.id === 'wallrun-wall-w')!;
    expect(wall.bounds.max.z - wall.bounds.min.z).toBe(40);
    expect(wall.bounds.max.y - wall.bounds.min.y).toBe(6);
  });

  it('深坑沒有底：坑中央往下打不到東西；Z 字牆板可跑牆', () => {
    expect(probeDown(-34, -44, -2)).toBeNull();
    const panel = level.built!.primitives.filter((p) => p.id.startsWith('zigzag-'));
    expect(panel).toHaveLength(5);
    for (const p of panel) expect(p.surface.wallRunnable).toBe(true);
  });

  it('落入深坑（y < -30）回到坑口檢查點，並發出 level:respawn', () => {
    const onRespawn = vi.fn();
    const off = bus.on('level:respawn', onRespawn);
    expect(level.checkRespawn({ x: -34, y: -10, z: -44 })).toBeNull();
    const spawn = level.checkRespawn({ x: -34, y: -31, z: -44 });
    expect(spawn).not.toBeNull();
    expect(onRespawn).toHaveBeenCalledWith({ levelId: TRAINING_GROUND_ID, checkpointId: 'cp-pit' });
    // 重生點底下有地面。
    expect(probeDown(spawn!.pos.x, spawn!.pos.z, spawn!.pos.y + 1)?.y).toBeCloseTo(spawn!.pos.y, 3);
    off();
  });

  it('滑鏟長坡：15°、長 40 m，坡頂接平台', () => {
    const mid = probeDown(SLIDE_SLOPE.x, SLIDE_SLOPE.lowZ - SLIDE_SLOPE.run / 2)!;
    expect(mid.owner).toBe('slide-ramp');
    expect(mid.y).toBeCloseTo(SLIDE_SLOPE.rise / 2, 2);
    expect((Math.acos(mid.hit.normal.y) * 180) / Math.PI).toBeCloseTo(15, 2);
    expect(SLIDE_SLOPE.length).toBe(40);
    const deck = probeDown(SLIDE_SLOPE.x, -50)!;
    expect(deck.owner).toBe('slide-deck');
    expect(deck.y).toBeCloseTo(SLIDE_SLOPE.rise, 3);
  });

  it('半管：弧底與地面齊平', () => {
    const bottom = probeDown(9, -25)!;
    expect(bottom.owner).toBe('halfpipe');
    expect(bottom.y).toBeCloseTo(0, 2);
    const lip = probeDown(9 + 5.7, -25)!;
    expect(lip.y).toBeCloseTo(5.5, 3);
  });

  it('攀爬測試牆高度 0.8／1.2／2.0／3.0／4.0 m', () => {
    CLIMB_WALL_HEIGHTS.forEach((h, i) => {
      const top = probeDown(30 + i * 10, 62)!;
      expect(top.owner).toBe(`climb-${h}`);
      expect(top.y).toBeCloseTo(h, 4);
    });
  });

  it('浮台群間距 4／7／10／14 m', () => {
    let x = 29;
    for (const gap of PLATFORM_GAPS) {
      const hit = physics.raycast({ x: x + 0.01, y: PLATFORM_TOP - 0.5, z: 33 }, { x: 1, y: 0, z: 0 }, 50)!;
      expect(hit.distance + 0.01).toBeCloseTo(gap, 3);
      expect(probeDown(x + gap / 2, 33)?.y).toBeCloseTo(0, 4); // 中間掉下去是地面
      x += gap + 3;
    }
  });

  it('高塔 20／30／40 m，塔頂抓鉤柱可抓鉤', () => {
    const centers = [
      [32, -50],
      [50, -62],
      [68, -48],
    ] as const;
    TOWER_HEIGHTS.forEach((h, i) => {
      const [x, z] = centers[i]!;
      const top = probeDown(x + 2, z + 2)!;
      expect(top.owner).toBe(`tower-${h}`);
      expect(top.y).toBeCloseTo(h, 4);
      expect(top.hit.surface?.grappleable).toBe(true);
      const anchor = probeDown(x, z)!;
      expect(anchor.owner).toBe(`tower-${h}-anchor`);
      expect(anchor.hit.surface?.grappleable).toBe(true);
    });
  });

  it('靶場標線距離射擊線 10／25／50／75 m', () => {
    const fire = level.built!.primitives.find((p) => p.id === 'range-line-fire')!;
    const fireZ = (fire.bounds.min.z + fire.bounds.max.z) / 2;
    for (const d of RANGE_DISTANCES) {
      const line = level.built!.primitives.find((p) => p.id === `range-line-${d}`)!;
      expect(fireZ - (line.bounds.min.z + line.bounds.max.z) / 2).toBeCloseTo(d, 6);
      expect(line.collider).toBeNull(); // 標線不擋腳
    }
  });

  it('每個分區的傳送點都在分區內且腳下有地面；重生檢查點腳下也有地面', () => {
    for (const z of level.data.zones) {
      const sp = zoneSpawn(z);
      expect(level.zoneAt({ x: sp.pos[0], y: sp.pos[1] + 0.5, z: sp.pos[2] })?.id, z.id).toBe(z.id);
      const ground = probeDown(sp.pos[0], sp.pos[2], sp.pos[1] + 0.5);
      expect(ground?.y, z.id).toBeCloseTo(sp.pos[1], 3);
    }
    for (const c of level.data.checkpoints.filter((cp) => cp.respawn !== false)) {
      expect(probeDown(c.pos[0], c.pos[2], c.pos[1] + 0.5)?.y, c.id).toBeCloseTo(c.pos[1], 3);
    }
    expect(courseCheckpoints(level.data, 'parkour').length).toBeGreaterThanOrEqual(8);
    const ids = level.data.zones.map((z) => z.id);
    for (const required of ['spawn', 'range', 'wallrun', 'zigzag', 'slide', 'halfpipe', 'climb', 'platforms', 'towers', 'arena']) {
      expect(ids).toContain(required);
    }
  });
});

describe('LevelManager', () => {
  it('重新載入會重建物理世界並發出事件；區域追蹤發出 level:zone', async () => {
    const localBus = new EventBus<GameEvents>();
    const p = new Physics({ bus: localBus });
    const sc = new THREE.Scene();
    const m = new LevelManager({ physics: p, scene: sc, bus: localBus });
    const events: string[] = [];
    localBus.on('physics:reset', () => events.push('reset'));
    localBus.on('level:loaded', ({ id }) => events.push(`loaded:${id}`));
    localBus.on('level:unloaded', ({ id }) => events.push(`unloaded:${id}`));
    const zoneEvents: GameEvents['level:zone'][] = [];
    localBus.on('level:zone', (e) => zoneEvents.push({ ...e }));
    const focus = { x: 0, y: 0.3, z: 62 };
    m.setFocus(() => focus);

    const first = await m.load(new TrainingGround());
    expect(m.current).toBe(first);
    const firstWorld = p.world;
    const colliders = p.world.colliders.len();
    expect(colliders).toBeGreaterThan(50);
    expect(sc.children).toHaveLength(1);

    const game = new Game({ bus: localBus });
    game.addSystem(m);
    game.setMode('title');
    game.start();
    game.tick(1 / 60);
    expect((first as DataLevel).zone?.id).toBe('spawn');
    focus.x = 50;
    focus.z = -5;
    game.tick(1 / 60);
    expect(zoneEvents.map((e) => `${e.zoneId}:${e.entered}`)).toEqual(['spawn:true', 'spawn:false', 'arena:true']);
    expect(zoneEvents[2]!.event).toBe('arena:enter');

    const second = await m.load(new TrainingGround());
    expect(events).toEqual([
      'reset',
      `loaded:${TRAINING_GROUND_ID}`,
      `unloaded:${TRAINING_GROUND_ID}`,
      'reset',
      `loaded:${TRAINING_GROUND_ID}`,
    ]);
    expect(p.world).not.toBe(firstWorld);
    expect(p.world.colliders.len()).toBe(colliders);
    expect(sc.children).toHaveLength(1);
    expect((first as DataLevel).built).toBeNull();
    expect(p.raycast({ x: 0, y: 10, z: 20 }, DOWN, 50)?.surface?.owner).toBe('floor-slide');

    m.unload();
    expect(m.current).toBeNull();
    expect(sc.children).toHaveLength(0);
    expect((second as DataLevel).built).toBeNull();
    game.dispose();
    p.dispose();
  });

  it('建構失敗時清理並重丟例外', async () => {
    const p = new Physics();
    const sc = new THREE.Scene();
    const m = new LevelManager({ physics: p, scene: sc });
    const broken = new DataLevel({ ...createTrainingGroundData(), spawnPoints: [] });
    await expect(m.load(broken)).rejects.toThrow(/spawnPoint/);
    expect(m.current).toBeNull();
    expect(sc.children).toHaveLength(0);
    expect(p.world.colliders.len()).toBe(0);
    p.dispose();
  });
});

describe('暫用自由相機', () => {
  function setup(): { cam: FreeCamera; frame: ReturnType<typeof createInputFrame>; views: number[][] } {
    const frame = createInputFrame();
    const views: number[][] = [];
    const cam = new FreeCamera({
      getFrame: () => frame,
      config: { speed: 10, boostMultiplier: 4, responsiveness: 1000, eyeHeight: 1.65 },
      checkRespawn: (eye) => level.checkRespawn({ x: eye.x, y: eye.y - 1.65, z: eye.z }),
      setView: (yaw, pitch) => views.push([yaw, pitch]),
    });
    return { cam, frame, views };
  }

  it('方向慣例：yaw 0 面向 -Z、yaw 90° 面向 -X；右方向與前方向垂直', () => {
    const v = new THREE.Vector3();
    expect(lookDirection(0, 0, v).toArray().map((n) => Math.round(n) + 0)).toEqual([0, 0, -1]);
    expect(lookDirection(Math.PI / 2, 0, v).toArray().map((n) => Math.round(n) + 0)).toEqual([-1, 0, 0]);
    expect(lookDirection(0, Math.PI / 2, v).y).toBeCloseTo(1, 6);
    const r = rightDirection(Math.PI / 2, new THREE.Vector3());
    expect(r.dot(lookDirection(Math.PI / 2, 0, v))).toBeCloseTo(0, 6);
  });

  it('WASD 沿視線飛行、Space／C 升降、Shift 加速、放開就停', () => {
    const { cam, frame, views } = setup();
    cam.teleport({ x: 0, y: 0, z: 0 }, 0.5);
    expect(cam.position.y).toBeCloseTo(1.65, 6);
    expect(views).toEqual([[0.5, 0]]);
    frame.move.y = 1;
    for (let i = 0; i < 120; i++) cam.fixedUpdate(1 / 120);
    expect(cam.position.z).toBeCloseTo(-10, 0);
    const z1 = cam.position.z;
    frame.held = ACTION_BIT.dash;
    for (let i = 0; i < 120; i++) cam.fixedUpdate(1 / 120);
    expect(z1 - cam.position.z).toBeCloseTo(40, 0);
    frame.move.y = 0;
    frame.held = ACTION_BIT.jump;
    const y0 = cam.position.y;
    for (let i = 0; i < 60; i++) cam.fixedUpdate(1 / 120);
    expect(cam.position.y - y0).toBeCloseTo(5, 0);
    frame.held = ACTION_BIT.crouch;
    for (let i = 0; i < 60; i++) cam.fixedUpdate(1 / 120);
    expect(cam.position.y).toBeCloseTo(y0, 0);
    frame.held = 0;
    for (let i = 0; i < 10; i++) cam.fixedUpdate(1 / 120);
    expect(cam.velocity.length()).toBeLessThan(1e-3);
  });

  it('渲染時在上一步與這一步之間插值', () => {
    const { cam, frame } = setup();
    const obj = new THREE.Object3D();
    const c2 = new FreeCamera({ getFrame: () => frame, object: obj, config: cam.config });
    c2.teleport({ x: 0, y: 0, z: 0 });
    frame.move.x = 1;
    c2.fixedUpdate(1 / 120);
    c2.render(0.5);
    expect(obj.position.x).toBeCloseTo((c2.previous.x + c2.position.x) / 2, 6);
    expect(obj.position.x).toBeGreaterThan(0);
  });

  it('落入 killVolume 會傳送回最近的檢查點', () => {
    const { cam, frame, views } = setup();
    cam.teleport({ x: -34, y: -29, z: -44 });
    frame.held = ACTION_BIT.crouch;
    for (let i = 0; i < 240 && views.length < 1; i++) cam.fixedUpdate(1 / 120);
    expect(views).toHaveLength(1);
    expect(cam.position.z).toBeCloseTo(-15, 0);
    expect(cam.position.y).toBeCloseTo(1.65, 1);
  });

  it('Game 中依固定步推進（只在 playing）', () => {
    const { cam, frame } = setup();
    cam.teleport({ x: 0, y: 0, z: 0 });
    const game = new Game();
    game.addSystem(cam);
    game.setMode('title');
    frame.move.y = 1;
    game.tick(1 / 60);
    expect(cam.position.z).toBe(0);
    game.start();
    for (let i = 0; i < 60; i++) game.tick(1 / 60);
    expect(cam.position.z).toBeLessThan(-9);
    game.dispose();
  });
});
