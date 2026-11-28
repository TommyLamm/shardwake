// 示範錄影的產生器（M1-15）：在訓練場南側外牆（攀爬測試牆區，z ≈ 77、往東）以閉迴路腳本操作玩家，
// 依序做出「衝刺 → 滑鏟 → 滑鏟跳 → 跑牆 → 蹬牆跳 → 二段跳 → Dash → 抓鉤（東側外牆）」，用 ReplaySystem 錄成 InputClip。
// 只在重新產生 src/debug/demo-clip.json 時使用（npm run demo:record）；預設參數改動導致路線失準時重新產生即可。
import type { InputClip } from '@/tools/clip';
import type { ToolSim } from './toolSim';

const D = Math.PI / 180;
/** 面向東（+X）。yaw 0 面向 -Z、正值向左轉。 */
const EAST = -Math.PI / 2;

export const DEMO_START = { pos: { x: 20, y: 0, z: 78.3 }, yaw: EAST };
export const DEMO_SEQUENCE = ['slideStart', 'wallRunStart', 'wallJump', 'doubleJump', 'dash', 'grappleAttach'] as const;

export interface DemoBotResult {
  clip: InputClip | null;
  log: string[];
}

/** 以 120 fps（每畫面一步）執行，方便逐步決策。 */
export function recordDemo(sim: ToolSim): DemoBotResult {
  const log: string[] = [];
  const dt = 1 / 120;
  const p = sim.player;
  const st = (): string => p.machine.currentId;
  const speed = (): number => Math.hypot(p.velocity.x, p.velocity.z);
  const setView = (yaw: number, pitch = 0): void => sim.input.view.set(yaw, pitch);
  const stepUntil = (pred: () => boolean, maxSeconds: number, label: string): boolean => {
    const n = Math.round(maxSeconds / dt);
    for (let i = 0; i < n; i++) {
      sim.frame(dt);
      if (pred()) {
        log.push(`${label} @ ${sim.replay.recordedSeconds.toFixed(3)} s pos=(${p.position.x.toFixed(2)}, ${p.position.y.toFixed(2)}, ${p.position.z.toFixed(2)}) v=${speed().toFixed(2)} state=${st()}`);
        return true;
      }
    }
    log.push(`${label} 逾時 state=${st()} pos=(${p.position.x.toFixed(2)}, ${p.position.y.toFixed(2)}, ${p.position.z.toFixed(2)})`);
    return false;
  };
  const wait = (seconds: number): void => {
    const n = Math.round(seconds / dt);
    for (let i = 0; i < n; i++) sim.frame(dt);
  };

  p.teleport(DEMO_START.pos, DEMO_START.yaw);
  setView(EAST, 0);
  // 站穩後開始錄製（錄影的起點是地面靜止）。
  wait(0.5);
  if (!sim.replay.startRecording('示範：滑鏟 → 跑牆 → 蹬牆跳 → 二段跳 → Dash → 抓鉤')) return { clip: null, log: [...log, '無法開始錄製'] };
  wait(0.2);
  // 1. 衝刺。
  sim.key('KeyW', true);
  stepUntil(() => speed() > 10.3, 3, '衝刺');
  // 2. 滑鏟。
  sim.key('KeyC', true);
  stepUntil(() => st() === 'slide', 0.3, '滑鏟');
  wait(0.3);
  // 3. 往牆（右側，+Z）偏 20° 後滑鏟跳。
  setView(EAST - 20 * D, 0);
  wait(0.05);
  sim.key('KeyC', false);
  sim.key('Space', true);
  wait(dt);
  sim.key('Space', false);
  stepUntil(() => st() === 'wallRun', 1.2, '跑牆');
  // 4. 跑牆中看回沿牆方向，跑一段後往左前方蹬牆跳。
  setView(EAST, 0);
  wait(0.55);
  setView(EAST + 25 * D, 0);
  wait(dt);
  sim.tap('Space');
  stepUntil(() => st() === 'air', 0.2, '蹬牆跳');
  // 5. 接近頂點時二段跳。
  wait(0.32);
  sim.tap('Space');
  wait(0.18);
  // 6. 往前 Dash。
  setView(EAST + 10 * D, 0);
  wait(dt);
  sim.tap('ShiftLeft');
  stepUntil(() => st() === 'dash', 0.2, 'Dash');
  stepUntil(() => st() !== 'dash', 0.5, 'Dash 結束');
  // 7. 看向東側外牆上方，按住抓鉤。
  setView(EAST + 8 * D, 9 * D);
  wait(dt);
  sim.key('KeyF', true);
  stepUntil(() => st() === 'grapple', 0.8, '抓鉤附著');
  wait(0.9);
  sim.key('KeyF', false);
  sim.key('KeyW', false);
  wait(0.4);
  const clip = sim.replay.stopRecording();
  log.push(`錄影 ${clip?.steps ?? 0} 步、marks=${JSON.stringify(clip?.marks ?? [])}`);
  return { clip, log };
}
