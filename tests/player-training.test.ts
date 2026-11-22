// M1-05：玩家控制器在灰盒訓練場（M1-04）的整合測試：出生平台、滑鏟長坡、半管 trimesh、深坑重生。
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Physics } from '@/physics/Physics';
import { MOVEMENT_CONFIG } from '@/player/MovementConfig';
import { SLIDE_SLOPE, createTrainingGroundData } from '@/world/levels/TrainingGround';
import { MovementSim } from './helpers/movementSim';

beforeAll(async () => {
  await Physics.init();
});

const sims: MovementSim[] = [];
function training(spawn: [number, number, number], yawDeg = 0): MovementSim {
  const data = createTrainingGroundData();
  const s = new MovementSim({
    primitives: data.primitives,
    checkpoints: data.checkpoints,
    killVolumes: data.killVolumes,
    spawn: { pos: spawn, yaw: (yawDeg * Math.PI) / 180 },
  });
  sims.push(s);
  return s;
}
afterEach(() => {
  for (const s of sims.splice(0)) s.dispose();
});

describe('訓練場', () => {
  it('站在出生平台（高 0.3 m）；走下平台再走回去（autostep）', () => {
    const s = training([0, 0.3, 62]);
    s.settle();
    expect(s.player.grounded).toBe(true);
    expect(s.player.position.y).toBeGreaterThan(0.3);
    expect(s.player.position.y).toBeLessThan(0.35);
    // 往前（-Z）走出平台邊緣（z = 56）到地面。
    s.input.down('moveForward');
    s.runUntil((x) => x.player.position.z < 53, 3);
    s.run(0.2);
    expect(s.player.position.y).toBeLessThan(0.05);
    // 回頭走上平台。
    s.input.setYaw(Math.PI);
    s.runUntil((x) => x.player.position.z > 59, 3);
    expect(s.player.position.y).toBeGreaterThan(0.29);
    expect(s.eventsNamed('player:respawn')).toHaveLength(0);
  });

  it('滑鏟長坡：從坡頂衝下並滑鏟，一路加速到坡底', () => {
    const s = training([SLIDE_SLOPE.x, SLIDE_SLOPE.rise, -50], 180);
    s.settle();
    s.input.down('moveForward');
    s.runUntil((x) => x.player.grounded && x.player.groundNormal.y < 0.98, 3);
    s.input.up('moveForward').down('crouch');
    s.step();
    expect(s.state).toBe('slide');
    const v0 = s.speed;
    let maxSpeed = v0;
    const t = s.runUntil((x) => {
      maxSpeed = Math.max(maxSpeed, x.speed);
      return x.player.position.z > SLIDE_SLOPE.lowZ;
    }, 6);
    expect(t).not.toBeNull();
    expect(maxSpeed).toBeGreaterThan(v0 + 5);
    expect(s.state).toBe('slide');
    // 坡底仍貼地（坡面轉平地不騰空太久）。
    s.run(0.3);
    expect(s.player.position.y).toBeLessThan(0.1);
  });

  it('半管 trimesh：沿管底跑過整段不會卡住或穿過', () => {
    const s = training([9, 0, -1]);
    s.settle();
    s.input.down('moveForward');
    let minY = Infinity;
    let stalls = 0;
    let prevZ = s.player.position.z;
    s.runUntil((x) => {
      minY = Math.min(minY, x.player.position.y);
      if (prevZ - x.player.position.z < 0.5 * MOVEMENT_CONFIG.sprintSpeed * x.dt) stalls++;
      prevZ = x.player.position.z;
      return x.player.position.z < -40;
    }, 8);
    expect(s.player.position.z).toBeLessThan(-40);
    expect(minY).toBeGreaterThan(-0.6);
    // 進入管口時會減速一下（爬過管緣），之後順暢。
    expect(stalls).toBeLessThan(40);
  });

  it('半管：橫向衝上管壁再滑回管底', () => {
    const s = training([9, -0.4, -25], 90);
    s.settle();
    s.input.down('moveForward');
    s.run(0.6);
    s.input.up('moveForward');
    s.run(2);
    expect(s.player.position.y).toBeGreaterThan(-0.6);
    expect(Math.abs(s.player.position.x - 9)).toBeLessThan(5);
  });

  it('掉進深坑回到坑口檢查點', () => {
    const s = training([-34, 0, -15], 0);
    s.settle();
    s.input.down('moveForward');
    const t = s.runUntil((x) => x.eventsNamed('player:respawn').length > 0, 6);
    expect(t).not.toBeNull();
    expect(s.player.position.distanceTo({ x: -34, y: 0, z: -15 } as never)).toBeLessThan(0.1);
    expect(s.player.velocity.length()).toBe(0);
  });
});
