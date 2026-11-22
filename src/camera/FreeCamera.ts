// 自由飛行相機：M1-04 暫用巡視場地；M1-05 起保留為除錯用的穿牆飛行（調參面板「自由相機/啟用」，預設關閉）。
// - 固定步內讀 InputFrame：WASD 沿視線方向飛行、Space 上升、C 下降、Shift（dash 動作）加速。
// - 速度以指數平滑趨近目標（放開就停），位置在固定步積分、渲染時以 alpha 插值。
// - 視角沿用 M1-03 的 yaw／pitch（yaw 0 面向 -Z、正值向左）；鏡頭旋轉由 cameraSystem 套用。
// - 不做碰撞（穿牆），但落入 killVolume 會回到最近檢查點（示範 M1-05 的重生流程）。
import * as THREE from 'three';
import { SystemOrder, type GameSystem } from '@/core/Game';
import { isHeld, type InputFrame } from '@/input/InputFrame';
import type { Vec3Like } from '@/physics/Physics';

export interface FreeCameraConfig {
  /** 一般飛行速度（m/s）。 */
  speed: number;
  /** 按住 Shift 的速度倍率。 */
  boostMultiplier: number;
  /** 速度平滑的時間常數倒數（1/s）；越大越跟手。 */
  responsiveness: number;
  /** 眼睛在腳底上方的高度（傳送到出生點時使用）。 */
  eyeHeight: number;
}

export const FREE_CAMERA_CONFIG: FreeCameraConfig = {
  speed: 14,
  boostMultiplier: 4,
  responsiveness: 10,
  eyeHeight: 1.65,
};

export interface FreeCameraOptions {
  /** 每個固定步的輸入（InputSystem.frame）。 */
  getFrame: () => Readonly<InputFrame>;
  /** 要移動的物件（通常是 PerspectiveCamera）；可省略（無頭測試）。 */
  object?: THREE.Object3D | null;
  config?: FreeCameraConfig;
  /**
   * 每步檢查是否落入 killVolume；回傳重生點（腳底位置、yaw 弧度）時傳送過去。
   * 傳入的是眼睛位置。
   */
  checkRespawn?: (eye: Readonly<Vec3Like>) => { pos: Vec3Like; yaw: number } | null;
  /** 傳送後要求設定視角（yaw、pitch 弧度），例如 input.view.set。 */
  setView?: (yaw: number, pitch: number) => void;
}

/** 由 yaw／pitch 算出前方向量（yaw 0 → -Z；pitch 正值抬頭）。 */
export function lookDirection(yaw: number, pitch: number, out: THREE.Vector3): THREE.Vector3 {
  const cp = Math.cos(pitch);
  return out.set(-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp);
}

/** 水平右方向量。 */
export function rightDirection(yaw: number, out: THREE.Vector3): THREE.Vector3 {
  return out.set(Math.cos(yaw), 0, -Math.sin(yaw));
}

const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _wish = new THREE.Vector3();

export class FreeCamera implements GameSystem {
  readonly name = 'freeCamera';
  readonly order = SystemOrder.player;

  /** 目前（這一步結束）的眼睛位置。 */
  readonly position = new THREE.Vector3();
  /** 上一步的位置（插值用）。 */
  readonly previous = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();
  /** 插值後的位置（render 時更新）。 */
  readonly rendered = new THREE.Vector3();
  enabled = true;
  readonly config: FreeCameraConfig;

  constructor(private readonly options: FreeCameraOptions) {
    this.config = options.config ?? FREE_CAMERA_CONFIG;
  }

  /** 傳送到腳底位置 feet（自動加眼高），面向 yaw（弧度）；pitch 預設 0。 */
  teleport(feet: Readonly<Vec3Like>, yaw?: number, pitch = 0): void {
    this.position.set(feet.x, feet.y + this.config.eyeHeight, feet.z);
    this.previous.copy(this.position);
    this.rendered.copy(this.position);
    this.velocity.set(0, 0, 0);
    if (yaw !== undefined) this.options.setView?.(yaw, pitch);
    this.options.object?.position.copy(this.position);
  }

  fixedUpdate(dt: number): void {
    this.previous.copy(this.position);
    if (!this.enabled) return;
    const f = this.options.getFrame();
    const cfg = this.config;
    lookDirection(f.yaw, f.pitch, _fwd);
    rightDirection(f.yaw, _right);
    _wish.set(0, 0, 0).addScaledVector(_fwd, f.move.y).addScaledVector(_right, f.move.x);
    if (isHeld(f, 'jump')) _wish.y += 1;
    if (isHeld(f, 'crouch')) _wish.y -= 1;
    const len = _wish.length();
    if (len > 1) _wish.multiplyScalar(1 / len);
    const speed = cfg.speed * (isHeld(f, 'dash') ? cfg.boostMultiplier : 1);
    _wish.multiplyScalar(speed);
    // 指數平滑：與步長無關。
    const k = 1 - Math.exp(-cfg.responsiveness * dt);
    this.velocity.lerp(_wish, k);
    if (this.velocity.lengthSq() < 1e-8) this.velocity.set(0, 0, 0);
    this.position.addScaledVector(this.velocity, dt);
    const respawn = this.options.checkRespawn?.(this.position);
    if (respawn) this.teleport(respawn.pos, respawn.yaw);
  }

  render(alpha: number): void {
    // 停用時不動相機（相機交給玩家控制器）。
    if (!this.enabled) return;
    this.rendered.lerpVectors(this.previous, this.position, alpha);
    this.options.object?.position.copy(this.rendered);
  }
}
