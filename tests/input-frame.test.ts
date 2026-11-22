import { describe, expect, it } from 'vitest';
import { ACTIONS, ACTION_BIT, actionsInMask, maskOf, type Action } from '@/input/Actions';
import { InputBuffer } from '@/input/InputBuffer';
import {
  copyInputFrame,
  createInputFrame,
  InputFrameBuilder,
  isHeld,
  moveVector,
  wasPressed,
  wasReleased,
  type ActionLookup,
  type InputFrame,
} from '@/input/InputFrame';

/** 簡單的綁定查詢：W→前進、C→蹲、K 與 L 都是開火、WheelDown→下一把。 */
const lookup: ActionLookup = {
  actionsFor(code) {
    const map: Record<string, Action[]> = {
      KeyW: ['moveForward'],
      KeyS: ['moveBack'],
      KeyA: ['moveLeft'],
      KeyD: ['moveRight'],
      Space: ['jump'],
      KeyC: ['crouch'],
      Mouse2: ['ads'],
      KeyK: ['fire'],
      KeyL: ['fire'],
      WheelDown: ['weaponNext'],
    };
    return map[code] ?? [];
  },
};

function setup() {
  const b = new InputFrameBuilder(lookup);
  const f = createInputFrame();
  const step = (): InputFrame => b.build(f, 0, 0);
  return { b, f, step };
}

describe('Actions', () => {
  it('每個動作一個不重複的位元，數量不超過 32', () => {
    expect(ACTIONS.length).toBeLessThanOrEqual(32);
    const bits = new Set(ACTIONS.map((a) => ACTION_BIT[a]));
    expect(bits.size).toBe(ACTIONS.length);
    for (const a of ACTIONS) expect(actionsInMask(ACTION_BIT[a])).toEqual([a]);
    expect(actionsInMask(maskOf('jump', 'fire'))).toEqual(['jump', 'fire']);
  });

  it('計畫列出的動作都存在（含手動衝刺）', () => {
    for (const a of [
      'moveForward', 'moveBack', 'moveLeft', 'moveRight', 'jump', 'crouch', 'dash', 'grapple', 'fire', 'ads',
      'reload', 'melee', 'interact', 'weapon1', 'weapon2', 'weapon3', 'weapon4', 'weapon5', 'weaponNext',
      'weaponPrev', 'weaponLast', 'pause', 'debugPanel', 'recordToggle', 'replayToggle', 'restartCourse', 'sprint',
    ]) {
      expect(ACTIONS).toContain(a);
    }
  });
});

describe('InputFrameBuilder：pressed／held／released', () => {
  it('兩步之間按下又放開：下一步 pressed 恰好出現一次（同時 released），之後不再出現', () => {
    const { b, step } = setup();
    step();
    b.down('Space');
    b.up('Space');
    const f1 = step();
    expect(wasPressed(f1, 'jump')).toBe(true);
    expect(wasReleased(f1, 'jump')).toBe(true);
    expect(isHeld(f1, 'jump')).toBe(false);
    const f2 = step();
    expect(wasPressed(f2, 'jump')).toBe(false);
    expect(wasReleased(f2, 'jump')).toBe(false);
  });

  it('同一步內快速連點兩次仍只算一次 pressed', () => {
    const { b, step } = setup();
    b.down('Space');
    b.up('Space');
    b.down('Space');
    b.up('Space');
    const f = step();
    expect(f.pressed).toBe(ACTION_BIT.jump);
    expect(step().pressed).toBe(0);
  });

  it('按住跨多步：pressed 只在第一步，held 持續，放開後 released 一次', () => {
    const { b, step } = setup();
    b.down('KeyW');
    const read = (f: InputFrame) => [wasPressed(f, 'moveForward'), isHeld(f, 'moveForward')];
    const seq = [read(step()), read(step()), read(step())];
    expect(seq).toEqual([
      [true, true],
      [false, true],
      [false, true],
    ]);
    b.up('KeyW');
    const r = step();
    expect(wasReleased(r, 'moveForward')).toBe(true);
    expect(isHeld(r, 'moveForward')).toBe(false);
    expect(wasReleased(step(), 'moveForward')).toBe(false);
  });

  it('鍵盤自動重複（重複 keydown）不會再產生 pressed', () => {
    const { b, step } = setup();
    b.down('KeyW');
    step();
    b.down('KeyW');
    b.down('KeyW');
    expect(wasPressed(step(), 'moveForward')).toBe(false);
  });

  it('一個動作兩個鍵：第二個鍵不再 pressed；放開一個仍按住', () => {
    const { b, step } = setup();
    b.down('KeyK');
    expect(wasPressed(step(), 'fire')).toBe(true);
    b.down('KeyL');
    expect(wasPressed(step(), 'fire')).toBe(false);
    b.up('KeyK');
    const f = step();
    expect(isHeld(f, 'fire')).toBe(true);
    expect(wasReleased(f, 'fire')).toBe(false);
    b.up('KeyL');
    expect(wasReleased(step(), 'fire')).toBe(true);
  });

  it('沒按著的鍵放開、沒有綁定的鍵都忽略', () => {
    const { b, step } = setup();
    b.up('KeyW');
    b.down('KeyZ');
    const f = step();
    expect(f.held | f.pressed | f.released).toBe(0);
  });

  it('滾輪是瞬間輸入：pressed 與 released 同步出現，held 為 0', () => {
    const { b, step } = setup();
    b.impulse('WheelDown');
    const f = step();
    expect(wasPressed(f, 'weaponNext')).toBe(true);
    expect(wasReleased(f, 'weaponNext')).toBe(true);
    expect(isHeld(f, 'weaponNext')).toBe(false);
  });

  it('releaseAll 放開所有按鍵（下一步 released）', () => {
    const { b, step } = setup();
    b.down('KeyW');
    b.down('Space');
    step();
    b.releaseAll();
    const f = step();
    expect(f.held).toBe(0);
    expect(f.released).toBe(maskOf('moveForward', 'jump'));
  });
});

describe('InputFrameBuilder：按住／切換模式', () => {
  it('切換模式：按一下開（pressed），再按一下關（released），實體放開不產生位元', () => {
    const { b, step } = setup();
    b.setMode('crouch', 'toggle');
    b.down('KeyC');
    let f = step();
    expect([wasPressed(f, 'crouch'), isHeld(f, 'crouch')]).toEqual([true, true]);
    b.up('KeyC');
    f = step();
    expect([wasPressed(f, 'crouch'), wasReleased(f, 'crouch'), isHeld(f, 'crouch')]).toEqual([false, false, true]);
    f = step();
    expect(isHeld(f, 'crouch')).toBe(true);
    b.down('KeyC');
    b.up('KeyC');
    f = step();
    expect([wasPressed(f, 'crouch'), wasReleased(f, 'crouch'), isHeld(f, 'crouch')]).toEqual([false, true, false]);
  });

  it('按住模式：held 跟著實體按鍵', () => {
    const { b, step } = setup();
    b.down('Mouse2');
    expect(isHeld(step(), 'ads')).toBe(true);
    b.up('Mouse2');
    const f = step();
    expect([isHeld(f, 'ads'), wasReleased(f, 'ads')]).toEqual([false, true]);
  });

  it('setToggle 可由下游強制關閉切換狀態；按住模式時無效', () => {
    const { b, step } = setup();
    b.setMode('ads', 'toggle');
    b.down('Mouse2');
    b.up('Mouse2');
    step();
    b.setToggle('ads', false);
    const f = step();
    expect([isHeld(f, 'ads'), wasReleased(f, 'ads')]).toEqual([false, true]);
    b.setMode('ads', 'hold');
    b.setToggle('ads', true);
    expect(isHeld(step(), 'ads')).toBe(false);
  });

  it('切換狀態開著時改回按住模式：狀態改為實體狀態並補 released', () => {
    const { b, step } = setup();
    b.setMode('crouch', 'toggle');
    b.down('KeyC');
    b.up('KeyC');
    step();
    b.setMode('crouch', 'hold');
    const f = step();
    expect([isHeld(f, 'crouch'), wasReleased(f, 'crouch')]).toEqual([false, true]);
    expect(b.getMode('crouch')).toBe('hold');
  });

  it('實體按著時改成切換模式：狀態變成關（released），再按一次才打開', () => {
    const { b, step } = setup();
    b.down('KeyC');
    step();
    b.setMode('crouch', 'toggle');
    expect(wasReleased(step(), 'crouch')).toBe(true);
    b.up('KeyC');
    b.down('KeyC');
    expect(isHeld(step(), 'crouch')).toBe(true);
  });

  it('releaseAll(true) 也重設切換狀態', () => {
    const { b, step } = setup();
    b.setMode('crouch', 'toggle');
    b.down('KeyC');
    step();
    b.releaseAll();
    expect(isHeld(step(), 'crouch')).toBe(true);
    b.releaseAll(true);
    expect(isHeld(step(), 'crouch')).toBe(false);
  });
});

describe('InputFrameBuilder：停用（非遊玩模式）', () => {
  it('停用時不產生 pressed、不翻轉切換；啟用後按住的鍵直接以按住接續', () => {
    const { b, step } = setup();
    b.setMode('crouch', 'toggle');
    b.setEnabled(false);
    b.down('KeyW');
    b.down('KeyC');
    b.down('Space');
    b.up('Space');
    b.setEnabled(true);
    const f = step();
    expect(f.pressed).toBe(0);
    expect(f.released).toBe(0);
    expect(isHeld(f, 'moveForward')).toBe(true);
    expect(isHeld(f, 'crouch')).toBe(false);
  });
});

describe('moveVector 與 InputFrame 工具', () => {
  it('對角線正規化、相反方向抵銷', () => {
    const out = { x: 0, y: 0 };
    moveVector(maskOf('moveForward', 'moveRight'), out);
    expect(Math.hypot(out.x, out.y)).toBeCloseTo(1, 12);
    expect(out.x).toBeCloseTo(Math.SQRT1_2, 12);
    moveVector(maskOf('moveLeft', 'moveRight', 'moveBack'), out);
    expect(out).toEqual({ x: 0, y: -1 });
    moveVector(0, out);
    expect(out).toEqual({ x: 0, y: 0 });
  });

  it('build 帶入 yaw／pitch 與移動；copyInputFrame 完整複製', () => {
    const b = new InputFrameBuilder(lookup);
    b.down('KeyA');
    const f = b.build(createInputFrame(), 1.25, -0.5);
    expect(f.move).toEqual({ x: -1, y: 0 });
    expect([f.yaw, f.pitch]).toEqual([1.25, -0.5]);
    const c = copyInputFrame(createInputFrame(), f);
    expect(c).toEqual(f);
    expect(c.move).not.toBe(f.move);
  });
});

describe('InputBuffer', () => {
  const dt = 1 / 120;

  it('觸發後保留到逾時：120 Hz、0.15 s → 第 18 步仍有效、第 19 步失效', () => {
    const buf = new InputBuffer(0.15);
    buf.update(dt, true);
    expect(buf.active).toBe(true);
    for (let k = 1; k <= 18; k++) {
      buf.update(dt, false);
      expect(buf.active, `第 ${k} 步`).toBe(true);
    }
    buf.update(dt, false);
    expect(buf.active).toBe(false);
    expect(buf.consume()).toBe(false);
  });

  it('消耗一次後失效；再觸發重新計時', () => {
    const buf = new InputBuffer(0.1);
    expect(buf.consume()).toBe(false);
    buf.push();
    buf.update(dt, false);
    expect(buf.consume()).toBe(true);
    expect(buf.consume()).toBe(false);
    buf.update(dt, true);
    expect(buf.elapsed).toBe(0);
    expect(buf.active).toBe(true);
    buf.clear();
    expect(buf.active).toBe(false);
  });

  it('保留時間可跟著設定資料變動；updateFrom 讀 InputFrame 的 pressed', () => {
    const cfg = { window: 0.05 };
    const buf = new InputBuffer(() => cfg.window);
    const frame = createInputFrame();
    frame.pressed = ACTION_BIT.jump;
    buf.updateFrom(dt, frame, 'jump');
    frame.pressed = 0;
    for (let i = 0; i < 10; i++) buf.updateFrom(dt, frame, 'jump');
    expect(buf.active).toBe(false);
    cfg.window = 0.2;
    expect(buf.window).toBe(0.2);
    expect(buf.active).toBe(true);
  });

  it('與步長無關：相同時間在 60／120／240 Hz 下同時失效', () => {
    for (const hz of [60, 120, 240]) {
      const buf = new InputBuffer(0.15);
      buf.update(1 / hz, true);
      let t = 0;
      while (buf.active) {
        buf.update(1 / hz, false);
        t += 1 / hz;
      }
      expect(t).toBeGreaterThan(0.15);
      expect(t).toBeLessThanOrEqual(0.15 + 1 / hz + 1e-9);
    }
  });
});
