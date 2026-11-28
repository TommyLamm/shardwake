// 錄製重播的遊戲介面實作（M1-15）：把玩家、視角、武器、玩家生命、靶標與關卡區域接到 ReplayHost。
// applyStart 只依起始狀態決定結果：玩家快照還原、視角與後座偏移、武器時間與亂數、靶標重建、生命回滿、
// 清掉投射物與能量球、立即更新所在區域（無人機交戰判斷讀上一步的區域）。
import type { Vec3Like } from '@/physics/Physics';
import type { PlayerController } from '@/player/PlayerController';
import type { ReplayStart } from '@/tools/clip';
import type { ReplayHost } from '@/tools/Replay';
import type { TuningValues } from '@/tools/tuning';
import type { WeaponManager } from '@/weapons/WeaponManager';

export interface GameReplayHostOptions {
  player: PlayerController;
  view: { readonly yaw: number; readonly pitch: number; set(yaw: number, pitch: number): void; setOffset(yaw: number, pitch: number): void };
  weapons?: Pick<WeaponManager, 'captureReplayState' | 'restoreReplayState'> | null;
  health?: { reset(): void } | null;
  targets?: { captureReplayState(): { time: number; rng: number }; restoreReplayState(s: { time: number; rng: number }): void } | null;
  ballistics?: { clear(): void } | null;
  /** 目前關卡（id 與區域追蹤）。 */
  getLevel: () => { readonly id: string; trackZone?(p: Readonly<Vec3Like>): unknown } | null;
  /** 現在能否錄製／重播（遊玩中、玩家控制中、不在除錯飛行）。 */
  isActive: () => boolean;
  getSettings: () => { readonly autoSprint: boolean };
  setSimSettings: (s: Readonly<{ autoSprint: boolean }> | null) => void;
  getTuningDiff: () => TuningValues;
  /** 起始狀態套用後的額外清理（畫面特效、傷害數字、計時賽等）。 */
  onApplied?: (start: Readonly<ReplayStart>) => void;
}

export function createGameReplayHost(o: GameReplayHostOptions): ReplayHost {
  return {
    get levelId(): string | null {
      return o.getLevel()?.id ?? null;
    },
    canRun: () => o.isActive(),
    captureStart(): ReplayStart {
      const level = o.getLevel();
      return {
        levelId: level?.id ?? '',
        yaw: o.view.yaw,
        pitch: o.view.pitch,
        player: o.player.captureSnapshot(),
        ...(o.weapons ? { weapons: o.weapons.captureReplayState() } : {}),
        ...(o.targets ? { targets: o.targets.captureReplayState() } : {}),
        settings: { autoSprint: o.getSettings().autoSprint },
      };
    },
    applyStart(start: Readonly<ReplayStart>): void {
      o.player.restoreSnapshot(start.player);
      o.view.set(start.yaw, start.pitch);
      o.view.setOffset(0, 0);
      o.health?.reset();
      o.ballistics?.clear();
      if (o.weapons && start.weapons) o.weapons.restoreReplayState(start.weapons);
      if (o.targets && start.targets) o.targets.restoreReplayState(start.targets);
      o.getLevel()?.trackZone?.(o.player.position);
      o.onApplied?.(start);
    },
    getFeet: () => o.player.position,
    setSimSettings: (s) => o.setSimSettings(s),
    getTuningDiff: () => o.getTuningDiff(),
  };
}
