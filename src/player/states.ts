// 基礎移動狀態（Ground、Air、Slide）與集中管理的轉換規則（M1-05）。
// 後續計畫在 registerXxx() 註冊自己的狀態與規則，例如 M1-06 的 WallRun／Mantle（wallStates.ts）、M1-07 的 Dash／Grapple；
// 優先序由 Transition.priority 決定（數字越大越優先），各層級見 MovePriority：
//   post 階段：滑鏟→空中 10、空中→滑鏟（按住蹲落地）10、空中→地面 0、地面→空中 0、滑鏟→地面 0
//   pre 階段：地面→滑鏟 10
// 規則：狀態切換永不硬性歸零速度。各狀態的 step 只依物理規則（加速、摩擦、重力）改變速度。
import { DEG2RAD } from '@/core/math';
import type { PlayerController } from '@/player/PlayerController';
import {
  accelerate,
  applyFriction,
  applyOverspeedDrag,
  clampHorizontalSpeed,
  horizontalSpeed,
  rotateHorizontalTowards,
  slopeGravityHorizontal,
} from '@/player/movementMath';
import type { MoveState, StateMachine } from '@/player/StateMachine';

/** 移動狀態 id。ground／air／slide 為 M1-05，wallRun／mantle 為 M1-06；M1-07 加入 'dash'、'grapple'。 */
export const MoveStateId = {
  ground: 'ground',
  air: 'air',
  slide: 'slide',
  wallRun: 'wallRun',
  mantle: 'mantle',
} as const;

/**
 * 轉換規則的優先序層級（同一個來源狀態、同一個階段內比較，越大越優先）。
 * 整體順序：Mantle > Grapple > Dash > WallRun > Slide > Air／Ground（M1-07 的 Dash／Grapple 用 dash／grapple 層級）。
 */
export const MovePriority = {
  base: 0,
  slide: 10,
  wallRunExit: 10,
  wallRunLand: 20,
  wallRun: 30,
  dash: 40,
  grapple: 45,
  mantle: 50,
} as const;

const _slope = { x: 0, z: 0 };

/** 地面：Source 式摩擦＋加速；起跳。 */
export const GroundState: MoveState<PlayerController> = {
  id: MoveStateId.ground,
  enter(ctx) {
    ctx.stepsOnGround = 0;
  },
  step(ctx, dt) {
    const v = ctx.velocity;
    const cfg = ctx.config;
    if (v.y < 0) v.y = 0;
    if (ctx.tryJump(false)) {
      // 起跳這一步就開始受重力（梯形積分從起跳瞬間算起，跳躍高度才準）。
      ctx.applyGravity(dt);
      return;
    }
    if (ctx.stepsOnGround >= cfg.landingFrictionGraceSteps) applyFriction(v, cfg.friction, cfg.stopSpeed, dt);
    const wish = ctx.wish;
    const wishSpeed = ctx.groundWishSpeed() * wish.len;
    const before = horizontalSpeed(v);
    accelerate(v, wish.x, wish.z, wishSpeed, cfg.groundAccel, dt);
    // 地面加速不能讓速率超過「加速前」與目標速度的較大者：
    // 斜向貼牆跑（速度被牆投影）與地面側移不會無限增速，連跳保留的動量也不會被削減。
    clampHorizontalSpeed(v, Math.max(before, wishSpeed));
    // 在地面上不保留垂直速度（坡面由角色控制器處理，貼地由 snapToGround 處理）。
    v.y = 0;
    ctx.stepsOnGround++;
  },
};

/** 空中：Quake 式 air strafe ＋ air control、超速阻力、重力；土狼時間起跳。 */
export const AirState: MoveState<PlayerController> = {
  id: MoveStateId.air,
  enter(ctx, prev) {
    ctx.airTime = 0;
    // 走出平台（不是起跳）才有土狼時間。
    ctx.coyoteAvailable = !ctx.jumpedThisStep && (prev === MoveStateId.ground || prev === MoveStateId.slide);
  },
  step(ctx, dt) {
    const v = ctx.velocity;
    const cfg = ctx.config;
    ctx.airTime += dt;
    if (ctx.coyoteAvailable) {
      if (ctx.airTime <= cfg.coyoteTime + 1e-9) ctx.tryJump(true);
      else ctx.coyoteAvailable = false;
    }
    // 跑牆剛結束（牆面結束、放開前進、逾時）的寬限時間內按跳 → 蹬牆跳（M1-06；優先於 M1-07 的二段跳）。
    ctx.tryWallJumpGrace();
    const wish = ctx.wish;
    if (wish.len > 0) {
      accelerate(v, wish.x, wish.z, cfg.runSpeed * wish.len, cfg.airAccel, dt, cfg.airWishSpeedCap);
      rotateHorizontalTowards(v, wish.x, wish.z, cfg.airControlDegPerSec * DEG2RAD * dt);
    }
    applyOverspeedDrag(v, cfg.airSpeedSoftCap, cfg.airOverspeedDrag, dt);
    ctx.applyGravity(dt);
  },
};

/** 滑鏟：進入推進（有冷卻）、低摩擦、坡度加速、限速轉向。 */
export const SlideState: MoveState<PlayerController> = {
  id: MoveStateId.slide,
  enter(ctx) {
    const v = ctx.velocity;
    const cfg = ctx.config;
    const speed = horizontalSpeed(v);
    let boosted = false;
    if (ctx.slideBoostTimer >= cfg.slideBoostCooldown - 1e-9 && speed > 1e-3 && speed < cfg.slideBoostMaxSpeed) {
      const add = Math.min(cfg.slideBoost, cfg.slideBoostMaxSpeed - speed);
      const k = (speed + add) / speed;
      v.x *= k;
      v.z *= k;
      ctx.slideBoostTimer = 0;
      boosted = add > 0;
    }
    ctx.emitSlideStart(horizontalSpeed(v), boosted);
  },
  step(ctx, dt) {
    const v = ctx.velocity;
    const cfg = ctx.config;
    if (v.y < 0) v.y = 0;
    if (ctx.tryJump(false)) {
      // 起跳這一步就開始受重力（梯形積分從起跳瞬間算起，跳躍高度才準）。
      ctx.applyGravity(dt);
      return;
    }
    const n = ctx.groundNormal;
    // 坡度加速：重力沿坡面分量的水平部分。
    slopeGravityHorizontal(cfg.gravity * cfg.slideSlopeFactor, n.x, n.y, n.z, _slope);
    v.x += _slope.x * dt;
    v.z += _slope.z * dt;
    // 摩擦（與速度成正比，指數形式與步長無關）；順著坡往下滑時摩擦減小。
    let friction = cfg.slideFriction;
    const slopeDeg = Math.acos(Math.min(1, Math.max(-1, n.y))) / DEG2RAD;
    if (slopeDeg > 0.1 && v.x * _slope.x + v.z * _slope.z > 0) {
      const t = Math.min(1, slopeDeg / Math.max(1e-3, cfg.slideDownhillFullDeg));
      friction *= 1 + (cfg.slideDownhillFrictionScale - 1) * t;
    }
    const k = Math.exp(-friction * dt);
    v.x *= k;
    v.z *= k;
    const wish = ctx.wish;
    if (wish.len > 0) rotateHorizontalTowards(v, wish.x, wish.z, cfg.slideSteerDegPerSec * DEG2RAD * dt);
    applyOverspeedDrag(v, cfg.airSpeedSoftCap, cfg.airOverspeedDrag, dt);
    v.y = 0;
  },
  exit(ctx) {
    ctx.emitSlideEnd(horizontalSpeed(ctx.velocity));
  },
};

/** 註冊基礎狀態與轉換規則（集中在這裡）。 */
export function registerCoreMovement(machine: StateMachine<PlayerController>): void {
  machine.addState(GroundState).addState(AirState).addState(SlideState);
  const { ground, air, slide } = MoveStateId;
  machine
    // ── pre：依輸入 ──
    .addTransition({
      name: '地面按蹲 → 滑鏟',
      from: ground,
      to: slide,
      phase: 'pre',
      priority: MovePriority.slide,
      when: (c) => c.grounded && c.input.crouchPressed && horizontalSpeed(c.velocity) >= c.config.slideMinSpeed,
    })
    // ── post：依移動結果 ──
    .addTransition({
      name: '滑鏟離地 → 空中',
      from: slide,
      to: air,
      phase: 'post',
      priority: MovePriority.slide,
      when: (c) => !c.grounded,
    })
    .addTransition({
      name: '滑鏟結束 → 地面',
      from: slide,
      to: ground,
      phase: 'post',
      when: (c) => !c.input.crouchHeld || horizontalSpeed(c.velocity) < c.config.slideEndSpeed,
    })
    .addTransition({
      name: '按住蹲落地 → 滑鏟',
      from: air,
      to: slide,
      phase: 'post',
      priority: MovePriority.slide,
      when: (c) => c.grounded && c.input.crouchHeld && horizontalSpeed(c.velocity) >= c.config.slideMinSpeed,
    })
    .addTransition({ name: '落地 → 地面', from: air, to: ground, phase: 'post', when: (c) => c.grounded })
    .addTransition({ name: '離地 → 空中', from: ground, to: air, phase: 'post', when: (c) => !c.grounded });
}
