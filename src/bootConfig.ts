// 開機場景（M1-01 佔位場景）的顯示數值；可在調參面板「開機場景」調整。M1-04 換成灰盒訓練場。
// FOV 改由設定（水平 FOV）決定，像素比上限改由 core/config.ts 的 VIEWPORT_CONFIG 決定，
// FPS 取樣改由 STATS_CONFIG 決定。
export interface BootSceneConfig {
  clearColor: number;
  glowColor: number;
  emissiveIntensity: number;
  glowLightIntensity: number;
  haloScale: number;
  haloOpacity: number;
  /** 方塊旋轉速度（弧度／秒），在固定步內積分、渲染時插值。 */
  spinSpeed: { x: number; y: number };
  gravityY: number;
}

export const BOOT_SCENE_CONFIG: BootSceneConfig = {
  clearColor: 0x05080d,
  glowColor: 0x39e6ff,
  emissiveIntensity: 1.6,
  glowLightIntensity: 6,
  haloScale: 1.25,
  haloOpacity: 0.18,
  spinSpeed: { x: 0.35, y: 0.6 },
  gravityY: -9.81,
};
