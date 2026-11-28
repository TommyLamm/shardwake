// localStorage 包裝：key 一律加上 `shardwake:` 前綴並需帶版本段（例如 `settings:v1`）。
// localStorage 不存在、讀寫丟例外（sandbox、隱私模式、配額已滿）時退回記憶體儲存：
// 遊戲照常運作，但重新整理後資料會遺失；isPersistent 供 UI 顯示「目前無法存檔」。
// JSON 解析失敗時視為沒有資料（回傳 fallback），不覆寫原始內容，留給呼叫端決定。

export const STORAGE_PREFIX = 'shardwake:';

/** key 必須含有版本段，例如 `settings:v1`、`replay:v1:my-run`。 */
const VERSIONED_KEY = /(^|:)v\d+(:|$)/;

/** 與 Web Storage 相容的最小介面（測試可注入假的實作）。 */
export interface StorageBackend {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  key(index: number): string | null;
  readonly length: number;
}

export interface GameStorageOptions {
  /** 取得後端；預設為 globalThis.localStorage（取用本身也可能丟例外）。 */
  backend?: () => StorageBackend | null | undefined;
  prefix?: string;
  /** 持久化狀態改變時呼叫（例如寫入失敗退回記憶體）。 */
  onStatusChange?: (persistent: boolean, reason: string) => void;
}

function defaultBackend(): StorageBackend | null {
  return (globalThis as { localStorage?: StorageBackend }).localStorage ?? null;
}

function describe(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  return String(err);
}

export function assertVersionedKey(key: string): void {
  if (!key || key.startsWith(STORAGE_PREFIX) || !VERSIONED_KEY.test(key)) {
    throw new Error(`儲存 key 必須是不含前綴且帶版本的名稱（例如 settings:v1），收到「${key}」`);
  }
}

export class GameStorage {
  readonly prefix: string;
  private backend: StorageBackend | null = null;
  /** 記憶體儲存：不持久時的主要儲存；持久時作為寫入失敗後的覆蓋層。 */
  private readonly memory = new Map<string, string>();
  private readonly removed = new Set<string>();
  private persistent = false;
  private _reason = '';
  private readonly onStatusChange: ((persistent: boolean, reason: string) => void) | undefined;

  constructor(options: GameStorageOptions = {}) {
    this.prefix = options.prefix ?? STORAGE_PREFIX;
    this.onStatusChange = options.onStatusChange;
    const getBackend = options.backend ?? defaultBackend;
    try {
      const backend = getBackend();
      if (!backend) {
        this._reason = 'localStorage 不存在';
      } else {
        // 實際寫入一次確認可用（Safari 隱私模式等環境存在但寫入會丟例外）。
        const probe = `${this.prefix}__probe__`;
        backend.setItem(probe, '1');
        const ok = backend.getItem(probe) === '1';
        backend.removeItem(probe);
        if (ok) {
          this.backend = backend;
          this.persistent = true;
        } else {
          this._reason = 'localStorage 讀回的值不一致';
        }
      }
    } catch (err) {
      this._reason = describe(err);
    }
    if (!this.persistent) console.warn(`[shardwake] 無法使用 localStorage，改用記憶體儲存（${this._reason}）`);
  }

  /** 資料是否會保存到重新整理之後。 */
  get isPersistent(): boolean {
    return this.persistent;
  }

  /** 不持久的原因（持久時為空字串）。 */
  get reason(): string {
    return this._reason;
  }

  getString(key: string): string | null {
    assertVersionedKey(key);
    if (this.memory.has(key)) return this.memory.get(key)!;
    if (this.removed.has(key) || !this.backend) return null;
    try {
      return this.backend.getItem(this.prefix + key);
    } catch (err) {
      this.degrade(`讀取失敗：${describe(err)}`);
      return null;
    }
  }

  /** 寫入字串；回傳是否已持久保存（false 代表只存在記憶體）。 */
  setString(key: string, value: string): boolean {
    assertVersionedKey(key);
    if (this.backend) {
      try {
        this.backend.setItem(this.prefix + key, value);
        this.memory.delete(key);
        this.removed.delete(key);
        // 先前寫入失敗（例如配額）但現在可寫，且沒有只存在記憶體的資料時恢復持久狀態。
        if (!this.persistent && this.memory.size === 0 && this.removed.size === 0) this.restore();
        return true;
      } catch (err) {
        this.degrade(`寫入失敗：${describe(err)}`);
      }
    }
    this.memory.set(key, value);
    this.removed.delete(key);
    return false;
  }

  /**
   * 寫入大型、可捨棄的資料（M1-15 的錄影片段）：後端寫入失敗（例如容量不足）時不退回記憶體、
   * 不改變持久狀態（其他資料照常存檔），回傳 ok = false 與原因。本來就沒有後端時存在記憶體（ok、不持久）。
   */
  trySetString(key: string, value: string): { ok: boolean; persistent: boolean; error?: string } {
    assertVersionedKey(key);
    if (!this.backend) {
      this.memory.set(key, value);
      this.removed.delete(key);
      return { ok: true, persistent: false };
    }
    try {
      this.backend.setItem(this.prefix + key, value);
      this.memory.delete(key);
      this.removed.delete(key);
      return { ok: true, persistent: this.persistent };
    } catch (err) {
      return { ok: false, persistent: this.persistent, error: describe(err) };
    }
  }

  /** 讀取 JSON；不存在或解析失敗時回傳 fallback。 */
  getJSON<T>(key: string, fallback: T): T;
  getJSON<T>(key: string): T | null;
  getJSON<T>(key: string, fallback: T | null = null): T | null {
    const raw = this.getString(key);
    if (raw === null) return fallback;
    try {
      return JSON.parse(raw) as T;
    } catch (err) {
      console.warn(`[shardwake] 儲存資料「${key}」不是有效的 JSON，改用預設值（原始資料保留）`, err);
      return fallback;
    }
  }

  /** 寫入 JSON；回傳是否已持久保存。無法序列化時丟出例外（程式錯誤）。 */
  setJSON(key: string, value: unknown): boolean {
    return this.setString(key, JSON.stringify(value));
  }

  remove(key: string): void {
    assertVersionedKey(key);
    this.memory.delete(key);
    if (this.backend) {
      try {
        this.backend.removeItem(this.prefix + key);
        this.removed.delete(key);
        return;
      } catch (err) {
        this.degrade(`刪除失敗：${describe(err)}`);
      }
    }
    // 後端刪不掉時，記住已刪除，讀取不再回傳舊值。
    this.removed.add(key);
  }

  /** 列出本遊戲的 key（不含前綴）。 */
  keys(): string[] {
    const out = new Set<string>();
    if (this.backend) {
      try {
        for (let i = 0; i < this.backend.length; i++) {
          const k = this.backend.key(i);
          if (k?.startsWith(this.prefix) && !k.endsWith('__probe__')) out.add(k.slice(this.prefix.length));
        }
      } catch (err) {
        this.degrade(`列舉失敗：${describe(err)}`);
      }
    }
    for (const k of this.memory.keys()) out.add(k);
    for (const k of this.removed) out.delete(k);
    return [...out].sort();
  }

  private restore(): void {
    this.persistent = true;
    this._reason = '';
    this.onStatusChange?.(true, '');
  }

  /** 讀寫失敗時改用記憶體；已讀到的資料仍可從後端讀取，新寫入只存在記憶體。 */
  private degrade(reason: string): void {
    if (!this.persistent) return;
    this.persistent = false;
    this._reason = reason;
    console.warn(`[shardwake] 儲存退回記憶體（${reason}）`);
    this.onStatusChange?.(false, reason);
  }
}
