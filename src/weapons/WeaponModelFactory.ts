// 程序槍模（M1-11）：依 WeaponDef.model 組裝 viewmodel 用的槍模，全部是基本幾何，不使用外部素材。
//
// 座標（槍模本地，m）：x 右、y 上、-z 前。原點在握把附近（右手位置）；槍管沿 -Z 由機匣前端延伸到 model.muzzle。
//   muzzleZ = muzzle[2]；機匣前端 = muzzleZ + barrelLength；機匣後端 = 前端 + bodyLength；槍管軸線高度 = muzzle[1]。
// 部件：機匣、槍管（長度／粗細）、護木、彈匣（可拆，換彈動畫用）、瞄具（機瞄／紅點／狙擊鏡）、槍托、發光條、手套與前臂。
// - layoutWeaponModel() 是純函式（只產生部件清單與錨點，可無頭測試）；WeaponModelFactory 再把部件依「群組 × 材質」合併成網格：
//   靜態部件每種材質一個網格，彈匣（magazine）與泵動護木（pump）各自獨立，可以被動畫移動。
// - 材質共用：同顏色、同種類的材質只建立一次（WeaponModelFactory.materials）；發光條材質每把槍一份（之後依稀有度換色：setGlowColor）。
// - manufacturer（M2-01）：MODEL_STYLES 的部件風格（比例、握把角度、發光強度…）；未知廠商用 default。
// - 新材質要預熱：viewmodel 場景整個加入 registerWarmup（見 weapons/Viewmodel.ts）。
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { DEG2RAD } from '@/core/math';
import type { WeaponModelDef } from '@/weapons/WeaponDef';

export type ModelMaterialKey = 'body' | 'accent' | 'dark' | 'glow' | 'lens' | 'dot' | 'suit';
export type ModelPartGroup = 'static' | 'magazine' | 'pump';

/** 單一部件：box（size = 寬、高、長）或 cyl（size = 半徑、半徑、長；軸沿 Z）。rot 為度（YXZ 順序）。 */
export interface ModelPart {
  name: string;
  shape: 'box' | 'cyl';
  size: [number, number, number];
  pos: [number, number, number];
  rot?: [number, number, number];
  mat: ModelMaterialKey;
  group: ModelPartGroup;
}

/** 部件風格（每家廠商一套；M2-01 擴充）。 */
export interface ModelStyle {
  /** 機匣寬度 = 機匣高 × widthRatio。 */
  widthRatio: number;
  /** 握把前傾角（度）。 */
  gripAngle: number;
  /** 發光條強度（顏色 × 強度 > 1 才有 Bloom）。 */
  glowIntensity: number;
  /** 槍托長（m）。 */
  stockLength: number;
  /** 護木長佔槍管的比例。 */
  handguardRatio: number;
  /** 是否畫手套與前臂。 */
  arms: boolean;
  /** 材質：粗糙度與金屬度。 */
  bodyRoughness: number;
  bodyMetalness: number;
  accentRoughness: number;
  accentMetalness: number;
  /** 手套與前臂的底色。 */
  suitColor: string;
  /** 紅點的顏色與強度。 */
  dotColor: string;
  dotIntensity: number;
}

export const MODEL_STYLES: Record<string, ModelStyle> = {
  default: {
    widthRatio: 0.6,
    gripAngle: 14,
    glowIntensity: 3,
    stockLength: 0.17,
    handguardRatio: 0.62,
    arms: true,
    bodyRoughness: 0.5,
    bodyMetalness: 0.55,
    accentRoughness: 0.32,
    accentMetalness: 0.85,
    suitColor: '#161a22',
    dotColor: '#ff3a4a',
    dotIntensity: 6,
  },
};

export function modelStyle(manufacturer?: string): ModelStyle {
  return (manufacturer ? MODEL_STYLES[manufacturer] : undefined) ?? MODEL_STYLES.default!;
}

/** 槍模的部件清單與錨點（槍模本地座標）。 */
export interface ModelLayout {
  parts: ModelPart[];
  muzzle: [number, number, number];
  /** 開鏡時對到畫面中心的瞄具點（機瞄的準星連線、紅點的鏡片中心、狙擊鏡的目鏡中心）。 */
  sight: [number, number, number];
  /** 彈匣群組的換彈錨點（彈匣中心；動畫以此為參考）。 */
  magazine: [number, number, number] | null;
  /** 機匣前後端（z）與軸線高度：換彈、拋殼位置參考。 */
  receiverFront: number;
  receiverRear: number;
  axisY: number;
}

const box = (
  name: string,
  size: [number, number, number],
  pos: [number, number, number],
  mat: ModelMaterialKey,
  group: ModelPartGroup = 'static',
  rot?: [number, number, number],
): ModelPart => (rot ? { name, shape: 'box', size, pos, rot, mat, group } : { name, shape: 'box', size, pos, mat, group });

const cyl = (
  name: string,
  radius: number,
  length: number,
  pos: [number, number, number],
  mat: ModelMaterialKey,
  group: ModelPartGroup = 'static',
  rot?: [number, number, number],
): ModelPart =>
  rot
    ? { name, shape: 'cyl', size: [radius, radius, length], pos, rot, mat, group }
    : { name, shape: 'cyl', size: [radius, radius, length], pos, mat, group };

/** 從 a 指向 b 的方向換成 YXZ 歐拉角（度），讓 +Z 軸對齊該方向。 */
export function lookRotation(dx: number, dy: number, dz: number): [number, number, number] {
  const yaw = Math.atan2(dx, dz);
  const pitch = Math.atan2(-dy, Math.hypot(dx, dz));
  return [pitch / DEG2RAD, yaw / DEG2RAD, 0];
}

/** 依 WeaponModelDef 排出部件（純函式）。 */
export function layoutWeaponModel(m: Readonly<WeaponModelDef>, style: Readonly<ModelStyle> = modelStyle(m.manufacturer)): ModelLayout {
  const parts: ModelPart[] = [];
  const [mx, my, mz] = m.muzzle;
  const h = Math.max(0.02, m.bodyHeight);
  const len = Math.max(0.05, m.bodyLength);
  const w = h * style.widthRatio;
  const r = Math.max(0.002, m.barrelRadius);
  const barrelLen = Math.max(0, m.barrelLength);
  const front = mz + barrelLen;
  const rear = front + len;
  const midZ = (front + rear) / 2;
  const top = my + h * 0.35;
  const bottom = top - h;
  const cy = (top + bottom) / 2;
  const frame = m.frame;

  // 機匣：主體 + 上方滑軌（配色）。
  parts.push(box('receiver', [w, h, len], [mx, cy, midZ], 'body'));
  parts.push(box('rail', [w * 0.55, h * 0.12, len * 0.72], [mx, top + h * 0.06, midZ], 'accent'));
  // 機匣兩側的發光條。
  const stripLen = len * 0.58;
  const stripH = Math.max(0.004, h * 0.07);
  for (const side of [-1, 1]) {
    parts.push(box(`glow${side > 0 ? 'R' : 'L'}`, [0.0025, stripH, stripLen], [mx + side * (w / 2 + 0.001), cy + h * 0.12, midZ - len * 0.08], 'glow'));
  }
  // 機匣側面的配色板。
  parts.push(box('sidePlate', [w * 1.04, h * 0.3, len * 0.36], [mx, cy - h * 0.18, rear - len * 0.25], 'accent'));

  // 槍管、護木、槍口。
  if (barrelLen > 0) {
    parts.push(cyl('barrel', r, barrelLen, [mx, my, mz + barrelLen / 2], 'accent'));
    const guardLen = barrelLen * style.handguardRatio;
    const guardZ = front - guardLen / 2;
    if (frame === 'shotgun') {
      // 管狀彈倉在槍管下方；泵動護木套在彈倉上（獨立群組，開火後前後拉動）。
      parts.push(cyl('tube', r * 0.8, barrelLen * 0.92, [mx, my - r * 2.1, mz + barrelLen * 0.54], 'body'));
      parts.push(box('pump', [w * 0.95, h * 0.55, guardLen * 0.7], [mx, my - r * 2.1, guardZ + guardLen * 0.1], 'accent', 'pump'));
      parts.push(box('pumpGlow', [w * 0.97, 0.004, guardLen * 0.5], [mx, my - r * 2.1 + h * 0.12, guardZ + guardLen * 0.1], 'glow', 'pump'));
    } else if (frame === 'launcher') {
      // 發射器：粗槍管上套 3 圈發光線圈。
      for (let i = 0; i < 3; i++) {
        parts.push(cyl(`coil${i}`, r * 1.25, 0.012, [mx, my, mz + barrelLen * (0.25 + i * 0.25)], 'glow'));
      }
      parts.push(box('guard', [w * 1.05, h * 0.45, guardLen], [mx, my - r - h * 0.18, guardZ], 'dark'));
    } else if (frame !== 'pistol') {
      parts.push(box('handguard', [w * 0.92, h * 0.62, guardLen], [mx, my - h * 0.08, guardZ], 'body'));
      parts.push(box('guardGlow', [w * 0.94, 0.004, guardLen * 0.7], [mx, my + h * 0.08, guardZ], 'glow'));
    }
    parts.push(cyl('brake', r * 1.45, Math.min(0.04, barrelLen * 0.25), [mx, my, mz + 0.015], 'dark'));
    if (frame === 'sniper') parts.push(cyl('railRing', r * 1.7, 0.008, [mx, my, mz + 0.05], 'glow'));
  }

  // 握把與扳機護弓（握把在原點附近，略往後傾）。
  const gripZ = Math.min(rear - 0.03, Math.max(front + 0.04, 0.01));
  const gripH = frame === 'pistol' ? 0.11 : 0.1;
  parts.push(box('grip', [w * 0.78, gripH, 0.038], [mx, bottom - gripH * 0.42, gripZ + 0.012], 'dark', 'static', [style.gripAngle, 0, 0]));
  parts.push(box('triggerGuard', [w * 0.3, 0.008, 0.05], [mx, bottom - 0.028, gripZ - 0.035], 'accent'));

  // 彈匣（可拆）。
  let magazine: [number, number, number] | null = null;
  if (m.magazine === 'box') {
    if (frame === 'pistol') {
      // 手炮：彈匣在握把內，只露出底座與發光條。
      const p: [number, number, number] = [mx, bottom - gripH * 0.9, gripZ + 0.024];
      parts.push(box('mag', [w * 0.72, 0.03, 0.042], p, 'accent', 'magazine', [style.gripAngle, 0, 0]));
      parts.push(box('magGlow', [w * 0.74, 0.004, 0.044], [p[0], p[1] + 0.012, p[2]], 'glow', 'magazine', [style.gripAngle, 0, 0]));
      magazine = p;
    } else {
      const magH = Math.max(0.06, h * 1.25);
      const p: [number, number, number] = [mx, bottom - magH * 0.45, front + len * 0.3];
      parts.push(box('mag', [w * 0.62, magH, 0.05], p, 'accent', 'magazine', [-10, 0, 0]));
      parts.push(box('magGlow', [w * 0.64, 0.004, 0.052], [p[0], p[1] - magH * 0.3, p[2] + 0.005], 'glow', 'magazine', [-10, 0, 0]));
      magazine = p;
    }
  } else if (m.magazine === 'cell') {
    // 能量匣：機匣下方（狙擊）或側面（發射器）發光的能量電池。
    const side = frame === 'launcher';
    const p: [number, number, number] = side ? [mx + w / 2 + 0.018, cy, rear - len * 0.35] : [mx, bottom - 0.028, front + len * 0.32];
    parts.push(box('mag', side ? [0.03, h * 0.6, 0.09] : [w * 0.7, 0.05, 0.085], p, 'dark', 'magazine'));
    parts.push(box('magGlow', side ? [0.032, h * 0.18, 0.07] : [w * 0.72, 0.014, 0.07], p, 'glow', 'magazine'));
    magazine = p;
  }

  // 瞄具。
  let sight: [number, number, number];
  if (m.optic === 'reflex') {
    const z = midZ - len * 0.05;
    const base = top + h * 0.12;
    const fh = 0.034;
    parts.push(box('reflexBase', [w * 0.7, 0.01, 0.05], [mx, base + 0.005, z], 'dark'));
    // 鏡框：左右柱 + 上樑；鏡片中心有紅點。
    for (const side of [-1, 1]) parts.push(box(`reflexPost${side}`, [0.004, fh, 0.012], [mx + side * 0.016, base + 0.01 + fh / 2, z - 0.016], 'accent'));
    parts.push(box('reflexTop', [0.036, 0.004, 0.012], [mx, base + 0.01 + fh, z - 0.016], 'accent'));
    const dotY = base + 0.01 + fh * 0.5;
    parts.push(box('reflexDot', [0.0018, 0.0018, 0.001], [mx, dotY, z - 0.016], 'dot'));
    sight = [mx, dotY, z];
  } else if (m.optic === 'scope') {
    const z = midZ;
    const sr = 0.021;
    const sl = Math.min(0.24, len * 0.55);
    const axis = top + h * 0.12 + sr + 0.012;
    for (const dz of [-sl * 0.3, sl * 0.3]) parts.push(box('scopeMount', [0.012, axis - top, 0.014], [mx, (axis + top) / 2, z + dz], 'dark'));
    parts.push(cyl('scopeTube', sr, sl, [mx, axis, z], 'body'));
    parts.push(cyl('scopeBell', sr * 1.25, 0.04, [mx, axis, z - sl / 2 + 0.01], 'body'));
    parts.push(cyl('scopeLensF', sr * 1.15, 0.002, [mx, axis, z - sl / 2 - 0.01], 'lens'));
    parts.push(cyl('scopeLensR', sr * 0.9, 0.002, [mx, axis, z + sl / 2 + 0.001], 'lens'));
    parts.push(cyl('scopeGlow', sr * 1.02, 0.006, [mx, axis, z + sl * 0.15], 'glow'));
    sight = [mx, axis, z + sl / 2];
  } else {
    // 機瞄：後照門在機匣後端、準星在槍管前端；開鏡時兩者連線對到畫面中心。
    const postH = 0.018;
    const sy = top + h * 0.12 + postH;
    parts.push(box('rearSightL', [0.004, postH, 0.01], [mx - 0.006, sy - postH / 2, rear - 0.02], 'dark'));
    parts.push(box('rearSightR', [0.004, postH, 0.01], [mx + 0.006, sy - postH / 2, rear - 0.02], 'dark'));
    const frontZ = barrelLen > 0 ? mz + 0.03 : front + 0.01;
    const frontBase = barrelLen > 0 ? my + r : top;
    parts.push(box('frontPost', [0.003, sy - frontBase, 0.006], [mx, (sy + frontBase) / 2, frontZ], 'dark'));
    parts.push(box('frontDot', [0.0035, 0.0035, 0.002], [mx, sy - 0.0018, frontZ - 0.002], 'glow'));
    sight = [mx, sy - 0.0018, rear - 0.02];
  }

  // 槍托。
  if (m.stock) {
    const sl = style.stockLength;
    parts.push(box('stock', [w * 0.75, h * 0.8, sl], [mx, cy - h * 0.05, rear + sl / 2], 'dark', 'static', [-4, 0, 0]));
    parts.push(box('buttPad', [w * 0.8, h * 1.05, 0.02], [mx, cy - h * 0.08, rear + sl], 'accent'));
  }

  // 手套與前臂（右手在握把、左手在護木或握把下方；前臂往畫面外延伸）。
  if (style.arms) {
    const hand: [number, number, number] = [mx + 0.002, bottom - 0.045, gripZ + 0.02];
    parts.push(box('handR', [w * 1.25, 0.05, 0.06], hand, 'suit', 'static', [style.gripAngle, 0, 0]));
    const elbowR: [number, number, number] = [hand[0] + 0.1, hand[1] - 0.26, hand[2] + 0.42];
    parts.push(armPart('armR', hand, elbowR, 0.055));
    let left: [number, number, number];
    if (frame === 'pistol') left = [mx - 0.012, bottom - 0.06, gripZ - 0.005];
    else if (frame === 'shotgun') left = [mx, my - r * 2.1 - h * 0.3, front - barrelLen * 0.3];
    else left = [mx - 0.004, my - h * 0.42, front - Math.min(0.12, barrelLen * 0.45)];
    parts.push(box('handL', [w * 1.2, 0.045, 0.07], left, 'suit', frame === 'shotgun' ? 'pump' : 'static'));
    const elbowL: [number, number, number] = [left[0] - 0.2, left[1] - 0.28, left[2] + 0.38];
    const armL = armPart('armL', left, elbowL, 0.05);
    if (frame === 'shotgun') armL.group = 'pump';
    parts.push(armL);
    // 右前臂外側的發光條（疾行外骨骼）。
    const stripe = armPart('armStripeR', hand, elbowR, 0.056);
    stripe.size = [0.012, 0.057, stripe.size[2] * 0.5];
    stripe.mat = 'glow';
    parts.push(stripe);
  }

  return { parts, muzzle: [mx, my, mz], sight, magazine, receiverFront: front, receiverRear: rear, axisY: my };
}

function armPart(name: string, from: readonly [number, number, number], to: readonly [number, number, number], thickness: number): ModelPart {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const dz = to[2] - from[2];
  const length = Math.hypot(dx, dy, dz);
  return {
    name,
    shape: 'box',
    size: [thickness, thickness * 0.9, length],
    pos: [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2, (from[2] + to[2]) / 2],
    rot: lookRotation(dx, dy, dz),
    mat: 'suit',
    group: 'static',
  };
}

// ── Three.js 組裝 ────────────────────────────────────────

/** 建好的槍模。 */
export interface WeaponModel {
  /** 槍模根節點（viewmodel 動畫套在它的父節點上）。 */
  readonly root: THREE.Group;
  /** 可拆的彈匣（沒有時為 null）；本地位置 0 = 裝好。 */
  readonly magazine: THREE.Group | null;
  /** 泵動護木（霰彈槍；沒有時為 null）。 */
  readonly pump: THREE.Group | null;
  readonly layout: ModelLayout;
  readonly muzzle: THREE.Vector3;
  readonly sight: THREE.Vector3;
  /** 這把槍自己的發光材質（之後依稀有度換色）。 */
  readonly glowMaterial: THREE.MeshBasicMaterial;
  /** 建立用的 model 描述鍵（描述改變時重建）。 */
  readonly key: string;
  /** 發光條顏色（sRGB hex）與亮度倍率（開火後的充能效果用）。 */
  setGlowColor(color: THREE.ColorRepresentation): void;
  setGlowLevel(level: number): void;
  dispose(): void;
}

export interface WeaponModelOptions {
  /** 廠商（M2-01）；省略時用 model.manufacturer 或 default。 */
  manufacturer?: string;
  /** 覆寫發光色（稀有度色；省略時用 model.colors.glow）。 */
  glowColor?: string;
}

/**
 * 描述鍵：同樣的 model 描述與選項得到同樣的鍵。數值取到 1e-6（調參面板綁定時會依步進改寫成
 * 0.39999999999999997 這類值，不應因此重建槍模）。
 */
export function weaponModelKey(m: Readonly<WeaponModelDef>, options: WeaponModelOptions = {}): string {
  return JSON.stringify([m, options.manufacturer ?? null, options.glowColor ?? null], (_k, v: unknown) =>
    typeof v === 'number' ? Math.round(v * 1e6) / 1e6 : v,
  );
}

function partGeometry(p: ModelPart): THREE.BufferGeometry {
  const g =
    p.shape === 'box'
      ? new THREE.BoxGeometry(p.size[0], p.size[1], p.size[2])
      : new THREE.CylinderGeometry(p.size[0], p.size[1], p.size[2], 14, 1).rotateX(Math.PI / 2);
  if (p.rot) {
    const e = new THREE.Euler(p.rot[0] * DEG2RAD, p.rot[1] * DEG2RAD, p.rot[2] * DEG2RAD, 'YXZ');
    g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(e));
  }
  g.translate(p.pos[0], p.pos[1], p.pos[2]);
  return g;
}

export class WeaponModelFactory {
  /** 共用材質（顏色 + 種類 → 材質）。 */
  readonly materials = new Map<string, THREE.Material>();
  /** 建立過的槍模數（除錯）。 */
  created = 0;

  /** 取得共用材質（同參數同物件）。 */
  sharedMaterial(key: ModelMaterialKey, color: string, style: Readonly<ModelStyle>): THREE.Material {
    const id = `${key}:${color}:${key === 'body' ? `${style.bodyRoughness}/${style.bodyMetalness}` : key === 'accent' ? `${style.accentRoughness}/${style.accentMetalness}` : ''}`;
    let mat = this.materials.get(id);
    if (mat) return mat;
    switch (key) {
      case 'body':
        mat = new THREE.MeshStandardMaterial({ color, roughness: style.bodyRoughness, metalness: style.bodyMetalness });
        break;
      case 'accent':
        mat = new THREE.MeshStandardMaterial({ color, roughness: style.accentRoughness, metalness: style.accentMetalness });
        break;
      case 'lens':
        mat = new THREE.MeshStandardMaterial({ color, roughness: 0.05, metalness: 1, emissive: new THREE.Color(color), emissiveIntensity: 0.6 });
        break;
      case 'dot': {
        const m = new THREE.MeshBasicMaterial({ color, toneMapped: false });
        m.color.multiplyScalar(style.dotIntensity);
        mat = m;
        break;
      }
      default:
        // dark、suit：低金屬、偏粗糙。
        mat = new THREE.MeshStandardMaterial({ color, roughness: 0.72, metalness: 0.2 });
    }
    mat.name = `vm:${id}`;
    this.materials.set(id, mat);
    return mat;
  }

  create(def: Readonly<WeaponModelDef>, options: WeaponModelOptions = {}): WeaponModel {
    const style = modelStyle(options.manufacturer ?? def.manufacturer);
    const layout = layoutWeaponModel(def, style);
    const glowHex = options.glowColor ?? def.colors.glow;
    const glowMaterial = new THREE.MeshBasicMaterial({ color: glowHex, toneMapped: false });
    glowMaterial.name = 'vm:glow';
    const glowBase = new THREE.Color(glowHex);
    let glowLevel = 1;
    const applyGlow = (): void => {
      glowMaterial.color.copy(glowBase).multiplyScalar(style.glowIntensity * glowLevel);
    };
    applyGlow();
    const colorOf = (k: ModelMaterialKey): string =>
      k === 'body' ? def.colors.body : k === 'accent' ? def.colors.accent : k === 'lens' ? '#0b2a3a' : k === 'dot' ? style.dotColor : k === 'suit' ? style.suitColor : '#0f1218';
    const materialOf = (k: ModelMaterialKey): THREE.Material => (k === 'glow' ? glowMaterial : this.sharedMaterial(k, colorOf(k), style));

    const root = new THREE.Group();
    root.name = `vm:model:${def.frame}`;
    const groups: Record<ModelPartGroup, THREE.Group> = { static: root, magazine: new THREE.Group(), pump: new THREE.Group() };
    groups.magazine.name = 'vm:magazine';
    groups.pump.name = 'vm:pump';
    const buckets = new Map<string, THREE.BufferGeometry[]>();
    for (const p of layout.parts) {
      const k = `${p.group}|${p.mat}`;
      let list = buckets.get(k);
      if (!list) buckets.set(k, (list = []));
      list.push(partGeometry(p));
    }
    const geometries: THREE.BufferGeometry[] = [];
    for (const [k, list] of buckets) {
      const [group, mat] = k.split('|') as [ModelPartGroup, ModelMaterialKey];
      const merged = list.length === 1 ? list[0]! : mergeGeometries(list, false);
      if (list.length > 1) for (const g of list) g.dispose();
      if (!merged) continue;
      geometries.push(merged);
      const mesh = new THREE.Mesh(merged, materialOf(mat));
      mesh.name = `vm:${group}:${mat}`;
      mesh.frustumCulled = false;
      groups[group].add(mesh);
    }
    const magazine = groups.magazine.children.length > 0 ? groups.magazine : null;
    const pump = groups.pump.children.length > 0 ? groups.pump : null;
    if (magazine) root.add(magazine);
    if (pump) root.add(pump);
    this.created++;
    return {
      root,
      magazine,
      pump,
      layout,
      muzzle: new THREE.Vector3(...layout.muzzle),
      sight: new THREE.Vector3(...layout.sight),
      glowMaterial,
      key: weaponModelKey(def, options),
      setGlowColor(color) {
        glowBase.set(color);
        applyGlow();
      },
      setGlowLevel(level) {
        if (level === glowLevel) return;
        glowLevel = level;
        applyGlow();
      },
      dispose() {
        root.removeFromParent();
        for (const g of geometries) g.dispose();
        glowMaterial.dispose();
      },
    };
  }

  dispose(): void {
    for (const m of this.materials.values()) m.dispose();
    this.materials.clear();
  }
}
