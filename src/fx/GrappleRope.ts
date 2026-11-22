// 抓鉤繩索視覺（M1-07）：從手部（相機右下方）連到鉤爪。
//   發射中：沿線的正弦波，隨飛行時間逐漸拉直（straightenTime 內振幅降到 0）。
//   附著後：整條繩子做衰減的彈性抖動（駐波，jitterFrequency／jitterDecay）。
//   收回中：鬆弛的波形跟著鉤爪飛回。
// 只讀 player.abilities.hook（鉤爪位置、階段、階段時間），不影響模擬；鉤爪位置在固定步之間插值。
import * as THREE from 'three';
import { SystemOrder, type GameSystem } from '@/core/Game';
import type { DebugPanel } from '@/debug/DebugPanel';
import type { GrapplePhase } from '@/player/Grapple';
import type { PlayerController } from '@/player/PlayerController';

export interface GrappleRopeConfig {
  /** 繩索分段數。 */
  segments: number;
  /** 顏色（0xRRGGBB）。 */
  color: number;
  /** 手部位置（相機座標：右、下、前，m）。 */
  handRight: number;
  handDown: number;
  handForward: number;
  /** 發射時的波形振幅（m）與沿線波數。 */
  waveAmplitude: number;
  waveCount: number;
  /** 發射後多久拉直（s）。 */
  straightenTime: number;
  /** 附著後的彈性抖動：振幅（m）、頻率（Hz）、衰減（1/s）。 */
  jitterAmplitude: number;
  jitterFrequency: number;
  jitterDecay: number;
  /** 收回時的鬆弛振幅（m）。 */
  retractAmplitude: number;
}

export const GRAPPLE_ROPE_CONFIG: GrappleRopeConfig = {
  segments: 40,
  color: 0x66f0ff,
  handRight: 0.22,
  handDown: 0.26,
  handForward: 0.35,
  waveAmplitude: 0.45,
  waveCount: 3.5,
  straightenTime: 0.22,
  jitterAmplitude: 0.15,
  jitterFrequency: 8,
  jitterDecay: 6,
  retractAmplitude: 0.25,
};

/** 繩索偏移的形狀參數：amplitude（m）、waves（0 = 單一弧形的駐波）、phase（弧度）。 */
export interface RopeShape {
  amplitude: number;
  waves: number;
  phase: number;
}

/** 依鉤爪階段與階段時間（s）算出繩索形狀（純函式）。 */
export function ropeShape(phase: GrapplePhase, phaseTime: number, cfg: GrappleRopeConfig, out: RopeShape): RopeShape {
  out.phase = 0;
  out.waves = cfg.waveCount;
  switch (phase) {
    case 'flying': {
      const k = cfg.straightenTime > 0 ? Math.max(0, 1 - phaseTime / cfg.straightenTime) : 0;
      out.amplitude = cfg.waveAmplitude * k * k;
      // 波往鉤爪方向前進。
      out.phase = -phaseTime * 40;
      break;
    }
    case 'attached':
      out.waves = 0;
      out.amplitude = cfg.jitterAmplitude * Math.exp(-cfg.jitterDecay * phaseTime) * Math.sin(2 * Math.PI * cfg.jitterFrequency * phaseTime);
      break;
    case 'retracting':
      out.amplitude = cfg.retractAmplitude;
      out.phase = phaseTime * 30;
      break;
    default:
      out.amplitude = 0;
  }
  return out;
}

const _dir = new THREE.Vector3();
const _side = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

/**
 * 在 a→b 之間填入 segments + 1 個點（純函式）：直線 ＋ side 方向的偏移
 * amplitude × sin(πt) × (waves > 0 ? sin(2π waves t + phase) : 1)。兩端點不偏移。
 */
export function ropePoints(
  out: Float32Array,
  segments: number,
  a: Readonly<THREE.Vector3>,
  b: Readonly<THREE.Vector3>,
  shape: Readonly<RopeShape>,
): void {
  _dir.subVectors(b, a);
  _side.crossVectors(_dir, _up);
  if (_side.lengthSq() < 1e-8) _side.set(1, 0, 0);
  else _side.normalize();
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const env = Math.sin(Math.PI * t);
    const wave = shape.waves > 0 ? Math.sin(2 * Math.PI * shape.waves * t + shape.phase) : 1;
    const off = shape.amplitude * env * wave;
    out[i * 3] = a.x + _dir.x * t + _side.x * off;
    out[i * 3 + 1] = a.y + _dir.y * t + _side.y * off;
    out[i * 3 + 2] = a.z + _dir.z * t + _side.z * off;
  }
}

export interface GrappleRopeOptions {
  scene: THREE.Object3D;
  player: PlayerController;
  /** 手部位置依相機方向計算（相機位置與旋轉在 fx 階段之前已更新）。 */
  camera: THREE.Camera;
  panel?: DebugPanel;
  config?: GrappleRopeConfig;
}

export class GrappleRope implements GameSystem {
  readonly name = 'grappleRope';
  readonly order = SystemOrder.fx;
  readonly config: GrappleRopeConfig;
  readonly line: THREE.Line;
  readonly head: THREE.Mesh;
  private positions: Float32Array;
  private readonly material: THREE.LineBasicMaterial;
  private readonly headMaterial: THREE.MeshBasicMaterial;
  private readonly hand = new THREE.Vector3();
  private readonly hook = new THREE.Vector3();
  private readonly shape: RopeShape = { amplitude: 0, waves: 0, phase: 0 };

  constructor(private readonly options: GrappleRopeOptions) {
    this.config = options.config ?? GRAPPLE_ROPE_CONFIG;
    this.positions = new Float32Array((this.config.segments + 1) * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    this.material = new THREE.LineBasicMaterial({ color: this.config.color });
    this.line = new THREE.Line(geo, this.material);
    this.line.frustumCulled = false;
    this.line.visible = false;
    this.line.name = 'grapple-rope';
    this.headMaterial = new THREE.MeshBasicMaterial({ color: this.config.color });
    this.head = new THREE.Mesh(new THREE.OctahedronGeometry(0.12), this.headMaterial);
    this.head.visible = false;
    this.head.name = 'grapple-hook';
    options.scene.add(this.line, this.head);
    options.panel?.bindConfig(
      '移動/抓鉤繩索（視覺）',
      this.config,
      {
        segments: { label: '分段數', min: 4, max: 128, step: 1 },
        color: { label: '顏色', params: { view: 'color' } },
        handRight: { label: '手部 右', min: -1, max: 1, step: 0.01, description: 'm（相機座標）' },
        handDown: { label: '手部 下', min: -1, max: 1, step: 0.01 },
        handForward: { label: '手部 前', min: 0, max: 2, step: 0.01 },
        waveAmplitude: { label: '發射波振幅', min: 0, max: 2, step: 0.01, description: 'm' },
        waveCount: { label: '波數', min: 0, max: 12, step: 0.5 },
        straightenTime: { label: '拉直時間', min: 0, max: 1, step: 0.01, description: 's' },
        jitterAmplitude: { label: '抖動振幅', min: 0, max: 1, step: 0.01, description: 'm' },
        jitterFrequency: { label: '抖動頻率', min: 0, max: 30, step: 0.5, description: 'Hz' },
        jitterDecay: { label: '抖動衰減', min: 0, max: 30, step: 0.5, description: '1/s' },
        retractAmplitude: { label: '收回振幅', min: 0, max: 2, step: 0.01, description: 'm' },
      },
      { onChange: (key) => this.applyConfig(key) },
    );
  }

  /** 繩索目前是否顯示（測試用）。 */
  get visible(): boolean {
    return this.line.visible;
  }

  /** 第 i 個點（測試用）。 */
  point(i: number, out: THREE.Vector3): THREE.Vector3 {
    return out.set(this.positions[i * 3]!, this.positions[i * 3 + 1]!, this.positions[i * 3 + 2]!);
  }

  render(alpha: number): void {
    const hook = this.options.player.abilities.hook;
    const show = hook.phase !== 'idle' && this.options.player.enabled;
    this.line.visible = show;
    this.head.visible = show;
    if (!show) return;
    const cfg = this.config;
    const cam = this.options.camera;
    cam.updateMatrixWorld();
    this.hand.set(cfg.handRight, -cfg.handDown, -cfg.handForward);
    cam.localToWorld(this.hand);
    if (hook.phase === 'attached') this.hook.copy(hook.anchor);
    else this.hook.lerpVectors(hook.prevPosition, hook.position, alpha);
    ropeShape(hook.phase, hook.phaseTime, cfg, this.shape);
    ropePoints(this.positions, cfg.segments, this.hand, this.hook, this.shape);
    const attr = this.line.geometry.getAttribute('position') as THREE.BufferAttribute;
    attr.needsUpdate = true;
    this.line.geometry.setDrawRange(0, cfg.segments + 1);
    this.head.position.copy(this.hook);
  }

  dispose(): void {
    this.line.removeFromParent();
    this.head.removeFromParent();
    this.line.geometry.dispose();
    this.head.geometry.dispose();
    this.material.dispose();
    this.headMaterial.dispose();
  }

  private applyConfig(key: keyof GrappleRopeConfig): void {
    if (key === 'color') {
      this.material.color.setHex(this.config.color);
      this.headMaterial.color.setHex(this.config.color);
    }
    if (key === 'segments') {
      this.config.segments = Math.max(1, Math.round(this.config.segments));
      this.positions = new Float32Array((this.config.segments + 1) * 3);
      this.line.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    }
  }
}
