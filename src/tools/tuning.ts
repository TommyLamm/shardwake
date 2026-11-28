// 調參數值的擷取、套用、比較與指紋（M1-15；純邏輯，可無頭測試）。
//
// TuningValues：移動參數（MovementConfig）、鏡頭參數（CameraConfig）與各武器的 WeaponDef。
// - 預設組合與錄影只存「與預設值不同」的欄位（diffTuning），套用時從預設值開始再疊上這些欄位（applyTuning），
//   所以「標準」是空集合、載入任何預設組合後再載入「標準」會完全還原。
// - 不認識的欄位、型別不符或不合法的值（非有限數字、武器驗證失敗）會略過並列在 warnings，不會套用半套的武器。
// - tuningFingerprint 是完整數值的雜湊：M5-05 排行榜用它判斷成績是不是在標準參數下跑出來的。
import { CAMERA_CONFIG, defaultCameraConfig, type CameraConfig } from '@/camera/CameraConfig';
import { defaultMovementConfig, MOVEMENT_CONFIG, type MovementConfig } from '@/player/MovementConfig';
import { ARCHETYPES, createArchetype } from '@/weapons/archetypes';
import { cloneWeaponDef, validateWeaponDef, type WeaponDef } from '@/weapons/WeaponDef';

type Scalar = number | boolean | string;
export type FlatValues = Record<string, Scalar>;

export interface TuningValues {
  /** MovementConfig 的欄位（只列與預設不同者，或完整值）。 */
  movement?: FlatValues;
  /** CameraConfig 的欄位。 */
  camera?: FlatValues;
  /** 武器 id → WeaponDef 的部分欄位（巢狀，與 WeaponDef 同結構）。 */
  weapons?: Record<string, unknown>;
}

/** 套用的對象：遊戲中為 MOVEMENT_CONFIG、CAMERA_CONFIG 與 WeaponManager 的欄位。 */
export interface TuningTargets {
  movement: MovementConfig;
  camera: CameraConfig;
  /** 目前裝備的武器定義（依欄位順序）。 */
  getWeaponDefs(): readonly WeaponDef[];
  /** 換成新的定義（Weapon.def setter；會重新解析 perk、夾住彈藥）。 */
  setWeaponDef(id: string, def: WeaponDef): void;
}

export interface ApplyReport {
  /** 實際寫入（與套用前不同）的欄位數。 */
  changed: number;
  warnings: string[];
}

/** 遊戲預設的目標（模組層級的設定物件；武器由呼叫端提供）。 */
export function gameTuningTargets(weapons: Pick<TuningTargets, 'getWeaponDefs' | 'setWeaponDef'>): TuningTargets {
  return { movement: MOVEMENT_CONFIG, camera: CAMERA_CONFIG, ...weapons };
}

function isPlainObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

function isScalar(x: unknown): x is Scalar {
  return (typeof x === 'number' && Number.isFinite(x)) || typeof x === 'boolean' || typeof x === 'string';
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** 預設武器（原型）定義的複本。 */
export function defaultWeaponDef(id: string): WeaponDef | null {
  return createArchetype(id);
}

/** 完整數值（不是差異）：預設組合「匯出完整」、指紋與測試使用。 */
export function captureTuning(t: TuningTargets): Required<TuningValues> {
  const weapons: Record<string, unknown> = {};
  for (const def of t.getWeaponDefs()) weapons[def.id] = cloneWeaponDef(def);
  return { movement: { ...(t.movement as unknown as FlatValues) }, camera: { ...(t.camera as unknown as FlatValues) }, weapons };
}

function diffFlat(cur: Readonly<FlatValues>, base: Readonly<FlatValues>): FlatValues | undefined {
  const out: FlatValues = {};
  let n = 0;
  for (const k of Object.keys(base)) {
    const v = cur[k];
    if (v !== undefined && v !== base[k]) {
      out[k] = v;
      n++;
    }
  }
  return n > 0 ? out : undefined;
}

/** 巢狀差異：只留與 base 不同的葉節點（陣列整個比較）。 */
function diffDeep(cur: unknown, base: unknown): unknown {
  if (isPlainObject(cur) && isPlainObject(base)) {
    const out: Record<string, unknown> = {};
    let n = 0;
    for (const k of Object.keys(cur)) {
      if (!(k in base)) {
        out[k] = JSON.parse(JSON.stringify(cur[k])) as unknown;
        n++;
        continue;
      }
      const d = diffDeep(cur[k], base[k]);
      if (d !== undefined) {
        out[k] = d;
        n++;
      }
    }
    return n > 0 ? out : undefined;
  }
  if (sameJson(cur, base)) return undefined;
  return JSON.parse(JSON.stringify(cur)) as unknown;
}

/** 與預設值的差異（預設組合與錄影存這個）。沒有差異時回傳 {}（= 標準）。 */
export function diffTuning(full: Readonly<TuningValues>): TuningValues {
  const out: TuningValues = {};
  const m = full.movement ? diffFlat(full.movement, defaultMovementConfig() as unknown as FlatValues) : undefined;
  if (m) out.movement = m;
  const c = full.camera ? diffFlat(full.camera, defaultCameraConfig() as unknown as FlatValues) : undefined;
  if (c) out.camera = c;
  if (full.weapons) {
    const w: Record<string, unknown> = {};
    for (const [id, def] of Object.entries(full.weapons)) {
      const base = defaultWeaponDef(id);
      const d = base ? diffDeep(def, base) : JSON.parse(JSON.stringify(def)) as unknown;
      if (d !== undefined) w[id] = d;
    }
    if (Object.keys(w).length > 0) out.weapons = w;
  }
  return out;
}

/** 目前數值與預設值的差異。 */
export function currentTuningDiff(t: TuningTargets): TuningValues {
  return diffTuning(captureTuning(t));
}

/** 是否為標準（沒有任何與預設不同的欄位）。 */
export function isStandardTuning(values: Readonly<TuningValues>): boolean {
  return !values.movement && !values.camera && !values.weapons;
}

/** 平面設定：預設值疊上 values 中型別相符的欄位。 */
function mergeFlat(target: FlatValues, base: Readonly<FlatValues>, values: unknown, label: string, warnings: string[]): number {
  let changed = 0;
  const v = isPlainObject(values) ? values : {};
  if (values !== undefined && !isPlainObject(values)) warnings.push(`${label}：不是物件，改用預設值`);
  for (const k of Object.keys(base)) {
    let next = base[k]!;
    if (k in v) {
      const x = v[k];
      if (isScalar(x) && typeof x === typeof base[k]) next = x;
      else warnings.push(`${label}.${k}：型別不符或不是有限數字（${JSON.stringify(x)}），改用預設值`);
    }
    if (target[k] !== next) {
      target[k] = next;
      changed++;
    }
  }
  for (const k of Object.keys(v)) if (!(k in base)) warnings.push(`${label}.${k}：未知欄位，已略過`);
  return changed;
}

/** 巢狀合併：base（深複製）疊上 values；型別不符的葉節點保留 base 並警告。 */
function mergeDeep(base: unknown, values: unknown, path: string, warnings: string[]): unknown {
  if (values === undefined) return base;
  if (isPlainObject(base)) {
    if (!isPlainObject(values)) {
      warnings.push(`${path}：應為物件，已略過`);
      return base;
    }
    const out: Record<string, unknown> = { ...base };
    for (const [k, v] of Object.entries(values)) {
      out[k] = k in base ? mergeDeep(base[k], v, `${path}.${k}`, warnings) : (JSON.parse(JSON.stringify(v)) as unknown);
    }
    return out;
  }
  if (Array.isArray(base)) {
    if (!Array.isArray(values)) {
      warnings.push(`${path}：應為陣列，已略過`);
      return base;
    }
    return JSON.parse(JSON.stringify(values)) as unknown;
  }
  if (isScalar(values) && typeof values === typeof base) return values;
  warnings.push(`${path}：型別不符或不是有限數字（${JSON.stringify(values)}），保留預設值`);
  return base;
}

/**
 * 套用：每個欄位先回到預設值，再疊上 values（values 可以是差異或完整值）。
 * 武器：從原型定義疊上 values 的欄位；驗證失敗的武器不套用（維持目前的定義）並列在 warnings。
 */
export function applyTuning(t: TuningTargets, values: Readonly<TuningValues>): ApplyReport {
  const warnings: string[] = [];
  let changed = 0;
  changed += mergeFlat(t.movement as unknown as FlatValues, defaultMovementConfig() as unknown as FlatValues, values.movement, 'movement', warnings);
  changed += mergeFlat(t.camera as unknown as FlatValues, defaultCameraConfig() as unknown as FlatValues, values.camera, 'camera', warnings);
  const wv = values.weapons;
  if (wv !== undefined && !isPlainObject(wv)) warnings.push('weapons：不是物件，改用預設值');
  const weaponValues = isPlainObject(wv) ? wv : {};
  const equipped = new Set<string>();
  for (const def of t.getWeaponDefs()) {
    equipped.add(def.id);
    const base = defaultWeaponDef(def.id);
    if (!base) {
      if (def.id in weaponValues) warnings.push(`weapons.${def.id}：不是原型武器，無法套用`);
      continue;
    }
    const merged = mergeDeep(base, weaponValues[def.id], `weapons.${def.id}`, warnings) as WeaponDef;
    const r = validateWeaponDef(merged);
    if (!r.ok) {
      warnings.push(`weapons.${def.id}：數值不合法（${r.errors.join('；')}），維持目前的定義`);
      continue;
    }
    if (!sameJson(merged, def)) {
      t.setWeaponDef(def.id, merged);
      changed++;
    }
  }
  for (const id of Object.keys(weaponValues)) {
    if (!equipped.has(id)) warnings.push(`weapons.${id}：目前沒有裝備這把武器，已略過`);
  }
  return { changed, warnings };
}

/** FNV-1a 32 位元雜湊（十六進位 8 碼）。 */
export function hashString(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** 物件鍵排序後的 JSON（相同內容得到相同字串）。 */
export function stableStringify(x: unknown): string {
  if (Array.isArray(x)) return `[${x.map(stableStringify).join(',')}]`;
  if (isPlainObject(x)) {
    return `{${Object.keys(x)
      .sort()
      .filter((k) => x[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${stableStringify(x[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(x) ?? 'null';
}

/** 調參指紋：差異集合的雜湊（標準 = 空集合的雜湊）。排行榜（M5-05）用來區分標準與自訂參數的成績。 */
export function tuningFingerprint(diff: Readonly<TuningValues>): string {
  return hashString(stableStringify(diff));
}

/** 標準參數的指紋。 */
export const STANDARD_FINGERPRINT = tuningFingerprint({});

/** 原型武器 id（預設組合驗證用）。 */
export const ARCHETYPE_IDS: readonly string[] = ARCHETYPES.map((d) => d.id);
