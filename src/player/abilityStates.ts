// 進階移動能力（M1-07）：二段跳、噴射推進（AirState 呼叫）、Dash 與 Grapple 狀態及轉換規則、能力的每步更新。
//
// 每個固定步（PlayerController.step）：
//   abilitiesPreStep  計時器（Dash 回充、抓鉤冷卻）→ 鉤爪：飛行中放開就取消 → 按 F 發射 → 飛行／收回。
//   'pre' 轉換        鉤爪已附著 → Grapple（45）；按 Shift 且有充能 → Dash（40）。
//   狀態 step         AirState：土狼起跳 → 蹬牆跳寬限 → 二段跳（tryDoubleJump）→ 空中加速 → 重力 → 噴射（applyJet）。
//   'post' 轉換       Dash 結束 → 滑鏟（著地且按住蹲）／地面／空中；脫鉤 → 地面／空中；Dash、抓鉤中正面有邊緣 → 攀爬。
//   abilitiesPostStep 燃料回充（著地 jetRechargeDelay 後、跑牆中）、噴射開始／停止事件、繩長、唯讀狀態。
//
// 狀態優先序（MovePriority）：Mantle 50 > Grapple 45 > Dash 40 > WallRun 30 > Slide 10 > Air／Ground 0。
//   高優先的狀態不會被低優先的狀態打斷：Dash 可以從地面、空中、跑牆、滑鏟進入；抓鉤附著可以打斷 Dash；
//   攀爬中不能 Dash、不能發射抓鉤（附著會等攀爬結束）。
//
// 速度（不硬性歸零）：二段跳 vy = max(vy, 7.3)、水平只改方向；Dash 期間速度由位移決定、結束時沿 Dash 方向
//   max(原本沿該方向的速度, 12)；抓鉤以加速度改變速度，脫鉤保留速度（按跳另外 +5 m/s 上拋）。
import * as THREE from 'three';
import { MoveStateId, MovePriority } from '@/player/states';
import { accelerate, horizontalSpeed } from '@/player/movementMath';
import type { PlayerController } from '@/player/PlayerController';
import type { MoveState, StateMachine } from '@/player/StateMachine';
import { viewDirection, type GrappleMissReason } from '@/player/Grapple';

/** 移動狀態 id（M1-07）。 */
export const AbilityStateId = {
  dash: 'dash',
  grapple: 'grapple',
} as const;

/** 脫鉤原因（`player:grappleRelease` 的 reason）。 */
export type GrappleReleaseReason = 'close' | 'passed' | 'input' | 'jump' | 'timeout' | 'disabled' | 'mantle' | 'other';

/** 越過錨點判定需要的最低速度（m/s；太慢時方向不穩定）。 */
const PASS_MIN_SPEED = 2;
/** 曾經朝錨點接近的判定（速度方向·錨點方向）。 */
const APPROACH_DOT = 0.5;
/** 繩長約束的位置修正速度上限（m/s）。 */
const ROPE_CORRECTION_MAX = 5;

const _eye = new THREE.Vector3();
const _to = new THREE.Vector3();
const _dir = { x: 0, y: 0, z: -1 };

// 事件 payload（同步派送，重複使用）。
const evDoubleJump = { speed: 0, remaining: 0 };
const evJetStart = { fuel: 0 };
const evJetStop = { fuel: 0, reason: '' };
const evDash = { dir: { x: 0, y: 0, z: 0 }, fromState: '', charges: 0 };
const evFire = { origin: { x: 0, y: 0, z: 0 }, dir: { x: 0, y: 0, z: 0 } };
const evAttach = { point: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 0, z: 0 }, distance: 0 };
const evRelease = { reason: '', duration: 0 };
const evMiss = { reason: '', point: { x: 0, y: 0, z: 0 } };
const evAim = { available: false, distance: 0 };
const evReady: { ability: 'dash' | 'grapple' | 'jet'; charges: number } = { ability: 'dash', charges: 0 };

function copyVec(dst: { x: number; y: number; z: number }, src: { x: number; y: number; z: number }): void {
  dst.x = src.x;
  dst.y = src.y;
  dst.z = src.z;
}

function emitReady(ctx: PlayerController, ability: 'dash' | 'grapple' | 'jet', charges: number): void {
  evReady.ability = ability;
  evReady.charges = charges;
  ctx.emit('player:abilityReady', evReady);
}

// ── 每步更新 ─────────────────────────────────────────────

/** 狀態轉換之前：計時器、鉤爪發射／飛行／收回。 */
export function abilitiesPreStep(ctx: PlayerController, dt: number): void {
  const a = ctx.abilities;
  const cfg = ctx.config;
  const inp = ctx.input;
  a.jetThisStep = false;
  if (!inp.jumpHeld) a.jetArmed = false;
  if (a.dash.update(dt) > 0) emitReady(ctx, 'dash', a.dash.charges);
  if (a.grappleCooldown.update(dt)) emitReady(ctx, 'grapple', 1);

  const hook = a.hook;
  ctx.eyeNow(_eye);
  // 飛行中放開（按住模式）／再按（切換模式）或停用 → 取消（套用落空冷卻）。
  if (hook.phase === 'flying' && (!inp.grappleHeld || !cfg.grappleEnabled)) {
    hook.miss('cancel');
    grappleMissed(ctx, 'cancel');
  }
  // 已附著但還沒進入抓鉤狀態（攀爬中）時放開或停用：直接收回（套用脫鉤冷卻）。
  if (hook.phase === 'attached' && !ctx.machine.is(AbilityStateId.grapple) && (!inp.grappleHeld || !cfg.grappleEnabled)) {
    hook.release();
    a.grappleCooldown.start(a.stat('grappleCooldown'));
    ctx.releaseGrappleToggle();
  }
  if (inp.grapplePressed && a.canFireGrapple() && !ctx.machine.is(MoveStateId.mantle)) {
    viewDirection(ctx.look.yaw, ctx.look.pitch, _dir);
    hook.fire(_eye, _dir);
    copyVec(evFire.origin, hook.origin);
    copyVec(evFire.dir, hook.dir);
    ctx.emit('player:grappleFire', evFire);
  }
  if (hook.phase === 'flying') {
    const r = hook.updateFlight(ctx.physics, dt, a.stat('grappleHookSpeed'), a.stat('grappleRange'));
    if (r === 'attached') {
      copyVec(evAttach.point, hook.anchor);
      copyVec(evAttach.normal, hook.anchorNormal);
      evAttach.distance = hook.attachDistance;
      ctx.emit('player:grappleAttach', evAttach);
    } else if (r !== null) grappleMissed(ctx, r);
  } else hook.updateRetract(dt, _eye);
}

/** 狀態轉換之後：燃料回充、噴射事件、繩長、唯讀狀態。 */
export function abilitiesPostStep(ctx: PlayerController, dt: number): void {
  const a = ctx.abilities;
  const cfg = ctx.config;
  const id = ctx.machine.currentId;
  if (ctx.grounded) a.groundedTime += dt;
  else a.groundedTime = 0;
  let recharge = false;
  if (!a.jetThisStep) {
    if (id === MoveStateId.wallRun) recharge = true;
    else if (ctx.grounded && a.groundedTime >= a.stat('jetRechargeDelay') - 1e-9) recharge = true;
  }
  a.jetRecharging = recharge && !a.jet.full;
  if (recharge && a.jet.recharge(dt)) emitReady(ctx, 'jet', 1);

  if (a.jetThisStep && !a.jetLastStep) {
    evJetStart.fuel = a.jet.fuel;
    ctx.emit('player:jetStart', evJetStart);
  } else if (!a.jetThisStep && a.jetLastStep) {
    let reason = 'state';
    if (!cfg.jetEnabled) reason = 'disabled';
    else if (a.jet.empty) reason = 'empty';
    else if (!ctx.input.jumpHeld) reason = 'released';
    else if (ctx.grounded) reason = 'landed';
    evJetStop.fuel = a.jet.fuel;
    evJetStop.reason = reason;
    ctx.emit('player:jetStop', evJetStop);
  }
  a.jetLastStep = a.jetThisStep;

  if (id === AbilityStateId.grapple) {
    // 繩長只能縮短；記錄是否曾經朝錨點接近（越過錨點的判定用）。
    const hook = a.hook;
    ctx.eyeNow(_eye);
    _to.subVectors(hook.anchor, _eye);
    const d = _to.length();
    hook.ropeLength = Math.min(hook.ropeLength, d);
    const speed = ctx.velocity.length();
    if (d > 1e-6 && speed > PASS_MIN_SPEED && ctx.velocity.dot(_to) / (d * speed) > APPROACH_DOT) hook.approached = true;
  }
  a.publish(id === AbilityStateId.dash);
}

/** 準星輔助：從 origin 沿 (yaw, pitch) 做 raycast，可勾取的狀態改變時發出 `player:grappleAim`。 */
export function updateGrappleAim(ctx: PlayerController, origin: Readonly<THREE.Vector3>, yaw: number, pitch: number): boolean {
  const a = ctx.abilities;
  viewDirection(yaw, pitch, _dir);
  const changed = a.hook.updateAim(ctx.physics, origin, _dir, ctx.config.grappleEnabled ? a.stat('grappleRange') : 0);
  a.state.grapple.aimAvailable = a.hook.aimAvailable;
  a.state.grapple.aimDistance = a.hook.aimDistance;
  if (changed) {
    evAim.available = a.hook.aimAvailable;
    evAim.distance = a.hook.aimDistance;
    ctx.emit('player:grappleAim', evAim);
  }
  return a.hook.aimAvailable;
}

function grappleMissed(ctx: PlayerController, reason: GrappleMissReason): void {
  const a = ctx.abilities;
  a.grappleCooldown.start(a.stat('grappleMissCooldown'));
  evMiss.reason = reason;
  copyVec(evMiss.point, a.hook.position);
  ctx.emit('player:grappleMiss', evMiss);
  ctx.releaseGrappleToggle();
}

// ── 二段跳與噴射（AirState 呼叫）──────────────────────────

/**
 * 二段跳：空中（不在土狼時間內，土狼起跳與蹬牆跳寬限先處理）按跳 → vy = max(vy, doubleJumpSpeed)，
 * 水平速度往輸入方向導向 doubleJumpRedirect（速率不變）。
 * 落地保護：下落中、預估 doubleJumpLandingGuard 秒內會著地時不使用，按跳留給落地起跳（跳躍緩衝）。
 */
export function tryDoubleJump(ctx: PlayerController): boolean {
  const a = ctx.abilities;
  const cfg = ctx.config;
  // 在空中按下的跳（不是土狼起跳或蹬牆跳）讓噴射「上膛」：之後繼續按住就能噴射。
  if (ctx.input.jumpPressed && !ctx.jumpedThisStep) a.jetArmed = true;
  if (!cfg.doubleJumpEnabled || a.doubleJumpsLeft <= 0 || !ctx.jumpBuffer.active) return false;
  const v = ctx.velocity;
  const guard = cfg.doubleJumpLandingGuard;
  if (guard > 0) {
    const drop = -v.y * guard + 0.5 * cfg.gravity * guard * guard;
    if (drop > 0 && ctx.groundWithin(drop)) return false;
  }
  if (!ctx.jumpBuffer.consume()) return false;
  const speed = a.stat('doubleJumpSpeed');
  v.y = Math.max(v.y, speed);
  const r = a.stat('doubleJumpRedirect');
  const wish = ctx.wish;
  const hs = horizontalSpeed(v);
  if (r > 0 && wish.len > 0 && hs > 1e-6) {
    const dx = (v.x / hs) * (1 - r) + wish.x * r;
    const dz = (v.z / hs) * (1 - r) + wish.z * r;
    const dl = Math.hypot(dx, dz);
    if (dl > 1e-6) {
      v.x = (dx / dl) * hs;
      v.z = (dz / dl) * hs;
    }
  }
  a.doubleJumpsLeft--;
  ctx.jumpedThisStep = true;
  ctx.coyoteAvailable = false;
  evDoubleJump.speed = v.y;
  evDoubleJump.remaining = a.doubleJumpsLeft;
  ctx.emit('player:doubleJump', evDoubleJump);
  return true;
}

/**
 * 噴射推進（重力之後呼叫）：二段跳用完（或停用）後，在空中按下的跳繼續按住 jetHoldDelay 以上 → 向上推力，
 * 推力只把垂直速度推到 jetMaxRiseSpeed 為止；另有少量水平推力。只有實際推進時才消耗燃料。
 */
export function applyJet(ctx: PlayerController, dt: number): void {
  const a = ctx.abilities;
  const cfg = ctx.config;
  const inp = ctx.input;
  if (!cfg.jetEnabled || !inp.jumpHeld || !a.jetArmed || ctx.grounded || a.jet.empty) return;
  if (cfg.doubleJumpEnabled && a.doubleJumpsLeft > 0) return;
  if (inp.jumpHoldTime < cfg.jetHoldDelay - 1e-9) return;
  const v = ctx.velocity;
  const fuelUse = Math.min(dt, a.jet.fuel);
  const k = fuelUse / dt;
  const dvy = Math.min(a.stat('jetThrust') * k * dt, Math.max(0, a.stat('jetMaxRiseSpeed') - v.y));
  let pushed = dvy > 0;
  const hMax = a.stat('jetHorizontalMaxSpeed');
  const hAcc = a.stat('jetHorizontalAccel') * k;
  const wish = ctx.wish;
  if (wish.len > 0 && hMax > 0 && hAcc > 0) {
    if (accelerate(v, wish.x, wish.z, hMax * wish.len, hAcc / hMax, dt) > 0) pushed = true;
  }
  if (!pushed) return;
  if (dvy > 0) ctx.applyVerticalAcceleration(dvy / dt, dt);
  a.jet.drain(fuelUse);
  a.jetThisStep = true;
}

// ── Dash ─────────────────────────────────────────────────

/** 可以 Dash：啟用、這一步按下 Dash、有充能。 */
export function canDash(ctx: PlayerController): boolean {
  const a = ctx.abilities;
  return (
    ctx.config.dashEnabled &&
    ctx.input.dashPressed &&
    a.dash.canUse() &&
    a.stat('dashDuration') > 0 &&
    a.stat('dashDistance') > 0
  );
}

/** Dash 動作是否已完成。 */
export function dashDone(ctx: PlayerController): boolean {
  const d = ctx.abilities.dashRun;
  return d.time >= d.duration - 1e-9;
}

/** Dash 結束時的水平速率：max(原本沿 Dash 方向的速度, dashExitMinSpeed)。 */
export function dashExitSpeed(ctx: PlayerController): number {
  return Math.max(ctx.abilities.dashRun.entryAlong, ctx.abilities.stat('dashExitMinSpeed'));
}

/** Dash：0.15 s 內沿輸入方向（沒有輸入則視線前方）位移 7 m；期間無重力、垂直速度為 0。 */
export const DashState: MoveState<PlayerController> = {
  id: AbilityStateId.dash,
  enter(ctx, prev) {
    const a = ctx.abilities;
    const d = a.dashRun;
    const w = ctx.wish;
    let x = w.len > 0 ? w.x : ctx.forward.x;
    let z = w.len > 0 ? w.z : ctx.forward.z;
    const l = Math.hypot(x, z);
    if (l < 1e-6) {
      x = 0;
      z = -1;
    } else {
      x /= l;
      z /= l;
    }
    d.dir.set(x, 0, z);
    const v = ctx.velocity;
    d.entryAlong = v.x * x + v.z * z;
    d.time = 0;
    d.duration = a.stat('dashDuration');
    d.speed = a.stat('dashDistance') / Math.max(1e-3, d.duration);
    d.onGround = ctx.grounded;
    d.fromState = prev ?? '';
    a.dash.use();
    ctx.coyoteAvailable = false;
    copyVec(evDash.dir, d.dir);
    evDash.fromState = d.fromState;
    evDash.charges = a.dash.charges;
    ctx.emit('player:dash', evDash);
  },
  step(ctx, dt) {
    const d = ctx.abilities.dashRun;
    d.onGround = d.onGround && ctx.grounded;
    // 最後一步只走剩下的時間（任何更新率下位移都是 dashDistance）。
    const st = Math.min(dt, Math.max(0, d.duration - d.time));
    const k = (d.speed * st) / dt;
    ctx.velocity.set(d.dir.x * k, 0, d.dir.z * k);
    d.time += dt;
  },
  exit(ctx) {
    const d = ctx.abilities.dashRun;
    const speed = dashExitSpeed(ctx);
    ctx.velocity.set(d.dir.x * speed, 0, d.dir.z * speed);
    d.time = d.duration;
    d.onGround = false;
  },
};

// ── 抓鉤 ─────────────────────────────────────────────────

/** 脫鉤條件（post 階段；不修改狀態）。 */
export function grappleReleaseReason(ctx: PlayerController): GrappleReleaseReason | null {
  const a = ctx.abilities;
  const cfg = ctx.config;
  if (a.grappleReleaseReason) return a.grappleReleaseReason;
  if (!cfg.grappleEnabled) return 'disabled';
  if (!ctx.input.grappleHeld) return 'input';
  const hook = a.hook;
  ctx.eyeNow(_eye);
  _to.subVectors(hook.anchor, _eye);
  const d = _to.length();
  if (d < cfg.grappleReleaseDistance) return 'close';
  const speed = ctx.velocity.length();
  if (hook.approached && speed > PASS_MIN_SPEED && d > 1e-6 && ctx.velocity.dot(_to) / (d * speed) < cfg.grapplePassDot) return 'passed';
  if (hook.attachedTime >= a.stat('grappleMaxTime') - 1e-9) return 'timeout';
  return null;
}

/**
 * 抓鉤附著：朝錨點加速 grapplePullAccel ＋ 輸入轉向 grappleSteerAccel；速率不超過 grappleMaxSpeed（進入時已更快則保留）；
 * 重力 × grappleGravityScale；與錨點的距離只能縮短（繩長約束，可以擺盪；開始接近錨點後改由拉力主導）。按跳脫鉤並額外上拋。
 */
export const GrappleState: MoveState<PlayerController> = {
  id: AbilityStateId.grapple,
  enter(ctx) {
    const a = ctx.abilities;
    const hook = a.hook;
    a.grappleReleaseReason = null;
    hook.attachedTime = 0;
    hook.approached = false;
    ctx.eyeNow(_eye);
    hook.ropeLength = _eye.distanceTo(hook.anchor);
    ctx.coyoteAvailable = false;
    ctx.resetAirAbilities('grapple');
  },
  step(ctx, dt) {
    const a = ctx.abilities;
    const cfg = ctx.config;
    const v = ctx.velocity;
    const hook = a.hook;
    if (ctx.jumpBuffer.consume()) {
      v.y = Math.max(v.y, 0) + a.stat('grappleJumpBoost');
      a.grappleReleaseReason = 'jump';
      ctx.jumpedThisStep = true;
      ctx.applyGravity(dt);
      return;
    }
    ctx.eyeNow(_eye);
    _to.subVectors(hook.anchor, _eye);
    const d = _to.length();
    const before = v.length();
    if (d > 1e-6) {
      _to.multiplyScalar(1 / d);
      v.addScaledVector(_to, a.stat('grapplePullAccel') * dt);
    }
    const w = ctx.wish;
    if (w.len > 0) {
      const s = a.stat('grappleSteerAccel') * w.len * dt;
      v.x += w.x * s;
      v.z += w.z * s;
    }
    ctx.applyGravity(dt, cfg.gravity * a.stat('grappleGravityScale'));
    const limit = Math.max(a.stat('grappleMaxSpeed'), before);
    const speed = v.length();
    if (speed > limit) v.multiplyScalar(limit / speed);
    if (d > 1e-6 && !hook.approached) {
      // 繩長約束：到達繩長時移除離開錨點的分量（擺盪），超出時往回修正。
      // 開始朝錨點接近後不再約束（由拉力帶向錨點）：飛越錨點時速度會轉成離開錨點，觸發「越過錨點」脫鉤，
      // 而不是被繩子拉成繞著錨點轉圈。
      const away = -v.dot(_to);
      if (d >= hook.ropeLength - 1e-4 && away > 0) v.addScaledVector(_to, away);
      const excess = d - hook.ropeLength;
      if (excess > 0) v.addScaledVector(_to, Math.min(ROPE_CORRECTION_MAX, excess / dt));
    }
    hook.attachedTime += dt;
  },
  exit(ctx, next) {
    const a = ctx.abilities;
    const reason = grappleReleaseReason(ctx) ?? (next === MoveStateId.mantle ? 'mantle' : 'other');
    a.hook.release();
    a.grappleCooldown.start(a.stat('grappleCooldown'));
    evRelease.reason = reason;
    evRelease.duration = a.hook.attachedTime;
    ctx.emit('player:grappleRelease', evRelease);
    a.grappleReleaseReason = null;
    ctx.releaseGrappleToggle();
  },
};

// ── 註冊 ─────────────────────────────────────────────────

/** 註冊 Dash、Grapple 狀態與轉換規則（在 registerCoreMovement、registerWallMovement 之後呼叫）。 */
export function registerAbilityMovement(machine: StateMachine<PlayerController>): void {
  machine.addState(DashState).addState(GrappleState);
  const { ground, air, slide, wallRun, mantle } = MoveStateId;
  const { dash, grapple } = AbilityStateId;
  machine
    // ── pre ──
    .addTransition({
      name: '鉤爪附著 → 抓鉤',
      from: [ground, air, slide, wallRun, dash],
      to: grapple,
      phase: 'pre',
      priority: MovePriority.grapple,
      when: (c) => c.abilities.hook.phase === 'attached' && c.config.grappleEnabled,
    })
    .addTransition({
      name: '按 Dash → Dash',
      from: [ground, air, slide, wallRun],
      to: dash,
      phase: 'pre',
      priority: MovePriority.dash,
      when: (c) => canDash(c),
    })
    // ── post ──
    .addTransition({
      name: 'Dash／抓鉤中正面有邊緣 → 攀爬',
      from: [dash, grapple],
      to: mantle,
      phase: 'post',
      priority: MovePriority.mantle,
      when: (c) => c.canMantle(false),
    })
    .addTransition({
      name: '地面 Dash 結束按住蹲 → 滑鏟',
      from: dash,
      to: slide,
      phase: 'post',
      priority: MovePriority.slide,
      when: (c) => dashDone(c) && c.grounded && c.input.crouchHeld && dashExitSpeed(c) >= c.config.slideMinSpeed,
    })
    .addTransition({
      name: 'Dash 結束 → 地面',
      from: dash,
      to: ground,
      phase: 'post',
      priority: MovePriority.base + 1,
      when: (c) => dashDone(c) && c.grounded,
    })
    .addTransition({
      name: 'Dash 結束 → 空中',
      from: dash,
      to: air,
      phase: 'post',
      priority: MovePriority.base,
      when: (c) => dashDone(c),
    })
    .addTransition({
      name: '脫鉤著地 → 地面',
      from: grapple,
      to: ground,
      phase: 'post',
      priority: MovePriority.base + 1,
      when: (c) => c.grounded && grappleReleaseReason(c) !== null,
    })
    .addTransition({
      name: '脫鉤 → 空中',
      from: grapple,
      to: air,
      phase: 'post',
      priority: MovePriority.base,
      when: (c) => grappleReleaseReason(c) !== null,
    });
}
