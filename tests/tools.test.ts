// M1-15：調參預設組合、計時賽、示範與工具的單元測試（錄製重播的確定性見 replay.test.ts）。
import * as THREE from 'three';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { CAMERA_CONFIG, defaultCameraConfig } from '@/camera/CameraConfig';
import { GameStorage, type StorageBackend } from '@/core/Storage';
import { Physics } from '@/physics/Physics';
import { MOVEMENT_CONFIG, defaultMovementConfig } from '@/player/MovementConfig';
import { DemoRunner, DEMO_COMBO } from '@/tools/demo';
import {
  BUILTIN_PRESETS,
  PRESETS_KEY,
  PresetStore,
  parsePresetJson,
  sanitizePresetName,
  serializePreset,
} from '@/tools/Presets';
import {
  BEST_TIMES_KEY,
  BestTimes,
  CourseRun,
  courseFromCheckpoints,
  segmentEnterSphere,
  type CourseDef,
  type TimeTrialResult,
} from '@/tools/TimeTrial';
import { ringYaw } from '@/tools/ToolVisuals';
import {
  STANDARD_FINGERPRINT,
  applyTuning,
  captureTuning,
  currentTuningDiff,
  diffTuning,
  gameTuningTargets,
  isStandardTuning,
  stableStringify,
  tuningFingerprint,
  type TuningTargets,
} from '@/tools/tuning';
import { createArchetype, defaultLoadout } from '@/weapons/archetypes';
import type { WeaponDef } from '@/weapons/WeaponDef';
import { PARKOUR_COURSE, TRAINING_CHECKPOINTS } from '@/world/levels/TrainingGround';
import { ToolSim } from './helpers/toolSim';

function memoryBackend(): StorageBackend & { map: Map<string, string>; failWrites: boolean } {
  const map = new Map<string, string>();
  const b = {
    map,
    failWrites: false,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      if (b.failWrites && !k.endsWith('__probe__')) throw new DOMException('full', 'QuotaExceededError');
      map.set(k, v);
    },
    removeItem: (k: string) => void map.delete(k),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  };
  return b;
}

/** 測試用的調參對象（獨立的設定物件與武器）。 */
function targets(): TuningTargets & { defs: WeaponDef[] } {
  const defs = defaultLoadout();
  return {
    defs,
    movement: defaultMovementConfig(),
    camera: defaultCameraConfig(),
    getWeaponDefs: () => defs,
    setWeaponDef: (id, def) => {
      const i = defs.findIndex((d) => d.id === id);
      if (i >= 0) defs[i] = def;
    },
  };
}

afterEach(() => {
  Object.assign(MOVEMENT_CONFIG, defaultMovementConfig());
  Object.assign(CAMERA_CONFIG, defaultCameraConfig());
});

describe('調參數值', () => {
  it('預設值的差異為空（標準）；修改後只列出改過的欄位，武器為巢狀差異', () => {
    const t = targets();
    expect(currentTuningDiff(t)).toEqual({});
    expect(isStandardTuning(currentTuningDiff(t))).toBe(true);
    t.movement.sprintSpeed = 12;
    t.camera.wallRunRollDeg = 6;
    t.defs[0]!.recoil.recoveryPerSec = 30;
    t.defs[0]!.spread.pelletPattern = [[0.1, 0.2]];
    const diff = currentTuningDiff(t);
    expect(diff.movement).toEqual({ sprintSpeed: 12 });
    expect(diff.camera).toEqual({ wallRunRollDeg: 6 });
    expect(diff.weapons).toEqual({ [t.defs[0]!.id]: { recoil: { recoveryPerSec: 30 }, spread: { pelletPattern: [[0.1, 0.2]] } } });
    expect(isStandardTuning(diff)).toBe(false);
    expect(tuningFingerprint(diff)).not.toBe(STANDARD_FINGERPRINT);
    expect(tuningFingerprint(JSON.parse(JSON.stringify(diff)))).toBe(tuningFingerprint(diff));
  });

  it('套用：先回到預設再疊上數值；型別不符、未知欄位、不合法武器略過並警告', () => {
    const t = targets();
    t.movement.gravity = 40;
    const r = applyTuning(t, {
      movement: { sprintSpeed: 13, runSpeed: 'fast' as unknown as number, nope: 1 },
      camera: { fovSpeedBonus: 12 },
      weapons: {
        assaultRifle: { fire: { rpm: 720 } },
        shotgun: { fire: { pellets: -5 } },
        unknownGun: { fire: { rpm: 1 } },
      },
    });
    expect(t.movement.gravity).toBe(defaultMovementConfig().gravity);
    expect(t.movement.sprintSpeed).toBe(13);
    expect(t.movement.runSpeed).toBe(defaultMovementConfig().runSpeed);
    expect(t.camera.fovSpeedBonus).toBe(12);
    const ids = t.defs.map((d) => d.id);
    const rifle = t.defs.find((d) => d.archetype === 'assaultRifle')!;
    expect(ids).toContain(rifle.id);
    expect(r.warnings.join('\n')).toContain('movement.runSpeed');
    expect(r.warnings.join('\n')).toContain('movement.nope');
    expect(r.warnings.join('\n')).toContain('unknownGun');
  });

  it('武器套用：原型疊上欄位；驗證失敗時維持目前定義', () => {
    const t = targets();
    const id = t.defs[0]!.id;
    const before = JSON.stringify(t.defs[0]);
    const bad = applyTuning(t, { weapons: { [id]: { fire: { rpm: -1 } } } });
    expect(bad.warnings.join()).toContain('數值不合法');
    expect(JSON.stringify(t.defs[0])).toBe(before);
    applyTuning(t, { weapons: { [id]: { fire: { rpm: 700 } } } });
    expect(t.defs[0]!.fire.rpm).toBe(700);
    expect(t.defs[0]).toEqual({ ...createArchetype(id)!, fire: { ...createArchetype(id)!.fire, rpm: 700 } });
    applyTuning(t, {});
    expect(t.defs[0]).toEqual(createArchetype(id));
  });

  it('匯出的預設 JSON 再匯入後，數值完全一致（移動、鏡頭、所有武器）', () => {
    const a = targets();
    a.movement.sprintSpeed = 11.25;
    a.movement.dashDistance = 8.125;
    a.movement.grappleEnabled = false;
    a.camera.landMaxDip = 0.1234567890123;
    a.defs[1]!.damage.base = 9.75;
    a.defs[3]!.handling.adsZoom = 5.5;
    a.defs[4]!.projectile!.speed = 51.0000001;
    const full = captureTuning(a);
    const json = serializePreset({ name: '測試組合', values: currentTuningDiff(a) }, '0.1.0');
    const parsed = parsePresetJson(json);
    expect(parsed.ok).toBe(true);
    expect(parsed.preset!.name).toBe('測試組合');
    const b = targets();
    applyTuning(b, parsed.preset!.values);
    expect(stableStringify(captureTuning(b))).toBe(stableStringify(full));
    expect(captureTuning(b)).toEqual(full);
  });

  it('遊戲的目標物件指向 MOVEMENT_CONFIG／CAMERA_CONFIG', () => {
    const g = gameTuningTargets({ getWeaponDefs: () => [], setWeaponDef: () => {} });
    expect(g.movement).toBe(MOVEMENT_CONFIG);
    expect(g.camera).toBe(CAMERA_CONFIG);
    g.movement.sprintSpeed = 9;
    expect(diffTuning(captureTuning(g)).movement).toEqual({ sprintSpeed: 9 });
  });
});

describe('預設組合', () => {
  it('內建三組：標準為空集合；高速／穩重的欄位都是已知欄位且型別正確', () => {
    expect(BUILTIN_PRESETS.map((p) => p.name)).toEqual(['標準', '高速', '穩重']);
    expect(BUILTIN_PRESETS[0]!.values).toEqual({});
    for (const p of BUILTIN_PRESETS) {
      const t = targets();
      const r = applyTuning(t, p.values);
      expect(r.warnings).toEqual([]);
      expect(currentTuningDiff(t)).toEqual(p.values);
    }
    const t = targets();
    applyTuning(t, BUILTIN_PRESETS[1]!.values);
    expect(t.movement.sprintSpeed).toBeGreaterThan(defaultMovementConfig().sprintSpeed);
    applyTuning(t, BUILTIN_PRESETS[0]!.values);
    expect(t.movement).toEqual(defaultMovementConfig());
  });

  it('解析：格式、版本相容（較新版本拒絕）、只有 values 的物件、壞 JSON', () => {
    expect(parsePresetJson('{').ok).toBe(false);
    expect(parsePresetJson('[]').errors[0]).toContain('物件');
    expect(parsePresetJson(JSON.stringify({ format: 'other', version: 1, values: {} })).errors[0]).toContain('不是調參預設組合');
    expect(parsePresetJson(JSON.stringify({ format: 'shardwake-preset', version: 2, name: 'x', values: {} })).errors[0]).toContain('請更新遊戲');
    expect(parsePresetJson(JSON.stringify({ format: 'shardwake-preset', version: 0, values: {} })).ok).toBe(false);
    expect(parsePresetJson(JSON.stringify({ format: 'shardwake-preset', version: 1, name: 'x', values: { audio: {} } })).ok).toBe(false);
    const bare = parsePresetJson(JSON.stringify({ movement: { sprintSpeed: 12 } }), '貼上');
    expect(bare.ok).toBe(true);
    expect(bare.preset).toMatchObject({ name: '貼上', values: { movement: { sprintSpeed: 12 } } });
    expect(sanitizePresetName('  a\u0000b\n  ')).toBe('ab');
    expect(sanitizePresetName('x'.repeat(80))).toHaveLength(40);
  });

  it('存檔 shardwake:presets:v1：存讀、覆寫、刪除；內建名稱不可用；壞資料略過；不認識的欄位保留', () => {
    const backend = memoryBackend();
    const storage = new GameStorage({ backend: () => backend });
    const store = new PresetStore(storage);
    expect(store.save('標準', {}).ok).toBe(false);
    expect(store.save('  ', {}).ok).toBe(false);
    expect(store.save('我的', { movement: { sprintSpeed: 12 } })).toMatchObject({ ok: true, persistent: true });
    expect(store.save('我的', { movement: { sprintSpeed: 13 } }).ok).toBe(true);
    const raw = JSON.parse(backend.map.get(`shardwake:${PRESETS_KEY}`)!) as { version: number; presets: unknown[]; future?: unknown };
    expect(raw.version).toBe(1);
    expect(raw.presets).toHaveLength(1);
    raw.future = { keep: true };
    raw.presets.push({ name: 42 }, { name: '壞的', values: 'x' }, { name: '標準', values: {} });
    backend.map.set(`shardwake:${PRESETS_KEY}`, JSON.stringify(raw));
    const again = new PresetStore(storage);
    expect(again.userPresets.map((p) => p.name)).toEqual(['我的']);
    expect(again.get('我的')!.values).toEqual({ movement: { sprintSpeed: 13 } });
    expect(again.all).toHaveLength(4);
    expect(again.remove('標準').ok).toBe(false);
    expect(again.remove('我的').ok).toBe(true);
    const after = JSON.parse(backend.map.get(`shardwake:${PRESETS_KEY}`)!) as { future?: unknown; presets: unknown[] };
    expect(after.future).toEqual({ keep: true });
    expect(after.presets).toEqual([]);
  });

  it('儲存不可用或容量不足：組合留在記憶體、不拋錯、其他存檔不受影響', () => {
    const none = new PresetStore(new GameStorage({ backend: () => null }));
    expect(none.save('a', {})).toMatchObject({ ok: true, persistent: false });
    expect(none.get('a')).toBeDefined();
    const backend = memoryBackend();
    const storage = new GameStorage({ backend: () => backend });
    const store = new PresetStore(storage);
    backend.failWrites = true;
    const r = store.save('滿了', { movement: { gravity: 30 } });
    expect(r).toMatchObject({ ok: true, persistent: false });
    expect(r.error).toContain('QuotaExceededError');
    expect(store.get('滿了')).toBeDefined();
    expect(storage.isPersistent).toBe(true);
  });
});

describe('Storage.trySetString', () => {
  it('寫入失敗時回報、不退回記憶體也不改變持久狀態', () => {
    const backend = memoryBackend();
    const storage = new GameStorage({ backend: () => backend });
    backend.failWrites = true;
    const r = storage.trySetString('replay:v1:x', 'big');
    expect(r.ok).toBe(false);
    expect(storage.isPersistent).toBe(true);
    expect(storage.getString('replay:v1:x')).toBeNull();
    backend.failWrites = false;
    expect(storage.trySetString('replay:v1:x', 'ok')).toEqual({ ok: true, persistent: true });
    expect(new GameStorage({ backend: () => null }).trySetString('a:v1', 'b')).toEqual({ ok: true, persistent: false });
  });
});

const line = (n: number, spacing = 10): CourseDef => ({
  id: 'test',
  name: '測試',
  restart: { pos: { x: 0, y: 0, z: 5 }, yaw: 0 },
  gates: Array.from({ length: n }, (_, i) => ({ id: `g${i}`, label: `G${i}`, center: { x: 0, y: 1, z: -i * spacing }, radius: 2 })),
});

describe('計時賽', () => {
  it('segmentEnterSphere：從外面進入的比例；已在球內、沒碰到時為 null', () => {
    const c = { x: 0, y: 0, z: 0 };
    expect(segmentEnterSphere({ x: -4, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, c, 2)).toBeCloseTo(0.5, 12);
    expect(segmentEnterSphere({ x: -1, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }, c, 2)).toBeNull();
    expect(segmentEnterSphere({ x: -4, y: 3, z: 0 }, { x: 4, y: 3, z: 0 }, c, 2)).toBeNull();
    expect(segmentEnterSphere({ x: -4, y: 0, z: 0 }, { x: -3, y: 0, z: 0 }, c, 2)).toBeNull();
    // 一步穿過整個球也算。
    expect(segmentEnterSphere({ x: -4, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }, c, 2)).toBeCloseTo(0.25, 12);
  });

  it('計時與分段：進入起點門那一刻起算，精確到步內；必須依序通過；與步長無關', () => {
    const results: number[][] = [];
    for (const hz of [60, 120, 240]) {
      const run = new CourseRun(line(4));
      const dt = 1 / hz;
      // 以 7 m/s 沿 -Z 前進，從 z = 5 出發。
      let z = 5;
      const events: string[] = [];
      for (let i = 0; i < hz * 6; i++) {
        const z1 = z - 7 * dt;
        const ev = run.step(dt, { x: 0, y: 1, z }, { x: 0, y: 1, z: z1 }, null);
        if (ev) events.push(ev);
        z = z1;
      }
      expect(events).toEqual(['start', 'split', 'split', 'finish']);
      expect(run.phase).toBe('finished');
      // 起點門邊緣 z = 2，終點門邊緣 z = -30 + 2 = -28：總距離 30 m / 7 m/s。
      expect(run.time).toBeCloseTo(30 / 7, 9);
      results.push(run.splits.map((s) => s.time));
    }
    expect(results[1]![0]).toBeCloseTo(10 / 7, 9);
    for (const r of results) for (let i = 0; i < r.length; i++) expect(r[i]).toBeCloseTo(results[0]![i]!, 9);
  });

  it('跳過檢查點不算：直接到終點不會完成；分段差與最佳比較', () => {
    const course = line(3);
    const run = new CourseRun(course);
    run.step(0.1, { x: 0, y: 1, z: 5 }, { x: 0, y: 1, z: 1 }, null);
    expect(run.phase).toBe('running');
    // 繞過中間的門（x 偏 5 m）。
    run.step(0.1, { x: 5, y: 1, z: 1 }, { x: 5, y: 1, z: -25 }, null);
    run.step(0.1, { x: 5, y: 1, z: -25 }, { x: 0, y: 1, z: -20 }, null);
    expect(run.phase).toBe('running');
    expect(run.next).toBe(1);
    const best = { time: 1, splits: [0.5, 1], date: '', tuning: '', standard: true };
    run.reset();
    run.step(0.1, { x: 0, y: 1, z: 3 }, { x: 0, y: 1, z: 1 }, best);
    run.step(0.5, { x: 0, y: 1, z: 1 }, { x: 0, y: 1, z: -10 }, best);
    expect(run.splits[0]!.delta).toBeCloseTo(run.splits[0]!.time - 0.5, 12);
  });

  it('最佳成績 shardwake:besttimes:v1：只在更快時更新；檢查點數不同的舊成績不使用；容量不足不拋錯', () => {
    const backend = memoryBackend();
    const storage = new GameStorage({ backend: () => backend });
    const best = new BestTimes(storage);
    const rec = (time: number, n = 2): { time: number; splits: number[]; date: string; tuning: string; standard: boolean } => ({
      time,
      splits: Array.from({ length: n }, (_, i) => (time * (i + 1)) / n),
      date: 'd',
      tuning: STANDARD_FINGERPRINT,
      standard: true,
    });
    expect(best.submit('parkour', rec(50), 3).isBest).toBe(true);
    expect(best.submit('parkour', rec(55), 3).isBest).toBe(false);
    expect(best.submit('parkour', rec(48), 3).isBest).toBe(true);
    const raw = JSON.parse(backend.map.get(`shardwake:${BEST_TIMES_KEY}`)!) as { version: number; courses: Record<string, { time: number }> };
    expect(raw.version).toBe(1);
    expect(raw.courses.parkour!.time).toBe(48);
    expect(new BestTimes(storage).get('parkour', 3)!.time).toBe(48);
    expect(new BestTimes(storage).get('parkour', 5)).toBeNull();
    backend.map.set(`shardwake:${BEST_TIMES_KEY}`, '{"version":1,"courses":{"parkour":{"time":-1}}}');
    expect(new BestTimes(storage).get('parkour')).toBeNull();
    backend.failWrites = true;
    const r = new BestTimes(storage).submit('parkour', rec(40), 3);
    expect(r.isBest).toBe(true);
    expect(r.persistent).toBe(false);
  });

  it('訓練場路線：10 個檢查點依序排列、半徑 3、環朝向沿路線；不是重生點', () => {
    const course = courseFromCheckpoints(TRAINING_CHECKPOINTS, PARKOUR_COURSE.id, PARKOUR_COURSE.name, { pos: { x: 0, y: 0, z: 0 }, yaw: 0 }, (cp) => PARKOUR_COURSE.labels[cp.id] ?? cp.id);
    expect(course).not.toBeNull();
    expect(course!.gates.map((g) => g.label)).toEqual(['起點', '跑牆長廊', '長廊出口', 'Z 字牆板', '20 m 塔頂', '半管入口', '半管出口', '浮台起點', '浮台終點', '終點']);
    expect(course!.gates.every((g) => g.radius === 3)).toBe(true);
    expect(TRAINING_CHECKPOINTS.filter((c) => c.course === 'parkour').every((c) => c.respawn === false)).toBe(true);
    // 起點門朝向第二個檢查點（西北）。
    const yaw = ringYaw(course!, 0);
    const a = course!.gates[0]!.center;
    const b = course!.gates[1]!.center;
    expect(yaw).toBeCloseTo(Math.atan2(b.x - a.x, b.z - a.z), 12);
  });
});

describe('計時賽與示範（無頭整合）', () => {
  beforeAll(async () => {
    await Physics.init();
  });
  const sims: ToolSim[] = [];
  afterEach(() => {
    for (const s of sims.splice(0)) s.dispose();
  });

  it('環的中心不在幾何內（可以穿過），重來位置站得穩', async () => {
    const s = await ToolSim.create();
    sims.push(s);
    for (const cp of TRAINING_CHECKPOINTS.filter((c) => c.course === 'parkour')) {
      const n = s.physics.overlap(new (await import('@dimforge/rapier3d-compat')).default.Ball(0.5), { x: cp.pos[0], y: cp.pos[1], z: cp.pos[2] }, 1);
      expect(n, cp.id).toBe(0);
    }
    const r = PARKOUR_COURSE.restart;
    s.player.teleport({ x: r.pos[0], y: r.pos[1], z: r.pos[2] }, 0);
    s.run(0.5);
    expect(s.player.grounded).toBe(true);
    expect(s.player.position.y).toBeCloseTo(0.3, 1);
  });

  it('T 重來：送回起點並待命；往北跑穿過起點門開始計時；重播的成績不更新最佳', async () => {
    const s = await ToolSim.create();
    sims.push(s);
    const finishes: TimeTrialResult[] = [];
    const starts: string[] = [];
    s.bus.on('course:finish', (r) => finishes.push(r));
    s.bus.on('course:start', ({ courseId }) => starts.push(courseId));
    s.tap('KeyT');
    s.run(0.1);
    expect(s.trial.run?.phase).toBe('idle');
    expect(s.player.position.z).toBeCloseTo(PARKOUR_COURSE.restart.pos[2], 3);
    // 錄一段：從起點往北跑過起點門。
    s.replay.startRecording();
    s.key('KeyW', true);
    s.run(1.5);
    expect(starts).toEqual(['parkour']);
    expect(s.trial.run?.phase).toBe('running');
    const t1 = s.trial.run!.time;
    expect(t1).toBeGreaterThan(0.5);
    s.key('KeyW', false);
    const clip = s.replay.stopRecording()!;
    // 重播：起始狀態讓計時賽回到待命，重播時一樣在同一刻開始。
    s.replay.startReplay();
    while (s.replay.replaying) s.frame(1 / 60);
    expect(starts).toEqual(['parkour', 'parkour']);
    expect(s.trial.run!.time).toBeCloseTo(t1, 9);
    expect(clip.steps).toBeGreaterThan(0);
    expect(finishes).toEqual([]);
  });

  it('示範：DemoRunner 用標準參數重播內建錄影，依序完成連招', async () => {
    const s = await ToolSim.create();
    sims.push(s);
    const { readFileSync } = await import('node:fs');
    const clip = JSON.parse(readFileSync(new URL('../src/debug/demo-clip.json', import.meta.url), 'utf8')) as unknown;
    MOVEMENT_CONFIG.sprintSpeed = 7; // 示範應該先套用標準參數
    const reports: string[] = [];
    const demo = new DemoRunner({
      replay: s.replay,
      clip,
      applyStandard: () => Object.assign(MOVEMENT_CONFIG, defaultMovementConfig()),
      report: (r) => reports.push(r.state),
    });
    expect(demo.start()).toBe(true);
    while (s.replay.replaying) s.frame(1 / 75);
    expect(reports).toEqual(['running', 'done']);
    expect(demo.lastReport.missing).toBeNull();
    expect(demo.lastReport.finalError!).toBeLessThan(0.001);
    expect(DEMO_COMBO).toHaveLength(6);
    // 失準：改參數後終點偏離 → failed。
    const demo2 = new DemoRunner({ replay: s.replay, clip, applyStandard: () => (MOVEMENT_CONFIG.sprintSpeed = 8), report: () => {} });
    demo2.start();
    while (s.replay.replaying) s.frame(1 / 60);
    expect(demo2.state).toBe('failed');
    // 不合法的錄影。
    const bad = new DemoRunner({ replay: s.replay, clip: { format: 'x' }, applyStandard: () => {}, report: () => {} });
    expect(bad.start()).toBe(false);
    expect(bad.lastReport.error).toContain('不合法');
  });

  it('InputSystem 的外部來源：來源結束時這一步改用玩家輸入，視角由來源決定', async () => {
    const s = await ToolSim.create();
    sims.push(s);
    let n = 0;
    s.input.setFrameSource((out) => {
      if (n++ >= 3) return false;
      out.held = 0;
      out.pressed = 0;
      out.released = 0;
      out.move.x = 0;
      out.move.y = 0;
      out.yaw = 1;
      out.pitch = 0.25;
      return true;
    });
    s.key('KeyW', true);
    s.frame(1 / 120);
    expect(s.input.frame.move.y).toBe(0);
    expect(s.input.view.yaw).toBe(1);
    expect(s.input.view.pitch).toBe(0.25);
    s.frame(1 / 40);
    expect(s.input.hasFrameSource).toBe(false);
    expect(s.input.frame.move.y).toBe(1);
    void THREE;
  });
});
