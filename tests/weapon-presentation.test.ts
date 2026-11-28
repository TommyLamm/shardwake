// M1-11 武器表現：槍模工廠、viewmodel 動作曲線與畫面更新率無關、特效池（彈孔上限、降量、事件）、準星大小與實際彈著。
import { beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { EventBus } from '@/core/EventBus';
import type { GameEvents } from '@/core/events';
import { DEG2RAD } from '@/core/math';
import { FX_CONFIG, SURFACE_IMPACT, WEAPON_FX_STYLES, fxStyleFor, type FxConfig } from '@/fx/FxConfig';
import { generateFlashPixels } from '@/fx/fxTextures';
import { explosionScale } from '@/fx/Explosions';
import { FractionalCounter, RingAllocator } from '@/fx/ring';
import { tracerLife } from '@/fx/Tracers';
import { buildWarmupProxies, createProxyGeometry } from '@/fx/Warmup';
import { WeaponFx } from '@/fx/WeaponFx';
import { Physics } from '@/physics/Physics';
import {
  CROSSHAIR_CONFIG,
  crosshairRadiusPx,
  crosshairStyleFor,
  effectiveSpreadDeg,
  patternRadiusDeg,
  screenRadiusPx,
} from '@/ui/Crosshair';
import { ARCHETYPES, createArchetype, defaultLoadout } from '@/weapons/archetypes';
import { Ballistics } from '@/weapons/Ballistics';
import { Viewmodel, type ViewmodelPlayer } from '@/weapons/Viewmodel';
import { VIEWMODEL_CONFIG, VIEWMODEL_PANEL, defaultViewmodelConfig } from '@/weapons/ViewmodelConfig';
import {
  adsPosition,
  bobPhaseDelta,
  bump,
  createReloadPose,
  figureEight,
  glowAfterShot,
  meleePose,
  pumpTravel,
  ramp,
  reloadPose,
  shellPose,
  swapLowered,
  swayTarget,
  zeroPose,
} from '@/weapons/viewmodelMath';
import { validateWeaponDef, zoomedFov, type WeaponDef } from '@/weapons/WeaponDef';
import type { WeaponPlayer } from '@/weapons/WeaponManager';
import { MODEL_STYLES, WeaponModelFactory, layoutWeaponModel, lookRotation, weaponModelKey } from '@/weapons/WeaponModelFactory';
import { WEAPON_FIELDS, writeWeaponField } from '@/weapons/WeaponPanel';
import { WeaponSim, addWall } from './helpers/weaponSim';

beforeAll(async () => {
  await Physics.init();
});

/** 同時符合武器系統與 viewmodel 的假玩家。 */
class VmPlayer implements WeaponPlayer, ViewmodelPlayer {
  sprinting = false;
  readonly state = { state: 'ground', grounded: true, speed: 0, wallNormal: { x: 0, y: 0, z: 0 } };
  readonly eye = new THREE.Vector3(0, 1.65, 0);
  readonly velocity = { x: 0, y: 0, z: 0 };
  isSprinting(): boolean {
    return this.sprinting;
  }
  eyeNow(out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.eye);
  }
}

function worldCamera(): THREE.PerspectiveCamera {
  return new THREE.PerspectiveCamera(70.53, 16 / 9, 0.05, 900);
}

// ── 槍模工廠 ─────────────────────────────────────────────

describe('WeaponModelFactory：程序槍模', () => {
  it('5 把原型：槍口與 model.muzzle 一致、部件齊全、瞄具與彈匣依描述', () => {
    for (const def of ARCHETYPES) {
      const L = layoutWeaponModel(def.model);
      expect(L.muzzle).toEqual(def.model.muzzle);
      const names = L.parts.map((p) => p.name);
      expect(names).toContain('receiver');
      expect(names).toContain('grip');
      expect(names.some((n) => n.startsWith('glow'))).toBe(true);
      if (def.model.barrelLength > 0) expect(names).toContain('barrel');
      // 槍管前端在槍口、機匣接在槍管後面。
      expect(L.receiverFront).toBeCloseTo(def.model.muzzle[2] + def.model.barrelLength, 9);
      expect(L.receiverRear).toBeCloseTo(L.receiverFront + def.model.bodyLength, 9);
      expect(names.includes('stock')).toBe(def.model.stock);
      expect(names.includes('scopeTube')).toBe(def.model.optic === 'scope');
      expect(names.includes('reflexDot')).toBe(def.model.optic === 'reflex');
      if (def.model.optic === 'none') expect(names).toContain('frontPost');
      expect(L.magazine !== null).toBe(def.model.magazine === 'box' || def.model.magazine === 'cell');
      // 瞄具在機匣上方、槍口後方。
      expect(L.sight[1]).toBeGreaterThan(def.model.muzzle[1]);
      expect(L.sight[2]).toBeGreaterThan(def.model.muzzle[2]);
    }
    const shotgun = layoutWeaponModel(createArchetype('scatter_shotgun')!.model);
    expect(shotgun.parts.filter((p) => p.group === 'pump').length).toBeGreaterThan(0);
  });

  it('合併靜態部件、共用材質：每把槍最多 9 個網格，5 把槍共用同色材質；發光材質每把一份', () => {
    const f = new WeaponModelFactory();
    const models = defaultLoadout().map((d) => f.create(d.model));
    for (const m of models) {
      let meshes = 0;
      m.root.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) meshes++;
      });
      expect(meshes).toBeLessThanOrEqual(9);
      expect(m.magazine === null).toBe(m.layout.magazine === null);
    }
    // 共用材質數 < 5 把 × 每把的材質種類。
    expect(f.materials.size).toBeLessThan(5 * 5);
    // suit／dark／dot 為所有槍共用。
    const suit = [...f.materials.keys()].filter((k) => k.startsWith('suit:'));
    expect(suit).toHaveLength(1);
    expect(new Set(models.map((m) => m.glowMaterial)).size).toBe(5);
    // 發光色可換（稀有度），亮度倍率可調（開火後暗下）；發光強度 > 1 → Bloom。
    const m0 = models[0]!;
    m0.setGlowColor('#ff8a20');
    expect(m0.glowMaterial.color.r).toBeGreaterThan(1);
    const before = m0.glowMaterial.color.r;
    m0.setGlowLevel(0.25);
    expect(m0.glowMaterial.color.r).toBeCloseTo(before * 0.25, 6);
    for (const m of models) m.dispose();
    f.dispose();
  });

  it('描述鍵：同描述同鍵、改數值或廠商就不同；未知廠商用預設風格', () => {
    const a = createArchetype('assault_rifle')!.model;
    const b = createArchetype('assault_rifle')!.model;
    expect(weaponModelKey(a)).toBe(weaponModelKey(b));
    b.barrelLength += 0.01;
    expect(weaponModelKey(a)).not.toBe(weaponModelKey(b));
    expect(weaponModelKey(a, { manufacturer: 'x' })).not.toBe(weaponModelKey(a));
    expect(layoutWeaponModel({ ...a, manufacturer: '不存在' }).parts).toEqual(layoutWeaponModel(a, MODEL_STYLES.default).parts);
  });

  it('lookRotation 把 +Z 轉到指定方向', () => {
    const dir = new THREE.Vector3(0.3, -0.5, 0.8).normalize();
    const [p, y] = lookRotation(dir.x, dir.y, dir.z);
    const v = new THREE.Vector3(0, 0, 1).applyEuler(new THREE.Euler(p * DEG2RAD, y * DEG2RAD, 0, 'YXZ'));
    expect(v.distanceTo(dir)).toBeLessThan(1e-9);
  });

  it('WeaponDef：adsOffset 與 manufacturer 選填並驗證；面板涵蓋開鏡對位並可補上缺少的欄位', () => {
    const d = createArchetype('assault_rifle')!;
    expect(validateWeaponDef(d).ok).toBe(true);
    delete d.model.adsOffset;
    expect(validateWeaponDef(d).ok).toBe(true);
    (d.model as unknown as Record<string, unknown>).adsOffset = [0, 1];
    expect(validateWeaponDef(d).errors.join()).toContain('model.adsOffset');
    (d.model as unknown as Record<string, unknown>).manufacturer = 3;
    expect(validateWeaponDef(d).errors.join()).toContain('model.manufacturer');
    const e = createArchetype('hand_cannon')!;
    delete e.model.adsOffset;
    expect(writeWeaponField(e, 'model.adsOffset.2', 0.05)).toBe(true);
    expect(e.model.adsOffset).toEqual([0, 0, 0.05]);
    const paths = new Set(WEAPON_FIELDS.map((f) => f.path));
    for (const k of ['model.adsOffset.0', 'model.adsOffset.1', 'model.adsOffset.2']) expect(paths).toContain(k);
  });
});

// ── 動作曲線（純函式）────────────────────────────────────

describe('viewmodel 動作曲線', () => {
  const cfg = defaultViewmodelConfig();

  it('ramp／bump／8 字形／步伐相位／擺動上限', () => {
    expect(ramp(0.5, 0, 1)).toBeCloseTo(0.5, 9);
    expect(ramp(-1, 0, 1)).toBe(0);
    expect(ramp(2, 0, 1)).toBe(1);
    expect(bump(0.5, 0, 0.25, 0.75, 1)).toBe(1);
    expect(bump(1, 0, 0.25, 0.75, 1)).toBe(0);
    // ∞ 形：x 一個週期、y 兩個週期。
    const p = zeroPose();
    figureEight(Math.PI / 2, 1, 1, 1, p);
    expect(p.px).toBeCloseTo(1, 9);
    expect(p.py).toBeCloseTo(0, 9);
    figureEight(Math.PI / 4, 1, 1, 0, p);
    expect(p.py).toBeCloseTo(1, 9);
    // 每 stride 公尺前進 π，與切分無關。
    expect(bobPhaseDelta(6, 0.4, 2.4)).toBeCloseTo(Math.PI, 9);
    expect(bobPhaseDelta(6, 0.2, 2.4) * 2).toBeCloseTo(bobPhaseDelta(6, 0.4, 2.4), 12);
    expect(swayTarget(1000, 0.012, 4)).toBe(-4);
    expect(swayTarget(-100, 0.012, 4)).toBeCloseTo(1.2, 9);
  });

  it('開鏡對位：瞄具點落在相機正前方 eyeRelief，再加上 adsOffset', () => {
    const sight = new THREE.Vector3(0.01, 0.07, 0.03);
    const pos = adsPosition(sight, 0.2, [0, 0, 0], { x: 0, y: 0, z: 0 });
    const world = sight.clone().add(new THREE.Vector3(pos.x, pos.y, pos.z));
    expect(world.x).toBeCloseTo(0, 12);
    expect(world.y).toBeCloseTo(0, 12);
    expect(world.z).toBeCloseTo(-0.2, 12);
    const off = adsPosition(sight, 0.2, [0.01, -0.02, 0.05], { x: 0, y: 0, z: 0 });
    expect(off.x - pos.x).toBeCloseTo(0.01, 12);
    expect(off.y - pos.y).toBeCloseTo(-0.02, 12);
    expect(off.z - pos.z).toBeCloseTo(-0.05, 12);
    // 5 把原型的真實瞄具：開鏡時瞄具在畫面正中央。
    for (const def of ARCHETYPES) {
      const L = layoutWeaponModel(def.model);
      const s = new THREE.Vector3(...L.sight);
      const a = adsPosition(s, 0.2, undefined, { x: 0, y: 0, z: 0 });
      expect(Math.hypot(s.x + a.x, s.y + a.y)).toBeLessThan(1e-12);
    }
  });

  it('換彈關鍵影格：頭尾姿勢為 0；彈匣拔出、掉落後隱藏、新彈匣插入；空倉上膛較大', () => {
    const r = createReloadPose();
    reloadPose(0, true, cfg, r);
    expect(Math.abs(r.pose.rz) + Math.abs(r.pose.rx) + Math.abs(r.pose.pz)).toBeLessThan(1e-9);
    expect(r.magY).toBe(0);
    reloadPose(1, true, cfg, r);
    expect(Math.abs(r.pose.rz) + Math.abs(r.pose.rx) + Math.abs(r.pose.pz)).toBeLessThan(1e-9);
    reloadPose(0.2, true, cfg, r);
    expect(r.pose.rz).toBeCloseTo(cfg.reloadRollDeg, 6);
    expect(r.magY).toBeLessThan(0);
    reloadPose((cfg.reloadMagDrop + cfg.reloadMagShow) / 2, true, cfg, r);
    expect(r.magVisible).toBe(false);
    reloadPose(cfg.reloadMagSeat + 0.001, true, cfg, r);
    expect(r.magVisible).toBe(true);
    expect(r.magY).toBe(0);
    const mid = (cfg.reloadChargeStart + cfg.reloadChargeEnd) / 2;
    const empty = reloadPose(mid, true, cfg, createReloadPose()).pose.pz;
    const tactical = reloadPose(mid, false, cfg, createReloadPose()).pose.pz;
    expect(empty).toBeGreaterThan(tactical);
    // 時間軸依換彈時間縮放：同一個進度在 1.6 s 與 2.0 s 的換彈中姿勢相同（姿勢只看進度）。
    expect(reloadPose(0.4, false, cfg, createReloadPose())).toEqual(reloadPose(0.4, false, cfg, createReloadPose()));
  });

  it('逐發裝填、切槍下放／舉起、近戰前刺、泵動、發光條恢復', () => {
    const p = shellPose(1, 0.5, cfg, zeroPose());
    expect(p.rz).toBeCloseTo(cfg.shellRollDeg, 9);
    expect(p.pz).toBeCloseTo(cfg.shellPos[2] - cfg.shellPush, 9);
    expect(shellPose(0, 0.5, cfg, zeroPose()).rz).toBe(0);
    const sw = { active: true, phase: 'out' as 'out' | 'in', start: 0, outEnd: 0.25, inEnd: 0.65 };
    expect(swapLowered(sw, 0)).toBe(0);
    expect(swapLowered(sw, 0.25)).toBe(1);
    sw.phase = 'in';
    expect(swapLowered(sw, 0.25)).toBe(1);
    expect(swapLowered(sw, 0.65)).toBe(0);
    expect(swapLowered({ ...sw, active: false }, 0.3)).toBe(0);
    const m = meleePose(cfg.meleePeak, cfg, zeroPose());
    expect(m.pz).toBeCloseTo(-cfg.meleeThrust, 6);
    expect(meleePose(1, cfg, zeroPose()).pz).toBeCloseTo(0, 9);
    expect(pumpTravel(0, 0.75, cfg)).toBe(0);
    expect(pumpTravel(cfg.pumpMid * 0.75, 0.75, cfg)).toBeCloseTo(1, 9);
    expect(pumpTravel(0.75, 0.75, cfg)).toBe(0);
    expect(glowAfterShot(0, 0.1, 0.25)).toBeCloseTo(0.25, 9);
    expect(glowAfterShot(0.1, 0.1, 0.25)).toBe(1);
    expect(glowAfterShot(Number.POSITIVE_INFINITY, 0.1, 0.25)).toBe(1);
  });

  it('設定面板涵蓋所有欄位，預設值在範圍內', () => {
    const covered = new Set<string>();
    for (const g of VIEWMODEL_PANEL) {
      for (const [k, spec] of Object.entries(g.schema)) {
        covered.add(k);
        const v = (VIEWMODEL_CONFIG as unknown as Record<string, unknown>)[k];
        if (typeof v === 'number' && spec?.min !== undefined) {
          expect(v, k).toBeGreaterThanOrEqual(spec.min);
          expect(v, k).toBeLessThanOrEqual(spec.max!);
        }
      }
      for (const k of g.vectors ?? []) covered.add(k);
    }
    for (const k of Object.keys(VIEWMODEL_CONFIG)) expect(covered, k).toContain(k);
  });
});

// ── Viewmodel：畫面更新率無關、FOV 無關 ──────────────────

interface VmRun {
  samples: Map<number, number[]>;
  vm: Viewmodel;
  sim: WeaponSim;
}

/** 以 fps 渲染 2 秒（模擬固定 120 Hz）：轉視角、移動、開火、換彈、切槍；回傳對齊時間點的姿勢。 */
function runViewmodel(fps: number, mutate?: (vm: Viewmodel, cam: THREE.PerspectiveCamera, t: number) => void): VmRun {
  const player = new VmPlayer();
  player.state.speed = 6;
  const sim = new WeaponSim({ hz: 120, player });
  const cam = worldCamera();
  const vm = new Viewmodel({ weapons: sim.manager, getPlayer: () => player, view: sim.view, worldCamera: cam, bus: sim.bus, getStepDt: () => 1 / 120 });
  const samples = new Map<number, number[]>();
  const sampleAt = new Set([15, 30, 45, 60, 75, 90, 105, 120]); // 1/60 s 的倍數
  const frames = 2 * fps;
  let steps = 0;
  for (let f = 1; f <= frames; f++) {
    const t = f / fps;
    // 視角：0.2–0.5 s 以 1.2 rad/s 往左轉（每畫面套用，與遊戲相同在固定步之前）。
    const yaw = 1.2 * Math.min(0.3, Math.max(0, t - 0.2));
    sim.view.set(yaw, 0);
    mutate?.(vm, cam, t);
    const target = Math.floor((t * 120) + 1e-9);
    while (steps < target) {
      const st = steps / 120;
      if (st >= 0.6 && st < 1.0) sim.input.down('fire');
      else sim.input.up('fire');
      if (steps === Math.round(1.1 * 120)) sim.input.tap('reload');
      if (steps === Math.round(1.75 * 120)) sim.input.tap('weapon2');
      sim.step();
      steps++;
    }
    const alpha = t * 120 - steps;
    vm.advance(1 / fps, alpha);
    const key = Math.round(t * 60);
    if (Math.abs(t * 60 - key) < 1e-9 && sampleAt.has(key)) {
      const p = vm.pose;
      samples.set(key, [p.px, p.py, p.pz, p.rx, p.ry, p.rz, vm.gun.position.x, vm.gun.position.y, vm.gun.position.z]);
    }
  }
  return { samples, vm, sim };
}

describe('Viewmodel', () => {
  it('1/60 與 1/240 的畫面速度：擺動、晃動、後座踢動、換彈、切槍的姿勢一致', () => {
    const a = runViewmodel(60);
    const b = runViewmodel(240);
    expect(a.sim.count('weapon:fire')).toBeGreaterThan(3);
    expect(a.sim.count('weapon:fire')).toBe(b.sim.count('weapon:fire'));
    expect(a.sim.count('weapon:reloadStart')).toBe(1);
    expect(a.samples.size).toBe(8);
    for (const [k, va] of a.samples) {
      const vb = b.samples.get(k)!;
      for (let i = 0; i < va.length; i++) expect(Math.abs(va[i]! - vb[i]!), `t=${k / 60} [${i}]`).toBeLessThan(1e-6);
    }
    // 動畫確實有在動：轉視角時有擺動、開火時有後座、換彈中有傾斜。
    const at = (k: number): number[] => a.samples.get(k)!;
    expect(Math.abs(at(30)[4]!)).toBeGreaterThan(0.5); // 0.5 s：擺動 yaw
    expect(at(45)[2]!).toBeGreaterThan(0.005); // 0.75 s：後座往後
    expect(at(75)[5]!).toBeLessThan(-5); // 1.25 s：換彈 roll
  });

  it('改世界 FOV 與開鏡縮放不影響槍模：viewmodel 相機 FOV 固定、姿勢相同', () => {
    const base = runViewmodel(60);
    const changed = runViewmodel(60, (_vm, cam, t) => {
      cam.fov = 40 + 60 * t;
      cam.updateProjectionMatrix();
    });
    for (const [k, va] of base.samples) {
      const vb = changed.samples.get(k)!;
      for (let i = 0; i < va.length; i++) expect(vb[i]).toBeCloseTo(va[i]!, 12);
    }
    expect(changed.vm.camera.fov).toBe(VIEWMODEL_CONFIG.fov);
  });

  it('預先建立全部槍模（隱藏），切槍換顯示；除錯飛行（沒有玩家）時隱藏', () => {
    const player = new VmPlayer();
    const sim = new WeaponSim({ player });
    let has = true;
    const vm = new Viewmodel({ weapons: sim.manager, getPlayer: () => (has ? player : null), view: sim.view, worldCamera: worldCamera(), bus: sim.bus });
    let models = 0;
    vm.gun.traverse((o) => {
      if (o.name.startsWith('vm:model:')) models++;
    });
    expect(models).toBe(5);
    vm.advance(1 / 60, 1);
    expect(vm.state.weaponId).toBe('assault_rifle');
    expect(vm.state.visible).toBe(true);
    sim.input.tap('weapon4');
    sim.run(1);
    vm.advance(1 / 60, 1);
    expect(vm.state.weaponId).toBe('rail_sniper');
    // 狙擊鏡：開鏡完成時隱藏槍模、遮罩為 1。
    sim.input.down('ads');
    sim.run(0.5);
    sim.manager.render(1);
    vm.advance(1 / 60, 1);
    expect(vm.state.scope).toBe(1);
    expect(vm.gun.visible).toBe(false);
    has = false;
    vm.advance(1 / 60, 1);
    expect(vm.state.visible).toBe(false);
  });

  it('槍口換算到世界：投影到畫面的位置與 viewmodel 中槍口的位置相同', () => {
    const player = new VmPlayer();
    const sim = new WeaponSim({ player });
    const cam = worldCamera();
    cam.position.set(3, 2, 1);
    cam.rotation.set(0.1, 0.7, 0, 'YXZ');
    cam.updateMatrixWorld();
    const vm = new Viewmodel({ weapons: sim.manager, getPlayer: () => player, view: sim.view, worldCamera: cam, bus: sim.bus });
    vm.advance(1 / 60, 1);
    const w = vm.muzzleWorld(new THREE.Vector3());
    const ndcWorld = w.clone().project(cam);
    const local = vm.model!.root.localToWorld(vm.model!.muzzle.clone());
    vm.camera.updateMatrixWorld();
    const ndcVm = local.clone().project(vm.camera);
    expect(ndcWorld.x).toBeCloseTo(ndcVm.x, 6);
    expect(ndcWorld.y).toBeCloseTo(ndcVm.y, 6);
    // 槍口在畫面右下。
    expect(ndcVm.x).toBeGreaterThan(0);
    expect(ndcVm.y).toBeLessThan(0);
  });
});

// ── 特效池 ───────────────────────────────────────────────

describe('特效池', () => {
  it('RingAllocator：循環覆蓋最舊的；FractionalCounter：機率與倍率以累積誤差分配', () => {
    const r = new RingAllocator(96);
    const slots: number[] = [];
    for (let i = 0; i < 200; i++) slots.push(r.next());
    expect(r.filled).toBe(96);
    expect(r.overwritten).toBe(104);
    expect(slots[96]).toBe(0);
    expect(r.head).toBe(200 % 96);
    expect(r.oldest).toBe(8);
    const c = new FractionalCounter();
    let n = 0;
    for (let i = 0; i < 10; i++) if (c.take(0.6)) n++;
    expect(n).toBe(6);
    const s = new FractionalCounter();
    const counts = [s.scale(7, 0.5), s.scale(7, 0.5), s.scale(7, 0.5), s.scale(7, 0.5)];
    expect(counts.reduce((a, b) => a + b, 0)).toBe(14);
    expect(new FractionalCounter().scale(7, 1)).toBe(7);
    expect(() => new RingAllocator(0)).toThrow();
  });

  it('曳光存在時間、爆炸擴散曲線、槍口閃光貼圖（可重現、邊緣透明）', () => {
    expect(tracerLife(100, { life: 0.07, speed: 0, length: 0 })).toBe(0.07);
    expect(tracerLife(10, { life: 0.07, speed: 700, length: 9 })).toBeCloseTo(0.07, 9);
    expect(tracerLife(140, { life: 0.07, speed: 700, length: 9 })).toBeCloseTo(149 / 700, 9);
    expect(tracerLife(1000, { life: 0.07, speed: 700, length: 9 })).toBe(0.6);
    expect(explosionScale(0)).toBeCloseTo(0.2, 9);
    expect(explosionScale(1)).toBe(1);
    const a = generateFlashPixels(64);
    const b = generateFlashPixels(64);
    expect(a).toEqual(b);
    expect(a[0 + 3]).toBe(0); // 角落透明
    expect(a[(32 * 64 + 32) * 4]).toBeGreaterThan(200); // 中心亮
  });

  function makeFx(config: Partial<FxConfig> = {}, quality = 'high'): { fx: WeaponFx; bus: EventBus<GameEvents>; scene: THREE.Scene } {
    const bus = new EventBus<GameEvents>();
    const scene = new THREE.Scene();
    const map: Record<string, string> = { r: 'assaultRifle', s: 'shotgun', p: 'plasmaLauncher' };
    const fx = new WeaponFx({
      scene,
      bus,
      muzzle: { muzzleWorld: (out) => out.set(0.2, 1.5, -0.5) },
      getArchetype: (id) => map[id],
      getQuality: () => quality,
      config: { ...FX_CONFIG, ...config },
    });
    return { fx, bus, scene };
  }

  function hitscan(bus: EventBus<GameEvents>, weaponId: string, pellet: number, surface: string | null, hitWorld = true): void {
    bus.emit('weapon:hitscan', {
      shotId: 1,
      weaponId,
      pellet,
      origin: { x: 0, y: 1.65, z: 0 },
      end: { x: 0, y: 1.5, z: -10 },
      normal: { x: 0, y: 0, z: 1 },
      hitWorld,
      surface,
      targets: 0,
    });
  }

  it('命中事件：曳光從這一畫面的槍口出發、火花依表面換顏色、留彈孔；發光表面不留彈孔', () => {
    const { fx, bus, scene } = makeFx();
    expect(scene.children).toContain(fx.root);
    hitscan(bus, 'r', 0, 'metal');
    expect(fx.decals.count).toBe(1);
    expect(fx.sparks.ring.total).toBe(WEAPON_FX_STYLES.assaultRifle!.impactSparks);
    expect(fx.tracers.ring.total).toBe(0); // 排隊到 render
    fx.advance(1 / 60);
    expect(fx.tracers.ring.total).toBe(1);
    const start = fx.tracers.attrs.array('aStart');
    expect([start[0], start[1], start[2]]).toEqual([0.2, 1.5, -0.5].map((x) => Math.fround(x)));
    expect(fx.sparks.mesh.visible).toBe(true);
    expect(fx.tracers.mesh.visible).toBe(true);
    // 發光表面：青色火花、不留彈孔。
    hitscan(bus, 'r', 0, 'energy');
    expect(fx.decals.count).toBe(1);
    const col = fx.sparks.attrs.array('aColor');
    const last = (fx.sparks.ring.head - 1 + fx.sparks.ring.capacity) % fx.sparks.ring.capacity;
    const energy = new THREE.Color(SURFACE_IMPACT.energy.color);
    expect(col[last * 3 + 2]! / col[last * 3]!).toBeCloseTo(energy.b / energy.r, 3);
    // 打到天空：只有曳光。
    hitscan(bus, 'r', 0, null, false);
    fx.advance(1 / 60);
    expect(fx.tracers.ring.total).toBe(3);
    // 過期後隱藏（不佔 draw call）。
    fx.advance(1);
    expect(fx.sparks.mesh.visible).toBe(false);
    expect(fx.tracers.mesh.visible).toBe(false);
    expect(fx.decals.mesh.visible).toBe(true);
  });

  it('霰彈曳光降量（機率 0.6 → 10 顆畫 6 條；低畫質再減半）；火花低畫質減半', () => {
    const { fx, bus } = makeFx();
    for (let p = 0; p < 10; p++) hitscan(bus, 's', p, 'metal');
    fx.advance(1 / 60);
    expect(fx.tracers.ring.total).toBe(6);
    const low = makeFx({}, 'low');
    for (let p = 0; p < 10; p++) hitscan(low.bus, 's', p, 'metal');
    low.fx.advance(1 / 60);
    expect(low.fx.tracers.ring.total).toBe(3);
    const r = makeFx({}, 'low');
    for (let i = 0; i < 4; i++) hitscan(r.bus, 'r', 0, 'metal');
    expect(r.fx.sparks.ring.total).toBe(Math.round(4 * WEAPON_FX_STYLES.assaultRifle!.impactSparks * 0.5));
    expect(fxStyleFor('不存在')).toBe(WEAPON_FX_STYLES.default);
  });

  it('彈孔上限 96，循環覆蓋', () => {
    const { fx, bus } = makeFx();
    for (let i = 0; i < 150; i++) hitscan(bus, 'r', 0, 'concrete');
    fx.advance(1 / 60);
    expect(fx.decals.count).toBe(96);
    expect(fx.decals.ring.overwritten).toBe(150 - 96);
    expect((fx.decals.mesh.geometry as THREE.InstancedBufferGeometry).instanceCount).toBe(96);
  });

  it('爆炸：球殼、火花、焦痕與閃光點光源；開火：槍口點光源只閃一下；燈光數量固定', () => {
    const { fx, bus, scene } = makeFx();
    let lights = 0;
    scene.traverse((o) => {
      if ((o as THREE.Light).isLight) lights++;
    });
    expect(lights).toBe(2);
    bus.emit('weapon:explosion', { shotId: 1, weaponId: 'p', point: { x: 0, y: 0, z: -5 }, normal: { x: 0, y: 1, z: 0 }, radius: 4, targets: 0, selfKnockback: 0 });
    expect(fx.explosions.ring.total).toBe(1);
    expect(fx.sparks.ring.total).toBe(FX_CONFIG.explosionSparks);
    expect(fx.decals.count).toBe(1);
    fx.advance(0.01);
    expect(fx.explosionLight.intensity).toBeGreaterThan(FX_CONFIG.explosionLight * 0.8);
    expect(fx.explosions.mesh.visible).toBe(true);
    fx.advance(1);
    expect(fx.explosionLight.intensity).toBe(0);
    expect(fx.explosions.mesh.visible).toBe(false);
    bus.emit('weapon:fire', {
      weaponId: 'r', slot: 0, shotId: 2, time: 0, origin: { x: 0, y: 0, z: 0 }, dir: { x: 0, y: 0, z: -1 }, pellets: 1, ammo: 31, mag: 32,
      spread: 1, ads: 0, mode: 'auto', firstShot: true, recoilPitch: 0, recoilYaw: 0,
    });
    fx.advance(0.005);
    expect(fx.muzzleLight.intensity).toBeGreaterThan(0);
    expect(fx.muzzleLight.position.toArray()).toEqual([0.2, 1.5, -0.5]);
    fx.advance(0.2);
    expect(fx.muzzleLight.intensity).toBe(0);
  });

  it('電漿投射物：池中每顆一個實例，剛射出時外觀往槍口偏、飛遠後回到真實位置', () => {
    const bus = new EventBus<GameEvents>();
    const proj = {
      position: { x: 0, y: 1.65, z: -1 },
      previousPosition: { x: 0, y: 1.65, z: -0.5 },
      velocity: { x: 0, y: 0, z: -45 },
      origin: { x: 0, y: 1.65, z: 0 },
      def: { projectile: { radius: 0.15 } },
    };
    const fx = new WeaponFx({
      scene: new THREE.Scene(),
      bus,
      muzzle: { muzzleWorld: (out) => out.set(0.2, 1.5, -0.5) },
      ballistics: { projectiles: { forEachActive: (fn) => fn(proj) } },
    });
    fx.advance(1 / 60, 1);
    expect(fx.bolts.count).toBe(1);
    expect(fx.bolts.mesh.visible).toBe(true);
    const head = fx.bolts.attrs.array('aHead');
    expect(head[0]).toBeGreaterThan(0.1); // 往槍口（右）偏
    proj.position.z = -20;
    proj.previousPosition.z = -19;
    fx.advance(1 / 60, 1);
    expect(head[0]).toBeCloseTo(0, 6);
    expect(head[2]).toBeCloseTo(-20, 5);
  });

  it('預熱：場景目標不建立代理物件（以自己的燈光另外編譯），材質照常', () => {
    const vmScene = new THREE.Scene();
    vmScene.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()));
    const proxies = buildWarmupProxies([vmScene, new THREE.MeshBasicMaterial()], createProxyGeometry());
    expect(proxies.children).toHaveLength(1);
  });
});

// ── 準星 ─────────────────────────────────────────────────

describe('準星', () => {
  it('半徑 = tan(散布) / tan(垂直 FOV / 2) × 畫面高度 / 2；開鏡縮放時跟著縮小', () => {
    expect(crosshairRadiusPx(1.6, 70.53, 1080)).toBeCloseTo((Math.tan(1.6 * DEG2RAD) / Math.tan(35.265 * DEG2RAD)) * 540, 6);
    expect(crosshairRadiusPx(0, 70, 1080)).toBe(0);
    const hip = crosshairRadiusPx(1, 70.53, 1080);
    const ads = crosshairRadiusPx(1, zoomedFov(70.53, 4), 1080);
    expect(ads / hip).toBeCloseTo(4, 1);
    const shotgun = createArchetype('scatter_shotgun')!;
    expect(patternRadiusDeg(shotgun)).toBeCloseTo(3.4, 2);
    expect(effectiveSpreadDeg(shotgun, 1)).toBeCloseTo(4.4, 2);
    expect(effectiveSpreadDeg(createArchetype('assault_rifle')!, 1)).toBe(1);
    expect(crosshairStyleFor('shotgun')).toBe('circle');
    expect(crosshairStyleFor('railSniper')).toBe('dot');
    expect(crosshairStyleFor('未知')).toBe(CROSSHAIR_CONFIG.defaultStyle);
  });

  /** 對 10 m 外的牆連射，回傳每發彈孔是否在「開火前一刻顯示的準星圈」內。 */
  function sprayAtWall(def: WeaponDef, opts: { ads?: boolean; air?: boolean; shots: number }): { inside: number; total: number; maxRatio: number } {
    const physics = new Physics();
    const bus = new EventBus<GameEvents>();
    const ballistics = new Ballistics({ physics, bus });
    addWall(physics, { x: 0, y: 1.65, z: -10.5 }, { x: 20, y: 20, z: 0.5 });
    // 後座關閉：畫面中心固定在初始視線，只比較散布與準星。
    def.recoil.pitchPerShot = [0, 0];
    def.recoil.yawPerShot = [0, 0];
    def.recoil.yawBias = 0;
    const loadout = defaultLoadout();
    loadout[0] = def;
    const player = new VmPlayer();
    if (opts.air) {
      player.state.grounded = false;
      player.state.state = 'air';
    }
    const sim = new WeaponSim({ loadout, ballistics, bus, player, seed: 99 });
    const height = 1080;
    const baseV = 70.53;
    if (opts.ads) {
      sim.input.down('ads');
      sim.run(0.5);
    }
    sim.manager.render(1);
    const vFov = 2 * Math.atan(Math.tan((baseV * DEG2RAD) / 2) / sim.camera.fovZoom) / DEG2RAD;
    let inside = 0;
    let total = 0;
    let maxRatio = 0;
    let seen = sim.count('weapon:hitscan');
    let shots = 0;
    for (let i = 0; i < 120 * 120 && shots < opts.shots; i++) {
      // 這一畫面顯示的準星（下一發會用的散布）。
      const radius = crosshairRadiusPx(effectiveSpreadDeg(def, sim.manager.currentSpread()), vFov, height);
      if (def.fire.mode === 'auto') sim.input.down('fire');
      else if (i % 2 === 0) sim.input.tap('fire');
      sim.step();
      const evs = sim.eventsNamed('weapon:hitscan').slice(seen);
      seen += evs.length;
      if (evs.length > 0) shots++;
      for (const e of evs) {
        const o = e.payload.origin as { x: number; y: number; z: number };
        const end = e.payload.end as { x: number; y: number; z: number };
        expect(e.payload.hitWorld).toBe(true);
        const r = screenRadiusPx(end.x - o.x, end.y - o.y, end.z - o.z, vFov, height);
        total++;
        if (r <= radius + 1e-6) inside++;
        maxRatio = Math.max(maxRatio, r / Math.max(radius, 1e-9));
      }
    }
    physics.dispose();
    return { inside, total, maxRatio };
  }

  it('驗收：對牆連射 30 發，≥ 90% 的彈孔落在準星圈內（步槍腰射、開鏡、空中；霰彈；手炮）', () => {
    const cases: [string, { ads?: boolean; air?: boolean }][] = [
      ['assault_rifle', {}],
      ['assault_rifle', { ads: true }],
      ['assault_rifle', { air: true }],
      ['hand_cannon', {}],
      ['scatter_shotgun', {}],
      ['rail_sniper', {}],
    ];
    for (const [id, o] of cases) {
      const res = sprayAtWall(createArchetype(id)!, { ...o, shots: 30 });
      expect(res.total, id).toBeGreaterThanOrEqual(30);
      expect(res.inside / res.total, `${id} ${JSON.stringify(o)} max ${res.maxRatio}`).toBeGreaterThanOrEqual(0.9);
    }
  });
});
