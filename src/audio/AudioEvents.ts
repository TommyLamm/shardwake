// 音效事件綁定（M1-13）：訂閱 EventBus，把遊戲事件轉成音效；各系統不直接呼叫音效。
// - 單次音效：武器（開火、空倉、換彈關鍵影格、切槍、開鏡、近戰、爆炸、命中牆面）、移動（腳步、跳、二段跳、落地、
//   滑鏟、蹬牆跳、攀爬、Dash、抓鉤）、回饋（命中、爆頭、擊殺、受擊、護盾破裂與回充、死亡、重生、低生命心跳）、
//   敵人（無人機開火、能量球命中、擊毀爆炸）、介面（開始／繼續、暫停）。
// - 循環音依狀態每畫面開關並平滑淡入淡出：噴射、滑鏟、跑牆、抓鉤收線、依速度變化的風聲、電漿球飛行（空間音源）。
// - 換彈的彈匣出／入、上膛與霰彈泵動依 M1-11 viewmodel 的關鍵影格（換彈進度比例）排在模擬時間上：暫停時一起停住，
//   換彈被取消或切槍時清掉。
import { AUDIO_CONFIG, type AudioEventConfig } from '@/audio/AudioConfig';
import { dbToGain, footstepSoundId, heartbeat, landingSound, speedGainDb, windLevel } from '@/audio/audioMath';
import type { AudioSink, LoopHandle, PlayOptions, Vec3Like } from '@/audio/AudioEngine';
import type { EventBus } from '@/core/EventBus';
import type { GameEvents, GameMode } from '@/core/events';
import { SystemOrder, type FrameInfo, type GameSystem } from '@/core/Game';

/** 玩家狀態（PlayerController.state 的子集）。 */
export interface AudioPlayerView {
  readonly state: string;
  readonly speed: number;
  readonly velocity: Readonly<Vec3Like>;
  readonly wallRunSide: 'left' | 'right' | null;
  readonly abilities: {
    readonly jet: { readonly active: boolean };
    readonly grapple: { readonly phase: string };
  };
}

/** 武器資料（WeaponDef 的子集）。 */
export interface AudioWeaponView {
  readonly audio: { readonly fire: string; readonly reload: string; readonly params: Readonly<Record<string, number>> };
  readonly fire: { readonly mode: string; readonly rpm: number };
}

/** 換彈與泵動的關鍵影格（ViewmodelConfig 的子集；換彈進度比例／射擊間隔比例）。 */
export interface ReloadCueKeys {
  reloadMagOut: number;
  reloadMagSeat: number;
  reloadChargeStart: number;
  pumpStart: number;
  pumpMid: number;
}

export const DEFAULT_RELOAD_KEYS: Readonly<ReloadCueKeys> = {
  reloadMagOut: 0.28,
  reloadMagSeat: 0.66,
  reloadChargeStart: 0.72,
  pumpStart: 0.18,
  pumpMid: 0.36,
};

/** 引擎額外的控制（AudioEngine 符合；測試的假物件可省略）。 */
export interface AudioControls {
  setPaused?(paused: boolean): void;
  setHidden?(hidden: boolean): void;
  update?(): void;
}

export interface AudioEventOptions {
  bus: EventBus<GameEvents>;
  sink: AudioSink & AudioControls;
  config?: AudioEventConfig;
  getWeaponDef: (weaponId: string) => AudioWeaponView | undefined;
  getPlayer: () => AudioPlayerView | null;
  getHealth?: () => { healthFraction: number; alive: boolean } | null;
  getMode: () => GameMode;
  /** 投射物目前位置（電漿球飛行聲跟隨用）；找不到回傳 false。 */
  getProjectilePosition?: (id: number, out: Vec3Like) => boolean;
  getReloadKeys?: () => Readonly<ReloadCueKeys>;
  /** 電漿球飛行聲的空間音源數。 */
  emitters?: number;
}

interface Cue {
  active: boolean;
  time: number;
  id: string;
  gainDb: number;
  group: 'reload' | 'pump';
}

interface Emitter {
  handle: LoopHandle;
  projectile: number;
  since: number;
}

const CUE_CAPACITY = 32;

/** 每把武器換彈種類（WeaponDef.audio.reload）→ 彈匣出／入的音效。 */
export const RELOAD_SOUNDS: Readonly<Record<string, { out: string; in: string; rack: string | null }>> = {
  magazine: { out: 'reload.magOut', in: 'reload.magIn', rack: 'reload.rack' },
  cell: { out: 'reload.cellOut', in: 'reload.cellIn', rack: 'reload.rack' },
  cylinder: { out: 'reload.cylinderOpen', in: 'reload.cylinderClose', rack: null },
};

const IMPACT_RATE: Readonly<Record<string, number>> = { glass: 1.3, energy: 1.15, grate: 0.9, concrete: 0.85, hazard: 0.95 };

export class AudioEventBinder implements GameSystem {
  readonly name = 'audioEvents';
  readonly order = SystemOrder.audio;
  readonly config: AudioEventConfig;
  /** 模擬時鐘（s；換彈與泵動的排程）。 */
  clock = 0;
  readonly cues: Cue[] = [];
  readonly emitters: Emitter[] = [];
  readonly loops: { jet: LoopHandle; slide: LoopHandle; wallRun: LoopHandle; reel: LoopHandle; wind: LoopHandle };
  private heartbeatTimer = 0;
  private readonly offs: (() => void)[] = [];
  private readonly opts: AudioEventOptions;
  private readonly tmp = { x: 0, y: 0, z: 0 };
  private readonly playOpts: PlayOptions = {};
  private readonly wind = { gain: 0, rate: 1 };

  constructor(options: AudioEventOptions) {
    this.opts = options;
    this.config = options.config ?? AUDIO_CONFIG.events;
    for (let i = 0; i < CUE_CAPACITY; i++) this.cues.push({ active: false, time: 0, id: '', gainDb: 0, group: 'reload' });
    const sink = options.sink;
    this.loops = {
      jet: sink.loop('jet'),
      slide: sink.loop('slide'),
      wallRun: sink.loop('wallRun'),
      reel: sink.loop('grapple.reel'),
      wind: sink.loop('wind'),
    };
    for (let i = 0; i < Math.max(1, options.emitters ?? 4); i++) {
      this.emitters.push({ handle: sink.loop('plasma.flight', { spatial: true }), projectile: -1, since: 0 });
    }
    this.subscribe();
  }

  private play(id: string, gainDb = 0, position?: Readonly<Vec3Like>, rate?: number): boolean {
    const o = this.playOpts;
    o.gainDb = gainDb;
    o.position = position;
    o.rate = rate;
    return this.opts.sink.play(id, o);
  }

  private keys(): Readonly<ReloadCueKeys> {
    return this.opts.getReloadKeys?.() ?? DEFAULT_RELOAD_KEYS;
  }

  /** 排一個模擬時間的提示音；佇列滿時丟棄。 */
  schedule(delay: number, id: string, group: Cue['group'], gainDb = 0): boolean {
    for (const c of this.cues) {
      if (c.active) continue;
      c.active = true;
      c.time = this.clock + Math.max(0, delay);
      c.id = id;
      c.group = group;
      c.gainDb = gainDb;
      return true;
    }
    return false;
  }

  cancel(group?: Cue['group']): void {
    for (const c of this.cues) if (group === undefined || c.group === group) c.active = false;
  }

  get pendingCues(): number {
    return this.cues.filter((c) => c.active).length;
  }

  private subscribe(): void {
    const bus = this.opts.bus;
    const on = <K extends keyof GameEvents>(name: K, fn: (p: GameEvents[K]) => void): void => {
      this.offs.push(bus.on(name, fn));
    };
    const cfg = this.config;

    // ── 模式與生命週期 ──
    on('game:mode', ({ from, to, reason }) => {
      this.opts.sink.setPaused?.(to !== 'playing');
      if (to === 'playing' && (from === 'title' || from === 'paused')) this.play('ui.confirm');
      else if (to === 'paused' && reason === 'user') this.play('ui.back');
      if (to === 'title') this.cancel();
    });
    on('lifecycle:visibility', ({ hidden }) => this.opts.sink.setHidden?.(hidden));

    // ── 武器 ──
    on('weapon:fire', (e) => {
      const def = this.opts.getWeaponDef(e.weaponId);
      if (!def) return;
      this.play(this.opts.sink.weaponSound(def.audio));
      if (def.fire.mode === 'pump') {
        const interval = 60 / Math.max(1, def.fire.rpm);
        const k = this.keys();
        this.cancel('pump');
        this.schedule(interval * k.pumpStart, 'reload.pumpBack', 'pump');
        this.schedule(interval * k.pumpMid, 'reload.pumpForward', 'pump');
      }
    });
    on('weapon:dryFire', () => this.play('dryFire'));
    on('weapon:reloadStart', (e) => {
      this.cancel('reload');
      if (e.kind === 'shell') return;
      const def = this.opts.getWeaponDef(e.weaponId);
      const set = RELOAD_SOUNDS[def?.audio.reload ?? 'magazine'] ?? RELOAD_SOUNDS.magazine!;
      const k = this.keys();
      const d = Math.max(0, e.duration);
      this.schedule(d * k.reloadMagOut, set.out, 'reload');
      this.schedule(d * k.reloadMagSeat, set.in, 'reload');
      if (e.kind === 'empty' && set.rack) this.schedule(d * k.reloadChargeStart, set.rack, 'reload');
    });
    on('weapon:reloadShell', () => this.play('reload.shell'));
    on('weapon:reloadEnd', (e) => {
      if (!e.completed) {
        this.cancel('reload');
        return;
      }
      const def = this.opts.getWeaponDef(e.weaponId);
      if (def?.audio.reload === 'shell' && def.fire.mode === 'pump') {
        this.schedule(0.05, 'reload.pumpBack', 'pump');
        this.schedule(0.2, 'reload.pumpForward', 'pump');
      }
    });
    on('weapon:swap', (e) => {
      if (e.phase === 'out') {
        this.cancel();
        this.play('swap.out');
      } else if (e.phase === 'in') this.play('swap.in');
    });
    on('weapon:ads', (e) => {
      if (e.active) this.play('ads.in');
      else if (!e.forced) this.play('ads.out');
    });
    on('weapon:melee', (e) => {
      if (e.phase === 'start') this.play('melee.swing');
      else if (e.phase === 'hit') this.play('melee.hit');
    });
    on('weapon:projectile', (e) => {
      if (e.phase === 'spawn') this.startEmitter(e.id, e.position);
      else this.stopEmitter(e.id);
    });
    on('weapon:explosion', (e) => this.play('explosion', 0, e.point));
    on('weapon:hitscan', (e) => {
      if (!e.hitWorld) return;
      this.play('impact', 0, e.end, IMPACT_RATE[e.surface ?? ''] ?? 1);
    });

    // ── 戰鬥回饋 ──
    on('combat:hit', (e) => this.play(e.kind === 'kill' ? 'hit.kill' : e.kind === 'crit' ? 'hit.crit' : 'hit'));
    on('player:damaged', (e) => {
      if (e.blocked) {
        this.play('hurt.shield', cfg.blockedHurtDb);
        return;
      }
      if (e.shieldBroken) this.play('shieldBreak');
      if (e.healthDamage > 0) this.play('hurt.health');
      else if (e.shieldDamage > 0 && !e.shieldBroken) this.play('hurt.shield');
    });
    on('player:shield', (e) => {
      if (e.phase === 'recharge') this.play('shieldRecharge');
    });
    on('player:died', () => {
      this.cancel();
      this.play('death');
    });
    on('player:revived', () => this.play('revive'));
    on('target:killed', (e) => {
      if (e.kind === 'drone') this.play('explosion.small', 0, e.point);
    });
    on('enemy:fire', (e) => this.play('enemy.fire', 0, e.position));
    on('enemy:projectile', (e) => {
      if (e.phase === 'impact') this.play('enemy.impact', 0, e.position);
      else if (e.phase === 'hitPlayer') this.play('enemy.impact', -6, e.position);
    });

    // ── 移動 ──
    on('player:footstep', (e) => this.play(footstepSoundId(e.surface), speedGainDb(e.speed, cfg.stepMinSpeed, cfg.stepMaxSpeed, cfg.stepQuietDb)));
    on('player:jump', () => this.play('jump'));
    on('player:doubleJump', () => this.play('doubleJump'));
    on('player:land', (e) => {
      const s = landingSound(e.impactSpeed, cfg);
      if (!s) return;
      this.play(s.id, s.gainDb);
      this.play(footstepSoundId(e.surface), cfg.landStepDb + s.gainDb);
    });
    on('player:slideStart', (e) => this.play('slide.start', e.boosted ? 0 : -5));
    on('player:wallJump', () => this.play('wallJump'));
    on('player:mantle', () => this.play('mantle'));
    on('player:dash', () => this.play('dash'));
    on('player:grappleFire', () => this.play('grapple.fire'));
    on('player:grappleAttach', () => this.play('grapple.attach'));
    on('player:grappleRelease', () => this.play('grapple.release'));
    on('player:grappleMiss', () => this.play('grapple.release', -4));
    on('player:abilityReady', (e) => {
      if (cfg.abilityReadyCue && e.ability !== 'jet') this.play('abilityReady');
    });
  }

  private startEmitter(projectile: number, pos: Readonly<Vec3Like>): void {
    let pick: Emitter | null = null;
    for (const em of this.emitters) {
      if (em.projectile < 0) {
        pick = em;
        break;
      }
      if (!pick || em.since < pick.since) pick = em;
    }
    if (!pick) return;
    pick.projectile = projectile;
    pick.since = this.clock;
    pick.handle.setPosition(pos.x, pos.y, pos.z);
    pick.handle.set(1);
  }

  private stopEmitter(projectile: number): void {
    for (const em of this.emitters) {
      if (em.projectile !== projectile) continue;
      em.projectile = -1;
      em.handle.stop();
    }
  }

  fixedUpdate(dt: number): void {
    this.clock += dt;
    for (const c of this.cues) {
      if (!c.active || c.time > this.clock + 1e-9) continue;
      c.active = false;
      this.play(c.id, c.gainDb);
    }
  }

  update(dt: number, _frame?: Readonly<FrameInfo>): void {
    const cfg = this.config;
    const L = this.loops;
    const playing = this.opts.getMode() === 'playing';
    const p = playing ? this.opts.getPlayer() : null;
    if (!p) {
      L.jet.set(0);
      L.slide.set(0);
      L.wallRun.set(0);
      L.reel.set(0);
      L.wind.set(0);
      if (!playing) for (const em of this.emitters) em.handle.set(0);
    } else {
      L.jet.set(p.abilities.jet.active ? 1 : 0);
      L.slide.set(p.state === 'slide' ? dbToGain(speedGainDb(p.speed, cfg.slideMinSpeed, cfg.slideMaxSpeed, cfg.slideQuietDb)) : 0);
      L.wallRun.set(p.state === 'wallRun' ? 1 : 0);
      if (p.wallRunSide) L.wallRun.setPan(p.wallRunSide === 'left' ? -cfg.wallRunPan : cfg.wallRunPan);
      const attached = p.abilities.grapple.phase === 'attached';
      L.reel.set(attached ? 1 : 0, 1 + p.speed * cfg.reelRatePerSpeed);
      const v = p.velocity;
      const w = windLevel(Math.hypot(v.x, v.y, v.z), cfg, this.wind);
      L.wind.set(w.gain, w.rate);
    }
    // 電漿球：跟著投射物移動；找不到（已結束）就停
    if (playing) {
      for (const em of this.emitters) {
        if (em.projectile < 0) continue;
        if (this.opts.getProjectilePosition?.(em.projectile, this.tmp)) {
          em.handle.setPosition(this.tmp.x, this.tmp.y, this.tmp.z);
          em.handle.set(1);
        } else if (this.opts.getProjectilePosition) {
          em.projectile = -1;
          em.handle.stop();
        }
      }
    }
    // 低生命心跳（模擬時間：暫停時停）
    const h = playing ? this.opts.getHealth?.() : null;
    const hb = h ? heartbeat(h.healthFraction, h.alive, cfg) : null;
    if (!hb) this.heartbeatTimer = 0;
    else if (dt > 0) {
      this.heartbeatTimer -= dt;
      if (this.heartbeatTimer <= 0) {
        this.play('heartbeat', hb.gainDb);
        this.heartbeatTimer = hb.interval;
      }
    }
    this.opts.sink.update?.();
  }

  dispose(): void {
    for (const off of this.offs) off();
    this.offs.length = 0;
  }
}
