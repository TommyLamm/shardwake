// M1-15 驗收：輸入錄製與確定性重播（Rapier 無頭世界＋訓練場＋武器＋生命，接線與 main.ts 相同）。
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { GameStorage } from '@/core/Storage';
import { Physics } from '@/physics/Physics';
import { MOVEMENT_CONFIG, defaultMovementConfig } from '@/player/MovementConfig';
import { ACTION_BIT } from '@/input/Actions';
import { createInputFrame } from '@/input/InputFrame';
import { ClipStore } from '@/tools/ClipStore';
import { FrameBuffer, UNRECORDED_MASK, decodeFrames, readFrame, serializeClip, validateClip, type InputClip } from '@/tools/clip';
import { missingSequence } from '@/tools/Replay';
import { ToolSim } from './helpers/toolSim';

beforeAll(async () => {
  await Physics.init();
});

const sims: ToolSim[] = [];
async function sim(): Promise<ToolSim> {
  const s = await ToolSim.create();
  sims.push(s);
  return s;
}
afterEach(() => {
  for (const s of sims.splice(0)) s.dispose();
  Object.assign(MOVEMENT_CONFIG, defaultMovementConfig());
});

const D = Math.PI / 180;

/**
 * 在中央廣場錄一段：衝刺、轉向（每畫面轉動，模擬滑鼠）、滑鏟、跳、二段跳、Dash、開火壓槍（觸發壓槍吸收）、換槍、電漿火箭跳。
 * fps 為錄製時的畫面更新率。
 */
function recordSample(s: ToolSim, fps = 60): InputClip {
  const dt = 1 / fps;
  const frames = (seconds: number, each?: (i: number) => void): void => {
    const n = Math.round(seconds * fps);
    for (let i = 0; i < n; i++) {
      each?.(i);
      s.frame(dt);
    }
  };
  s.player.teleport({ x: 0, y: 0, z: 30 }, 0);
  frames(0.3);
  expect(s.replay.startRecording('測試')).toBe(true);
  s.key('KeyW', true);
  frames(0.6, () => s.turn(0.4 * D));
  s.key('KeyC', true);
  frames(0.25);
  s.key('KeyC', false);
  s.tap('Space');
  frames(0.3, () => s.turn(-0.6 * D));
  s.tap('Space');
  frames(0.2);
  s.tap('ShiftLeft');
  frames(0.4);
  // 開火並往下壓槍（玩家視角往後座反方向轉 → 壓槍吸收改寫玩家視角）。
  s.key('KeyW', false);
  s.key('Mouse0', true);
  frames(0.8, (i) => s.turn(0.15 * D * Math.sin(i), -0.35 * D));
  s.key('Mouse0', false);
  frames(0.3, () => s.turn(0, 0.1 * D));
  // 電漿發射器朝腳下開火（火箭跳：自身擊退改變移動）。
  s.tap('Digit5');
  frames(0.7);
  s.turn(0, -80 * D);
  s.tap('Space');
  frames(0.1);
  s.tap('Mouse0');
  frames(1.0);
  s.tap('KeyR');
  frames(0.3);
  const clip = s.replay.stopRecording();
  expect(clip).not.toBeNull();
  return clip!;
}

/** 重播並回傳每步的腳底位置（trace 是每個固定步結束時記錄）。 */
function replay(s: ToolSim, clip: InputClip, fps: number): { trace: number[]; result: NonNullable<ToolSim['replay']['lastResult']> } {
  expect(s.replay.load(clip).ok).toBe(true);
  expect(s.replay.startReplay().ok).toBe(true);
  s.trace.length = 0;
  let guard = 0;
  while (s.replay.replaying && guard++ < 100000) s.frame(1 / fps);
  return { trace: s.trace.slice(0, clip.steps * 3), result: s.replay.lastResult! };
}

function maxDiff(a: readonly number[], b: readonly number[]): number {
  expect(a.length).toBe(b.length);
  let m = 0;
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i]! - b[i]!));
  return m;
}

describe('錄影格式', () => {
  it('遊程編碼來回一致；-0、遮罩、不錄的系統鍵', () => {
    const buf = new FrameBuffer();
    const f = createInputFrame();
    const values: [number, number, number, number][] = [
      [0, 0, 0.5, 0.1],
      [-0, 1, 0.5, 0.1],
      [0.70710678118654757, 0.70710678118654757, 0.5000000000000001, 0.1],
      [0.70710678118654757, 0.70710678118654757, 0.5000000000000001, -0.3],
    ];
    for (const [i, [mx, my, yaw, pitch]] of values.entries()) {
      f.move.x = mx;
      f.move.y = my;
      f.yaw = yaw;
      f.pitch = pitch;
      f.held = (ACTION_BIT.moveForward | (i === 1 ? ACTION_BIT.pause : 0) | ACTION_BIT.restartCourse) >>> 0;
      f.pressed = i === 2 ? (ACTION_BIT.jump | ACTION_BIT.recordToggle) >>> 0 : 0;
      f.released = 0;
      buf.push(f);
    }
    const encoded = JSON.parse(JSON.stringify(buf.encode())) as unknown;
    const errors: string[] = [];
    const d = decodeFrames(encoded, values.length, errors);
    expect(errors).toEqual([]);
    for (const [i, [mx, my, yaw, pitch]] of values.entries()) {
      const out = readFrame(d, i, createInputFrame());
      expect(Object.is(out.move.x, mx)).toBe(true);
      expect(out.move.y).toBe(my);
      expect(out.yaw).toBe(yaw);
      expect(out.pitch).toBe(pitch);
      expect(out.held & UNRECORDED_MASK).toBe(0);
      expect(out.held & ACTION_BIT.restartCourse).not.toBe(0);
      expect(out.pressed).toBe(i === 2 ? ACTION_BIT.jump : 0);
    }
  });

  it('驗證：拒絕錯誤格式、較新版本、長度不符', async () => {
    const s = await sim();
    const clip = recordSample(s);
    expect(validateClip(serializeClip(clip)).ok).toBe(true);
    expect(validateClip('{').ok).toBe(false);
    expect(validateClip({ ...clip, format: 'other' }).errors[0]).toContain('不是輸入錄影');
    expect(validateClip({ ...clip, version: 99 }).errors.join()).toContain('請更新遊戲');
    expect(validateClip({ ...clip, steps: clip.steps + 1 }).ok).toBe(false);
    const broken = JSON.parse(serializeClip(clip)) as InputClip;
    broken.start.player.pos = [0, Number.NaN as unknown as number, 0];
    expect(validateClip(JSON.parse(JSON.stringify(broken))).ok).toBe(false);
  });
});

describe('確定性重播', () => {
  it('同一段錄影重播 3 次：逐步軌跡與錄製時一致，最終位置誤差 < 1 mm', async () => {
    const s = await sim();
    s.trace.length = 0;
    const clip = recordSample(s);
    // 錄製時的軌跡：startRecording 之後的步。
    const recorded = s.trace.slice(s.trace.length - clip.steps * 3);
    expect(clip.marks.map((m) => m[1])).toEqual(expect.arrayContaining(['slideStart', 'doubleJump', 'dash']));
    for (let k = 0; k < 3; k++) {
      const { trace, result } = replay(s, clip, 60);
      expect(maxDiff(trace, recorded)).toBe(0);
      expect(result.completed).toBe(true);
      expect(result.finalError).toBeLessThan(0.001);
      expect(result.finalError).toBe(0);
      expect(result.timeDelta).toBe(0);
      expect(result.peakTimeDelta).toBe(0);
      expect(result.marks).toEqual(clip.marks);
    }
  });

  it('不同畫面更新率（60／144／240 Hz、慢動作）重播結果相同', async () => {
    const s = await sim();
    const clip = recordSample(s, 60);
    const base = replay(s, clip, 60).trace;
    expect(maxDiff(replay(s, clip, 144).trace, base)).toBe(0);
    expect(maxDiff(replay(s, clip, 240).trace, base)).toBe(0);
    s.game.loop.timeScale = 0.3;
    expect(maxDiff(replay(s, clip, 60).trace, base)).toBe(0);
    s.game.loop.timeScale = 1;
  });

  it('以 144 Hz 錄製（每畫面 0–1 步、滑鼠在畫面之間）也能逐步重現', async () => {
    const s = await sim();
    s.trace.length = 0;
    const clip = recordSample(s, 144);
    const recorded = s.trace.slice(s.trace.length - clip.steps * 3);
    expect(maxDiff(replay(s, clip, 60).trace, recorded)).toBe(0);
  });

  it('壓槍吸收：錄製時的後座與吸收在重播時完全重現（視角、後座偏移逐步一致）', async () => {
    const s = await sim();
    const views: number[] = [];
    s.game.addSystem({
      name: 'viewTrace',
      order: 1301,
      fixedUpdate: () => views.push(s.input.view.yaw, s.input.view.pitch, s.input.view.offsetYaw, s.input.view.offsetPitch),
    });
    const clip = recordSample(s);
    const rec = views.slice(views.length - clip.steps * 4);
    expect(s.weapons.recoil.absorbed).toBeGreaterThan(0);
    views.length = 0;
    replay(s, clip, 90);
    expect(maxDiff(views.slice(0, clip.steps * 4), rec)).toBe(0);
  });

  it('從另一個模擬（先做過別的事）重播同一段錄影，軌跡仍一致（起始狀態完整）', async () => {
    const a = await sim();
    a.trace.length = 0;
    const clip = JSON.parse(serializeClip(recordSample(a))) as InputClip;
    const recorded = a.trace.slice(a.trace.length - clip.steps * 3);
    const b = await sim();
    // 先在 b 做些不相干的事：跑跳、開火、換槍、滑鏟、Dash。
    b.key('KeyW', true);
    b.run(0.5);
    b.tap('Space');
    b.run(0.2);
    b.tap('ShiftLeft');
    b.key('Mouse0', true);
    b.run(0.4);
    b.key('Mouse0', false);
    b.tap('Digit2');
    b.key('KeyC', true);
    b.run(0.6);
    b.key('KeyC', false);
    b.key('KeyW', false);
    expect(maxDiff(replay(b, clip, 75).trace, recorded)).toBe(0);
  });

  it('改參數後重播：軌跡不同，鬼影時間差與終點差有值；錄影帶錄製時的參數差異', async () => {
    const s = await sim();
    const clip = recordSample(s);
    expect(clip.tuning).toEqual({});
    MOVEMENT_CONFIG.sprintSpeed = 9;
    const r = replay(s, clip, 60).result;
    expect(r.finalError).toBeGreaterThan(0.05);
    expect(Math.abs(r.peakTimeDelta)).toBeGreaterThan(0);
    expect(s.replay.newPath.length).toBeGreaterThan(9);
    // 改了參數後錄的錄影記下差異。
    const clip2 = recordSample(s);
    expect(clip2.tuning.movement).toEqual({ sprintSpeed: 9 });
  });

  it('重播中玩家的按鍵與滑鼠不影響結果；F8／F9 不錄進錄影；重播結束後恢復玩家輸入與模擬頻率', async () => {
    const s = await sim();
    const clip = recordSample(s);
    const base = replay(s, clip, 60).trace;
    s.replay.load(clip);
    s.replay.startReplay();
    s.trace.length = 0;
    s.key('KeyS', true);
    s.turn(1, 0.5);
    while (s.replay.replaying) s.frame(1 / 60);
    expect(maxDiff(s.trace.slice(0, clip.steps * 3), base)).toBe(0);
    expect(s.input.hasFrameSource).toBe(false);
    // 錄製時中途停止也安全。
    s.replay.startReplay();
    s.run(0.2);
    s.replay.stop();
    expect(s.replay.lastResult?.completed).toBe(false);
    expect(s.input.hasFrameSource).toBe(false);
    expect(s.game.loop.config.hz).toBe(120);
  });

  it('以 60 Hz 模擬錄製的錄影，在 120 Hz 的遊戲中重播時暫時切換頻率', async () => {
    const s = await sim();
    s.game.loop.config.hz = 60;
    s.trace.length = 0;
    const clip = recordSample(s);
    const recorded = s.trace.slice(s.trace.length - clip.steps * 3);
    s.game.loop.config.hz = 120;
    expect(clip.hz).toBe(60);
    expect(maxDiff(replay(s, clip, 144).trace, recorded)).toBe(0);
    expect(s.game.loop.config.hz).toBe(120);
  });
});

describe('錄影片段儲存', () => {
  it('具名片段存讀、覆寫、刪除；容量不足時回報且不影響其他存檔', async () => {
    const s = await sim();
    const clip = recordSample(s);
    const store = new Map<string, string>();
    let quota = Number.POSITIVE_INFINITY;
    const backend = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        if (v.length > quota) throw new DOMException('quota', 'QuotaExceededError');
        store.set(k, v);
      },
      removeItem: (k: string) => void store.delete(k),
      key: (i: number) => [...store.keys()][i] ?? null,
      get length() {
        return store.size;
      },
    };
    const storage = new GameStorage({ backend: () => backend });
    const clips = new ClipStore(storage);
    expect(clips.save('跑牆練習', clip)).toMatchObject({ ok: true, persistent: true });
    expect(store.has('shardwake:replay:v1:%E8%B7%91%E7%89%86%E7%B7%B4%E7%BF%92')).toBe(true);
    const again = new ClipStore(storage);
    expect(again.list.map((e) => e.name)).toEqual(['跑牆練習']);
    const read = again.read('跑牆練習');
    expect(read.clip?.steps).toBe(clip.steps);
    quota = 1000;
    const r = again.save('太大', clip);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('容量不足');
    expect(storage.isPersistent).toBe(true);
    storage.setJSON('settings:v1', { version: 1, values: {} });
    expect(store.has('shardwake:settings:v1')).toBe(true);
    expect(again.remove('跑牆練習')).toBe(true);
    expect(new ClipStore(storage).list).toEqual([]);
  });
});

describe('工具函式', () => {
  it('missingSequence：依序出現才算', () => {
    const marks: [number, string][] = [
      [1, 'slideStart'],
      [2, 'dash'],
      [3, 'wallRunStart'],
      [4, 'dash'],
    ];
    expect(missingSequence(marks, ['slideStart', 'wallRunStart', 'dash'])).toBeNull();
    expect(missingSequence(marks, ['wallRunStart', 'slideStart'])).toBe('slideStart');
  });
});
