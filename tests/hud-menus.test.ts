// M1-14：i18n、HUD 純邏輯（版面縮放、格式化、受擊延遲條、訊息佇列）、選單導覽、按鍵重新綁定、設定頁與畫質覆寫、全螢幕按鈕規則。
import { describe, expect, it } from 'vitest';
import { QUALITY_PRESETS, effectiveQuality } from '@/core/quality';
import {
  QUALITY_SETTING_KEYS,
  SETTINGS_KEY,
  SETTINGS_SCHEMA,
  SettingsStore,
  defaultSettings,
  parseSettings,
  type SettingsKey,
} from '@/core/Settings';
import { GameStorage, type StorageBackend } from '@/core/Storage';
import { ZH_TW, formatString, hasKey, registerLocale, setLocale, t, tDynamic } from '@/i18n';
import { ACTIONS, ACTION_INFO } from '@/input/Actions';
import { BINDINGS_KEY, Bindings } from '@/input/Bindings';
import { fullscreenButtonVisible, FullscreenControl } from '@/ui/fullscreen';
import { HUD_CONFIG } from '@/ui/HudConfig';
import {
  DelayedBar,
  MessageQueue,
  ammoTone,
  chargePips,
  cooldownProgress,
  fireModeKey,
  formatCount,
  formatDelta,
  formatMeters,
  formatTimer,
  fraction,
  hudLayout,
  menuScale,
  ringDashOffset,
} from '@/ui/hudMath';
import { MenuNav, rootForMode } from '@/ui/menu/MenuNav';
import { RebindSession } from '@/ui/menu/rebind';
import {
  HIDDEN_SETTINGS,
  SETTINGS_PAGES,
  controlKind,
  formatSettingValue,
  inputText,
  optionLabel,
  pageKeys,
  parseSettingInput,
  snapToStep,
} from '@/ui/menu/settingsPages';

class MapBackend implements StorageBackend {
  readonly map = new Map<string, string>();
  getItem(k: string): string | null {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.map.set(k, v);
  }
  removeItem(k: string): void {
    this.map.delete(k);
  }
  key(i: number): string | null {
    return [...this.map.keys()][i] ?? null;
  }
  get length(): number {
    return this.map.size;
  }
}

function memoryStorage(backend = new MapBackend()): { storage: GameStorage; backend: MapBackend } {
  return { storage: new GameStorage({ backend: () => backend }), backend };
}

// ── i18n ─────────────────────────────────────────────────

describe('i18n', () => {
  it('t() 代入參數；缺少的參數保留原樣；未知 key 回傳 key', () => {
    expect(t('hud.grappleReady', { key: 'F' })).toBe('可勾取 F');
    expect(formatString('{a} 與 {b}', { a: 1 })).toBe('1 與 {b}');
    expect(tDynamic('no.such.key', '備用')).toBe('備用');
    expect(tDynamic('no.such.key')).toBe('no.such.key');
    expect(hasKey('menu.start')).toBe(true);
    expect(hasKey('menu.nope')).toBe(false);
  });

  it('其他語系可部分覆寫，缺少的 key 回退繁中；切回 zh-TW', () => {
    registerLocale('en', { 'menu.start': 'Click to start' });
    expect(setLocale('xx')).toBe(false);
    expect(setLocale('en')).toBe(true);
    expect(t('menu.start')).toBe('Click to start');
    expect(t('menu.resume')).toBe('繼續');
    expect(setLocale('zh-TW')).toBe(true);
    expect(t('menu.start')).toBe('點擊開始');
  });

  it('每個設定欄位都有名稱與說明，每個動作都有名稱，按鍵分類都有標題', () => {
    for (const key of Object.keys(SETTINGS_SCHEMA)) {
      expect(hasKey(`setting.${key}`), key).toBe(true);
      expect(hasKey(`settingHint.${key}`), key).toBe(true);
    }
    for (const a of ACTIONS) {
      expect(hasKey(`action.${a}`), a).toBe(true);
      expect(hasKey(`controls.category.${ACTION_INFO[a].category}`)).toBe(true);
    }
    // 動作名稱與 ACTION_INFO 一致（調參面板與 HUD 提示仍用 ACTION_INFO）。
    for (const a of ACTIONS) expect(t(`action.${a}`)).toBe(ACTION_INFO[a].label);
    for (const v of Object.values(ZH_TW)) expect(v.length).toBeGreaterThan(0);
  });
});

// ── HUD 純邏輯 ───────────────────────────────────────────

describe('HUD 版面縮放', () => {
  const cfg = HUD_CONFIG.layout;

  it('依短邊縮放：1080p = 1、720p 與 1440p 依比例、夾在範圍內', () => {
    expect(hudLayout(1920, 1080, cfg).scale).toBeCloseTo(1);
    // 720p 的 720 / 1080 = 0.67 低於下限：夾在 minScale（0.72），小畫面上的文字仍看得清楚。
    expect(hudLayout(1280, 720, cfg).scale).toBe(Math.max(cfg.minScale, 720 / 1080));
    expect(hudLayout(1600, 900, cfg).scale).toBeCloseTo(900 / 1080);
    expect(hudLayout(2560, 1440, cfg).scale).toBeCloseTo(1440 / 1080);
    expect(hudLayout(3440, 1440, cfg).scale).toBeCloseTo(1440 / 1080);
    expect(hudLayout(400, 300, cfg).scale).toBe(cfg.minScale);
    expect(hudLayout(7680, 4320, cfg).scale).toBe(cfg.maxScale);
    // 直立的 iframe 以寬為短邊。
    expect(hudLayout(900, 1600, cfg).scale).toBeCloseTo(900 / 1080);
  });

  it('超寬螢幕時安全區收窄並置中；16:9 時等於畫面寬', () => {
    expect(hudLayout(1920, 1080, cfg).safeWidth).toBe(1920);
    const uw = hudLayout(3440, 1440, cfg);
    expect(uw.safeWidth).toBeCloseTo(1440 * cfg.safeMaxAspect);
    expect(uw.safeWidth).toBeLessThan(3440);
    expect(hudLayout(1600, 900, cfg).margin).toBeCloseTo(cfg.margin * (900 / 1080));
  });

  it('使用者縮放倍率（M5-07）與不合法尺寸', () => {
    const big = hudLayout(1920, 1080, { ...cfg, userScale: 1.5 });
    expect(big.scale).toBeCloseTo(1.5);
    const bad = hudLayout(Number.NaN, 0, cfg);
    expect(Number.isFinite(bad.scale)).toBe(true);
    expect(bad.scale).toBe(cfg.minScale);
  });

  it('選單縮放範圍較窄', () => {
    expect(menuScale(1280, 720, cfg)).toBe(cfg.menuMinScale);
    expect(menuScale(1920, 1080, cfg)).toBeCloseTo(1);
    expect(menuScale(3840, 2160, cfg)).toBe(cfg.menuMaxScale);
  });
});

describe('HUD 數值格式化', () => {
  it('彈藥、無限備彈、距離與比例', () => {
    expect(formatCount(24)).toBe('24');
    expect(formatCount(Number.POSITIVE_INFINITY)).toBe('∞');
    expect(formatCount(-3)).toBe('0');
    expect(formatCount(Number.NaN)).toBe('0');
    expect(formatCount(7.9)).toBe('7');
    expect(formatMeters(23.6)).toBe('24');
    expect(fraction(50, 100)).toBe(0.5);
    expect(fraction(150, 100)).toBe(1);
    expect(fraction(5, 0)).toBe(0);
  });

  it('彈藥警示色', () => {
    expect(ammoTone(0, 32, 0.25)).toBe('empty');
    expect(ammoTone(8, 32, 0.25)).toBe('low');
    expect(ammoTone(9, 32, 0.25)).toBe('ok');
    expect(ammoTone(4, 4, 0.25)).toBe('ok');
    expect(ammoTone(1, 4, 0.25)).toBe('low');
  });

  it('射擊模式', () => {
    expect(t(fireModeKey('auto'))).toBe('全自動');
    expect(t(fireModeKey('pump'))).toBe('泵動');
    expect(t(fireModeKey('???'))).toBe('半自動');
  });

  it('計時器與分段差', () => {
    expect(formatTimer(0)).toBe('0:00.00');
    expect(formatTimer(42.371)).toBe('0:42.37');
    expect(formatTimer(65.4)).toBe('1:05.40');
    expect(formatTimer(3725.5)).toBe('1:02:05.50');
    expect(formatTimer(-1)).toBe('-:--.--');
    expect(formatTimer(Number.NaN)).toBe('-:--.--');
    expect(formatDelta(0.421)).toBe('+0.42');
    expect(formatDelta(-1.2)).toBe('-1.20');
    expect(formatDelta(0.001)).toBe('±0.00');
  });

  it('冷卻環、Dash 充能格', () => {
    expect(cooldownProgress(0, 4)).toBe(1);
    expect(cooldownProgress(4, 4)).toBe(0);
    expect(cooldownProgress(1, 4)).toBeCloseTo(0.75);
    expect(ringDashOffset(1, 100)).toBe(0);
    expect(ringDashOffset(0.25, 100)).toBe(75);
    expect(ringDashOffset(Number.NaN, 100)).toBe(100);
    const out: number[] = [];
    expect(chargePips(2, 2, 0, out)).toEqual([1, 1]);
    expect(chargePips(1, 2, 0.4, out)).toEqual([1, 0.4]);
    expect(chargePips(0, 3, 0.5, out)).toEqual([0.5, 0, 0]);
    expect(chargePips(0, 0, 0.5, out)).toEqual([]);
  });
});

describe('受擊延遲條', () => {
  const cfg = { trailDelay: 0.5, trailRate: 1 };

  it('扣血時延遲條停留 trailDelay 後以 trailRate 追上', () => {
    const b = new DelayedBar(cfg);
    b.update(0.6, 0);
    expect(b.value).toBeCloseTo(0.6);
    expect(b.trail).toBe(1);
    b.update(0.6, 0.4);
    expect(b.trail).toBe(1);
    b.update(0.6, 0.2); // 0.1 s 超過等待 → 追 0.1
    expect(b.trail).toBeCloseTo(0.9);
    b.update(0.6, 1);
    expect(b.trail).toBeCloseTo(0.6);
  });

  it('連續受擊重新計時；回復時直接跟上；暫停（dt = 0）時不動', () => {
    const b = new DelayedBar(cfg);
    b.update(0.8, 0.4);
    b.update(0.5, 0.4); // 又扣血：重新等待
    expect(b.trail).toBe(1);
    b.update(0.5, 0);
    expect(b.trail).toBe(1);
    b.update(0.9, 0.01);
    expect(b.trail).toBeCloseTo(1 - 0);
    b.update(1, 0.01);
    expect(b.trail).toBe(1);
    expect(b.value).toBe(1);
    b.reset(0.3);
    expect(b.value).toBe(0.3);
    expect(b.trail).toBe(0.3);
  });
});

describe('提示訊息佇列', () => {
  const cfg = { duration: 2, maxVisible: 3, fadeOut: 0.5 };

  it('最新在前、超過上限丟掉最舊、時間到移除、最後 fadeOut 秒淡出', () => {
    const q = new MessageQueue(cfg);
    for (const s of ['a', 'b', 'c', 'd']) q.push(s);
    expect(q.items.map((m) => m.text)).toEqual(['d', 'c', 'b']);
    const v = q.version;
    q.update(1.75);
    expect(q.opacity(q.items[0]!)).toBeCloseTo(0.5);
    expect(q.version).toBe(v);
    q.update(0.3);
    expect(q.items).toHaveLength(0);
    expect(q.version).toBe(v + 1);
  });

  it('同 key 合併並重新計時、dismiss、clear', () => {
    const q = new MessageQueue(cfg);
    q.push('回到檢查點', { key: 'respawn' });
    q.push('其他');
    q.update(1);
    q.push('已重生', { key: 'respawn', tone: 'good' });
    expect(q.items).toHaveLength(2);
    expect(q.items[0]).toMatchObject({ text: '已重生', tone: 'good', remaining: 2 });
    expect(q.dismiss('respawn')).toBe(true);
    expect(q.dismiss('respawn')).toBe(false);
    q.clear();
    expect(q.items).toHaveLength(0);
  });
});

// ── 選單導覽 ─────────────────────────────────────────────

describe('選單導覽狀態機', () => {
  it('模式決定根畫面；子畫面堆疊；根畫面按返回不動作', () => {
    const nav = new MenuNav();
    expect(rootForMode('boot')).toBeNull();
    expect(nav.syncMode('title')).toBe(true);
    expect(nav.current).toBe('title');
    expect(nav.push('settings')).toBe(true);
    expect(nav.push('settings')).toBe(false);
    expect(nav.push('controls')).toBe(true);
    expect(nav.stack).toEqual(['settings', 'controls']);
    expect(nav.back()).toBe(true);
    expect(nav.current).toBe('settings');
    expect(nav.back()).toBe(true);
    expect(nav.atRoot).toBe(true);
    expect(nav.back()).toBe(false);
    expect(nav.current).toBe('title');
  });

  it('開始 → 暫停 → 設定 → 繼續 → 暫停時回到暫停根畫面；返回標題清空堆疊', () => {
    const nav = new MenuNav();
    const seen: (string | null)[] = [];
    nav.onChange((n) => seen.push(n.current));
    nav.syncMode('title');
    nav.syncMode('playing');
    expect(nav.isOpen).toBe(false);
    expect(nav.push('settings')).toBe(false); // 關閉中不能開子畫面
    nav.syncMode('paused');
    nav.push('settings');
    nav.syncMode('playing');
    expect(nav.current).toBeNull();
    nav.syncMode('paused');
    expect(nav.current).toBe('pause');
    nav.push('help');
    nav.syncMode('title');
    expect(nav.stack).toEqual([]);
    expect(nav.current).toBe('title');
    expect(seen).toEqual(['title', null, 'pause', 'settings', null, 'pause', 'help', 'title']);
  });

  it('同一個根畫面重複進入（失焦再暫停）不會重設子畫面；已在堆疊中的畫面回到那一層', () => {
    const nav = new MenuNav();
    nav.syncMode('paused');
    nav.push('settings');
    expect(nav.syncMode('paused')).toBe(false);
    expect(nav.current).toBe('settings');
    nav.push('controls');
    nav.push('settings');
    expect(nav.stack).toEqual(['settings']);
    expect(nav.backToRoot()).toBe(true);
    expect(nav.current).toBe('pause');
  });

  it('Esc 解鎖進入暫停後，同一個 Esc 再送到選單不會重複切換', () => {
    const nav = new MenuNav();
    nav.syncMode('playing');
    nav.syncMode('paused'); // pointerlockchange → 暫停
    const v = nav.version;
    expect(nav.back()).toBe(false); // 隨後的 Esc keydown
    expect(nav.version).toBe(v);
    expect(nav.current).toBe('pause');
  });
});

// ── 按鍵重新綁定 ─────────────────────────────────────────

describe('按鍵重新綁定流程', () => {
  it('點一格後按鍵綁定並存檔', () => {
    const { storage, backend } = memoryStorage();
    const b = new Bindings({ storage });
    const s = new RebindSession(b);
    s.start('jump', 0);
    expect(s.phase).toBe('capturing');
    expect(s.isCapturing('jump', 0)).toBe(true);
    const out = s.input('KeyJ');
    expect(out.kind).toBe('bound');
    expect(out.feedback?.text).toContain('J');
    expect(s.phase).toBe('idle');
    expect(b.get('jump')).toEqual(['KeyJ']);
    const saved = JSON.parse(backend.getItem(`shardwake:${BINDINGS_KEY}`)!);
    expect(saved.values.jump).toEqual(['KeyJ']);
    // 重新讀取（重新整理）後保留。
    expect(new Bindings({ storage: new GameStorage({ backend: () => backend }) }).get('jump')).toEqual(['KeyJ']);
  });

  it('次要欄、滑鼠鍵與滾輪', () => {
    const b = new Bindings();
    const s = new RebindSession(b);
    s.start('jump', 1);
    expect(s.input('Mouse4').kind).toBe('bound');
    expect(b.get('jump')).toEqual(['Space', 'Mouse4']);
    s.start('melee', 1);
    expect(s.input('WheelUp').kind).toBe('conflict'); // 預設是「上一把武器」
    s.cancel();
    b.unbind('weaponPrev', 0);
    s.start('melee', 1);
    expect(s.input('WheelUp').kind).toBe('bound');
    expect(b.get('melee')).toEqual(['KeyV', 'WheelUp']);
  });

  it('衝突：提示原動作；再按一次同一個鍵或按「取代」搶過來；Esc 取消不變更', () => {
    const b = new Bindings();
    const s = new RebindSession(b);
    s.start('jump', 0);
    const c = s.input('KeyW');
    expect(c.kind).toBe('conflict');
    expect(s.phase).toBe('conflict');
    expect(s.conflict).toEqual({ action: 'moveForward', slot: 0 });
    expect(c.feedback?.text).toContain('前進');
    expect(s.input('Escape').kind).toBe('cancelled');
    expect(b.get('jump')).toEqual(['Space']);
    expect(b.get('moveForward')).toEqual(['KeyW']);

    s.start('jump', 0);
    s.input('KeyW');
    const r = s.input('KeyW');
    expect(r.kind).toBe('replaced');
    expect(b.get('jump')).toEqual(['KeyW']);
    expect(b.get('moveForward')).toEqual([]);

    s.start('moveForward', 0);
    s.input('KeyW');
    expect(s.confirmReplace().kind).toBe('replaced');
    expect(b.get('moveForward')).toEqual(['KeyW']);
    expect(b.get('jump')).toEqual([]);
  });

  it('衝突中改按別的鍵：重新判斷', () => {
    const b = new Bindings();
    const s = new RebindSession(b);
    s.start('jump', 0);
    s.input('KeyW');
    expect(s.input('KeyK').kind).toBe('bound');
    expect(b.get('jump')).toEqual(['KeyK']);
    expect(b.get('moveForward')).toEqual(['KeyW']);
  });

  it('拒絕保留鍵（維持等待）、Esc 只能給暫停、Backspace 清除這一格', () => {
    const b = new Bindings();
    const s = new RebindSession(b);
    s.start('jump', 0);
    const r = s.input('F5');
    expect(r.kind).toBe('rejected');
    expect(r.feedback?.tone).toBe('error');
    expect(s.phase).toBe('capturing');
    expect(s.input('F12').kind).toBe('rejected');
    expect(s.input('Unidentified').kind).toBe('rejected');
    expect(s.input('Backspace').kind).toBe('cleared');
    expect(b.get('jump')).toEqual([]);
    // Esc 取消等待（不會綁成 Esc）。
    s.start('pause', 1);
    expect(s.input('Escape').kind).toBe('cancelled');
    expect(b.get('pause')).toEqual(['Escape']);
  });

  it('Ctrl 與 Windows 鍵：綁定成功但附警告', () => {
    const b = new Bindings();
    const s = new RebindSession(b);
    s.start('crouch', 1);
    const r = s.input('ControlLeft');
    expect(r.kind).toBe('bound');
    expect(r.feedback?.tone).toBe('warn');
    expect(r.feedback?.text).toContain('Ctrl+W');
    s.start('melee', 1);
    expect(s.input('MetaLeft').feedback?.text).toContain('Windows');
  });

  it('沒有在等待時忽略輸入；同一動作改綁同一格', () => {
    const b = new Bindings();
    const s = new RebindSession(b);
    expect(s.input('KeyJ').kind).toBe('ignored');
    expect(s.confirmReplace().kind).toBe('ignored');
    expect(s.cancel().kind).toBe('ignored');
    s.start('jump', 0);
    expect(s.input('Space').kind).toBe('bound');
    expect(b.get('jump')).toEqual(['Space']);
  });

  it('恢復預設與舊存檔', () => {
    const { storage, backend } = memoryStorage();
    backend.setItem(`shardwake:${BINDINGS_KEY}`, JSON.stringify({ version: 1, values: { jump: ['KeyJ'], futureAction: ['KeyZ'] } }));
    const b = new Bindings({ storage });
    expect(b.get('jump')).toEqual(['KeyJ']);
    expect(b.get('moveForward')).toEqual(['KeyW']);
    b.reset();
    expect(b.get('jump')).toEqual(['Space']);
    expect(JSON.parse(backend.getItem(`shardwake:${BINDINGS_KEY}`)!).values.futureAction).toEqual(['KeyZ']);
  });
});

// ── 設定頁 ───────────────────────────────────────────────

describe('設定頁', () => {
  it('每個設定欄位都在某個頁籤（或明確隱藏），且只出現一次', () => {
    const all = SETTINGS_PAGES.flatMap(pageKeys);
    expect(new Set(all).size).toBe(all.length);
    for (const key of Object.keys(SETTINGS_SCHEMA) as SettingsKey[]) {
      expect(all.includes(key) || HIDDEN_SETTINGS.includes(key), key).toBe(true);
    }
    expect(SETTINGS_PAGES.map((p) => p.id)).toEqual(['controls', 'display', 'camera', 'gameplay', 'audio']);
  });

  it('控制項種類', () => {
    expect(controlKind({ key: 'sensitivity' })).toBe('slider');
    expect(controlKind({ key: 'mouseDpi', control: 'number' })).toBe('number');
    expect(controlKind({ key: 'invertY' })).toBe('toggle');
    expect(controlKind({ key: 'quality' })).toBe('choice');
    expect(controlKind({ key: 'renderScale' })).toBe('select');
  });

  it('顯示格式與輸入解析（單位、全形、逗號、對齊 step、夾住範圍）', () => {
    expect(formatSettingValue('masterVolume', 0.8, 'percent')).toBe('80%');
    expect(formatSettingValue('fovHorizontal', 103, 'degrees')).toBe('103°');
    expect(formatSettingValue('adsSensitivity', 1.2, 'multiplier')).toBe('×1.20');
    expect(formatSettingValue('sensitivity', 2)).toBe('2.00');
    expect(inputText('masterVolume', 0.55, 'percent')).toBe('55');
    expect(inputText('sensitivity', 1.234, 'decimal2')).toBe('1.23');
    expect(parseSettingInput('masterVolume', '55%', 'percent')).toBeCloseTo(0.55);
    expect(parseSettingInput('masterVolume', '１２０', 'percent')).toBe(1);
    expect(parseSettingInput('sensitivity', '1,5')).toBe(1.5);
    expect(parseSettingInput('sensitivity', '1.234')).toBe(1.23);
    expect(parseSettingInput('sensitivity', '0')).toBe(0.05);
    expect(parseSettingInput('fovHorizontal', '200°', 'degrees')).toBe(120);
    expect(parseSettingInput('mouseDpi', '1600', 'integer')).toBe(1600);
    expect(parseSettingInput('mouseDpi', '1620', 'integer')).toBe(1600);
    expect(parseSettingInput('sensitivity', 'abc')).toBeUndefined();
    expect(parseSettingInput('sensitivity', '')).toBeUndefined();
    expect(parseSettingInput('invertY', '1')).toBeUndefined();
    expect(snapToStep('cameraTilt', 0.333)).toBeCloseTo(0.35);
  });

  it('選項文字來自字串表', () => {
    expect(optionLabel('crouchMode', 'toggle')).toBe('切換');
    expect(optionLabel('quality', 'medium')).toBe('中');
    expect(optionLabel('renderScale', 'auto')).toBe('跟隨畫質');
    expect(optionLabel('renderScale', '0.67')).toBe('67%');
    expect(optionLabel('shadows', 'off')).toBe('關');
  });

  it('設定即時存檔、重新整理後保留；恢復預設只重設該頁籤', () => {
    const { storage, backend } = memoryStorage();
    const s = new SettingsStore(storage);
    s.update({ sensitivity: 3.5, fovHorizontal: 110, masterVolume: 0.3, renderScale: '0.75', shadows: 'off' });
    const reloaded = new SettingsStore(new GameStorage({ backend: () => backend }));
    expect(reloaded.value).toMatchObject({ sensitivity: 3.5, fovHorizontal: 110, masterVolume: 0.3, renderScale: '0.75', shadows: 'off' });
    const display = SETTINGS_PAGES.find((p) => p.id === 'display')!;
    reloaded.reset(pageKeys(display));
    expect(reloaded.value).toMatchObject({ sensitivity: 3.5, masterVolume: 0.3, fovHorizontal: 103, renderScale: 'auto', shadows: 'auto' });
  });

  it('儲存不可用時設定照常套用（只在記憶體）', () => {
    const storage = new GameStorage({
      backend: () => {
        throw new Error('SecurityError');
      },
    });
    const s = new SettingsStore(storage);
    expect(s.persistent).toBe(false);
    expect(s.set('fovHorizontal', 90)).toBe(true);
    expect(s.get('fovHorizontal')).toBe(90);
    expect(storage.getJSON<{ values: { fovHorizontal: number } }>(SETTINGS_KEY)?.values.fovHorizontal).toBe(90);
  });
});

describe('畫質覆寫（渲染比例、陰影、Bloom）', () => {
  it('新欄位預設跟隨畫質；舊存檔補預設值', () => {
    const d = defaultSettings();
    expect(d.renderScale).toBe('auto');
    expect(d.shadows).toBe('auto');
    expect(d.bloom).toBe('auto');
    const p = parseSettings({ version: 1, values: { quality: 'low', sensitivity: 4 } });
    expect(p.settings).toMatchObject({ quality: 'low', sensitivity: 4, renderScale: 'auto', shadows: 'auto', bloom: 'auto' });
    expect(p.dirty).toBe(true);
    expect(parseSettings({ version: 1, values: { renderScale: '0.3', shadows: 'maybe' } }).settings).toMatchObject({
      renderScale: 'auto',
      shadows: 'auto',
    });
    expect(QUALITY_SETTING_KEYS).toEqual(['quality', 'renderScale', 'shadows', 'bloom']);
  });

  it('auto 時等於畫質預設；覆寫個別欄位', () => {
    const base = { quality: 'medium', renderScale: 'auto', shadows: 'auto', bloom: 'auto' };
    expect(effectiveQuality(base)).toEqual(QUALITY_PRESETS.medium);
    const q = effectiveQuality({ ...base, renderScale: '0.5', shadows: 'off', bloom: 'off' });
    expect(q).toMatchObject({ renderScale: 0.5, shadows: false, bloom: false, smaa: true });
    expect(effectiveQuality({ quality: 'low', renderScale: '1', shadows: 'on', bloom: 'on' })).toMatchObject({
      renderScale: 1,
      shadows: true,
      bloom: true,
      smaa: false,
    });
    const store = new SettingsStore(memoryStorage().storage);
    store.update({ quality: 'high', renderScale: '0.85' });
    expect(store.qualityPreset.renderScale).toBe(0.85);
  });
});

// ── 全螢幕按鈕 ───────────────────────────────────────────

describe('全螢幕按鈕', () => {
  function fakeDoc(enabled: boolean): {
    doc: { fullscreenEnabled: boolean; fullscreenElement: unknown; exitFullscreen(): Promise<void> } & EventTarget;
    target: { requestFullscreen(): Promise<void> };
    calls: string[];
  } {
    const calls: string[] = [];
    const et = new EventTarget();
    const doc = Object.assign(et, {
      fullscreenEnabled: enabled,
      fullscreenElement: null as unknown,
      exitFullscreen: async () => {
        calls.push('exit');
        doc.fullscreenElement = null;
        et.dispatchEvent(new Event('fullscreenchange'));
      },
    });
    const target = {
      requestFullscreen: async () => {
        calls.push('request');
        doc.fullscreenElement = target;
        et.dispatchEvent(new Event('fullscreenchange'));
      },
    };
    return { doc, target, calls };
  }

  it('只在沒有嵌入 iframe 且瀏覽器允許時顯示', () => {
    expect(fullscreenButtonVisible(false, true, true)).toBe(true);
    expect(fullscreenButtonVisible(true, true, true)).toBe(false);
    expect(fullscreenButtonVisible(false, false, true)).toBe(false);
    expect(fullscreenButtonVisible(false, true, false)).toBe(false);
  });

  it('切換全螢幕並通知；嵌入時不呼叫 requestFullscreen', async () => {
    const f = fakeDoc(true);
    const fs = new FullscreenControl({ embedded: false, doc: f.doc, target: f.target });
    const seen: boolean[] = [];
    fs.onChange((a) => seen.push(a));
    expect(fs.available).toBe(true);
    expect(await fs.toggle()).toBe(true);
    expect(fs.active).toBe(true);
    expect(await fs.toggle()).toBe(true);
    expect(seen).toEqual([true, false]);
    const g = fakeDoc(true);
    const embedded = new FullscreenControl({ embedded: true, doc: g.doc, target: g.target });
    expect(embedded.available).toBe(false);
    expect(await embedded.toggle()).toBe(false);
    expect(g.calls).toEqual([]);
  });

  it('requestFullscreen 失敗時回傳 false 並記錄原因', async () => {
    const f = fakeDoc(true);
    const fs = new FullscreenControl({
      embedded: false,
      doc: f.doc,
      target: { requestFullscreen: () => Promise.reject(new TypeError('not allowed')) },
    });
    expect(await fs.toggle()).toBe(false);
    expect(fs.lastError).toContain('not allowed');
  });
});
