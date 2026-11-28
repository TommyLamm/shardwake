// 調校工具的無頭整合模擬（M1-15）：Game（固定步主迴圈）＋ InputSystem（以合成按鍵事件輸入）＋ 玩家 ＋ 物理 ＋ 訓練場 ＋
// 武器（Ballistics）＋ 玩家生命 ＋ 錄製重播 ＋ 計時賽，接線方式與 main.ts 相同（沒有畫面、音效與 HUD）。
// 用法：const sim = await ToolSim.create(); sim.key('KeyW', true); sim.turn(dYaw); sim.frame(1 / 60); …
import * as THREE from 'three';
import { EventBus } from '@/core/EventBus';
import type { GameEvents } from '@/core/events';
import { Game } from '@/core/Game';
import { defaultSettings, type Settings } from '@/core/Settings';
import { GameStorage } from '@/core/Storage';
import { PlayerHealth } from '@/combat/PlayerHealth';
import { Bindings } from '@/input/Bindings';
import { InputSystem } from '@/input/Input';
import { Physics, PhysicsSystem } from '@/physics/Physics';
import { MOVEMENT_CONFIG } from '@/player/MovementConfig';
import { PlayerController } from '@/player/PlayerController';
import { BestTimes, courseFromCheckpoints, TimeTrialSystem, type CourseDef } from '@/tools/TimeTrial';
import { ReplaySystem } from '@/tools/Replay';
import { createGameReplayHost } from '@/tools/replayHost';
import { currentTuningDiff, gameTuningTargets, isStandardTuning, tuningFingerprint } from '@/tools/tuning';
import { Ballistics } from '@/weapons/Ballistics';
import { WeaponManager } from '@/weapons/WeaponManager';
import { DataLevel, LevelManager } from '@/world/Level';
import { PARKOUR_COURSE, TrainingGround } from '@/world/levels/TrainingGround';

export interface ToolSimOptions {
  hz?: number;
  storage?: GameStorage;
}

export class ToolSim {
  readonly bus = new EventBus<GameEvents>();
  readonly game: Game;
  readonly storage: GameStorage;
  readonly settings: Settings = defaultSettings();
  readonly bindings = new Bindings();
  readonly input: InputSystem;
  readonly physics: Physics;
  readonly levels: LevelManager;
  readonly player: PlayerController;
  readonly health: PlayerHealth;
  readonly ballistics: Ballistics;
  readonly weapons: WeaponManager;
  readonly replay: ReplaySystem;
  readonly trial: TimeTrialSystem;
  readonly best: BestTimes;
  /** 每個固定步結束後的腳底位置（錄製與重播比對用）。 */
  readonly trace: number[] = [];
  simOverride: Settings | null = null;
  private course: CourseDef | null = null;
  private time = 0;

  private constructor(options: ToolSimOptions) {
    this.storage = options.storage ?? new GameStorage({ backend: () => null });
    this.game = new Game({ bus: this.bus, loop: { hz: options.hz ?? 120, maxFrameDt: 0.25, maxStepsPerFrame: 64 } });
    this.input = new InputSystem({
      bindings: this.bindings,
      getSettings: () => this.settings,
      isLocked: () => false,
      win: null,
      doc: null,
      now: () => this.time * 1000,
    });
    this.physics = new Physics({ bus: this.bus });
    this.levels = new LevelManager({ physics: this.physics, scene: new THREE.Scene(), bus: this.bus });
    const simSettings = (): Settings => this.simOverride ?? this.settings;
    this.player = new PlayerController({
      physics: this.physics,
      bus: this.bus,
      config: MOVEMENT_CONFIG,
      getFrame: () => this.input.frame,
      getSettings: simSettings,
      setView: (yaw, pitch) => this.input.view.set(yaw, pitch),
      checkRespawn: (p) => this.level?.checkRespawn(p) ?? null,
      setToggle: (action, on) => this.input.builder.setToggle(action, on),
      getMoveSpeedScale: () => this.weapons?.moveSpeedScale ?? 1,
    });
    this.levels.setFocus(() => this.player.position);
    this.health = new PlayerHealth({
      bus: this.bus,
      getCenter: (out) => {
        out.x = this.player.position.x;
        out.y = this.player.position.y + this.player.height / 2;
        out.z = this.player.position.z;
        return out;
      },
      onRespawn: () => this.player.respawn(this.levels.current!.getSpawn()),
    });
    this.ballistics = new Ballistics({
      physics: this.physics,
      bus: this.bus,
      getPlayerCenter: (out) => this.health.getCenter(out),
      applyPlayerImpulse: (dv) => this.player.addImpulse(dv),
      getSelfTarget: () => this.health,
    });
    this.weapons = new WeaponManager({
      getFrame: () => this.input.frame,
      view: this.input.view,
      getPlayer: () => (this.health.alive ? this.player : null),
      ballistics: this.ballistics,
      bus: this.bus,
      getSettings: simSettings,
      setToggle: (action, on) => this.input.builder.setToggle(action, on),
    });
    const tuningTargets = gameTuningTargets({
      getWeaponDefs: () => this.weapons.slots.flatMap((w) => (w ? [w.def] : [])),
      setWeaponDef: (id, def) => {
        const w = this.weapons.slots.find((x) => x?.id === id);
        if (w) w.def = def;
      },
    });
    this.replay = new ReplaySystem({
      input: this.input,
      loop: this.game.loop,
      bus: this.bus,
      host: createGameReplayHost({
        player: this.player,
        view: this.input.view,
        weapons: this.weapons,
        health: this.health,
        ballistics: this.ballistics,
        getLevel: () => this.level,
        isActive: () => this.game.mode === 'playing',
        getSettings: () => this.settings,
        setSimSettings: (s) => {
          this.simOverride = s ? { ...this.settings, ...s } : null;
        },
        getTuningDiff: () => currentTuningDiff(tuningTargets),
        onApplied: () => this.trial.reset(),
      }),
      now: () => new Date(0),
    });
    this.best = new BestTimes(this.storage);
    this.trial = new TimeTrialSystem({
      getFrame: () => this.input.frame,
      getCenter: (out) => this.health.getCenter(out),
      getCourse: () => this.course,
      getLevelId: () => this.level?.id ?? null,
      restartPlayer: (t) => this.player.respawn(t),
      best: this.best,
      isReplay: () => this.replay.replaying,
      getTuning: () => {
        const d = currentTuningDiff(tuningTargets);
        return { fingerprint: tuningFingerprint(d), standard: isStandardTuning(d) };
      },
      getHz: () => this.game.loop.config.hz,
      bus: this.bus,
      now: () => new Date(0),
    });
    this.game.addSystem(this.input);
    this.game.addSystem(this.player);
    this.game.addSystem(this.weapons);
    this.game.addSystem(new PhysicsSystem(this.physics));
    this.game.addSystem(this.health);
    this.game.addSystem(this.levels);
    this.game.addSystem(this.trial);
    this.game.addSystem(this.replay);
    this.game.addSystem({
      name: 'trace',
      order: 1300,
      fixedUpdate: () => {
        const p = this.player.position;
        this.trace.push(p.x, p.y, p.z);
      },
    });
  }

  static async create(options: ToolSimOptions = {}): Promise<ToolSim> {
    const sim = new ToolSim(options);
    await sim.levels.load(new TrainingGround());
    sim.course = courseFromCheckpoints(
      sim.level!.data.checkpoints,
      PARKOUR_COURSE.id,
      PARKOUR_COURSE.name,
      { pos: new THREE.Vector3(...PARKOUR_COURSE.restart.pos), yaw: PARKOUR_COURSE.restart.yaw },
      (cp) => PARKOUR_COURSE.labels[cp.id] ?? cp.id,
    );
    const s = sim.level!.getSpawn();
    sim.player.teleport(s.pos, s.yaw);
    sim.game.setMode('title');
    sim.game.start();
    return sim;
  }

  get level(): DataLevel | null {
    return this.levels.current instanceof DataLevel ? this.levels.current : null;
  }

  /** 推進一個渲染畫面（真實時間 dt）。 */
  frame(dt: number): number {
    this.time += dt;
    return this.game.tick(dt);
  }

  /** 以固定畫面間隔推進 seconds 秒。 */
  run(seconds: number, fps = 60): void {
    const n = Math.round(seconds * fps);
    for (let i = 0; i < n; i++) this.frame(1 / fps);
  }

  key(code: string, down: boolean): void {
    const e = { code, preventDefault() {} };
    if (down) this.input.handleKeyDown(e);
    else this.input.handleKeyUp(e);
  }

  tap(code: string): void {
    this.key(code, true);
    this.key(code, false);
  }

  /** 模擬滑鼠：直接轉動玩家視角（弧度）。 */
  turn(dYaw: number, dPitch = 0): void {
    this.input.view.rotate(dYaw, dPitch);
  }

  dispose(): void {
    this.game.dispose();
    this.physics.dispose();
  }
}
