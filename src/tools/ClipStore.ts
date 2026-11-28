// 具名錄影片段的本機儲存（M1-15）。
// - 每段一個 key：`shardwake:replay:v1:<名稱>`（名稱以 encodeURIComponent 編碼），另有索引 `shardwake:replays:v1`
//   （{ version, clips: [{ key, name, savedAt, seconds, bytes }] }）讓列表不必解析每段錄影。
// - 錄影可能很大：寫入用 GameStorage.trySetString，容量不足時回報失敗，不會讓其他存檔（設定、按鍵）退回記憶體。
// - 儲存不可用時存在記憶體（重新整理後消失），介面提示。
import type { GameStorage } from '@/core/Storage';
import { clipDuration, serializeClip, validateClip, type InputClip } from '@/tools/clip';
import { sanitizePresetName } from '@/tools/Presets';

export const CLIP_INDEX_KEY = 'replays:v1';
export const CLIP_KEY_PREFIX = 'replay:v1:';

export interface ClipEntry {
  key: string;
  name: string;
  savedAt: string;
  seconds: number;
  /** JSON 長度（字元）。 */
  bytes: number;
}

export interface ClipSaveResult {
  ok: boolean;
  persistent: boolean;
  error?: string;
}

function isPlainObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

export function clipKey(name: string): string {
  return `${CLIP_KEY_PREFIX}${encodeURIComponent(name)}`;
}

export class ClipStore {
  private entries: ClipEntry[] = [];

  constructor(
    private readonly storage: GameStorage | null,
    private readonly getLimit: () => number = () => 12,
  ) {
    this.load();
  }

  get list(): readonly ClipEntry[] {
    return this.entries;
  }

  load(): void {
    this.entries = [];
    const raw = this.storage?.getJSON<unknown>(CLIP_INDEX_KEY) ?? null;
    if (!isPlainObject(raw) || !Array.isArray(raw.clips)) return;
    for (const e of raw.clips) {
      if (!isPlainObject(e) || typeof e.key !== 'string' || !e.key.startsWith(CLIP_KEY_PREFIX) || typeof e.name !== 'string') continue;
      if (this.entries.some((x) => x.key === e.key)) continue;
      this.entries.push({
        key: e.key,
        name: e.name,
        savedAt: typeof e.savedAt === 'string' ? e.savedAt : '',
        seconds: typeof e.seconds === 'number' ? e.seconds : 0,
        bytes: typeof e.bytes === 'number' ? e.bytes : 0,
      });
    }
  }

  /** 讀出一段錄影（找不到或壞掉時回傳 null 與原因）。 */
  read(name: string): { clip: InputClip | null; error?: string } {
    const entry = this.entries.find((e) => e.name === name);
    if (!entry || !this.storage) return { clip: null, error: '找不到這段錄影' };
    const text = this.storage.getString(entry.key);
    if (text === null) return { clip: null, error: '錄影資料不存在（可能已被清除）' };
    const v = validateClip(text);
    return v.ok ? { clip: v.clip } : { clip: null, error: v.errors.join('；') };
  }

  /** 存成具名片段（同名覆寫）；超過上限時拒絕（請先刪除舊的）。 */
  save(name: string, clip: Readonly<InputClip>): ClipSaveResult {
    const n = sanitizePresetName(name);
    if (!n) return { ok: false, persistent: false, error: '名稱不可空白' };
    if (!this.storage) return { ok: false, persistent: false, error: '儲存不可用' };
    const exists = this.entries.some((e) => e.name === n);
    if (!exists && this.entries.length >= Math.max(1, Math.floor(this.getLimit()))) {
      return { ok: false, persistent: false, error: `已達 ${this.getLimit()} 段上限，請先刪除舊的錄影` };
    }
    const text = serializeClip({ ...clip, name: n });
    const key = clipKey(n);
    const r = this.storage.trySetString(key, text);
    if (!r.ok) return { ok: false, persistent: false, error: `容量不足或無法寫入（${r.error ?? ''}）；可改用匯出保存` };
    const entry: ClipEntry = { key, name: n, savedAt: new Date().toISOString(), seconds: clipDuration(clip), bytes: text.length };
    const i = this.entries.findIndex((e) => e.name === n);
    if (i >= 0) this.entries[i] = entry;
    else this.entries.push(entry);
    const idx = this.writeIndex();
    if (!idx.ok) {
      // 索引寫不進去：撤回這一段，避免留下列表看不到的資料。
      this.storage.remove(key);
      this.entries = this.entries.filter((e) => e.key !== key);
      return { ok: false, persistent: false, error: idx.error ?? '無法寫入索引' };
    }
    return { ok: true, persistent: r.persistent && idx.persistent };
  }

  remove(name: string): boolean {
    const entry = this.entries.find((e) => e.name === name);
    if (!entry) return false;
    this.storage?.remove(entry.key);
    this.entries = this.entries.filter((e) => e !== entry);
    this.writeIndex();
    return true;
  }

  private writeIndex(): { ok: boolean; persistent: boolean; error?: string } {
    if (!this.storage) return { ok: true, persistent: false };
    return this.storage.trySetString(CLIP_INDEX_KEY, JSON.stringify({ version: 1, clips: this.entries }));
  }
}
