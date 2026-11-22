// 抓鉤的鉤爪（M1-07）：發射、飛行（逐步 raycast）、附著、落空收回，以及準星輔助（視線 raycast）。
//
// 階段：idle → flying（以 grappleHookSpeed 沿視線前進，每步對這一段做 raycast）
//         ├─ 打到 grappleable 的靜態表面 → attached（PlayerController 進入 Grapple 狀態）
//         └─ 打到不可勾的表面／超出射程／飛行中放開 → retracting（落空，冷卻 grappleMissCooldown）
//       attached → （脫鉤）retracting → idle
// 收回只是視覺（鉤爪以 RETRACT_SPEED 飛回玩家）；冷卻結束就能再發射，收回中也可以。
// 位置都是世界座標；prevPosition 給繩索視覺插值。
import * as THREE from 'three';
import { QueryMask } from '@/physics/groups';
import type { Physics, Vec3Like } from '@/physics/Physics';

export type GrapplePhase = 'idle' | 'flying' | 'attached' | 'retracting';
export type GrappleMissReason = 'range' | 'surface' | 'cancel';
export type GrappleFlightResult = 'attached' | GrappleMissReason | null;

/** 鉤爪收回的速度（m/s，視覺用）。 */
export const GRAPPLE_RETRACT_SPEED = 160;

export class GrappleHook {
  phase: GrapplePhase = 'idle';
  /** 發射點（相機）與方向（單位向量）。 */
  readonly origin = new THREE.Vector3();
  readonly dir = new THREE.Vector3(0, 0, -1);
  /** 鉤爪目前位置與上一步位置。 */
  readonly position = new THREE.Vector3();
  readonly prevPosition = new THREE.Vector3();
  /** 錨點與表面法線（附著時有效）。 */
  readonly anchor = new THREE.Vector3();
  readonly anchorNormal = new THREE.Vector3(0, 1, 0);
  /** 已飛行距離（m）與時間（s）。 */
  traveled = 0;
  flightTime = 0;
  /** 進入目前階段後的時間（s）。 */
  phaseTime = 0;
  /** 發射時到錨點的距離（attach 事件用）。 */
  attachDistance = 0;
  /** 繩長（只能縮短）、附著時間、是否曾經朝錨點接近。 */
  ropeLength = 0;
  attachedTime = 0;
  approached = false;
  /** 落空原因（retracting 時有效；脫鉤收回為 null）。 */
  missReason: GrappleMissReason | null = null;
  /** 準星輔助。 */
  aimAvailable = false;
  aimDistance = 0;

  private setPhase(p: GrapplePhase): void {
    this.phase = p;
    this.phaseTime = 0;
  }

  reset(): void {
    this.setPhase('idle');
    this.traveled = 0;
    this.flightTime = 0;
    this.attachedTime = 0;
    this.approached = false;
    this.missReason = null;
  }

  /** 從 origin 沿 dir 發射。 */
  fire(origin: Readonly<Vec3Like>, dir: Readonly<Vec3Like>): void {
    this.origin.set(origin.x, origin.y, origin.z);
    this.dir.set(dir.x, dir.y, dir.z).normalize();
    this.position.copy(this.origin);
    this.prevPosition.copy(this.origin);
    this.traveled = 0;
    this.flightTime = 0;
    this.missReason = null;
    this.setPhase('flying');
  }

  /**
   * 飛行一步：沿方向前進 speed × dt（不超過射程），對這段做 raycast（只查靜態世界）。
   * 回傳 'attached'、落空原因，或 null（還在飛）。
   */
  updateFlight(physics: Physics, dt: number, speed: number, range: number): GrappleFlightResult {
    if (this.phase !== 'flying') return null;
    this.phaseTime += dt;
    this.flightTime += dt;
    this.prevPosition.copy(this.position);
    const seg = Math.min(Math.max(0, speed) * dt, Math.max(0, range - this.traveled));
    const hit = seg > 0 ? physics.raycast(this.position, this.dir, seg, QueryMask.world) : null;
    if (hit) {
      this.position.set(hit.point.x, hit.point.y, hit.point.z);
      this.traveled += hit.distance;
      if (hit.surface?.grappleable) {
        this.anchor.copy(this.position);
        this.anchorNormal.set(hit.normal.x, hit.normal.y, hit.normal.z);
        this.attachDistance = this.traveled;
        this.attachedTime = 0;
        this.approached = false;
        this.ropeLength = Number.POSITIVE_INFINITY;
        this.setPhase('attached');
        return 'attached';
      }
      this.miss('surface');
      return 'surface';
    }
    this.position.addScaledVector(this.dir, seg);
    this.traveled += seg;
    if (this.traveled >= range - 1e-6) {
      this.miss('range');
      return 'range';
    }
    return null;
  }

  /** 落空（或取消）：開始收回。 */
  miss(reason: GrappleMissReason): void {
    this.missReason = reason;
    this.setPhase('retracting');
  }

  /** 脫鉤：開始收回。 */
  release(): void {
    this.missReason = null;
    this.setPhase('retracting');
  }

  /** 收回一步：鉤爪飛向 to；到達時回到 idle。 */
  updateRetract(dt: number, to: Readonly<Vec3Like>): void {
    if (this.phase !== 'retracting') {
      if (this.phase === 'attached') {
        this.phaseTime += dt;
        this.prevPosition.copy(this.position);
      }
      return;
    }
    this.phaseTime += dt;
    this.prevPosition.copy(this.position);
    const dx = to.x - this.position.x;
    const dy = to.y - this.position.y;
    const dz = to.z - this.position.z;
    const d = Math.hypot(dx, dy, dz);
    const stepLen = GRAPPLE_RETRACT_SPEED * dt;
    if (d <= stepLen || d < 1e-6) {
      this.position.set(to.x, to.y, to.z);
      this.setPhase('idle');
      return;
    }
    this.position.x += (dx / d) * stepLen;
    this.position.y += (dy / d) * stepLen;
    this.position.z += (dz / d) * stepLen;
  }

  /**
   * 準星輔助：從 origin 沿 dir 做 raycast（射程 range）；命中可勾的表面時 aimAvailable = true。
   * 回傳 aimAvailable 是否改變。
   */
  updateAim(physics: Physics, origin: Readonly<Vec3Like>, dir: Readonly<Vec3Like>, range: number): boolean {
    const hit = range > 0 ? physics.raycast(origin, dir, range, QueryMask.world) : null;
    const available = !!hit && !!hit.surface?.grappleable;
    this.aimDistance = available ? hit.distance : 0;
    const changed = available !== this.aimAvailable;
    this.aimAvailable = available;
    return changed;
  }
}

/** 由 yaw／pitch（弧度；yaw 0 面向 -Z、正值向左，pitch 正值抬頭）算出視線方向（單位向量）。 */
export function viewDirection(yaw: number, pitch: number, out: Vec3Like): Vec3Like {
  const cp = Math.cos(pitch);
  out.x = -Math.sin(yaw) * cp;
  out.y = Math.sin(pitch);
  out.z = -Math.cos(yaw) * cp;
  return out;
}
