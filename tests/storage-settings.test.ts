import { describe, expect, it, vi } from 'vitest';
import { EventBus } from '@/core/EventBus';
import type { GameEvents } from '@/core/events';
import {
  defaultSettings,
  parseSettings,
  SETTINGS_KEY,
  SETTINGS_SCHEMA,
  SETTINGS_VERSION,
  SettingsStore,
} from '@/core/Settings';
import { GameStorage, type StorageBackend } from '@/core/Storage';

/** 記憶體版 localStorage；可設定讓某些操作丟例外。 */
class FakeLocalStorage implements StorageBackend {
  data = new Map<string, string>();
  failGet = false;
  failSet = false;
  failRemove = false;
  get length() {
    return this.data.size;
  }
  key(i: number) {
    return [...this.data.keys()][i] ?? null;
  }
  getItem(k: string) {
    if (this.failGet) throw new DOMExceptionLike('SecurityError');
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    if (this.failSet) throw new DOMExceptionLike('QuotaExceededError');
    this.data.set(k, v);
  }
  removeItem(k: string) {
    if (this.failRemove) throw new DOMExceptionLike('SecurityError');
    this.data.delete(k);
  }
}

class DOMExceptionLike extends Error {
  constructor(name: string) {
    super(name);
    this.name = name;
  }
}

function quietStorage(opts: ConstructorParameters<typeof GameStorage>[0]) {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const s = new GameStorage(opts);
  return { s, warn };
}

describe('GameStorage', () => {
  it('key 加上 shardwake: 前綴，讀寫 JSON', () => {
    const ls = new FakeLocalStorage();
    const s = new GameStorage({ backend: () => ls });
    expect(s.isPersistent).toBe(true);
    expect(s.setJSON('test:v1', { a: 1 })).toBe(true);
    expect(ls.data.get('shardwake:test:v1')).toBe('{"a":1}');
    expect(s.getJSON('test:v1')).toEqual({ a: 1 });
    expect(s.keys()).toEqual(['test:v1']);
    s.remove('test:v1');
    expect(s.getJSON('test:v1', 'fallback')).toBe('fallback');
    expect(ls.data.has('shardwake:__probe__')).toBe(false);
  });

  it('key 必須帶版本且不含前綴', () => {
    const s = new GameStorage({ backend: () => new FakeLocalStorage() });
    expect(() => s.getString('settings')).toThrow();
    expect(() => s.getString('shardwake:settings:v1')).toThrow();
    expect(() => s.getString('replay:v1:my-run')).not.toThrow();
  });

  it('取用 localStorage 本身丟例外（sandbox）時退回記憶體，仍可讀寫', () => {
    const { s, warn } = quietStorage({
      backend: () => {
        throw new DOMExceptionLike('SecurityError');
      },
    });
    expect(s.isPersistent).toBe(false);
    expect(s.reason).toContain('SecurityError');
    expect(s.setJSON('settings:v1', { x: 2 })).toBe(false);
    expect(s.getJSON('settings:v1')).toEqual({ x: 2 });
    expect(s.keys()).toEqual(['settings:v1']);
    warn.mockRestore();
  });

  it('localStorage 不存在時退回記憶體', () => {
    const { s, warn } = quietStorage({ backend: () => null });
    expect(s.isPersistent).toBe(false);
    s.setString('a:v1', 'x');
    expect(s.getString('a:v1')).toBe('x');
    warn.mockRestore();
  });

  it('localStorage 讀寫都丟例外時，Storage 仍可讀寫（記憶體）', () => {
    const ls = new FakeLocalStorage();
    const { s, warn } = quietStorage({ backend: () => ls });
    ls.failGet = true;
    ls.failSet = true;
    ls.failRemove = true;
    expect(s.setJSON('settings:v1', { v: 1 })).toBe(false);
    expect(s.getJSON('settings:v1')).toEqual({ v: 1 });
    s.remove('settings:v1');
    expect(s.getJSON('settings:v1')).toBeNull();
    expect(s.isPersistent).toBe(false);
    warn.mockRestore();
  });

  it('寫入失敗（配額已滿）時退回記憶體並通知；之後可寫時恢復持久', () => {
    const ls = new FakeLocalStorage();
    const status: boolean[] = [];
    const { s, warn } = quietStorage({ backend: () => ls, onStatusChange: (p) => status.push(p) });
    ls.failSet = true;
    expect(s.setString('big:v1', 'x'.repeat(10))).toBe(false);
    expect(s.isPersistent).toBe(false);
    expect(s.getString('big:v1')).toBe('x'.repeat(10));
    ls.failSet = false;
    // big:v1 仍只在記憶體，寫入其他 key 不恢復持久狀態。
    s.setString('other:v1', '1');
    expect(s.isPersistent).toBe(false);
    s.setString('big:v1', 'small');
    expect(s.isPersistent).toBe(true);
    expect(ls.data.get('shardwake:big:v1')).toBe('small');
    expect(status).toEqual([false, true]);
    warn.mockRestore();
  });

  it('JSON 解析失敗時回傳 fallback，不覆寫原始資料', () => {
    const ls = new FakeLocalStorage();
    ls.data.set('shardwake:save:v1', '{broken');
    const { s, warn } = quietStorage({ backend: () => ls });
    expect(s.getJSON('save:v1', { ok: false })).toEqual({ ok: false });
    expect(ls.data.get('shardwake:save:v1')).toBe('{broken');
    expect(s.isPersistent).toBe(true);
    warn.mockRestore();
  });

  it('只列出本遊戲前綴的 key', () => {
    const ls = new FakeLocalStorage();
    ls.data.set('other-game:save:v1', '1');
    ls.data.set('shardwake:a:v1', '1');
    const s = new GameStorage({ backend: () => ls });
    expect(s.keys()).toEqual(['a:v1']);
  });
});

describe('Settings', () => {
  const memStorage = () => new GameStorage({ backend: () => new FakeLocalStorage() });

  it('預設值來自欄位規格，key 為 shardwake:settings:v1', () => {
    const d = defaultSettings();
    expect(d.fovHorizontal).toBe(103);
    expect(d.quality).toBe('high');
    for (const key of Object.keys(SETTINGS_SCHEMA) as (keyof typeof SETTINGS_SCHEMA)[]) {
      expect(d[key]).toBe(SETTINGS_SCHEMA[key].default);
    }
    expect(`shardwake:${SETTINGS_KEY}`).toBe('shardwake:settings:v1');
  });

  it('變更會驗證、存檔並發出事件；重新載入後保留', () => {
    const ls = new FakeLocalStorage();
    const storage = new GameStorage({ backend: () => ls });
    const bus = new EventBus<GameEvents>();
    const events: string[][] = [];
    bus.on('settings:changed', (e) => events.push([...e.changed]));
    const store = new SettingsStore(storage, bus);
    expect(store.update({ fovHorizontal: 200, sensitivity: 3.5 })).toEqual(['fovHorizontal', 'sensitivity']);
    expect(store.get('fovHorizontal')).toBe(120); // 夾在範圍內
    expect(store.set('quality', 'nope' as never)).toBe(false); // 不合法的值忽略
    expect(store.set('sensitivity', 3.5)).toBe(false); // 沒有改變
    expect(events).toEqual([['fovHorizontal', 'sensitivity']]);
    const saved = JSON.parse(ls.data.get('shardwake:settings:v1')!);
    expect(saved).toMatchObject({ version: SETTINGS_VERSION, values: { fovHorizontal: 120, sensitivity: 3.5 } });
    const reloaded = new SettingsStore(new GameStorage({ backend: () => ls }));
    expect(reloaded.get('sensitivity')).toBe(3.5);
    expect(reloaded.qualityPreset.renderScale).toBe(1);
  });

  it('reset 恢復預設', () => {
    const store = new SettingsStore(memStorage());
    store.update({ showFps: false, masterVolume: 0.1 });
    const listener = vi.fn();
    store.onChange(listener);
    expect(store.reset().sort()).toEqual(['masterVolume', 'showFps']);
    expect(store.value).toEqual(defaultSettings());
    expect(listener).toHaveBeenCalledOnce();
  });

  it('解析：缺少欄位補預設、不合法值修正、未知欄位保留', () => {
    const p = parseSettings({ version: 1, values: { sensitivity: 'fast', fovHorizontal: 90, futureField: 42 } });
    expect(p.settings.sensitivity).toBe(SETTINGS_SCHEMA.sensitivity.default);
    expect(p.settings.fovHorizontal).toBe(90);
    expect(p.extra).toEqual({ futureField: 42 });
    expect(p.dirty).toBe(true);
    expect(parseSettings(null).dirty).toBe(false);
    expect(parseSettings('garbage').settings).toEqual(defaultSettings());
  });

  it('版本遷移依序套用（以假設的版本 3 驗證遷移鏈）', () => {
    const order: number[] = [];
    const migrations = {
      // 1 → 2：舊的垂直 fov 欄位改名為 fovHorizontal（假設情境）。
      1: (v: Record<string, unknown>) => {
        order.push(1);
        const { fov, ...rest } = v;
        return { ...rest, fovHorizontal: fov };
      },
      // 2 → 3：音量由 0–100 改成 0–1（假設情境）。
      2: (v: Record<string, unknown>) => {
        order.push(2);
        return { ...v, masterVolume: Number(v.masterVolume) / 100 };
      },
    };
    const p = parseSettings({ version: 1, values: { fov: 95, masterVolume: 50 } }, migrations, 3);
    expect(order).toEqual([1, 2]);
    expect(p.version).toBe(3);
    expect(p.settings.fovHorizontal).toBe(95);
    expect(p.settings.masterVolume).toBe(0.5);
    expect(p.extra).toEqual({});
    expect(p.dirty).toBe(true);
    // 已是目前版本的資料不跑遷移。
    order.length = 0;
    parseSettings({ version: 3, values: {} }, migrations, 3);
    expect(order).toEqual([]);
  });

  it('較新版本寫入的資料：讀取認得的欄位，存檔時保留未知欄位與版本號', () => {
    const ls = new FakeLocalStorage();
    ls.data.set(
      'shardwake:settings:v1',
      JSON.stringify({ version: SETTINGS_VERSION + 1, values: { sensitivity: 4, newThing: 'keep' } }),
    );
    const store = new SettingsStore(new GameStorage({ backend: () => ls }));
    expect(store.get('sensitivity')).toBe(4);
    store.set('showFps', false);
    const saved = JSON.parse(ls.data.get('shardwake:settings:v1')!);
    expect(saved.version).toBe(SETTINGS_VERSION + 1);
    expect(saved.values.newThing).toBe('keep');
    expect(saved.values.showFps).toBe(false);
  });

  it('儲存不可用時設定照常運作（只保存在記憶體）', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const storage = new GameStorage({
      backend: () => {
        throw new DOMExceptionLike('SecurityError');
      },
    });
    const store = new SettingsStore(storage);
    expect(store.set('masterVolume', 0.3)).toBe(true);
    expect(store.get('masterVolume')).toBe(0.3);
    expect(new SettingsStore(storage).get('masterVolume')).toBe(0.3);
    expect(storage.isPersistent).toBe(false);
    warn.mockRestore();
  });
});
