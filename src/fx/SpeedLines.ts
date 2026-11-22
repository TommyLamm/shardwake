// 速度線（M1-08）：水平速度超過 minSpeed 時淡入的螢幕空間放射狀線條。
// 以全螢幕四邊形實作（頂點著色器直接輸出裁切座標，不受相機影響；不需後處理管線），
// 加法混合、不做深度測試、最後繪製；強度為 0 時隱藏（不多一個 draw call）。M1-09 加入後處理後可改成 Effect。
// 只讀玩家的水平速度與設定，不影響模擬；強度以畫面的模擬 dt 平滑（暫停時凍結）。
import * as THREE from 'three';
import { SystemOrder, type FrameInfo, type GameSystem } from '@/core/Game';
import { damp } from '@/core/math';
import { speedLinesTarget } from '@/camera/cameraMath';
import type { ConfigSchema } from '@/debug/DebugPanel';

export interface SpeedLinesConfig {
  /** 水平速度（m/s）：minSpeed 開始淡入，fullSpeed 時滿強度。 */
  minSpeed: number;
  fullSpeed: number;
  /** 滿強度時的不透明度。 */
  maxOpacity: number;
  /** 淡入淡出（damp 的 lambda，1/s）。 */
  fade: number;
  /** 一圈的線條槽數與實際出現的比例。 */
  count: number;
  fill: number;
  /** 線條寬度（槽寬比例）。 */
  width: number;
  /** 中心清空的半徑（畫面高度的一半為 1）與淡入範圍。 */
  innerRadius: number;
  innerFeather: number;
  /** 線段長度與往外流動的速度（每秒）。 */
  length: number;
  flowSpeed: number;
  color: number;
}

export const SPEED_LINES_CONFIG: SpeedLinesConfig = {
  minSpeed: 14,
  fullSpeed: 22,
  maxOpacity: 0.35,
  fade: 6,
  count: 96,
  fill: 0.45,
  width: 0.18,
  innerRadius: 0.55,
  innerFeather: 0.6,
  length: 0.45,
  flowSpeed: 2.2,
  color: 0xc8f6ff,
};

export const SPEED_LINES_PANEL: ConfigSchema<SpeedLinesConfig> = {
  minSpeed: { label: '起點 m/s', min: 0, max: 40, step: 0.5, description: '水平速度超過這裡才淡入' },
  fullSpeed: { label: '滿值 m/s', min: 1, max: 60, step: 0.5 },
  maxOpacity: { label: '最大不透明度', min: 0, max: 1, step: 0.01 },
  fade: { label: '淡入淡出 1/s', min: 0.5, max: 40, step: 0.5 },
  count: { label: '槽數', min: 8, max: 256, step: 1 },
  fill: { label: '出現比例', min: 0, max: 1, step: 0.01 },
  width: { label: '線寬', min: 0.01, max: 0.5, step: 0.01 },
  innerRadius: { label: '中心半徑', min: 0, max: 2, step: 0.01 },
  innerFeather: { label: '中心淡入', min: 0.01, max: 2, step: 0.01 },
  length: { label: '線段長度', min: 0.05, max: 2, step: 0.01 },
  flowSpeed: { label: '流動速度', min: 0, max: 10, step: 0.1 },
  color: { label: '顏色', params: { view: 'color' } },
};

const VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const FRAGMENT = /* glsl */ `
uniform float uIntensity;
uniform float uTime;
uniform float uAspect;
uniform float uCount;
uniform float uFill;
uniform float uWidth;
uniform float uInner;
uniform float uFeather;
uniform float uLength;
uniform float uFlow;
uniform vec3 uColor;
varying vec2 vUv;

float hash(float n) { return fract(sin(n * 127.1) * 43758.5453123); }

void main() {
  vec2 p = (vUv - 0.5) * 2.0;
  p.x *= uAspect;
  float r = length(p);
  float a = atan(p.y, p.x) / 6.28318530718 + 0.5;
  float slot = a * uCount;
  float id = floor(slot);
  float f = fract(slot);
  float h1 = hash(id);
  float h2 = hash(id + 31.7);
  float h3 = hash(id + 77.3);
  float on = step(1.0 - uFill, h1);
  float w = uWidth * (0.5 + h2);
  float across = 1.0 - smoothstep(0.0, w, abs(f - 0.5));
  float s = fract(r / max(uLength, 1e-3) * 0.5 - uTime * uFlow * (0.6 + 0.8 * h3) + h2 * 7.0);
  float along = smoothstep(0.0, 0.25, s) * (1.0 - smoothstep(0.55, 1.0, s));
  float mask = smoothstep(uInner, uInner + uFeather, r);
  float alpha = on * across * along * mask * uIntensity;
  gl_FragColor = vec4(uColor * alpha, alpha);
  #include <colorspace_fragment>
}
`;

export interface SpeedLinesOptions {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  /** 玩家水平速度（m/s）；沒有玩家（除錯飛行）時回傳 null。 */
  getSpeed: () => number | null;
  /** 玩家設定「速度線」。 */
  isEnabled: () => boolean;
  config?: SpeedLinesConfig;
}

export class SpeedLines implements GameSystem {
  readonly name = 'speedLines';
  readonly order = SystemOrder.fx;
  readonly config: SpeedLinesConfig;
  readonly mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  /** 目前強度 0..1（乘 maxOpacity 前）。 */
  intensity = 0;
  private time = 0;
  private readonly color = new THREE.Color();

  constructor(private readonly options: SpeedLinesOptions) {
    this.config = options.config ?? SPEED_LINES_CONFIG;
    const material = new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: {
        uIntensity: { value: 0 },
        uTime: { value: 0 },
        uAspect: { value: 1 },
        uCount: { value: 0 },
        uFill: { value: 0 },
        uWidth: { value: 0 },
        uInner: { value: 0 },
        uFeather: { value: 0 },
        uLength: { value: 0 },
        uFlow: { value: 0 },
        uColor: { value: new THREE.Color() },
      },
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
    this.mesh.name = 'speedLines';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10000;
    this.mesh.visible = false;
    options.scene.add(this.mesh);
  }

  /** 推進 dt（模擬秒）並更新 uniform；無頭測試直接呼叫。 */
  advance(dt: number): void {
    const cfg = this.config;
    const speed = this.options.getSpeed();
    const enabled = this.options.isEnabled() && speed !== null;
    if (!enabled) this.intensity = 0;
    else this.intensity = damp(this.intensity, speedLinesTarget(speed, cfg.minSpeed, cfg.fullSpeed), cfg.fade, dt);
    this.time += Math.max(0, dt);
    const opacity = this.intensity * cfg.maxOpacity;
    this.mesh.visible = opacity > 1e-3;
    if (!this.mesh.visible) return;
    const u = this.mesh.material.uniforms;
    u.uIntensity!.value = opacity;
    u.uTime!.value = this.time % 1000;
    u.uAspect!.value = this.options.camera.aspect;
    u.uCount!.value = Math.max(1, Math.round(cfg.count));
    u.uFill!.value = cfg.fill;
    u.uWidth!.value = cfg.width;
    u.uInner!.value = cfg.innerRadius;
    u.uFeather!.value = cfg.innerFeather;
    u.uLength!.value = cfg.length;
    u.uFlow!.value = cfg.flowSpeed;
    (u.uColor!.value as THREE.Color).copy(this.color.setHex(cfg.color));
  }

  render(_alpha: number, frame: Readonly<FrameInfo>): void {
    this.advance(frame.dt);
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
