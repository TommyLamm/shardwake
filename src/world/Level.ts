// Level 介面與 LevelManager。
// - Level：build(ctx) 建立碰撞體與網格、dispose() 釋放、getSpawn() 出生點、update(dt) 每個固定步更新。
// - DataLevel：由 LevelData 建立的關卡（訓練場、之後的基地與房間模組），提供區域追蹤、
//   killVolume 判定與最近檢查點查詢。
// - LevelManager（Game 系統，order = world）：載入／卸載關卡；每次載入都重建物理世界
//   （為 M4 的基地 ↔ 任務切換做準備）。fixedUpdate 呼叫目前關卡的 update(dt)。
import * as THREE from 'three';
import type { EventBus } from '@/core/EventBus';
import type { GameEvents } from '@/core/events';
import { SystemOrder, type GameSystem } from '@/core/Game';
import type { Physics, Vec3Like } from '@/physics/Physics';
import type { LevelVisuals } from '@/world/Greybox';
import type { MaterialTable } from '@/world/MaterialDefs';
import { buildLevel, type LevelBuild } from '@/world/LevelBuilder';
import {
  degToRad,
  killVolumeAt,
  nearestCheckpoint,
  zoneAt,
  type Checkpoint,
  type LevelData,
  type Zone,
} from '@/world/LevelData';

/** 關卡建構時取得的環境。 */
export interface LevelContext {
  physics: Physics;
  /** 關卡的根節點（已加入場景）；關卡的網格都掛在這裡。 */
  root: THREE.Group;
  visuals?: LevelVisuals | undefined;
  materials?: MaterialTable | undefined;
  bus?: EventBus<GameEvents> | undefined;
  /** 區域追蹤的對象位置（玩家腳底或自由相機），沒有時不追蹤。 */
  getFocus?: (() => Readonly<Vec3Like> | null) | undefined;
}

/** 出生點（腳底位置、面向；yaw 為弧度）。 */
export interface Spawn {
  pos: THREE.Vector3;
  yaw: number;
}

export interface Level {
  readonly id: string;
  readonly name: string;
  build(ctx: LevelContext): void | Promise<void>;
  dispose(): void;
  /** 出生點；id 省略時為第一個出生點。 */
  getSpawn(id?: string): Spawn;
  /** 每個固定步呼叫。 */
  update(dt: number): void;
}

/** 由 LevelData 建立的關卡。 */
export class DataLevel implements Level {
  readonly id: string;
  readonly name: string;
  private _build: LevelBuild | null = null;
  private ctx: LevelContext | null = null;
  private currentZone: Zone | null = null;

  constructor(readonly data: LevelData) {
    this.id = data.id;
    this.name = data.name;
  }

  /** 建構結果（碰撞體、網格、統計）；尚未建構時為 null。 */
  get built(): LevelBuild | null {
    return this._build;
  }

  /** 追蹤對象目前所在的區域。 */
  get zone(): Zone | null {
    return this.currentZone;
  }

  build(ctx: LevelContext): void {
    if (this._build) throw new Error(`關卡「${this.id}」已經建構過`);
    this.ctx = ctx;
    this._build = buildLevel(this.data, {
      physics: ctx.physics,
      visuals: ctx.visuals,
      materials: ctx.materials,
    });
    ctx.root.add(this._build.root);
    this.currentZone = null;
  }

  dispose(): void {
    this._build?.dispose();
    this._build = null;
    this.ctx = null;
    this.currentZone = null;
  }

  getSpawn(id?: string): Spawn {
    const s = (id ? this.data.spawnPoints.find((p) => p.id === id) : undefined) ?? this.data.spawnPoints[0];
    if (!s) throw new Error(`關卡「${this.id}」沒有出生點`);
    return { pos: new THREE.Vector3(s.pos[0], s.pos[1], s.pos[2]), yaw: degToRad(s.yaw) };
  }

  zoneAt(p: Readonly<Vec3Like>): Zone | null {
    return zoneAt(this.data, p);
  }

  /** p 是否落在 killVolume 內。 */
  isInKillVolume(p: Readonly<Vec3Like>): boolean {
    return killVolumeAt(this.data, p) !== null;
  }

  nearestCheckpoint(p: Readonly<Vec3Like>): Checkpoint | null {
    return nearestCheckpoint(this.data, p);
  }

  /** 檢查點 → 出生資料（yaw 弧度）。 */
  checkpointSpawn(c: Checkpoint): Spawn {
    return { pos: new THREE.Vector3(c.pos[0], c.pos[1], c.pos[2]), yaw: degToRad(c.yaw) };
  }

  /**
   * 落入 killVolume 時回傳最近檢查點的出生資料並發出 `level:respawn`；否則回傳 null。
   * 給 M1-05 的玩家控制器與暫用自由相機使用。
   */
  checkRespawn(p: Readonly<Vec3Like>): Spawn | null {
    if (!this.isInKillVolume(p)) return null;
    const c = this.nearestCheckpoint(p);
    if (!c) return this.getSpawn();
    this.ctx?.bus?.emit('level:respawn', { levelId: this.id, checkpointId: c.id });
    return this.checkpointSpawn(c);
  }

  update(_dt: number): void {
    const focus = this.ctx?.getFocus?.();
    if (focus) this.trackZone(focus);
  }

  /** 更新追蹤對象所在區域；改變時發出 `level:zone`（先離開、再進入）。 */
  trackZone(p: Readonly<Vec3Like>): Zone | null {
    const next = zoneAt(this.data, p);
    const prev = this.currentZone;
    if (next === prev) return next;
    this.currentZone = next;
    const bus = this.ctx?.bus;
    if (prev) bus?.emit('level:zone', { levelId: this.id, zoneId: prev.id, entered: false, event: prev.event });
    if (next) bus?.emit('level:zone', { levelId: this.id, zoneId: next.id, entered: true, event: next.event });
    return next;
  }
}

export interface LevelManagerOptions {
  physics: Physics;
  scene: THREE.Object3D;
  visuals?: LevelVisuals;
  materials?: MaterialTable;
  bus?: EventBus<GameEvents>;
}

export class LevelManager implements GameSystem {
  readonly name = 'levels';
  readonly order = SystemOrder.world;

  private _current: Level | null = null;
  private root: THREE.Group | null = null;
  private loading: Promise<Level> | null = null;
  private getFocus: (() => Readonly<Vec3Like> | null) | undefined;

  constructor(private readonly options: LevelManagerOptions) {}

  get current(): Level | null {
    return this._current;
  }

  get isLoading(): boolean {
    return this.loading !== null;
  }

  /** 設定區域追蹤的對象（玩家或自由相機）；下次載入的關卡也沿用。 */
  setFocus(getFocus: (() => Readonly<Vec3Like> | null) | undefined): void {
    this.getFocus = getFocus;
  }

  /** 卸載目前關卡、重建物理世界、建構新關卡。 */
  async load(level: Level): Promise<Level> {
    if (this.loading) await this.loading.catch(() => undefined);
    const run = async (): Promise<Level> => {
      this.unload();
      const { physics, scene, bus } = this.options;
      physics.resetWorld();
      const root = new THREE.Group();
      root.name = `levelRoot:${level.id}`;
      scene.add(root);
      this.root = root;
      try {
        await level.build({
          physics,
          root,
          visuals: this.options.visuals,
          materials: this.options.materials,
          bus,
          getFocus: () => this.getFocus?.() ?? null,
        });
      } catch (err) {
        level.dispose();
        root.removeFromParent();
        this.root = null;
        physics.resetWorld();
        throw err;
      }
      physics.syncQueries();
      this._current = level;
      bus?.emit('level:loaded', { id: level.id, name: level.name });
      return level;
    };
    const p = run();
    this.loading = p;
    try {
      return await p;
    } finally {
      if (this.loading === p) this.loading = null;
    }
  }

  /** 卸載目前關卡（碰撞體、網格、看板）。 */
  unload(): void {
    const level = this._current;
    if (!level) return;
    this._current = null;
    level.dispose();
    this.root?.removeFromParent();
    this.root = null;
    this.options.bus?.emit('level:unloaded', { id: level.id });
  }

  fixedUpdate(dt: number): void {
    this._current?.update(dt);
  }

  dispose(): void {
    this.unload();
  }
}
