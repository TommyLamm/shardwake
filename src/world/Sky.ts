// 天空與霧（M1-09）：漸層天空球（深藍 → 紫，地平線帶狀霧光）、星點、遠景巨構剪影（破碎晶格結構與發光窗格）、指數霧。
// - 天空球與星點跟著相機移動，頂點著色器輸出 z = w（畫在遠裁切面上），最後畫（renderOrder 大），被遮住的像素由深度測試略過。
// - 巨構剪影是固定在世界中的合併網格（結構一個、窗格一個 draw call），距場地中心 380–520 m（相機遠裁切 900 m 內）；
//   不受霧影響，改以頂點色做「越低越接近地平線霧色」的大氣透視。窗格顏色 × 強度 > 1，Bloom 會抓到。
// - generateStars()／generateMegastructure() 是純函式（固定種子，可測試、結果可重現）。
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { SystemOrder, type FrameInfo, type GameSystem } from '@/core/Game';
import { Rng } from '@/core/Rng';

export interface SkyConfig {
  zenith: number;
  horizon: number;
  /** 地平線以下的顏色。 */
  ground: number;
  /** 漸層指數（越大，地平線顏色占越高）。 */
  gradientPower: number;
  /** 地平線帶狀霧光：顏色、強度、銳利度。 */
  bandColor: number;
  bandStrength: number;
  bandSharpness: number;
  /** 星點：數量、亮度、大小（像素）、閃爍。 */
  starCount: number;
  starBrightness: number;
  starSize: number;
  starTwinkle: number;
  /** 指數霧：顏色與密度。 */
  fogColor: number;
  fogDensity: number;
  /** 巨構剪影：結構顏色、與地平線霧色混合的比例（低處／高處）、窗格強度。 */
  structureColor: number;
  structureHazeLow: number;
  structureHazeHigh: number;
  windowIntensity: number;
  seed: number;
}

export const SKY_CONFIG: SkyConfig = {
  zenith: 0x050a1e,
  horizon: 0x3a1f5c,
  ground: 0x07060f,
  gradientPower: 0.55,
  bandColor: 0x8a3a9a,
  bandStrength: 0.35,
  bandSharpness: 14,
  starCount: 1600,
  starBrightness: 1.2,
  starSize: 2.2,
  starTwinkle: 0.35,
  fogColor: 0x1a1430,
  fogDensity: 0.0042,
  structureColor: 0x0a0c1c,
  structureHazeLow: 0.55,
  structureHazeHigh: 0.12,
  windowIntensity: 3,
  seed: 0x5ca1ab1e,
};

export interface StarData {
  /** 單位方向（xyz 攤平）。 */
  dirs: Float32Array;
  /** 大小倍率 0.5–1.5。 */
  sizes: Float32Array;
  /** 亮度 0.2–1，少數亮星 > 1。 */
  brightness: Float32Array;
  /** 閃爍相位。 */
  phase: Float32Array;
}

/** 產生星點（上半球為主，最低到地平線下 5°）。 */
export function generateStars(count: number, seed: number): StarData {
  const rng = new Rng(seed);
  const n = Math.max(0, Math.floor(count));
  const dirs = new Float32Array(n * 3);
  const sizes = new Float32Array(n);
  const brightness = new Float32Array(n);
  const phase = new Float32Array(n);
  const minY = Math.sin((-5 * Math.PI) / 180);
  for (let i = 0; i < n; i++) {
    // 均勻分布在球帶 y ∈ [minY, 1]。
    const y = minY + (1 - minY) * rng.float();
    const a = rng.float() * Math.PI * 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    dirs[i * 3] = Math.cos(a) * r;
    dirs[i * 3 + 1] = y;
    dirs[i * 3 + 2] = Math.sin(a) * r;
    const t = rng.float();
    sizes[i] = 0.5 + t * t;
    brightness[i] = rng.float() < 0.04 ? 1.2 + rng.float() * 1.2 : 0.2 + rng.float() * 0.8;
    phase[i] = rng.float() * Math.PI * 2;
  }
  return { dirs, sizes, brightness, phase };
}

export interface MegastructureConfig {
  clusters: number;
  radiusMin: number;
  radiusMax: number;
  /** 每個晶格的節點數範圍（x、y、z 各自）。 */
  nodesMin: number;
  nodesMax: number;
  cellMin: number;
  cellMax: number;
  beamMin: number;
  beamMax: number;
  /** 缺損比例（破碎）。 */
  breakChance: number;
  /** 碎片漂移（m）與最大傾角（度）。 */
  drift: number;
  tiltDeg: number;
  /** 窗格出現機率（每段梁）。 */
  windowChance: number;
  baseYMin: number;
  baseYMax: number;
}

export const MEGASTRUCTURE_CONFIG: MegastructureConfig = {
  clusters: 12,
  radiusMin: 380,
  radiusMax: 520,
  nodesMin: 3,
  nodesMax: 4,
  cellMin: 24,
  cellMax: 40,
  beamMin: 2.4,
  beamMax: 5,
  breakChance: 0.38,
  drift: 9,
  tiltDeg: 18,
  windowChance: 0.35,
  baseYMin: -100,
  baseYMax: 10,
};

export interface Beam {
  /** 中心（世界座標）、尺寸、旋轉（四元數 xyzw）。 */
  center: [number, number, number];
  size: [number, number, number];
  quat: [number, number, number, number];
}

export interface WindowPane {
  center: [number, number, number];
  /** 窗格面向（單位向量）、寬、高、色別（0 青、1 洋紅、2 橘）。 */
  normal: [number, number, number];
  up: [number, number, number];
  w: number;
  h: number;
  tint: number;
}

export interface MegastructureData {
  beams: Beam[];
  windows: WindowPane[];
  /** 結構的最低與最高點（大氣透視用）。 */
  minY: number;
  maxY: number;
}

const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _u = new THREE.Vector3();

/** 產生遠景巨構：環繞場地的破碎立方晶格（節點間的梁，部分缺損、漂移、傾斜）與梁上的發光窗格。 */
export function generateMegastructure(seed: number, cfg: MegastructureConfig = MEGASTRUCTURE_CONFIG): MegastructureData {
  const rng = new Rng(seed);
  const beams: Beam[] = [];
  const windows: WindowPane[] = [];
  let minY = Infinity;
  let maxY = -Infinity;
  for (let c = 0; c < cfg.clusters; c++) {
    const angle = ((c + rng.range(-0.3, 0.3)) / cfg.clusters) * Math.PI * 2;
    const radius = rng.range(cfg.radiusMin, cfg.radiusMax);
    const nx = rng.int(cfg.nodesMin, cfg.nodesMax);
    const ny = rng.int(cfg.nodesMin, cfg.nodesMax + 1);
    const nz = rng.int(cfg.nodesMin, cfg.nodesMax);
    const cell = rng.range(cfg.cellMin, cfg.cellMax);
    const beamT = rng.range(cfg.beamMin, cfg.beamMax);
    // 晶格中心放在半徑上，往內縮一半深度，避免超出遠裁切面。
    const depth = (nz - 1) * cell;
    const r = Math.min(radius, cfg.radiusMax - depth * 0.5);
    const base = new THREE.Vector3(Math.cos(angle) * r, rng.range(cfg.baseYMin, cfg.baseYMax), Math.sin(angle) * r);
    _e.set(
      THREE.MathUtils.degToRad(rng.range(-cfg.tiltDeg, cfg.tiltDeg)),
      rng.range(0, Math.PI * 2),
      THREE.MathUtils.degToRad(rng.range(-cfg.tiltDeg, cfg.tiltDeg)),
    );
    _q.setFromEuler(_e);
    const half = new THREE.Vector3(((nx - 1) * cell) / 2, 0, ((nz - 1) * cell) / 2);
    const node = (i: number, j: number, k: number, out: THREE.Vector3): THREE.Vector3 =>
      out.set(i * cell - half.x, j * cell, k * cell - half.z).applyQuaternion(_q).add(base);
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const axes: [number, number, number][] = [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ];
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < ny; j++) {
        for (let k = 0; k < nz; k++) {
          // 越高越容易缺損（崩解的頂部）。
          const breakBias = cfg.breakChance * (0.6 + (0.8 * j) / Math.max(1, ny - 1));
          for (const [dx, dy, dz] of axes) {
            if (i + dx >= nx || j + dy >= ny || k + dz >= nz) continue;
            if (rng.float() < breakBias) continue;
            node(i, j, k, a);
            node(i + dx, j + dy, k + dz, b);
            const len = a.distanceTo(b);
            const drift = rng.float() < 0.25 ? cfg.drift * (j / Math.max(1, ny - 1)) : 0;
            const center = a.add(b).multiplyScalar(0.5);
            if (drift > 0) center.add(_v.set(rng.range(-1, 1), rng.range(-0.3, 1), rng.range(-1, 1)).multiplyScalar(drift));
            // 梁沿 local Z；先把 Z 轉到晶格軸，再套用晶格旋轉與少量碎片旋轉。
            _q2.setFromUnitVectors(_v.set(0, 0, 1), _n.set(dx, dy, dz));
            const beamQ = _q.clone().multiply(_q2);
            if (drift > 0) {
              _e.set(rng.range(-0.3, 0.3), rng.range(-0.3, 0.3), rng.range(-0.3, 0.3));
              beamQ.multiply(_q2.setFromEuler(_e));
            }
            const thick = beamT * (dy === 1 ? 1.25 : 1);
            beams.push({
              center: [center.x, center.y, center.z],
              size: [thick, thick, len * (drift > 0 ? 0.7 : 1)],
              quat: [beamQ.x, beamQ.y, beamQ.z, beamQ.w],
            });
            const top = center.y + len / 2;
            minY = Math.min(minY, center.y - len / 2);
            maxY = Math.max(maxY, top);
            if (rng.float() < cfg.windowChance) {
              // 窗格貼在梁朝場地中心的一面。
              _n.set(-center.x, 0, -center.z).normalize();
              _u.set(0, 0, 1).applyQuaternion(beamQ);
              const lateral = _n.clone().sub(_u.clone().multiplyScalar(_n.dot(_u)));
              if (lateral.lengthSq() < 1e-4) continue;
              lateral.normalize();
              const count = rng.int(1, 4);
              for (let w = 0; w < count; w++) {
                const t = ((w + 0.5) / count - 0.5) * len * 0.8;
                const p = center.clone().add(_u.clone().multiplyScalar(t)).add(lateral.clone().multiplyScalar(thick / 2 + 0.05));
                windows.push({
                  center: [p.x, p.y, p.z],
                  normal: [lateral.x, lateral.y, lateral.z],
                  up: [_u.x, _u.y, _u.z],
                  w: thick * 0.6,
                  h: Math.min(len * 0.8 / count, thick * 2.5),
                  tint: rng.float() < 0.6 ? 0 : rng.float() < 0.7 ? 1 : 2,
                });
              }
            }
          }
        }
      }
    }
  }
  if (!Number.isFinite(minY)) {
    minY = 0;
    maxY = 1;
  }
  return { beams, windows, minY, maxY };
}

const SKY_VERTEX = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}
`;

const SKY_FRAGMENT = /* glsl */ `
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uGround;
uniform vec3 uBand;
uniform float uPower;
uniform float uBandStrength;
uniform float uBandSharpness;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float y = d.y;
  vec3 col = y >= 0.0
    ? mix(uHorizon, uZenith, pow(clamp(y, 0.0, 1.0), uPower))
    : mix(uHorizon, uGround, clamp(-y * 6.0, 0.0, 1.0));
  col += uBand * uBandStrength * exp(-abs(y) * uBandSharpness);
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

const STAR_VERTEX = /* glsl */ `
attribute float aSize;
attribute float aBright;
attribute float aPhase;
uniform float uSize;
uniform float uTime;
uniform float uTwinkle;
uniform float uPixelRatio;
varying float vBright;
void main() {
  vBright = aBright * (1.0 - uTwinkle * (0.5 + 0.5 * sin(uTime * (1.3 + aPhase) + aPhase * 7.0)));
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position * 400.0, 1.0);
  gl_Position = p.xyww;
  gl_PointSize = max(1.0, uSize * aSize * uPixelRatio);
}
`;

const STAR_FRAGMENT = /* glsl */ `
uniform float uBrightness;
varying float vBright;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float a = smoothstep(0.5, 0.0, length(c));
  vec3 col = vec3(0.75, 0.85, 1.0) * vBright * uBrightness * a;
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

const TINTS = [0x39e6ff, 0xff3df0, 0xff8a20];

export interface SkyOptions {
  scene: THREE.Scene;
  camera: THREE.Camera;
  config?: SkyConfig;
  structure?: MegastructureConfig;
  /** 像素比（星點大小），預設 1。 */
  getPixelRatio?: () => number;
}

export class Sky implements GameSystem {
  readonly name = 'sky';
  readonly order = SystemOrder.fx;
  readonly config: SkyConfig;
  /** 跟著相機的群組（天空球、星點）。 */
  readonly follow = new THREE.Group();
  readonly dome: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  readonly stars: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  readonly structures: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  readonly windows: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  readonly stats: { beams: number; windows: number; stars: number };
  private readonly fog: THREE.FogExp2;
  private time = 0;
  private readonly baseColors: Float32Array;
  private readonly heights: Float32Array;
  private hazeKey = '';

  constructor(private readonly options: SkyOptions) {
    const cfg = (this.config = options.config ?? SKY_CONFIG);
    this.follow.name = 'sky:follow';
    const domeMat = new THREE.ShaderMaterial({
      name: 'sky:dome',
      vertexShader: SKY_VERTEX,
      fragmentShader: SKY_FRAGMENT,
      uniforms: {
        uZenith: { value: new THREE.Color() },
        uHorizon: { value: new THREE.Color() },
        uGround: { value: new THREE.Color() },
        uBand: { value: new THREE.Color() },
        uPower: { value: 1 },
        uBandStrength: { value: 0 },
        uBandSharpness: { value: 1 },
      },
      side: THREE.BackSide,
      depthWrite: false,
    });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(400, 32, 16), domeMat);
    this.dome.name = 'sky:dome';
    this.dome.frustumCulled = false;
    this.dome.renderOrder = 1000;

    const starData = generateStars(cfg.starCount, cfg.seed);
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(starData.dirs, 3));
    sg.setAttribute('aSize', new THREE.BufferAttribute(starData.sizes, 1));
    sg.setAttribute('aBright', new THREE.BufferAttribute(starData.brightness, 1));
    sg.setAttribute('aPhase', new THREE.BufferAttribute(starData.phase, 1));
    const starMat = new THREE.ShaderMaterial({
      name: 'sky:stars',
      vertexShader: STAR_VERTEX,
      fragmentShader: STAR_FRAGMENT,
      uniforms: {
        uSize: { value: 2 },
        uTime: { value: 0 },
        uTwinkle: { value: 0 },
        uPixelRatio: { value: 1 },
        uBrightness: { value: 1 },
      },
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: false,
    });
    this.stars = new THREE.Points(sg, starMat);
    this.stars.name = 'sky:stars';
    this.stars.frustumCulled = false;
    this.stars.renderOrder = 1001;
    this.follow.add(this.dome, this.stars);

    const data = generateMegastructure(cfg.seed);
    const built = buildMegastructureGeometry(data);
    this.baseColors = new Float32Array(built.structure.getAttribute('color').array);
    this.heights = built.heights;
    this.structures = new THREE.Mesh(
      built.structure,
      new THREE.MeshBasicMaterial({ name: 'sky:structures', vertexColors: true, fog: false }),
    );
    this.structures.name = 'sky:structures';
    this.structures.matrixAutoUpdate = false;
    this.windows = new THREE.Mesh(
      built.windows,
      new THREE.MeshBasicMaterial({ name: 'sky:windows', vertexColors: true, fog: false, side: THREE.DoubleSide }),
    );
    this.windows.name = 'sky:windows';
    this.windows.matrixAutoUpdate = false;
    this.stats = { beams: data.beams.length, windows: data.windows.length, stars: starData.sizes.length };

    this.fog = new THREE.FogExp2(cfg.fogColor, cfg.fogDensity);
    options.scene.add(this.follow, this.structures, this.windows);
    this.apply();
  }

  /** 把設定套用到 uniform、霧、剪影顏色（調參面板 onChange 呼叫；每畫面也會更新便宜的部分）。 */
  apply(): void {
    const cfg = this.config;
    const u = this.dome.material.uniforms;
    (u.uZenith!.value as THREE.Color).setHex(cfg.zenith);
    (u.uHorizon!.value as THREE.Color).setHex(cfg.horizon);
    (u.uGround!.value as THREE.Color).setHex(cfg.ground);
    (u.uBand!.value as THREE.Color).setHex(cfg.bandColor);
    u.uPower!.value = cfg.gradientPower;
    u.uBandStrength!.value = cfg.bandStrength;
    u.uBandSharpness!.value = cfg.bandSharpness;
    const su = this.stars.material.uniforms;
    su.uSize!.value = cfg.starSize;
    su.uTwinkle!.value = cfg.starTwinkle;
    su.uBrightness!.value = cfg.starBrightness;
    this.fog.color.setHex(cfg.fogColor);
    this.fog.density = cfg.fogDensity;
    const scene = this.options.scene;
    scene.fog = this.fog;
    if (!(scene.background instanceof THREE.Color)) scene.background = new THREE.Color();
    (scene.background as THREE.Color).setHex(cfg.horizon);
    this.windows.material.color.setScalar(cfg.windowIntensity);
    this.applyHaze();
  }

  private applyHaze(): void {
    const cfg = this.config;
    const key = `${cfg.structureColor}:${cfg.horizon}:${cfg.fogColor}:${cfg.structureHazeLow}:${cfg.structureHazeHigh}`;
    if (key === this.hazeKey) return;
    this.hazeKey = key;
    const attr = this.structures.geometry.getAttribute('color') as THREE.BufferAttribute;
    const arr = attr.array as Float32Array;
    const base = new THREE.Color(cfg.structureColor);
    const haze = new THREE.Color(cfg.horizon).lerp(new THREE.Color(cfg.fogColor), 0.5);
    const c = new THREE.Color();
    for (let i = 0; i < this.heights.length; i++) {
      const t = this.heights[i]!;
      const k = cfg.structureHazeLow + (cfg.structureHazeHigh - cfg.structureHazeLow) * t;
      c.copy(base).lerp(haze, k);
      // baseColors 保留每段梁的明暗變化。
      const shade = this.baseColors[i * 3]!;
      arr[i * 3] = c.r * shade;
      arr[i * 3 + 1] = c.g * shade;
      arr[i * 3 + 2] = c.b * shade;
    }
    attr.needsUpdate = true;
  }

  render(_alpha: number, frame: Readonly<FrameInfo>): void {
    this.time += frame.realDt;
    this.follow.position.copy(this.options.camera.position);
    const su = this.stars.material.uniforms;
    su.uTime!.value = this.time % 1000;
    su.uPixelRatio!.value = this.options.getPixelRatio?.() ?? 1;
  }

  /** 所有材質（預熱用）。 */
  materials(): THREE.Material[] {
    return [this.dome.material, this.stars.material, this.structures.material, this.windows.material];
  }

  dispose(): void {
    this.follow.removeFromParent();
    this.structures.removeFromParent();
    this.windows.removeFromParent();
    for (const o of [this.dome, this.stars, this.structures, this.windows]) {
      o.geometry.dispose();
      o.material.dispose();
    }
    if (this.options.scene.fog === this.fog) this.options.scene.fog = null;
  }
}

/** 把巨構資料轉成兩個合併幾何（結構：頂點色 = 明暗，heights = 0..1 的相對高度；窗格：頂點色 = 色別）。 */
export function buildMegastructureGeometry(data: MegastructureData): {
  structure: THREE.BufferGeometry;
  windows: THREE.BufferGeometry;
  heights: Float32Array;
} {
  const parts: THREE.BufferGeometry[] = [];
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const p = new THREE.Vector3();
  const one = new THREE.Vector3(1, 1, 1);
  const rng = new Rng(data.beams.length * 7919);
  for (const b of data.beams) {
    const g = new THREE.BoxGeometry(b.size[0], b.size[1], b.size[2]);
    g.deleteAttribute('uv');
    g.deleteAttribute('normal');
    q.set(b.quat[0], b.quat[1], b.quat[2], b.quat[3]);
    p.set(b.center[0], b.center[1], b.center[2]);
    g.applyMatrix4(m.compose(p, q, one));
    const shade = 0.75 + rng.float() * 0.5;
    const count = g.getAttribute('position').count;
    const col = new Float32Array(count * 3).fill(shade);
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    parts.push(g);
  }
  const structure = parts.length > 0 ? mergeGeometries(parts, false)! : new THREE.BufferGeometry();
  for (const g of parts) g.dispose();
  const pos = structure.getAttribute('position') as THREE.BufferAttribute | undefined;
  const heights = new Float32Array(pos ? pos.count : 0);
  if (pos) {
    const span = Math.max(1e-3, data.maxY - data.minY);
    for (let i = 0; i < pos.count; i++) heights[i] = Math.min(1, Math.max(0, (pos.getY(i) - data.minY) / span));
  }
  if (!structure.getAttribute('color')) structure.setAttribute('color', new THREE.BufferAttribute(new Float32Array(0), 3));
  structure.computeBoundingSphere();

  const n = data.windows.length;
  const wp = new Float32Array(n * 4 * 3);
  const wc = new Float32Array(n * 4 * 3);
  const wi = new Uint32Array(n * 6);
  const right = new THREE.Vector3();
  const up = new THREE.Vector3();
  const nrm = new THREE.Vector3();
  const c = new THREE.Color();
  data.windows.forEach((w, i) => {
    nrm.set(w.normal[0], w.normal[1], w.normal[2]);
    up.set(w.up[0], w.up[1], w.up[2]);
    right.crossVectors(up, nrm).normalize();
    c.setHex(TINTS[w.tint] ?? TINTS[0]!);
    const corners = [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ];
    corners.forEach(([sx, sy], k) => {
      const vi = i * 4 + k;
      wp[vi * 3] = w.center[0] + right.x * sx! * w.w * 0.5 + up.x * sy! * w.h * 0.5;
      wp[vi * 3 + 1] = w.center[1] + right.y * sx! * w.w * 0.5 + up.y * sy! * w.h * 0.5;
      wp[vi * 3 + 2] = w.center[2] + right.z * sx! * w.w * 0.5 + up.z * sy! * w.h * 0.5;
      wc[vi * 3] = c.r;
      wc[vi * 3 + 1] = c.g;
      wc[vi * 3 + 2] = c.b;
    });
    const b = i * 4;
    wi.set([b, b + 1, b + 2, b, b + 2, b + 3], i * 6);
  });
  const windows = new THREE.BufferGeometry();
  windows.setAttribute('position', new THREE.BufferAttribute(wp, 3));
  windows.setAttribute('color', new THREE.BufferAttribute(wc, 3));
  windows.setIndex(new THREE.BufferAttribute(wi, 1));
  windows.computeBoundingSphere();
  return { structure, windows, heights };
}
