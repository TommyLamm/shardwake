// 場景燈光（M1-09）：1 盞方向光（陰影跟隨相機、依陰影貼圖 texel 對齊避免閃爍）＋ 1 盞半球光。
// 燈光數量固定（著色器依燈光數量編譯；增減燈光會讓所有材質重新編譯）。發光條、看板不用點光源，靠 Bloom 表現。
// 畫質：陰影開關改變 sun.castShadow（材質會在下一次渲染時重新編譯，只在切換畫質時發生），陰影貼圖尺寸改變時重建陰影貼圖。
import * as THREE from 'three';
import { SystemOrder, type GameSystem } from '@/core/Game';
import type { QualityPreset } from '@/core/quality';

export interface LightingConfig {
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;
  sunColor: number;
  sunIntensity: number;
  /** 光源方位（度，0 = 北 -Z，順時針）與仰角（度）。 */
  sunAzimuth: number;
  sunElevation: number;
  /** 陰影範圍：相機周圍 ±extent（m），光源距離（m）。 */
  shadowExtent: number;
  shadowDistance: number;
  /** 陰影中心往視線水平方向前移（m），讓前方的陰影範圍較大。 */
  shadowAhead: number;
  shadowBias: number;
  shadowNormalBias: number;
}

export const LIGHTING_CONFIG: LightingConfig = {
  hemiSky: 0x8a96d8,
  hemiGround: 0x22183a,
  hemiIntensity: 1.1,
  sunColor: 0xdce6ff,
  sunIntensity: 2.4,
  sunAzimuth: 215,
  sunElevation: 52,
  shadowExtent: 45,
  shadowDistance: 140,
  shadowAhead: 14,
  shadowBias: -0.0004,
  shadowNormalBias: 0.04,
};

/** 光的行進方向（從光源指向場景，單位向量）。 */
export function sunDirection(azimuthDeg: number, elevationDeg: number, out: THREE.Vector3 = new THREE.Vector3()): THREE.Vector3 {
  const az = THREE.MathUtils.degToRad(azimuthDeg);
  const el = THREE.MathUtils.degToRad(elevationDeg);
  // 光源在 (sin az, tan el, -cos az) 方向的天空；光往反方向行進。
  const c = Math.cos(el);
  return out.set(-Math.sin(az) * c, -Math.sin(el), Math.cos(az) * c).normalize();
}

const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _worldUp = new THREE.Vector3(0, 1, 0);

/**
 * 把陰影中心對齊到光空間的 texel 格（純函式）：投影到垂直光線的平面，兩軸各自取 texel 的整數倍，沿光線方向不變。
 * 陰影相機的 left/right/top/bottom 對稱、貼圖邊長為偶數時，texel 邊界就固定在世界座標上，相機移動時陰影邊緣不閃爍。
 * 軸向與 DirectionalLight 陰影相機的 lookAt（up = +Y）一致。
 */
export function snapToShadowTexels(
  center: Readonly<THREE.Vector3>,
  lightDir: Readonly<THREE.Vector3>,
  texel: number,
  out: THREE.Vector3 = new THREE.Vector3(),
): THREE.Vector3 {
  _fwd.copy(lightDir).normalize();
  // 相機看向 -z（z = -光線方向）；x = up × z，y = z × x。
  const zx = -_fwd.x;
  const zy = -_fwd.y;
  const zz = -_fwd.z;
  _right.set(_worldUp.y * zz - _worldUp.z * zy, _worldUp.z * zx - _worldUp.x * zz, _worldUp.x * zy - _worldUp.y * zx);
  if (_right.lengthSq() < 1e-8) _right.set(1, 0, 0);
  _right.normalize();
  _up.set(zy * _right.z - zz * _right.y, zz * _right.x - zx * _right.z, zx * _right.y - zy * _right.x).normalize();
  const x = center.dot(_right);
  const y = center.dot(_up);
  const z = center.dot(_fwd);
  const sx = texel > 0 ? Math.round(x / texel) * texel : x;
  const sy = texel > 0 ? Math.round(y / texel) * texel : y;
  return out.copy(_right).multiplyScalar(sx).addScaledVector(_up, sy).addScaledVector(_fwd, z);
}

export interface SceneLightingOptions {
  scene: THREE.Scene;
  /** 陰影跟隨的對象（通常是相機）。 */
  camera: THREE.Camera;
  config?: LightingConfig;
  quality: QualityPreset;
}

export class SceneLighting implements GameSystem {
  readonly name = 'lighting';
  // 在鏡頭（800）之後、渲染（1200）之前。
  readonly order = SystemOrder.fx;
  readonly config: LightingConfig;
  readonly hemi: THREE.HemisphereLight;
  readonly sun: THREE.DirectionalLight;
  /** 目前對齊後的陰影中心（除錯用）。 */
  readonly shadowCenter = new THREE.Vector3();
  private readonly dir = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();
  private shadowsOn = false;

  constructor(private readonly options: SceneLightingOptions) {
    this.config = options.config ?? LIGHTING_CONFIG;
    this.hemi = new THREE.HemisphereLight();
    this.hemi.name = 'light:hemi';
    this.sun = new THREE.DirectionalLight();
    this.sun.name = 'light:sun';
    this.sun.target.name = 'light:sun-target';
    options.scene.add(this.hemi, this.sun, this.sun.target);
    this.apply();
    this.applyQuality(options.quality);
  }

  get shadowsEnabled(): boolean {
    return this.shadowsOn;
  }

  /** 套用顏色、強度、方向與陰影偏移（調參面板 onChange）。 */
  apply(): void {
    const cfg = this.config;
    this.hemi.color.setHex(cfg.hemiSky);
    this.hemi.groundColor.setHex(cfg.hemiGround);
    this.hemi.intensity = cfg.hemiIntensity;
    this.sun.color.setHex(cfg.sunColor);
    this.sun.intensity = cfg.sunIntensity;
    sunDirection(cfg.sunAzimuth, cfg.sunElevation, this.dir);
    const cam = this.sun.shadow.camera;
    cam.left = -cfg.shadowExtent;
    cam.right = cfg.shadowExtent;
    cam.top = cfg.shadowExtent;
    cam.bottom = -cfg.shadowExtent;
    cam.near = 1;
    cam.far = cfg.shadowDistance * 2;
    cam.updateProjectionMatrix();
    this.sun.shadow.bias = cfg.shadowBias;
    this.sun.shadow.normalBias = cfg.shadowNormalBias;
  }

  /** 套用畫質（陰影開關與貼圖尺寸）。 */
  applyQuality(q: QualityPreset): void {
    this.shadowsOn = q.shadows;
    this.sun.castShadow = q.shadows;
    const size = q.shadowMapSize;
    if (this.sun.shadow.mapSize.x !== size) {
      this.sun.shadow.mapSize.set(size, size);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
  }

  /** 陰影 texel 邊長（m）。 */
  get texelSize(): number {
    return (this.config.shadowExtent * 2) / this.sun.shadow.mapSize.x;
  }

  render(): void {
    const cfg = this.config;
    const cam = this.options.camera;
    // 視線的水平方向。
    cam.getWorldDirection(this.tmp);
    this.tmp.y = 0;
    if (this.tmp.lengthSq() > 1e-6) this.tmp.normalize().multiplyScalar(cfg.shadowAhead);
    this.tmp.add(cam.position);
    snapToShadowTexels(this.tmp, this.dir, this.texelSize, this.shadowCenter);
    this.sun.target.position.copy(this.shadowCenter);
    this.sun.position.copy(this.shadowCenter).addScaledVector(this.dir, -cfg.shadowDistance);
    this.sun.target.updateMatrixWorld();
    this.sun.updateMatrixWorld();
  }

  dispose(): void {
    this.hemi.removeFromParent();
    this.sun.removeFromParent();
    this.sun.target.removeFromParent();
    this.sun.shadow.map?.dispose();
    this.hemi.dispose();
    this.sun.dispose();
  }
}
