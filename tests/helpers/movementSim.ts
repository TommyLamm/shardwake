// 移動無頭測試工具：建立 Rapier 世界、放置幾何（LevelData 基本體）、以腳本輸入逐步模擬 PlayerController。
// 後續計畫（M1-06 跑牆、M1-07 能力）沿用：new MovementSim({ primitives, ... })，
// 用 input.down()/up()/tap()/setMove()/setYaw() 改變輸入，再 step()/run()/runUntil()。
import * as THREE from 'three';
import { EventBus } from '@/core/EventBus';
import type { GameEvents } from '@/core/events';
import { ACTION_BIT, type Action } from '@/input/Actions';
import { createInputFrame, moveVector, type InputFrame } from '@/input/InputFrame';
import { Physics } from '@/physics/Physics';
import { defaultMovementConfig, type MovementConfig } from '@/player/MovementConfig';
import { PlayerController, type PlayerSettings } from '@/player/PlayerController';
import { DataLevel } from '@/world/Level';
import type { Checkpoint, KillVolume, LevelData, LevelPrimitive } from '@/world/LevelData';

/** 腳本輸入：模擬 InputFrameBuilder 的邊緣語意（按下的下一步出現一次 pressed）。 */
export class ScriptedInput {
  readonly frame: InputFrame = createInputFrame();
  private held = 0;
  private pressed = 0;
  private released = 0;
  /** 直接指定的移動向量（null 時由 WASD 位元計算）。 */
  private moveOverride: { x: number; y: number } | null = null;
  yaw = 0;
  pitch = 0;

  down(...actions: Action[]): this {
    for (const a of actions) {
      const bit = ACTION_BIT[a];
      if ((this.held & bit) === 0) this.pressed |= bit;
      this.held |= bit;
    }
    return this;
  }

  up(...actions: Action[]): this {
    for (const a of actions) {
      const bit = ACTION_BIT[a];
      if (this.held & bit) this.released |= bit;
      this.held &= ~bit;
    }
    return this;
  }

  /** 在兩步之間按下又放開（下一步 pressed 與 released 同時出現、held 為 0）。 */
  tap(action: Action): this {
    const bit = ACTION_BIT[action];
    this.pressed |= bit;
    this.released |= bit;
    return this;
  }

  isDown(action: Action): boolean {
    return (this.held & ACTION_BIT[action]) !== 0;
  }

  /** 指定移動向量（x 向右、y 向前）；傳 null 改回由 WASD 位元計算。 */
  setMove(x: number | null, y = 0): this {
    this.moveOverride = x === null ? null : { x, y };
    return this;
  }

  setYaw(yaw: number): this {
    this.yaw = yaw;
    return this;
  }

  releaseAll(): this {
    this.released |= this.held;
    this.held = 0;
    this.moveOverride = null;
    return this;
  }

  /** 產生這一步的 InputFrame 並清空邊緣。 */
  build(): InputFrame {
    const f = this.frame;
    f.held = this.held >>> 0;
    f.pressed = this.pressed >>> 0;
    f.released = this.released >>> 0;
    f.yaw = this.yaw;
    f.pitch = this.pitch;
    if (this.moveOverride) {
      f.move.x = this.moveOverride.x;
      f.move.y = this.moveOverride.y;
    } else moveVector(this.held, f.move);
    this.pressed = 0;
    this.released = 0;
    return f;
  }
}

export interface RecordedEvent {
  name: keyof GameEvents;
  step: number;
  time: number;
  payload: Record<string, unknown>;
}

export interface MovementSimOptions {
  primitives: readonly LevelPrimitive[];
  /** 模擬頻率（預設 120 Hz）。 */
  hz?: number;
  /** 覆寫移動參數（以預設值為基礎）。 */
  config?: Partial<MovementConfig>;
  settings?: Partial<PlayerSettings>;
  /** 出生的腳底位置與 yaw（弧度）。 */
  spawn?: { pos: [number, number, number]; yaw?: number };
  checkpoints?: readonly Checkpoint[];
  killVolumes?: readonly KillVolume[];
}

const PLAYER_EVENTS: readonly (keyof GameEvents)[] = [
  'player:state',
  'player:jump',
  'player:land',
  'player:slideStart',
  'player:slideEnd',
  'player:crouch',
  'player:footstep',
  'player:respawn',
];

/** 一個無頭移動模擬（需先 await Physics.init()）。 */
export class MovementSim {
  readonly physics: Physics;
  readonly bus = new EventBus<GameEvents>();
  readonly level: DataLevel;
  readonly player: PlayerController;
  readonly input = new ScriptedInput();
  readonly config: MovementConfig;
  readonly settings: PlayerSettings;
  readonly events: RecordedEvent[] = [];
  readonly hz: number;
  readonly dt: number;
  stepCount = 0;

  constructor(options: MovementSimOptions) {
    this.hz = options.hz ?? 120;
    this.dt = 1 / this.hz;
    this.physics = new Physics({ bus: this.bus });
    this.config = { ...defaultMovementConfig(), ...options.config };
    this.settings = { autoSprint: true, ...options.settings };
    const spawn = options.spawn ?? { pos: [0, 0, 0] as [number, number, number], yaw: 0 };
    const data: LevelData = {
      id: 'movement-test',
      name: '移動測試',
      version: 1,
      primitives: options.primitives,
      spawnPoints: [{ id: 'spawn', pos: spawn.pos, yaw: ((spawn.yaw ?? 0) * 180) / Math.PI }],
      checkpoints: options.checkpoints ?? [],
      killVolumes: options.killVolumes ?? [],
      zones: [],
      labels: [],
    };
    this.level = new DataLevel(data);
    this.level.build({ physics: this.physics, root: new THREE.Group(), bus: this.bus });
    this.physics.syncQueries();
    this.player = new PlayerController({
      physics: this.physics,
      bus: this.bus,
      config: this.config,
      getFrame: () => this.input.build(),
      getSettings: () => this.settings,
      checkRespawn: (feet) => this.level.checkRespawn(feet),
      setView: (yaw) => this.input.setYaw(yaw),
    });
    for (const name of PLAYER_EVENTS) {
      this.bus.on(name, (payload) => {
        this.events.push({
          name,
          step: this.stepCount,
          time: this.stepCount * this.dt,
          payload: JSON.parse(JSON.stringify(payload ?? {})) as Record<string, unknown>,
        });
      });
    }
    this.player.teleport({ x: spawn.pos[0], y: spawn.pos[1], z: spawn.pos[2] }, spawn.yaw ?? 0);
  }

  get time(): number {
    return this.stepCount * this.dt;
  }

  get state(): string {
    return this.player.machine.currentId;
  }

  get speed(): number {
    return Math.hypot(this.player.velocity.x, this.player.velocity.z);
  }

  /** 推進 n 步（每步一次 InputFrame）。 */
  step(n = 1): void {
    for (let i = 0; i < n; i++) {
      this.stepCount++;
      this.player.step(this.dt);
      this.physics.step(this.dt);
    }
  }

  /** 推進 seconds 秒（四捨五入成步數）。 */
  run(seconds: number): void {
    this.step(Math.round(seconds * this.hz));
  }

  /** 每步後檢查 pred，成立時停止並回傳經過的秒數；超過 maxSeconds 回傳 null。 */
  runUntil(pred: (sim: MovementSim) => boolean, maxSeconds = 10): number | null {
    const start = this.stepCount;
    const max = Math.round(maxSeconds * this.hz);
    for (let i = 0; i < max; i++) {
      this.step();
      if (pred(this)) return (this.stepCount - start) * this.dt;
    }
    return null;
  }

  /** 站穩：等到著地並靜止（最多 2 秒）。 */
  settle(): void {
    this.runUntil((s) => s.player.grounded && s.state === 'ground' && s.speed < 1e-4, 2);
  }

  eventsNamed(name: keyof GameEvents): RecordedEvent[] {
    return this.events.filter((e) => e.name === name);
  }

  clearEvents(): void {
    this.events.length = 0;
  }

  dispose(): void {
    this.player.dispose();
    this.level.dispose();
    this.physics.dispose();
  }
}

/** 地板（頂面 y = top）。 */
export function floorBox(id: string, x0: number, x1: number, z0: number, z1: number, top = 0, material = 'floor'): LevelPrimitive {
  return { id, type: 'box', material, pos: [(x0 + x1) / 2, top - 0.5, (z0 + z1) / 2], size: [x1 - x0, 1, z1 - z0] };
}

/** 由兩個角點建立 box。 */
export function boxMinMax(
  id: string,
  min: [number, number, number],
  max: [number, number, number],
  material = 'cover',
): LevelPrimitive {
  return {
    id,
    type: 'box',
    material,
    pos: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2],
    size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]],
  };
}
