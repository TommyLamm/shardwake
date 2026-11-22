import { describe, expect, it, vi } from 'vitest';
import { EventBus } from '@/core/EventBus';
import type { GameEvents } from '@/core/events';
import { defaultSettings } from '@/core/Settings';
import { GameStorage, type StorageBackend } from '@/core/Storage';
import { ACTIONS } from '@/input/Actions';
import {
  BINDINGS_KEY,
  Bindings,
  CTRL_WARNING,
  DEFAULT_BINDINGS,
  isValidCode,
  keyName,
  parseBindings,
} from '@/input/Bindings';
import { cmPer360, MouseLook, sensitivityForCmPer360, SpikeFilter, ViewAngles, wrapAngle } from '@/input/Mouse';

class MemoryBackend implements StorageBackend {
  data = new Map<string, string>();
  get length() {
    return this.data.size;
  }
  key(i: number) {
    return [...this.data.keys()][i] ?? null;
  }
  getItem(k: string) {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.data.set(k, v);
  }
  removeItem(k: string) {
    this.data.delete(k);
  }
}

function makeStorage(backend = new MemoryBackend()) {
  return { backend, storage: new GameStorage({ backend: () => backend }) };
}

const DEG = Math.PI / 180;

describe('Bindings：預設值', () => {
  it('依 design.md 操作表', () => {
    const b = new Bindings();
    expect(b.get('moveForward')).toEqual(['KeyW']);
    expect(b.get('jump')).toEqual(['Space']);
    expect(b.get('crouch')).toEqual(['KeyC']); // 預設不用 Ctrl
    expect(b.get('dash')).toEqual(['ShiftLeft']);
    expect(b.get('grapple')).toEqual(['KeyF']);
    expect(b.get('fire')).toEqual(['Mouse0']);
    expect(b.get('ads')).toEqual(['Mouse2']);
    expect(b.get('weaponLast')).toEqual(['KeyQ']);
    expect(b.get('weaponNext')).toEqual(['WheelDown']);
    expect(b.get('pause')).toEqual(['Escape']);
    expect(b.get('debugPanel')).toEqual(['Backquote']);
    expect(b.get('recordToggle')).toEqual(['F8']);
    expect(b.get('replayToggle')).toEqual(['F9']);
    expect(b.get('restartCourse')).toEqual(['KeyT']);
    expect(b.get('sprint')).toEqual([]);
  });

  it('預設綁定沒有重複代碼，每個動作 ≤ 2 組', () => {
    const all = ACTIONS.flatMap((a) => [...DEFAULT_BINDINGS[a]]);
    expect(new Set(all).size).toBe(all.length);
    for (const a of ACTIONS) expect(DEFAULT_BINDINGS[a].length).toBeLessThanOrEqual(2);
    const b = new Bindings();
    expect(b.actionsFor('KeyW')).toEqual(['moveForward']);
    expect(b.actionsFor('KeyZ')).toEqual([]);
  });
});

describe('Bindings：綁定規則', () => {
  it('衝突偵測：預設拒絕並回報衝突；replace 時從原動作移除', () => {
    const b = new Bindings();
    const r = b.bind('jump', 1, 'KeyW');
    expect(r.ok).toBe(false);
    expect(r.error).toBe('conflict');
    expect(r.conflicts).toEqual([{ action: 'moveForward', slot: 0 }]);
    expect(b.get('jump')).toEqual(['Space']);
    const r2 = b.bind('jump', 1, 'KeyW', { replace: true });
    expect(r2.ok).toBe(true);
    expect(b.get('jump')).toEqual(['Space', 'KeyW']);
    expect(b.get('moveForward')).toEqual([]);
    expect(b.actionsFor('KeyW')).toEqual(['jump']);
  });

  it('每個動作最多 2 組；第 0 格覆寫；同動作換格不算衝突', () => {
    const b = new Bindings();
    expect(b.bind('jump', 2, 'KeyJ').error).toBe('slot');
    expect(b.bind('jump', 1, 'KeyJ').ok).toBe(true);
    expect(b.bind('jump', 0, 'KeyJ').ok).toBe(true);
    expect(b.get('jump')).toEqual(['KeyJ']);
    expect(b.bind('jump', 1, 'Space').ok).toBe(true);
    expect(b.get('jump')).toEqual(['KeyJ', 'Space']);
    expect(b.bind('jump', 0, 'KeyK').ok).toBe(true);
    expect(b.get('jump')).toEqual(['KeyK', 'Space']);
  });

  it('拒絕瀏覽器保留鍵 F1、F3、F5、F6、F7、F10、F11、F12；F8／F9 可用', () => {
    const b = new Bindings();
    for (const code of ['F1', 'F3', 'F5', 'F6', 'F7', 'F10', 'F11', 'F12']) {
      expect(b.bind('reload', 1, code).error, code).toBe('reserved');
    }
    b.unbind('recordToggle', 0);
    expect(b.bind('reload', 1, 'F8').ok).toBe(true);
  });

  it('Escape 只能綁暫停；不合法代碼拒絕', () => {
    const b = new Bindings();
    expect(b.bind('jump', 1, 'Escape').error).toBe('reserved');
    expect(b.bind('jump', 1, '').error).toBe('invalid');
    expect(b.bind('jump', 1, 'Unidentified').error).toBe('invalid');
    expect(b.bind('jump', 1, 'Mouse7').error).toBe('invalid');
    expect(isValidCode('Mouse4')).toBe(true);
    expect(isValidCode('WheelUp')).toBe(true);
    expect(isValidCode('Numpad5')).toBe(true);
  });

  it('綁 Ctrl 時提示「Ctrl+W 會關閉分頁」', () => {
    const b = new Bindings();
    const r = b.bind('crouch', 1, 'ControlLeft');
    expect(r.ok).toBe(true);
    expect(r.warning).toBe(CTRL_WARNING);
    expect(r.warning).toContain('Ctrl+W');
  });

  it('unbind 與 reset（單一動作時跳過被占用的預設鍵）', () => {
    const b = new Bindings();
    b.bind('jump', 0, 'KeyJ');
    b.bind('melee', 0, 'Space');
    b.reset('jump');
    expect(b.get('jump')).toEqual([]); // Space 已被近戰占用
    b.reset();
    expect(b.get('jump')).toEqual(['Space']);
    expect(b.unbind('jump', 0)).toBe(true);
    expect(b.unbind('jump', 0)).toBe(false);
  });

  it('變更時通知（onChange 與 input:bindings 事件）', () => {
    const bus = new EventBus<GameEvents>();
    const onBus = vi.fn();
    bus.on('input:bindings', onBus);
    const b = new Bindings({ bus });
    const onChange = vi.fn();
    b.onChange(onChange);
    b.bind('jump', 1, 'KeyJ');
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onBus).toHaveBeenCalledTimes(1);
  });
});

describe('Bindings：顯示名稱', () => {
  it('keyName 與 labelFor', () => {
    expect(keyName('KeyW')).toBe('W');
    expect(keyName('Digit3')).toBe('3');
    expect(keyName('Space')).toBe('空白鍵');
    expect(keyName('ShiftLeft')).toBe('左 Shift');
    expect(keyName('Mouse0')).toBe('滑鼠左鍵');
    expect(keyName('WheelDown')).toBe('滾輪下');
    expect(keyName('Numpad7')).toBe('數字鍵 7');
    expect(keyName('Backquote')).toBe('`');
    expect(keyName('F8')).toBe('F8');
    const b = new Bindings();
    b.bind('weapon1', 1, 'WheelUp', { replace: true });
    expect(b.labelFor('weapon1')).toBe('1／滾輪上');
    expect(b.labelFor('sprint')).toBe('未綁定');
    expect(b.actionLabel('crouch')).toBe('蹲下／滑鏟');
  });
});

describe('Bindings：存讀', () => {
  it('存在 shardwake:bindings:v1，重新讀取保留', () => {
    const { backend, storage } = makeStorage();
    const b = new Bindings({ storage });
    b.bind('jump', 1, 'KeyJ');
    const raw = JSON.parse(backend.data.get(`shardwake:${BINDINGS_KEY}`)!);
    expect(raw.version).toBe(1);
    expect(raw.values.jump).toEqual(['Space', 'KeyJ']);
    const again = new Bindings({ storage: new GameStorage({ backend: () => backend }) });
    expect(again.get('jump')).toEqual(['Space', 'KeyJ']);
  });

  it('不合法內容回到預設；不認識的動作保留並寫回', () => {
    expect(parseBindings('garbage').map).toEqual(new Bindings().toMap());
    expect(parseBindings('garbage').dirty).toBe(true);
    expect(parseBindings(null).dirty).toBe(false);
    const { backend, storage } = makeStorage();
    backend.setItem(
      `shardwake:${BINDINGS_KEY}`,
      JSON.stringify({ version: 1, values: { futureAction: ['KeyG'], jump: ['F5', 'KeyJ', 'KeyK', 'KeyL'] } }),
    );
    const b = new Bindings({ storage });
    expect(b.get('jump')).toEqual(['KeyJ', 'KeyK']);
    const raw = JSON.parse(backend.data.get(`shardwake:${BINDINGS_KEY}`)!);
    expect(raw.values.futureAction).toEqual(['KeyG']);
  });

  it('存檔缺少的動作補預設值，但跳過已被玩家綁走的代碼；重複代碼先到先得', () => {
    // 動作清單順序：reload 在 melee 之前，所以 KeyQ 歸 reload。
    const p = parseBindings({ version: 1, values: { melee: ['KeyQ', 'KeyV'], reload: ['KeyQ', 'KeyR'] } });
    expect(p.map.reload).toEqual(['KeyQ', 'KeyR']);
    expect(p.map.melee).toEqual(['KeyV']);
    expect(p.map.weaponLast).toEqual([]); // 缺少的動作：預設 Q 已被換彈占用
    expect(p.map.jump).toEqual(['Space']);
    expect(p.dirty).toBe(true);
  });
});

describe('Settings：輸入欄位', () => {
  it('預設值', () => {
    const s = defaultSettings();
    expect(s.sensitivity).toBe(2);
    expect(s.mouseDpi).toBe(800);
    expect(s.invertY).toBe(false);
    expect([s.crouchMode, s.adsMode, s.grappleMode]).toEqual(['hold', 'hold', 'hold']);
    expect(s.autoSprint).toBe(true);
  });
});

describe('滑鼠視角', () => {
  it('cm/360 換算（Source 尺度）與反推', () => {
    // 靈敏度 1、800 DPI：360 / 0.022 = 16363.6 count = 20.45 吋 = 51.95 cm
    expect(cmPer360(1, 800)).toBeCloseTo(51.95, 2);
    expect(cmPer360(2, 800)).toBeCloseTo(25.977, 2);
    expect(sensitivityForCmPer360(cmPer360(1.37, 1600), 1600)).toBeCloseTo(1.37, 10);
  });

  it('每 count 0.022° × 靈敏度，不平滑、不加速；右移 yaw 減少、上移 pitch 增加', () => {
    const m = new MouseLook();
    const v = new ViewAngles();
    m.accumulate(50, 0, true);
    m.accumulate(50, -10, true);
    m.applyFrame(v, { sensitivity: 2, invertY: false });
    expect(v.yaw / DEG).toBeCloseTo(-100 * 0.022 * 2, 10);
    expect(v.pitch / DEG).toBeCloseTo(10 * 0.022 * 2, 10);
    // 線性：分成很多小事件與一次大事件結果相同
    const a = new ViewAngles();
    const b = new ViewAngles();
    for (let i = 0; i < 100; i++) m.accumulate(3, 0, true);
    m.applyFrame(a, { sensitivity: 1.5, invertY: false });
    m.accumulate(300, 0, true);
    m.applyFrame(b, { sensitivity: 1.5, invertY: false });
    expect(a.yaw).toBeCloseTo(b.yaw, 12);
    // 套用後清空
    m.applyFrame(b, { sensitivity: 1.5, invertY: false });
    expect(m.lastCounts).toEqual({ x: 0, y: 0 });
  });

  it('Y 軸反轉、額外倍率、discard', () => {
    const m = new MouseLook();
    const v = new ViewAngles();
    m.accumulate(0, -100, true);
    m.applyFrame(v, { sensitivity: 1, invertY: true });
    expect(v.pitch / DEG).toBeCloseTo(-2.2, 10);
    m.scale = 0.5;
    m.accumulate(100, 0, true);
    m.applyFrame(v, { sensitivity: 1, invertY: false });
    expect(v.yaw / DEG).toBeCloseTo(-1.1, 10);
    m.accumulate(100, 100, true);
    m.discard();
    expect(m.pending).toEqual({ x: 0, y: 0 });
  });

  it('pitch 夾在 ±89°，yaw 包在 [-π, π)', () => {
    const m = new MouseLook();
    const v = new ViewAngles();
    m.accumulate(0, -100000, true);
    m.applyFrame(v, { sensitivity: 5, invertY: false });
    expect(v.pitch / DEG).toBeCloseTo(89, 10);
    m.accumulate(0, 100000, true);
    m.applyFrame(v, { sensitivity: 5, invertY: false });
    expect(v.pitch / DEG).toBeCloseTo(-89, 10);
    v.set(10 * Math.PI + 0.1, 0);
    expect(v.yaw).toBeCloseTo(0.1, 10);
    expect(wrapAngle(Math.PI)).toBeCloseTo(-Math.PI, 12);
    expect(wrapAngle(-Math.PI - 0.5)).toBeCloseTo(Math.PI - 0.5, 12);
  });

  it('後座力偏移：最終視角 = 玩家視角 + 偏移（pitch 仍夾住），commitOffset 併入', () => {
    const v = new ViewAngles();
    v.set(0.5, 80 * DEG);
    v.addOffset(0.1, 20 * DEG);
    expect(v.yaw).toBe(0.5);
    expect(v.viewYaw).toBeCloseTo(0.6, 12);
    expect(v.viewPitch / DEG).toBeCloseTo(89, 10);
    v.setOffset(0, -5 * DEG);
    expect(v.viewPitch / DEG).toBeCloseTo(75, 10);
    v.commitOffset();
    expect([v.offsetYaw, v.offsetPitch]).toEqual([0, 0]);
    expect(v.pitch / DEG).toBeCloseTo(75, 10);
  });

  it('跳動過濾：一般鎖定時丟棄單一巨大事件；連續快速甩動保留；原始輸入不過濾', () => {
    const f = new SpikeFilter({ spikeThreshold: 400, spikeNeighborRatio: 0.25 });
    expect(f.accept(5, 2)).toBe(true);
    expect(f.accept(1500, 0)).toBe(false); // 突然跳動
    expect(f.accept(6, 1)).toBe(true);
    expect(f.dropped).toBe(1);
    // 漸進加速的甩動：前一個事件已經很大 → 保留
    expect(f.accept(150, 0)).toBe(true);
    expect(f.accept(500, 0)).toBe(true);
    expect(f.accept(900, 0)).toBe(true);

    const m = new MouseLook();
    const v = new ViewAngles();
    expect(m.accumulate(2000, 0, false)).toBe(false);
    expect(m.accumulate(2000, 0, true)).toBe(true);
    expect(m.accumulate(Number.NaN, 0, true)).toBe(false);
    m.applyFrame(v, { sensitivity: 1, invertY: false });
    expect(v.yaw / DEG).toBeCloseTo(wrapAngle(-2000 * 0.022 * DEG) / DEG, 8);
  });
});
