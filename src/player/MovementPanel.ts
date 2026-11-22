// 調參面板「移動」資料夾：綁定 MovementConfig 的所有參數（含 M1-07 能力開關與能力參數），
// 並監看速度曲線、狀態、著地、地面法線、跑牆與攀爬、能力（二段跳、噴射燃料、Dash 充能、抓鉤）。
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
  wallRun: string;
  wallSensor: string;
  mantle: string;
  doubleJump: string;
  jetFuel: number;
  jet: string;
  dash: string;
  grapple: string;
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
    wallRun: '',
    wallSensor: '',
    mantle: '',
    doubleJump: '',
    jetFuel: 0,
    jet: '',
    dash: '',
    grapple: '',
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
      wallRun: { label: '跑牆', readonly: true },
      wallSensor: { label: '側牆偵測', readonly: true },
      mantle: { label: '攀爬', readonly: true },
      doubleJump: { label: '二段跳', readonly: true },
      jetFuel: { label: '噴射燃料', readonly: true, min: 0, max: 1, params: { view: 'graph' } },
      jet: { label: '噴射', readonly: true },
      dash: { label: 'Dash', readonly: true },
      grapple: { label: '抓鉤', readonly: true },
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
      m.wallRun = s.wallRunSide ? `${s.wallRunSide === 'left' ? '左' : '右'}牆 ${player.wallRunTime.toFixed(2)} s` : '—';
      const w = player.walls;
      const side = (c: typeof w.left): string => (c.found ? `${c.runnable ? '可跑' : '不可跑'} ${c.distance.toFixed(2)} m` : '—');
      m.wallSensor = `左 ${side(w.left)}／右 ${side(w.right)}`;
      m.mantle = s.mantleProgress > 0 ? `攀爬中 ${Math.round(s.mantleProgress * 100)}%（${player.mantle.height.toFixed(2)} m）` : '—';
      const a = s.abilities;
      m.doubleJump = a.doubleJump.enabled ? `剩 ${a.doubleJump.remaining}／${a.doubleJump.max}` : '關閉';
      m.jetFuel = a.jet.fraction;
      m.jet = a.jet.enabled
        ? `${a.jet.fuel.toFixed(2)}／${a.jet.capacity.toFixed(2)} s${a.jet.active ? '（推進中）' : a.jet.recharging ? '（回充中）' : ''}`
        : '關閉';
      m.dash = a.dash.enabled
        ? `${a.dash.charges}／${a.dash.maxCharges}${a.dash.charges < a.dash.maxCharges ? `（回充 ${Math.round(a.dash.rechargeProgress * 100)}%）` : ''}${a.dash.active ? ' Dash 中' : ''}`
        : '關閉';
      const g = a.grapple;
      m.grapple = g.enabled
        ? `${g.phase}${g.cooldown > 0 ? ` 冷卻 ${g.cooldown.toFixed(2)} s` : ''}${g.aimAvailable ? `（可勾取 ${g.aimDistance.toFixed(1)} m）` : ''}`
        : '關閉';
    },
  };
}
