// 錯誤畫面與載入畫面（M1-16）。
// - ErrorScreen：致命錯誤時蓋住整個遊戲（WebGL 不可用、context lost、Rapier 初始化失敗、檔案載入失敗、啟動或執行中錯誤），
//   顯示中文標題、說明、可展開的技術細節與「重試」按鈕（預設重新載入 iframe 內的頁面；不跳出 iframe）。
// - BootScreen：index.html 內的靜態載入畫面（#sw-boot，JS 載入前就顯示），啟動各階段更新文字，完成後移除。
// 文字在 i18n 字串表（error.*、boot.*）；errorText() 是純函式，可無頭測試。
import type { ErrorReport, FatalKind } from '@/core/errors';
import { t, type StringKey } from '@/i18n';

export interface ErrorText {
  title: string;
  body: string;
}

const TITLE_KEYS: Record<FatalKind, StringKey> = {
  webgl: 'error.webgl.title',
  contextLost: 'error.contextLost.title',
  physics: 'error.physics.title',
  load: 'error.load.title',
  boot: 'error.boot.title',
  runtime: 'error.runtime.title',
};

const BODY_KEYS: Record<FatalKind, StringKey> = {
  webgl: 'error.webgl.body',
  contextLost: 'error.contextLost.body',
  physics: 'error.physics.body',
  load: 'error.load.body',
  boot: 'error.boot.body',
  runtime: 'error.runtime.body',
};

/** 錯誤分類 → 玩家看得懂的標題與說明。 */
export function errorText(kind: FatalKind): ErrorText {
  return { title: t(TITLE_KEYS[kind]), body: t(BODY_KEYS[kind]) };
}

export interface ErrorScreenOptions {
  container: HTMLElement;
  /** 「重試」的預設行為（預設重新載入頁面）。 */
  reload?: () => void;
}

export interface ShowOptions {
  /** 覆寫重試行為（例如 context 恢復後改成「繼續」）。 */
  onRetry?: () => void;
  retryLabel?: string;
}

export class ErrorScreen {
  readonly root: HTMLDivElement;
  private readonly titleEl: HTMLHeadingElement;
  private readonly bodyEl: HTMLParagraphElement;
  private readonly stageEl: HTMLParagraphElement;
  private readonly detailsEl: HTMLDetailsElement;
  private readonly detailEl: HTMLPreElement;
  private readonly retryEl: HTMLButtonElement;
  private readonly reload: () => void;
  private onRetry: (() => void) | null = null;
  private _kind: FatalKind | null = null;

  constructor(options: ErrorScreenOptions) {
    this.reload = options.reload ?? (() => location.reload());
    const doc = options.container.ownerDocument;
    const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string): HTMLElementTagNameMap[K] => {
      const e = doc.createElement(tag);
      e.className = cls;
      return e;
    };
    this.root = el('div', 'sw-error');
    this.root.hidden = true;
    this.root.setAttribute('role', 'alertdialog');
    this.root.setAttribute('aria-modal', 'true');
    const panel = el('div', 'sw-error-panel');
    this.titleEl = el('h2', 'sw-error-title');
    this.bodyEl = el('p', 'sw-error-body');
    this.stageEl = el('p', 'sw-error-stage');
    this.detailsEl = el('details', 'sw-error-details');
    const summary = el('summary', 'sw-error-summary');
    summary.textContent = t('error.details');
    this.detailEl = el('pre', 'sw-error-detail');
    this.detailsEl.append(summary, this.detailEl);
    const actions = el('div', 'sw-error-actions');
    this.retryEl = el('button', 'sw-error-retry');
    this.retryEl.type = 'button';
    this.retryEl.addEventListener('click', () => {
      const fn = this.onRetry;
      if (fn) fn();
      else this.reload();
    });
    actions.append(this.retryEl);
    const note = el('p', 'sw-error-note');
    note.textContent = t('error.note');
    panel.append(this.titleEl, this.bodyEl, this.stageEl, this.detailsEl, actions, note);
    this.root.append(panel);
    // 錯誤畫面上的點擊與按鍵不傳給遊戲（避免重新鎖定滑鼠、觸發快捷鍵）。
    for (const type of ['pointerdown', 'mousedown', 'click', 'keydown', 'wheel'] as const) this.root.addEventListener(type, (e) => e.stopPropagation());
    options.container.appendChild(this.root);
  }

  get visible(): boolean {
    return !this.root.hidden;
  }

  get kind(): FatalKind | null {
    return this.visible ? this._kind : null;
  }

  show(report: Readonly<ErrorReport>, options: ShowOptions = {}): void {
    const text = errorText(report.kind);
    this._kind = report.kind;
    this.titleEl.textContent = text.title;
    this.bodyEl.textContent = text.body;
    this.stageEl.textContent = report.stage ? t('error.stage', { stage: report.stage }) : '';
    this.stageEl.hidden = !report.stage;
    this.detailEl.textContent = report.detail;
    this.detailsEl.hidden = !report.detail;
    this.onRetry = options.onRetry ?? null;
    this.retryEl.textContent = options.retryLabel ?? t('error.retry');
    this.root.hidden = false;
    this.root.dataset.kind = report.kind;
    this.root.ownerDocument.documentElement.dataset.swError = report.kind;
    if (this.root.ownerDocument.pointerLockElement) this.root.ownerDocument.exitPointerLock();
    this.retryEl.focus({ preventScroll: true });
  }

  hide(): void {
    this.root.hidden = true;
    this._kind = null;
    delete this.root.ownerDocument.documentElement.dataset.swError;
  }
}

/** index.html 的靜態載入畫面（#sw-boot）；找不到時建立一個。 */
export class BootScreen {
  readonly root: HTMLElement;
  private readonly stageEl: HTMLElement;

  constructor(container: HTMLElement) {
    const doc = container.ownerDocument;
    let root = doc.getElementById('sw-boot');
    if (!root) {
      root = doc.createElement('div');
      root.id = 'sw-boot';
      root.className = 'sw-boot';
      container.appendChild(root);
    }
    this.root = root;
    let stage = root.querySelector<HTMLElement>('.sw-boot-stage');
    if (!stage) {
      stage = doc.createElement('div');
      stage.className = 'sw-boot-stage';
      root.appendChild(stage);
    }
    this.stageEl = stage;
    // 載入看門狗（index.html 的行內腳本）的提示與按鈕在 JS 開始執行後就不需要了。
    root.querySelector('.sw-boot-slow')?.remove();
  }

  /** 顯示目前的啟動階段。 */
  stage(text: string): void {
    this.stageEl.textContent = text;
  }

  /** 啟動完成或失敗：移除載入畫面。 */
  done(): void {
    this.root.remove();
  }
}
