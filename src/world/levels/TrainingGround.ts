// 灰盒訓練場（約 160 × 160 m，地面頂面 y = 0，-Z 為北）。所有數值都是 LevelData，M1-09 套正式材質。
//
// 分區（x 由西到東、z 由北到南）：
//   靶場          x[-80,-46]  射擊線 z = 40，10／25／50／75 m 標線，北端擋牆
//   跑牆長廊      x[-46,-22]  z[30,-10]：兩面平行牆（長 40 m、高 6 m、內距 6 m）
//   Z 字牆板      x[-46,-22]  z[-18,-70]：深坑（無底，y < -30 回到檢查點）上方的交錯牆板
//   中央廣場      x[-22,20]   z[0,40]
//   出生平台      x[-22,20]   z[40,80]：出生平台與看板
//   滑鏟長坡      x[-22,0]    z[-5,-56]：15°、長 40 m，坡頂平台高約 10.35 m
//   半管          x[0,20]     z[-5,-45]：半徑 5 m、長 40 m（trimesh）
//   攀爬測試牆    x[20,80]    z[50,80]：0.8／1.2／2.0／3.0／4.0 m
//   浮台群        x[20,80]    z[24,50]：高 3 m，間距 4／7／10／14 m
//   無人機戰區    x[20,80]    z[-34,24]：開放空間 + 掩體（M1-12）
//   高塔          x[20,80]    z[-34,-80]：20／30／40 m，塔頂與塔間為抓鉤練習區
import type {
  Checkpoint,
  CylinderPrimitive,
  LevelData,
  LevelLabel,
  LevelPrimitive,
  PrimitiveFlags,
  Vec3Tuple,
  Zone,
} from '@/world/LevelData';
import type { GreyboxMaterialId } from '@/world/Greybox';
import { DataLevel } from '@/world/Level';
import { halfPipe } from '@/world/LevelShapes';

export const TRAINING_GROUND_ID = 'training-ground';

/** 由兩個角點建立軸對齊 box。 */
function boxMinMax(
  id: string,
  material: GreyboxMaterialId,
  min: Vec3Tuple,
  max: Vec3Tuple,
  flags?: PrimitiveFlags,
): LevelPrimitive {
  return {
    id,
    type: 'box',
    material,
    pos: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2],
    size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]],
    ...(flags ? { flags } : {}),
  };
}

/** 地板磚（頂面 y = 0、厚 1 m）。 */
function floor(id: string, material: GreyboxMaterialId, x0: number, x1: number, z0: number, z1: number): LevelPrimitive {
  return boxMinMax(id, material, [x0, -1, z0], [x1, 0, z1]);
}

/** 站在地面上的 box（底面 y = base）。 */
function block(
  id: string,
  material: GreyboxMaterialId,
  x: number,
  z: number,
  size: Vec3Tuple,
  yawDeg = 0,
  base = 0,
  flags?: PrimitiveFlags,
): LevelPrimitive {
  return {
    id,
    type: 'box',
    material,
    pos: [x, base + size[1] / 2, z],
    size,
    ...(yawDeg ? { rot: [0, yawDeg, 0] as Vec3Tuple } : {}),
    ...(flags ? { flags } : {}),
  };
}

function pillar(id: string, material: GreyboxMaterialId, x: number, z: number, diameter: number, height: number, base = 0): CylinderPrimitive {
  return { id, type: 'cylinder', material, pos: [x, base + height / 2, z], size: [diameter, height, diameter] };
}

/** 15° × 40 m 的滑鏟坡。 */
export const SLIDE_SLOPE = (() => {
  const angleDeg = 15;
  const length = 40;
  const a = (angleDeg * Math.PI) / 180;
  return { angleDeg, length, rise: length * Math.sin(a), run: length * Math.cos(a), lowZ: -5, x: -8, width: 12 };
})();

export const CLIMB_WALL_HEIGHTS = [0.8, 1.2, 2.0, 3.0, 4.0] as const;
export const PLATFORM_GAPS = [4, 7, 10, 14] as const;
export const TOWER_HEIGHTS = [20, 30, 40] as const;
export const PLATFORM_TOP = 3;
export const RANGE_DISTANCES = [10, 25, 50, 75] as const;
export const RANGE_FIRING_LINE_Z = 40;
export const RANGE_LANE_X = -64;
export const KILL_Y = -30;

function buildPrimitives(): LevelPrimitive[] {
  const P: LevelPrimitive[] = [];

  // ── 地板（各區不同底色；中間挖出深坑 x[-46,-22] z[-70,-18]）──
  P.push(
    floor('floor-range', 'range', -80, -46, -80, 80),
    floor('floor-wallrun', 'wallrun', -46, -22, -18, 80),
    floor('floor-pit-end', 'wallrun', -46, -22, -80, -70),
    floor('floor-spawn', 'spawn', -22, 20, 40, 80),
    floor('floor-slide', 'slide', -22, 20, -80, 40),
    floor('floor-climb', 'climb', 20, 80, 50, 80),
    floor('floor-platform', 'platform', 20, 80, 24, 50),
    floor('floor-arena', 'arena', 20, 80, -34, 24),
    floor('floor-tower', 'tower', 20, 80, -80, -34),
  );
  // 外牆（高 12 m，可跑牆、可抓鉤）。
  P.push(
    boxMinMax('wall-north', 'wall', [-82, -1, -82], [82, 12, -80]),
    boxMinMax('wall-south', 'wall', [-82, -1, 80], [82, 12, 82]),
    boxMinMax('wall-west', 'wall', [-82, -1, -80], [-80, 12, 80]),
    boxMinMax('wall-east', 'wall', [80, -1, -80], [82, 12, 80]),
  );
  // 深坑內壁（往下 24 m，看得出深度；無底）。
  P.push(
    boxMinMax('pit-liner-n', 'pit', [-46, -25, -71], [-22, -1, -70]),
    boxMinMax('pit-liner-s', 'pit', [-46, -25, -18], [-22, -1, -17]),
    boxMinMax('pit-liner-w', 'pit', [-47, -25, -70], [-46, -1, -18]),
    boxMinMax('pit-liner-e', 'pit', [-22, -25, -70], [-21, -1, -18]),
  );
  // 坑緣警示條（裝飾，無碰撞）。
  P.push(
    boxMinMax('pit-edge-s', 'hazard', [-46, 0, -18.6], [-22, 0.03, -18], { noCollide: true }),
    boxMinMax('pit-edge-n', 'hazard', [-46, 0, -70], [-22, 0.03, -69.4], { noCollide: true }),
  );

  // ── 出生平台 ──
  P.push(block('spawn-pad', 'spawn', 0, 62, [12, 0.3, 12]));
  P.push(pillar('spawn-board-post-l', 'spawn', -5.5, 46, 0.4, 5), pillar('spawn-board-post-r', 'spawn', 5.5, 46, 0.4, 5));

  // ── 靶場 ──
  const fz = RANGE_FIRING_LINE_Z;
  P.push(
    boxMinMax('range-line-fire', 'marker', [-78, 0, fz - 0.2], [-50, 0.03, fz + 0.2], { noCollide: true }),
    ...RANGE_DISTANCES.map((d) =>
      boxMinMax(`range-line-${d}`, 'marker', [-78, 0, fz - d - 0.15], [-50, 0.03, fz - d + 0.15], { noCollide: true }),
    ),
  );
  P.push(
    block('range-counter-w', 'range', -71, fz + 1, [10, 1.1, 0.6]),
    block('range-counter-e', 'range', -57, fz + 1, [10, 1.1, 0.6]),
    boxMinMax('range-divider', 'range', [-50.5, 0, -42], [-49.5, 4, fz - 2]),
    boxMinMax('range-backstop', 'range', [-80, 0, -46], [-46, 10, -43]),
  );

  // ── 跑牆長廊（長 40 m、高 6 m、內距 6 m）──
  P.push(
    boxMinMax('wallrun-wall-w', 'wallrun', [-38, 0, -10], [-37, 6, 30]),
    boxMinMax('wallrun-wall-e', 'wallrun', [-31, 0, -10], [-30, 6, 30]),
  );
  // ── Z 字牆板（深坑上方，左右交錯、各偏 20°）──
  for (let i = 0; i < 5; i++) {
    const left = i % 2 === 0;
    P.push({
      id: `zigzag-${i}`,
      type: 'box',
      material: 'wallrun',
      pos: [left ? -39 : -29, 2.5, -24 - i * 9.5],
      size: [0.6, 9, 9],
      rot: [0, left ? 20 : -20, 0],
    });
  }

  // ── 滑鏟長坡與坡頂平台 ──
  const s = SLIDE_SLOPE;
  P.push({
    id: 'slide-ramp',
    type: 'ramp',
    material: 'slide',
    pos: [s.x, 0, s.lowZ - s.run / 2],
    size: [s.width, s.rise, s.run],
    thickness: 0.6,
  });
  P.push(boxMinMax('slide-deck', 'slide', [s.x - s.width / 2, 0, -56], [s.x + s.width / 2, s.rise, s.lowZ - s.run]));
  // ── 半管（trimesh）──
  const hp = halfPipe({ radius: 5, length: 40, lip: 1.5, lipHeight: 0.5, sink: 0.5, segments: 16 });
  P.push({ id: 'halfpipe', type: 'trimesh', material: 'slide', pos: [9, 0, -25], vertices: hp.vertices, indices: hp.indices });

  // ── 攀爬測試牆 ──
  CLIMB_WALL_HEIGHTS.forEach((h, i) => {
    P.push(block(`climb-${h}`, 'climb', 30 + i * 10, 62, [6, h, 2]));
  });

  // ── 浮台群（頂面 y = 3，厚 1 m）──
  P.push({ id: 'platform-ramp', type: 'ramp', material: 'platform', pos: [26.5, 0, 40], size: [5, PLATFORM_TOP, 8] });
  P.push(boxMinMax('platform-start', 'platform', [24, PLATFORM_TOP - 1, 30], [29, PLATFORM_TOP, 36]));
  let x = 29;
  PLATFORM_GAPS.forEach((gap, i) => {
    x += gap;
    P.push(boxMinMax(`platform-${i + 1}`, 'platform', [x, PLATFORM_TOP - 1, 30], [x + 3, PLATFORM_TOP, 36]));
    x += 3;
  });

  // ── 無人機戰區：低掩體、柱子、高牆 ──
  const covers: [number, number, number][] = [
    [30, -20, 0],
    [42, -8, 30],
    [55, -22, -15],
    [66, -6, 0],
    [36, 10, -30],
    [50, 4, 90],
    [62, 14, 20],
    [72, -26, 45],
  ];
  covers.forEach(([cx, cz, yaw], i) => P.push(block(`arena-cover-${i}`, 'cover', cx, cz, [4, 1.2, 1], yaw)));
  P.push(
    pillar('arena-pillar-0', 'cover', 46, -16, 2.4, 5),
    pillar('arena-pillar-1', 'cover', 58, 6, 2.4, 5),
    pillar('arena-pillar-2', 'cover', 34, -4, 2.4, 5),
    pillar('arena-pillar-3', 'cover', 70, 6, 2.4, 5),
    block('arena-wall-0', 'cover', 52, -30, [10, 4, 1]),
    block('arena-wall-1', 'cover', 40, 18, [1, 4, 8]),
  );

  // ── 高塔（6 × 6 m）與抓鉤練習 ──
  const towers: [number, number, number][] = [
    [32, -50, TOWER_HEIGHTS[0]],
    [50, -62, TOWER_HEIGHTS[1]],
    [68, -48, TOWER_HEIGHTS[2]],
  ];
  towers.forEach(([tx, tz, h]) => {
    P.push(block(`tower-${h}`, 'tower', tx, tz, [6, h, 6]));
    // 塔頂抓鉤柱。
    P.push(pillar(`tower-${h}-anchor`, 'grapple', tx, tz, 0.8, 2.5, h));
  });
  // 塔間懸空抓鉤點（無支撐）。
  P.push(
    block('grapple-float-0', 'grapple', 41, -57, [2, 1, 2], 0, 25),
    block('grapple-float-1', 'grapple', 59, -55, [2, 1, 2], 0, 35),
    block('grapple-float-2', 'grapple', 50, -44, [2, 1, 2], 0, 15),
  );
  return P;
}

function buildLabels(): LevelLabel[] {
  const fz = RANGE_FIRING_LINE_Z;
  const L: LevelLabel[] = [
    { text: '碎晶航跡 SHARDWAKE', sub: '訓練場（灰盒）', pos: [0, 6, 46], yaw: 0, height: 1.4, color: 0x9ff4ff },
    { text: '靶場', sub: '10／25／50／75 m', pos: [RANGE_LANE_X, 7, fz + 4], yaw: 0, height: 1.4 },
    { text: '射擊線', pos: [-75, 1.4, fz - 0.5], yaw: 0, height: 0.6, color: 0xffc080 },
    ...RANGE_DISTANCES.map(
      (d): LevelLabel => ({ text: `${d} m`, pos: [-75, 1.4, fz - d], yaw: 0, height: 0.8, color: 0xffc080 }),
    ),
    { text: '跑牆長廊', sub: '長 40 m・高 6 m', pos: [-34, 8, 31], yaw: 0, height: 1.2 },
    { text: 'Z 字牆板', sub: '下方深坑：掉落會回到檢查點', pos: [-34, 8, -16], yaw: 0, height: 1.2 },
    { text: '滑鏟長坡', sub: '15°・40 m', pos: [SLIDE_SLOPE.x, 4.5, -3], yaw: 0, height: 1.1 },
    { text: '半管', sub: '半徑 5 m', pos: [9, 8, -3], yaw: 0, height: 1.1 },
    { text: '攀爬測試牆', pos: [50, 7.5, 62], yaw: 0, height: 1.2 },
    ...CLIMB_WALL_HEIGHTS.map(
      (h, i): LevelLabel => ({ text: `${h.toFixed(1)} m`, pos: [30 + i * 10, h + 0.9, 63.2], yaw: 0, height: 0.7 }),
    ),
    { text: '浮台群', sub: '間距 4／7／10／14 m（二段跳或 Dash）', pos: [50, 9, 33], yaw: 0, height: 1.2 },
    { text: '無人機戰區', pos: [50, 7, 23], yaw: 0, height: 1.4 },
    { text: '高塔', sub: '20／30／40 m・頂端抓鉤練習', pos: [50, 7, -35], yaw: 0, height: 1.3 },
  ];
  let x = 29;
  PLATFORM_GAPS.forEach((gap) => {
    x += gap;
    L.push({ text: `${gap} m`, pos: [x + 1.5, PLATFORM_TOP + 1.6, 36.2], yaw: 0, height: 0.7 });
    x += 3;
  });
  ([
    [32, -50, TOWER_HEIGHTS[0]],
    [50, -62, TOWER_HEIGHTS[1]],
    [68, -48, TOWER_HEIGHTS[2]],
  ] as const).forEach(([tx, tz, h]) => L.push({ text: `${h} m`, pos: [tx, 3, tz + 3.1], yaw: 0, height: 0.9 }));
  return L;
}

/** 各分區（傳送、計時賽、無人機戰區使用）。zoneAt 取第一個符合者，所以塔頂排在高塔前面。 */
export const TRAINING_ZONES: readonly Zone[] = [
  { id: 'spawn', name: '出生平台', pos: [-1, 10, 60], size: [42, 24, 40], spawn: { pos: [0, 0.3, 62], yaw: 0 } },
  { id: 'hub', name: '中央廣場', pos: [-1, 10, 20], size: [42, 24, 40], spawn: { pos: [0, 0, 22], yaw: 0 } },
  { id: 'range', name: '靶場', pos: [-63, 10, 2], size: [34, 24, 96], event: 'range:enter', spawn: { pos: [RANGE_LANE_X, 0, 44], yaw: 0 } },
  { id: 'wallrun', name: '跑牆長廊', pos: [-34, 10, 13], size: [24, 24, 54], spawn: { pos: [-34, 0, 36], yaw: 0 } },
  { id: 'zigzag', name: 'Z 字牆板與深坑', pos: [-34, 0, -47], size: [24, 60, 66], spawn: { pos: [-34, 0, -15], yaw: 0 } },
  { id: 'slide', name: '滑鏟長坡', pos: [-11, 12, -40], size: [22, 26, 80], spawn: { pos: [SLIDE_SLOPE.x, SLIDE_SLOPE.rise, -50], yaw: 180 } },
  { id: 'halfpipe', name: '半管', pos: [10, 12, -40], size: [20, 26, 80], spawn: { pos: [9, 0, -1], yaw: 0 } },
  { id: 'climb', name: '攀爬測試牆', pos: [50, 10, 65], size: [60, 24, 30], spawn: { pos: [50, 0, 70], yaw: 0 } },
  { id: 'platforms', name: '浮台群', pos: [50, 10, 37], size: [60, 24, 26], spawn: { pos: [26.5, 0, 46], yaw: 0 } },
  { id: 'arena', name: '無人機戰區', pos: [50, 15, -5], size: [60, 34, 58], event: 'arena:enter', spawn: { pos: [50, 0, 22], yaw: 0 } },
  { id: 'tower-top', name: '塔頂抓鉤區', pos: [50, 35, -57], size: [60, 32, 46], event: 'grapple:enter', spawn: { pos: [32, TOWER_HEIGHTS[0], -51], yaw: 0 } },
  { id: 'towers', name: '高塔', pos: [50, 8.5, -57], size: [60, 21, 46], spawn: { pos: [50, 0, -38], yaw: 0 } },
];

/** 重生檢查點（每區一個）與跑酷路線（course 'parkour'，M1-15 計時賽使用）。 */
export const TRAINING_CHECKPOINTS: readonly Checkpoint[] = [
  { id: 'cp-spawn', pos: [0, 0.3, 62], yaw: 0 },
  { id: 'cp-hub', pos: [0, 0, 22], yaw: 0 },
  { id: 'cp-range', pos: [RANGE_LANE_X, 0, 44], yaw: 0 },
  { id: 'cp-wallrun', pos: [-34, 0, 36], yaw: 0 },
  { id: 'cp-pit', pos: [-34, 0, -15], yaw: 0 },
  { id: 'cp-slide', pos: [SLIDE_SLOPE.x, SLIDE_SLOPE.rise, -50], yaw: 180 },
  { id: 'cp-halfpipe', pos: [9, 0, -1], yaw: 0 },
  { id: 'cp-climb', pos: [50, 0, 70], yaw: 0 },
  { id: 'cp-platforms', pos: [26.5, 0, 46], yaw: 0 },
  { id: 'cp-arena', pos: [50, 0, 22], yaw: 0 },
  { id: 'cp-towers', pos: [50, 0, -38], yaw: 0 },
  // 跑酷路線：出生 → 跑牆長廊 → Z 字牆板 → 坡頂 → 滑下 → 半管 → 高塔 → 浮台 → 終點。
  ...(
    [
      ['start', [0, 1.5, 52], 0],
      ['wallrun-in', [-34, 2.5, 29], 0],
      ['wallrun-out', [-34, 2.5, -9], 0],
      ['zigzag-out', [-34, 2.5, -73], 90],
      ['slide-top', [SLIDE_SLOPE.x, SLIDE_SLOPE.rise + 1.5, -50], 180],
      ['slide-bottom', [SLIDE_SLOPE.x, 1.5, -1], -90],
      ['halfpipe-end', [9, 2, -44], -90],
      ['tower-20', [32, TOWER_HEIGHTS[0] + 1.5, -50], 180],
      ['platform-start', [26.5, PLATFORM_TOP + 1.5, 33], -90],
      ['platform-end', [74.5, PLATFORM_TOP + 1.5, 33], 180],
      ['finish', [50, 1.5, 56], 0],
    ] as const
  ).map(
    ([id, pos, yaw], order): Checkpoint => ({
      id: `parkour-${id}`,
      pos,
      yaw,
      radius: 3,
      course: 'parkour',
      order,
      respawn: false,
    }),
  ),
];

export function createTrainingGroundData(): LevelData {
  return {
    id: TRAINING_GROUND_ID,
    name: '訓練場',
    version: 1,
    primitives: buildPrimitives(),
    spawnPoints: [{ id: 'spawn', pos: [0, 0.3, 62], yaw: 0 }],
    checkpoints: TRAINING_CHECKPOINTS,
    killVolumes: [{ id: 'void', pos: [0, KILL_Y - 30, 0], size: [400, 60, 400] }],
    zones: TRAINING_ZONES,
    labels: buildLabels(),
  };
}

/** 訓練場關卡。 */
export class TrainingGround extends DataLevel {
  constructor() {
    super(createTrainingGroundData());
  }
}
