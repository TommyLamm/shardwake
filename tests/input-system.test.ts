import { describe, expect, it, vi } from 'vitest';
import { Game, SystemOrder, type GameSystem } from '@/core/Game';
import { defaultSettings, type Settings } from '@/core/Settings';
import { Bindings } from '@/input/Bindings';
import { InputSystem, isEditableTarget } from '@/input/Input';
import { isHeld, wasPressed, wasReleased, type InputFrame } from '@/input/InputFrame';
import { LockFlow, type LockFlowLock } from '@/input/LockFlow';
import { PointerLock } from '@/input/PointerLock';
import { controlsRows, overlayContent, type OverlayState } from '@/ui/StartOverlay';

const DT_MS = 1000 / 60;
const DEG = Math.PI / 180;

function key(code: string, extra: { repeat?: boolean; target?: unknown } = {}) {
  return { code, ...extra, preventDefault: vi.fn() };
}

/** Game + InputSystem（不掛 DOM，事件直接呼叫 handler），並記錄每一步看到的 InputFrame。 */
function setup(opts: { locked?: boolean; settings?: Partial<Settings> } = {}) {
  const settings: Settings = { ...defaultSettings(), ...opts.settings };
  const lock = { locked: opts.locked ?? true, raw: true };
  const game = new Game();
  const bindings = new Bindings();
  const input = new InputSystem({
    bindings,
    getSettings: () => settings,
    isLocked: () => lock.locked,
    isRaw: () => lock.raw,
    win: null,
    doc: null,
    now: () => 0,
  });
  const seen: InputFrame[] = [];
  const consumer: GameSystem = {
    name: 'consumer',
    order: SystemOrder.player,
    fixedUpdate() {
      const f = input.frame;
      seen.push({ ...f, move: { ...f.move } });
    },
  };
  game.addSystem(input);
  game.addSystem(consumer);
  game.setMode('title');
  let now = 0;
  const frame = () => {
    now += DT_MS;
    return game.frame(now);
  };
  game.frame(now); // 第一個畫面 dt = 0
  return { game, input, bindings, settings, lock, seen, frame };
}

describe('InputSystem + Game', () => {
  it('60 Hz 畫面、120 Hz 模擬：兩步之間按下又放開，pressed 恰好出現在一步', () => {
    const { game, input, seen, frame } = setup();
    game.start();
    frame();
    input.handleKeyDown(key('Space'));
    input.handleKeyUp(key('Space'));
    frame();
    frame();
    const pressed = seen.filter((f) => wasPressed(f, 'jump'));
    expect(pressed).toHaveLength(1);
    expect(seen.filter((f) => wasReleased(f, 'jump'))).toHaveLength(1);
    expect(seen.some((f) => isHeld(f, 'jump'))).toBe(false);
  });

  it('按住 W：移動向量為 (0, 1)；遊玩中對綁定鍵、空白鍵、Tab preventDefault，F5／Esc 不攔', () => {
    const { game, input, seen, frame } = setup();
    game.start();
    const w = key('KeyW');
    input.handleKeyDown(w);
    frame();
    expect(seen.at(-1)!.move).toEqual({ x: 0, y: 1 });
    expect(w.preventDefault).toHaveBeenCalled();
    for (const code of ['Space', 'Tab', 'Quote']) {
      const e = key(code);
      input.handleKeyDown(e);
      expect(e.preventDefault, code).toHaveBeenCalled();
    }
    for (const code of ['F5', 'F12', 'Escape']) {
      const e = key(code);
      input.handleKeyDown(e);
      expect(e.preventDefault, code).not.toHaveBeenCalled();
    }
  });

  it('非遊玩模式不 preventDefault；輸入框內的按鍵不處理', () => {
    const { input } = setup();
    const e = key('Space');
    input.handleKeyDown(e);
    expect(e.preventDefault).not.toHaveBeenCalled();
    expect(isEditableTarget({ tagName: 'INPUT' })).toBe(true);
    const typing = key('KeyW', { target: { tagName: 'INPUT' } });
    input.handleKeyDown(typing);
    expect(input.builder.isCodeDown('KeyW')).toBe(false);
  });

  it('暫停時放開按住的鍵；暫停中的按鍵不會漏進恢復後的第一步', () => {
    const { game, input, seen, frame } = setup();
    game.start();
    input.handleKeyDown(key('KeyW'));
    frame();
    game.pause('user');
    input.handleKeyDown(key('KeyE')); // 暫停中按互動
    input.handleKeyUp(key('KeyE'));
    frame();
    game.resume();
    seen.length = 0;
    frame();
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((f) => f.held === 0 && f.pressed === 0)).toBe(true);
  });

  it('失焦（blur）時放開所有按鍵', () => {
    const { game, input, seen, frame } = setup();
    game.start();
    input.handleKeyDown(key('KeyW'));
    frame();
    input.handleBlur();
    frame();
    expect(isHeld(seen.at(-1)!, 'moveForward')).toBe(false);
  });

  it('滑鼠按鍵只在鎖定時計入；解除鎖定放開滑鼠按鍵', () => {
    const { game, input, lock, seen, frame } = setup({ locked: false });
    game.start();
    const md = { button: 0, preventDefault: vi.fn() };
    input.handleMouseDown(md);
    frame();
    expect(wasPressed(seen.at(-1)!, 'fire')).toBe(false);
    expect(md.preventDefault).not.toHaveBeenCalled();
    lock.locked = true;
    input.handleMouseDown(md);
    frame();
    expect(seen.some((f) => wasPressed(f, 'fire'))).toBe(true);
    expect(isHeld(seen.at(-1)!, 'fire')).toBe(true);
    lock.locked = false;
    input.handleUnlock();
    frame();
    expect(isHeld(seen.at(-1)!, 'fire')).toBe(false);
  });

  it('滾輪：累積到一格才切換，鎖定中 preventDefault', () => {
    const { game, input, seen, frame } = setup();
    game.start();
    const small = { deltaY: 20, preventDefault: vi.fn() };
    input.handleWheel(small);
    frame();
    expect(seen.some((f) => wasPressed(f, 'weaponNext'))).toBe(false);
    expect(small.preventDefault).toHaveBeenCalled();
    input.handleWheel({ deltaY: 40, preventDefault: vi.fn() });
    frame();
    expect(seen.filter((f) => wasPressed(f, 'weaponNext'))).toHaveLength(1);
    input.handleWheel({ deltaY: -3, deltaMode: 1, preventDefault: vi.fn() }); // 3 行 = 120 px
    frame();
    expect(seen.filter((f) => wasPressed(f, 'weaponPrev'))).toHaveLength(1);
  });

  it('滑鼠視角在 beginFrame 套用：同一畫面的固定步就看到新的 yaw；未鎖定時丟棄', () => {
    const { game, input, seen, frame, lock } = setup();
    game.start();
    frame();
    seen.length = 0;
    input.handleMouseMove({ movementX: 100, movementY: 0 });
    frame();
    const expected = -100 * 0.022 * 2 * DEG;
    expect(seen.length).toBeGreaterThan(0);
    for (const f of seen) expect(f.yaw).toBeCloseTo(expected, 12);
    lock.locked = false;
    input.handleMouseMove({ movementX: 100, movementY: 0 });
    frame();
    expect(input.view.yaw).toBeCloseTo(expected, 12);
  });

  it('暫停中不轉動視角', () => {
    const { game, input, frame } = setup();
    game.start();
    game.pause('user');
    input.handleMouseMove({ movementX: 500, movementY: 500 });
    frame();
    game.resume();
    frame();
    expect(input.view.yaw).toBe(0);
    expect(input.view.pitch).toBe(0);
  });

  it('設定的按住／切換模式每畫面同步到 InputFrame 層', () => {
    const { game, input, settings, seen, frame } = setup();
    settings.crouchMode = 'toggle';
    game.start();
    frame();
    input.handleKeyDown(key('KeyC'));
    input.handleKeyUp(key('KeyC'));
    frame();
    frame();
    expect(isHeld(seen.at(-1)!, 'crouch')).toBe(true);
    expect(input.builder.getMode('crouch')).toBe('toggle');
  });

  it('即時動作（暫停、調參面板）在按下當下派送，任何模式都有效；自動重複不重複派送', () => {
    const { input } = setup();
    const onDebug = vi.fn();
    const off = input.onAction('debugPanel', onDebug);
    input.handleKeyDown(key('Backquote'));
    input.handleKeyDown(key('Backquote', { repeat: true }));
    expect(onDebug).toHaveBeenCalledTimes(1);
    input.handleKeyUp(key('Backquote'));
    off();
    input.handleKeyDown(key('Backquote'));
    expect(onDebug).toHaveBeenCalledTimes(1);
  });

  it('綁定變更時放開所有按鍵（避免舊綁定卡住）', () => {
    const { game, input, bindings, seen, frame } = setup();
    game.start();
    input.handleKeyDown(key('KeyW'));
    frame();
    bindings.bind('moveForward', 0, 'KeyI');
    frame();
    expect(isHeld(seen.at(-1)!, 'moveForward')).toBe(false);
  });
});

describe('Game.beginFrame', () => {
  it('每個畫面在固定步之前呼叫，任何模式都會呼叫', () => {
    const log: string[] = [];
    const game = new Game();
    game.addSystem({
      name: 'a',
      order: 100,
      beginFrame: () => log.push('begin'),
      fixedUpdate: () => log.push('fixed'),
      render: () => log.push('render'),
    });
    game.setMode('title');
    game.tick(1 / 60);
    expect(log).toEqual(['begin', 'render']);
    log.length = 0;
    game.start();
    game.tick(1 / 60);
    expect(log).toEqual(['begin', 'fixed', 'fixed', 'render']);
  });
});

// ── PointerLock（假的 document 與目標元素）───────────────

class FakeDoc extends EventTarget {
  pointerLockElement: unknown = null;
  exitPointerLock = vi.fn(() => {
    this.pointerLockElement = null;
    this.dispatchEvent(new Event('pointerlockchange'));
  });
}

function lockTarget(doc: FakeDoc, behavior: 'raw' | 'no-raw' | 'reject' | 'legacy') {
  const calls: unknown[] = [];
  const target = {
    requestPointerLock(options?: { unadjustedMovement?: boolean }) {
      calls.push(options);
      const lock = () => {
        doc.pointerLockElement = target;
        doc.dispatchEvent(new Event('pointerlockchange'));
      };
      if (behavior === 'legacy') {
        queueMicrotask(lock);
        return undefined;
      }
      if (behavior === 'reject') {
        const err = new Error('The user has exited the lock before this request was completed.');
        err.name = 'SecurityError';
        return Promise.reject(err);
      }
      if (behavior === 'no-raw' && options?.unadjustedMovement) {
        const err = new Error('unadjustedMovement is not supported');
        err.name = 'NotSupportedError';
        return Promise.reject(err);
      }
      lock();
      return Promise.resolve();
    },
  };
  return { target, calls };
}

describe('PointerLock', () => {
  it('優先要求原始輸入；成功時 rawInput = true，onChange(locked)', async () => {
    const doc = new FakeDoc();
    const { target, calls } = lockTarget(doc, 'raw');
    const onChange = vi.fn();
    const pl = new PointerLock({ target, doc, onChange });
    expect(await pl.request()).toBe(true);
    expect(calls).toEqual([{ unadjustedMovement: true }]);
    expect(pl.locked).toBe(true);
    expect(pl.rawInput).toBe(true);
    expect(onChange).toHaveBeenCalledWith(true, false);
  });

  it('不支援原始輸入時退回一般鎖定（rawInput = false）', async () => {
    const doc = new FakeDoc();
    const { target, calls } = lockTarget(doc, 'no-raw');
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const pl = new PointerLock({ target, doc });
    expect(await pl.request()).toBe(true);
    expect(calls).toEqual([{ unadjustedMovement: true }, undefined]);
    expect(pl.rawInput).toBe(false);
    info.mockRestore();
  });

  it('舊版 API（不回傳 Promise）等 pointerlockchange', async () => {
    const doc = new FakeDoc();
    const { target } = lockTarget(doc, 'legacy');
    const pl = new PointerLock({ target, doc });
    expect(await pl.request()).toBe(true);
    expect(pl.rawInput).toBe(false);
  });

  it('鎖定被拒（Chrome 解鎖後冷卻）：回傳 false 並回報錯誤', async () => {
    const doc = new FakeDoc();
    const { target } = lockTarget(doc, 'reject');
    const onError = vi.fn();
    const pl = new PointerLock({ target, doc, onError });
    expect(await pl.request()).toBe(false);
    expect(pl.lastError).toContain('SecurityError');
    // Chrome 在 Promise reject 之後還會發出 pointerlockerror：不重複回報
    doc.dispatchEvent(new Event('pointerlockerror'));
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('解鎖：遊戲呼叫 exit() 為 intentional；瀏覽器解鎖（Esc）不是；記錄冷卻時間', async () => {
    const doc = new FakeDoc();
    const { target } = lockTarget(doc, 'raw');
    let t = 1000;
    const onChange = vi.fn();
    const pl = new PointerLock({ target, doc, onChange, now: () => t, config: { preferRawInput: true, relockCooldownMs: 1000 } });
    await pl.request();
    pl.exit();
    expect(onChange).toHaveBeenLastCalledWith(false, true);
    await pl.request();
    doc.pointerLockElement = null; // 玩家按 Esc
    doc.dispatchEvent(new Event('pointerlockchange'));
    expect(onChange).toHaveBeenLastCalledWith(false, false);
    expect(pl.inCooldown).toBe(true);
    t += 1500;
    expect(pl.inCooldown).toBe(false);
  });

  it('不支援 Pointer Lock 時 request 回傳 false', async () => {
    const doc = new FakeDoc();
    const pl = new PointerLock({ target: {}, doc });
    expect(pl.supported).toBe(false);
    expect(await pl.request()).toBe(false);
  });
});

// ── LockFlow ─────────────────────────────────────────────

function flowSetup(opts: { requestOk?: boolean; useLock?: boolean } = {}) {
  const game = new Game();
  game.setMode('title');
  const lock = {
    supported: true,
    locked: false as boolean,
    lastError: null as string | null,
    request: vi.fn(async () => {
      if (opts.requestOk === false) {
        lock.lastError = 'SecurityError';
        return false;
      }
      lock.locked = true;
      flow.lockChanged(true, false);
      return true;
    }),
    exit: vi.fn(() => {
      if (!lock.locked) return;
      lock.locked = false;
      flow.lockChanged(false, true);
    }),
  } satisfies LockFlowLock;
  const flow: LockFlow = new LockFlow({ game, lock, useLock: opts.useLock ?? true });
  game.bus.on('game:mode', ({ to }) => flow.modeChanged(to));
  return { game, lock, flow };
}

describe('LockFlow', () => {
  it('點擊 → 鎖定成功 → 開始；Esc（瀏覽器解鎖）→ 暫停；再點擊 → 恢復', async () => {
    const { game, lock, flow } = flowSetup();
    await flow.click();
    expect(game.mode).toBe('playing');
    lock.locked = false;
    flow.lockChanged(false, false);
    expect(game.mode).toBe('paused');
    expect(game.pauseReason).toBe('pointerlock');
    await flow.click();
    expect(game.mode).toBe('playing');
  });

  it('鎖定失敗時維持原模式並記錄錯誤', async () => {
    const { game, flow } = flowSetup({ requestOk: false });
    await flow.click();
    expect(game.mode).toBe('title');
    expect(flow.error).toBe('SecurityError');
  });

  it('暫停動作：暫停並解除鎖定；自動暫停（切分頁）也解除鎖定', async () => {
    const { game, lock, flow } = flowSetup();
    await flow.click();
    flow.pauseRequested();
    expect(game.mode).toBe('paused');
    expect(game.pauseReason).toBe('user');
    expect(lock.locked).toBe(false);
    await flow.click();
    game.pause('hidden');
    expect(lock.exit).toHaveBeenCalled();
    expect(lock.locked).toBe(false);
  });

  it('開調參面板：解除鎖定但不暫停；關閉時重新鎖定', async () => {
    const { game, lock, flow } = flowSetup();
    await flow.click();
    flow.debugPanelChanged(true);
    expect(lock.locked).toBe(false);
    expect(game.mode).toBe('playing');
    expect(flow.needsRelock).toBe(true);
    flow.debugPanelChanged(false);
    await Promise.resolve();
    expect(lock.locked).toBe(true);
    expect(flow.needsRelock).toBe(false);
  });

  it('不使用鎖定（#nolock）時點擊直接開始／恢復', async () => {
    const { game, lock, flow } = flowSetup({ useLock: false });
    await flow.click();
    expect(game.mode).toBe('playing');
    expect(lock.request).not.toHaveBeenCalled();
    game.pause('user');
    await flow.click();
    expect(game.mode).toBe('playing');
  });
});

describe('StartOverlay 內容', () => {
  const base: OverlayState = {
    mode: 'title',
    needsRelock: false,
    lockError: null,
    lockCooldown: false,
    useLock: true,
    storagePersistent: true,
  };

  it('標題：點擊開始與操作說明；儲存不可用時提示', () => {
    const c = overlayContent(base);
    expect(c.kind).toBe('full');
    expect(c.prompt).toBe('點擊開始');
    expect(c.showControls).toBe(true);
    expect(overlayContent({ ...base, storagePersistent: false }).notes.join()).toContain('目前無法存檔');
  });

  it('暫停：點擊繼續；剛解鎖時提示稍候；鎖定失敗提示再點一次', () => {
    const p = overlayContent({ ...base, mode: 'paused', pauseReason: 'pointerlock', lockCooldown: true });
    expect(p.prompt).toBe('點擊繼續');
    expect(p.notes.join()).toContain('稍候');
    const e = overlayContent({ ...base, mode: 'paused', lockError: 'SecurityError' });
    expect(e.notes[0]).toContain('請再點擊一次');
  });

  it('遊玩中：鎖定時不顯示；未鎖定時顯示不擋點擊的小提示', () => {
    expect(overlayContent({ ...base, mode: 'playing' }).kind).toBe('hidden');
    const h = overlayContent({ ...base, mode: 'playing', needsRelock: true });
    expect(h.kind).toBe('hint');
    expect(h.prompt).toContain('點擊畫面');
  });

  it('操作說明的按鍵名稱來自目前綁定', () => {
    const b = new Bindings();
    const rows = Object.fromEntries(controlsRows(b));
    expect(rows['移動']).toBe('W A S D');
    expect(rows['跳躍']).toBe('空白鍵');
    expect(rows['暫停']).toBe('Esc');
    b.bind('jump', 0, 'KeyJ');
    expect(Object.fromEntries(controlsRows(b))['跳躍']).toBe('J');
  });
});
