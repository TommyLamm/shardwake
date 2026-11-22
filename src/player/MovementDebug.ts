// 移動除錯顯示（M1-06）：調參面板「移動/除錯顯示」開啟時，繪製這一步的牆面偵測射線與結果。
//   灰：沒打到；綠：符合條件（可跑的牆、可攀的邊緣）；紅：打到但不符合；黃：攀爬目標（站姿高度）；
//   青：跑牆中的牆面法線。
// 只在開啟時讓 PlayerController 記錄偵測（WallSensor.log），關閉時不額外配置記憶體。
import * as THREE from 'three';
import { SystemOrder, type GameSystem } from '@/core/Game';
import type { DebugPanel } from '@/debug/DebugPanel';
import type { PlayerController } from '@/player/PlayerController';
import { MoveStateId } from '@/player/states';
import { ProbeKind, ProbeLog } from '@/player/WallSensor';

export interface MovementDebugConfig {
  showProbes: boolean;
}

export const MOVEMENT_DEBUG_CONFIG: MovementDebugConfig = { showProbes: false };

const KIND_COLORS: Record<number, number> = {
  [ProbeKind.miss]: 0x6b7a90,
  [ProbeKind.valid]: 0x3dff7a,
  [ProbeKind.invalid]: 0xff5a3d,
  [ProbeKind.target]: 0xffd040,
};
const NORMAL_COLOR = 0x39e6ff;
/** 偵測線段 + 牆面法線 1 條。 */
const MAX_SEGMENTS = ProbeLog.capacity + 1;

export interface MovementDebugOptions {
  scene: THREE.Object3D;
  player: PlayerController;
  panel?: DebugPanel;
  config?: MovementDebugConfig;
}

export class MovementDebug implements GameSystem {
  readonly name = 'movementDebug';
  /** 在渲染之前更新線段（fx 階段）。 */
  readonly order = SystemOrder.fx;
  readonly config: MovementDebugConfig;
  private lines: THREE.LineSegments | null = null;
  private positions: Float32Array | null = null;
  private colors: Float32Array | null = null;
  private lastRevision = -1;
  private readonly color = new THREE.Color();

  constructor(private readonly options: MovementDebugOptions) {
    this.config = options.config ?? MOVEMENT_DEBUG_CONFIG;
    options.panel?.bindConfig(
      '移動/除錯顯示',
      this.config,
      { showProbes: { label: '偵測射線', description: '牆面偵測（跑牆）與邊緣偵測（攀爬）；綠 = 符合、紅 = 不符合、黃 = 攀爬目標' } },
      { onChange: () => this.refresh() },
    );
    this.refresh();
  }

  /** 線段數（測試用）。 */
  get segmentCount(): number {
    return this.lines ? this.lines.geometry.drawRange.count / 2 : 0;
  }

  /** 依 config.showProbes 開關記錄與顯示（面板改值時自動呼叫）。 */
  refresh(): void {
    const on = this.config.showProbes;
    this.options.player.walls.log.enabled = on;
    if (on && !this.lines) this.create();
    if (this.lines) this.lines.visible = on;
    this.lastRevision = -1;
  }

  private create(): void {
    this.positions = new Float32Array(MAX_SEGMENTS * 6);
    this.colors = new Float32Array(MAX_SEGMENTS * 6);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.colors, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setDrawRange(0, 0);
    const mat = new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true, opacity: 0.95, fog: false });
    const seg = new THREE.LineSegments(geo, mat);
    seg.name = 'debug:movementProbes';
    seg.frustumCulled = false;
    seg.renderOrder = 30;
    this.lines = seg;
    this.options.scene.add(seg);
  }

  render(): void {
    if (!this.config.showProbes || !this.lines || !this.positions || !this.colors) return;
    const player = this.options.player;
    const log = player.walls.log;
    const wallRunning = player.machine.is(MoveStateId.wallRun);
    // 偵測紀錄沒變、也不在跑牆（法線不用跟著動）時不重建。
    if (log.revision === this.lastRevision && !wallRunning) return;
    this.lastRevision = log.revision;
    const pos = this.positions;
    const col = this.colors;
    let n = 0;
    const put = (ax: number, ay: number, az: number, bx: number, by: number, bz: number, hex: number): void => {
      const o = n * 6;
      pos[o] = ax;
      pos[o + 1] = ay;
      pos[o + 2] = az;
      pos[o + 3] = bx;
      pos[o + 4] = by;
      pos[o + 5] = bz;
      this.color.setHex(hex);
      col[o] = col[o + 3] = this.color.r;
      col[o + 1] = col[o + 4] = this.color.g;
      col[o + 2] = col[o + 5] = this.color.b;
      n++;
    };
    const d = log.data;
    for (let i = 0; i < log.count && n < MAX_SEGMENTS; i++) {
      const o = i * 7;
      put(d[o]!, d[o + 1]!, d[o + 2]!, d[o + 3]!, d[o + 4]!, d[o + 5]!, KIND_COLORS[d[o + 6]!] ?? 0xffffff);
    }
    if (wallRunning && n < MAX_SEGMENTS) {
      const p = player.position;
      const y = p.y + player.height / 2;
      const w = player.wallNormal;
      put(p.x - w.x * 0.4, y, p.z - w.z * 0.4, p.x + w.x * 0.8, y, p.z + w.z * 0.8, NORMAL_COLOR);
    }
    const geo = this.lines.geometry;
    geo.setDrawRange(0, n * 2);
    (geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (geo.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
  }

  dispose(): void {
    this.options.player.walls.log.enabled = false;
    if (!this.lines) return;
    this.lines.removeFromParent();
    this.lines.geometry.dispose();
    (this.lines.material as THREE.Material).dispose();
    this.lines = null;
  }
}
