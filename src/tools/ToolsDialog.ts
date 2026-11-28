// 調校工具對話框（M1-15，開發用 DOM 介面）：預設組合與錄影片段的管理、匯出、匯入。
// - 匯出：文字放進文字框並全選（可直接 Ctrl+C）、嘗試複製到剪貼簿、提供 Blob 下載連結（<a download>，不開新視窗、不離開 iframe）。
//   跨來源 iframe 若沒有剪貼簿或下載權限，文字框仍可手動複製。
// - 匯入：把 JSON 貼進文字框後按「匯入」。
// 元素帶 .sw-debug：輸入系統與「點擊畫面鎖定滑鼠」都會略過它；文字框內的按鍵不會被當成遊戲輸入。
import { h } from '@/ui/dom';

export interface ToolsDialogItem {
  name: string;
  detail?: string;
}

export interface ToolsDialogActions {
  presets(): readonly ToolsDialogItem[];
  clips(): readonly ToolsDialogItem[];
  applyPreset(name: string): string;
  deletePreset(name: string): string;
  savePreset(name: string): string;
  exportPreset(name: string | null): { text: string; filename: string } | string;
  importPreset(text: string, apply: boolean): string;
  loadClip(name: string): string;
  deleteClip(name: string): string;
  saveClip(name: string): string;
  exportClip(name: string | null): { text: string; filename: string } | string;
  importClip(text: string): string;
  currentClipName(): string | null;
}

type Kind = 'preset' | 'clip';

/**
 * 這個文件能不能寫入剪貼簿：平台的 sandbox iframe 沒有 clipboard-write 權限時，呼叫會被權限政策擋下
 * 並在主控台留下錯誤，所以先查權限政策（不支援查詢的瀏覽器照常嘗試）。
 */
export function clipboardAllowed(): boolean {
  const doc = globalThis.document as (Document & { featurePolicy?: { allowsFeature(f: string): boolean }; permissionsPolicy?: { allowsFeature(f: string): boolean } }) | undefined;
  const policy = doc?.permissionsPolicy ?? doc?.featurePolicy;
  try {
    return policy ? policy.allowsFeature('clipboard-write') : true;
  } catch {
    return true;
  }
}

export class ToolsDialog {
  readonly root: HTMLElement;
  private readonly presetSelect: HTMLSelectElement;
  private readonly clipSelect: HTMLSelectElement;
  private readonly presetName: HTMLInputElement;
  private readonly clipName: HTMLInputElement;
  private readonly text: HTMLTextAreaElement;
  private readonly status: HTMLElement;
  private readonly download: HTMLAnchorElement;
  private downloadUrl: string | null = null;

  constructor(
    container: HTMLElement,
    private readonly actions: ToolsDialogActions,
  ) {
    const btn = (label: string, onClick: () => void): HTMLButtonElement => {
      const b = h('button', { class: 'sw-tools-btn', text: label, attrs: { type: 'button' } });
      b.addEventListener('click', onClick);
      return b;
    };
    this.presetSelect = h('select', { class: 'sw-tools-select', attrs: { 'aria-label': '預設組合' } });
    this.clipSelect = h('select', { class: 'sw-tools-select', attrs: { 'aria-label': '錄影片段' } });
    this.presetName = h('input', { class: 'sw-tools-input', attrs: { type: 'text', placeholder: '新組合名稱', maxlength: '40' } });
    this.clipName = h('input', { class: 'sw-tools-input', attrs: { type: 'text', placeholder: '片段名稱', maxlength: '40' } });
    this.text = h('textarea', { class: 'sw-tools-text', attrs: { spellcheck: 'false', placeholder: '匯出的 JSON 會出現在這裡；匯入時把 JSON 貼在這裡' } });
    this.status = h('p', { class: 'sw-tools-status', attrs: { 'aria-live': 'polite' } });
    this.download = h('a', { class: 'sw-tools-download', text: '下載檔案', hidden: true });
    const sel = (s: HTMLSelectElement): string | null => s.value || null;
    this.root = h('div', { class: 'sw-debug sw-tools-dialog', hidden: true, attrs: { role: 'dialog', 'aria-label': '調校工具' } }, [
      h('div', { class: 'sw-tools-head' }, [h('strong', { text: '調校工具：預設組合與錄影' }), btn('關閉', () => this.close())]),
      h('section', { class: 'sw-tools-section' }, [
        h('h3', { text: '預設組合（移動、鏡頭、武器）' }),
        h('div', { class: 'sw-tools-row' }, [
          this.presetSelect,
          btn('套用', () => this.run(() => (sel(this.presetSelect) ? this.actions.applyPreset(sel(this.presetSelect)!) : '請先選擇組合'))),
          btn('刪除', () => this.run(() => (sel(this.presetSelect) ? this.actions.deletePreset(sel(this.presetSelect)!) : '請先選擇組合'))),
          btn('匯出所選', () => this.exportResult(this.actions.exportPreset(sel(this.presetSelect)))),
          btn('匯出目前數值', () => this.exportResult(this.actions.exportPreset(null))),
        ]),
        h('div', { class: 'sw-tools-row' }, [
          this.presetName,
          btn('存成組合', () => this.run(() => this.actions.savePreset(this.presetName.value))),
          btn('匯入', () => this.run(() => this.actions.importPreset(this.text.value, false))),
          btn('匯入並套用', () => this.run(() => this.actions.importPreset(this.text.value, true))),
        ]),
      ]),
      h('section', { class: 'sw-tools-section' }, [
        h('h3', { text: '錄影片段（F8 錄製、F9 重播）' }),
        h('div', { class: 'sw-tools-row' }, [
          this.clipSelect,
          btn('載入為目前錄影', () => this.run(() => (sel(this.clipSelect) ? this.actions.loadClip(sel(this.clipSelect)!) : '請先選擇片段'))),
          btn('刪除', () => this.run(() => (sel(this.clipSelect) ? this.actions.deleteClip(sel(this.clipSelect)!) : '請先選擇片段'))),
          btn('匯出所選', () => this.exportResult(this.actions.exportClip(sel(this.clipSelect)))),
          btn('匯出目前錄影', () => this.exportResult(this.actions.exportClip(null))),
        ]),
        h('div', { class: 'sw-tools-row' }, [
          this.clipName,
          btn('儲存目前錄影', () => this.run(() => this.actions.saveClip(this.clipName.value))),
          btn('匯入為目前錄影', () => this.run(() => this.actions.importClip(this.text.value))),
        ]),
      ]),
      this.text,
      h('div', { class: 'sw-tools-row' }, [this.download, this.status]),
    ]);
    container.appendChild(this.root);
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  open(): void {
    this.refresh();
    this.root.hidden = false;
  }

  close(): void {
    this.root.hidden = true;
  }

  toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
  }

  /** 重新列出組合與片段（保留目前的選擇）。 */
  refresh(): void {
    this.fill(this.presetSelect, this.actions.presets(), 'preset');
    this.fill(this.clipSelect, this.actions.clips(), 'clip');
    const cur = this.actions.currentClipName();
    if (cur && !this.clipName.value) this.clipName.value = cur;
  }

  setStatus(text: string): void {
    this.status.textContent = text;
  }

  dispose(): void {
    if (this.downloadUrl) URL.revokeObjectURL(this.downloadUrl);
    this.root.remove();
  }

  private fill(select: HTMLSelectElement, items: readonly ToolsDialogItem[], kind: Kind): void {
    const prev = select.value;
    select.replaceChildren(
      ...(items.length === 0 ? [h('option', { text: kind === 'preset' ? '（沒有組合）' : '（沒有已存的片段）', attrs: { value: '' } })] : []),
      ...items.map((it) => h('option', { text: it.detail ? `${it.name}　${it.detail}` : it.name, attrs: { value: it.name } })),
    );
    if (items.some((it) => it.name === prev)) select.value = prev;
  }

  private run(fn: () => string): void {
    let msg: string;
    try {
      msg = fn();
    } catch (err) {
      msg = `失敗：${err instanceof Error ? err.message : String(err)}`;
    }
    this.setStatus(msg);
    this.refresh();
  }

  private exportResult(r: { text: string; filename: string } | string): void {
    if (typeof r === 'string') {
      this.setStatus(r);
      return;
    }
    this.text.value = r.text;
    this.text.focus();
    this.text.select();
    let status = '已放進文字框並全選（可按 Ctrl+C 複製）';
    const clip = clipboardAllowed() ? (globalThis as { navigator?: { clipboard?: { writeText(t: string): Promise<void> } } }).navigator?.clipboard : undefined;
    if (!clip) status += '；剪貼簿不可用（iframe 權限），可按「下載檔案」';
    if (clip) {
      clip.writeText(r.text).then(
        () => this.setStatus(`已複製到剪貼簿，也放進文字框；或按「下載檔案」存成 ${r.filename}`),
        () => this.setStatus(`${status}；剪貼簿不可用（iframe 權限），或按「下載檔案」`),
      );
    }
    if (this.downloadUrl) URL.revokeObjectURL(this.downloadUrl);
    try {
      this.downloadUrl = URL.createObjectURL(new Blob([r.text], { type: 'application/json' }));
      this.download.href = this.downloadUrl;
      this.download.download = r.filename;
      this.download.hidden = false;
    } catch {
      this.download.hidden = true;
      status += '；無法建立下載連結';
    }
    this.setStatus(status);
  }
}
