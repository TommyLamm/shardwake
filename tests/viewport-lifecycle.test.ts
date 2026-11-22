import { describe, expect, it, vi } from 'vitest';
import { EventBus } from '@/core/EventBus';
import type { GameEvents } from '@/core/events';
import { Game } from '@/core/Game';
import { isEmbedded, Lifecycle, type LifecycleDocument, type LifecycleWindow } from '@/core/Lifecycle';
import { Viewport } from '@/core/Viewport';

function makeViewport(opts: { w: number; h: number; dpr?: number; maxPixelRatio?: number; renderScale?: number }) {
  const container = { clientWidth: opts.w, clientHeight: opts.h } as HTMLElement & {
    clientWidth: number;
    clientHeight: number;
  };
  const calls: string[] = [];
  const renderer = {
    pixelRatio: 0,
    width: 0,
    height: 0,
    setPixelRatio(r: number) {
      this.pixelRatio = r;
      calls.push(`pr ${r}`);
    },
    setSize(w: number, h: number, updateStyle?: boolean) {
      this.width = w;
      this.height = h;
      calls.push(`size ${w}x${h} ${String(updateStyle)}`);
    },
  };
  let roCallback: (() => void) | null = null;
  let disconnected = false;
  let dpr = opts.dpr ?? 1;
  const win = new EventTarget();
  const bus = new EventBus<GameEvents>();
  const resizes: GameEvents['viewport:resize'][] = [];
  bus.on('viewport:resize', (e) => resizes.push(e));
  const viewport = new Viewport({
    container,
    renderer,
    bus,
    config: { maxPixelRatio: opts.maxPixelRatio ?? 1 },
    renderScale: opts.renderScale ?? 1,
    createObserver: (cb) => {
      roCallback = cb;
      return { observe: () => {}, disconnect: () => (disconnected = true) };
    },
    getDevicePixelRatio: () => dpr,
    win,
  });
  return {
    viewport,
    renderer,
    calls,
    resizes,
    win,
    /** 模擬平台改變 iframe 尺寸（ResizeObserver 觸發）。 */
    resize(w: number, h: number) {
      (container as { clientWidth: number }).clientWidth = w;
      (container as { clientHeight: number }).clientHeight = h;
      roCallback?.();
    },
    setDpr(v: number) {
      dpr = v;
    },
    get disconnected() {
      return disconnected;
    },
  };
}

describe('Viewport', () => {
  it('依容器尺寸設定 renderer 與相機比例，不改 canvas 樣式', () => {
    const t = makeViewport({ w: 960, h: 540 });
    const cam = { aspect: 0, updateProjectionMatrix: vi.fn() };
    t.viewport.addCamera(cam);
    expect(t.renderer.width).toBe(960);
    expect(t.renderer.height).toBe(540);
    expect(t.calls).toContain('size 960x540 false');
    expect(cam.aspect).toBeCloseTo(16 / 9, 12);
  });

  it('切換顯示模式（一般 → 沉浸 → 直向小視窗）時跟著更新，比例正確不拉伸', () => {
    const t = makeViewport({ w: 960, h: 540 });
    const cam = { aspect: 0, updateProjectionMatrix: vi.fn() };
    t.viewport.addCamera(cam);
    t.resize(1376, 908);
    expect(cam.aspect).toBeCloseTo(1376 / 908, 12);
    t.resize(400, 700);
    expect(cam.aspect).toBeCloseTo(400 / 700, 12);
    expect(t.renderer.width).toBe(400);
    expect(t.resizes.map((r) => `${r.width}x${r.height}`)).toEqual(['960x540', '1376x908', '400x700']);
    // 尺寸沒變時不重複套用。
    t.resize(400, 700);
    expect(t.resizes).toHaveLength(3);
  });

  it('像素比 = min(dpr, 上限) × 渲染比例；dpr 改變（window resize）時重新套用', () => {
    const t = makeViewport({ w: 800, h: 600, dpr: 2, maxPixelRatio: 1 });
    expect(t.renderer.pixelRatio).toBe(1);
    t.viewport.setRenderScale(0.5);
    expect(t.renderer.pixelRatio).toBe(0.5);
    t.viewport.config.maxPixelRatio = 2;
    t.viewport.refresh();
    expect(t.renderer.pixelRatio).toBe(1);
    t.setDpr(1.5);
    t.win.dispatchEvent(new Event('resize'));
    expect(t.renderer.pixelRatio).toBe(0.75);
  });

  it('容器尺寸為 0 時至少為 1 × 1；dispose 後停止觀察', () => {
    const t = makeViewport({ w: 0, h: 0 });
    expect(t.viewport.width).toBe(1);
    expect(t.viewport.height).toBe(1);
    t.viewport.dispose();
    expect(t.disconnected).toBe(true);
  });
});

function fakeDocWin(opts: { embedded: boolean }) {
  const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' as DocumentVisibilityState });
  const top = {};
  const winTarget = new EventTarget();
  const win = Object.assign(winTarget, { self: winTarget as unknown, top: opts.embedded ? top : (winTarget as unknown) });
  return {
    doc: doc as LifecycleDocument & { visibilityState: DocumentVisibilityState },
    win: win as LifecycleWindow & EventTarget,
    hide() {
      doc.visibilityState = 'hidden';
      doc.dispatchEvent(new Event('visibilitychange'));
    },
    show() {
      doc.visibilityState = 'visible';
      doc.dispatchEvent(new Event('visibilitychange'));
    },
  };
}

describe('Lifecycle', () => {
  it('切分頁（hidden）與失焦時自動暫停，回來時不自動恢復', () => {
    const env = fakeDocWin({ embedded: true });
    const game = new Game();
    game.setMode('title');
    game.start();
    const bus = new EventBus<GameEvents>();
    const vis: boolean[] = [];
    bus.on('lifecycle:visibility', (e) => vis.push(e.hidden));
    const lc = new Lifecycle({ doc: env.doc, win: env.win, bus, onAutoPause: (r) => game.pause(r) });
    env.hide();
    expect(game.mode).toBe('paused');
    expect(game.pauseReason).toBe('hidden');
    env.show();
    expect(game.mode).toBe('paused');
    expect(vis).toEqual([true, false]);
    game.resume();
    env.win.dispatchEvent(new Event('blur'));
    expect(game.mode).toBe('paused');
    expect(game.pauseReason).toBe('blur');
    lc.dispose();
    game.resume();
    env.hide();
    expect(game.mode).toBe('playing');
  });

  it('切分頁 30 秒再回來：暫停中不推進模擬，恢復後第一個畫面不爆衝', () => {
    const env = fakeDocWin({ embedded: true });
    const game = new Game();
    let x = 0;
    game.addSystem({ name: 'mover', fixedUpdate: (dt) => (x += 10 * dt) });
    const lc = new Lifecycle({ doc: env.doc, win: env.win, onAutoPause: (r) => game.pause(r) });
    game.setMode('title');
    game.start();
    let now = 0;
    for (let i = 0; i < 60; i++) game.frame((now += 1000 / 60));
    const before = x;
    env.hide();
    now += 30_000; // 分頁隱藏期間沒有畫面（rAF 停止）
    env.show();
    game.frame(now); // 回來後的第一個畫面（dt 被夾住，且仍在暫停）
    expect(x).toBe(before);
    game.resume();
    const steps = game.frame((now += 1000 / 60));
    expect(steps).toBeLessThanOrEqual(2);
    expect(x - before).toBeLessThan(0.2);
    lc.dispose();
  });

  it('isEmbedded：比較 self 與 top 的參考；丟例外時視為嵌入', () => {
    expect(isEmbedded(fakeDocWin({ embedded: true }).win)).toBe(true);
    expect(isEmbedded(fakeDocWin({ embedded: false }).win)).toBe(false);
    const throwing = {
      self: {},
      get top(): unknown {
        throw new Error('SecurityError');
      },
    };
    expect(isEmbedded(throwing)).toBe(true);
  });
});
