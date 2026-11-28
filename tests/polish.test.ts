// M1-16：錯誤處理（分類、啟動階段包裝、WebGL 偵測、遊戲迴圈例外防護、錯誤畫面文字）、HUD 更新節流、封面設定、
// 效能修正的回歸（無人機 step 不配置新物件、計時賽環單次繪製）、game.json 內容。
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import {
  classifyError,
  describeError,
  FATAL_KINDS,
  FatalError,
  FrameGuard,
  guessKind,
  probeWebGL2,
  runStage,
} from '@/core/errors';
import { t } from '@/i18n';
import { ZH_TW } from '@/i18n/zh-TW';
import { errorText } from '@/ui/ErrorScreen';
import { UpdateThrottle } from '@/ui/hudMath';
import { HUD_CONFIG } from '@/ui/HudConfig';
import { COVER_CONFIG, coverTitleLayout, coverView, sanitizeCoverConfig } from '@/tools/cover';
import { CourseRings } from '@/tools/ToolVisuals';
import { DroneTarget } from '@/combat/targets/Targets';
import { TARGET_CONFIG } from '@/combat/targets/TargetConfig';
import { Rng } from '@/core/Rng';
import { InstancedAttributes, createQuadGeometry } from '@/fx/instanced';

describe('錯誤分類', () => {
  it('FatalError 保留分類與階段，cause 鏈展開到細節', () => {
    const root = new TypeError('wasm compile failed');
    const err = new FatalError('physics', '物理引擎初始化失敗', { stage: '物理引擎初始化', cause: root });
    const r = classifyError(err);
    expect(r.kind).toBe('physics');
    expect(r.stage).toBe('物理引擎初始化');
    expect(r.detail).toBe('FatalError: 物理引擎初始化失敗\nTypeError: wasm compile failed');
  });

  it('一般錯誤依內容猜測分類，猜不出時用預設', () => {
    expect(guessKind(new Error('Error creating WebGL context.'))).toBe('webgl');
    expect(guessKind(new Error('WebAssembly.instantiate(): out of memory'))).toBe('physics');
    expect(guessKind(new TypeError('Failed to fetch dynamically imported module: ./assets/x.js'))).toBe('load');
    expect(guessKind(new Error('boom'))).toBe('boot');
    expect(guessKind(new Error('boom'), 'runtime')).toBe('runtime');
    expect(classifyError('字串錯誤').detail).toBe('字串錯誤');
    expect(classifyError({ a: 1 }).detail).toBe('{"a":1}');
    expect(describeError(undefined)).toBe('undefined');
  });

  it('runStage：同步丟出與非同步拒絕都轉成帶階段的 FatalError；已分類的錯誤原樣傳遞', async () => {
    await expect(runStage('建立訓練場', 'boot', () => Promise.resolve(42))).resolves.toBe(42);
    const sync = runStage('物理引擎初始化', 'physics', () => {
      throw new Error('bad');
    });
    await expect(sync).rejects.toBeInstanceOf(FatalError);
    await expect(sync).rejects.toMatchObject({ kind: 'physics', stage: '物理引擎初始化' });
    // boot 階段的錯誤若內容看得出是 WebGL，歸類為 webgl。
    await expect(runStage('載入', 'boot', () => Promise.reject(new Error('Error creating WebGL context.')))).rejects.toMatchObject({ kind: 'webgl' });
    const inner = new FatalError('load', 'x');
    await expect(runStage('外層', 'boot', () => Promise.reject(inner))).rejects.toBe(inner);
  });

  it('每種分類都有中文標題與說明', () => {
    for (const k of FATAL_KINDS) {
      const text = errorText(k);
      expect(text.title.length).toBeGreaterThan(2);
      expect(text.body.length).toBeGreaterThan(10);
      expect(text.title).not.toMatch(/^error\./);
    }
    expect(t('error.retry')).toBe('重試');
    // index.html 的靜態載入畫面與這裡的字串一致。
    const html = readFileSync('index.html', 'utf8');
    expect(html).toContain(ZH_TW['boot.loading']);
    expect(html).toContain(ZH_TW['error.retry']);
  });
});

describe('WebGL 2 偵測', () => {
  it('getContext 回傳 null、丟例外都視為不可用；成功時釋放測試用 context', () => {
    expect(probeWebGL2(() => ({ getContext: () => null }))).toEqual({ ok: false, reason: expect.stringContaining('WebGL 2') });
    expect(
      probeWebGL2(() => ({
        getContext: () => {
          throw new Error('blocked');
        },
      })),
    ).toEqual({ ok: false, reason: 'Error: blocked' });
    expect(
      probeWebGL2(() => {
        throw new Error('no canvas');
      }).ok,
    ).toBe(false);
    const lose = vi.fn();
    const gl = { getExtension: (name: string) => (name === 'WEBGL_lose_context' ? { loseContext: lose } : null) };
    expect(probeWebGL2(() => ({ getContext: (type) => (type === 'webgl2' ? gl : null) }))).toEqual({ ok: true, reason: null });
    expect(lose).toHaveBeenCalledOnce();
  });
});

describe('FrameGuard（遊戲迴圈例外防護）', () => {
  it('偶發錯誤只記錄並繼續；連續 N 個畫面出錯才致命，之後不再執行', () => {
    const onFatal = vi.fn();
    const log = vi.fn();
    const guard = new FrameGuard({ maxConsecutive: 3, onFatal, log });
    let calls = 0;
    const ok = (): void => {
      calls++;
    };
    const bad = (): void => {
      calls++;
      throw new Error('frame');
    };
    expect(guard.run(ok)).toBe(true);
    expect(guard.run(bad)).toBe(false);
    expect(guard.run(bad)).toBe(false);
    expect(guard.run(ok)).toBe(true); // 中斷連續計數
    expect(guard.run(bad)).toBe(false);
    expect(guard.run(bad)).toBe(false);
    expect(onFatal).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledTimes(2); // 每串連續錯誤只記第一個
    expect(guard.run(bad)).toBe(false);
    expect(onFatal).toHaveBeenCalledOnce();
    expect(guard.fatal).toBe(true);
    const before = calls;
    expect(guard.run(ok)).toBe(false);
    expect(calls).toBe(before);
    expect(guard.errors).toBe(5);
  });
});

describe('HUD 更新節流', () => {
  it('以 hz 更新並交出累計的 dt；hz = 0 每畫面更新；dt ≤ 0 立即更新', () => {
    const th = new UpdateThrottle();
    const dt = 1 / 240;
    let updates = 0;
    let real = 0;
    let sim = 0;
    for (let i = 0; i < 240; i++) {
      if (th.tick(dt, dt * 0.5, 60)) {
        updates++;
        real += th.out.realDt;
        sim += th.out.dt;
      }
    }
    expect(updates).toBe(60);
    expect(real).toBeCloseTo(1, 9);
    expect(sim).toBeCloseTo(0.5, 9);
    expect(th.tick(dt, dt, 0)).toBe(true);
    expect(th.tick(0, 0, 60)).toBe(true);
    // 低於 hz 時每畫面更新。
    expect(th.tick(1 / 30, 1 / 30, 60)).toBe(true);
    expect(th.out.realDt).toBeCloseTo(1 / 30, 9);
  });

  it('flush 讓下一次立即更新；reset 丟掉累計', () => {
    const th = new UpdateThrottle();
    expect(th.tick(0.001, 0.001, 60)).toBe(false);
    th.flush();
    expect(th.tick(0.001, 0.001, 60)).toBe(true);
    expect(th.out.realDt).toBeCloseTo(0.002, 9);
    expect(th.tick(0.01, 0.01, 60)).toBe(false);
    th.reset();
    expect(th.tick(0.01, 0.01, 60)).toBe(false);
    expect(th.tick(0.007, 0.007, 60)).toBe(true);
    expect(th.out.realDt).toBeCloseTo(0.017, 9);
  });

  it('預設 60 Hz（設定資料，可在調參面板調整）', () => {
    expect(HUD_CONFIG.updateHz).toBe(60);
  });
});

describe('封面設定', () => {
  it('預設輸出 800 × 500、超取樣 2、武器欄位在 0–4', () => {
    const c = sanitizeCoverConfig(COVER_CONFIG);
    expect([c.width, c.height]).toEqual([800, 500]);
    expect(c.supersample).toBe(2);
    expect(c.weaponSlot).toBeGreaterThanOrEqual(0);
    expect(c.weaponSlot).toBeLessThanOrEqual(4);
  });

  it('sanitize 夾住不合法的值，不改原物件', () => {
    const bad = { ...COVER_CONFIG, width: -5, height: Number.NaN, supersample: 9, weaponSlot: 7.6, settleSeconds: -1 };
    const c = sanitizeCoverConfig(bad);
    expect(c).toMatchObject({ width: 16, height: 16, supersample: 2, weaponSlot: 4, settleSeconds: 0 });
    expect(bad.width).toBe(-5);
    expect(c.feet).not.toBe(bad.feet);
  });

  it('視角換算成弧度；名稱疊字的版面隨尺寸縮放', () => {
    const v = coverView({ ...COVER_CONFIG, yawDeg: 90, pitchDeg: -45 });
    expect(v.yaw).toBeCloseTo(Math.PI / 2, 12);
    expect(v.pitch).toBeCloseTo(-Math.PI / 4, 12);
    const a = coverTitleLayout(800, 500);
    const b = coverTitleLayout(1600, 1000);
    expect(b.titleSize).toBe(a.titleSize * 2);
    expect(a.titleY).toBeLessThan(500);
    expect(a.latinY).toBeGreaterThan(a.titleY);
  });
});

describe('效能修正回歸', () => {
  it('計時賽環的透明雙面材質強制單次繪製（避免每畫面重新查著色器程式）', () => {
    const trial = { course: null, run: null } as unknown as ConstructorParameters<typeof CourseRings>[1];
    const rings = new CourseRings(new THREE.Group(), trial);
    for (const m of Object.values(rings.materials)) {
      expect(m.side).toBe(THREE.DoubleSide);
      expect(m.transparent).toBe(true);
      expect(m.forceSinglePass).toBe(true);
    }
  });

  it('無人機 step 重複使用回傳物件', () => {
    const d = new DroneTarget('d0', { x: 0, y: 5, z: 0 }, TARGET_CONFIG.drone, TARGET_CONFIG.flash, null, new Rng('t'), 0);
    d.active = true;
    const bounds = { min: [-20, 2, -20], max: [20, 12, 20] } as const;
    const a = d.step(1 / 120, { x: 5, y: 1, z: 5 }, bounds as never, []);
    const b = d.step(1 / 120, { x: 5, y: 1, z: 5 }, bounds as never, []);
    expect(a).toBe(b);
  });

  it('InstancedAttributes.flush 上傳所有屬性的改動範圍', () => {
    const geo = createQuadGeometry();
    const attrs = new InstancedAttributes(geo, 8, { aA: 3, aB: 1 });
    attrs.touch(2);
    attrs.touch(4);
    attrs.flush();
    for (const name of ['aA', 'aB']) {
      const attr = attrs.attributes[name]!;
      expect(attr.updateRanges).toEqual([{ start: 2 * attr.itemSize, count: 3 * attr.itemSize }]);
      expect(attr.version).toBe(1);
    }
    expect(attrs.dirty).toBe(false);
  });
});

describe('game.json（平台 Manifest）', () => {
  const m = JSON.parse(readFileSync('public/game.json', 'utf8')) as Record<string, unknown>;
  it('必填欄位完整、遊戲 ID 與版本不變、只標 desktop', () => {
    expect(m.id).toBe('shardwake');
    expect(m.version).toBe('0.1.0');
    expect(m.devices).toEqual(['desktop']);
    expect(m.cover).toBe('cover.png');
    for (const k of ['schemaVersion', 'id', 'name', 'version', 'description', 'author', 'entry', 'cover', 'tags', 'instructions', 'devices'])
      expect(m, k).toHaveProperty(k);
  });

  it('tags ≤ 8 個、每個 1–24 字元；description／instructions ≤ 2000 字元', () => {
    const tags = m.tags as string[];
    expect(tags.length).toBeLessThanOrEqual(8);
    for (const tag of tags) {
      expect(tag.length).toBeGreaterThanOrEqual(1);
      expect(tag.length).toBeLessThanOrEqual(24);
    }
    expect((m.description as string).length).toBeLessThanOrEqual(2000);
    expect((m.instructions as string).length).toBeLessThanOrEqual(2000);
  });

  it('操作說明與預設按鍵一致（Dash = Shift、滑鏟 = C、抓鉤 = F、暫停 = Esc）', () => {
    const text = m.instructions as string;
    for (const s of ['WASD', 'Space', 'Shift', 'C', 'F', 'Esc', 'R', '1–5']) expect(text).toContain(s);
  });
});
