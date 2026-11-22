import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { Physics } from '@/physics/Physics';
import { GREYBOX_CONFIG, GREYBOX_MATERIAL_TABLE, gridCoverageAt, makeGridPixels, PlainVisuals } from '@/world/Greybox';
import { buildLevel, primitiveWorldGeometry, rampGeometry } from '@/world/LevelBuilder';
import {
  boxContains,
  courseCheckpoints,
  killVolumeAt,
  nearestCheckpoint,
  validateLevelData,
  zoneAt,
  zoneSpawn,
  type LevelData,
  type LevelPrimitive,
} from '@/world/LevelData';
import { halfPipe } from '@/world/LevelShapes';
import { colliderBounds } from './helpers/colliderBounds';

beforeAll(async () => {
  await Physics.init();
});

const hp = halfPipe({ radius: 3, length: 10, segments: 12 });

const SAMPLE: LevelData = {
  id: 'sample',
  name: '測試關卡',
  version: 1,
  primitives: [
    { id: 'floor', type: 'box', material: 'floor', pos: [0, -0.5, 0], size: [40, 1, 40] },
    { id: 'wall', type: 'box', material: 'wallrun', pos: [8, 3, 0], size: [1, 6, 12] },
    { id: 'rotated', type: 'box', material: 'cover', pos: [-8, 1, -8], size: [4, 2, 1], rot: [0, 30, 0] },
    { id: 'tilted', type: 'box', material: 'cover', pos: [-8, 3, 8], size: [2, 1, 3], rot: [20, 45, 10] },
    { id: 'ramp', type: 'ramp', material: 'slide', pos: [0, 0, -10], size: [4, 2, 8], thickness: 0.5 },
    { id: 'ramp-yaw', type: 'ramp', material: 'slide', pos: [12, 0, 12], size: [3, 1.5, 5], rot: [0, 90, 0] },
    { id: 'pillar', type: 'cylinder', material: 'grapple', pos: [5, 2, 10], size: [2, 4, 2] },
    { id: 'pipe', type: 'trimesh', material: 'platform', pos: [-15, 0, 0], vertices: hp.vertices, indices: hp.indices },
    { id: 'override', type: 'box', material: 'floor', pos: [15, 1, -15], size: [2, 2, 2], flags: { wallRunnable: true, surface: 'glass' } },
    { id: 'ghost', type: 'box', material: 'glass', pos: [0, 5, 5], size: [2, 0.2, 2], flags: { noCollide: true } },
    { id: 'invisible', type: 'box', material: 'wall', pos: [0, 2, 18], size: [10, 4, 0.5], flags: { noRender: true } },
  ],
  spawnPoints: [{ id: 'a', pos: [0, 0, 0], yaw: 0 }],
  checkpoints: [
    { id: 'c1', pos: [0, 0, 0], yaw: 0 },
    { id: 'c2', pos: [10, 0, 10], yaw: 90 },
    { id: 'gate-1', pos: [5, 2, 5], yaw: 0, course: 'run', order: 1, respawn: false },
    { id: 'gate-0', pos: [4, 2, 4], yaw: 0, course: 'run', order: 0, respawn: false },
  ],
  killVolumes: [{ id: 'void', pos: [0, -60, 0], size: [200, 60, 200] }],
  zones: [
    { id: 'z1', name: '區域一', pos: [0, 5, 0], size: [10, 10, 10], event: 'z1:enter' },
    { id: 'z2', name: '區域二', pos: [20, 5, 20], size: [10, 10, 10], spawn: { pos: [20, 0, 21], yaw: 90 } },
  ],
  labels: [{ text: '看板', pos: [0, 3, -3], yaw: 0 }],
};

describe('LevelData 驗證與查詢', () => {
  it('範例資料合法', () => {
    expect(validateLevelData(SAMPLE, Object.keys(GREYBOX_MATERIAL_TABLE))).toEqual([]);
  });

  it('列出不合法的欄位', () => {
    const bad: LevelData = {
      ...SAMPLE,
      version: 2 as 1,
      primitives: [
        { id: 'x', type: 'box', material: 'nope', pos: [0, 0, 0], size: [1, 0, 1] },
        { id: 'x', type: 'cylinder', material: 'floor', pos: [0, 0, 0], size: [1, 1, 2] },
        { type: 'trimesh', material: 'floor', pos: [0, 0, 0], vertices: [0, 0, 0, 1, 0, 0, 0, 1, 0], indices: [0, 1, 5] },
        { type: 'ramp', material: 'floor', pos: [0, Number.NaN, 0], size: [1, 1, 1] },
      ] as LevelPrimitive[],
      spawnPoints: [],
      zones: [{ id: 'z', name: '', pos: [0, 0, 0], size: [1, -1, 1] }],
    };
    const errors = validateLevelData(bad, Object.keys(GREYBOX_MATERIAL_TABLE)).join('\n');
    expect(errors).toMatch(/格式版本/);
    expect(errors).toMatch(/未知材質「nope」/);
    expect(errors).toMatch(/box size/);
    expect(errors).toMatch(/id 重複/);
    expect(errors).toMatch(/直徑必須相同/);
    expect(errors).toMatch(/indices 超出範圍/);
    expect(errors).toMatch(/pos 必須是 3 個有限數字/);
    expect(errors).toMatch(/至少需要一個 spawnPoint/);
    expect(errors).toMatch(/範圍不合法/);
    expect(errors).toMatch(/缺少名稱/);
    expect(() => buildLevel(bad)).toThrow(/資料不合法/);
  });

  it('區域、killVolume、檢查點查詢', () => {
    expect(boxContains([0, 0, 0], [2, 2, 2], { x: 1, y: -1, z: 0.5 })).toBe(true);
    expect(zoneAt(SAMPLE, { x: 1, y: 1, z: 1 })?.id).toBe('z1');
    expect(zoneAt(SAMPLE, { x: 100, y: 1, z: 1 })).toBeNull();
    expect(killVolumeAt(SAMPLE, { x: 0, y: -31, z: 0 })?.id).toBe('void');
    expect(killVolumeAt(SAMPLE, { x: 0, y: -29, z: 0 })).toBeNull();
    // 最近的重生點略過路線門（respawn = false）。
    expect(nearestCheckpoint(SAMPLE, { x: 5, y: 2, z: 5 })?.id).toBe('c1');
    expect(nearestCheckpoint(SAMPLE, { x: 9, y: -40, z: 9 })?.id).toBe('c2');
    expect(courseCheckpoints(SAMPLE, 'run').map((c) => c.id)).toEqual(['gate-0', 'gate-1']);
    expect(zoneSpawn(SAMPLE.zones[0]!)).toEqual({ pos: [0, 0, 0], yaw: 0 });
    expect(zoneSpawn(SAMPLE.zones[1]!).yaw).toBe(90);
  });
});

describe('LevelBuilder', () => {
  it('同一份資料產生的碰撞體與網格包圍盒一致（box、旋轉 box、ramp、cylinder、trimesh）', () => {
    const physics = new Physics();
    const build = buildLevel(SAMPLE, { physics });
    for (const p of build.primitives) {
      if (!p.collider) continue;
      const cb = colliderBounds(physics, p.collider);
      // 圓柱的線框是多邊形近似，容差放寬到半徑的 2%。
      const tol = p.def.type === 'cylinder' ? p.def.size[0] * 0.02 : 1e-3;
      for (const axis of ['x', 'y', 'z'] as const) {
        expect(Math.abs(cb.min[axis] - p.bounds.min[axis]), `${p.id} min.${axis}`).toBeLessThan(tol);
        expect(Math.abs(cb.max[axis] - p.bounds.max[axis]), `${p.id} max.${axis}`).toBeLessThan(tol);
      }
    }
    physics.dispose();
    build.dispose();
  });

  it('raycast 命中正確的 collider 並查得到表面旗標（材質預設與 flags 覆寫）', () => {
    const physics = new Physics();
    const build = buildLevel(SAMPLE, { physics });
    const byId = new Map(build.primitives.map((p) => [p.id, p]));

    const wallHit = physics.raycast({ x: 0, y: 2, z: 0 }, { x: 1, y: 0, z: 0 }, 50);
    expect(wallHit!.collider.handle).toBe(byId.get('wall')!.collider!.handle);
    expect(wallHit!.point.x).toBeCloseTo(7.5, 4);
    expect(wallHit!.surface).toMatchObject({ wallRunnable: true, grappleable: false, surface: 'metal', owner: 'wall' });

    const pillarHit = physics.raycast({ x: 5, y: 10, z: 10 }, { x: 0, y: -1, z: 0 }, 50);
    expect(pillarHit!.surface).toMatchObject({ owner: 'pillar', grappleable: true });
    expect(pillarHit!.point.y).toBeCloseTo(4, 4);

    const overrideHit = physics.raycast({ x: 15, y: 10, z: -15 }, { x: 0, y: -1, z: 0 }, 50);
    expect(overrideHit!.surface).toMatchObject({ owner: 'override', wallRunnable: true, surface: 'glass' });

    const floorHit = physics.raycast({ x: 2, y: 10, z: 2 }, { x: 0, y: -1, z: 0 }, 50);
    expect(floorHit!.surface).toMatchObject({ owner: 'floor', surface: 'concrete', wallRunnable: false });

    // noCollide 的玻璃板不擋射線（往下打到地板）；noRender 的隱形牆有碰撞、沒有網格。
    const ghost = physics.raycast({ x: 0, y: 10, z: 5 }, { x: 0, y: -1, z: 0 }, 50);
    expect(ghost!.surface?.owner).toBe('floor');
    expect(byId.get('ghost')!.collider).toBeNull();
    const inv = physics.raycast({ x: 0, y: 2, z: 10 }, { x: 0, y: 0, z: 1 }, 50);
    expect(inv!.surface?.owner).toBe('invisible');
    expect(build.meshes.some((m) => m.name.endsWith(':wall'))).toBe(false);
    physics.dispose();
    build.dispose();
  });

  it('ramp：坡面中點高度 = rise/2、法線傾角 = atan(rise/run)；yaw 90° 時往 -X 上升', () => {
    const physics = new Physics();
    const build = buildLevel(SAMPLE, { physics });
    const hit = physics.raycast({ x: 0, y: 10, z: -10 }, { x: 0, y: -1, z: 0 }, 50);
    expect(hit!.surface?.owner).toBe('ramp');
    expect(hit!.point.y).toBeCloseTo(1, 3);
    const { angle } = rampGeometry({ size: [4, 2, 8] });
    expect(Math.acos(hit!.normal.y)).toBeCloseTo(angle, 3);
    expect(hit!.normal.z).toBeGreaterThan(0); // 坡往 -Z 上升，法線朝 +Z 傾
    // 坡底（+Z 端）幾乎在地面、坡頂（-Z 端）接近 rise。
    const low = physics.raycast({ x: 0, y: 10, z: -6.2 }, { x: 0, y: -1, z: 0 }, 50)!;
    expect(low.surface?.owner).toBe('ramp');
    expect(low.point.y).toBeCloseTo(0.2 * Math.tan(angle), 2);
    const high = physics.raycast({ x: 0, y: 10, z: -13.8 }, { x: 0, y: -1, z: 0 }, 50)!;
    expect(high.point.y).toBeCloseTo(2 - 0.2 * Math.tan(angle), 2);
    // yaw 90°：local -Z 轉向世界 -X。
    // 結果物件會重複使用，先把數值取出來。
    const west = physics.raycast({ x: 11, y: 10, z: 12 }, { x: 0, y: -1, z: 0 }, 50)!;
    expect(west.surface?.owner).toBe('ramp-yaw');
    const westY = west.point.y;
    const eastY = physics.raycast({ x: 13, y: 10, z: 12 }, { x: 0, y: -1, z: 0 }, 50)!.point.y;
    expect(westY).toBeGreaterThan(eastY);
    physics.dispose();
    build.dispose();
  });

  it('trimesh 半管：弧底在 y = 0、上緣平台在 radius + lipHeight', () => {
    const physics = new Physics();
    const build = buildLevel(SAMPLE, { physics });
    const bottom = physics.raycast({ x: -15, y: 10, z: 0 }, { x: 0, y: -1, z: 0 }, 50)!;
    expect(bottom.surface?.owner).toBe('pipe');
    expect(bottom.point.y).toBeCloseTo(0, 2);
    const lip = physics.raycast({ x: -15 + 3 + 0.7, y: 10, z: 0 }, { x: 0, y: -1, z: 0 }, 50)!;
    expect(lip.point.y).toBeCloseTo(3.5, 3);
    // 弧面中段：法線指向圓心。
    const mid = physics.raycast({ x: -15 + 2, y: 10, z: 0 }, { x: 0, y: -1, z: 0 }, 50)!;
    expect(mid.point.y).toBeCloseTo(3 - Math.sqrt(9 - 4), 1);
    expect(mid.normal.x).toBeLessThan(0);
    physics.dispose();
    build.dispose();
  });

  it('網格依材質合併：每個材質一個 Mesh，noRender 不出網格；看板交給外觀來源', () => {
    const build = buildLevel(SAMPLE);
    const rendered = new Set(SAMPLE.primitives.filter((p) => !p.flags?.noRender).map((p) => p.material));
    expect(build.meshes).toHaveLength(rendered.size);
    expect(build.stats.meshes).toBe(rendered.size);
    expect(build.colliders).toHaveLength(0); // 沒有給 physics
    expect(build.labels).toHaveLength(0); // PlainVisuals 沒有看板
    expect(build.stats.triangles).toBeGreaterThan(0);
    for (const m of build.meshes) expect(m.matrixAutoUpdate).toBe(false);
    // 合併網格的包圍盒涵蓋該材質所有基本體。
    const slide = build.meshes.find((m) => m.name.endsWith(':slide'))!;
    for (const p of build.primitives.filter((q) => q.def.material === 'slide')) {
      expect(slide.geometry.boundingBox!.containsBox(p.bounds)).toBe(true);
    }
    build.dispose();
  });

  it('格線 UV 以公尺計且與世界對齊：未旋轉的地板 u = x / tileMeters', () => {
    const geo = primitiveWorldGeometry(
      { type: 'box', material: 'floor', pos: [3, -0.5, 7], size: [10, 1, 10] },
      GREYBOX_CONFIG.tileMeters,
    );
    const pos = geo.getAttribute('position');
    const nrm = geo.getAttribute('normal');
    const uv = geo.getAttribute('uv');
    let checked = 0;
    for (let i = 0; i < pos.count; i++) {
      if (nrm.getY(i) > 0.99) {
        expect(uv.getX(i) * GREYBOX_CONFIG.tileMeters).toBeCloseTo(pos.getX(i), 5);
        expect(uv.getY(i) * GREYBOX_CONFIG.tileMeters).toBeCloseTo(pos.getZ(i), 5);
        checked++;
      }
    }
    expect(checked).toBe(4);
    // 斜坡的 UV 沿坡面量測：坡面兩端的 v 差 = 坡長 / tileMeters。
    const ramp = primitiveWorldGeometry({ type: 'ramp', material: 'slide', pos: [0, 0, 0], size: [2, 3, 4] }, 1);
    const rp = ramp.getAttribute('normal');
    const ruv = ramp.getAttribute('uv');
    const vs: number[] = [];
    for (let i = 0; i < rp.count; i++) if (rp.getY(i) > 0.5) vs.push(ruv.getY(i));
    expect(Math.max(...vs) - Math.min(...vs)).toBeCloseTo(5, 4);
  });

  it('dispose：移除碰撞體與表面登記、從場景移除；世界重建後 dispose 不影響新世界', () => {
    const physics = new Physics();
    const scene = new THREE.Scene();
    const build = buildLevel(SAMPLE, { physics });
    scene.add(build.root);
    expect(physics.world.colliders.len()).toBe(build.colliders.length);
    expect(physics.surfaces.size).toBe(build.colliders.length);
    build.dispose();
    expect(physics.world.colliders.len()).toBe(0);
    expect(physics.surfaces.size).toBe(0);
    expect(scene.children).toHaveLength(0);

    const again = buildLevel(SAMPLE, { physics });
    physics.resetWorld();
    const fresh = buildLevel(SAMPLE, { physics });
    again.dispose(); // 舊代：忽略
    expect(physics.world.colliders.len()).toBe(fresh.colliders.length);
    fresh.dispose();
    physics.dispose();
  });

  it('PlainVisuals：同一個材質 id 回傳同一個材質', () => {
    const v = new PlainVisuals();
    expect(v.material('floor')).toBe(v.material('floor'));
    expect(v.material('floor')).not.toBe(v.material('wall'));
    v.dispose();
  });
});

describe('灰盒格線貼圖', () => {
  it('1 m 細線與 5 m 粗線落在正確的像素', () => {
    const cfg = { ...GREYBOX_CONFIG, textureSize: 500, tileMeters: 5, fineLinePx: 2, boldLinePx: 6 };
    // 每公尺 100 px：細線在 100、200…；粗線在 0（＝500，貼圖邊緣）。
    expect(gridCoverageAt(100, cfg).fine).toBeGreaterThan(0.9);
    expect(gridCoverageAt(150, cfg).fine).toBe(0);
    expect(gridCoverageAt(0, cfg).bold).toBe(1);
    expect(gridCoverageAt(499, cfg).bold).toBe(1);
    expect(gridCoverageAt(250, cfg).bold).toBe(0);
    const px = makeGridPixels(cfg);
    expect(px.length).toBe(500 * 500 * 4);
    const at = (x: number, y: number): number => px[(y * 500 + x) * 4]!;
    expect(at(150, 150)).toBe(Math.round(cfg.baseLevel * 255));
    expect(at(100, 150)).toBeGreaterThan(at(150, 150));
    expect(at(0, 150)).toBe(Math.round(cfg.boldLevel * 255));
    expect(px[3]).toBe(255);
  });
});
