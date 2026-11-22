// M1-08 鏡頭手感：FOV 換算與動態 FOV、彈簧與畫面更新率無關、傾斜、落地、頭部晃動、震動、速度線、全部關閉時鏡頭穩定。
import * as THREE from 'three';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { CAMERA_CONFIG, CAMERA_PANEL, defaultCameraConfig, type CameraConfig } from '@/camera/CameraConfig';
import {
  FovKicks,
  Trauma,
  dashRollImpulse,
  headBob,
  heavyLandingTrauma,
  kickEnvelope,
  landingDipAmount,
  resolveFov,
  rollTarget,
  speedFovBonus,
  speedLinesTarget,
  springImpulseForPeak,
  springPeakPerVelocity,
  traumaFalloff,
} from '@/camera/cameraMath';
import { CameraRig, type CameraPlayerState, type CameraSettings } from '@/camera/CameraRig';
import { EventBus } from '@/core/EventBus';
import type { GameEvents } from '@/core/events';
import { SpringScalar, horizontalToVerticalFov, verticalToHorizontalFov } from '@/core/math';
import { SETTINGS_SCHEMA, defaultSettings } from '@/core/Settings';
import { SPEED_LINES_CONFIG, SPEED_LINES_PANEL, SpeedLines } from '@/fx/SpeedLines';
import { Physics } from '@/physics/Physics';
import { MOVEMENT_CONFIG } from '@/player/MovementConfig';
import { MovementSim, boxMinMax, floorBox } from './helpers/movementSim';

const D = Math.PI / 180;

/** 可改寫的假玩家狀態。 */
interface FakePlayer extends CameraPlayerState {
  position: THREE.Vector3;
  previousPosition: THREE.Vector3;
  velocity: THREE.Vector3;
  wallNormal: THREE.Vector3;
  state: string;
  grounded: boolean;
  eyeHeight: number;
  previousEyeHeight: number;
  speed: number;
}

function fakePlayer(overrides: Partial<FakePlayer> = {}): FakePlayer {
  return {
    position: new THREE.Vector3(0, 0, 0),
    previousPosition: new THREE.Vector3(0, 0, 0),
    velocity: new THREE.Vector3(),
    wallNormal: new THREE.Vector3(),
    state: 'ground',
    grounded: true,
    eyeHeight: 1.65,
    previousEyeHeight: 1.65,
    speed: 0,
    ...overrides,
  };
}

/** 把腳底移到 (x, y, z)（上一步與這一步都設成同一點）。 */
function place(p: FakePlayer, x: number, y: number, z: number): void {
  p.position.set(x, y, z);
  p.previousPosition.set(x, y, z);
}

const ALL_ON: CameraSettings = {
  fovHorizontal: 103,
  dynamicFov: true,
  cameraTilt: 1,
  landingDip: true,
  headBob: true,
  screenShake: 1,
};
const ALL_OFF: CameraSettings = {
  fovHorizontal: 103,
  dynamicFov: false,
  cameraTilt: 0,
  landingDip: false,
  headBob: false,
  screenShake: 0,
};

interface Rig {
  rig: CameraRig;
  camera: THREE.PerspectiveCamera;
  bus: EventBus<GameEvents>;
  player: FakePlayer;
  view: { viewYaw: number; viewPitch: number };
  settings: CameraSettings;
  /** 以 hz 的畫面更新率推進 seconds 秒（每畫面 alpha = 1）。 */
  run(seconds: number, hz?: number): void;
}

function makeRig(
  opts: { settings?: Partial<CameraSettings>; player?: Partial<FakePlayer>; aspect?: number; config?: Partial<CameraConfig> } = {},
): Rig {
  const camera = new THREE.PerspectiveCamera(70, opts.aspect ?? 16 / 9, 0.05, 600);
  const bus = new EventBus<GameEvents>();
  const player = fakePlayer(opts.player);
  const view = { viewYaw: 0, viewPitch: 0 };
  const settings: CameraSettings = { ...ALL_ON, ...opts.settings };
  const rig = new CameraRig({
    camera,
    view,
    bus,
    getSettings: () => settings,
    getPlayer: () => player,
    config: { ...defaultCameraConfig(), ...opts.config },
  });
  rig.advance(0, 1); // 第一個畫面：初始化（直接到位）。
  return {
    rig,
    camera,
    bus,
    player,
    view,
    settings,
    run(seconds, hz = 120) {
      const frames = Math.round(seconds * hz);
      for (let i = 0; i < frames; i++) rig.advance(1 / hz, 1);
    },
  };
}

function land(r: Rig, impactSpeed: number): void {
  r.bus.emit('player:land', { impactSpeed, surface: 'metal' });
}

function dash(r: Rig, dir: { x: number; y: number; z: number }): void {
  r.bus.emit('player:dash', { dir, fromState: 'ground', charges: 1 });
}

/** 相機目前的歐拉角（YXZ：pitch、yaw、roll）。 */
function cameraEuler(camera: THREE.PerspectiveCamera): THREE.Euler {
  return new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ');
}

describe('FOV 換算', () => {
  it('水平 ↔ 垂直 FOV 換算正確（16:9、21:9、4:3）', () => {
    const out = { horizontal: 0, vertical: 0 };
    const cases: [number, number][] = [
      [16 / 9, 70.53],
      [21 / 9, 56.62],
      [4 / 3, 86.63],
    ];
    for (const [aspect, expected] of cases) {
      resolveFov(103, aspect, 150, 120, out);
      expect(out.horizontal).toBeCloseTo(103, 9);
      expect(out.vertical).toBeCloseTo(expected, 1);
      expect(verticalToHorizontalFov(out.vertical, aspect)).toBeCloseTo(103, 9);
      // tan(h/2) = tan(v/2) × aspect
      expect(Math.tan((out.horizontal * D) / 2)).toBeCloseTo(Math.tan((out.vertical * D) / 2) * aspect, 9);
    }
  });

  it('CameraRig 依畫面比例把設定的水平 FOV 換成相機的垂直 FOV', () => {
    for (const aspect of [16 / 9, 21 / 9, 4 / 3]) {
      const r = makeRig({ aspect, settings: { fovHorizontal: 90 } });
      expect(r.camera.fov).toBeCloseTo(horizontalToVerticalFov(90, aspect), 9);
      expect(r.rig.horizontalFov).toBeCloseTo(90, 9);
      expect(r.rig.state.baseVerticalFov).toBeCloseTo(r.camera.fov, 9);
      // 改變視窗比例：下一個畫面跟著更新。
      r.camera.aspect = 2;
      r.rig.advance(1 / 60, 1);
      expect(r.camera.fov).toBeCloseTo(horizontalToVerticalFov(90, 2), 9);
    }
  });

  it('直向畫面時垂直 FOV 夾在上限，水平值依夾住後回推', () => {
    const r = makeRig({ aspect: 400 / 700 });
    expect(horizontalToVerticalFov(103, 400 / 700)).toBeGreaterThan(120);
    expect(r.camera.fov).toBeCloseTo(CAMERA_CONFIG.maxVerticalFov, 9);
    expect(r.rig.horizontalFov).toBeCloseTo(verticalToHorizontalFov(120, 400 / 700), 9);
  });
});

describe('動態 FOV', () => {
  it('速度 10 → 22 m/s 對應 +0 → +8°', () => {
    expect(speedFovBonus(5, CAMERA_CONFIG)).toBe(0);
    expect(speedFovBonus(10, CAMERA_CONFIG)).toBe(0);
    expect(speedFovBonus(16, CAMERA_CONFIG)).toBeCloseTo(4, 9);
    expect(speedFovBonus(22, CAMERA_CONFIG)).toBeCloseTo(8, 9);
    expect(speedFovBonus(40, CAMERA_CONFIG)).toBeCloseTo(8, 9);
    const r = makeRig({ player: { speed: 22 } });
    r.run(2);
    expect(r.rig.horizontalFov).toBeCloseTo(111, 3);
  });

  it('抓鉤中 +4°；以 damp 平滑（不會一個畫面跳到位）', () => {
    const r = makeRig({ player: { state: 'grapple', grounded: false } });
    r.run(1 / 60, 60);
    expect(r.rig.horizontalFov).toBeGreaterThan(103);
    expect(r.rig.horizontalFov).toBeLessThan(104);
    r.run(2);
    expect(r.rig.horizontalFov).toBeCloseTo(107, 3);
  });

  it('Dash 衝擊 +10°，0.3 s 回落', () => {
    const r = makeRig();
    dash(r, { x: 0, y: 0, z: -1 });
    let peak = 0;
    for (let i = 0; i < 120; i++) {
      r.rig.advance(1 / 240, 1);
      peak = Math.max(peak, r.rig.horizontalFov - 103);
    }
    expect(peak).toBeCloseTo(10, 1);
    // 升起 0.05 s + 回落 0.3 s 之後回到基礎值。
    r.run(0.4);
    expect(r.rig.horizontalFov).toBeCloseTo(103, 9);
    // 包絡：0 → 1 → 0。
    expect(kickEnvelope(0, 0.05, 0.3)).toBe(0);
    expect(kickEnvelope(0.05, 0.05, 0.3)).toBeCloseTo(1, 9);
    expect(kickEnvelope(0.2, 0.05, 0.3)).toBeCloseTo(0.5, 9);
    expect(kickEnvelope(0.35, 0.05, 0.3)).toBe(0);
  });

  it('Dash 中的位移速度不算進速度 FOV（只有 +10° 衝擊）', () => {
    const r = makeRig({ player: { speed: 8 } });
    r.run(1);
    r.player.state = 'dash';
    r.player.speed = 46.7;
    dash(r, { x: 0, y: 0, z: -1 });
    let peak = 0;
    for (let i = 0; i < 36; i++) {
      r.rig.advance(1 / 240, 1);
      peak = Math.max(peak, r.rig.horizontalFov - 103);
    }
    expect(peak).toBeCloseTo(10, 1);
  });

  it('FOV 衝擊可疊加、容量用完時取代剩餘量最小的', () => {
    const k = new FovKicks(2);
    k.add(5, 1, 0);
    k.add(3, 1, 0);
    expect(k.value).toBeCloseTo(8, 9);
    k.update(0.5);
    k.add(4, 1, 0);
    expect(k.activeCount).toBe(2);
    expect(k.value).toBeCloseTo(5 * 0.5 + 4, 6);
    k.clear();
    expect(k.value).toBe(0);
  });

  it('關閉動態 FOV 時只用設定值（速度、抓鉤、Dash 都不影響）', () => {
    const r = makeRig({ settings: { dynamicFov: false }, player: { speed: 30, state: 'grapple' } });
    dash(r, { x: 0, y: 0, z: -1 });
    r.rig.addFovKick(20, 1);
    for (let i = 0; i < 60; i++) {
      r.rig.advance(1 / 120, 1);
      expect(r.rig.horizontalFov).toBe(103);
    }
  });
});

describe('彈簧與畫面更新率', () => {
  it('衝量換算：峰值等於指定值（臨界、欠阻尼 0.7、過阻尼）', () => {
    for (const [f, z] of [
      [8, 0.7],
      [4, 1],
      [3, 1.6],
    ] as const) {
      const s = new SpringScalar({ frequency: f, dampingRatio: z });
      s.addImpulse(springImpulseForPeak(0.12, f, z));
      let peak = 0;
      for (let i = 0; i < 4000; i++) peak = Math.max(peak, s.update(1 / 4000));
      expect(peak).toBeCloseTo(0.12, 4);
      expect(springPeakPerVelocity(f, z)).toBeGreaterThan(0);
    }
  });

  it('30／60／144／240 Hz 畫面下，落地、傾斜、FOV 衝擊、震動、晃動的結果一致', () => {
    const sample = (hz: number): number[][] => {
      const r = makeRig({ player: { state: 'ground', speed: 9, velocity: new THREE.Vector3(4, 0, -8) } });
      land(r, 16);
      dash(r, { x: 1, y: 0, z: 0 });
      r.rig.addTrauma(0.6);
      const out: number[][] = [];
      for (const _t of [0.5, 0.5, 1]) {
        r.run(_t, hz);
        const c = r.camera;
        out.push([c.position.x, c.position.y, c.position.z, c.quaternion.x, c.quaternion.y, c.quaternion.z, c.quaternion.w, c.fov]);
      }
      return out;
    };
    const ref = sample(240);
    for (const hz of [30, 60, 144]) {
      const got = sample(hz);
      for (let i = 0; i < ref.length; i++) {
        for (let j = 0; j < ref[i]!.length; j++) expect(got[i]![j]).toBeCloseTo(ref[i]![j]!, 6);
      }
    }
  });

  it('跑牆傾斜在不同畫面更新率下的過渡曲線一致', () => {
    const curve = (hz: number): number[] => {
      const r = makeRig({ player: { state: 'wallRun', grounded: false, wallNormal: new THREE.Vector3(-1, 0, 0) } });
      const out: number[] = [];
      // 1/6 s 是 30／60／144／240 Hz 畫面間隔的整數倍。
      for (let i = 0; i < 6; i++) {
        r.run(1 / 6, hz);
        out.push(r.rig.state.rollDeg);
      }
      return out;
    };
    const ref = curve(240);
    for (const hz of [30, 60, 144]) curve(hz).forEach((v, i) => expect(v).toBeCloseTo(ref[i]!, 9));
  });
});

describe('傾斜（roll）', () => {
  it('跑牆 12° 朝牆外：右牆往左傾（正值），左牆往右傾', () => {
    const right = makeRig({ player: { state: 'wallRun', grounded: false, wallNormal: new THREE.Vector3(-1, 0, 0) } });
    right.run(2);
    expect(right.rig.state.rollDeg).toBeCloseTo(12, 3);
    expect(cameraEuler(right.camera).z).toBeCloseTo(12 * D, 3);
    // 鏡頭上方往牆外（-X）傾。
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(right.camera.quaternion);
    expect(up.x).toBeLessThan(-0.2);
    const left = makeRig({ player: { state: 'wallRun', grounded: false, wallNormal: new THREE.Vector3(1, 0, 0) } });
    left.run(2);
    expect(left.rig.state.rollDeg).toBeCloseTo(-12, 3);
  });

  it('滑鏟 3°、側移 1°（往移動方向傾）；設定的強度可調', () => {
    const slide = makeRig({ player: { state: 'slide' } });
    slide.run(2);
    expect(slide.rig.state.rollDeg).toBeCloseTo(3, 3);
    const strafe = makeRig({ player: { state: 'ground', velocity: new THREE.Vector3(7.5, 0, 0) } });
    strafe.run(2);
    expect(strafe.rig.state.rollDeg).toBeCloseTo(-1, 3);
    const half = makeRig({ settings: { cameraTilt: 0.5 }, player: { state: 'wallRun', wallNormal: new THREE.Vector3(-1, 0, 0) } });
    half.run(2);
    expect(half.rig.state.rollDeg).toBeCloseTo(6, 3);
    // 視線轉向時用視線的右方判斷側向。
    expect(rollTarget({ state: 'ground', velocity: { x: 0, z: -7.5 }, wallNormal: { x: 0, z: 0 } }, Math.PI / 2, CAMERA_CONFIG)).toBeCloseTo(-1, 9);
  });

  it('側向 Dash 2°：往 Dash 方向傾，之後回正；正前方 Dash 不傾斜', () => {
    expect(dashRollImpulse({ x: 0, z: -1 }, 0, CAMERA_CONFIG)).toBe(0);
    expect(dashRollImpulse({ x: 1, z: 0 }, 0, CAMERA_CONFIG)).toBe(-2);
    expect(dashRollImpulse({ x: -1, z: 0 }, 0, CAMERA_CONFIG)).toBe(2);
    const r = makeRig();
    dash(r, { x: 1, y: 0, z: 0 });
    let peak = 0;
    for (let i = 0; i < 240; i++) {
      r.rig.advance(1 / 240, 1);
      peak = Math.min(peak, r.rig.state.rollDeg);
    }
    expect(peak).toBeCloseTo(-2, 2);
    r.run(1);
    expect(Math.abs(r.rig.state.rollDeg)).toBeLessThan(0.01);
  });
});

describe('落地', () => {
  it('下沉量依落地速度，最大 0.12 m；彈簧回彈（8 Hz、阻尼 0.7）並往下點頭', () => {
    expect(landingDipAmount(2, CAMERA_CONFIG)).toBe(0);
    expect(landingDipAmount(11.5, CAMERA_CONFIG)).toBeCloseTo(0.06, 9);
    expect(landingDipAmount(50, CAMERA_CONFIG)).toBeCloseTo(0.12, 9);
    // 震動另外測（重落地會加 trauma）。
    const r = makeRig({ settings: { screenShake: 0 } });
    land(r, 30);
    let lowest = 0;
    let highest = 0;
    let lowestPitch = 0;
    for (let i = 0; i < 240; i++) {
      r.rig.advance(1 / 240, 1);
      lowest = Math.min(lowest, r.rig.state.dip);
      highest = Math.max(highest, r.rig.state.dip);
      lowestPitch = Math.min(lowestPitch, cameraEuler(r.camera).x);
    }
    expect(lowest).toBeCloseTo(-0.12, 3);
    // 阻尼 0.7 會小幅回彈到原位以上。
    expect(highest).toBeGreaterThan(0.001);
    expect(highest).toBeLessThan(0.03);
    expect(lowestPitch).toBeCloseTo(-2 * D, 3);
    r.run(1);
    expect(Math.abs(r.rig.state.dip)).toBeLessThan(1e-4);
    expect(r.camera.position.y).toBeCloseTo(1.65, 3);
  });

  it('重落地加入震動；普通跳躍落地不震動', () => {
    expect(heavyLandingTrauma(7.9, CAMERA_CONFIG)).toBe(0);
    expect(heavyLandingTrauma(20, CAMERA_CONFIG)).toBeCloseTo(0.3, 9);
    const r = makeRig();
    land(r, 20);
    expect(r.rig.trauma).toBeCloseTo(0.3, 9);
  });
});

describe('頭部晃動', () => {
  it('衝刺時垂直 ±0.015 m，水平小幅擺動；空中停止', () => {
    const out = { vertical: 0, horizontal: 0 };
    expect(headBob(0, 10.5, 1, CAMERA_CONFIG, out).vertical).toBeCloseTo(-0.015, 9);
    expect(headBob(0.5, 10.5, 1, CAMERA_CONFIG, out).vertical).toBeCloseTo(0.015, 9);
    expect(headBob(0.5, 10.5, 1, CAMERA_CONFIG, out).horizontal).toBeCloseTo(0.008, 9);
    expect(headBob(0.5, 5.25, 1, CAMERA_CONFIG, out).vertical).toBeCloseTo(0.0075, 9);
    const r = makeRig({ player: { speed: 10.5 } });
    let lo = 0;
    let hi = 0;
    for (let i = 0; i < 240; i++) {
      r.rig.advance(1 / 120, 1);
      if (i > 60) {
        lo = Math.min(lo, r.rig.state.bob);
        hi = Math.max(hi, r.rig.state.bob);
      }
    }
    expect(lo).toBeLessThan(-0.014);
    expect(hi).toBeGreaterThan(0.014);
    expect(Math.max(-lo, hi)).toBeLessThanOrEqual(0.015 + 1e-9);
    r.player.state = 'air';
    r.player.grounded = false;
    r.run(1);
    expect(Math.abs(r.rig.state.bob)).toBeLessThan(1e-4);
  });

  it('滑鏟中不晃動', () => {
    const r = makeRig({ player: { state: 'slide', speed: 14 } });
    r.run(1);
    expect(Math.abs(r.rig.state.bob)).toBe(0);
  });
});

describe('創傷式震動', () => {
  it('trauma 累加上限 1、每秒衰減；位移與旋轉 = trauma² × 雜訊', () => {
    const t = new Trauma();
    t.add(0.7);
    t.add(0.7);
    expect(t.value).toBe(1);
    t.update(0.5, 1.2);
    expect(t.value).toBeCloseTo(0.4, 9);
    expect(t.shake(2)).toBeCloseTo(0.16, 9);
    const out = { yaw: 0, pitch: 0, roll: 0, x: 0, y: 0, z: 0 };
    let maxYaw = 0;
    for (let i = 0; i < 200; i++) {
      t.time += 0.01;
      t.sample(CAMERA_CONFIG, 1, out);
      maxYaw = Math.max(maxYaw, Math.abs(out.yaw));
    }
    expect(maxYaw).toBeGreaterThan(0);
    expect(maxYaw).toBeLessThanOrEqual(0.16 * CAMERA_CONFIG.shakeYawDeg * D + 1e-12);
    // 強度 0 時完全不動。
    t.sample(CAMERA_CONFIG, 0, out);
    expect([out.yaw, out.pitch, out.roll, out.x, out.y, out.z]).toEqual([0, 0, 0, 0, 0, 0]);
    t.update(1, 1.2);
    expect(t.value).toBe(0);
  });

  it('CameraRig.addTrauma 讓鏡頭震動，衰減後回到原位；強度設定縮放震動', () => {
    const r = makeRig();
    r.rig.addTrauma(1);
    r.run(0.1);
    const e = cameraEuler(r.camera);
    expect(Math.abs(e.x) + Math.abs(e.y) + Math.abs(e.z)).toBeGreaterThan(1e-4);
    r.run(1);
    expect(r.rig.trauma).toBe(0);
    const e2 = cameraEuler(r.camera);
    expect(Math.abs(e2.x) + Math.abs(e2.y) + Math.abs(e2.z)).toBeLessThan(1e-9);

    // 相同時間序列：強度 0.5 的偏移比 1 小。
    const strong = makeRig();
    const weak = makeRig({ settings: { screenShake: 0.5 } });
    strong.rig.addTrauma(0.8);
    weak.rig.addTrauma(0.8);
    strong.run(0.13);
    weak.run(0.13);
    expect(cameraEuler(weak.camera).y).toBeCloseTo(cameraEuler(strong.camera).y * 0.5, 9);
  });

  it('爆炸依距離衰減', () => {
    expect(traumaFalloff(1, 0, 10)).toBe(1);
    expect(traumaFalloff(1, 5, 10)).toBeCloseTo(0.25, 9);
    expect(traumaFalloff(1, 12, 10)).toBe(0);
    const r = makeRig();
    expect(r.rig.addTraumaAt({ x: 5, y: 1.65, z: 0 }, 0.8, 10)).toBeCloseTo(0.2, 6);
    expect(r.rig.trauma).toBeCloseTo(0.2, 6);
  });
});

describe('位置與眼高', () => {
  it('鏡頭在插值後的腳底 + 眼高', () => {
    const r = makeRig();
    r.player.previousPosition.set(0, 0, 0);
    r.player.position.set(1, 0, -2);
    r.rig.advance(0, 0.25);
    expect(r.camera.position.x).toBeCloseTo(0.25, 9);
    expect(r.camera.position.z).toBeCloseTo(-0.5, 9);
    expect(r.camera.position.y).toBeCloseTo(1.65, 9);
  });

  it('蹲下時眼高以彈簧平滑（不過衝），0.5 s 內到位', () => {
    const r = makeRig({ settings: ALL_OFF });
    r.player.eyeHeight = r.player.previousEyeHeight = 0.95;
    let prev = 1.65;
    for (let i = 0; i < 60; i++) {
      r.rig.advance(1 / 120, 1);
      const y = r.camera.position.y;
      expect(y).toBeLessThanOrEqual(prev + 1e-12);
      expect(y).toBeGreaterThanOrEqual(0.95 - 1e-9);
      prev = y;
    }
    expect(r.camera.position.y).toBeCloseTo(0.95, 3);
  });

  it('攀爬時垂直位置以彈簧跟隨（先落後再追上），結束後與眼睛一致', () => {
    const r = makeRig({ settings: ALL_OFF, player: { state: 'mantle' } });
    const hz = 120;
    let maxLag = 0;
    for (let i = 1; i <= 20; i++) {
      r.player.previousPosition.copy(r.player.position);
      r.player.position.y = Math.min(1.5, (1.5 * i) / 20);
      r.rig.advance(1 / hz, 1);
      maxLag = Math.max(maxLag, r.player.position.y + 1.65 - r.camera.position.y);
    }
    expect(maxLag).toBeGreaterThan(0.1);
    r.player.state = 'ground';
    r.player.previousPosition.copy(r.player.position);
    r.run(1);
    expect(r.camera.position.y).toBeCloseTo(1.5 + 1.65, 3);
  });

  it('傳送與重生時所有彈簧直接到位', () => {
    const r = makeRig({ player: { state: 'wallRun', wallNormal: new THREE.Vector3(-1, 0, 0) } });
    land(r, 30);
    r.run(0.05);
    expect(r.rig.state.rollDeg).toBeGreaterThan(1);
    // 單一畫面移動 50 m：視為傳送。
    r.player.state = 'ground';
    place(r.player, 50, 3, 0);
    r.rig.advance(1 / 120, 1);
    expect(r.rig.state.rollDeg).toBe(0);
    expect(r.rig.state.dip).toBe(0);
    expect(r.camera.position.y).toBeCloseTo(3 + 1.65, 9);
    // 重生事件。
    r.rig.addTrauma(1);
    r.bus.emit('player:respawn', { pos: { x: 50, y: 3, z: 0 } });
    r.rig.advance(1 / 120, 1);
    expect(r.rig.trauma).toBe(0);
  });

  it('沒有玩家（除錯飛行）時只套用視角與基礎 FOV，不動位置', () => {
    const camera = new THREE.PerspectiveCamera(70, 16 / 9, 0.05, 600);
    camera.position.set(3, 4, 5);
    const view = { viewYaw: 0.4, viewPitch: -0.2 };
    const rig = new CameraRig({ camera, view, getSettings: () => ALL_ON, getPlayer: () => null });
    rig.addTrauma(1);
    rig.advance(1 / 60, 1);
    expect(camera.position.toArray()).toEqual([3, 4, 5]);
    const e = cameraEuler(camera);
    expect(e.y).toBeCloseTo(0.4, 9);
    expect(e.x).toBeCloseTo(-0.2, 9);
    expect(e.z).toBeCloseTo(0, 9);
    expect(camera.fov).toBeCloseTo(horizontalToVerticalFov(103, 16 / 9), 9);
  });

  it('最終 pitch 夾在上限內（視角加效果不會翻轉）', () => {
    const r = makeRig();
    r.view.viewPitch = -89 * D;
    land(r, 30);
    r.run(0.2);
    expect(cameraEuler(r.camera).x).toBeGreaterThanOrEqual(-CAMERA_CONFIG.maxPitchDeg * D - 1e-9);
  });
});

describe('所有效果關閉時鏡頭完全穩定', () => {
  it('跑牆、Dash、落地、震動、高速與抓鉤都不影響鏡頭', () => {
    const r = makeRig({ settings: ALL_OFF, player: { speed: 25, velocity: new THREE.Vector3(25, 0, 0) } });
    r.view.viewYaw = 0.3;
    r.view.viewPitch = 0.1;
    const states = ['ground', 'wallRun', 'slide', 'air', 'grapple', 'dash'];
    for (let i = 0; i < 600; i++) {
      r.player.state = states[Math.floor(i / 100)]!;
      r.player.wallNormal.set(-1, 0, 0);
      if (i % 50 === 0) {
        land(r, 30);
        dash(r, { x: 1, y: 0, z: 0 });
        r.rig.addTrauma(1);
        r.rig.addRollImpulse(10);
        r.rig.addFovKick(10, 0.3);
        r.rig.addTraumaAt({ x: 0, y: 0, z: 0 }, 1, 20);
      }
      r.rig.advance(1 / 144, 1);
      expect(r.camera.position.x).toBe(0);
      expect(r.camera.position.z).toBe(0);
      expect(r.camera.position.y).toBeCloseTo(1.65, 12);
      const e = cameraEuler(r.camera);
      expect(e.x).toBeCloseTo(0.1, 12);
      expect(e.y).toBeCloseTo(0.3, 12);
      expect(e.z).toBeCloseTo(0, 12);
      expect(r.camera.fov).toBeCloseTo(horizontalToVerticalFov(103, 16 / 9), 12);
    }
  });

  it('暫停（dt = 0）時效果凍結', () => {
    const r = makeRig();
    land(r, 20);
    r.run(0.03);
    const y = r.camera.position.y;
    for (let i = 0; i < 10; i++) r.rig.advance(0, 1);
    expect(r.camera.position.y).toBe(y);
  });
});

describe('速度線', () => {
  it('水平速度 > 14 m/s 才淡入；設定關閉或沒有玩家時隱藏', () => {
    expect(speedLinesTarget(14, 14, 22)).toBe(0);
    expect(speedLinesTarget(18, 14, 22)).toBeCloseTo(0.5, 9);
    expect(speedLinesTarget(30, 14, 22)).toBe(1);
    let speed: number | null = 10;
    let enabled = true;
    const scene = new THREE.Scene();
    const lines = new SpeedLines({
      scene,
      camera: new THREE.PerspectiveCamera(70, 16 / 9),
      getSpeed: () => speed,
      isEnabled: () => enabled,
      config: { ...SPEED_LINES_CONFIG },
    });
    expect(scene.children).toContain(lines.mesh);
    for (let i = 0; i < 120; i++) lines.advance(1 / 120);
    expect(lines.intensity).toBe(0);
    expect(lines.mesh.visible).toBe(false);
    speed = 25;
    lines.advance(1 / 120);
    expect(lines.intensity).toBeGreaterThan(0);
    expect(lines.intensity).toBeLessThan(0.1);
    for (let i = 0; i < 240; i++) lines.advance(1 / 120);
    expect(lines.intensity).toBeCloseTo(1, 3);
    expect(lines.mesh.visible).toBe(true);
    expect(lines.mesh.material.uniforms.uIntensity!.value).toBeCloseTo(SPEED_LINES_CONFIG.maxOpacity, 3);
    enabled = false;
    lines.advance(1 / 120);
    expect(lines.intensity).toBe(0);
    expect(lines.mesh.visible).toBe(false);
    enabled = true;
    speed = null;
    lines.advance(1 / 120);
    expect(lines.mesh.visible).toBe(false);
    lines.dispose();
    expect(scene.children).not.toContain(lines.mesh);
  });
});

describe('設定與調參面板', () => {
  it('新增的玩家設定與預設值', () => {
    const s = defaultSettings();
    expect(s).toMatchObject({ dynamicFov: true, cameraTilt: 1, landingDip: true, headBob: true, screenShake: 1, speedLines: true });
    expect(SETTINGS_SCHEMA.screenShake).toMatchObject({ min: 0, max: 1 });
    expect(SETTINGS_SCHEMA.cameraTilt).toMatchObject({ min: 0, max: 1 });
  });

  it('面板規格的欄位都存在，預設值在範圍內', () => {
    const groups = [...CAMERA_PANEL.map((g) => [g.schema, CAMERA_CONFIG] as const), [SPEED_LINES_PANEL, SPEED_LINES_CONFIG] as const];
    const seen = new Set<string>();
    for (const [schema, cfg] of groups) {
      for (const [key, spec] of Object.entries(schema)) {
        expect(key in cfg).toBe(true);
        const v = (cfg as unknown as Record<string, number>)[key]!;
        if (spec?.min !== undefined) expect(v).toBeGreaterThanOrEqual(spec.min);
        if (spec?.max !== undefined) expect(v).toBeLessThanOrEqual(spec.max);
        seen.add(key);
      }
    }
    // CAMERA_CONFIG 的每個欄位都在面板上。
    for (const key of Object.keys(CAMERA_CONFIG)) expect(seen.has(key)).toBe(true);
    expect(CAMERA_PANEL.every((g) => g.folder.startsWith('鏡頭/'))).toBe(true);
  });
});

describe('與玩家控制器整合（Rapier 無頭世界）', () => {
  beforeAll(async () => {
    await Physics.init();
  });
  const sims: MovementSim[] = [];
  afterEach(() => {
    for (const s of sims.splice(0)) s.dispose();
  });

  it('跑右牆時鏡頭往左傾、跳下落地時下沉；鏡頭不改變移動', () => {
    const floor = floorBox('floor', -60, 60, -120, 30);
    const wall = boxMinMax('wall-r', [2, 0, -100], [3, 10, 10], 'wallrun');
    const make = (): MovementSim => {
      const s = new MovementSim({ primitives: [floor, wall], config: { sprintSpeed: 8 }, spawn: { pos: [-2, 0, 5], yaw: -30 * D } });
      sims.push(s);
      return s;
    };
    const script = (s: MovementSim, onStep?: () => void): void => {
      s.settle();
      s.input.down('moveForward');
      while (s.player.position.x < 2 - MOVEMENT_CONFIG.radius - 0.95 && s.time < 3) {
        s.step();
        onStep?.();
      }
      s.input.tap('jump');
      for (let i = 0; i < 240; i++) {
        s.step();
        onStep?.();
      }
    };
    const s = make();
    const camera = new THREE.PerspectiveCamera(70, 16 / 9, 0.05, 600);
    const view = {
      get viewYaw(): number {
        return s.input.yaw;
      },
      get viewPitch(): number {
        return s.input.pitch;
      },
    };
    const rig = new CameraRig({ camera, view, bus: s.bus, getSettings: () => ALL_ON, getPlayer: () => s.player.state });
    let maxRoll = 0;
    let wallRunSeen = false;
    script(s, () => {
      rig.advance(s.dt, 1);
      if (s.state === 'wallRun') wallRunSeen = true;
      maxRoll = Math.max(maxRoll, rig.state.rollDeg);
    });
    expect(wallRunSeen).toBe(true);
    // 視線偏右 30°，牆在右側：傾斜 12° × cos(30°) ≈ 10.4°。
    expect(maxRoll).toBeGreaterThan(8);
    expect(maxRoll).toBeLessThanOrEqual(12 + 1e-6);
    // 放開前進 → 離牆落地 → 下沉。
    s.input.up('moveForward');
    let lowest = 0;
    for (let i = 0; i < 600; i++) {
      s.step();
      rig.advance(s.dt, 1);
      lowest = Math.min(lowest, rig.state.dip);
    }
    expect(s.eventsNamed('player:land').length).toBeGreaterThan(0);
    expect(lowest).toBeLessThan(-0.01);

    // 同一段腳本、沒有鏡頭：玩家軌跡完全相同（鏡頭不影響移動）。
    const plain = make();
    script(plain);
    plain.input.up('moveForward');
    for (let i = 0; i < 600; i++) plain.step();
    expect(plain.player.position.toArray()).toEqual(s.player.position.toArray());
  });
});
