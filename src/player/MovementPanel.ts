// 調參面板「移動」資料夾：綁定 MovementConfig 的所有參數，並監看速度曲線、狀態、著地與地面法線。
import { SystemOrder, type GameSystem } from '@/core/Game';
import type { DebugPanel } from '@/debug/DebugPanel';
import { MOVEMENT_PANEL } from '@/player/MovementConfig';
import type { PlayerController } from '@/player/PlayerController';

/** 監看值（面板定時讀取；由回傳的系統每畫面更新）。 */
export interface MovementMonitor {
  speedGraph: number;
  speed: number;
  verticalSpeed: number;
  state: string;
  grounded: boolean;
  groundNormal: string;
  surface: string;
  crouch: number;
  headBlocked: boolean;
  slideBoostReady: string;
  lastTransition: string;
  position: string;
}

/**
 * 把 MOVEMENT_PANEL 的每組參數與監看值註冊到面板；回傳更新監看值的 Game 系統（order = debug）。
 * 監看值只在面板開啟時更新。
 */
export function bindMovementPanel(panel: DebugPanel, player: PlayerController): GameSystem {
  for (const group of MOVEMENT_PANEL) panel.bindConfig(group.folder, player.config, group.schema);
  const m: MovementMonitor = {
    speedGraph: 0,
    speed: 0,
    verticalSpeed: 0,
    state: '',
    grounded: false,
    groundNormal: '',
    surface: '',
    crouch: 0,
    headBlocked: false,
    slideBoostReady: '',
    lastTransition: '',
    position: '',
  };
  panel.bindConfig(
    '移動/監看',
    m,
    {
      speedGraph: { label: '水平速度', readonly: true, min: 0, max: 25, params: { view: 'graph' } },
      speed: { label: '水平 m/s', readonly: true },
      verticalSpeed: { label: '垂直 m/s', readonly: true },
      state: { label: '狀態', readonly: true },
      grounded: { label: '著地', readonly: true },
      groundNormal: { label: '地面法線', readonly: true },
      surface: { label: '表面', readonly: true },
      crouch: { label: '蹲下程度', readonly: true },
      headBlocked: { label: '頭頂受阻', readonly: true },
      slideBoostReady: { label: '滑鏟推進', readonly: true },
      lastTransition: { label: '最近轉換', readonly: true },
      position: { label: '腳底位置', readonly: true },
    },
    { expanded: true },
  );
  return {
    name: 'movementMonitor',
    order: SystemOrder.debug,
    update() {
      if (!panel.isOpen) return;
      const s = player.state;
      const n = s.groundNormal;
      m.speed = Math.round(s.speed * 100) / 100;
      m.speedGraph = s.speed;
      m.verticalSpeed = Math.round(s.velocity.y * 100) / 100;
      m.state = s.state;
      m.grounded = s.grounded;
      m.groundNormal = `${n.x.toFixed(2)}, ${n.y.toFixed(2)}, ${n.z.toFixed(2)}`;
      m.surface = s.surface ?? '—';
      m.crouch = Math.round(s.crouchAmount * 100) / 100;
      m.headBlocked = player.headBlocked;
      const remain = player.config.slideBoostCooldown - player.slideBoostTimer;
      m.slideBoostReady = remain > 0 ? `冷卻 ${remain.toFixed(2)} s` : '可推進';
      m.lastTransition = player.machine.lastTransition;
      const p = s.position;
      m.position = `${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)}`;
    },
  };
}
