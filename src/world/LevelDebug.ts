// 關卡除錯顯示（調參面板「關卡」資料夾）：
// - 碰撞體線框（Rapier debugRender，與網格重疊比對）。
// - 區域範圍、名稱、檢查點與跑酷路線。
// - 傳送到各區的按鈕；目前區域、追蹤位置與關卡統計的監看。
import * as THREE from 'three';
import type { EventBus } from '@/core/EventBus';
import type { GameEvents } from '@/core/events';
import { SystemOrder, type GameSystem } from '@/core/Game';
import type { ConfigBinding, DebugPanel } from '@/debug/DebugPanel';
import type { Physics, Vec3Like } from '@/physics/Physics';
import { makeTextTexture } from '@/world/Greybox';
import { DataLevel, type LevelManager, type Spawn } from '@/world/Level';
import { CHECKPOINT_DEFAULT_RADIUS, courseCheckpoints, zoneSpawn, degToRad } from '@/world/LevelData';

export interface LevelDebugConfig {
  showColliders: boolean;
  showZones: boolean;
  colliderColor: number;
  zoneColor: number;
  checkpointColor: number;
}

export const LEVEL_DEBUG_CONFIG: LevelDebugConfig = {
  showColliders: false,
  showZones: false,
  colliderColor: 0xff3df0,
  zoneColor: 0x39e6ff,
  checkpointColor: 0xffd040,
};

export interface LevelDebugOptions {
  scene: THREE.Object3D;
  levels: LevelManager;
  physics: Physics;
  panel: DebugPanel;
  bus: EventBus<GameEvents>;
  /** 傳送（腳底位置、yaw 弧度）。 */
  teleport: (spawn: Spawn) => void;
  /** 追蹤對象位置（監看用）。 */
  getFocus?: () => Readonly<Vec3Like> | null;
  config?: LevelDebugConfig;
}

/** 由 Rapier debugRender 的線段頂點建立線框（複製一份，Rapier 的緩衝區會被重用）。 */
export function colliderWireframe(lines: Float32Array, color: number): THREE.LineSegments {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(lines), 3));
  const mat = new THREE.LineBasicMaterial({ color, depthTest: true, transparent: true, opacity: 0.9, fog: false });
  const seg = new THREE.LineSegments(geo, mat);
  seg.name = 'debug:colliders';
  seg.frustumCulled = false;
  seg.renderOrder = 10;
  return seg;
}

/** 軸對齊盒的 12 條邊（push 進 out）。 */
export function pushBoxEdges(out: number[], pos: readonly number[], size: readonly number[]): void {
  const hx = size[0]! / 2;
  const hy = size[1]! / 2;
  const hz = size[2]! / 2;
  const cx = pos[0]!;
  const cy = pos[1]!;
  const cz = pos[2]!;
  const c = (sx: number, sy: number, sz: number): number[] => [cx + sx * hx, cy + sy * hy, cz + sz * hz];
  const edges: [number[], number[]][] = [];
  for (const sy of [-1, 1]) {
    edges.push([c(-1, sy, -1), c(1, sy, -1)], [c(1, sy, -1), c(1, sy, 1)], [c(1, sy, 1), c(-1, sy, 1)], [c(-1, sy, 1), c(-1, sy, -1)]);
  }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) edges.push([c(sx, -1, sz), c(sx, 1, sz)]);
  for (const [a, b] of edges) out.push(...a, ...b);
}

export class LevelDebug implements GameSystem {
  readonly name = 'levelDebug';
  readonly order = SystemOrder.debug;
  readonly config: LevelDebugConfig;
  readonly monitor = { level: '', zone: '', position: '', primitives: 0, colliders: 0, meshes: 0, labels: 0, triangles: 0 };

  private colliders: THREE.LineSegments | null = null;
  private zones: THREE.Group | null = null;
  private teleportBinding: ConfigBinding | null = null;
  private readonly unsubs: (() => void)[] = [];

  constructor(private readonly options: LevelDebugOptions) {
    this.config = options.config ?? LEVEL_DEBUG_CONFIG;
    const { panel, bus } = options;
    panel.bindConfig(
      '關卡/除錯顯示',
      this.config,
      {
        showColliders: { label: '碰撞體線框' },
        showZones: { label: '區域與檢查點' },
        colliderColor: { label: '線框顏色', params: { view: 'color' } },
        zoneColor: { label: '區域顏色', params: { view: 'color' } },
      },
      { onChange: () => this.refresh() },
    );
    panel.bindConfig('關卡/監看', this.monitor, {
      level: { label: '關卡', readonly: true },
      zone: { label: '目前區域', readonly: true },
      position: { label: '位置', readonly: true },
      primitives: { label: '基本體', readonly: true },
      colliders: { label: '碰撞體', readonly: true },
      meshes: { label: '合併網格', readonly: true },
      labels: { label: '看板', readonly: true },
      triangles: { label: '三角形', readonly: true },
    });
    this.unsubs.push(
      bus.on('level:loaded', () => this.onLevelLoaded()),
      bus.on('level:unloaded', () => this.clear()),
    );
    if (options.levels.current) this.onLevelLoaded();
  }

  private onLevelLoaded(): void {
    this.clear();
    const level = this.options.levels.current;
    if (!(level instanceof DataLevel)) return;
    const built = level.built;
    if (built) {
      const s = built.stats;
      Object.assign(this.monitor, {
        level: level.name,
        primitives: s.primitives,
        colliders: s.colliders,
        meshes: s.meshes,
        labels: s.labels,
        triangles: s.triangles,
      });
    }
    const buttons = level.data.zones.map((z) => ({
      title: z.name,
      onClick: () => {
        const sp = zoneSpawn(z);
        this.options.teleport({ pos: new THREE.Vector3(sp.pos[0], sp.pos[1], sp.pos[2]), yaw: degToRad(sp.yaw) });
      },
    }));
    this.teleportBinding = this.options.panel.bindButtons('關卡/傳送', buttons, { expanded: true });
    this.refresh();
  }

  /** 依設定建立或移除線框與區域顯示。 */
  refresh(): void {
    const cfg = this.config;
    const scene = this.options.scene;
    const level = this.options.levels.current;
    if (this.colliders && (!cfg.showColliders || !level)) this.disposeColliders();
    if (cfg.showColliders && level && !this.colliders) {
      this.colliders = colliderWireframe(this.options.physics.debugLines(), cfg.colliderColor);
      scene.add(this.colliders);
    }
    if (this.colliders) (this.colliders.material as THREE.LineBasicMaterial).color.setHex(cfg.colliderColor);

    if (this.zones && (!cfg.showZones || !level)) this.disposeZones();
    if (cfg.showZones && level instanceof DataLevel && !this.zones) {
      this.zones = this.buildZoneOverlay(level);
      scene.add(this.zones);
    }
  }

  private buildZoneOverlay(level: DataLevel): THREE.Group {
    const group = new THREE.Group();
    group.name = 'debug:zones';
    const cfg = this.config;
    const zoneLines: number[] = [];
    for (const z of level.data.zones) pushBoxEdges(zoneLines, z.pos, z.size);
    for (const k of level.data.killVolumes) {
      // killVolume 只畫頂面高度的大方框，避免線框過多。
      pushBoxEdges(zoneLines, [k.pos[0], k.pos[1] + k.size[1] / 2, k.pos[2]], [Math.min(k.size[0], 170), 0.01, Math.min(k.size[2], 170)]);
    }
    const zoneGeo = new THREE.BufferGeometry();
    zoneGeo.setAttribute('position', new THREE.Float32BufferAttribute(zoneLines, 3));
    const zoneSeg = new THREE.LineSegments(zoneGeo, new THREE.LineBasicMaterial({ color: cfg.zoneColor, fog: false }));
    zoneSeg.frustumCulled = false;
    group.add(zoneSeg);

    // 檢查點：直立的方框；跑酷路線以折線相連。
    const cpLines: number[] = [];
    for (const c of level.data.checkpoints) {
      const r = c.course ? (c.radius ?? CHECKPOINT_DEFAULT_RADIUS) : 0.5;
      pushBoxEdges(cpLines, [c.pos[0], c.pos[1] + (c.course ? 0 : 1), c.pos[2]], [r * 2, c.course ? r * 2 : 2, r * 2]);
    }
    const courses = new Set(level.data.checkpoints.map((c) => c.course).filter((c): c is string => !!c));
    for (const course of courses) {
      const list = courseCheckpoints(level.data, course);
      for (let i = 1; i < list.length; i++) cpLines.push(...list[i - 1]!.pos, ...list[i]!.pos);
    }
    const cpGeo = new THREE.BufferGeometry();
    cpGeo.setAttribute('position', new THREE.Float32BufferAttribute(cpLines, 3));
    const cpSeg = new THREE.LineSegments(cpGeo, new THREE.LineBasicMaterial({ color: cfg.checkpointColor, fog: false }));
    cpSeg.frustumCulled = false;
    group.add(cpSeg);

    // 區域名稱（永遠面向鏡頭、不被遮擋）。
    for (const z of level.data.zones) {
      const made = makeTextTexture(z.name, { sub: z.id, color: cfg.zoneColor });
      if (!made) continue;
      const mat = new THREE.SpriteMaterial({ map: made.texture, depthTest: false, transparent: true, fog: false });
      const sprite = new THREE.Sprite(mat);
      const h = 3;
      sprite.scale.set(h * made.aspect, h, 1);
      sprite.position.set(z.pos[0], z.pos[1] + z.size[1] / 2 - 1, z.pos[2]);
      sprite.renderOrder = 20;
      group.add(sprite);
    }
    return group;
  }

  update(): void {
    if (!this.options.panel.isOpen) return;
    const level = this.options.levels.current;
    const focus = this.options.getFocus?.();
    if (focus) this.monitor.position = `${focus.x.toFixed(1)}, ${focus.y.toFixed(1)}, ${focus.z.toFixed(1)}`;
    this.monitor.zone = level instanceof DataLevel ? (level.zone?.name ?? '—') : '—';
  }

  private disposeColliders(): void {
    if (!this.colliders) return;
    this.colliders.removeFromParent();
    this.colliders.geometry.dispose();
    (this.colliders.material as THREE.Material).dispose();
    this.colliders = null;
  }

  private disposeZones(): void {
    if (!this.zones) return;
    this.zones.removeFromParent();
    this.zones.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry && !(o as THREE.Sprite).isSprite) m.geometry.dispose();
      const mat = m.material as THREE.Material & { map?: THREE.Texture | null };
      if (mat) {
        mat.map?.dispose();
        mat.dispose();
      }
    });
    this.zones = null;
  }

  private clear(): void {
    this.disposeColliders();
    this.disposeZones();
    this.teleportBinding?.dispose();
    this.teleportBinding = null;
  }

  dispose(): void {
    this.clear();
    for (const u of this.unsubs) u();
    this.unsubs.length = 0;
  }
}
