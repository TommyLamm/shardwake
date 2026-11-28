// 按鍵重新綁定流程（M1-14，純邏輯、可無頭測試）：按鍵配置頁點擊一格 → 等待輸入 → 綁定／衝突／拒絕。
//
// - capturing：下一個鍵盤代碼、滑鼠鍵（Mouse0–4）或滾輪（WheelUp／WheelDown）就是新的綁定。
//   Escape = 取消；Backspace = 清除這一格（所以 Backspace 不能用這個流程綁定）。
//   瀏覽器保留鍵（F1、F5、F11、F12…）與「Esc 只能給暫停」由 Bindings.validateCode 拒絕，維持 capturing 讓玩家改按別的鍵。
// - 代碼已被其他動作使用 → conflict：顯示衝突，confirmReplace()（或再按一次同一個鍵）從原動作搶過來；Escape 取消；
//   按其他鍵則改用那個鍵重新判斷。
// - 綁 Ctrl／Windows 鍵成功時附帶警告（Ctrl+W 會關閉分頁）。
import { t, tDynamic } from '@/i18n';
import type { Action } from '@/input/Actions';
import { CTRL_WARNING, keyName, type BindResult, type BindingRef, type Bindings, type InputCode } from '@/input/Bindings';

export type RebindPhase = 'idle' | 'capturing' | 'conflict';
export type FeedbackTone = 'info' | 'good' | 'warn' | 'error';

export interface RebindFeedback {
  tone: FeedbackTone;
  text: string;
}

export type RebindOutcomeKind = 'bound' | 'replaced' | 'cleared' | 'cancelled' | 'conflict' | 'rejected' | 'ignored';

export interface RebindOutcome {
  kind: RebindOutcomeKind;
  feedback: RebindFeedback | null;
}

/** 取消與清除用的代碼。 */
export const CANCEL_CODE: InputCode = 'Escape';
export const CLEAR_CODE: InputCode = 'Backspace';

export function actionName(action: Action): string {
  return tDynamic(`action.${action}`, action);
}

type BindingsLike = Pick<Bindings, 'bind' | 'unbind' | 'get' | 'find'>;

export class RebindSession {
  phase: RebindPhase = 'idle';
  action: Action | null = null;
  slot = 0;
  /** 衝突中的代碼與原本的擁有者。 */
  pendingCode: InputCode | null = null;
  conflict: BindingRef | null = null;
  /** 最近一次的提示（UI 顯示）。 */
  feedback: RebindFeedback | null = null;
  /** 每次狀態改變遞增（UI 比對用）。 */
  version = 0;

  constructor(private readonly bindings: BindingsLike) {}

  get active(): boolean {
    return this.phase !== 'idle';
  }

  /** 開始等待 action 第 slot 格（0 主要、1 次要）的新輸入。 */
  start(action: Action, slot: number): void {
    this.phase = 'capturing';
    this.action = action;
    this.slot = Math.max(0, Math.min(1, Math.floor(slot)));
    this.pendingCode = null;
    this.conflict = null;
    this.feedback = { tone: 'info', text: t('controls.captureHint') };
    this.version++;
  }

  /** 是否正在等待這一格。 */
  isCapturing(action: Action, slot: number): boolean {
    return this.phase !== 'idle' && this.action === action && this.slot === slot;
  }

  /** 收到輸入代碼（鍵盤 code、Mouse0–4、WheelUp／WheelDown）。 */
  input(code: InputCode): RebindOutcome {
    if (this.phase === 'idle' || this.action === null) return { kind: 'ignored', feedback: null };
    if (code === CANCEL_CODE) return this.cancel();
    if (this.phase === 'conflict') {
      if (code === this.pendingCode) return this.confirmReplace();
      this.phase = 'capturing';
      this.pendingCode = null;
      this.conflict = null;
    }
    const action = this.action;
    if (code === CLEAR_CODE) {
      const had = this.slot < this.bindings.get(action).length;
      if (had) this.bindings.unbind(action, this.slot);
      return this.finish('cleared', { tone: 'info', text: t('controls.cleared', { action: actionName(action) }) });
    }
    const result = this.bindings.bind(action, this.slot, code);
    if (result.ok) return this.finish('bound', this.boundFeedback(action, code, result));
    if (result.error === 'conflict' && result.conflicts.length > 0) {
      this.phase = 'conflict';
      this.pendingCode = code;
      this.conflict = result.conflicts[0]!;
      this.feedback = {
        tone: 'warn',
        text: t('controls.conflict', { key: keyName(code), other: actionName(this.conflict.action), action: actionName(action) }),
      };
      this.version++;
      return { kind: 'conflict', feedback: this.feedback };
    }
    // 拒絕：保留等待狀態，讓玩家改按別的鍵。
    this.feedback = { tone: 'error', text: rejectText(code, result) };
    this.version++;
    return { kind: 'rejected', feedback: this.feedback };
  }

  /** 衝突時確認取代：從原動作移除後綁定。 */
  confirmReplace(): RebindOutcome {
    if (this.phase !== 'conflict' || this.action === null || this.pendingCode === null) return { kind: 'ignored', feedback: null };
    const action = this.action;
    const code = this.pendingCode;
    const other = this.conflict?.action ?? null;
    const result = this.bindings.bind(action, this.slot, code, { replace: true });
    if (!result.ok) {
      this.feedback = { tone: 'error', text: rejectText(code, result) };
      this.phase = 'capturing';
      this.pendingCode = null;
      this.conflict = null;
      this.version++;
      return { kind: 'rejected', feedback: this.feedback };
    }
    const text = t('controls.replaced', { key: keyName(code), action: actionName(action), other: other ? actionName(other) : '' });
    const fb = this.boundFeedback(action, code, result);
    return this.finish('replaced', fb.tone === 'warn' ? { tone: 'warn', text: `${text}\n${fb.text}` } : { tone: 'good', text });
  }

  cancel(): RebindOutcome {
    if (this.phase === 'idle') return { kind: 'ignored', feedback: null };
    return this.finish('cancelled', { tone: 'info', text: t('controls.cancelled') });
  }

  private boundFeedback(action: Action, code: InputCode, result: BindResult): RebindFeedback {
    if (result.warning) {
      const warn = result.warning === CTRL_WARNING ? t('controls.warnCtrl') : t('controls.warnMeta');
      return { tone: 'warn', text: `${t('controls.bound', { action: actionName(action), key: keyName(code) })}\n${warn}` };
    }
    return { tone: 'good', text: t('controls.bound', { action: actionName(action), key: keyName(code) }) };
  }

  private finish(kind: RebindOutcomeKind, feedback: RebindFeedback): RebindOutcome {
    this.phase = 'idle';
    this.pendingCode = null;
    this.conflict = null;
    this.feedback = feedback;
    this.version++;
    return { kind, feedback };
  }
}

function rejectText(code: InputCode, result: BindResult): string {
  if (result.error === 'reserved') return code === 'Escape' ? t('controls.reservedEsc') : t('controls.reserved', { key: keyName(code) });
  return t('controls.invalid');
}
