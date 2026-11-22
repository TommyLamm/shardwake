// 調參面板「鏡頭」資料夾（M1-08）：CAMERA_CONFIG 各組參數、速度線參數、監看值與測試按鈕。
// 玩家可調的開關與強度（動態視野、傾斜強度、落地下沉、頭部晃動、震動強度、速度線）在「設定」資料夾。
import { SystemOrder, type GameSystem } from '@/core/Game';
import type { DebugPanel } from '@/debug/DebugPanel';
import { CAMERA_PANEL } from '@/camera/CameraConfig';
import type { CameraRig } from '@/camera/CameraRig';
import { SPEED_LINES_PANEL, type SpeedLines } from '@/fx/SpeedLines';

export interface CameraMonitor {
  fovGraph: number;
  fov: string;
  baseFov: string;
  roll: number;
  dip: number;
  trauma: number;
  bob: number;
  eyeOffset: number;
  speedLines: number;
}

/** 註冊「鏡頭」資料夾；回傳更新監看值的 Game 系統（order = debug，只在面板開啟時更新）。 */
export function bindCameraPanel(panel: DebugPanel, rig: CameraRig, speedLines: SpeedLines): GameSystem {
  for (const group of CAMERA_PANEL) panel.bindConfig(group.folder, rig.config, group.schema);
  panel.bindConfig('鏡頭/速度線', speedLines.config, SPEED_LINES_PANEL);
  const m: CameraMonitor = {
    fovGraph: 0,
    fov: '',
    baseFov: '',
    roll: 0,
    dip: 0,
    trauma: 0,
    bob: 0,
    eyeOffset: 0,
    speedLines: 0,
  };
  panel.bindConfig(
    '鏡頭/監看',
    m,
    {
      fovGraph: { label: '水平 FOV', readonly: true, min: 80, max: 150, params: { view: 'graph' } },
      fov: { label: 'FOV 水平／垂直', readonly: true },
      baseFov: { label: '基礎 FOV', readonly: true },
      roll: { label: '傾斜°', readonly: true },
      dip: { label: '落地下沉 m', readonly: true },
      trauma: { label: 'trauma', readonly: true },
      bob: { label: '晃動 m', readonly: true },
      eyeOffset: { label: '眼高 m', readonly: true },
      speedLines: { label: '速度線強度', readonly: true },
    },
    { expanded: true },
  );
  panel.bindButtons('鏡頭/測試', [
    { title: '震動 0.3', onClick: () => rig.addTrauma(0.3) },
    { title: '震動 0.6', onClick: () => rig.addTrauma(0.6) },
    { title: '震動 1.0', onClick: () => rig.addTrauma(1) },
    { title: 'FOV 衝擊（Dash）', onClick: () => rig.addFovKick(rig.config.fovDashKick, rig.config.fovDashKickTime) },
    { title: '傾斜衝量 +5°', onClick: () => rig.addRollImpulse(5) },
    { title: '傾斜衝量 -5°', onClick: () => rig.addRollImpulse(-5) },
  ]);
  const r2 = (x: number): number => Math.round(x * 100) / 100;
  return {
    name: 'cameraMonitor',
    order: SystemOrder.debug,
    update() {
      if (!panel.isOpen) return;
      const s = rig.state;
      m.fovGraph = s.horizontalFov;
      m.fov = `${s.horizontalFov.toFixed(1)}°／${s.verticalFov.toFixed(1)}°`;
      m.baseFov = `${s.baseHorizontalFov.toFixed(1)}°／${s.baseVerticalFov.toFixed(1)}°`;
      m.roll = r2(s.rollDeg);
      m.dip = Math.round(s.dip * 1000) / 1000;
      m.trauma = r2(s.trauma);
      m.bob = Math.round(s.bob * 1000) / 1000;
      m.eyeOffset = Math.round(s.eyeOffset * 1000) / 1000;
      m.speedLines = r2(speedLines.intensity);
    },
  };
}
