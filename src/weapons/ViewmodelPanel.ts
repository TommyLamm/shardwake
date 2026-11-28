// 調參面板「武器表現」（M1-11）：viewmodel 擺位與動畫、特效（共用與每種武器原型）、準星、監看與測試按鈕。
// 每把武器自己的後座踢動（feel.viewKick／kickSpring）、開鏡對位（model.adsOffset）與槍模部件在「武器/目前武器：…」。
// 面板的修改不存檔（M1-16 調校後寫回資料表）。
import * as THREE from 'three';
import { SystemOrder, type GameSystem } from '@/core/Game';
import type { ConfigSchema, DebugPanel, ParamSpec } from '@/debug/DebugPanel';
import { FX_PANEL, FX_STYLE_PANEL, WEAPON_FX_STYLES } from '@/fx/FxConfig';
import type { WeaponFx } from '@/fx/WeaponFx';
import { CROSSHAIR_PANEL, type Crosshair } from '@/ui/Crosshair';
import type { Viewmodel } from '@/weapons/Viewmodel';
import { VIEWMODEL_PANEL, type Vec3Tuple, type ViewmodelConfig } from '@/weapons/ViewmodelConfig';

/** 武器原型的中文名稱（面板資料夾）。 */
export const ARCHETYPE_LABELS: Record<string, string> = {
  default: '其他',
  assaultRifle: '突擊步槍',
  shotgun: '散射霰彈槍',
  handCannon: '重型手炮',
  railSniper: '磁軌狙擊槍',
  plasmaLauncher: '電漿發射器',
};

const VECTOR_LABELS: Partial<Record<keyof ViewmodelConfig, string>> = {
  hipRifle: '腰射位置：步槍',
  hipShotgun: '腰射位置：霰彈',
  hipPistol: '腰射位置：手炮',
  hipSniper: '腰射位置：狙擊',
  hipLauncher: '腰射位置：發射器',
  sprintPos: '衝刺位移',
  sprintRot: '衝刺旋轉°（pitch, yaw, roll）',
  slidePos: '滑鏟位移',
  reloadPos: '換彈位移',
  shellPos: '逐發位移',
};

/** Vec3 陣列欄位的面板代理：{ x, y, z } ↔ [x, y, z]。 */
export function vectorProxy<T extends object>(obj: T, keys: readonly (keyof T)[]): Record<string, { x: number; y: number; z: number }> {
  const proxy: Record<string, { x: number; y: number; z: number }> = {};
  for (const key of keys) {
    const cache = { x: 0, y: 0, z: 0 };
    Object.defineProperty(proxy, key, {
      enumerable: true,
      get: () => {
        const a = obj[key] as unknown as Vec3Tuple;
        cache.x = a[0];
        cache.y = a[1];
        cache.z = a[2];
        return cache;
      },
      set: (v: { x: number; y: number; z: number }) => {
        const a = obj[key] as unknown as Vec3Tuple;
        a[0] = v.x;
        a[1] = v.y;
        a[2] = v.z;
      },
    });
  }
  return proxy;
}

export interface PresentationPanelOptions {
  panel: DebugPanel;
  viewmodel: Viewmodel;
  fx: WeaponFx;
  crosshair: Crosshair;
  camera: THREE.Camera;
}

interface PresentationMonitor {
  viewmodel: string;
  ads: number;
  scope: number;
  sway: string;
  bob: string;
  pose: string;
  reload: string;
  kick: string;
  crosshair: string;
  sparks: number;
  tracers: string;
  decals: string;
  vmObjects: number;
}

/** 註冊「武器表現」資料夾；回傳更新監看值的 Game 系統（面板開啟時才更新）。 */
export function bindPresentationPanel(options: PresentationPanelOptions): GameSystem {
  const { panel, viewmodel, fx, crosshair, camera } = options;
  const cfg = viewmodel.config;
  for (const group of VIEWMODEL_PANEL) {
    panel.bindConfig(group.folder, cfg, group.schema);
    if (group.vectors?.length) {
      const proxy = vectorProxy(cfg, group.vectors);
      const schema: Record<string, ParamSpec> = {};
      for (const k of group.vectors) {
        const range = k.startsWith('hip') ? 0.6 : k === 'sprintRot' ? 60 : 0.2;
        const step = k === 'sprintRot' ? 0.5 : 0.001;
        schema[k] = {
          label: VECTOR_LABELS[k] ?? String(k),
          params: { x: { min: -range, max: range, step }, y: { min: -range, max: range, step }, z: { min: -range, max: range, step } },
        };
      }
      panel.bindConfig(group.folder, proxy, schema as ConfigSchema<typeof proxy>);
    }
  }
  panel.bindConfig('武器表現/特效：共用', fx.config, FX_PANEL);
  for (const [id, style] of Object.entries(WEAPON_FX_STYLES)) {
    panel.bindConfig(`武器表現/特效：${ARCHETYPE_LABELS[id] ?? id}`, style, FX_STYLE_PANEL);
  }
  panel.bindConfig('武器表現/準星', crosshair.config, CROSSHAIR_PANEL);
  const styleOptions = { 十字: 'cross', 圓: 'circle', 點: 'dot' };
  const styleSchema: Record<string, ParamSpec> = {};
  for (const id of Object.keys(crosshair.config.styles)) styleSchema[id] = { label: `樣式：${ARCHETYPE_LABELS[id] ?? id}`, options: styleOptions };
  panel.bindConfig('武器表現/準星', crosshair.config.styles, styleSchema as ConfigSchema<typeof crosshair.config.styles>);

  const ahead = (dist: number): { p: THREE.Vector3; n: THREE.Vector3 } => {
    const n = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    const p = camera.getWorldPosition(new THREE.Vector3()).addScaledVector(n, dist);
    return { p, n: n.negate() };
  };
  panel.bindButtons('武器表現/測試', [
    {
      title: '前方爆炸（半徑 4 m）',
      onClick: () => {
        const { p, n } = ahead(10);
        fx.spawnExplosion(p, n, 4);
      },
    },
    {
      title: '前方命中火花（發光表面）',
      onClick: () => {
        const { p, n } = ahead(4);
        fx.spawnImpact(p, n, 'energy', { decal: false });
      },
    },
    { title: '清除彈孔與特效', onClick: () => fx.clear() },
  ]);

  const m: PresentationMonitor = {
    viewmodel: '',
    ads: 0,
    scope: 0,
    sway: '',
    bob: '',
    pose: '',
    reload: '',
    kick: '',
    crosshair: '',
    sparks: 0,
    tracers: '',
    decals: '',
    vmObjects: 0,
  };
  panel.bindConfig(
    '武器表現/監看',
    m,
    {
      viewmodel: { label: '槍模', readonly: true },
      ads: { label: '開鏡（曲線後）', readonly: true },
      scope: { label: '狙擊鏡遮罩', readonly: true },
      sway: { label: '擺動 yaw／pitch°', readonly: true },
      bob: { label: '晃動 權重／相位', readonly: true },
      pose: { label: '衝刺／滑鏟／跑牆／空中', readonly: true },
      reload: { label: '換彈／切槍／近戰／泵動', readonly: true },
      kick: { label: '踢動 後 m／pitch°', readonly: true },
      crosshair: { label: '準星', readonly: true },
      sparks: { label: '火花（存活）', readonly: true },
      tracers: { label: '曳光／命中／爆炸', readonly: true },
      decals: { label: '彈孔（上限）', readonly: true },
      vmObjects: { label: '已建立槍模', readonly: true },
    },
    { expanded: true },
  );
  const f2 = (x: number): string => x.toFixed(2);
  return {
    name: 'presentationMonitor',
    order: SystemOrder.debug,
    update() {
      if (!panel.isOpen) return;
      const s = viewmodel.state;
      m.viewmodel = s.visible ? `${s.weaponId}（${s.frame}）` : `隱藏${s.weaponId ? `（${s.weaponId}）` : ''}`;
      m.ads = Math.round(s.ads * 100) / 100;
      m.scope = Math.round(s.scope * 100) / 100;
      m.sway = `${f2(s.swayYaw)}／${f2(s.swayPitch)}`;
      m.bob = `${f2(s.bobWeight)}／${f2(s.bobPhase % (Math.PI * 2))}`;
      m.pose = `${f2(s.sprint)}／${f2(s.slide)}／${f2(s.wall)}／${f2(s.air)}`;
      m.reload = `${f2(s.reload)}／${f2(s.lowered)}／${f2(s.melee)}／${f2(s.pump)}`;
      m.kick = `${s.kickZ.toFixed(3)}／${f2(s.kickPitch)}`;
      m.crosshair = `${crosshair.style} r=${crosshair.radius.toFixed(1)}px α=${f2(crosshair.opacity)}`;
      m.sparks = fx.sparks.activeCount(fx.time);
      m.tracers = `${fx.stats.tracers}／${fx.stats.impacts}／${fx.stats.explosions}`;
      m.decals = `${fx.decals.count}／${fx.decals.ring.capacity}（覆蓋 ${fx.decals.ring.overwritten}）`;
      m.vmObjects = s.models;
    },
  };
}
