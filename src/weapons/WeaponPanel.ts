// 調參面板「武器」（M1-10）：綁定「目前手持武器」WeaponDef 的所有欄位（切槍時自動換成新武器），修改下一步就生效；
// 系統參數（近戰、射程、規則）；監看（狀態、彈藥、散布、開鏡、後座）；工具（匯出單把武器 JSON、重設為原型、補滿彈藥）。
// 綁定物件是一層「代理」：每個欄位的 getter／setter 讀寫 weapons.active.def 的對應路徑（例如 recoil.pitchPerShot.0）。
import type { EventBus } from '@/core/EventBus';
import type { GameEvents } from '@/core/events';
import { SystemOrder, type GameSystem } from '@/core/Game';
import type { ConfigSchema, DebugPanel, ParamSpec } from '@/debug/DebugPanel';
import { createArchetype } from '@/weapons/archetypes';
import { WEAPON_SYSTEM_PANEL } from '@/weapons/WeaponConfig';
import { validateWeaponDef, type WeaponDef } from '@/weapons/WeaponDef';
import type { WeaponManager } from '@/weapons/WeaponManager';

export interface WeaponField {
  /** WeaponDef 內的路徑（陣列用數字段，例如 recoil.pitchPerShot.0）。 */
  path: string;
  spec: ParamSpec;
  /** 選填欄位（burstCount、reloadPerShell、projectile.*）：不存在時讀成 0；reloadPerShell 寫 0 = 移除。 */
  optional?: boolean;
}

const n = (label: string, min: number, max: number, step: number, description?: string): ParamSpec =>
  description === undefined ? { label, min, max, step } : { label, min, max, step, description };

/** 面板資料夾與欄位（WeaponDef 的每個數值、列舉、文字與顏色欄位；彈丸圖案與 perk 清單除外）。 */
export const WEAPON_FIELD_GROUPS: readonly { folder: string; fields: readonly WeaponField[] }[] = [
  {
    folder: '武器/目前武器：射擊',
    fields: [
      { path: 'name', spec: { label: '名稱' } },
      { path: 'fire.mode', spec: { label: '射擊模式', options: { 全自動: 'auto', 半自動: 'semi', 連發: 'burst', 泵動: 'pump' } } },
      { path: 'fire.rpm', spec: n('RPM', 10, 1500, 1, '每分鐘發數；連發為每輪的節奏') },
      { path: 'fire.burstCount', spec: n('連發發數', 2, 10, 1), optional: true },
      { path: 'fire.burstRpm', spec: n('連發輪內 RPM', 60, 2000, 10), optional: true },
      { path: 'fire.pellets', spec: n('彈丸數', 1, 32, 1, '有彈丸圖案時須等於圖案長度') },
      { path: 'fire.triggerBuffer', spec: n('扳機緩衝 s', 0, 0.5, 0.01) },
    ],
  },
  {
    folder: '武器/目前武器：傷害',
    fields: [
      { path: 'damage.base', spec: n('基礎傷害', 0, 500, 1, '每顆彈丸／投射物直擊') },
      { path: 'damage.critMult', spec: n('弱點倍率', 0, 5, 0.05) },
      { path: 'damage.falloffStart', spec: n('衰減開始 m', 0, 500, 1) },
      { path: 'damage.falloffEnd', spec: n('衰減結束 m', 0, 500, 1) },
      { path: 'damage.minMult', spec: n('最低倍率', 0, 1, 0.01) },
      { path: 'damage.penetration', spec: n('穿透目標數', 0, 8, 1, '0 = 只打第一個；2 = 最多命中 3 個；不穿牆') },
    ],
  },
  {
    folder: '武器/目前武器：彈藥',
    fields: [
      { path: 'ammo.mag', spec: n('彈匣', 1, 200, 1) },
      { path: 'ammo.reloadTactical', spec: n('戰術換彈 s', 0, 6, 0.05, '逐發裝填時為裝第一發前的準備時間') },
      { path: 'ammo.reloadEmpty', spec: n('空倉換彈 s', 0, 6, 0.05) },
      { path: 'ammo.reloadPerShell', spec: n('逐發 s', 0, 2, 0.01, '0 = 彈匣式'), optional: true },
      { path: 'ammo.reloadAmmoPoint', spec: n('補彈點', 0, 1, 0.01, '換彈進度到此比例時補滿；之前取消不補彈') },
      { path: 'ammo.reserve', spec: n('備彈', -1, 9999, 1, '-1 = 無限') },
    ],
  },
  {
    folder: '武器/目前武器：散布',
    fields: [
      { path: 'spread.hip', spec: n('腰射°', 0, 15, 0.05, '錐形半角') },
      { path: 'spread.ads', spec: n('開鏡°', 0, 15, 0.05) },
      { path: 'spread.perShot', spec: n('每發擴散°', 0, 5, 0.01) },
      { path: 'spread.max', spec: n('上限°', 0, 20, 0.05) },
      { path: 'spread.recoveryPerSec', spec: n('回復 °/s', 0, 60, 0.1) },
      { path: 'spread.recoveryDelay', spec: n('回復延遲 s', 0, 1, 0.01, '停火多久後才開始回復擴散') },
      { path: 'spread.moveMult', spec: n('移動倍率', 0, 4, 0.01) },
      { path: 'spread.airMult', spec: n('空中倍率', 0, 4, 0.01) },
    ],
  },
  {
    folder: '武器/目前武器：後座',
    fields: [
      { path: 'recoil.pitchPerShot.0', spec: n('pitch 最小°', -5, 15, 0.05) },
      { path: 'recoil.pitchPerShot.1', spec: n('pitch 最大°', -5, 15, 0.05) },
      { path: 'recoil.yawPerShot.0', spec: n('yaw 最小°（右正）', -5, 5, 0.01) },
      { path: 'recoil.yawPerShot.1', spec: n('yaw 最大°（右正）', -5, 5, 0.01) },
      { path: 'recoil.yawBias', spec: n('yaw 偏向°', -3, 3, 0.01) },
      { path: 'recoil.firstShotMult', spec: n('第一發倍率', 0, 3, 0.05) },
      { path: 'recoil.recoveryPerSec', spec: n('回正 °/s', 0, 120, 0.5) },
      { path: 'recoil.recoveryDelay', spec: n('回正延遲 s', 0, 1, 0.01) },
      { path: 'recoil.adsMult', spec: n('開鏡倍率', 0, 2, 0.05) },
      { path: 'recoil.maxClimb', spec: n('最大上跳°', 0, 30, 0.5) },
    ],
  },
  {
    folder: '武器/目前武器：操作',
    fields: [
      { path: 'handling.swapIn', spec: n('掏槍 s', 0, 2, 0.01) },
      { path: 'handling.swapOut', spec: n('收槍 s', 0, 2, 0.01) },
      { path: 'handling.adsTime', spec: n('開鏡時間 s', 0, 1, 0.01) },
      { path: 'handling.adsZoom', spec: n('開鏡倍率', 1, 8, 0.05) },
      { path: 'handling.sprintToFire', spec: n('衝刺轉射擊 s', 0, 1, 0.01) },
      { path: 'handling.adsMoveSpeedMult', spec: n('開鏡移速倍率', 0, 1.5, 0.01) },
    ],
  },
  {
    folder: '武器/目前武器：投射物',
    fields: [
      { path: 'projectile.speed', spec: n('速度 m/s', 1, 300, 1), optional: true },
      { path: 'projectile.gravity', spec: n('重力 m/s²', -20, 40, 0.1), optional: true },
      { path: 'projectile.radius', spec: n('半徑 m', 0, 1, 0.01), optional: true },
      { path: 'projectile.lifetime', spec: n('存在時間 s', 0.1, 20, 0.1), optional: true },
      { path: 'projectile.splashRadius', spec: n('範圍半徑 m', 0, 15, 0.1), optional: true },
      { path: 'projectile.splashDamage', spec: n('範圍傷害', 0, 500, 1), optional: true },
      { path: 'projectile.splashMinMult', spec: n('範圍邊緣倍率', 0, 1, 0.01), optional: true },
      { path: 'projectile.selfKnockback', spec: n('自身擊退 m/s', 0, 40, 0.5), optional: true },
      { path: 'projectile.selfDamageMult', spec: n('自傷倍率', 0, 2, 0.05), optional: true },
    ],
  },
  {
    folder: '武器/目前武器：手感（M1-11）',
    fields: [
      { path: 'feel.trauma', spec: n('鏡頭 trauma', 0, 1, 0.005, '每發加到 CameraRig 的 trauma') },
      { path: 'feel.fovKick', spec: n('FOV 衝擊°', -10, 10, 0.1) },
      { path: 'feel.viewKick.pos.0', spec: n('後座位移 右 m', -0.1, 0.1, 0.001) },
      { path: 'feel.viewKick.pos.1', spec: n('後座位移 上 m', -0.1, 0.1, 0.001) },
      { path: 'feel.viewKick.pos.2', spec: n('後座位移 後 m', -0.3, 0.3, 0.001) },
      { path: 'feel.viewKick.rot.0', spec: n('後座旋轉 pitch°', -20, 20, 0.1) },
      { path: 'feel.viewKick.rot.1', spec: n('後座旋轉 yaw°', -10, 10, 0.1) },
      { path: 'feel.viewKick.rot.2', spec: n('後座旋轉 roll°', -10, 10, 0.1) },
      { path: 'feel.kickSpring.frequency', spec: n('回彈 Hz', 0.5, 30, 0.1) },
      { path: 'feel.kickSpring.dampingRatio', spec: n('回彈阻尼', 0, 2, 0.01) },
    ],
  },
  {
    folder: '武器/目前武器：音效與外觀（M1-11／M1-13）',
    fields: [
      { path: 'audio.fire', spec: { label: '開火配方' } },
      { path: 'audio.reload', spec: { label: '換彈配方' } },
      { path: 'model.frame', spec: { label: '槍身' } },
      { path: 'model.bodyLength', spec: n('機匣長 m', 0.05, 1.5, 0.01) },
      { path: 'model.bodyHeight', spec: n('機匣高 m', 0.02, 0.5, 0.005) },
      { path: 'model.barrelLength', spec: n('槍管長 m', 0, 1.5, 0.01) },
      { path: 'model.barrelRadius', spec: n('槍管半徑 m', 0.002, 0.2, 0.001) },
      { path: 'model.magazine', spec: { label: '彈匣外觀', options: { 彈匣: 'box', 管狀: 'tube', 能量匣: 'cell', 無: 'none' } } },
      { path: 'model.optic', spec: { label: '瞄具', options: { 無: 'none', 內紅點: 'reflex', 狙擊鏡: 'scope' } } },
      { path: 'model.stock', spec: { label: '槍托' } },
      { path: 'model.colors.body', spec: { label: '槍身色' } },
      { path: 'model.colors.accent', spec: { label: '配色' } },
      { path: 'model.colors.glow', spec: { label: '發光色' } },
      { path: 'model.muzzle.0', spec: n('槍口 右 m', -0.5, 0.5, 0.005) },
      { path: 'model.muzzle.1', spec: n('槍口 上 m', -0.5, 0.5, 0.005) },
      { path: 'model.muzzle.2', spec: n('槍口 前 m', -2, 0.5, 0.005) },
    ],
  },
];

/** 所有欄位（平坦清單）。 */
export const WEAPON_FIELDS: readonly WeaponField[] = WEAPON_FIELD_GROUPS.flatMap((g) => g.fields);

function segments(path: string): string[] {
  return path.split('.');
}

/** 讀取 WeaponDef 欄位（選填欄位不存在時回傳 0；備彈 'infinite' 讀成 -1）。 */
export function readWeaponField(def: Readonly<WeaponDef>, path: string): unknown {
  let cur: unknown = def;
  for (const k of segments(path)) {
    if (typeof cur !== 'object' || cur === null) return 0;
    cur = (cur as Record<string, unknown>)[k];
  }
  if (path === 'ammo.reserve') return cur === 'infinite' ? -1 : cur;
  return cur === undefined ? 0 : cur;
}

/**
 * 寫入 WeaponDef 欄位。投射物欄位在沒有 projectile 的武器上忽略；reloadPerShell ≤ 0 時移除（改回彈匣式）；
 * 備彈 < 0 寫成 'infinite'。回傳是否寫入。
 */
export function writeWeaponField(def: WeaponDef, path: string, value: unknown): boolean {
  const segs = segments(path);
  if (segs[0] === 'projectile' && !def.projectile) return false;
  if (path === 'ammo.reloadPerShell') {
    if (typeof value !== 'number' || value <= 0) delete def.ammo.reloadPerShell;
    else def.ammo.reloadPerShell = value;
    return true;
  }
  if (path === 'ammo.reserve') {
    def.ammo.reserve = typeof value === 'number' && value >= 0 ? Math.floor(value) : 'infinite';
    return true;
  }
  let cur: Record<string, unknown> = def as unknown as Record<string, unknown>;
  for (let i = 0; i < segs.length - 1; i++) {
    const next = cur[segs[i]!];
    if (typeof next !== 'object' || next === null) return false;
    cur = next as Record<string, unknown>;
  }
  cur[segs[segs.length - 1]!] = value;
  return true;
}

/** 目前武器的匯出 JSON（格式即 WeaponDef，可直接貼回 archetypes.ts 或給 M2-01 的生成器當範本）。 */
export function exportWeaponJson(def: Readonly<WeaponDef>): string {
  return JSON.stringify(def, null, 2);
}

interface WeaponMonitor {
  weapon: string;
  phase: string;
  ammo: string;
  spreadGraph: number;
  spread: number;
  ads: number;
  recoil: string;
  recoilStats: string;
  nextShot: number;
  reload: string;
  swap: string;
  melee: string;
  projectiles: number;
  damageEvents: number;
  validation: string;
}

export interface WeaponPanelOptions {
  panel: DebugPanel;
  weapons: WeaponManager;
  bus?: EventBus<GameEvents> | undefined;
  /** 匯出時複製到剪貼簿（瀏覽器不允許時只印在主控台）。 */
  copyText?: (text: string) => void;
}

/** 註冊「武器」資料夾；回傳更新監看值的 Game 系統（order = debug，面板開啟時才更新）。 */
export function bindWeaponPanel(options: WeaponPanelOptions): GameSystem & { lastExport: string; refresh(): void } {
  const { panel, weapons } = options;
  const getDef = (): WeaponDef | null => weapons.active?.def ?? null;
  const onDefChanged = (): void => {
    const w = weapons.active;
    if (!w) return;
    // 重新指派會重新解析 perk、夾住彈匣與備彈。
    w.def = w.def;
    const r = validateWeaponDef(w.def);
    monitor.validation = r.ok ? '合法' : r.errors.join('；');
    if (!r.ok) console.warn(`[shardwake] 武器「${w.id}」數值不合法：${r.errors.join('；')}`);
  };
  const bindings: { refresh(): void }[] = [];
  for (const group of WEAPON_FIELD_GROUPS) {
    const proxy: Record<string, unknown> = {};
    const schema: Record<string, ParamSpec> = {};
    for (const field of group.fields) {
      Object.defineProperty(proxy, field.path, {
        enumerable: true,
        get: () => {
          const def = getDef();
          return def ? readWeaponField(def, field.path) : 0;
        },
        set: (v: unknown) => {
          const def = getDef();
          if (def) writeWeaponField(def, field.path, v);
        },
      });
      schema[field.path] = field.spec;
    }
    bindings.push(panel.bindConfig(group.folder, proxy, schema as ConfigSchema<typeof proxy>, { onChange: onDefChanged }));
  }
  for (const group of WEAPON_SYSTEM_PANEL) panel.bindConfig(group.folder, weapons.config, group.schema);

  const monitor: WeaponMonitor = {
    weapon: '',
    phase: '',
    ammo: '',
    spreadGraph: 0,
    spread: 0,
    ads: 0,
    recoil: '',
    recoilStats: '',
    nextShot: 0,
    reload: '',
    swap: '',
    melee: '',
    projectiles: 0,
    damageEvents: 0,
    validation: '合法',
  };
  panel.bindConfig(
    '武器/監看',
    monitor,
    {
      weapon: { label: '武器', readonly: true },
      phase: { label: '狀態', readonly: true },
      ammo: { label: '彈藥', readonly: true },
      spreadGraph: { label: '散布°', readonly: true, min: 0, max: 6, params: { view: 'graph' } },
      spread: { label: '散布半角°', readonly: true },
      ads: { label: '開鏡進度', readonly: true },
      recoil: { label: '後座偏移°', readonly: true },
      recoilStats: { label: '累積／回正／吸收°', readonly: true },
      nextShot: { label: '下一發 s', readonly: true },
      reload: { label: '換彈', readonly: true },
      swap: { label: '切槍', readonly: true },
      melee: { label: '近戰冷卻', readonly: true },
      projectiles: { label: '投射物', readonly: true },
      damageEvents: { label: '傷害事件', readonly: true },
      validation: { label: '數值驗證', readonly: true },
    },
    { expanded: true },
  );

  const sys = {
    name: 'weaponPanel',
    order: SystemOrder.debug,
    lastExport: '',
    refresh(): void {
      for (const b of bindings) b.refresh();
    },
    update(): void {
      if (!panel.isOpen) return;
      const s = weapons.state;
      const w = weapons.active;
      monitor.weapon = `${s.slot + 1}：${s.name}`;
      monitor.phase = s.phase;
      monitor.ammo = `${s.ammo} / ${s.mag}（備彈 ${Number.isFinite(s.reserve) ? s.reserve : '∞'}）`;
      monitor.spreadGraph = s.spread;
      monitor.spread = s.spread;
      monitor.ads = s.ads;
      monitor.recoil = `${s.recoilPitch.toFixed(2)}, ${s.recoilYaw.toFixed(2)}`;
      const r = weapons.recoil;
      monitor.recoilStats = `${r.accumulated.toFixed(1)} / ${r.recovered.toFixed(1)} / ${r.absorbed.toFixed(1)}`;
      monitor.nextShot = s.nextShotIn;
      monitor.reload = s.reloadKind ? `${s.reloadKind} ${(s.reloadProgress * 100).toFixed(0)}%` : '—';
      monitor.swap = s.phase === 'swapping' ? `→ ${s.swapTo + 1}（${(s.swapProgress * 100).toFixed(0)}%）` : '—';
      monitor.melee = s.meleeCooldown > 0 ? `${(s.meleeCooldown * 100).toFixed(0)}%` : '可用';
      monitor.projectiles = weapons.ballistics?.projectiles.activeCount ?? 0;
      monitor.damageEvents = weapons.ballistics?.damageEvents ?? 0;
      if (!w) monitor.validation = '—';
    },
  };

  const copy =
    options.copyText ??
    ((text: string): void => {
      const clip = (globalThis as { navigator?: { clipboard?: { writeText(t: string): Promise<void> } } }).navigator?.clipboard;
      clip?.writeText(text).catch(() => {});
    });
  panel.bindButtons('武器/工具', [
    {
      title: '匯出目前武器 JSON',
      onClick: () => {
        const def = getDef();
        if (!def) return;
        const json = exportWeaponJson(def);
        sys.lastExport = json;
        console.info(`[shardwake] 武器「${def.id}」JSON（已嘗試複製到剪貼簿）：\n${json}`);
        copy(json);
      },
    },
    {
      title: '重設為原型數值',
      onClick: () => {
        const w = weapons.active;
        if (!w) return;
        const fresh = createArchetype(w.id);
        if (!fresh) return;
        w.def = fresh;
        monitor.validation = '合法';
        sys.refresh();
      },
    },
    {
      title: '補滿彈藥',
      onClick: () => weapons.active?.refill(),
    },
  ]);

  // 切槍時面板換成新武器的數值。
  options.bus?.on('weapon:swap', ({ phase }) => {
    if (phase !== 'out') sys.refresh();
  });
  return sys;
}
