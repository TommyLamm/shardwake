// 5 把原型武器的初始數值（M1-10；手感調校在 M1-16）。數值表見 docs/plans/M1-10-weapon-core.md。
// 這些是「範本」：遊戲中的武器用 createArchetype() 取得深複製，調參面板改的是複本，不會改到這裡。
import { assertWeaponDef, cloneWeaponDef, type WeaponDef } from '@/weapons/WeaponDef';

/** 霰彈的固定彈丸圖案（度，[右, 上]）：中心 1 發、內圈 3 發、外圈 6 發。 */
export function ringPattern(rings: readonly { count: number; radius: number; phaseDeg: number }[], center = true): [number, number][] {
  const out: [number, number][] = [];
  if (center) out.push([0, 0]);
  for (const r of rings) {
    for (let i = 0; i < r.count; i++) {
      const a = ((r.phaseDeg + (360 * i) / r.count) * Math.PI) / 180;
      out.push([Math.round(Math.cos(a) * r.radius * 1000) / 1000, Math.round(Math.sin(a) * r.radius * 1000) / 1000]);
    }
  }
  return out;
}

const NO_PERKS: WeaponDef['perks'] = [];

export const ASSAULT_RIFLE: WeaponDef = {
  id: 'assault_rifle',
  name: '突擊步槍「斷流」',
  archetype: 'assaultRifle',
  fire: { mode: 'auto', rpm: 600, pellets: 1, triggerBuffer: 0.08 },
  damage: { base: 18, critMult: 1.8, falloffStart: 30, falloffEnd: 60, minMult: 0.6, penetration: 0 },
  ammo: { type: 'mag', mag: 32, reloadTactical: 1.6, reloadEmpty: 2.0, reloadAmmoPoint: 0.7, reserve: 'infinite' },
  spread: { hip: 1.6, ads: 0.25, perShot: 0.18, max: 4, recoveryPerSec: 6, recoveryDelay: 0.15, moveMult: 1.25, airMult: 1.5 },
  recoil: {
    pitchPerShot: [0.35, 0.55],
    yawPerShot: [-0.22, 0.26],
    yawBias: 0.04,
    firstShotMult: 0.6,
    recoveryPerSec: 18,
    recoveryDelay: 0.12,
    adsMult: 0.7,
    maxClimb: 8,
  },
  handling: { swapIn: 0.4, swapOut: 0.25, adsTime: 0.2, adsZoom: 1.3, sprintToFire: 0.15, adsMoveSpeedMult: 0.75 },
  feel: {
    trauma: 0.1,
    viewKick: { pos: [0, 0.004, 0.028], rot: [1.2, 0.25, 0.6] },
    kickSpring: { frequency: 11, dampingRatio: 0.55 },
    fovKick: 0,
  },
  audio: { fire: 'rifle', reload: 'magazine', params: { pitch: 1, body: 0.6, crack: 0.7, tail: 0.35 } },
  model: {
    frame: 'rifle',
    bodyLength: 0.42,
    bodyHeight: 0.09,
    barrelLength: 0.26,
    barrelRadius: 0.014,
    magazine: 'box',
    optic: 'reflex',
    stock: true,
    colors: { body: '#2a3140', accent: '#5d6b80', glow: '#33e6ff' },
    muzzle: [0, 0.02, -0.62],
    adsOffset: [0, 0, 0],
  },
  perks: NO_PERKS,
};

export const SCATTER_SHOTGUN: WeaponDef = {
  id: 'scatter_shotgun',
  name: '散射霰彈槍「碎浪」',
  archetype: 'shotgun',
  fire: { mode: 'pump', rpm: 80, pellets: 10, triggerBuffer: 0.12 },
  damage: { base: 12, critMult: 1.5, falloffStart: 8, falloffEnd: 20, minMult: 0.2, penetration: 0 },
  ammo: {
    type: 'mag',
    mag: 6,
    reloadTactical: 0,
    reloadEmpty: 0,
    reloadPerShell: 0.45,
    reloadAmmoPoint: 0.7,
    reserve: 'infinite',
  },
  spread: {
    hip: 1.0,
    ads: 0.5,
    perShot: 0.6,
    max: 2.4,
    recoveryPerSec: 4,
    recoveryDelay: 0.2,
    moveMult: 1.15,
    airMult: 1.3,
    pelletPattern: ringPattern([
      { count: 3, radius: 1.7, phaseDeg: 90 },
      { count: 6, radius: 3.4, phaseDeg: 0 },
    ]),
  },
  recoil: {
    pitchPerShot: [2.6, 3.2],
    yawPerShot: [-0.6, 0.6],
    yawBias: 0,
    firstShotMult: 1,
    recoveryPerSec: 22,
    recoveryDelay: 0.15,
    adsMult: 0.85,
    maxClimb: 6,
  },
  handling: { swapIn: 0.45, swapOut: 0.25, adsTime: 0.22, adsZoom: 1.1, sprintToFire: 0.18, adsMoveSpeedMult: 0.8 },
  feel: {
    trauma: 0.22,
    viewKick: { pos: [0, 0.012, 0.085], rot: [6, 0.6, 1.5] },
    kickSpring: { frequency: 8, dampingRatio: 0.6 },
    fovKick: 1.5,
  },
  audio: { fire: 'shotgun', reload: 'shell', params: { pitch: 0.75, body: 1, crack: 0.5, tail: 0.6 } },
  model: {
    frame: 'shotgun',
    bodyLength: 0.4,
    bodyHeight: 0.1,
    barrelLength: 0.32,
    barrelRadius: 0.022,
    magazine: 'tube',
    optic: 'none',
    stock: true,
    colors: { body: '#30293a', accent: '#6e5a7a', glow: '#ff3fd2' },
    muzzle: [0, 0.025, -0.7],
    adsOffset: [0, 0, 0.02],
  },
  perks: NO_PERKS,
};

export const HAND_CANNON: WeaponDef = {
  id: 'hand_cannon',
  name: '重型手炮「裂錨」',
  archetype: 'handCannon',
  fire: { mode: 'semi', rpm: 160, pellets: 1, triggerBuffer: 0.08 },
  damage: { base: 60, critMult: 2.0, falloffStart: 25, falloffEnd: 50, minMult: 0.7, penetration: 0 },
  ammo: { type: 'mag', mag: 8, reloadTactical: 1.8, reloadEmpty: 1.8, reloadAmmoPoint: 0.65, reserve: 'infinite' },
  spread: { hip: 0.9, ads: 0.12, perShot: 0.9, max: 3, recoveryPerSec: 3, recoveryDelay: 0.1, moveMult: 1.2, airMult: 1.4 },
  recoil: {
    pitchPerShot: [2.6, 3.2],
    yawPerShot: [-0.5, 0.5],
    yawBias: 0,
    firstShotMult: 1,
    recoveryPerSec: 30,
    recoveryDelay: 0.06,
    adsMult: 0.8,
    maxClimb: 10,
  },
  handling: { swapIn: 0.3, swapOut: 0.2, adsTime: 0.18, adsZoom: 1.2, sprintToFire: 0.12, adsMoveSpeedMult: 0.85 },
  feel: {
    trauma: 0.16,
    viewKick: { pos: [0, 0.02, 0.06], rot: [9, 0.4, 2] },
    kickSpring: { frequency: 9, dampingRatio: 0.5 },
    fovKick: 0.8,
  },
  audio: { fire: 'handcannon', reload: 'cylinder', params: { pitch: 0.85, body: 0.9, crack: 0.9, tail: 0.5 } },
  model: {
    frame: 'pistol',
    bodyLength: 0.24,
    bodyHeight: 0.11,
    barrelLength: 0.16,
    barrelRadius: 0.018,
    magazine: 'box',
    optic: 'none',
    stock: false,
    colors: { body: '#3a3330', accent: '#8a6a4a', glow: '#ff8a2a' },
    muzzle: [0, 0.03, -0.42],
    adsOffset: [0, 0, 0.04],
  },
  perks: NO_PERKS,
};

export const RAIL_SNIPER: WeaponDef = {
  id: 'rail_sniper',
  name: '磁軌狙擊槍「垂線」',
  archetype: 'railSniper',
  fire: { mode: 'semi', rpm: 55, pellets: 1, triggerBuffer: 0.1 },
  damage: { base: 140, critMult: 2.5, falloffStart: 300, falloffEnd: 300, minMult: 1, penetration: 2 },
  ammo: { type: 'mag', mag: 4, reloadTactical: 2.4, reloadEmpty: 2.4, reloadAmmoPoint: 0.7, reserve: 'infinite' },
  spread: { hip: 3, ads: 0, perShot: 0, max: 3, recoveryPerSec: 3, recoveryDelay: 0.2, moveMult: 1.1, airMult: 1.3 },
  recoil: {
    pitchPerShot: [3.5, 4.5],
    yawPerShot: [-0.4, 0.4],
    yawBias: 0,
    firstShotMult: 1,
    recoveryPerSec: 12,
    recoveryDelay: 0.25,
    adsMult: 0.6,
    maxClimb: 8,
  },
  handling: { swapIn: 0.55, swapOut: 0.3, adsTime: 0.32, adsZoom: 4, sprintToFire: 0.25, adsMoveSpeedMult: 0.55 },
  feel: {
    trauma: 0.28,
    viewKick: { pos: [0, 0.015, 0.11], rot: [7, 0.3, 1] },
    kickSpring: { frequency: 6, dampingRatio: 0.65 },
    fovKick: 2,
  },
  audio: { fire: 'railgun', reload: 'cell', params: { pitch: 1.2, body: 0.7, crack: 1, tail: 0.9, charge: 0.5 } },
  model: {
    frame: 'sniper',
    bodyLength: 0.55,
    bodyHeight: 0.1,
    barrelLength: 0.48,
    barrelRadius: 0.016,
    magazine: 'cell',
    optic: 'scope',
    stock: true,
    colors: { body: '#1f2a33', accent: '#4a6070', glow: '#7ff0ff' },
    muzzle: [0, 0.02, -0.95],
    adsOffset: [0, 0, 0],
  },
  perks: NO_PERKS,
};

export const PLASMA_LAUNCHER: WeaponDef = {
  id: 'plasma_launcher',
  name: '電漿發射器「曙核」',
  archetype: 'plasmaLauncher',
  fire: { mode: 'semi', rpm: 70, pellets: 1, triggerBuffer: 0.1 },
  damage: { base: 90, critMult: 1, falloffStart: 1000, falloffEnd: 1000, minMult: 1, penetration: 0 },
  projectile: {
    speed: 45,
    gravity: 0,
    radius: 0.15,
    lifetime: 4,
    splashRadius: 4,
    splashDamage: 70,
    splashMinMult: 0.25,
    selfKnockback: 12,
    selfDamageMult: 0,
  },
  ammo: { type: 'mag', mag: 4, reloadTactical: 2.2, reloadEmpty: 2.2, reloadAmmoPoint: 0.7, reserve: 'infinite' },
  spread: { hip: 0.6, ads: 0.2, perShot: 0.4, max: 2, recoveryPerSec: 3, recoveryDelay: 0.2, moveMult: 1.15, airMult: 1.3 },
  recoil: {
    pitchPerShot: [2, 2.6],
    yawPerShot: [-0.3, 0.3],
    yawBias: 0,
    firstShotMult: 1,
    recoveryPerSec: 15,
    recoveryDelay: 0.15,
    adsMult: 0.85,
    maxClimb: 6,
  },
  handling: { swapIn: 0.5, swapOut: 0.3, adsTime: 0.25, adsZoom: 1.2, sprintToFire: 0.2, adsMoveSpeedMult: 0.7 },
  feel: {
    trauma: 0.18,
    viewKick: { pos: [0, 0.015, 0.07], rot: [5, 0.3, 1.2] },
    kickSpring: { frequency: 7, dampingRatio: 0.6 },
    fovKick: 1,
  },
  audio: { fire: 'plasma', reload: 'cell', params: { pitch: 0.6, body: 1, crack: 0.2, tail: 0.8 } },
  model: {
    frame: 'launcher',
    bodyLength: 0.5,
    bodyHeight: 0.14,
    barrelLength: 0.2,
    barrelRadius: 0.045,
    magazine: 'cell',
    optic: 'reflex',
    stock: false,
    colors: { body: '#262b36', accent: '#5a4a7a', glow: '#b36bff' },
    muzzle: [0, 0.03, -0.7],
    adsOffset: [0, -0.004, 0.02],
  },
  perks: NO_PERKS,
};

/** 預設的 5 個武器欄位（1–5）。 */
export const ARCHETYPES: readonly WeaponDef[] = [ASSAULT_RIFLE, SCATTER_SHOTGUN, HAND_CANNON, RAIL_SNIPER, PLASMA_LAUNCHER];

for (const def of ARCHETYPES) assertWeaponDef(def);

/** 依 id 取得原型的深複製；找不到時回傳 null。 */
export function createArchetype(id: string): WeaponDef | null {
  const def = ARCHETYPES.find((d) => d.id === id);
  return def ? cloneWeaponDef(def) : null;
}

/** 5 把原型的深複製（預設裝備）。 */
export function defaultLoadout(): WeaponDef[] {
  return ARCHETYPES.map((d) => cloneWeaponDef(d));
}
