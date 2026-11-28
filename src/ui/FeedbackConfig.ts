// 戰鬥回饋的數值（M1-12）：命中標記、浮動傷害數字、受擊方向指示、護盾破裂、低生命暗角，以及受擊時的鏡頭震動與色差。
// 全部集中在這裡，調參面板「戰鬥/回饋」可調；玩家可關閉的開關在設定（damageNumbers、damageNumberMerge、hitMarkers）。
// M2-02 會加入元素與防禦層的顏色（numbers.colors 擴充）。
import type { ConfigSchema } from '@/debug/DebugPanel';

export interface HitMarkerConfig {
  /** X 的臂長（px；中心到線端）：一般、爆頭、擊殺。 */
  size: number;
  critSize: number;
  killSize: number;
  /** 線粗與中心間隙（px）。 */
  thickness: number;
  gap: number;
  /** 顯示時間（s）。 */
  duration: number;
  critDuration: number;
  killDuration: number;
  /** 出現時的放大倍率（一般／爆頭）與擊殺的放大倍率（短暫放大後回到 1）。 */
  pop: number;
  killPop: number;
  /** 擊殺時的震動幅度（px）與頻率（Hz）。 */
  killShake: number;
  killShakeHz: number;
  colorHit: string;
  colorCrit: string;
  colorKill: string;
}

export interface DamageNumberConfig {
  /** DOM 物件池容量（滿了回收最舊的）。 */
  capacity: number;
  /** 存在時間（s）：最後一次累加後開始算。 */
  life: number;
  /** 往上飄的距離（px）與水平散開範圍（px）。 */
  rise: number;
  spread: number;
  /** 字級（px）與爆頭放大倍率。 */
  fontSize: number;
  critScale: number;
  /** 擊殺的數字放大倍率。 */
  killScale: number;
  /** 合併：同一目標在這段時間內的傷害累加到同一個數字（s）；累加時的跳動放大量。 */
  mergeWindow: number;
  mergeBump: number;
  /** 依距離縮小：refDistance（m）以外按距離縮小，最小 minScale。 */
  refDistance: number;
  minScale: number;
  colorNormal: string;
  colorCrit: string;
  colorKill: string;
}

export interface DamageIndicatorConfig {
  /** 同時顯示的指示數。 */
  slots: number;
  /** 顯示時間（s）。 */
  duration: number;
  /** 弧的半徑（畫面短邊的比例）、線粗（px）與弧長（度）。 */
  radius: number;
  thickness: number;
  arcDeg: number;
  /** 來源方向差在這個角度內（度）合併成同一個指示。 */
  mergeDeg: number;
  color: string;
  /** 被擋下（無敵模式）時的顏色。 */
  blockedColor: string;
}

export interface ScreenDamageConfig {
  /** 護盾破裂邊框的顯示時間（s）與顏色。 */
  shieldBreakDuration: number;
  shieldColor: string;
  /** 護盾受擊時邊緣的藍色閃光（s，0 = 關閉）。 */
  shieldHitFlash: number;
  /** 生命受擊時的紅色閃光（s）。 */
  healthHitFlash: number;
  /** 低生命暗角：生命比例低於 threshold 時出現，0 生命時不透明度 maxOpacity，脈動頻率（Hz）。 */
  lowHealthThreshold: number;
  lowHealthMaxOpacity: number;
  lowHealthPulseHz: number;
}

export interface HitCameraConfig {
  /** 受擊 trauma = base + 傷害 × perDamage（上限 max）；護盾破裂另加 shieldBreak。 */
  traumaBase: number;
  traumaPerDamage: number;
  traumaMax: number;
  shieldBreakTrauma: number;
  /** 受擊時往遠離攻擊方向傾斜的衝量（度，依側向分量縮放）。 */
  rollDeg: number;
  /** 色差脈衝：生命受擊強度（+ 每點傷害）、時間；護盾破裂強度與時間。 */
  aberration: number;
  aberrationPerDamage: number;
  aberrationTime: number;
  shieldBreakAberration: number;
  shieldBreakAberrationTime: number;
  /** 擊殺無人機的爆炸震動（依距離衰減的 trauma 與半徑倍率）。 */
  droneKillTrauma: number;
}

export interface FeedbackConfig {
  hitMarker: HitMarkerConfig;
  numbers: DamageNumberConfig;
  indicator: DamageIndicatorConfig;
  screen: ScreenDamageConfig;
  camera: HitCameraConfig;
}

export const FEEDBACK_CONFIG: FeedbackConfig = {
  hitMarker: {
    size: 9,
    critSize: 12,
    killSize: 14,
    thickness: 2,
    gap: 5,
    duration: 0.16,
    critDuration: 0.24,
    killDuration: 0.42,
    pop: 1.25,
    killPop: 1.7,
    killShake: 2.5,
    killShakeHz: 38,
    colorHit: '#ffffff',
    colorCrit: '#ffd23a',
    colorKill: '#ff3b3b',
  },
  numbers: {
    capacity: 48,
    life: 0.75,
    rise: 46,
    spread: 26,
    fontSize: 17,
    critScale: 1.35,
    killScale: 1.2,
    mergeWindow: 0.35,
    mergeBump: 0.3,
    refDistance: 15,
    minScale: 0.7,
    colorNormal: '#f2f7ff',
    colorCrit: '#ffd23a',
    colorKill: '#ff6a5a',
  },
  indicator: {
    slots: 6,
    duration: 1.3,
    radius: 0.2,
    thickness: 7,
    arcDeg: 64,
    mergeDeg: 25,
    color: '#ff3030',
    blockedColor: '#9aa6b8',
  },
  screen: {
    shieldBreakDuration: 0.65,
    shieldColor: '#5fd2ff',
    shieldHitFlash: 0.18,
    healthHitFlash: 0.25,
    lowHealthThreshold: 0.4,
    lowHealthMaxOpacity: 0.8,
    lowHealthPulseHz: 1.3,
  },
  camera: {
    traumaBase: 0.12,
    traumaPerDamage: 0.004,
    traumaMax: 0.45,
    shieldBreakTrauma: 0.15,
    rollDeg: 2.5,
    aberration: 0.2,
    aberrationPerDamage: 0.006,
    aberrationTime: 0.2,
    shieldBreakAberration: 0.6,
    shieldBreakAberrationTime: 0.35,
    droneKillTrauma: 0.35,
  },
};

export function defaultFeedbackConfig(): FeedbackConfig {
  return {
    hitMarker: { ...FEEDBACK_CONFIG.hitMarker },
    numbers: { ...FEEDBACK_CONFIG.numbers },
    indicator: { ...FEEDBACK_CONFIG.indicator },
    screen: { ...FEEDBACK_CONFIG.screen },
    camera: { ...FEEDBACK_CONFIG.camera },
  };
}

export const HIT_MARKER_PANEL: ConfigSchema<HitMarkerConfig> = {
  size: { label: '一般臂長 px', min: 2, max: 40, step: 0.5 },
  critSize: { label: '爆頭臂長 px', min: 2, max: 40, step: 0.5 },
  killSize: { label: '擊殺臂長 px', min: 2, max: 40, step: 0.5 },
  thickness: { label: '線粗 px', min: 1, max: 8, step: 0.5 },
  gap: { label: '中心間隙 px', min: 0, max: 30, step: 0.5 },
  duration: { label: '一般時間 s', min: 0.02, max: 1, step: 0.01 },
  critDuration: { label: '爆頭時間 s', min: 0.02, max: 1, step: 0.01 },
  killDuration: { label: '擊殺時間 s', min: 0.02, max: 2, step: 0.01 },
  pop: { label: '出現放大', min: 1, max: 3, step: 0.05 },
  killPop: { label: '擊殺放大', min: 1, max: 4, step: 0.05 },
  killShake: { label: '擊殺震動 px', min: 0, max: 12, step: 0.1 },
  killShakeHz: { label: '擊殺震動 Hz', min: 1, max: 80, step: 1 },
  colorHit: { label: '一般顏色' },
  colorCrit: { label: '爆頭顏色' },
  colorKill: { label: '擊殺顏色' },
};

export const DAMAGE_NUMBER_PANEL: ConfigSchema<DamageNumberConfig> = {
  life: { label: '存在時間 s', min: 0.1, max: 3, step: 0.05 },
  rise: { label: '上飄 px', min: 0, max: 200, step: 1 },
  spread: { label: '散開 px', min: 0, max: 120, step: 1 },
  fontSize: { label: '字級 px', min: 8, max: 48, step: 1 },
  critScale: { label: '爆頭放大', min: 1, max: 3, step: 0.05 },
  killScale: { label: '擊殺放大', min: 1, max: 3, step: 0.05 },
  mergeWindow: { label: '合併時間 s', min: 0, max: 2, step: 0.01, description: '設定「合併傷害數字」開啟時有效' },
  mergeBump: { label: '累加跳動', min: 0, max: 1.5, step: 0.05 },
  refDistance: { label: '縮小起點 m', min: 1, max: 100, step: 1 },
  minScale: { label: '最小倍率', min: 0.2, max: 1, step: 0.05 },
  colorNormal: { label: '一般顏色' },
  colorCrit: { label: '爆頭顏色' },
  colorKill: { label: '擊殺顏色' },
};

export const INDICATOR_PANEL: ConfigSchema<DamageIndicatorConfig> = {
  duration: { label: '顯示時間 s', min: 0.1, max: 5, step: 0.05 },
  radius: { label: '半徑（短邊比例）', min: 0.05, max: 0.5, step: 0.01 },
  thickness: { label: '線粗 px', min: 1, max: 30, step: 0.5 },
  arcDeg: { label: '弧長°', min: 10, max: 180, step: 1 },
  mergeDeg: { label: '合併角度°', min: 0, max: 90, step: 1 },
  color: { label: '顏色' },
  blockedColor: { label: '無敵時顏色' },
};

export const SCREEN_DAMAGE_PANEL: ConfigSchema<ScreenDamageConfig> = {
  shieldBreakDuration: { label: '護盾破裂 s', min: 0.05, max: 3, step: 0.05 },
  shieldColor: { label: '護盾顏色' },
  shieldHitFlash: { label: '護盾受擊閃光 s', min: 0, max: 1, step: 0.01 },
  healthHitFlash: { label: '生命受擊閃光 s', min: 0, max: 1, step: 0.01 },
  lowHealthThreshold: { label: '低生命門檻', min: 0, max: 1, step: 0.01 },
  lowHealthMaxOpacity: { label: '低生命暗角', min: 0, max: 1, step: 0.01 },
  lowHealthPulseHz: { label: '暗角脈動 Hz', min: 0, max: 5, step: 0.05 },
};

export const HIT_CAMERA_PANEL: ConfigSchema<HitCameraConfig> = {
  traumaBase: { label: '受擊震動基礎', min: 0, max: 1, step: 0.01, description: 'CameraRig trauma' },
  traumaPerDamage: { label: '每點傷害震動', min: 0, max: 0.05, step: 0.0005 },
  traumaMax: { label: '受擊震動上限', min: 0, max: 1, step: 0.01 },
  shieldBreakTrauma: { label: '護盾破裂震動', min: 0, max: 1, step: 0.01 },
  rollDeg: { label: '受擊傾斜°', min: 0, max: 10, step: 0.1 },
  aberration: { label: '受擊色差', min: 0, max: 1, step: 0.01 },
  aberrationPerDamage: { label: '每點傷害色差', min: 0, max: 0.05, step: 0.0005 },
  aberrationTime: { label: '受擊色差 s', min: 0.02, max: 1, step: 0.01 },
  shieldBreakAberration: { label: '護盾破裂色差', min: 0, max: 1, step: 0.01 },
  shieldBreakAberrationTime: { label: '護盾破裂色差 s', min: 0.02, max: 1.5, step: 0.01 },
  droneKillTrauma: { label: '無人機爆炸震動', min: 0, max: 1, step: 0.01 },
};
