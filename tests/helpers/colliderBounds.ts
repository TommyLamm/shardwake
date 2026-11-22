import type RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import type { Physics } from '@/physics/Physics';

/** 用 Rapier debugRender 取得單一碰撞體的線框包圍盒（與網格完全無關的另一條路徑）。 */
export function colliderBounds(physics: Physics, collider: RAPIER.Collider): THREE.Box3 {
  physics.syncQueries();
  const lines = physics.world.debugRender(undefined, (c) => c.handle === collider.handle).vertices;
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  for (let i = 0; i < lines.length; i += 3) box.expandByPoint(v.set(lines[i]!, lines[i + 1]!, lines[i + 2]!));
  return box;
}
