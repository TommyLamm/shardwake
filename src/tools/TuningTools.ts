// 調校工具的組裝（M1-15）：預設組合、錄製重播與鬼影、計時賽、示範、調參面板「工具」資料夾、管理對話框、HUD 狀態。
// main.ts 呼叫 setupTuningTools(deps) 一次；各部分的邏輯在同資料夾的模組（可無頭測試），這裡只負責接線與介面文字。
//
// 調參面板「工具」：
//   錄製重播  開始／停止錄製（F8）、重播／停止（F9）、套用錄製時的參數、清除鬼影；監看（狀態、長度、時間差、終點差）
//   計時賽    重來（T）、清除最佳成績；監看（狀態、時間、最佳、指紋）
//   預設組合  套用內建組合、開啟管理對話框（存檔、刪除、匯出、匯入）
//   慢動作    0.1×–1×（= 核心/主迴圈的時間倍率；重播結果不受影響）
//   傳送      各分區起點、計時賽起點
//   設定      TOOLS_CONFIG
import type * as THREE from 'three';
import type { EventBus } from '@/core/EventBus';
import type { GameEvents } from '@/core/events';
import type { Game } from '@/core/Game';
import type { GameStorage } from '@/core/Storage';
import type { DebugPanel } from '@/debug/DebugPanel';
import { registerWarmup } from '@/fx/Warmup';
import { t } from '@/i18n';
import type { InputSystem } from '@/input/Input';
import type { PlayerController } from '@/player/PlayerController';
import { ClipStore } from '@/tools/ClipStore';
import { clipDuration, serializeClip, type InputClip } from '@/tools/clip';
import { DemoRunner, type DemoReport } from '@/tools/demo';
import { BUILTIN_PRESETS, parsePresetJson, PresetStore, serializePreset } from '@/tools/Presets';
import { ReplaySystem, type ReplayResult } from '@/tools/Replay';
import { createGameReplayHost, type GameReplayHostOptions } from '@/tools/replayHost';
import { BestTimes, courseFromCheckpoints, TimeTrialSystem, type CourseDef, type TimeTrialResult } from '@/tools/TimeTrial';
import { ToolsDialog, type ToolsDialogActions } from '@/tools/ToolsDialog';
import { DEMO_TOOL_PANEL, REPLAY_TOOL_PANEL, SLOW_MOTION_RANGE, TOOLS_CONFIG, TRIAL_TOOL_PANEL } from '@/tools/ToolsConfig';
import { CourseRings, GhostPaths } from '@/tools/ToolVisuals';
import {
  applyTuning,
  currentTuningDiff,
  gameTuningTargets,
  isStandardTuning,
  tuningFingerprint,
  type TuningTargets,
  type TuningValues,
} from '@/tools/tuning';
import type { Hud } from '@/ui/Hud';
import { formatDelta, formatTimer, type TimerState } from '@/ui/hudMath';
import { TextWidget, type MessagesWidget } from '@/ui/hud/InfoWidgets';
import type { WeaponManager } from '@/weapons/WeaponManager';
import type { DataLevel } from '@/world/Level';
import type { Zone } from '@/world/LevelData';
import { PARKOUR_COURSE } from '@/world/levels/TrainingGround';

/** 出生資料（腳底位置、yaw 弧度）。 */
export interface Spawn {
  pos: THREE.Vector3;
  yaw: number;
}

export interface TuningToolsDeps {
  game: Game;
  bus: EventBus<GameEvents>;
  storage: GameStorage;
  panel: DebugPanel;
  input: InputSystem;
  scene: THREE.Scene;
  container: HTMLElement;
  player: PlayerController;
  weapons: WeaponManager;
  /** 武器面板（套用組合後重新整理）。 */
  weaponPanel?: { refresh(): void } | null;
  health: GameReplayHostOptions['health'];
  targets: GameReplayHostOptions['targets'];
  ballistics: GameReplayHostOptions['ballistics'];
  getLevel: () => DataLevel | null;
  /** 玩家控制中（不在除錯飛行、遊玩模式）。 */
  isActive: () => boolean;
  getSettings: () => { readonly autoSprint: boolean };
  setSimSettings: (s: Readonly<{ autoSprint: boolean }> | null) => void;
  /** 把玩家送到指定位置（結束除錯飛行、清掉投射物與畫面效果）。 */
  resetPlayerTo: (target: Spawn) => void;
  /** 傳送目前操控的對象（玩家或自由相機）。 */
  teleport: (target: Spawn) => void;
  /** 起始狀態套用後清掉畫面效果（傷害數字、受擊畫面等）。 */
  clearEffects?: () => void;
  hud: Hud;
  timer: TimerState;
  messages: MessagesWidget;
  keyLabel: (action: 'recordToggle' | 'replayToggle' | 'restartCourse') => string;
  /** 內建示範錄影（#demo）。 */
  demoClip?: unknown;
  gameVersion: string;
  makeVector: (x: number, y: number, z: number) => THREE.Vector3;
}

export interface TuningTools {
  replay: ReplaySystem;
  trial: TimeTrialSystem;
  presets: PresetStore;
  clips: ClipStore;
  best: BestTimes;
  dialog: ToolsDialog;
  demo: DemoRunner | null;
  tuning: TuningTargets;
  applyPreset(name: string): string;
  /** 開始示範（#demo）。 */
  startDemo(): boolean;
  toggleRecord(): void;
  toggleReplay(): void;
  /** 計時賽：回到起點待命。 */
  restartCourse(): boolean;
}

const fmtMeters = (m: number): string => (m < 0.01 ? `${(m * 1000).toFixed(1)} mm` : `${m.toFixed(2)} m`);

export function setupTuningTools(d: TuningToolsDeps): TuningTools {
  const { game, bus, panel, input } = d;
  const cfg = TOOLS_CONFIG;

  // ── 預設組合 ────────────────────────────────────────
  const tuning = gameTuningTargets({
    getWeaponDefs: () => d.weapons.slots.flatMap((w) => (w ? [w.def] : [])),
    setWeaponDef: (id, def) => {
      const w = d.weapons.slots.find((x) => x?.id === id);
      if (w) w.def = def;
    },
  });
  const presets = new PresetStore(d.storage);
  const afterTuningChange = (): void => {
    panel.refreshAll();
    d.weaponPanel?.refresh();
  };
  const applyValues = (values: TuningValues, label: string): string => {
    const r = applyTuning(tuning, values);
    afterTuningChange();
    if (r.warnings.length > 0) console.warn(`[shardwake] 套用「${label}」的警告：\n${r.warnings.join('\n')}`);
    return `已套用「${label}」（改變 ${r.changed} 項${r.warnings.length > 0 ? `，${r.warnings.length} 個警告見主控台` : ''}）`;
  };
  const applyPreset = (name: string): string => {
    const p = presets.get(name);
    return p ? applyValues(p.values, p.name) : `找不到組合「${name}」`;
  };

  // ── 錄製重播 ────────────────────────────────────────
  let trialRef: TimeTrialSystem | null = null;
  const host = createGameReplayHost({
    player: d.player,
    view: input.view,
    weapons: d.weapons,
    health: d.health,
    targets: d.targets,
    ballistics: d.ballistics,
    getLevel: d.getLevel,
    isActive: d.isActive,
    getSettings: d.getSettings,
    setSimSettings: d.setSimSettings,
    getTuningDiff: () => currentTuningDiff(tuning),
    onApplied: () => {
      trialRef?.reset();
      d.clearEffects?.();
    },
  });
  const replay = new ReplaySystem({ input, loop: game.loop, host, bus, gameVersion: d.gameVersion });
  const clips = new ClipStore(d.storage, () => cfg.replay.maxSavedClips);
  game.addSystem(replay);

  // ── 計時賽 ──────────────────────────────────────────
  let courseCache: { level: DataLevel; course: CourseDef | null } | null = null;
  const getCourse = (): CourseDef | null => {
    const level = d.getLevel();
    if (!level) return null;
    if (courseCache?.level !== level) {
      const r = PARKOUR_COURSE.restart;
      courseCache = {
        level,
        course: courseFromCheckpoints(
          level.data.checkpoints,
          PARKOUR_COURSE.id,
          PARKOUR_COURSE.name,
          { pos: d.makeVector(r.pos[0], r.pos[1], r.pos[2]), yaw: (r.yaw * Math.PI) / 180 },
          (cp, i, n) => PARKOUR_COURSE.labels[cp.id] ?? (i === 0 ? '起點' : i === n - 1 ? '終點' : `${i}/${n - 2}`),
        ),
      };
    }
    return courseCache.course;
  };
  const best = new BestTimes(d.storage);
  const trial = new TimeTrialSystem({
    getFrame: () => input.frame,
    getCenter: (out) => {
      if (!d.isActive()) return null;
      const p = d.player.position;
      out.x = p.x;
      out.y = p.y + d.player.height / 2;
      out.z = p.z;
      return out;
    },
    getCourse,
    getLevelId: () => d.getLevel()?.id ?? null,
    restartPlayer: (target) => d.resetPlayerTo({ pos: d.makeVector(target.pos.x, target.pos.y, target.pos.z), yaw: target.yaw }),
    timer: d.timer,
    best,
    isReplay: () => replay.replaying,
    getTuning: () => {
      const diff = currentTuningDiff(tuning);
      return { fingerprint: tuningFingerprint(diff), standard: isStandardTuning(diff) };
    },
    getHz: () => game.loop.config.hz,
    bus,
    gameVersion: d.gameVersion,
  });
  trialRef = trial;
  game.addSystem(trial);

  // ── 3D 顯示 ─────────────────────────────────────────
  const rings = new CourseRings(d.scene, trial);
  const ghost = new GhostPaths(d.scene, replay);
  for (const m of [...Object.values(rings.materials), ghost.originalMaterial, ghost.newMaterial, ghost.markerMaterial]) registerWarmup(m);
  game.addSystem(rings);
  game.addSystem(ghost);

  // ── HUD 與提示訊息 ──────────────────────────────────
  const msg = (text: string, tone: 'info' | 'good' | 'warn' = 'info', key = 'tools', duration?: number): void =>
    d.messages.push(text, { key, tone, ...(duration ? { duration } : {}) });
  d.hud.add(
    new TextWidget({
      id: 'replayStatus',
      anchor: 'top',
      order: 2,
      className: 'sw-replay-status',
      read: () => {
        if (replay.recording) {
          return t('hud.replay.recording', { time: formatTimer(replay.recordedSeconds), key: d.keyLabel('recordToggle'), replayKey: d.keyLabel('replayToggle') });
        }
        if (replay.replaying && replay.clip) {
          return t('hud.replay.playing', {
            time: formatTimer(replay.replayStep / replay.clip.hz),
            total: formatTimer(clipDuration(replay.clip)),
            delta: formatDelta(replay.timeDelta),
          });
        }
        return null;
      },
    }),
  );
  const describeResult = (r: ReplayResult): string =>
    t('hud.replay.done', { error: r.finalError !== null ? fmtMeters(r.finalError) : '—', delta: formatDelta(r.timeDelta) });
  let demo: DemoRunner | null = null;
  replay.onChange((phase, result) => {
    document.documentElement.dataset.swReplay = phase;
    if (phase === 'recording') msg(t('hud.replay.recStart', { key: d.keyLabel('recordToggle') }), 'info');
    if (phase === 'idle' && !result && replay.clip) {
      msg(t('hud.replay.recStop', { seconds: clipDuration(replay.clip).toFixed(1), key: d.keyLabel('replayToggle') }), 'good');
      dialog.refresh();
    }
    if (phase === 'idle' && result && !(demo && demo.state === 'running')) {
      msg(result.completed ? describeResult(result) : t('hud.replay.stopped'), result.completed ? 'good' : 'info', 'tools', 6);
      if (result.completed) console.info(`[shardwake] 重播結束：${result.steps} 步、終點差 ${result.finalError?.toExponential(3)} m、時間差 ${result.timeDelta.toFixed(3)} s`);
    }
  });
  bus.on('course:start', () => msg(t('hud.trial.start'), 'good', 'trial', 1.5));
  bus.on('course:reset', () => msg(t('hud.trial.reset', { key: d.keyLabel('restartCourse') }), 'info', 'trial'));
  bus.on('course:split', (e) => {
    const s = trial.run?.splits[e.index - 1];
    msg(t('hud.trial.split', { label: s?.label ?? '', time: formatTimer(e.time), delta: e.delta !== null ? `（${formatDelta(e.delta)}）` : '' }), e.delta !== null && e.delta > 0 ? 'warn' : 'info', 'trial', 2.5);
  });
  bus.on('course:finish', (r: TimeTrialResult) => {
    const delta = r.previousBest !== null ? `（${formatDelta(r.time - r.previousBest)}）` : '';
    const text = r.isBest ? t('hud.trial.newBest', { time: formatTimer(r.time), delta }) : t('hud.trial.finish', { time: formatTimer(r.time), delta });
    msg(`${text}${r.replay ? t('hud.trial.replay') : ''}`, r.isBest ? 'good' : 'info', 'trial', 6);
    console.info(`[shardwake] 計時賽完成：${r.time.toFixed(3)} s（${r.standard ? '標準參數' : `自訂參數 ${r.tuning}`}${r.replay ? '、重播' : ''}${r.isBest ? '、新紀錄' : ''}）`);
  });

  // ── 錄製／重播按鍵（即時動作，任何模式都會收到；只在遊玩中動作）──
  const toggleRecord = (): void => {
    if (replay.replaying) {
      msg(t('hud.replay.busy', { key: d.keyLabel('replayToggle') }), 'warn');
      return;
    }
    if (replay.recording) {
      replay.stopRecording();
      return;
    }
    if (!replay.startRecording()) msg(t('hud.replay.cannot', { reason: '需要在遊玩中、玩家控制中（不能在除錯飛行時）' }), 'warn');
  };
  const toggleReplay = (): void => {
    if (replay.replaying) {
      replay.stop('user');
      return;
    }
    if (!replay.clip && !replay.recording) {
      msg(t('hud.replay.none', { key: d.keyLabel('recordToggle') }), 'warn');
      return;
    }
    const r = replay.startReplay();
    if (!r.ok) msg(t('hud.replay.cannot', { reason: r.error ?? '' }), 'warn');
  };
  input.onAction('recordToggle', () => {
    if (game.mode === 'playing') toggleRecord();
  });
  input.onAction('replayToggle', () => {
    if (game.mode === 'playing') toggleReplay();
  });

  // ── 管理對話框 ──────────────────────────────────────
  const safeName = (s: string): string => s.replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 40) || 'export';
  const actions: ToolsDialogActions = {
    presets: () => presets.all.map((p) => ({ name: p.name, detail: p.builtin ? '（內建）' : (p.savedAt?.slice(0, 10) ?? '') })),
    clips: () => clips.list.map((c) => ({ name: c.name, detail: `${c.seconds.toFixed(1)} s・${Math.ceil(c.bytes / 1024)} KB` })),
    applyPreset,
    deletePreset: (name) => {
      const r = presets.remove(name);
      return r.ok ? `已刪除「${name}」${r.persistent ? '' : '（只在記憶體）'}` : (r.error ?? '刪除失敗');
    },
    savePreset: (name) => {
      const r = presets.save(name, currentTuningDiff(tuning));
      if (!r.ok) return r.error ?? '儲存失敗';
      return r.persistent ? `已存成「${name.trim()}」` : `已存成「${name.trim()}」，但無法寫入本機儲存（${r.error ?? '儲存不可用'}），只保留到關閉頁面`;
    },
    exportPreset: (name) => {
      if (name === null) {
        const text = serializePreset({ name: '目前數值', values: currentTuningDiff(tuning) }, d.gameVersion);
        return { text, filename: 'shardwake-preset.json' };
      }
      const p = presets.get(name);
      if (!p) return '請先選擇組合';
      return { text: serializePreset(p, d.gameVersion), filename: `shardwake-preset-${safeName(p.name)}.json` };
    },
    importPreset: (text, apply) => {
      const r = parsePresetJson(text.trim());
      if (!r.ok || !r.preset) return `匯入失敗：${r.errors.join('；')}`;
      let name = r.preset.name;
      if (BUILTIN_PRESETS.some((b) => b.name === name)) name = `${name}（匯入）`;
      const s = presets.save(name, r.preset.values);
      if (!s.ok) return s.error ?? '匯入失敗';
      return `已匯入「${name}」${s.persistent ? '' : '（只在記憶體）'}${apply ? `；${applyValues(r.preset.values, name)}` : ''}`;
    },
    loadClip: (name) => {
      const r = clips.read(name);
      if (!r.clip) return `讀取失敗：${r.error ?? ''}`;
      const l = replay.load(r.clip);
      return l.ok ? `已載入「${name}」（按 F9 重播）` : `載入失敗：${l.errors.join('；')}`;
    },
    deleteClip: (name) => (clips.remove(name) ? `已刪除「${name}」` : '找不到這段錄影'),
    saveClip: (name) => {
      const clip = replay.clip;
      if (!clip) return '沒有錄影：先按 F8 錄製';
      const r = clips.save(name, clip);
      return r.ok ? `已儲存「${name.trim()}」${r.persistent ? '' : '（只在記憶體）'}` : `儲存失敗：${r.error ?? ''}`;
    },
    exportClip: (name) => {
      let clip: InputClip | null = replay.clip;
      if (name !== null) {
        const r = clips.read(name);
        if (!r.clip) return `讀取失敗：${r.error ?? ''}`;
        clip = r.clip;
      }
      if (!clip) return '沒有錄影：先按 F8 錄製';
      return { text: serializeClip(clip), filename: `shardwake-replay-${safeName(clip.name)}.json` };
    },
    importClip: (text) => {
      const l = replay.load(text.trim());
      return l.ok ? `已匯入為目前錄影「${replay.clip?.name ?? ''}」（按 F9 重播）` : `匯入失敗：${l.errors.join('；')}`;
    },
    currentClipName: () => replay.clip?.name ?? null,
  };
  const dialog = new ToolsDialog(d.container, actions);

  // ── 調參面板「工具」──────────────────────────────────
  panel.bindButtons(
    '工具/錄製重播',
    [
      { title: '開始／停止錄製（F8）', onClick: toggleRecord },
      { title: '重播／停止（F9）', onClick: toggleReplay },
      {
        title: '套用錄製時的參數',
        onClick: () => {
          const c = replay.clip;
          msg(c ? applyValues(c.tuning, `「${c.name}」錄製時的參數`) : '沒有錄影', c ? 'good' : 'warn');
        },
      },
      { title: '清除鬼影', onClick: () => replay.clearGhost() },
      { title: '管理錄影與預設組合…', onClick: () => dialog.open() },
    ],
    { expanded: true },
  );
  const replayMonitor = { phase: '', clip: '', delta: '', result: '' };
  panel.bindConfig('工具/錄製重播', replayMonitor, {
    phase: { label: '狀態', readonly: true },
    clip: { label: '目前錄影', readonly: true },
    delta: { label: '鬼影時間差', readonly: true },
    result: { label: '上次重播', readonly: true },
  });
  panel.bindButtons('工具/計時賽', [
    { title: '重來（T）', onClick: () => void restartCourse() },
    { title: '清除最佳成績', onClick: () => trial.clearBest() },
  ]);
  const trialMonitor = { phase: '', time: '', best: '', tuning: '' };
  panel.bindConfig('工具/計時賽', trialMonitor, {
    phase: { label: '狀態', readonly: true },
    time: { label: '時間', readonly: true },
    best: { label: '最佳', readonly: true },
    tuning: { label: '調參指紋', readonly: true, description: '標準參數以外的成績不會上排行榜（M5-05）' },
  });
  panel.bindButtons(
    '工具/預設組合',
    [
      ...BUILTIN_PRESETS.map((p) => ({ title: `套用「${p.name}」`, onClick: () => msg(applyPreset(p.name), 'good') })),
      { title: '管理預設組合（存檔、匯出、匯入）…', onClick: () => dialog.open() },
    ],
  );
  const slow = {
    get timeScale(): number {
      return Math.min(SLOW_MOTION_RANGE.max, Math.max(SLOW_MOTION_RANGE.min, game.loop.timeScale));
    },
    set timeScale(v: number) {
      game.loop.timeScale = v;
    },
  };
  panel.bindConfig('工具/慢動作', slow, {
    timeScale: { label: '速度', ...SLOW_MOTION_RANGE, description: '0.1×–1×；錄製與重播的結果不受影響（固定步）' },
  });
  panel.bindButtons('工具/慢動作', [
    { title: '0.25×', onClick: () => (game.loop.timeScale = 0.25) },
    { title: '0.5×', onClick: () => (game.loop.timeScale = 0.5) },
    { title: '1×', onClick: () => (game.loop.timeScale = 1) },
  ]);
  let teleportBinding: { dispose(): void } | null = null;
  const bindTeleports = (): void => {
    teleportBinding?.dispose();
    const level = d.getLevel();
    const zones: readonly Zone[] = level?.data.zones ?? [];
    teleportBinding = panel.bindButtons('工具/傳送', [
      ...zones.flatMap((z) =>
        z.spawn
          ? [{ title: z.name, onClick: () => d.teleport({ pos: d.makeVector(z.spawn!.pos[0], z.spawn!.pos[1], z.spawn!.pos[2]), yaw: (z.spawn!.yaw * Math.PI) / 180 }) }]
          : [],
      ),
      { title: '計時賽起點', onClick: () => void restartCourse() },
    ]);
  };
  bindTeleports();
  bus.on('level:loaded', bindTeleports);
  panel.bindConfig('工具/設定/錄製重播', cfg.replay, REPLAY_TOOL_PANEL);
  panel.bindConfig('工具/設定/計時賽', cfg.trial, TRIAL_TOOL_PANEL);
  panel.bindConfig('工具/設定/示範', cfg.demo, DEMO_TOOL_PANEL);
  game.addSystem({
    name: 'toolsMonitor',
    order: 1300,
    update() {
      if (!panel.isOpen) return;
      replayMonitor.phase = replay.phase === 'recording' ? `錄製中 ${replay.recordedSeconds.toFixed(1)} s` : replay.phase === 'replaying' ? '重播中' : '待命';
      const c = replay.clip;
      replayMonitor.clip = c ? `${c.name}（${clipDuration(c).toFixed(1)} s）` : '—';
      replayMonitor.delta = replay.replaying ? formatDelta(replay.timeDelta) : '—';
      const r = replay.lastResult;
      replayMonitor.result = r ? (r.completed ? `終點差 ${r.finalError !== null ? fmtMeters(r.finalError) : '—'}・時間差 ${formatDelta(r.timeDelta)}` : '中途停止') : '—';
      const run = trial.run;
      trialMonitor.phase = run ? { idle: '待命', running: '計時中', finished: '完成' }[run.phase] : '沒有路線';
      trialMonitor.time = run ? formatTimer(run.time) : '—';
      trialMonitor.best = trial.best ? formatTimer(trial.best.time) : '—';
      const diff = currentTuningDiff(tuning);
      trialMonitor.tuning = isStandardTuning(diff) ? '標準' : tuningFingerprint(diff);
    },
  });

  // ── 計時賽重來與示範 ─────────────────────────────────
  const restartCourse = (): boolean => {
    if (replay.replaying) replay.stop('trial');
    const ok = trial.restart();
    if (!ok) msg('這個關卡沒有計時賽路線', 'warn', 'trial');
    return ok;
  };
  const root = document.documentElement;
  if (d.demoClip !== undefined) {
    demo = new DemoRunner({
      replay,
      clip: d.demoClip,
      applyStandard: () => void applyPreset('標準'),
      report: (r: Readonly<DemoReport>) => {
        root.dataset.swDemo = r.state;
        if (r.finalError !== null) root.dataset.swDemoError = (r.finalError * 1000).toFixed(3);
        root.dataset.swDemoCombo = r.missing === null ? 'ok' : `missing:${r.missing}`;
        if (r.state === 'running') msg(t('hud.demo.running'), 'info', 'demo', 6);
        else if (r.state === 'done') {
          msg(t('hud.demo.done', { error: fmtMeters(r.finalError ?? 0), key: d.keyLabel('replayToggle') }), 'good', 'demo', 8);
          console.info(`[shardwake] 示範完成：連招 ${r.missing === null ? '完整' : `缺少 ${r.missing}`}、終點誤差 ${((r.finalError ?? 0) * 1000).toFixed(3)} mm`);
        } else if (r.state === 'failed') {
          const reason = r.error ?? (r.missing ? `缺少 ${r.missing}` : `終點差 ${fmtMeters(r.finalError ?? 0)}`);
          msg(t('hud.demo.failed', { reason }), 'warn', 'demo', 10);
          console.warn(`[shardwake] 示範失準：${reason}（預設參數或關卡改了：npm run demo:record 重新錄製）`);
        }
      },
    });
  }

  return {
    replay,
    trial,
    presets,
    clips,
    best,
    dialog,
    demo,
    tuning,
    applyPreset,
    startDemo: () => demo?.start() ?? false,
    toggleRecord,
    toggleReplay,
    restartCourse,
  };
}
