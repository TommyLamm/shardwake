// M1-01 的開機場景（發光方塊 + 格線），改寫成 Game 系統：
// 旋轉在固定步內積分（只在 playing 時前進），渲染時以 alpha 在上一步與這一步之間插值。
// M1-04 換成灰盒訓練場後移除。
import * as THREE from 'three';
import type { BootSceneConfig } from '@/bootConfig';
import type { FrameInfo, GameSystem } from '@/core/Game';
import { SystemOrder } from '@/core/Game';
import { lerp } from '@/core/math';

export class BootScene implements GameSystem {
  readonly name = 'bootScene';
  readonly order = SystemOrder.world;
  readonly scene = new THREE.Scene();
  private readonly cube: THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>;
  private readonly halo: THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial>;
  private readonly disposables: { dispose(): void }[] = [];
  /** 模擬狀態：上一步與目前的旋轉角。 */
  private readonly prev = { x: 0, y: 0 };
  private readonly curr = { x: 0, y: 0 };

  constructor(private readonly cfg: BootSceneConfig) {
    const scene = this.scene;
    scene.fog = new THREE.Fog(cfg.clearColor, 6, 30);
    scene.add(new THREE.HemisphereLight(0x5a7a9a, 0x05080d, 0.6));
    const key = new THREE.PointLight(cfg.glowColor, cfg.glowLightIntensity, 12, 2);
    key.position.set(0, 0.6, 0);
    scene.add(key);

    const cubeGeo = new THREE.BoxGeometry(1, 1, 1);
    const cubeMat = new THREE.MeshStandardMaterial({
      color: 0x0b1a22,
      emissive: cfg.glowColor,
      emissiveIntensity: cfg.emissiveIntensity,
      metalness: 0.3,
      roughness: 0.35,
    });
    this.cube = new THREE.Mesh(cubeGeo, cubeMat);
    this.cube.position.y = 0.6;
    const edgesGeo = new THREE.EdgesGeometry(cubeGeo);
    const edgesMat = new THREE.LineBasicMaterial({ color: 0xe6fdff });
    this.cube.add(new THREE.LineSegments(edgesGeo, edgesMat));
    // 簡易光暈殼：加法混色的背面放大方塊（正式 Bloom 在 M1-09）。
    const haloMat = new THREE.MeshBasicMaterial({
      color: cfg.glowColor,
      transparent: true,
      opacity: cfg.haloOpacity,
      blending: THREE.AdditiveBlending,
      side: THREE.BackSide,
      depthWrite: false,
    });
    this.halo = new THREE.Mesh(cubeGeo, haloMat);
    this.halo.scale.setScalar(cfg.haloScale);
    this.cube.add(this.halo);
    scene.add(this.cube);

    const grid = new THREE.GridHelper(40, 40, cfg.glowColor, 0x1b2a36);
    scene.add(grid);
    this.disposables.push(cubeGeo, cubeMat, edgesGeo, edgesMat, haloMat, grid.geometry, grid.material as THREE.Material);
  }

  fixedUpdate(dt: number): void {
    this.prev.x = this.curr.x;
    this.prev.y = this.curr.y;
    this.curr.x += this.cfg.spinSpeed.x * dt;
    this.curr.y += this.cfg.spinSpeed.y * dt;
  }

  /** 調參面板改了外觀數值後套用到材質。 */
  applyLook(): void {
    this.cube.material.emissiveIntensity = this.cfg.emissiveIntensity;
    this.halo.material.opacity = this.cfg.haloOpacity;
    this.halo.scale.setScalar(this.cfg.haloScale);
  }

  render(alpha: number, _frame: Readonly<FrameInfo>): void {
    this.cube.rotation.x = lerp(this.prev.x, this.curr.x, alpha);
    this.cube.rotation.y = lerp(this.prev.y, this.curr.y, alpha);
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }
}
