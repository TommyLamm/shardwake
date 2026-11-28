// 設定頁的頁籤與項目（M1-14，資料 + 純函式）：每個項目對應 SETTINGS_SCHEMA 的一個欄位，控制項種類與顯示格式在這裡決定。
// 設定的驗證（範圍、選項）一律由 SettingsStore.update → sanitizeSetting 處理；這裡只負責顯示與輸入文字的解析。
// 新增設定：在 SETTINGS_SCHEMA 加欄位、zh-TW 加 setting.<key>／settingHint.<key>，再放進某個頁籤（或 HIDDEN_SETTINGS）。
import { SETTINGS_SCHEMA, type SettingSpec, type SettingsKey } from '@/core/Settings';
import { tDynamic } from '@/i18n';
import type { StringKey } from '@/i18n/zh-TW';

export type ValueFormat = 'percent' | 'degrees' | 'multiplier' | 'decimal2' | 'integer';
export type ControlKind = 'slider' | 'number' | 'toggle' | 'choice' | 'select';

export interface SettingItem {
  key: SettingsKey;
  /** 數字的顯示格式（預設依 step 推斷）。 */
  format?: ValueFormat;
  /** 控制項（預設：數字 → slider、布林 → toggle、選項 ≤ 4 → choice、其他 → select）。 */
  control?: ControlKind;
  /** 額外顯示：靈敏度旁的 cm/360。 */
  extra?: 'cm360';
}

export interface SettingsPage {
  id: string;
  labelKey: StringKey;
  items: readonly SettingItem[];
}

export const SETTINGS_PAGES: readonly SettingsPage[] = [
  {
    id: 'controls',
    labelKey: 'settings.tab.controls',
    items: [
      { key: 'sensitivity', format: 'decimal2', extra: 'cm360' },
      { key: 'mouseDpi', format: 'integer', control: 'number' },
      { key: 'adsSensitivity', format: 'multiplier' },
      { key: 'invertY' },
      { key: 'autoSprint' },
      { key: 'crouchMode' },
      { key: 'adsMode' },
      { key: 'grappleMode' },
    ],
  },
  {
    id: 'display',
    labelKey: 'settings.tab.display',
    items: [
      { key: 'fovHorizontal', format: 'degrees' },
      { key: 'quality' },
      { key: 'renderScale', control: 'select' },
      { key: 'shadows' },
      { key: 'bloom' },
      { key: 'showFps' },
    ],
  },
  {
    id: 'camera',
    labelKey: 'settings.tab.camera',
    items: [
      { key: 'screenShake', format: 'percent' },
      { key: 'cameraTilt', format: 'percent' },
      { key: 'headBob' },
      { key: 'dynamicFov' },
      { key: 'speedLines' },
      { key: 'landingDip' },
      { key: 'chromaticAberration' },
    ],
  },
  {
    id: 'gameplay',
    labelKey: 'settings.tab.gameplay',
    items: [{ key: 'hitMarkers' }, { key: 'damageNumbers' }, { key: 'damageNumberMerge' }, { key: 'trainingDrones' }],
  },
  {
    id: 'audio',
    labelKey: 'settings.tab.audio',
    items: [
      { key: 'masterVolume', format: 'percent' },
      { key: 'sfxVolume', format: 'percent' },
      { key: 'uiVolume', format: 'percent' },
    ],
  },
];

/** 不在設定頁顯示的欄位（音樂音量等 M5-06 加入音樂後再顯示）。 */
export const HIDDEN_SETTINGS: readonly SettingsKey[] = ['musicVolume'];

export function pageKeys(page: SettingsPage): SettingsKey[] {
  return page.items.map((i) => i.key);
}

export function findPage(id: string): SettingsPage | undefined {
  return SETTINGS_PAGES.find((p) => p.id === id);
}

export function specOf(key: SettingsKey): SettingSpec {
  return SETTINGS_SCHEMA[key];
}

export function controlKind(item: SettingItem): ControlKind {
  if (item.control) return item.control;
  const spec = specOf(item.key);
  if (spec.type === 'number') return 'slider';
  if (spec.type === 'boolean') return 'toggle';
  return spec.options.length <= 4 ? 'choice' : 'select';
}

function decimalsOf(step: number): number {
  if (!(step > 0) || step >= 1) return 0;
  return Math.min(6, Math.max(0, Math.ceil(-Math.log10(step) - 1e-9)));
}

export function defaultFormat(spec: Extract<SettingSpec, { type: 'number' }>): ValueFormat {
  return spec.step >= 1 ? 'integer' : 'decimal2';
}

/** 數字設定的顯示文字。 */
export function formatSettingValue(key: SettingsKey, value: number, format?: ValueFormat): string {
  const spec = specOf(key);
  if (spec.type !== 'number') return String(value);
  const f = format ?? defaultFormat(spec);
  if (!Number.isFinite(value)) return '—';
  switch (f) {
    case 'percent':
      return `${Math.round(value * 100)}%`;
    case 'degrees':
      return `${Math.round(value)}°`;
    case 'multiplier':
      return `×${value.toFixed(2)}`;
    case 'integer':
      return String(Math.round(value));
    case 'decimal2':
      return value.toFixed(Math.max(2, decimalsOf(spec.step)));
  }
}

/** 數字輸入框顯示的值（不含單位）。 */
export function inputText(key: SettingsKey, value: number, format?: ValueFormat): string {
  const spec = specOf(key);
  if (spec.type !== 'number' || !Number.isFinite(value)) return '';
  const f = format ?? defaultFormat(spec);
  if (f === 'percent') return String(Math.round(value * 100));
  if (f === 'degrees' || f === 'integer') return String(Math.round(value));
  return value.toFixed(Math.max(2, decimalsOf(spec.step)));
}

/**
 * 解析玩家在輸入框打的文字（允許單位：80%、103°、×1.2、全形數字與逗號小數點）；不合法回傳 undefined。
 * 結果會對齊 step 並夾在範圍內。
 */
export function parseSettingInput(key: SettingsKey, text: string, format?: ValueFormat): number | undefined {
  const spec = specOf(key);
  if (spec.type !== 'number') return undefined;
  const f = format ?? defaultFormat(spec);
  const normalized = text
    .trim()
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[．。]/g, '.')
    .replace(/,/g, '.')
    .replace(/[%％°×xX\s]/g, '');
  if (!/^-?\d*\.?\d+$|^-?\d+\.$/.test(normalized)) return undefined;
  let v = Number(normalized);
  if (!Number.isFinite(v)) return undefined;
  if (f === 'percent') v /= 100;
  return snapToStep(key, v);
}

/** 對齊 step（以 min 為基準）並夾在範圍內；非數字設定原樣回傳。 */
export function snapToStep(key: SettingsKey, value: number): number {
  const spec = specOf(key);
  if (spec.type !== 'number' || !Number.isFinite(value)) return value;
  const clamped = Math.min(spec.max, Math.max(spec.min, value));
  if (!(spec.step > 0)) return clamped;
  const n = Math.round((clamped - spec.min) / spec.step);
  const snapped = spec.min + n * spec.step;
  const d = decimalsOf(spec.step);
  return Math.min(spec.max, Math.max(spec.min, Number(snapped.toFixed(Math.max(d, 2) + 2))));
}

/** 列舉選項的顯示文字：字串表的 option.<value>（沒有時用 SETTINGS_SCHEMA 的 optionLabels，例如渲染比例的「67%」）。 */
export function optionLabel(key: SettingsKey, value: string): string {
  const spec = specOf(key);
  if (spec.type !== 'enum') return value;
  const i = spec.options.indexOf(value);
  const fallback = (spec.optionLabels && i >= 0 ? spec.optionLabels[i] : undefined) ?? value;
  return tDynamic(`option.${value}`, fallback);
}
