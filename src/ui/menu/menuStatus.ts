// 選單的狀態提示與操作說明（M1-14，純函式；取代 M1-03 的 StartOverlay.overlayContent）。
// 標題與暫停畫面下方的提示（儲存不可用、鎖定失敗、剛解鎖的冷卻、自動暫停），以及遊玩中未鎖定滑鼠時的小提示。
import type { GameMode, PauseReason } from '@/core/events';
import { t } from '@/i18n';
import type { StringKey } from '@/i18n/zh-TW';
import type { Action } from '@/input/Actions';

export interface MenuStatusState {
  mode: GameMode;
  pauseReason?: PauseReason | undefined;
  /** 遊玩中但沒有鎖定滑鼠（開著調參面板等）。 */
  needsRelock: boolean;
  /** 最近一次鎖定失敗的訊息。 */
  lockError: string | null;
  /** 剛解除鎖定，瀏覽器可能暫時拒絕重新鎖定。 */
  lockCooldown: boolean;
  /** 是否使用滑鼠鎖定。 */
  useLock: boolean;
  storagePersistent: boolean;
  /** Web Audio 不可用（靜音進行）。 */
  audioUnavailable?: boolean;
}

export interface MenuStatus {
  /** 標題／暫停畫面下方的提示（依重要性排序）。 */
  notes: string[];
  /** 遊玩中未鎖定時的小提示（不擋點擊）；沒有時為 null。 */
  hint: string | null;
}

export function menuStatus(s: MenuStatusState): MenuStatus {
  const notes: string[] = [];
  const err = s.lockError ? t('note.lockFailed', { reason: s.lockError }) : null;
  if (s.mode === 'title' || s.mode === 'paused') {
    if (err) notes.push(err);
    else if (s.mode === 'paused' && s.lockCooldown && s.useLock) notes.push(t('note.lockCooldown'));
    if (s.mode === 'paused' && (s.pauseReason === 'hidden' || s.pauseReason === 'blur')) notes.push(t('note.autoPaused'));
    if (!s.storagePersistent) notes.push(t('note.storageUnavailable'));
    if (!s.useLock) notes.push(t('note.noLock'));
    if (s.audioUnavailable) notes.push(t('note.audioUnavailable'));
    return { notes, hint: null };
  }
  if (s.mode === 'playing' && s.needsRelock) return { notes, hint: err ?? t('note.relock') };
  return { notes, hint: null };
}

/** 操作說明列出的動作（依序）。 */
export const HELP_CONTROLS: readonly { labelKey: StringKey; actions: readonly Action[] }[] = [
  { labelKey: 'help.move', actions: ['moveForward', 'moveLeft', 'moveBack', 'moveRight'] },
  { labelKey: 'help.jump', actions: ['jump'] },
  { labelKey: 'help.crouch', actions: ['crouch'] },
  { labelKey: 'help.dash', actions: ['dash'] },
  { labelKey: 'help.grapple', actions: ['grapple'] },
  { labelKey: 'help.fireAds', actions: ['fire', 'ads'] },
  { labelKey: 'help.reloadMelee', actions: ['reload', 'melee', 'interact'] },
  { labelKey: 'help.weapons', actions: ['weapon1', 'weapon5', 'weaponNext', 'weaponLast'] },
  { labelKey: 'help.pause', actions: ['pause'] },
];

export const HELP_TIPS: readonly StringKey[] = ['help.tip.sprint', 'help.tip.wall', 'help.tip.air', 'help.tip.grapple', 'help.tip.range'];

export interface ControlsLabeler {
  labelFor(action: Action, separator?: string): string;
}

/** 操作說明的每一列：[名稱, 按鍵]（按鍵名稱來自目前綁定）。武器 1 與 5 合併成「1–5」。 */
export function controlsRows(bindings: ControlsLabeler): [string, string][] {
  return HELP_CONTROLS.map(({ labelKey, actions }) => {
    if (labelKey === 'help.weapons') {
      const range = `${bindings.labelFor('weapon1')}–${bindings.labelFor('weapon5')}`;
      return [t(labelKey), [range, bindings.labelFor('weaponNext'), bindings.labelFor('weaponLast')].join(' ')];
    }
    return [t(labelKey), actions.map((a) => bindings.labelFor(a)).join(' ')];
  });
}
