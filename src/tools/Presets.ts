// 調參預設組合（M1-15）：內建「標準」「高速」「穩重」，加上玩家存的具名組合（`shardwake:presets:v1`）。
//
// 存檔：{ version: 1, presets: [{ name, savedAt, values }] }；values 是與預設值的差異（tuning.ts 的 diffTuning）。
// 匯出／匯入的 JSON：{ format: 'shardwake-preset', version: 1, name, gameVersion, values }。
// - 匯入時驗證格式與版本：較新的 version 拒絕（可能有看不懂的欄位）；未知欄位與不合法的值在套用時略過並列出警告。
// - 儲存不可用或寫入失敗時，組合只留在記憶體（不拋錯，回傳狀態給介面提示）。
// - 不認識的存檔欄位原樣保留並寫回（預覽版與正式版共用儲存）。
import type { GameStorage } from '@/core/Storage';
import type { TuningValues } from '@/tools/tuning';

export const PRESETS_KEY = 'presets:v1';
export const PRESETS_VERSION = 1;
export const PRESET_FORMAT = 'shardwake-preset';
export const PRESET_FORMAT_VERSION = 1;
/** 名稱長度上限（字元）。 */
export const PRESET_NAME_MAX = 40;

export interface Preset {
  name: string;
  /** 內建組合不能刪除或覆寫。 */
  builtin?: boolean;
  /** 說明（內建組合）。 */
  description?: string;
  /** 儲存時間（ISO 字串）。 */
  savedAt?: string;
  values: TuningValues;
}

export interface PresetFile {
  format: typeof PRESET_FORMAT;
  version: number;
  name: string;
  gameVersion?: string;
  savedAt?: string;
  values: TuningValues;
}

/** 內建組合：只調整移動與鏡頭（武器維持原型）。數值集中在這裡，可直接修改。 */
export const BUILTIN_PRESETS: readonly Preset[] = [
  { name: '標準', builtin: true, description: '所有參數為預設值', values: {} },
  {
    name: '高速',
    builtin: true,
    description: '更快的跑速、滑鏟與 Dash，空中更好控制，速度感更強',
    values: {
      movement: {
        runSpeed: 8.5,
        sprintSpeed: 12,
        groundAccel: 14,
        slideBoost: 4.5,
        slideBoostMaxSpeed: 18,
        slideFriction: 0.6,
        airAccel: 3,
        airControlDegPerSec: 60,
        airSpeedSoftCap: 26,
        wallRunEntrySpeed: 12,
        dashDistance: 8.5,
        dashExitMinSpeed: 14,
        grappleMaxSpeed: 30,
      },
      camera: { fovSpeedMin: 11, fovSpeedMax: 26, fovSpeedBonus: 10 },
    },
  },
  {
    name: '穩重',
    builtin: true,
    description: '較低的跑速與空中控制、較重的落地，鏡頭傾斜與晃動較少',
    values: {
      movement: {
        runSpeed: 6.8,
        sprintSpeed: 9.5,
        groundAccel: 9,
        friction: 7,
        gravity: 27,
        airAccel: 1.8,
        airControlDegPerSec: 30,
        slideBoost: 2.5,
        slideFriction: 1.1,
        dashDistance: 6,
        grappleMaxSpeed: 22,
      },
      camera: { wallRunRollDeg: 8, slideRollDeg: 2, strafeRollDeg: 0.5, bobVertical: 0.01, bobHorizontal: 0.005, landMaxDip: 0.15 },
    },
  },
];

export interface ParsedPreset {
  ok: boolean;
  preset: Preset | null;
  errors: string[];
}

function isPlainObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

/** 整理名稱：去掉前後空白與控制字元、限制長度。 */
export function sanitizePresetName(name: unknown): string {
  if (typeof name !== 'string') return '';
  return name.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, PRESET_NAME_MAX);
}

/** values 的結構檢查（欄位內容在套用時逐一驗證）。 */
export function validateTuningShape(values: unknown, errors: string[]): values is TuningValues {
  if (!isPlainObject(values)) {
    errors.push('values 必須是物件');
    return false;
  }
  for (const k of Object.keys(values)) {
    if (k !== 'movement' && k !== 'camera' && k !== 'weapons') errors.push(`values.${k}：未知的分類`);
  }
  for (const k of ['movement', 'camera', 'weapons'] as const) {
    if (values[k] !== undefined && !isPlainObject(values[k])) errors.push(`values.${k} 必須是物件`);
  }
  return errors.length === 0;
}

/** 序列化成匯出用 JSON（縮排兩格）。 */
export function serializePreset(preset: Readonly<Preset>, gameVersion?: string): string {
  const file: PresetFile = {
    format: PRESET_FORMAT,
    version: PRESET_FORMAT_VERSION,
    name: preset.name,
    ...(gameVersion ? { gameVersion } : {}),
    savedAt: preset.savedAt ?? new Date().toISOString(),
    values: preset.values,
  };
  return JSON.stringify(file, null, 2);
}

/** 解析匯入的 JSON 文字（也接受只有 values 內容的物件：{ movement, camera, weapons }）。 */
export function parsePresetJson(text: string, fallbackName = '匯入的組合'): ParsedPreset {
  const errors: string[] = [];
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    return { ok: false, preset: null, errors: [`不是有效的 JSON（${err instanceof Error ? err.message : String(err)}）`] };
  }
  if (!isPlainObject(raw)) return { ok: false, preset: null, errors: ['JSON 必須是物件'] };
  let name = fallbackName;
  let values: unknown;
  let savedAt: string | undefined;
  if ('format' in raw) {
    if (raw.format !== PRESET_FORMAT) return { ok: false, preset: null, errors: [`格式「${String(raw.format)}」不是調參預設組合`] };
    const v = raw.version;
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) errors.push('version 必須是正整數');
    else if (v > PRESET_FORMAT_VERSION) errors.push(`version ${v} 比這個版本支援的 ${PRESET_FORMAT_VERSION} 新，請更新遊戲`);
    name = sanitizePresetName(raw.name) || fallbackName;
    values = raw.values;
    if (typeof raw.savedAt === 'string') savedAt = raw.savedAt;
  } else {
    values = raw;
  }
  if (errors.length > 0) return { ok: false, preset: null, errors };
  if (!validateTuningShape(values, errors)) return { ok: false, preset: null, errors };
  return { ok: true, preset: { name, values, ...(savedAt ? { savedAt } : {}) }, errors };
}

export interface PresetSaveResult {
  /** 操作完成（至少在記憶體中）。 */
  ok: boolean;
  /** 已存進 localStorage（false：只在記憶體，重新整理後消失）。 */
  persistent: boolean;
  error?: string;
}

interface StoredPresets {
  version: number;
  presets: unknown[];
  [extra: string]: unknown;
}

/** 玩家的具名組合（不含內建）。 */
export class PresetStore {
  private user: Preset[] = [];
  private extra: Record<string, unknown> = {};

  constructor(private readonly storage: GameStorage | null) {
    this.load();
  }

  /** 內建＋玩家的全部組合（內建在前）。 */
  get all(): readonly Preset[] {
    return [...BUILTIN_PRESETS, ...this.user];
  }

  get userPresets(): readonly Preset[] {
    return this.user;
  }

  get(name: string): Preset | undefined {
    return this.all.find((p) => p.name === name);
  }

  /** 從儲存重新讀取（壞掉的項目略過）。 */
  load(): void {
    const raw = this.storage?.getJSON<StoredPresets>(PRESETS_KEY) ?? null;
    this.user = [];
    this.extra = {};
    if (!raw || !isPlainObject(raw) || !Array.isArray(raw.presets)) return;
    for (const [k, v] of Object.entries(raw)) if (k !== 'version' && k !== 'presets') this.extra[k] = v;
    for (const item of raw.presets) {
      if (!isPlainObject(item)) continue;
      const name = sanitizePresetName(item.name);
      const errors: string[] = [];
      if (!name || BUILTIN_PRESETS.some((b) => b.name === name) || !validateTuningShape(item.values, errors)) continue;
      if (this.user.some((p) => p.name === name)) continue;
      this.user.push({ name, values: item.values, ...(typeof item.savedAt === 'string' ? { savedAt: item.savedAt } : {}) });
    }
  }

  /** 存成具名組合（同名覆寫；內建名稱不可用）。 */
  save(name: string, values: TuningValues): PresetSaveResult {
    const n = sanitizePresetName(name);
    if (!n) return { ok: false, persistent: false, error: '名稱不可空白' };
    if (BUILTIN_PRESETS.some((b) => b.name === n)) return { ok: false, persistent: false, error: `「${n}」是內建組合，請換一個名稱` };
    const preset: Preset = { name: n, savedAt: new Date().toISOString(), values: JSON.parse(JSON.stringify(values)) as TuningValues };
    const i = this.user.findIndex((p) => p.name === n);
    if (i >= 0) this.user[i] = preset;
    else this.user.push(preset);
    return this.persist();
  }

  /** 刪除（內建不可刪）。 */
  remove(name: string): PresetSaveResult {
    const i = this.user.findIndex((p) => p.name === name);
    if (i < 0) return { ok: false, persistent: false, error: BUILTIN_PRESETS.some((b) => b.name === name) ? '內建組合不能刪除' : '找不到這個組合' };
    this.user.splice(i, 1);
    return this.persist();
  }

  private persist(): PresetSaveResult {
    if (!this.storage) return { ok: true, persistent: false };
    const data: StoredPresets = {
      ...this.extra,
      version: PRESETS_VERSION,
      presets: this.user.map((p) => ({ name: p.name, savedAt: p.savedAt, values: p.values })),
    };
    const r = this.storage.trySetString(PRESETS_KEY, JSON.stringify(data));
    // 寫入失敗（例如容量不足）：組合仍在記憶體中可用，回傳原因讓介面提示。
    return r.ok ? { ok: true, persistent: r.persistent } : { ok: true, persistent: false, error: r.error ?? '寫入失敗' };
  }
}
