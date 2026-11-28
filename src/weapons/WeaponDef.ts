// 武器資料（M1-10）：WeaponDef 型別、驗證、複製。M2-01 的刷寶生成器只要產生合法的 WeaponDef 就能用。
//
// 單位：時間為秒、角度為度、距離為公尺、速度為 m/s。所有手感與平衡數值都在這裡（與 archetypes.ts 的資料表），
// 武器邏輯不寫死數值；調參面板「武器」直接改寫目前手持武器的 WeaponDef，下一步就生效。
//
// 欄位慣例：
// - fire.rpm：每分鐘發數（連發為「每輪連發」的節奏，輪內節奏是 burstRpm）。pellets：每發的彈丸數。
// - spread：錐形散布的半角（度，彈著點偏離視線的最大角度）。實際散布 = min(max, 基礎 + 累積擴散)，
//   基礎 = lerp(hip, ads, 開鏡進度) × 移動倍率 × 空中倍率；每發累積 perShot，停火 recoveryDelay 秒後以 recoveryPerSec（度/秒）回復。
//   pelletPattern：彈丸的固定偏移（度，[右, 上]），整體散布的隨機偏移套在整個圖案上。
// - recoil：每發的 pitch／yaw 增量（度，[最小, 最大] 隨機；yaw 正值往右），yawBias 每發固定加上；
//   firstShotMult：停火超過 recoveryDelay 後第一發的倍率；累積後座（pitch）不超過 maxClimb；
//   停火 recoveryDelay 秒後以 recoveryPerSec（度/秒）回正，只回正後座造成且玩家沒有自己壓回的部分。
// - damage.penetration：hitscan 可以「穿過」的目標數（0 = 只打第一個；2 = 最多命中 3 個）；不穿牆。
// - ammo.reloadAmmoPoint：換彈進度到這個比例時彈匣補滿；之前取消不補彈，之後取消已補彈。
//   reloadPerShell 有值時為逐發裝填：reloadTactical／reloadEmpty 是開始裝第一發前的準備時間，
//   每發 reloadPerShell 秒、在每發的 reloadAmmoPoint 比例時入膛。
// - handling.adsZoom：開鏡放大倍率（tan(FOV/2) 除以此值；1 = 不縮放）。
import { RAD2DEG } from '@/core/math';

export type FireMode = 'auto' | 'semi' | 'burst' | 'pump';
export const FIRE_MODES: readonly FireMode[] = ['auto', 'semi', 'burst', 'pump'];

/** 武器原型（M1 的 5 種；M2-01 擴充到 9 種）。 */
export type WeaponArchetype = 'assaultRifle' | 'shotgun' | 'handCannon' | 'railSniper' | 'plasmaLauncher' | (string & {});

export interface FireDef {
  mode: FireMode;
  rpm: number;
  /** 連發：每輪發數（mode = 'burst' 時必填，≥ 2）。 */
  burstCount?: number;
  /** 連發：輪內節奏（mode = 'burst' 時必填）。 */
  burstRpm?: number;
  /** 每發彈丸數（霰彈 > 1）。 */
  pellets: number;
  /** 扳機緩衝（s）：略早按下，等到可以射擊時仍會發射（半自動、泵動、連發；全自動的單點也適用）。 */
  triggerBuffer: number;
}

export interface DamageDef {
  /** 每顆彈丸（或投射物直擊）的基礎傷害。 */
  base: number;
  /** 弱點倍率。 */
  critMult: number;
  /** 距離衰減：falloffStart 以內全額，falloffEnd 以外 minMult，中間線性。 */
  falloffStart: number;
  falloffEnd: number;
  minMult: number;
  /** hitscan 可穿過的目標數（不穿牆）；0 = 不穿透。 */
  penetration: number;
}

export interface ProjectileDef {
  /** 初速（m/s）。 */
  speed: number;
  /** 重力加速度（m/s²，向下為正；0 = 直線）。 */
  gravity: number;
  /** 碰撞半徑（m；0 = 線段 raycast）。 */
  radius: number;
  /** 最長存在時間（s），逾時消失不爆炸。 */
  lifetime: number;
  /** 範圍半徑（m）與中心傷害；0 = 沒有範圍傷害。 */
  splashRadius: number;
  splashDamage: number;
  /** 範圍邊緣的傷害／擊退倍率（中心 1，線性衰減到此值）。 */
  splashMinMult: number;
  /** 自身擊退：範圍中心的速度變化量（m/s），依距離衰減；可以火箭跳。 */
  selfKnockback: number;
  /** 自身受到的範圍傷害倍率（原型為 0）。 */
  selfDamageMult: number;
}

/** 彈匣式彈藥（M2-01 會加入 type: 'heat'）。 */
export interface MagAmmoDef {
  type: 'mag';
  mag: number;
  reloadTactical: number;
  reloadEmpty: number;
  /** 逐發裝填：每發時間（s）。 */
  reloadPerShell?: number;
  reloadAmmoPoint: number;
  /** 備彈：'infinite' 或發數（M2-03 的三種備彈接上前，原型都是無限）。 */
  reserve: 'infinite' | number;
}

export type AmmoDef = MagAmmoDef;

export interface SpreadDef {
  hip: number;
  ads: number;
  perShot: number;
  max: number;
  recoveryPerSec: number;
  /** 停火後多久才開始回復擴散（s）；連續射擊時擴散才會累積。 */
  recoveryDelay: number;
  /** 移動時的基礎散布倍率（速度達 WeaponSystemConfig.spreadMoveRefSpeed 時為滿值）。 */
  moveMult: number;
  /** 空中的基礎散布倍率（跑牆不算空中）。 */
  airMult: number;
  /** 彈丸固定偏移（度，[右, 上]）；長度須等於 pellets。 */
  pelletPattern?: [number, number][];
}

export interface RecoilDef {
  pitchPerShot: [number, number];
  yawPerShot: [number, number];
  yawBias: number;
  firstShotMult: number;
  recoveryPerSec: number;
  recoveryDelay: number;
  adsMult: number;
  maxClimb: number;
}

export interface HandlingDef {
  swapIn: number;
  swapOut: number;
  adsTime: number;
  adsZoom: number;
  /** 衝刺中按開火：先在這段時間內退出衝刺才射擊（s）。 */
  sprintToFire: number;
  /** 開鏡時的地面移動速度倍率（依開鏡進度內插）。 */
  adsMoveSpeedMult: number;
}

/** 手感（給 M1-11 的 viewmodel 與鏡頭）。 */
export interface FeelDef {
  /** 每發加到 CameraRig 的 trauma（0..1）。 */
  trauma: number;
  /** viewmodel 每發的後座衝量：pos（m，[右, 上, 後]）、rot（度，[pitch 上, yaw 右, roll]）。 */
  viewKick: { pos: [number, number, number]; rot: [number, number, number] };
  /** viewmodel 回彈彈簧。 */
  kickSpring: { frequency: number; dampingRatio: number };
  /** 每發的 FOV 衝擊（水平度；0 = 無）。 */
  fovKick: number;
}

/** 音效（給 M1-13 的合成器）：配方 id 與參數。 */
export interface AudioDef {
  fire: string;
  reload: string;
  params: Record<string, number>;
}

/** 槍模部件描述（給 M1-11 的 WeaponModelFactory）。 */
export interface WeaponModelDef {
  frame: 'rifle' | 'shotgun' | 'pistol' | 'sniper' | 'launcher' | (string & {});
  /** 機匣長、高（m，viewmodel 尺度）。 */
  bodyLength: number;
  bodyHeight: number;
  barrelLength: number;
  barrelRadius: number;
  magazine: 'box' | 'tube' | 'cell' | 'none';
  optic: 'none' | 'reflex' | 'scope';
  stock: boolean;
  colors: { body: string; accent: string; glow: string };
  /** 槍口位置（viewmodel 座標，m，[右, 上, 前為負]）：曳光與槍口閃光起點。槍管沿 -Z 由機匣前端延伸到這裡。 */
  muzzle: [number, number, number];
  /**
   * 開鏡對位的微調（m，[右, 上, 前]；M1-11）：開鏡時把瞄具中心對到畫面中心後再加上這個偏移
   * （正的「前」= 槍離眼睛更遠）。省略時為 [0, 0, 0]。
   */
  adsOffset?: [number, number, number];
  /** 廠商（M2-01：每家廠商一套部件風格；WeaponModelFactory 依此選擇風格，未知或省略時用預設風格）。 */
  manufacturer?: string;
}

/** perk 參照（M2-02 填入實作；hook 介面見 perks.ts）。 */
export interface WeaponPerkRef {
  id: string;
  params?: Record<string, number>;
}

export interface WeaponDef {
  id: string;
  name: string;
  archetype: WeaponArchetype;
  fire: FireDef;
  damage: DamageDef;
  projectile?: ProjectileDef;
  ammo: AmmoDef;
  spread: SpreadDef;
  recoil: RecoilDef;
  handling: HandlingDef;
  feel: FeelDef;
  audio: AudioDef;
  model: WeaponModelDef;
  perks: WeaponPerkRef[];
}

/** 深複製（JSON 相容資料）。 */
export function cloneWeaponDef(def: Readonly<WeaponDef>): WeaponDef {
  return JSON.parse(JSON.stringify(def)) as WeaponDef;
}

/** 單發間隔（s）。 */
export function shotInterval(def: Readonly<WeaponDef>): number {
  return 60 / def.fire.rpm;
}

/** 開鏡後的 FOV（度；輸入與輸出同一軸，水平或垂直皆可）：2·atan(tan(fov/2) / zoom)。 */
export function zoomedFov(fovDeg: number, zoom: number): number {
  const z = zoom > 0 ? zoom : 1;
  return 2 * Math.atan(Math.tan((fovDeg * Math.PI) / 360) / z) * RAD2DEG;
}

/** 開鏡靈敏度的焦距換算：tan(adsFov / 2) / tan(hipFov / 2)。 */
export function adsSensitivityRatio(hipFovDeg: number, adsFovDeg: number): number {
  const hip = Math.tan((hipFovDeg * Math.PI) / 360);
  return hip > 0 ? Math.tan((adsFovDeg * Math.PI) / 360) / hip : 1;
}

// ── 驗證 ─────────────────────────────────────────────────

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

type Check = (path: string, value: unknown) => string | null;

const num =
  (min: number, max = Infinity, opts: { minExclusive?: boolean; integer?: boolean } = {}): Check =>
  (path, v) => {
    if (typeof v !== 'number' || !Number.isFinite(v)) return `${path} 必須是有限數字`;
    if (opts.integer && !Number.isInteger(v)) return `${path} 必須是整數`;
    if (opts.minExclusive ? v <= min : v < min) return `${path} 必須${opts.minExclusive ? '大於' : '≥'} ${min}`;
    if (v > max) return `${path} 必須 ≤ ${max}`;
    return null;
  };

const str: Check = (path, v) => (typeof v === 'string' && v.length > 0 ? null : `${path} 必須是非空字串`);

function get(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const k of path.split('.')) {
    if (typeof cur !== 'object' || cur === null) return undefined;
    cur = (cur as Record<string, unknown>)[k];
  }
  return cur;
}

const RULES: readonly [string, Check][] = [
  ['id', str],
  ['name', str],
  ['archetype', str],
  ['fire.rpm', num(0, 6000, { minExclusive: true })],
  ['fire.pellets', num(1, 64, { integer: true })],
  ['fire.triggerBuffer', num(0, 1)],
  ['damage.base', num(0)],
  ['damage.critMult', num(0)],
  ['damage.falloffStart', num(0)],
  ['damage.falloffEnd', num(0)],
  ['damage.minMult', num(0, 1)],
  ['damage.penetration', num(0, 16, { integer: true })],
  ['ammo.mag', num(1, 1000, { integer: true })],
  ['ammo.reloadTactical', num(0, 30)],
  ['ammo.reloadEmpty', num(0, 30)],
  ['ammo.reloadAmmoPoint', num(0, 1)],
  ['spread.hip', num(0, 45)],
  ['spread.ads', num(0, 45)],
  ['spread.perShot', num(0, 45)],
  ['spread.max', num(0, 45)],
  ['spread.recoveryPerSec', num(0)],
  ['spread.recoveryDelay', num(0, 10)],
  ['spread.moveMult', num(0, 10)],
  ['spread.airMult', num(0, 10)],
  ['recoil.yawBias', num(-45, 45)],
  ['recoil.firstShotMult', num(0, 10)],
  ['recoil.recoveryPerSec', num(0)],
  ['recoil.recoveryDelay', num(0, 10)],
  ['recoil.adsMult', num(0, 10)],
  ['recoil.maxClimb', num(0, 89)],
  ['handling.swapIn', num(0, 10)],
  ['handling.swapOut', num(0, 10)],
  ['handling.adsTime', num(0, 10)],
  ['handling.adsZoom', num(1, 20)],
  ['handling.sprintToFire', num(0, 10)],
  ['handling.adsMoveSpeedMult', num(0, 2)],
  ['feel.trauma', num(0, 1)],
  ['feel.kickSpring.frequency', num(0, 100, { minExclusive: true })],
  ['feel.kickSpring.dampingRatio', num(0, 10)],
  ['feel.fovKick', num(-30, 30)],
  ['audio.fire', str],
  ['audio.reload', str],
  ['model.frame', str],
  ['model.bodyLength', num(0, 5)],
  ['model.bodyHeight', num(0, 5)],
  ['model.barrelLength', num(0, 5)],
  ['model.barrelRadius', num(0, 1)],
];

const PROJECTILE_RULES: readonly [string, Check][] = [
  ['projectile.speed', num(0, 2000, { minExclusive: true })],
  ['projectile.gravity', num(-100, 100)],
  ['projectile.radius', num(0, 5)],
  ['projectile.lifetime', num(0, 60, { minExclusive: true })],
  ['projectile.splashRadius', num(0, 50)],
  ['projectile.splashDamage', num(0)],
  ['projectile.splashMinMult', num(0, 1)],
  ['projectile.selfKnockback', num(0, 200)],
  ['projectile.selfDamageMult', num(0, 10)],
];

function checkPair(def: unknown, path: string, errors: string[], min: number, max: number): void {
  const v = get(def, path);
  if (!Array.isArray(v) || v.length !== 2 || !v.every((x) => typeof x === 'number' && Number.isFinite(x))) {
    errors.push(`${path} 必須是兩個有限數字 [最小, 最大]`);
    return;
  }
  const [a, b] = v as [number, number];
  if (a > b) errors.push(`${path} 的最小值不可大於最大值`);
  if (a < min || b > max) errors.push(`${path} 必須在 ${min}–${max} 之間`);
}

function checkTriple(def: unknown, path: string, errors: string[]): void {
  const v = get(def, path);
  if (!Array.isArray(v) || v.length !== 3 || !v.every((x) => typeof x === 'number' && Number.isFinite(x))) {
    errors.push(`${path} 必須是三個有限數字`);
  }
}

/** 驗證 WeaponDef（任意輸入，不丟例外）。回傳所有錯誤。 */
export function validateWeaponDef(def: unknown): ValidationResult {
  const errors: string[] = [];
  if (typeof def !== 'object' || def === null) return { ok: false, errors: ['WeaponDef 必須是物件'] };
  for (const [path, check] of RULES) {
    const e = check(path, get(def, path));
    if (e) errors.push(e);
  }
  const d = def as Partial<WeaponDef>;
  const mode = get(def, 'fire.mode');
  if (!FIRE_MODES.includes(mode as FireMode)) errors.push(`fire.mode 必須是 ${FIRE_MODES.join('／')}`);
  if (mode === 'burst') {
    const e1 = num(2, 100, { integer: true })('fire.burstCount', get(def, 'fire.burstCount'));
    const e2 = num(0, 6000, { minExclusive: true })('fire.burstRpm', get(def, 'fire.burstRpm'));
    if (e1) errors.push(e1);
    if (e2) errors.push(e2);
  }
  if (get(def, 'ammo.type') !== 'mag') errors.push("ammo.type 必須是 'mag'（M2-01 加入 'heat'）");
  const reserve = get(def, 'ammo.reserve');
  if (reserve !== 'infinite') {
    const e = num(0, 1e6, { integer: true })('ammo.reserve', reserve);
    if (e) errors.push(`${e}（或 'infinite'）`);
  }
  const perShell = get(def, 'ammo.reloadPerShell');
  if (perShell !== undefined) {
    const e = num(0, 10, { minExclusive: true })('ammo.reloadPerShell', perShell);
    if (e) errors.push(e);
  }
  const df = d.damage;
  if (df && typeof df.falloffStart === 'number' && typeof df.falloffEnd === 'number' && df.falloffEnd < df.falloffStart) {
    errors.push('damage.falloffEnd 不可小於 falloffStart');
  }
  const sp = d.spread;
  if (sp && typeof sp.max === 'number' && typeof sp.hip === 'number' && sp.max < Math.min(sp.hip, sp.ads ?? sp.hip)) {
    errors.push('spread.max 不可小於基礎散布');
  }
  const pattern = get(def, 'spread.pelletPattern');
  if (pattern !== undefined) {
    const pellets = get(def, 'fire.pellets');
    if (!Array.isArray(pattern) || pattern.length !== pellets) errors.push('spread.pelletPattern 長度必須等於 fire.pellets');
    else if (
      !pattern.every((p) => Array.isArray(p) && p.length === 2 && p.every((x) => typeof x === 'number' && Number.isFinite(x)))
    ) {
      errors.push('spread.pelletPattern 每項必須是 [右, 上] 兩個有限數字（度）');
    }
  }
  checkPair(def, 'recoil.pitchPerShot', errors, -45, 45);
  checkPair(def, 'recoil.yawPerShot', errors, -45, 45);
  checkTriple(def, 'feel.viewKick.pos', errors);
  checkTriple(def, 'feel.viewKick.rot', errors);
  if (typeof get(def, 'audio.params') !== 'object' || get(def, 'audio.params') === null) errors.push('audio.params 必須是物件');
  checkTriple(def, 'model.muzzle', errors);
  if (get(def, 'model.adsOffset') !== undefined) checkTriple(def, 'model.adsOffset', errors);
  const maker = get(def, 'model.manufacturer');
  if (maker !== undefined && typeof maker !== 'string') errors.push('model.manufacturer 必須是字串');
  for (const c of ['body', 'accent', 'glow']) {
    const v = get(def, `model.colors.${c}`);
    if (typeof v !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(v)) errors.push(`model.colors.${c} 必須是 #rrggbb`);
  }
  if (d.projectile !== undefined) {
    for (const [path, check] of PROJECTILE_RULES) {
      const e = check(path, get(def, path));
      if (e) errors.push(e);
    }
  }
  if (!Array.isArray(d.perks)) errors.push('perks 必須是陣列');
  else if (!d.perks.every((p) => typeof p === 'object' && p !== null && typeof p.id === 'string' && p.id.length > 0)) {
    errors.push('perks 每項必須有 id');
  }
  return { ok: errors.length === 0, errors };
}

/** 驗證失敗時丟出例外（程式內建資料表用）。 */
export function assertWeaponDef(def: unknown): asserts def is WeaponDef {
  const r = validateWeaponDef(def);
  if (!r.ok) {
    const id = typeof def === 'object' && def !== null ? String((def as { id?: unknown }).id) : '?';
    throw new Error(`WeaponDef「${id}」不合法：${r.errors.join('；')}`);
  }
}
