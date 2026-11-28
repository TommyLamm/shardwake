// 全息看板（M1-09）：關卡的中文看板一次畫進同一張 Canvas 文字圖集，合併成一個網格（一個 draw call）。
// - 文字用系統字型（"Microsoft JhengHei", "PingFang TC", "Noto Sans TC", sans-serif）畫在 Canvas，貼圖生成 mipmap。
// - 著色器：文字顏色 × 強度（> 1，Bloom 會抓到文字與邊框）、沿世界高度的掃描線、輕微閃爍（每塊看板不同相位）。
//   時間與強度等 uniform 由 HoloUniforms 共用（MaterialLibrary 每畫面更新），每個關卡只有自己的圖集貼圖。
// - packShelves() 是純函式（可測試）：依高度排序後逐列擺放。
import * as THREE from 'three';
import type { LevelLabel } from '@/world/LevelData';

export const HOLO_FONT = '"Microsoft JhengHei", "PingFang TC", "Noto Sans TC", sans-serif';

export interface HoloConfig {
  /** 文字與邊框的發光強度（> 1 讓 Bloom 抓到）。 */
  intensity: number;
  /** 背景板不透明度（0–1）。 */
  backgroundAlpha: number;
  /** 閃爍：強度（0–1）、速度（1/s）。 */
  flicker: number;
  flickerSpeed: number;
  /** 掃描線：強度（0–1）、每公尺條數、移動速度（m/s）。 */
  scanAmount: number;
  scanDensity: number;
  scanSpeed: number;
  /** 文字像素大小（主標、副標）與邊距。 */
  mainPx: number;
  subPx: number;
  padPx: number;
  /** 圖集寬度（像素）與最大高度。 */
  atlasWidth: number;
  atlasMaxHeight: number;
  /** 邊框顏色（CSS 色彩）。 */
  border: string;
  /** 背景顏色（CSS 色彩，不含透明度）。 */
  background: string;
}

export const HOLO_CONFIG: HoloConfig = {
  intensity: 2.4,
  backgroundAlpha: 0.55,
  flicker: 0.12,
  flickerSpeed: 9,
  scanAmount: 0.22,
  scanDensity: 14,
  scanSpeed: 0.35,
  mainPx: 96,
  subPx: 52,
  padPx: 36,
  atlasWidth: 2048,
  atlasMaxHeight: 4096,
  border: '#39e6ff',
  background: '#081018',
};

export interface PackSize {
  w: number;
  h: number;
}

export interface PackRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * 貨架式裝箱：依高度由大到小逐列擺放（列寬 width、間距 gap）。
 * 回傳每個輸入（原順序）的位置與總高度；有任何一個比 width 寬時回傳 null。
 */
export function packShelves(sizes: readonly PackSize[], width: number, gap = 2): { rects: PackRect[]; height: number } | null {
  const order = sizes.map((_, i) => i).sort((a, b) => sizes[b]!.h - sizes[a]!.h || a - b);
  const rects: PackRect[] = new Array<PackRect>(sizes.length);
  let x = gap;
  let y = gap;
  let rowH = 0;
  for (const i of order) {
    const s = sizes[i]!;
    if (s.w + gap * 2 > width) return null;
    if (x + s.w + gap > width) {
      y += rowH + gap;
      x = gap;
      rowH = 0;
    }
    rects[i] = { x, y, w: s.w, h: s.h };
    x += s.w + gap;
    rowH = Math.max(rowH, s.h);
  }
  return { rects, height: sizes.length > 0 ? y + rowH + gap : 0 };
}

/** 看板的世界尺寸（高 = 文字高 × 行數係數，寬依圖片比例）。 */
export function labelWorldSize(label: LevelLabel, aspect: number, lines: number): { w: number; h: number } {
  const textHeight = label.height ?? 1;
  const h = textHeight * (lines === 2 ? 1.9 : 1.45);
  return { w: h * aspect, h };
}

export interface HoloUniforms {
  uTime: { value: number };
  uIntensity: { value: number };
  uBgAlpha: { value: number };
  uFlicker: { value: number };
  uFlickerSpeed: { value: number };
  uScan: { value: number };
  uScanDensity: { value: number };
  uScanSpeed: { value: number };
}

export function createHoloUniforms(): HoloUniforms {
  return {
    uTime: { value: 0 },
    uIntensity: { value: 1 },
    uBgAlpha: { value: 1 },
    uFlicker: { value: 0 },
    uFlickerSpeed: { value: 1 },
    uScan: { value: 0 },
    uScanDensity: { value: 1 },
    uScanSpeed: { value: 0 },
  };
}

/** 把設定與時間寫入共用 uniform。 */
export function applyHoloUniforms(u: HoloUniforms, cfg: HoloConfig, time: number): void {
  u.uTime.value = time % 1000;
  u.uIntensity.value = cfg.intensity;
  u.uBgAlpha.value = cfg.backgroundAlpha;
  u.uFlicker.value = cfg.flicker;
  u.uFlickerSpeed.value = cfg.flickerSpeed;
  u.uScan.value = cfg.scanAmount;
  u.uScanDensity.value = cfg.scanDensity;
  u.uScanSpeed.value = cfg.scanSpeed;
}

const VERTEX = /* glsl */ `
attribute float aSeed;
varying vec2 vUv;
varying float vSeed;
varying float vWorldY;
#include <fog_pars_vertex>
void main() {
  vUv = uv;
  vSeed = aSeed;
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vWorldY = worldPos.y;
  vec4 mvPosition = viewMatrix * worldPos;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const FRAGMENT = /* glsl */ `
uniform sampler2D uMap;
uniform float uTime;
uniform float uIntensity;
uniform float uBgAlpha;
uniform float uFlicker;
uniform float uFlickerSpeed;
uniform float uScan;
uniform float uScanDensity;
uniform float uScanSpeed;
varying vec2 vUv;
varying float vSeed;
varying float vWorldY;
#include <fog_pars_fragment>

float hash11(float n) { return fract(sin(n * 91.3458) * 47453.5453); }

void main() {
  vec4 t = texture2D(uMap, vUv);
  // 圖集的 alpha：文字與邊框 = 1，背景板 = 背景透明度（canvas 內先畫成 0.5，這裡換算）。
  float isGlyph = smoothstep(0.55, 0.95, t.a);
  float alpha = mix(t.a * 2.0 * uBgAlpha, 1.0, isGlyph);
  if (alpha < 0.01) discard;
  float k = floor(uTime * uFlickerSpeed + vSeed * 13.0);
  float blink = step(0.92, hash11(k + vSeed * 7.0));
  float wave = 0.5 + 0.5 * sin(uTime * 6.3 + vSeed * 17.0);
  float flicker = 1.0 - uFlicker * (0.25 * wave + 0.75 * blink);
  float scan = 1.0 - uScan * (0.5 + 0.5 * sin((vWorldY - uTime * uScanSpeed) * uScanDensity * 6.2831853));
  float glow = mix(1.0, uIntensity, isGlyph) * flicker * scan;
  gl_FragColor = vec4(t.rgb * glow, alpha);
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

export function createHoloMaterial(map: THREE.Texture, shared: HoloUniforms): THREE.ShaderMaterial {
  const fog = THREE.UniformsUtils.clone(THREE.UniformsLib.fog);
  return new THREE.ShaderMaterial({
    name: 'holo',
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: { ...fog, ...shared, uMap: { value: map } },
    transparent: true,
    depthWrite: false,
    fog: true,
  });
}

interface MeasuredLabel {
  label: LevelLabel;
  w: number;
  h: number;
  lines: number;
}

function measure(ctx: CanvasRenderingContext2D, label: LevelLabel, cfg: HoloConfig, scale: number): MeasuredLabel {
  const mainPx = Math.round(cfg.mainPx * scale);
  const subPx = Math.round(cfg.subPx * scale);
  const pad = Math.round(cfg.padPx * scale);
  ctx.font = `bold ${mainPx}px ${HOLO_FONT}`;
  let width = ctx.measureText(label.text).width;
  if (label.sub) {
    ctx.font = `${subPx}px ${HOLO_FONT}`;
    width = Math.max(width, ctx.measureText(label.sub).width);
  }
  const w = Math.ceil(width + pad * 2);
  const h = Math.ceil(mainPx * 1.25 + (label.sub ? subPx * 1.3 : 0) + pad * 1.2);
  return { label, w, h, lines: label.sub ? 2 : 1 };
}

function cssColor(hex: number): string {
  return `#${(hex & 0xffffff).toString(16).padStart(6, '0')}`;
}

/** 畫一塊看板（背景 alpha 0.5，文字與邊框 alpha 1，著色器依 alpha 區分）。 */
function drawBoard(ctx: CanvasRenderingContext2D, m: MeasuredLabel, r: PackRect, cfg: HoloConfig, scale: number): void {
  const { x, y, w, h } = r;
  const mainPx = Math.round(cfg.mainPx * scale);
  const subPx = Math.round(cfg.subPx * scale);
  const pad = Math.round(cfg.padPx * scale);
  ctx.save();
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = cfg.background;
  ctx.fillRect(x, y, w, h);
  ctx.globalAlpha = 1;
  // 邊框：細線 + 四角加粗的括號。
  ctx.strokeStyle = cfg.border;
  const lw = Math.max(2, Math.round(4 * scale));
  ctx.lineWidth = lw;
  ctx.strokeRect(x + lw / 2, y + lw / 2, w - lw, h - lw);
  const c = Math.min(w, h) * 0.22;
  ctx.lineWidth = lw * 2.2;
  ctx.beginPath();
  for (const [cx, cy, sx, sy] of [
    [x, y, 1, 1],
    [x + w, y, -1, 1],
    [x, y + h, 1, -1],
    [x + w, y + h, -1, -1],
  ] as const) {
    ctx.moveTo(cx + sx * lw, cy + sy * (lw + c));
    ctx.lineTo(cx + sx * lw, cy + sy * lw);
    ctx.lineTo(cx + sx * (lw + c), cy + sy * lw);
  }
  ctx.stroke();
  ctx.fillStyle = cssColor(m.label.color ?? 0xffffff);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `bold ${mainPx}px ${HOLO_FONT}`;
  const mainY = y + pad * 0.6 + mainPx * 0.62;
  ctx.fillText(m.label.text, x + w / 2, mainY);
  if (m.label.sub) {
    ctx.font = `${subPx}px ${HOLO_FONT}`;
    ctx.fillText(m.label.sub, x + w / 2, mainY + mainPx * 0.62 + subPx * 0.7);
  }
  ctx.restore();
}

function nextPow2(x: number): number {
  return 2 ** Math.ceil(Math.log2(Math.max(1, x)));
}

export interface HoloBuild {
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  texture: THREE.CanvasTexture;
  atlasWidth: number;
  atlasHeight: number;
  scale: number;
}

/**
 * 建立一組看板的合併網格（沒有 document／Canvas 時回傳 null）。
 * 網格的 userData.labelCount 為看板數、userData.dispose() 釋放幾何、材質與圖集（LevelBuilder 卸載時呼叫）。
 */
export function buildHoloBoards(
  labels: readonly LevelLabel[],
  shared: HoloUniforms,
  cfg: HoloConfig = HOLO_CONFIG,
  anisotropy = 1,
): HoloBuild | null {
  if (labels.length === 0 || typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  let scale = 1;
  let measured: MeasuredLabel[] = [];
  let packed: { rects: PackRect[]; height: number } | null = null;
  for (let attempt = 0; attempt < 8; attempt++) {
    measured = labels.map((l) => measure(ctx, l, cfg, scale));
    packed = packShelves(measured, cfg.atlasWidth, 4);
    if (packed && packed.height <= cfg.atlasMaxHeight) break;
    scale *= 0.8;
    packed = null;
  }
  if (!packed) return null;
  canvas.width = cfg.atlasWidth;
  canvas.height = Math.min(cfg.atlasMaxHeight, nextPow2(packed.height));
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  measured.forEach((m, i) => drawBoard(ctx, m, packed!.rects[i]!, cfg, scale));

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = anisotropy;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.name = 'holo:atlas';

  const n = labels.length;
  const pos = new Float32Array(n * 4 * 3);
  const uv = new Float32Array(n * 4 * 2);
  const seed = new Float32Array(n * 4);
  const index = new Uint16Array(n * 6);
  const W = canvas.width;
  const H = canvas.height;
  const corner = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  measured.forEach((m, i) => {
    const r = packed!.rects[i]!;
    const size = labelWorldSize(m.label, m.w / m.h, m.lines);
    quat.setFromAxisAngle(up, (m.label.yaw * Math.PI) / 180);
    const u0 = r.x / W;
    const u1 = (r.x + r.w) / W;
    const vTop = 1 - r.y / H;
    const vBot = 1 - (r.y + r.h) / H;
    const corners: [number, number, number, number][] = [
      [-0.5, -0.5, u0, vBot],
      [0.5, -0.5, u1, vBot],
      [0.5, 0.5, u1, vTop],
      [-0.5, 0.5, u0, vTop],
    ];
    corners.forEach(([cx, cy, cu, cv], k) => {
      corner.set(cx * size.w, cy * size.h, 0).applyQuaternion(quat);
      const vi = i * 4 + k;
      pos[vi * 3] = corner.x + m.label.pos[0];
      pos[vi * 3 + 1] = corner.y + m.label.pos[1];
      pos[vi * 3 + 2] = corner.z + m.label.pos[2];
      uv[vi * 2] = cu;
      uv[vi * 2 + 1] = cv;
      seed[vi] = (i * 0.618034) % 1;
    });
    const b = i * 4;
    index.set([b, b + 1, b + 2, b, b + 2, b + 3], i * 6);
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  geo.setIndex(new THREE.BufferAttribute(index, 1));
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  const material = createHoloMaterial(texture, shared);
  const mesh = new THREE.Mesh(geo, material);
  mesh.name = 'holoBoards';
  mesh.renderOrder = 10;
  mesh.userData.labelCount = n;
  mesh.userData.dispose = () => {
    mesh.removeFromParent();
    geo.dispose();
    material.dispose();
    texture.dispose();
  };
  return { mesh, texture, atlasWidth: W, atlasHeight: H, scale };
}
