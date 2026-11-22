import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  DebugPanel,
  hasHashFlag,
  parseFolderPath,
  toBindingParams,
  type PaneBinding,
  type PaneFolder,
  type PaneRoot,
} from '@/debug/DebugPanel';
import { FrameTimeSampler, formatFrameSample } from '@/debug/Stats';

// ── 最小 DOM 替身（測試環境為 Node）─────────────────────
class FakeElement {
  className = '';
  hidden = false;
  textContent = '';
  title = '';
  children: FakeElement[] = [];
  appendChild(c: FakeElement) {
    this.children.push(c);
    return c;
  }
  remove() {}
}

const originalDocument = (globalThis as { document?: unknown }).document;
beforeAll(() => {
  (globalThis as { document?: unknown }).document = { createElement: () => new FakeElement() };
});
afterAll(() => {
  (globalThis as { document?: unknown }).document = originalDocument;
});

/** 假的 Tweakpane：記錄資料夾與綁定，可模擬使用者修改值。 */
class FakeFolder implements PaneFolder {
  folders: FakeFolder[] = [];
  bindings: FakeBinding[] = [];
  blades: Record<string, unknown>[] = [];
  disposed = false;
  constructor(readonly title: string) {}
  addFolder(params: { title: string }) {
    const f = new FakeFolder(params.title);
    this.folders.push(f);
    return f;
  }
  addBinding(obj: object, key: string, params?: Record<string, unknown>) {
    const b = new FakeBinding(obj as Record<string, unknown>, key, params ?? {});
    this.bindings.push(b);
    return b;
  }
  addBlade(params: Record<string, unknown>) {
    this.blades.push(params);
    return { begin: vi.fn(), end: vi.fn() };
  }
  refresh() {}
  dispose() {
    this.disposed = true;
  }
  find(path: string): FakeFolder | undefined {
    let cur: FakeFolder | undefined = this;
    for (const name of path.split('/')) cur = cur?.folders.find((f) => f.title === name);
    return cur;
  }
}

class FakeBinding implements PaneBinding {
  handlers: ((ev: { value: unknown }) => void)[] = [];
  disposed = false;
  refreshed = 0;
  readonly element = new FakeElement() as unknown as HTMLElement;
  constructor(
    readonly obj: Record<string, unknown>,
    readonly key: string,
    readonly params: Record<string, unknown>,
  ) {}
  on(_ev: 'change', h: (ev: { value: unknown }) => void) {
    this.handlers.push(h);
    return this;
  }
  /** 模擬使用者在面板上改值（Tweakpane 先寫回物件再發 change）。 */
  userSet(value: unknown) {
    this.obj[this.key] = value;
    for (const h of this.handlers) h({ value });
  }
  refresh() {
    this.refreshed++;
  }
  dispose() {
    this.disposed = true;
  }
}

class FakePane extends FakeFolder implements PaneRoot {
  hidden = false;
}

function makePanel() {
  const pane = new FakePane('root');
  const loader = vi.fn(async () => pane as PaneRoot);
  const container = new FakeElement() as unknown as HTMLElement;
  const panel = new DebugPanel({ container, loader, win: null, listenKey: false, listenHash: false });
  return { pane, loader, panel };
}

describe('DebugPanel 輔助函式', () => {
  it('toBindingParams 轉換範圍、步進、選項與唯讀', () => {
    expect(toBindingParams('speed', { min: 0, max: 10, step: 0.5 })).toEqual({
      label: 'speed',
      min: 0,
      max: 10,
      step: 0.5,
    });
    expect(toBindingParams('q', { label: '畫質', options: { 低: 'low' } })).toEqual({
      label: '畫質',
      options: { 低: 'low' },
    });
    expect(toBindingParams('n', { readonly: true }, { monitorIntervalMs: 123, fpsGraphRows: 2 })).toEqual({
      label: 'n',
      readonly: true,
      interval: 123,
    });
  });

  it('parseFolderPath 與 hasHashFlag', () => {
    expect(parseFolderPath(' 移動 / 地面 /')).toEqual(['移動', '地面']);
    expect(hasHashFlag('#debug', 'debug')).toBe(true);
    expect(hasHashFlag('#demo&debug', 'debug')).toBe(true);
    expect(hasHashFlag('#debug=1', 'debug')).toBe(true);
    expect(hasHashFlag('#debugger', 'debug')).toBe(false);
    expect(hasHashFlag('', 'debug')).toBe(false);
  });
});

describe('DebugPanel.bindConfig', () => {
  it('開啟前註冊的參數，在第一次開啟（延遲載入）時建立；之後註冊的立即建立', async () => {
    const { pane, loader, panel } = makePanel();
    const cfg = { maxSpeed: 9, accel: 50, hidden: 1 };
    panel.bindConfig('移動/地面', cfg, {
      maxSpeed: { min: 0, max: 20, step: 0.1, description: '最高速度' },
      accel: { min: 0, max: 200 },
    });
    expect(loader).not.toHaveBeenCalled();
    await panel.open();
    expect(loader).toHaveBeenCalledOnce();
    expect(panel.isOpen).toBe(true);
    const ground = pane.find('移動/地面')!;
    expect(ground.bindings.map((b) => b.key)).toEqual(['maxSpeed', 'accel']);
    expect(ground.bindings[0]!.params).toMatchObject({ min: 0, max: 20, step: 0.1 });
    expect((ground.bindings[0]!.element as unknown as FakeElement).title).toBe('最高速度');
    // 效能資料夾有 FPS 圖與 renderer.info 監看。
    const perf = pane.find('效能')!;
    expect(perf.blades[0]).toMatchObject({ view: 'fpsgraph' });
    expect(perf.bindings.map((b) => b.key)).toEqual(['drawCalls', 'triangles', 'geometries', 'textures', 'steps', 'mode']);

    const air = { gravity: 20 };
    panel.bindConfig('移動/空中', air, { gravity: { min: 0, max: 60 } });
    expect(pane.find('移動')!.folders.map((f) => f.title)).toEqual(['地面', '空中']);
    await panel.open();
    expect(loader).toHaveBeenCalledOnce();
  });

  it('面板修改直接寫回物件並呼叫 onChange；refresh／dispose 有效', async () => {
    const { pane, panel } = makePanel();
    const cfg = { fov: 103 };
    const onChange = vi.fn();
    const handle = panel.bindConfig('鏡頭', cfg, { fov: { min: 80, max: 120 } }, { onChange });
    await panel.open();
    const b = pane.find('鏡頭')!.bindings[0]!;
    b.userSet(110);
    expect(cfg.fov).toBe(110);
    expect(onChange).toHaveBeenCalledWith('fov', 110);
    handle.refresh();
    expect(b.refreshed).toBe(1);
    handle.dispose();
    expect(b.disposed).toBe(true);
    expect(panel.registeredFolders).toEqual([]);
  });

  it('render 階段更新 renderer.info 監看值', async () => {
    const pane = new FakePane('root');
    const container = new FakeElement() as unknown as HTMLElement;
    const panel = new DebugPanel({
      container,
      loader: async () => pane,
      win: null,
      listenKey: false,
      listenHash: false,
      getRenderInfo: () => ({ render: { calls: 12, triangles: 3400 }, memory: { geometries: 5, textures: 2 } }),
    });
    await panel.open();
    panel.render(0.5, { frame: 1, realDt: 0.01, dt: 0.01, steps: 1, alpha: 0.5, simTime: 0, mode: 'playing' });
    expect(panel.perf).toMatchObject({ drawCalls: 12, triangles: 3400, geometries: 5, textures: 2, steps: 1, mode: 'playing' });
    panel.close();
    expect(panel.isOpen).toBe(false);
  });

  it('沒有資料夾名稱時丟出錯誤；不存在的欄位略過', async () => {
    const { pane, panel } = makePanel();
    expect(() => panel.bindConfig(' / ', {}, {})).toThrow();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    panel.bindConfig('x', { a: 1 } as { a: number; b?: number }, { a: {}, b: {} });
    await panel.open();
    expect(pane.find('x')!.bindings.map((b) => b.key)).toEqual(['a']);
    warn.mockRestore();
  });
});

describe('FrameTimeSampler', () => {
  it('取樣視窗結束時計算平均 FPS、frame time、最長間隔與 CPU 時間', () => {
    const s = new FrameTimeSampler({ sampleMs: 500 });
    let t = 0;
    expect(s.record(t, 0)).toBe(false);
    let done = false;
    for (let i = 0; i < 200 && !done; i++) {
      t += i === 10 ? 25 : 1000 / 144;
      done = s.record(t, 2);
    }
    expect(done).toBe(true);
    expect(s.latest.fps).toBeGreaterThan(130);
    expect(s.latest.fps).toBeLessThan(144);
    expect(s.latest.maxFrameMs).toBeCloseTo(25, 9);
    expect(s.latest.cpuMs).toBeCloseTo(2, 9);
    expect(formatFrameSample(s.latest)).toMatch(/^FPS +\d+ +\d+\.\d\d ms\nmax 25\.0 ms {2}cpu 2\.00 ms$/);
  });

  it('reset 後不把離開的時間算進去', () => {
    const s = new FrameTimeSampler({ sampleMs: 100 });
    s.record(0);
    s.record(10);
    s.reset();
    s.record(30_000);
    for (let i = 1; i <= 20; i++) s.record(30_000 + i * 10);
    expect(s.latest.maxFrameMs).toBeCloseTo(10, 9);
    expect(s.latest.fps).toBeCloseTo(100, 6);
  });
});
