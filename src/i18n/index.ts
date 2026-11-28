// i18n（M1-14）：t(key, params) 取得目前語系的字串並代入 {參數}。
// 目前只有繁體中文（zh-TW.ts）；之後加語系：registerLocale('en', { ...部分字串 }) 後 setLocale('en')，缺少的 key 回退繁中。
// 介面在建立時取字串；切換語系後需要重建介面（選單在下次開啟時重建，HUD 文字在值改變時重寫）。
import { ZH_TW, type StringKey, type StringTable } from '@/i18n/zh-TW';

export { ZH_TW };
export type { StringKey, StringTable };

export type Locale = string;
export type TranslateParams = Readonly<Record<string, string | number>>;

const FALLBACK: Locale = 'zh-TW';
const locales = new Map<Locale, Partial<StringTable>>([[FALLBACK, ZH_TW]]);
let current: Locale = FALLBACK;
let table: Partial<StringTable> = ZH_TW;

/** 代入 {name} 參數；沒有提供的參數保留原樣（方便發現漏掉的參數）。 */
export function formatString(template: string, params?: TranslateParams): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (m, name: string) => {
    const v = params[name];
    return v === undefined ? m : String(v);
  });
}

/** 取得字串。未知的 key 回傳 key 本身（不丟例外）。 */
export function t(key: StringKey, params?: TranslateParams): string {
  const s = table[key] ?? ZH_TW[key] ?? key;
  return formatString(s, params);
}

/** 動態組出的 key（例如 `setting.${key}`）：不存在時回傳 fallback（預設為 key）。 */
export function tDynamic(key: string, fallback?: string, params?: TranslateParams): string {
  return hasKey(key) ? t(key, params) : (fallback ?? key);
}

export function hasKey(key: string): key is StringKey {
  return Object.hasOwn(ZH_TW, key);
}

/** 註冊語系（部分字串即可）。 */
export function registerLocale(locale: Locale, strings: Partial<StringTable>): void {
  locales.set(locale, locale === FALLBACK ? { ...ZH_TW, ...strings } : strings);
  if (locale === current) table = locales.get(locale)!;
}

/** 切換語系；未註冊的語系回傳 false。 */
export function setLocale(locale: Locale): boolean {
  const next = locales.get(locale);
  if (!next) return false;
  current = locale;
  table = next;
  return true;
}

export function getLocale(): Locale {
  return current;
}

export function availableLocales(): Locale[] {
  return [...locales.keys()];
}
