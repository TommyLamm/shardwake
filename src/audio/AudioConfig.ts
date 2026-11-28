// 音效的數值（M1-13）：混音（匯流排修正）、壓縮器與限幅器、播放變化、發聲數上限、空間音效、循環音、事件對應。
// 全部集中在這裡，調參面板「音效」可調；玩家的音量（主音量／音效／介面／音樂 0–1）在設定（shardwake:settings:v1）。
// 每種音效自己的音量、節流、合成參數在 SynthRecipes.ts 的 SOUND_DEFS（面板「音效/音色」）。
import type { HeartbeatParams, LandingThresholds, WindParams } from '@/audio/audioMath';
import type { ConfigSchema } from '@/debug/DebugPanel';

export interface AudioMixConfig {
  /** 匯流排修正（dB，乘在設定音量之上）。 */
  masterDb: number;
  sfxDb: number;
  uiDb: number;
  musicDb: number;
  /** 音量滑桿的感知曲線指數（2 = 50% ≈ -12 dB）。 */
  volumeCurve: number;
  /** 暫停時音效匯流排的壓低量（dB；介面與音樂不受影響）。 */
  pausedSfxDb: number;
  /** 匯流排音量變化的平滑時間常數（s）。 */
  busSmoothing: number;
}

export interface AudioDynamicsConfig {
  /** master 之後的壓縮器。 */
  compThreshold: number;
  compKnee: number;
  compRatio: number;
  compAttack: number;
  compRelease: number;
  /** 最後一級限幅器（高比例、快速起音；防止超過 0 dBFS）。 */
  limiterThreshold: number;
  limiterRatio: number;
  limiterAttack: number;
  limiterRelease: number;
}

export interface AudioPlaybackConfig {
  /** 每次播放的音高隨機變化（比例；0.03 = ±3%）。 */
  pitchVariation: number;
  /** 每次播放的音量隨機變化（±dB）。 */
  volumeVariationDb: number;
  /** 搶占正在播放的聲音時的淡出時間（s）。 */
  stealFade: number;
  /** 循環音淡入／淡出的時間常數（s）。 */
  loopFadeIn: number;
  loopFadeOut: number;
  /** 循環音靜音多久後停止音源（s；之後再開始會建立新的音源）。 */
  loopIdleStop: number;
  /** 循環音增益改變小於這個值時不重新排程（避免每畫面排程）。 */
  loopGainEpsilon: number;
}

export interface AudioVoiceConfig {
  /** 發聲槽數量（2D 音效、世界音源、介面；解鎖時建立，改了重新整理後生效）。 */
  pool2d: number;
  pool3d: number;
  poolUi: number;
  /** 電漿球飛行聲的空間音源數。 */
  emitters: number;
  /** 各類別的同時發聲上限。 */
  categories: Record<string, number>;
}

export interface AudioSpatialConfig {
  panningModel: 'HRTF' | 'equalpower';
  distanceModel: 'linear' | 'inverse' | 'exponential';
  /** 距離 refDistance 內不衰減；之後依 rolloff 衰減，maxDistance 之後不再變小。 */
  refDistance: number;
  maxDistance: number;
  rolloff: number;
}

export interface AudioEventConfig extends LandingThresholds, WindParams, HeartbeatParams {
  /** 腳步音量：速度 stepMinSpeed → stepMaxSpeed 對應 stepQuietDb → 0 dB。 */
  stepMinSpeed: number;
  stepMaxSpeed: number;
  stepQuietDb: number;
  /** 落地時另外播放腳底表面的腳步聲（dB）。 */
  landStepDb: number;
  /** 滑鏟摩擦音量：速度 slideMinSpeed → slideMaxSpeed 對應 slideQuietDb → 0 dB。 */
  slideMinSpeed: number;
  slideMaxSpeed: number;
  slideQuietDb: number;
  /** 跑牆摩擦聲往牆那一側的聲像（0..1）。 */
  wallRunPan: number;
  /** 抓鉤收線：速度對應的播放速率（每 m/s）。 */
  reelRatePerSpeed: number;
  /** 無敵模式下受擊音的修正（dB）。 */
  blockedHurtDb: number;
  /** Dash／抓鉤恢復可用的提示音（開關）。 */
  abilityReadyCue: boolean;
}

export interface AudioSynthConfig {
  /** 預渲染的取樣率（Hz）。 */
  sampleRate: number;
  /** 循環音的交叉淡化（s）。 */
  loopCrossfade: number;
  /** 預渲染時每段工作的時間預算（ms；之後讓出主執行緒）。 */
  sliceMs: number;
}

export interface AudioConfig {
  mix: AudioMixConfig;
  dynamics: AudioDynamicsConfig;
  playback: AudioPlaybackConfig;
  voices: AudioVoiceConfig;
  spatial: AudioSpatialConfig;
  events: AudioEventConfig;
  synth: AudioSynthConfig;
}

export function defaultAudioConfig(): AudioConfig {
  return {
    mix: { masterDb: 0, sfxDb: 0, uiDb: 0, musicDb: -6, volumeCurve: 2, pausedSfxDb: -12, busSmoothing: 0.05 },
    dynamics: {
      compThreshold: -16,
      compKnee: 10,
      compRatio: 4,
      compAttack: 0.004,
      compRelease: 0.2,
      limiterThreshold: -1.5,
      limiterRatio: 20,
      limiterAttack: 0.001,
      limiterRelease: 0.08,
    },
    playback: {
      pitchVariation: 0.03,
      volumeVariationDb: 1,
      stealFade: 0.008,
      loopFadeIn: 0.06,
      loopFadeOut: 0.12,
      loopIdleStop: 0.6,
      loopGainEpsilon: 0.01,
    },
    voices: {
      pool2d: 28,
      pool3d: 20,
      poolUi: 6,
      emitters: 4,
      categories: { weapon: 8, footstep: 2, movement: 6, feedback: 6, ambient: 2, impact: 6, enemy: 8, explosion: 4, ui: 4 },
    },
    spatial: { panningModel: 'HRTF', distanceModel: 'inverse', refDistance: 4, maxDistance: 150, rolloff: 1 },
    events: {
      stepMinSpeed: 2,
      stepMaxSpeed: 10,
      stepQuietDb: -8,
      landMinSpeed: 2.5,
      landHeavySpeed: 11,
      landQuietDb: -10,
      landStepDb: -4,
      slideMinSpeed: 4,
      slideMaxSpeed: 16,
      slideQuietDb: -8,
      wallRunPan: 0.45,
      reelRatePerSpeed: 0.012,
      windMinSpeed: 9,
      windMaxSpeed: 30,
      windMaxGain: 0.9,
      windRateMin: 0.85,
      windRateMax: 1.35,
      heartbeatThreshold: 0.4,
      heartbeatSlow: 1.0,
      heartbeatFast: 0.55,
      heartbeatQuietDb: -10,
      blockedHurtDb: -8,
      abilityReadyCue: true,
    },
    synth: { sampleRate: 44100, loopCrossfade: 0.12, sliceMs: 12 },
  };
}

export const AUDIO_CONFIG: AudioConfig = defaultAudioConfig();

// ── 面板規格 ─────────────────────────────────────────────

export const AUDIO_MIX_PANEL: ConfigSchema<AudioMixConfig> = {
  masterDb: { label: '主匯流排 dB', min: -24, max: 6, step: 0.5 },
  sfxDb: { label: '音效匯流排 dB', min: -24, max: 6, step: 0.5 },
  uiDb: { label: '介面匯流排 dB', min: -24, max: 6, step: 0.5 },
  musicDb: { label: '音樂匯流排 dB', min: -24, max: 6, step: 0.5, description: 'M5-06 的音樂接在這條匯流排' },
  volumeCurve: { label: '音量曲線指數', min: 1, max: 4, step: 0.1, description: '設定音量 v → 增益 v^指數' },
  pausedSfxDb: { label: '暫停時音效 dB', min: -60, max: 0, step: 1 },
  busSmoothing: { label: '匯流排平滑 s', min: 0, max: 0.5, step: 0.01 },
};

export const AUDIO_DYNAMICS_PANEL: ConfigSchema<AudioDynamicsConfig> = {
  compThreshold: { label: '壓縮門檻 dB', min: -60, max: 0, step: 0.5 },
  compKnee: { label: '壓縮膝 dB', min: 0, max: 40, step: 0.5 },
  compRatio: { label: '壓縮比', min: 1, max: 20, step: 0.1 },
  compAttack: { label: '壓縮起音 s', min: 0, max: 0.2, step: 0.001 },
  compRelease: { label: '壓縮釋放 s', min: 0.01, max: 1, step: 0.01 },
  limiterThreshold: { label: '限幅門檻 dB', min: -24, max: 0, step: 0.1 },
  limiterRatio: { label: '限幅比', min: 1, max: 20, step: 0.5 },
  limiterAttack: { label: '限幅起音 s', min: 0, max: 0.05, step: 0.0005 },
  limiterRelease: { label: '限幅釋放 s', min: 0.01, max: 1, step: 0.01 },
};

export const AUDIO_PLAYBACK_PANEL: ConfigSchema<AudioPlaybackConfig> = {
  pitchVariation: { label: '音高變化 ±', min: 0, max: 0.2, step: 0.005, description: '比例；0.03 = ±3%' },
  volumeVariationDb: { label: '音量變化 ±dB', min: 0, max: 6, step: 0.1 },
  stealFade: { label: '搶占淡出 s', min: 0.001, max: 0.05, step: 0.001 },
  loopFadeIn: { label: '循環淡入 s', min: 0.005, max: 1, step: 0.005, description: '時間常數' },
  loopFadeOut: { label: '循環淡出 s', min: 0.005, max: 1, step: 0.005, description: '時間常數' },
  loopIdleStop: { label: '循環閒置停止 s', min: 0.1, max: 5, step: 0.05 },
  loopGainEpsilon: { label: '循環增益門檻', min: 0.001, max: 0.1, step: 0.001 },
};

export const AUDIO_SPATIAL_PANEL: ConfigSchema<AudioSpatialConfig> = {
  panningModel: { label: '聲像模型', options: { HRTF: 'HRTF', 等功率: 'equalpower' } },
  distanceModel: { label: '距離模型', options: { 反比: 'inverse', 線性: 'linear', 指數: 'exponential' } },
  refDistance: { label: '參考距離 m', min: 0.5, max: 40, step: 0.5 },
  maxDistance: { label: '最大距離 m', min: 10, max: 500, step: 5 },
  rolloff: { label: '衰減係數', min: 0, max: 5, step: 0.05 },
};

export const AUDIO_VOICE_PANEL: ConfigSchema<Omit<AudioVoiceConfig, 'categories'>> = {
  pool2d: { label: '2D 發聲槽', min: 4, max: 64, step: 1, description: '重新整理後生效' },
  pool3d: { label: '3D 發聲槽', min: 4, max: 64, step: 1, description: '重新整理後生效' },
  poolUi: { label: '介面發聲槽', min: 2, max: 16, step: 1, description: '重新整理後生效' },
  emitters: { label: '電漿音源', min: 1, max: 16, step: 1, description: '重新整理後生效' },
};

export const AUDIO_EVENT_PANEL: ConfigSchema<AudioEventConfig> = {
  stepMinSpeed: { label: '腳步最小速度', min: 0, max: 20, step: 0.1 },
  stepMaxSpeed: { label: '腳步最大速度', min: 0, max: 30, step: 0.1 },
  stepQuietDb: { label: '腳步最小音量 dB', min: -30, max: 0, step: 0.5 },
  landMinSpeed: { label: '落地出聲速度', min: 0, max: 20, step: 0.1 },
  landHeavySpeed: { label: '重落地速度', min: 0, max: 40, step: 0.5 },
  landQuietDb: { label: '輕落地最小 dB', min: -30, max: 0, step: 0.5 },
  landStepDb: { label: '落地腳步 dB', min: -40, max: 0, step: 0.5 },
  slideMinSpeed: { label: '滑鏟最小速度', min: 0, max: 30, step: 0.1 },
  slideMaxSpeed: { label: '滑鏟最大速度', min: 0, max: 40, step: 0.1 },
  slideQuietDb: { label: '滑鏟最小 dB', min: -30, max: 0, step: 0.5 },
  wallRunPan: { label: '跑牆聲像', min: 0, max: 1, step: 0.01 },
  reelRatePerSpeed: { label: '收線速率/速度', min: 0, max: 0.05, step: 0.001 },
  windMinSpeed: { label: '風聲起始速度', min: 0, max: 60, step: 0.5 },
  windMaxSpeed: { label: '風聲最大速度', min: 1, max: 80, step: 0.5 },
  windMaxGain: { label: '風聲最大增益', min: 0, max: 2, step: 0.01 },
  windRateMin: { label: '風聲速率最小', min: 0.25, max: 2, step: 0.01 },
  windRateMax: { label: '風聲速率最大', min: 0.25, max: 3, step: 0.01 },
  heartbeatThreshold: { label: '心跳門檻（生命比例）', min: 0, max: 1, step: 0.01 },
  heartbeatSlow: { label: '心跳間隔（門檻）s', min: 0.2, max: 3, step: 0.01 },
  heartbeatFast: { label: '心跳間隔（瀕死）s', min: 0.2, max: 3, step: 0.01 },
  heartbeatQuietDb: { label: '心跳最小 dB', min: -30, max: 0, step: 0.5 },
  blockedHurtDb: { label: '無敵受擊 dB', min: -40, max: 0, step: 0.5 },
  abilityReadyCue: { label: '能力就緒提示音' },
};

export const AUDIO_SYNTH_PANEL: ConfigSchema<AudioSynthConfig> = {
  sampleRate: { label: '預渲染取樣率', options: { '22050': 22050, '32000': 32000, '44100': 44100, '48000': 48000 }, description: '按「重新預渲染」生效' },
  loopCrossfade: { label: '循環交叉淡化 s', min: 0.01, max: 0.5, step: 0.01 },
  sliceMs: { label: '每段預算 ms', min: 2, max: 100, step: 1 },
};
