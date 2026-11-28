// 調參面板「戰鬥」（M1-12）：靶標血量與行為、無人機開關與數量、玩家護盾／生命與無敵模式、命中回饋與受擊鏡頭數值、
// DPS 計與監看、測試按鈕（模擬受擊方向、護盾破裂、死亡、重置靶標）。
import type { PlayerHealth } from '@/combat/PlayerHealth';
import { PLAYER_HEALTH_PANEL } from '@/combat/PlayerHealth';
import { DRONE_PANEL, DUMMY_PANEL, FLASH_PANEL, MOVER_PANEL } from '@/combat/targets/TargetConfig';
import type { TargetManager } from '@/combat/targets/TargetManager';
import { createDamageInfo } from '@/combat/Damage';
import type { EventBus } from '@/core/EventBus';
import type { GameEvents } from '@/core/events';
import { SystemOrder, type GameSystem } from '@/core/Game';
import type { DebugPanel } from '@/debug/DebugPanel';
import type { Vec3Like } from '@/physics/Physics';
import {
  DAMAGE_NUMBER_PANEL,
  HIT_CAMERA_PANEL,
  HIT_MARKER_PANEL,
  INDICATOR_PANEL,
  SCREEN_DAMAGE_PANEL,
  type FeedbackConfig,
} from '@/ui/FeedbackConfig';

export interface CombatPanelOptions {
  panel: DebugPanel;
  bus: EventBus<GameEvents>;
  targets: TargetManager;
  health: PlayerHealth;
  feedback: FeedbackConfig;
  /** 設定「訓練無人機」讀寫。 */
  getDronesEnabled: () => boolean;
  setDronesEnabled: (on: boolean) => void;
  /** 玩家中心與視角（測試按鈕：從左／右／前／後打玩家）。 */
  getPlayerCenter: () => Readonly<Vec3Like> | null;
  getYaw: () => number;
}

export interface CombatMonitor {
  shield: string;
  health: string;
  dps: number;
  total: number;
  critRate: string;
  hits: number;
  drones: string;
  bolts: number;
  engaged: boolean;
}

/** 註冊「戰鬥」資料夾；回傳更新監看值的 Game 系統（只在面板開啟時更新）。 */
export function bindCombatPanel(o: CombatPanelOptions): GameSystem & { testHit(side: 'left' | 'right' | 'front' | 'back', amount: number): void } {
  const { panel, targets, health, feedback } = o;
  const apply = (): void => targets.applyConfig();
  panel.bindConfig('戰鬥/靶標/假人與移動靶', targets.config.dummy, DUMMY_PANEL, { onChange: apply });
  panel.bindConfig('戰鬥/靶標/移動靶', targets.config.mover, MOVER_PANEL);
  const droneToggle = { enabled: o.getDronesEnabled() };
  const droneBinding = panel.bindConfig(
    '戰鬥/靶標/無人機',
    droneToggle,
    { enabled: { label: '啟用（設定）', description: '與「設定/訓練無人機」相同' } },
    { onChange: (_k, v) => o.setDronesEnabled(Boolean(v)) },
  );
  panel.bindConfig('戰鬥/靶標/無人機', targets.config.drone, DRONE_PANEL, { onChange: apply });
  panel.bindConfig('戰鬥/靶標/閃白', targets.config.flash, FLASH_PANEL);
  panel.bindConfig('戰鬥/玩家', health.config, PLAYER_HEALTH_PANEL);
  panel.bindConfig('戰鬥/回饋/命中標記', feedback.hitMarker, HIT_MARKER_PANEL);
  panel.bindConfig('戰鬥/回饋/傷害數字', feedback.numbers, DAMAGE_NUMBER_PANEL);
  panel.bindConfig('戰鬥/回饋/受擊方向', feedback.indicator, INDICATOR_PANEL);
  panel.bindConfig('戰鬥/回饋/畫面', feedback.screen, SCREEN_DAMAGE_PANEL);
  panel.bindConfig('戰鬥/回饋/受擊鏡頭', feedback.camera, HIT_CAMERA_PANEL);
  const m: CombatMonitor = { shield: '', health: '', dps: 0, total: 0, critRate: '', hits: 0, drones: '', bolts: 0, engaged: false };
  panel.bindConfig(
    '戰鬥/監看',
    m,
    {
      shield: { label: '護盾', readonly: true },
      health: { label: '生命', readonly: true },
      dps: { label: 'DPS（5 s）', readonly: true },
      total: { label: '總傷害', readonly: true },
      critRate: { label: '爆頭率', readonly: true },
      hits: { label: '命中數', readonly: true },
      drones: { label: '無人機（存活／啟用）', readonly: true },
      bolts: { label: '能量球', readonly: true },
      engaged: { label: '戰區交戰中', readonly: true },
    },
    { expanded: true },
  );
  const info = createDamageInfo();
  const testHit = (side: 'left' | 'right' | 'front' | 'back', amount: number): void => {
    const c = o.getPlayerCenter();
    if (!c) return;
    const yaw = o.getYaw();
    // 視角 forward = (-sin, -cos)、right = (cos, -sin)：來源放在玩家的那一側 10 m。
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    const rx = Math.cos(yaw);
    const rz = -Math.sin(yaw);
    const [ax, az] = side === 'left' ? [-rx, -rz] : side === 'right' ? [rx, rz] : side === 'front' ? [fx, fz] : [-fx, -fz];
    const dist = 10;
    info.amount = amount;
    info.point.x = c.x;
    info.point.y = c.y;
    info.point.z = c.z;
    info.dir.x = -ax;
    info.dir.y = 0;
    info.dir.z = -az;
    info.normal.x = ax;
    info.normal.y = 0;
    info.normal.z = az;
    info.distance = dist;
    info.source = 'debug';
    info.weaponId = 'debug';
    info.kind = 'projectile';
    info.target = health;
    info.isCrit = false;
    info.isKill = false;
    const out = health.applyDamage(info);
    info.isKill = out.killed;
    o.bus.emit('combat:damage', info);
  };
  panel.bindButtons('戰鬥/測試', [
    { title: '從左邊受擊 20', onClick: () => testHit('left', 20) },
    { title: '從右邊受擊 20', onClick: () => testHit('right', 20) },
    { title: '從前方受擊 20', onClick: () => testHit('front', 20) },
    { title: '從背後受擊 20', onClick: () => testHit('back', 20) },
    { title: '受擊 60（打破護盾）', onClick: () => testHit('front', 60) },
    { title: '死亡', onClick: () => health.kill('debug') },
    { title: '護盾與生命回滿', onClick: () => health.refill() },
    { title: '重置所有靶標', onClick: () => targets.resetAll() },
    { title: '重設 DPS 計', onClick: () => targets.dps.reset() },
  ]);
  const r1 = (x: number): number => Math.round(x * 10) / 10;
  return {
    name: 'combatMonitor',
    order: SystemOrder.debug,
    testHit,
    update() {
      if (!panel.isOpen) return;
      const s = health.state;
      m.shield = `${r1(s.shield)}／${s.maxShield}${s.shieldRecharging ? '（回充）' : ''}`;
      m.health = `${r1(s.health)}／${s.maxHealth}${s.dying ? '（死亡）' : ''}`;
      const d = targets.dpsSnapshot();
      m.dps = r1(d.dps);
      m.total = Math.round(d.total);
      m.critRate = `${(d.critRate * 100).toFixed(0)}%`;
      m.hits = d.hits;
      let alive = 0;
      let active = 0;
      for (const dr of targets.drones) {
        if (dr.active) active++;
        if (dr.alive) alive++;
      }
      m.drones = `${alive}／${active}`;
      m.bolts = targets.bolts.activeCount;
      m.engaged = targets.engaged;
      const on = o.getDronesEnabled();
      if (on !== droneToggle.enabled) {
        droneToggle.enabled = on;
        droneBinding.refresh();
      }
    },
  };
}
