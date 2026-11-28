// 玩家設定：型別、預設值、欄位規格（範圍／選項，給驗證、設定頁與調參面板共用）、版本遷移、存讀與變更事件。
// 擴充方式（之後的計畫）：在 Settings 介面、SETTINGS_SCHEMA 加欄位即可；舊存檔缺少的欄位自動補預設值。
// 需要改變既有欄位的意義或格式時，提高 SETTINGS_VERSION 並在 MIGRATIONS 加一步遷移。
//
// 存檔格式（key `shardwake:settings:v1`）：{ "version": 1, "values": { ...欄位 } }
// 相容性：讀到不認識的欄位會原樣保留並寫回（預覽版與正式版共用同一個來源與儲存，
// 較新版本寫入的欄位不會被較舊版本刪掉）；版本號較新的資料只讀取認得的欄位，存檔時保留其版本號。
import type { EventBus } from '@/core/EventBus';
import type { GameEvents } from '@/core/events';
import { QUALITY_PRESETS, resolveQualityPreset, type QualityLevel, type QualityPreset } from '@/core/quality';
import type { GameStorage } from '@/core/Storage';

export { QUALITY_PRESETS, resolveQualityPreset };
export type { QualityLevel, QualityPreset };
/** 蹲、開鏡、抓鉤的操作方式（M1-03 的 InputFrame 轉換）。 */
export type HoldToggle = 'hold' | 'toggle';

export interface Settings {
  /** 滑鼠靈敏度（Source／Apex 尺度：每 count 0.022° × 靈敏度；M1-03 使用）。 */
  sensitivity: number;
  /** 滑鼠 DPI（只用來換算、顯示 cm/360，不影響轉動量；M1-03）。 */
  mouseDpi: number;
  /** Y 軸反轉（M1-03）。 */
  invertY: boolean;
  /** 蹲下：按住或切換（M1-03）。 */
  crouchMode: HoldToggle;
  /** 開鏡：按住或切換（M1-03）。 */
  adsMode: HoldToggle;
  /** 抓鉤：按住或切換（M1-03）。 */
  grappleMode: HoldToggle;
  /** 自動衝刺（往前移動即衝刺）；關閉時改用手動衝刺鍵（M1-05 使用）。 */
  autoSprint: boolean;
  /** 水平 FOV（度），依畫面比例換算成垂直 FOV。 */
  fovHorizontal: number;
  /** 動態 FOV（速度、Dash、抓鉤時放大視野；M1-08）。 */
  dynamicFov: boolean;
  /** 鏡頭傾斜（roll）強度 0–1：跑牆、滑鏟、側移、側向 Dash（M1-08）。 */
  cameraTilt: number;
  /** 落地下沉與點頭（M1-08）。 */
  landingDip: boolean;
  /** 頭部晃動（M1-08）。 */
  headBob: boolean;
  /** 畫面震動強度 0–1（M1-08，開火、爆炸、重落地、受擊）。 */
  screenShake: number;
  /** 高速時的速度線（M1-08）。 */
  speedLines: boolean;
  /** 畫面色差脈衝（Dash、受擊；M1-09）。 */
  chromaticAberration: boolean;
  /** 主音量 0–1（M1-13 使用）。 */
  masterVolume: number;
  /** 音效音量 0–1。 */
  sfxVolume: number;
  /** 介面音量 0–1。 */
  uiVolume: number;
  /** 畫質預設：渲染比例、陰影、Bloom、SMAA（內容見 core/quality.ts）。 */
  quality: QualityLevel;
  /** 顯示畫面角落的 FPS／frame time。 */
  showFps: boolean;
}

export type SettingsKey = keyof Settings;

export type SettingSpec =
  | { type: 'number'; default: number; min: number; max: number; step: number; label: string }
  | { type: 'boolean'; default: boolean; label: string }
  | { type: 'enum'; default: string; options: readonly string[]; optionLabels?: readonly string[]; label: string };

/** 欄位規格：預設值、合法範圍與顯示名稱。 */
export const SETTINGS_SCHEMA = {
  sensitivity: { type: 'number', default: 2, min: 0.05, max: 20, step: 0.01, label: '滑鼠靈敏度' },
  mouseDpi: { type: 'number', default: 800, min: 100, max: 32000, step: 50, label: '滑鼠 DPI' },
  invertY: { type: 'boolean', default: false, label: 'Y 軸反轉' },
  crouchMode: { type: 'enum', default: 'hold', options: ['hold', 'toggle'], optionLabels: ['按住', '切換'], label: '蹲下' },
  adsMode: { type: 'enum', default: 'hold', options: ['hold', 'toggle'], optionLabels: ['按住', '切換'], label: '開鏡' },
  grappleMode: { type: 'enum', default: 'hold', options: ['hold', 'toggle'], optionLabels: ['按住', '切換'], label: '抓鉤' },
  autoSprint: { type: 'boolean', default: true, label: '自動衝刺' },
  fovHorizontal: { type: 'number', default: 103, min: 80, max: 120, step: 1, label: '視野（水平 FOV）' },
  dynamicFov: { type: 'boolean', default: true, label: '動態視野' },
  cameraTilt: { type: 'number', default: 1, min: 0, max: 1, step: 0.05, label: '鏡頭傾斜強度' },
  landingDip: { type: 'boolean', default: true, label: '落地下沉' },
  headBob: { type: 'boolean', default: true, label: '頭部晃動' },
  screenShake: { type: 'number', default: 1, min: 0, max: 1, step: 0.05, label: '畫面震動強度' },
  speedLines: { type: 'boolean', default: true, label: '速度線' },
  chromaticAberration: { type: 'boolean', default: true, label: '畫面色差' },
  masterVolume: { type: 'number', default: 0.8, min: 0, max: 1, step: 0.01, label: '主音量' },
  sfxVolume: { type: 'number', default: 1, min: 0, max: 1, step: 0.01, label: '音效音量' },
  uiVolume: { type: 'number', default: 0.8, min: 0, max: 1, step: 0.01, label: '介面音量' },
  quality: {
    type: 'enum',
    default: 'high',
    options: ['low', 'medium', 'high'],
    optionLabels: ['低', '中', '高'],
    label: '畫質',
  },
  showFps: { type: 'boolean', default: true, label: '顯示 FPS' },
} as const satisfies Record<SettingsKey, SettingSpec>;

export const SETTINGS_KEY = 'settings:v1';
export const SETTINGS_VERSION = 1;

/** 遷移：MIGRATIONS[n] 把版本 n 的 values 轉成版本 n + 1。 */
export type SettingsMigration = (values: Record<string, unknown>) => Record<string, unknown>;
export const MIGRATIONS: Readonly<Record<number, SettingsMigration>> = {};

const SETTINGS_KEYS = Object.keys(SETTINGS_SCHEMA) as SettingsKey[];

export function defaultSettings(): Settings {
  const out: Record<string, unknown> = {};
  for (const key of SETTINGS_KEYS) out[key] = SETTINGS_SCHEMA[key].default;
  return out as unknown as Settings;
}

/** 驗證單一欄位；不合法時回傳 undefined。數字會夾在範圍內。 */
export function sanitizeSetting<K extends SettingsKey>(key: K, value: unknown): Settings[K] | undefined {
  const spec: SettingSpec = SETTINGS_SCHEMA[key];
  switch (spec.type) {
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
      return Math.min(Math.max(value, spec.min), spec.max) as Settings[K];
    case 'boolean':
      return typeof value === 'boolean' ? (value as Settings[K]) : undefined;
    case 'enum':
      return typeof value === 'string' && spec.options.includes(value) ? (value as Settings[K]) : undefined;
  }
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

export interface ParsedSettings {
  settings: Settings;
  /** 存檔中不認識的欄位（寫回時保留）。 */
  extra: Record<string, unknown>;
  /** 存檔的版本號（寫回時用 max(這個, SETTINGS_VERSION)）。 */
  version: number;
  /** 是否需要寫回（遷移過、補了預設值或修正了不合法值）。 */
  dirty: boolean;
}

/** 把存檔內容（任意 JSON）轉成合法設定；永遠不丟例外。 */
export function parseSettings(
  raw: unknown,
  migrations: Readonly<Record<number, SettingsMigration>> = MIGRATIONS,
  currentVersion: number = SETTINGS_VERSION,
): ParsedSettings {
  const settings = defaultSettings();
  if (!isRecord(raw) || !isRecord(raw.values)) {
    return { settings, extra: {}, version: currentVersion, dirty: raw !== null && raw !== undefined };
  }
  let version = typeof raw.version === 'number' && Number.isInteger(raw.version) && raw.version >= 1 ? raw.version : 1;
  let values: Record<string, unknown> = { ...raw.values };
  let dirty = version !== raw.version;
  while (version < currentVersion) {
    const step = migrations[version];
    if (step) values = step(values);
    version++;
    dirty = true;
  }
  const extra: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(values)) {
    if (!(k in SETTINGS_SCHEMA)) extra[k] = v;
  }
  const out = settings as unknown as Record<string, unknown>;
  for (const key of SETTINGS_KEYS) {
    const v = sanitizeSetting(key, values[key]);
    if (v === undefined) dirty = true;
    else {
      if (v !== values[key]) dirty = true;
      out[key] = v;
    }
  }
  return { settings, extra, version, dirty };
}

export type SettingsListener = (settings: Readonly<Settings>, changed: readonly SettingsKey[]) => void;

export class SettingsStore {
  private current: Settings;
  private extra: Record<string, unknown> = {};
  private version = SETTINGS_VERSION;
  private readonly listeners = new Set<SettingsListener>();

  constructor(
    private readonly storage: GameStorage,
    private readonly bus?: EventBus<GameEvents>,
  ) {
    this.current = defaultSettings();
    this.load();
  }

  /** 目前設定（唯讀快照；修改請用 set／update）。 */
  get value(): Readonly<Settings> {
    return this.current;
  }

  get<K extends SettingsKey>(key: K): Settings[K] {
    return this.current[key];
  }

  /** 目前畫質預設的參數（已夾住範圍的複本）。 */
  get qualityPreset(): QualityPreset {
    return resolveQualityPreset(this.current.quality);
  }

  /** 從儲存重新讀取（不發出變更事件）。 */
  load(): void {
    const parsed = parseSettings(this.storage.getJSON<unknown>(SETTINGS_KEY));
    this.current = parsed.settings;
    this.extra = parsed.extra;
    this.version = Math.max(parsed.version, SETTINGS_VERSION);
    if (parsed.dirty) this.save();
  }

  set<K extends SettingsKey>(key: K, value: Settings[K]): boolean {
    return this.update({ [key]: value } as Partial<Settings>).length > 0;
  }

  /** 套用部分設定（不合法的值忽略、數字夾在範圍內）；回傳實際改變的欄位。 */
  update(patch: Partial<Settings>): SettingsKey[] {
    const changed: SettingsKey[] = [];
    const next = { ...this.current } as Record<string, unknown>;
    for (const key of Object.keys(patch) as SettingsKey[]) {
      if (!(key in SETTINGS_SCHEMA)) continue;
      const v = sanitizeSetting(key, patch[key]);
      if (v === undefined || v === this.current[key]) continue;
      next[key] = v;
      changed.push(key);
    }
    if (changed.length > 0) {
      this.current = next as unknown as Settings;
      this.save();
      this.notify(changed);
    }
    return changed;
  }

  /** 恢復預設（全部或指定欄位）。 */
  reset(keys: readonly SettingsKey[] = SETTINGS_KEYS): SettingsKey[] {
    const defaults = defaultSettings();
    const patch: Partial<Record<SettingsKey, unknown>> = {};
    for (const key of keys) patch[key] = defaults[key];
    return this.update(patch as Partial<Settings>);
  }

  /** 訂閱變更；回傳取消函式。也可以改用 EventBus 的 'settings:changed'。 */
  onChange(listener: SettingsListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private save(): void {
    this.storage.setJSON(SETTINGS_KEY, {
      version: this.version,
      values: { ...this.extra, ...this.current },
    });
  }

  private notify(changed: readonly SettingsKey[]): void {
    for (const l of this.listeners) l(this.current, changed);
    this.bus?.emit('settings:changed', { settings: this.current, changed });
  }
}
