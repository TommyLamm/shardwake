// 跑牆（WallRun）與攀爬（Mantle）狀態及轉換規則（M1-06）。
//
// 轉換（優先序見 MovePriority；同一來源狀態、同一階段內比較）：
//   pre：  地面／滑鏟 面對牆按跳且有可攀邊緣 → 攀爬（mantle 50；優先於滑鏟 10，取代起跳）
//   post： 空中 按住前進、正面牆有可攀邊緣 → 攀爬（50）
//          空中 符合跑牆條件（側面可跑的牆、速度、角度、離地高度、非剛離開的同一面牆）→ 跑牆（wallRun 30）
//          跑牆 正面牆有可攀邊緣 → 攀爬（50）；著地 → 地面（20）；蹬牆跳／放開前進／牆面結束／太慢／按蹲／逾時 → 空中（10）
//          攀爬 動作結束 → 地面（著地）或空中
// 「正面牆且有可攀邊緣 → 攀爬；側面牆 → 跑牆」：攀爬只看視線正前方 ±mantleMaxFacingDeg 的牆，且優先序較高。
//
// 速度：跑牆進入時把速度投影到牆面切線（至少 wallRunEntrySpeed）、垂直速度限制在 [−最大保留下落, +最大保留上升]；
// 攀爬期間速度由路徑決定（不受重力），結束時改為「進入前水平速度 × 保留比例（至少 mantleExitMinSpeed）」向前。
// 這兩處是計畫明定的速度改寫；其餘切換一律不碰速度。
import { applyOverspeedDrag } from '@/player/movementMath';
import type { PlayerController } from '@/player/PlayerController';
import type { MoveState, StateMachine } from '@/player/StateMachine';
import { MoveStateId, MovePriority } from '@/player/states';
import { MANTLE_CLEARANCE } from '@/player/WallSensor';

/** 跑牆結束原因（`player:wallRunEnd` 的 reason）。 */
export type WallRunEndReason =
  | 'jump'
  | 'released'
  | 'wallEnded'
  | 'slow'
  | 'crouch'
  | 'timeout'
  | 'landed'
  | 'mantle'
  | 'other';

/** 結束後仍可在寬限時間內蹬牆跳的原因。 */
const GRACE_REASONS: ReadonlySet<WallRunEndReason> = new Set<WallRunEndReason>(['released', 'wallEnded', 'slow', 'timeout']);

/** 跑牆重力曲線：g(t) = G × min(1, t / T)^p。 */
export function wallRunGravityAt(t: number, finalGravity: number, rampTime: number, exponent: number): number {
  const u = rampTime > 0 ? Math.min(1, Math.max(0, t) / rampTime) : 1;
  return finalGravity * Math.pow(u, Math.max(1e-3, exponent));
}

/** 攀爬路徑的進度曲線（u = 0..1）：先上（ease-out）後前（線性）。回傳 { up, forward }（0..1）。 */
export function mantleProgress(u: number, upFraction: number, out: { up: number; forward: number }): { up: number; forward: number } {
  const f = Math.min(0.95, Math.max(0.05, upFraction));
  const a = Math.min(1, Math.max(0, u / f));
  out.up = 1 - (1 - a) * (1 - a);
  out.forward = Math.min(1, Math.max(0, (u - f) / (1 - f)));
  return out;
}

const _prog = { up: 0, forward: 0 };

/** 跑牆：沿牆移動、重力依曲線增加、朝牆面貼附；按跳蹬牆跳。 */
export const WallRunState: MoveState<PlayerController> = {
  id: MoveStateId.wallRun,
  enter(ctx) {
    ctx.beginWallRun();
  },
  step(ctx, dt) {
    const v = ctx.velocity;
    const cfg = ctx.config;
    if (ctx.jumpBuffer.consume()) {
      ctx.wallJump(ctx.wallNormal, false);
      ctx.applyGravity(dt);
      return;
    }
    const tMid = ctx.wallRunTime + dt / 2;
    ctx.wallRunTime += dt;
    const n = ctx.wallNormal;
    // 不往牆外漂：移除離牆分量；再朝牆面施加貼附加速度（有上限）。貼著牆時角色控制器會把朝牆分量投影掉。
    let vn = v.x * n.x + v.z * n.z;
    if (vn > 0) {
      v.x -= n.x * vn;
      v.z -= n.z * vn;
      vn = 0;
    }
    const target = Math.max(vn - cfg.wallRunStickAccel * dt, -cfg.wallRunStickMaxSpeed);
    if (target < vn) {
      v.x += n.x * (target - vn);
      v.z += n.z * (target - vn);
    }
    ctx.applyGravity(dt, wallRunGravityAt(tMid, cfg.wallRunGravity, cfg.wallRunGravityRampTime, cfg.wallRunGravityCurve));
    applyOverspeedDrag(v, cfg.airSpeedSoftCap, cfg.airOverspeedDrag, dt);
  },
  exit(ctx, next) {
    let reason: WallRunEndReason;
    if (next === MoveStateId.ground) reason = 'landed';
    else if (next === MoveStateId.mantle) reason = 'mantle';
    else reason = ctx.wallRunEndReason ?? 'other';
    ctx.endWallRun(reason, next === MoveStateId.air && GRACE_REASONS.has(reason));
  },
};

/** 攀爬：0.28 s 的兩段路徑（先上後前），期間不受重力；結束時向前保留部分水平速度。 */
export const MantleState: MoveState<PlayerController> = {
  id: MoveStateId.mantle,
  enter(ctx, prev) {
    ctx.beginMantle(prev);
  },
  step(ctx, dt) {
    const m = ctx.mantle;
    const cfg = ctx.config;
    const v = ctx.velocity;
    m.time += dt;
    const duration = Math.max(1e-3, m.duration);
    const u = Math.min(1, m.time / duration);
    mantleProgress(u, cfg.mantleUpFraction, _prog);
    const topY = m.target.y + MANTLE_CLEARANCE;
    const px = m.start.x + (m.target.x - m.start.x) * _prog.forward;
    const py = m.start.y + (topY - m.start.y) * _prog.up;
    const pz = m.start.z + (m.target.z - m.start.z) * _prog.forward;
    // 速度 = 到路徑點所需的位移 / dt（不套重力；碰撞仍由角色控制器處理）。
    const p = ctx.position;
    v.set((px - p.x) / dt, (py - p.y) / dt, (pz - p.z) / dt);
    if (u >= 1) m.done = true;
  },
  exit(ctx) {
    ctx.endMantle();
  },
};

/** 註冊跑牆與攀爬狀態及轉換規則（在 registerCoreMovement 之後呼叫）。 */
export function registerWallMovement(machine: StateMachine<PlayerController>): void {
  machine.addState(WallRunState).addState(MantleState);
  const { ground, air, slide, wallRun, mantle } = MoveStateId;
  machine
    // ── pre ──
    .addTransition({
      name: '面對牆按跳 → 攀爬',
      from: [ground, slide],
      to: mantle,
      phase: 'pre',
      priority: MovePriority.mantle,
      when: (c) => c.grounded && c.jumpBuffer.active && c.canMantle(true),
    })
    // ── post ──
    .addTransition({
      name: '空中按住前進、正面有邊緣 → 攀爬',
      from: [air, wallRun],
      to: mantle,
      phase: 'post',
      priority: MovePriority.mantle,
      when: (c) => c.canMantle(false),
    })
    .addTransition({
      name: '空中貼側牆 → 跑牆',
      from: air,
      to: wallRun,
      phase: 'post',
      priority: MovePriority.wallRun,
      when: (c) => c.canWallRun(),
    })
    .addTransition({
      name: '跑牆著地 → 地面',
      from: wallRun,
      to: ground,
      phase: 'post',
      priority: MovePriority.wallRunLand,
      when: (c) => c.grounded,
    })
    .addTransition({
      name: '跑牆結束 → 空中',
      from: wallRun,
      to: air,
      phase: 'post',
      priority: MovePriority.wallRunExit,
      when: (c) => c.checkWallRunEnd() !== null,
    })
    .addTransition({
      name: '攀爬結束 → 地面',
      from: mantle,
      to: ground,
      phase: 'post',
      priority: MovePriority.base + 1,
      when: (c) => c.mantle.done && c.grounded,
    })
    .addTransition({
      name: '攀爬結束 → 空中',
      from: mantle,
      to: air,
      phase: 'post',
      priority: MovePriority.base,
      when: (c) => c.mantle.done,
    });
}

/** 速度方向與牆面切線的夾角（弧度）：dirX/dirZ 為水平單位向量，n 為水平牆面法線。 */
export function angleToWallTangent(dirX: number, dirZ: number, nx: number, nz: number): number {
  return Math.asin(Math.min(1, Math.abs(dirX * nx + dirZ * nz)));
}
