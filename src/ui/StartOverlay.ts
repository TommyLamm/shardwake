// 最小的「點擊開始」覆蓋層（M1-03）：標題／暫停時蓋住畫面，點擊後由 LockFlow 鎖定滑鼠並開始或繼續。
// 完整的標題、暫停與設定選單在 M1-14 取代。文字內容由純函式 overlayContent() 決定（可無頭測試）。
import type { GameMode, PauseReason } from '@/core/events';
import type { Action } from '@/input/Actions';

export interface OverlayState {
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
}

export interface OverlayContent {
  /** full：蓋住畫面的覆蓋層；hint：畫面下方的小提示（不擋點擊）；hidden：不顯示。 */
  kind: 'full' | 'hint' | 'hidden';
  title: string;
  prompt: string;
  notes: string[];
  showControls: boolean;
}

/** 操作說明列出的動作（依序）。 */
export const OVERLAY_CONTROLS: readonly { label: string; actions: readonly Action[] }[] = [
  { label: '移動', actions: ['moveForward', 'moveLeft', 'moveBack', 'moveRight'] },
  { label: '跳躍', actions: ['jump'] },
  { label: '蹲下／滑鏟', actions: ['crouch'] },
  { label: 'Dash', actions: ['dash'] },
  { label: '抓鉤', actions: ['grapple'] },
  { label: '射擊／開鏡', actions: ['fire', 'ads'] },
  { label: '換彈／近戰／互動', actions: ['reload', 'melee', 'interact'] },
  { label: '暫停', actions: ['pause'] },
];

export function overlayContent(s: OverlayState): OverlayContent {
  const notes: string[] = [];
  if (!s.storagePersistent) notes.push('目前無法存檔（設定只保留到關閉頁面）');
  if (!s.useLock) notes.push('未使用滑鼠鎖定：沒有滑鼠視角');
  const err = s.lockError ? `無法鎖定滑鼠，請再點擊一次（${s.lockError}）` : null;

  if (s.mode === 'title') {
    if (err) notes.unshift(err);
    return { kind: 'full', title: '碎晶航跡 SHARDWAKE', prompt: '點擊開始', notes, showControls: true };
  }
  if (s.mode === 'paused') {
    if (err) notes.unshift(err);
    else if (s.lockCooldown && s.useLock) notes.unshift('剛解除滑鼠鎖定：若點擊沒有反應，請稍候一秒再點');
    if (s.pauseReason === 'hidden' || s.pauseReason === 'blur') notes.unshift('離開遊戲畫面時已自動暫停');
    return { kind: 'full', title: '已暫停', prompt: '點擊繼續', notes, showControls: true };
  }
  if (s.mode === 'playing' && s.needsRelock) {
    return { kind: 'hint', title: '', prompt: err ? `${err}` : '點擊畫面恢復滑鼠視角', notes: [], showControls: false };
  }
  return { kind: 'hidden', title: '', prompt: '', notes: [], showControls: false };
}

export interface ControlsLabeler {
  labelFor(action: Action, separator?: string): string;
}

/** 操作說明的每一列：[名稱, 按鍵]。 */
export function controlsRows(bindings: ControlsLabeler): [string, string][] {
  return OVERLAY_CONTROLS.map(({ label, actions }) => [label, actions.map((a) => bindings.labelFor(a)).join(' ')]);
}

export class StartOverlay {
  readonly root: HTMLDivElement;
  private readonly titleEl: HTMLDivElement;
  private readonly promptEl: HTMLDivElement;
  private readonly controlsEl: HTMLDListElement;
  private readonly notesEl: HTMLDivElement;
  private readonly hintEl: HTMLDivElement;
  private lastKey = '';

  constructor(
    container: HTMLElement,
    private readonly bindings: ControlsLabeler,
  ) {
    const el = (tag: string, cls: string): HTMLElement => {
      const e = document.createElement(tag);
      e.className = cls;
      return e;
    };
    this.root = el('div', 'sw-overlay') as HTMLDivElement;
    this.titleEl = el('div', 'sw-overlay-title') as HTMLDivElement;
    this.promptEl = el('div', 'sw-overlay-prompt') as HTMLDivElement;
    this.controlsEl = el('dl', 'sw-overlay-controls') as HTMLDListElement;
    this.notesEl = el('div', 'sw-overlay-notes') as HTMLDivElement;
    this.root.append(this.titleEl, this.promptEl, this.controlsEl, this.notesEl);
    this.hintEl = el('div', 'sw-hint') as HTMLDivElement;
    this.hintEl.hidden = true;
    container.append(this.root, this.hintEl);
  }

  update(state: OverlayState): void {
    const c = overlayContent(state);
    const rows = c.showControls ? controlsRows(this.bindings) : [];
    const key = JSON.stringify([c, rows]);
    if (key === this.lastKey) return;
    this.lastKey = key;
    this.root.hidden = c.kind !== 'full';
    this.hintEl.hidden = c.kind !== 'hint';
    document.documentElement.dataset.swOverlay = c.kind;
    if (c.kind === 'hint') {
      this.hintEl.textContent = c.prompt;
      return;
    }
    this.titleEl.textContent = c.title;
    this.promptEl.textContent = c.prompt;
    this.notesEl.textContent = c.notes.join('\n');
    this.controlsEl.replaceChildren();
    for (const [label, keys] of rows) {
      const dt = document.createElement('dt');
      dt.textContent = label;
      const dd = document.createElement('dd');
      dd.textContent = keys;
      this.controlsEl.append(dt, dd);
    }
  }

  dispose(): void {
    this.root.remove();
    this.hintEl.remove();
  }
}
