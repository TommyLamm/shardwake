// M1-01 開機場景的顯示數值（集中於設定資料，M1-02 之後改由 Settings／調參面板管理）。
export const BOOT_SCENE_CONFIG = {
  clearColor: 0x05080d,
  glowColor: 0x39e6ff,
  emissiveIntensity: 1.6,
  glowLightIntensity: 6,
  haloScale: 1.25,
  haloOpacity: 0.18,
  fov: 70,
  maxPixelRatio: 1,
  spinSpeed: { x: 0.35, y: 0.6 },
  gravityY: -9.81,
  fpsSampleMs: 500,
} as const;
