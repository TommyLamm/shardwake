// M1-13 程序合成音效：音量換算、隨機變化範圍、變體挑選、節流、發聲數上限與搶占、事件數值對應、
// 合成配方驗證與變體、武器參數、DSP 渲染（不靜音、不爆音、循環無縫、決定性）、預渲染時間、
// AudioEngine（假 AudioContext：解鎖前不發聲、每次播放只建立一個音源、上限、分頁隱藏、靜音降級、音量、空間、循環音）、
// 事件 → 音效對應（AudioEventBinder）、面板涵蓋、設定新欄位。
import { describe, expect, it } from 'vitest';
import {
  AUDIO_DYNAMICS_PANEL,
  AUDIO_EVENT_PANEL,
  AUDIO_MIX_PANEL,
  AUDIO_PLAYBACK_PANEL,
  AUDIO_SPATIAL_PANEL,
  AUDIO_SYNTH_PANEL,
  AUDIO_VOICE_PANEL,
  defaultAudioConfig,
} from '@/audio/AudioConfig';
import { AudioEngine, listenerAxes, parseWeaponKey, type AudioSink, type LoopHandle, type PlayOptions } from '@/audio/AudioEngine';
import { AudioEventBinder, DEFAULT_RELOAD_KEYS, RELOAD_SOUNDS, type AudioPlayerView, type AudioWeaponView } from '@/audio/AudioEvents';
import {
  busGain,
  dbToGain,
  footstepSoundId,
  gainToDb,
  heartbeat,
  landingSound,
  pickVariant,
  randomVariation,
  speedGainDb,
  Throttle,
  VoiceAllocator,
  volumeToGain,
  windLevel,
} from '@/audio/audioMath';
import { editableSoundIds, recipePanelFields } from '@/audio/AudioPanel';
import { envelopeAt, glideAt, loopSeam, peakOf, renderRecipe, renderVariants, rmsOf } from '@/audio/synth';
import {
  fieldSpecFor,
  noise,
  recipeNumericPaths,
  SOUND_DEFS,
  tone,
  validateRecipe,
  validateSoundDef,
  varyRecipe,
  WEAPON_FIRE_RECIPES,
  weaponFireDef,
  weaponFireRecipe,
  weaponFireSoundId,
  weaponSoundKey,
  type SoundDef,
  type SynthRecipe,
} from '@/audio/SynthRecipes';
import { EventBus } from '@/core/EventBus';
import type { GameEvents, GameMode } from '@/core/events';
import { Rng } from '@/core/Rng';
import { defaultSettings, parseSettings } from '@/core/Settings';
import { ARCHETYPES } from '@/weapons/archetypes';

const ARCHETYPE_IDS = ARCHETYPES.map((d) => d.id);
import { asAudioContext, FakeAudioContext, FakeGain, FakePanner, FakeSource } from './helpers/fakeAudio';

const SR = 44100;
const quiet = (): void => {};

// ── 純邏輯 ───────────────────────────────────────────────

describe('音量換算', () => {
  it('dB ↔ 增益', () => {
    expect(dbToGain(0)).toBe(1);
    expect(dbToGain(-6)).toBeCloseTo(0.501, 3);
    expect(gainToDb(0.5)).toBeCloseTo(-6.02, 2);
    expect(gainToDb(0)).toBe(Number.NEGATIVE_INFINITY);
  });

  it('音量滑桿：0 完全靜音、1 為 0 dB、50% ≈ -12 dB、超出範圍與 NaN 夾住', () => {
    expect(volumeToGain(0)).toBe(0);
    expect(volumeToGain(1)).toBe(1);
    expect(gainToDb(volumeToGain(0.5))).toBeCloseTo(-12.04, 1);
    expect(volumeToGain(2)).toBe(1);
    expect(volumeToGain(-1)).toBe(0);
    expect(volumeToGain(Number.NaN)).toBe(0);
    expect(volumeToGain(0.5, 1)).toBeCloseTo(0.5);
    // 單調遞增
    let prev = -1;
    for (let v = 0; v <= 1.0001; v += 0.05) {
      const g = volumeToGain(v);
      expect(g).toBeGreaterThanOrEqual(prev);
      prev = g;
    }
    expect(busGain(1, -6)).toBeCloseTo(dbToGain(-6));
    expect(busGain(0, 6)).toBe(0);
  });
});

describe('隨機變化與變體', () => {
  it('音高 ±3%、音量 ±1 dB，分布涵蓋整個範圍', () => {
    const rng = new Rng(1);
    let minR = 9;
    let maxR = 0;
    let minG = 9;
    let maxG = -9;
    for (let i = 0; i < 2000; i++) {
      const v = randomVariation(rng, 0.03, 1);
      minR = Math.min(minR, v.rate);
      maxR = Math.max(maxR, v.rate);
      minG = Math.min(minG, v.gainDb);
      maxG = Math.max(maxG, v.gainDb);
    }
    expect(minR).toBeGreaterThanOrEqual(0.97);
    expect(maxR).toBeLessThanOrEqual(1.03);
    expect(minR).toBeLessThan(0.975);
    expect(maxR).toBeGreaterThan(1.025);
    expect(minG).toBeGreaterThanOrEqual(-1);
    expect(maxG).toBeLessThanOrEqual(1);
    expect(minG).toBeLessThan(-0.9);
    expect(maxG).toBeGreaterThan(0.9);
    const none = randomVariation(rng, 0, 0);
    expect(none).toEqual({ rate: 1, gainDb: 0 });
  });

  it('變體不連續重複，且每個都會被選到', () => {
    const rng = new Rng(7);
    let last = -1;
    const seen = new Set<number>();
    for (let i = 0; i < 400; i++) {
      const v = pickVariant(rng, 4, last);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(4);
      expect(v).not.toBe(last);
      seen.add(v);
      last = v;
    }
    expect(seen.size).toBe(4);
    expect(pickVariant(rng, 1, 0)).toBe(0);
  });
});

describe('節流', () => {
  it('同一音效在間隔內只播一次，不同音效互不影響', () => {
    const t = new Throttle();
    expect(t.allow('hit', 0, 0.03)).toBe(true);
    expect(t.allow('hit', 0.01, 0.03)).toBe(false);
    expect(t.allow('hit.crit', 0.01, 0.03)).toBe(true);
    expect(t.allow('hit', 0.031, 0.03)).toBe(true);
    expect(t.allow('impact', 0, 0)).toBe(true);
    expect(t.allow('impact', 0, 0)).toBe(true);
    expect(t.blocked).toBe(1);
  });
});

describe('發聲數上限與搶占', () => {
  const req = (soundId: string, category: string, priority = 50, extra: Partial<{ maxInstances: number; categoryMax: number; duration: number }> = {}) => ({
    soundId,
    category,
    priority,
    duration: extra.duration ?? 1,
    maxInstances: extra.maxInstances ?? 0,
    categoryMax: extra.categoryMax ?? 0,
  });

  it('類別達上限時搶占同類別最舊的；同時發聲數不超過上限', () => {
    const a = new VoiceAllocator(16);
    for (let i = 0; i < 10; i++) {
      const r = a.allocate(req('step', 'footstep', 50, { categoryMax: 3 }), i * 0.01);
      expect(r).not.toBeNull();
      expect(a.activeCount(i * 0.01, { category: 'footstep' })).toBeLessThanOrEqual(3);
    }
    expect(a.stats.stolen).toBe(7);
  });

  it('類別滿且都是較高優先序時丟棄新的', () => {
    const a = new VoiceAllocator(16);
    a.allocate(req('boom', 'explosion', 90, { categoryMax: 2 }), 0);
    a.allocate(req('boom', 'explosion', 90, { categoryMax: 2 }), 0.1);
    expect(a.allocate(req('tick', 'explosion', 10, { categoryMax: 2 }), 0.2)).toBeNull();
    expect(a.stats.dropped).toBe(1);
  });

  it('同一音效上限：搶占同音效最舊的那一個', () => {
    const a = new VoiceAllocator(16);
    const first = a.allocate(req('fire', 'weapon', 90, { maxInstances: 2 }), 0)!.slot.index;
    a.allocate(req('fire', 'weapon', 90, { maxInstances: 2 }), 0.1);
    const third = a.allocate(req('fire', 'weapon', 90, { maxInstances: 2 }), 0.2)!;
    expect(third.stolen).toBe(true);
    expect(third.slot.index).toBe(first);
  });

  it('全部槽滿時搶占優先序最低的；新聲音優先序更低時丟棄', () => {
    const a = new VoiceAllocator(3);
    a.allocate(req('a', 'x', 80), 0);
    const low = a.allocate(req('b', 'y', 10), 0.1)!.slot.index;
    a.allocate(req('c', 'z', 60), 0.2);
    const r = a.allocate(req('d', 'w', 50), 0.3)!;
    expect(r.stolen).toBe(true);
    expect(r.slot.index).toBe(low);
    expect(a.allocate(req('e', 'w', 5), 0.4)).toBeNull();
  });

  it('播完的槽可以重用，不算搶占', () => {
    const a = new VoiceAllocator(2);
    a.allocate(req('a', 'x', 50, { duration: 0.1 }), 0);
    a.allocate(req('b', 'x', 50, { duration: 0.1 }), 0);
    const r = a.allocate(req('c', 'x', 50, { duration: 0.1 }), 0.2)!;
    expect(r.stolen).toBe(false);
    expect(a.stats.peak).toBe(2);
  });
});

describe('事件數值對應', () => {
  it('腳步依表面：金屬／格柵／玻璃', () => {
    expect(footstepSoundId('metal')).toBe('step.metal');
    expect(footstepSoundId('concrete')).toBe('step.metal');
    expect(footstepSoundId('grate')).toBe('step.grate');
    expect(footstepSoundId('hazard')).toBe('step.grate');
    expect(footstepSoundId('glass')).toBe('step.glass');
    expect(footstepSoundId('energy')).toBe('step.glass');
    expect(footstepSoundId(null)).toBe('step.metal');
  });

  it('落地：太輕不出聲、輕落地依速度變大、重落地', () => {
    const t = defaultAudioConfig().events;
    expect(landingSound(1, t)).toBeNull();
    const a = landingSound(3, t)!;
    const b = landingSound(9, t)!;
    expect(a.id).toBe('land.light');
    expect(b.id).toBe('land.light');
    expect(b.gainDb).toBeGreaterThan(a.gainDb);
    expect(landingSound(15, t)).toEqual({ id: 'land.heavy', gainDb: 0 });
    expect(speedGainDb(100, 2, 10, -8)).toBe(0);
    expect(speedGainDb(0, 2, 10, -8)).toBe(-8);
  });

  it('風聲隨速度增加（低速無聲），心跳在低生命時越來越快', () => {
    const e = defaultAudioConfig().events;
    expect(windLevel(5, e).gain).toBe(0);
    const mid = windLevel(18, e).gain;
    const hi = windLevel(40, e);
    expect(mid).toBeGreaterThan(0);
    expect(hi.gain).toBeCloseTo(e.windMaxGain);
    expect(hi.rate).toBeCloseTo(e.windRateMax);
    expect(heartbeat(0.5, true, e)).toBeNull();
    expect(heartbeat(0.1, false, e)).toBeNull();
    const h1 = heartbeat(0.35, true, e)!;
    const h2 = heartbeat(0.05, true, e)!;
    expect(h2.interval).toBeLessThan(h1.interval);
    expect(h2.gainDb).toBeGreaterThan(h1.gainDb);
  });
});

// ── 配方 ─────────────────────────────────────────────────

const archetypeAudio = ARCHETYPES.map((d) => d.audio);

function allDefs(): [string, SoundDef][] {
  const out: [string, SoundDef][] = Object.entries(SOUND_DEFS);
  for (const a of archetypeAudio) out.push([weaponSoundKey(a.fire, a.params), weaponFireDef(a.fire, a.params)]);
  return out;
}

describe('合成配方', () => {
  it('音效清單齊全：5 種開火與計畫列出的武器、移動、回饋、介面音效', () => {
    expect(Object.keys(WEAPON_FIRE_RECIPES).sort()).toEqual(['handcannon', 'plasma', 'railgun', 'rifle', 'shotgun']);
    for (const a of archetypeAudio) expect(a.fire in WEAPON_FIRE_RECIPES).toBe(true);
    const required = [
      'dryFire', 'reload.magOut', 'reload.magIn', 'reload.rack', 'swap.out', 'swap.in', 'ads.in', 'melee.swing', 'plasma.flight', 'explosion',
      'step.metal', 'step.grate', 'step.glass', 'jump', 'doubleJump', 'jet', 'land.light', 'land.heavy', 'slide', 'wallRun', 'wallJump',
      'mantle', 'dash', 'grapple.fire', 'grapple.attach', 'grapple.reel', 'wind',
      'hit', 'hit.crit', 'hit.kill', 'shieldBreak', 'hurt.shield', 'hurt.health', 'heartbeat',
      'ui.hover', 'ui.click', 'ui.confirm', 'ui.back',
    ];
    for (const id of required) expect(SOUND_DEFS, id).toHaveProperty([id]);
    for (const set of Object.values(RELOAD_SOUNDS)) {
      expect(SOUND_DEFS).toHaveProperty([set.out]);
      expect(SOUND_DEFS).toHaveProperty([set.in]);
    }
    expect(weaponFireSoundId('railgun')).toBe('fire.railgun');
    expect(weaponFireSoundId('unknown')).toBe('fire.rifle');
  });

  it('所有音效定義都通過驗證；單次音效 3–5 個變體、循環音標記 loop', () => {
    for (const [id, def] of allDefs()) {
      expect(validateSoundDef(id, def), id).toEqual([]);
      if (!def.recipe.loop) {
        expect(def.variants).toBeGreaterThanOrEqual(3);
        expect(def.variants).toBeLessThanOrEqual(5);
      }
    }
    for (const id of ['jet', 'slide', 'wallRun', 'grapple.reel', 'wind', 'plasma.flight']) expect(SOUND_DEFS[id]!.recipe.loop).toBe(true);
  });

  it('驗證能抓到錯誤：沒有圖層、超出範圍、NaN、列舉錯誤、不認識的欄位', () => {
    const good = SOUND_DEFS.hit!.recipe;
    expect(validateRecipe(good)).toEqual([]);
    expect(validateRecipe(null)).not.toEqual([]);
    expect(validateRecipe({ ...good, layers: [] }).join()).toMatch(/至少要有一個圖層/);
    const bad = JSON.parse(JSON.stringify(good)) as SynthRecipe;
    (bad.layers[0] as { freq: number }).freq = 50000;
    expect(validateRecipe(bad).join()).toMatch(/超出範圍/);
    (bad.layers[0] as { freq: number }).freq = Number.NaN;
    expect(validateRecipe(bad).join()).toMatch(/有限數值/);
    const wave = JSON.parse(JSON.stringify(good)) as SynthRecipe;
    (wave.layers[0] as { wave: string }).wave = 'organ';
    expect(validateRecipe(wave).join()).toMatch(/wave/);
    const extra = JSON.parse(JSON.stringify(good)) as SynthRecipe & { wobble: number };
    extra.wobble = 1;
    expect(validateRecipe(extra).join()).toMatch(/不認識/);
    const delayed = JSON.parse(JSON.stringify(good)) as SynthRecipe;
    delayed.layers[0]!.delay = delayed.duration + 0.5;
    expect(validateRecipe(delayed).length).toBeGreaterThan(0);
    const def = { ...SOUND_DEFS.hit!, variants: 9 };
    expect(validateSoundDef('hit', def).join()).toMatch(/variants/);
  });

  it('變體偏移在 vary 指定的範圍內（音高、時間、濾波、音量）', () => {
    const base = SOUND_DEFS['grapple.fire']!.recipe;
    const rng = new Rng(3);
    const L0 = base.layers[0]! as { freq: number; gain: number; env: { decay: number }; filter?: { freq: number } };
    for (let i = 0; i < 200; i++) {
      const v = varyRecipe(base, rng);
      const l = v.layers[0]! as typeof L0;
      expect(l.freq / L0.freq).toBeGreaterThanOrEqual(1 - base.vary.pitch - 1e-9);
      expect(l.freq / L0.freq).toBeLessThanOrEqual(1 + base.vary.pitch + 1e-9);
      expect(l.env.decay / L0.env.decay).toBeGreaterThanOrEqual(1 - base.vary.time - 1e-9);
      expect(l.env.decay / L0.env.decay).toBeLessThanOrEqual(1 + base.vary.time + 1e-9);
      expect(l.gain / L0.gain).toBeLessThanOrEqual(1 + base.vary.gain + 1e-9);
      expect(l.filter!.freq / L0.filter!.freq).toBeLessThanOrEqual(1 + base.vary.filter + 1e-9);
      expect(validateRecipe(v)).toEqual([]);
    }
    // 原配方沒有被改動
    expect((base.layers[0] as { freq: number }).freq).toBe(L0.freq);
  });

  it('武器參數：pitch 縮放音高、body／crack 縮放標籤圖層、charge 0 移除充能圖層、tail 調整殘響', () => {
    const base = WEAPON_FIRE_RECIPES.railgun!;
    const plain = weaponFireRecipe(base, {});
    expect(plain.layers.some((l) => l.tag === 'charge')).toBe(false);
    const charged = weaponFireRecipe(base, { charge: 0.5, pitch: 1.2, body: 0.5, tail: 1 });
    const charge = charged.layers.find((l) => l.tag === 'charge')!;
    expect(charge.gain).toBeCloseTo(base.layers.find((l) => l.tag === 'charge')!.gain * 0.5);
    const body0 = base.layers.find((l) => l.tag === 'body')! as { freq: number; gain: number };
    const body1 = charged.layers.find((l) => l.tag === 'body')! as { freq: number; gain: number };
    expect(body1.freq).toBeCloseTo(body0.freq * 1.2);
    expect(body1.gain).toBeCloseTo(body0.gain * 0.5);
    expect(charged.reverb!.mix).toBeGreaterThan(base.reverb!.mix);
    expect(weaponFireRecipe(base, { tail: 0 }).reverb!.mix).toBe(0);
    expect(validateRecipe(charged)).toEqual([]);
    // 簽章：參數改變 → key 改變；順序無關
    expect(weaponSoundKey('rifle', { a: 1, b: 2 })).toBe(weaponSoundKey('rifle', { b: 2, a: 1 }));
    expect(weaponSoundKey('rifle', { a: 1 })).not.toBe(weaponSoundKey('rifle', { a: 1.1 }));
    expect(parseWeaponKey(weaponSoundKey('rifle', { pitch: 1.2, body: 0.6 }))).toEqual({ pitch: 1.2, body: 0.6 });
  });
});

// ── DSP ──────────────────────────────────────────────────

describe('合成渲染', () => {
  it('包絡與滑音', () => {
    expect(envelopeAt(-1, 0.01, 0, 0.1)).toBe(0);
    expect(envelopeAt(0.005, 0.01, 0, 0.1)).toBeCloseTo(0.5);
    expect(envelopeAt(0.01, 0.01, 0.05, 0.1)).toBe(1);
    expect(envelopeAt(0.11 + 0.05, 0.01, 0.05, 0.1)).toBeCloseTo(0.001, 4);
    expect(glideAt(0, 200, 50, 0.1)).toBe(200);
    expect(glideAt(10, 200, 50, 0.1)).toBeCloseTo(50);
    expect(glideAt(1, 200, 50, 0)).toBe(200);
  });

  it('每種音效的每個變體：長度正確、不靜音、峰值 = peakDb（不超過 0 dBFS）、沒有 NaN', () => {
    for (const [id, def] of allDefs()) {
      const vs = renderVariants(id, def, SR);
      expect(vs.length, id).toBe(def.variants);
      for (const v of vs) {
        expect(v.length, id).toBe(Math.round(def.recipe.duration * SR));
        const peak = peakOf(v);
        expect(Number.isFinite(peak), id).toBe(true);
        expect(peak, id).toBeLessThanOrEqual(1);
        expect(gainToDb(peak), id).toBeCloseTo(def.recipe.peakDb, 3);
        expect(rmsOf(v), id).toBeGreaterThan(0.004);
      }
    }
  });

  it('單次音效頭尾為 0（不爆音）；循環音回繞點連續', () => {
    for (const [id, def] of allDefs()) {
      const v = renderVariants(id, def, SR)[0]!;
      if (def.recipe.loop) {
        // 回繞的跳動不大於相鄰樣本的典型差（最大差的一半）
        let maxStep = 0;
        for (let i = 1; i < v.length; i++) maxStep = Math.max(maxStep, Math.abs(v[i]! - v[i - 1]!));
        expect(loopSeam(v), id).toBeLessThanOrEqual(maxStep);
      } else {
        expect(Math.abs(v[0]!), id).toBeLessThan(1e-6);
        expect(Math.abs(v[v.length - 1]!), id).toBeLessThan(1e-3);
      }
    }
  });

  it('決定性：同配方同種子結果相同；不同變體不同', () => {
    const def = SOUND_DEFS['step.metal']!;
    const a = renderVariants('step.metal', def, SR);
    const b = renderVariants('step.metal', def, SR);
    expect(a[2]).toEqual(b[2]);
    let diff = 0;
    for (let i = 0; i < a[0]!.length; i++) diff += Math.abs(a[0]![i]! - a[1]![i]!);
    expect(diff).toBeGreaterThan(1);
  });

  it('各波形、雜訊顏色、濾波類型都能渲染', () => {
    for (const wave of ['sine', 'triangle', 'saw', 'square'] as const) {
      const r: SynthRecipe = { duration: 0.1, peakDb: -3, layers: [tone(wave, 440, { env: { decay: 0.05 } })], vary: { pitch: 0, time: 0, filter: 0, gain: 0 } };
      expect(peakOf(renderRecipe(r, { sampleRate: SR, seed: 1 }))).toBeCloseTo(dbToGain(-3));
    }
    for (const color of ['white', 'pink', 'brown'] as const) {
      for (const type of ['lowpass', 'highpass', 'bandpass'] as const) {
        const r: SynthRecipe = {
          duration: 0.1,
          peakDb: -1,
          layers: [noise(color, { env: { decay: 0.05 }, filter: { type, freq: 1000, freqEnd: 3000, sweep: 0.02, lfoFreq: 5, lfoDepth: 0.3 } })],
          vary: { pitch: 0, time: 0, filter: 0, gain: 0 },
        };
        expect(rmsOf(renderRecipe(r, { sampleRate: SR, seed: 2 }))).toBeGreaterThan(0.005);
      }
    }
  });
});

// ── AudioEngine（假 AudioContext）────────────────────────

function makeEngine(opts: { ctx?: FakeAudioContext | null; throws?: boolean } = {}) {
  const ctx = opts.ctx === undefined ? new FakeAudioContext() : opts.ctx;
  const engine = new AudioEngine({
    config: defaultAudioConfig(),
    createContext: () => {
      if (opts.throws) throw new Error('blocked');
      return ctx ? asAudioContext(ctx) : null;
    },
    log: quiet,
  });
  engine.prerenderSync();
  return { engine, ctx };
}

describe('AudioEngine', () => {
  it('預渲染：全部音效與 5 把武器的開火、變體數、總時間（記錄實測值）', async () => {
    const engine = new AudioEngine({ config: defaultAudioConfig(), createContext: () => null, log: quiet });
    const report = await engine.prerender(archetypeAudio);
    expect(report.sounds).toBe(Object.keys(SOUND_DEFS).length + archetypeAudio.length);
    expect(report.variants).toBeGreaterThanOrEqual(report.sounds * 1);
    console.info(
      `[M1-13] 預渲染（Node）：${report.sounds} 種、${report.variants} 個變體、${report.seconds.toFixed(1)} s 音訊、` +
        `${(report.bytes / 1048576).toFixed(1)} MiB、${report.ms.toFixed(0)} ms`,
    );
    // 驗收門檻 1.5 s 在瀏覽器量測；測試機的負載不定，這裡放寬為 3 s
    expect(report.ms).toBeLessThan(3000);
  });

  it('解鎖前：不建立 AudioContext、play 直接丟棄（不發聲）；玩家操作後才建立並建好音訊圖', () => {
    const ctx = new FakeAudioContext();
    let created = 0;
    const engine = new AudioEngine({ config: defaultAudioConfig(), createContext: () => (created++, asAudioContext(ctx)), log: quiet });
    engine.prerenderSync();
    expect(engine.status).toBe('locked');
    expect(engine.play('hit')).toBe(false);
    expect(engine.stats.silent).toBe(1);
    expect(created).toBe(0);
    const target = new EventTarget();
    engine.attachUnlock(target);
    target.dispatchEvent(new Event('pointerdown'));
    expect(created).toBe(1);
    expect(engine.status).toBe('running');
    // master → 壓縮器 → 限幅器 → destination
    expect(ctx.created.compressor).toBe(2);
    expect(engine.bus('sfx')).not.toBeNull();
    expect(engine.bus('music')).not.toBeNull();
    // 再次操作不重建
    target.dispatchEvent(new Event('keydown'));
    expect(created).toBe(1);
    expect(engine.play('hit')).toBe(true);
  });

  it('每次播放只建立一個 AudioBufferSourceNode（Gain／Panner 是常駐發聲槽）', () => {
    const { engine, ctx } = makeEngine();
    engine.unlock();
    const gains = ctx!.created.gain!;
    const panners = ctx!.created.panner!;
    for (let i = 0; i < 20; i++) {
      ctx!.currentTime += 0.1;
      engine.play('jump');
      engine.play('impact', { position: { x: i, y: 0, z: 0 } });
    }
    expect(ctx!.created.source).toBe(40);
    expect(ctx!.created.gain).toBe(gains);
    expect(ctx!.created.panner).toBe(panners);
  });

  it('長時間連射：同時發聲數不超過上限，搶占時舊聲音先淡出', () => {
    const { engine, ctx } = makeEngine();
    engine.unlock();
    const id = engine.weaponSound(archetypeAudio[0]!);
    const max = engine.sounds.get(id)!.def.maxInstances;
    for (let i = 0; i < 300; i++) {
      ctx!.currentTime = i * 0.1; // 600 RPM、30 秒
      expect(engine.play(id)).toBe(true);
      expect(engine.allocators!.p2d.activeCount(ctx!.currentTime, { soundId: id })).toBeLessThanOrEqual(max);
    }
    expect(engine.stats.stolen).toBeGreaterThan(0);
    // 搶占的音源有排程停止，增益有淡出
    const stopped = ctx!.started.filter((s) => s.stoppedAt !== null);
    expect(stopped.length).toBe(engine.stats.stolen);
  });

  it('大量命中同時播放：節流 + 類別上限，同時發聲數有上限', () => {
    const { engine, ctx } = makeEngine();
    engine.unlock();
    let ok = 0;
    for (let frame = 0; frame < 60; frame++) {
      ctx!.currentTime = frame / 60;
      for (let i = 0; i < 40; i++) if (engine.play(i % 2 ? 'hit' : 'hit.crit')) ok++;
      const cat = engine.config.voices.categories.feedback!;
      expect(engine.allocators!.p2d.activeCount(ctx!.currentTime, { category: 'feedback' })).toBeLessThanOrEqual(cat);
    }
    expect(ok).toBeLessThan(200);
    expect(engine.stats.throttled).toBeGreaterThan(2000);
  });

  it('分頁隱藏：suspend、播放丟棄、循環音停止；回來 resume', () => {
    const { engine, ctx } = makeEngine();
    engine.unlock();
    const jet = engine.loop('jet');
    jet.set(1);
    engine.update();
    expect(jet.active).toBe(true);
    engine.setHidden(true);
    expect(ctx!.suspends).toBe(1);
    expect(jet.active).toBe(false);
    expect(engine.play('jump')).toBe(false);
    engine.unlock(); // 隱藏中的操作不 resume
    expect(ctx!.resumes).toBe(0);
    engine.setHidden(false);
    expect(ctx!.resumes).toBe(1);
    expect(engine.status).toBe('running');
    engine.update();
    expect(jet.active).toBe(true);
  });

  it('autoplay 被擋（resume 後仍 suspended）：不發聲、不丟例外，下一次操作再嘗試', () => {
    const ctx = new FakeAudioContext();
    ctx.state = 'suspended';
    ctx.resumeTo = 'suspended';
    const { engine } = makeEngine({ ctx });
    engine.unlock();
    expect(engine.status).toBe('suspended');
    expect(engine.play('hit')).toBe(false);
    ctx.resumeTo = 'running';
    engine.unlock();
    expect(engine.status).toBe('running');
    expect(engine.play('hit')).toBe(true);
  });

  it('Web Audio 不可用或建立失敗：靜音降級，所有 API 可呼叫且不丟例外', () => {
    for (const opts of [{ ctx: null }, { throws: true }]) {
      const warn = console.warn;
      console.warn = quiet;
      try {
        const { engine } = makeEngine(opts);
        expect(() => engine.unlock()).not.toThrow();
        expect(engine.status).toBe('unavailable');
        expect(engine.play('hit')).toBe(false);
        const l = engine.loop('wind');
        l.set(1);
        expect(() => {
          engine.update();
          engine.setListener({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0, w: 1 });
          engine.setVolumes({ master: 0.2 });
          engine.setHidden(true);
          engine.setHidden(false);
          engine.setPaused(true);
          engine.weaponSound(archetypeAudio[1]!);
          engine.dispose();
        }).not.toThrow();
      } finally {
        console.warn = warn;
      }
    }
  });

  it('音量：設定 0–100% 經感知曲線套到匯流排；暫停時音效匯流排壓低、介面不變', () => {
    const { engine, ctx } = makeEngine();
    engine.unlock();
    engine.setVolumes({ master: 0.5, sfx: 1, ui: 0, music: 1 });
    const master = engine.bus('sfx') as unknown as FakeGain;
    expect((engine as unknown as { nodes: { master: FakeGain } }).nodes.master.gain.value).toBeCloseTo(0.25);
    expect(master.gain.value).toBeCloseTo(1);
    expect((engine.bus('ui') as unknown as FakeGain).gain.value).toBe(0);
    expect((engine.bus('music') as unknown as FakeGain).gain.value).toBeCloseTo(dbToGain(engine.config.mix.musicDb));
    engine.setPaused(true);
    expect(master.gain.value).toBeCloseTo(dbToGain(engine.config.mix.pausedSfxDb));
    engine.setPaused(false);
    expect(master.gain.value).toBeCloseTo(1);
    expect(ctx).not.toBeNull();
  });

  it('空間音效：給位置時用 HRTF Panner；聽者跟隨相機朝向', () => {
    const { engine, ctx } = makeEngine();
    engine.unlock();
    engine.play('explosion', { position: { x: 5, y: 1, z: -3 } });
    const src = ctx!.started.at(-1) as FakeSource;
    const gain = src.outputs[0] as FakeGain;
    const panner = gain.outputs[0] as FakePanner;
    expect(panner).toBeInstanceOf(FakePanner);
    expect(panner.panningModel).toBe('HRTF');
    expect(panner.positionX.value).toBe(5);
    expect(panner.positionZ.value).toBe(-3);
    // 往左轉 90°（繞 Y +90°）：前方 = -X
    const s = Math.SQRT1_2;
    engine.setListener({ x: 1, y: 2, z: 3 }, { x: 0, y: s, z: 0, w: s });
    expect(ctx!.listener.positionY.value).toBe(2);
    expect(ctx!.listener.forwardX.value).toBeCloseTo(-1);
    expect(ctx!.listener.forwardZ.value).toBeCloseTo(0);
    expect(ctx!.listener.upY.value).toBeCloseTo(1);
    const f = { x: 0, y: 0, z: 0 };
    const u = { x: 0, y: 0, z: 0 };
    listenerAxes({ x: 0, y: 0, z: 0, w: 1 }, f, u);
    expect(f).toEqual({ x: -0, y: -0, z: -1 });
    expect(u).toEqual({ x: 0, y: 1, z: 0 });
  });

  it('循環音：set(1) 建立循環音源並淡入，set(0) 淡出，閒置一段時間後才停止音源', () => {
    const { engine, ctx } = makeEngine();
    engine.unlock();
    const slide = engine.loop('slide');
    slide.set(1);
    engine.update();
    const src = ctx!.started.at(-1) as FakeSource;
    expect(src.loop).toBe(true);
    expect(slide.active).toBe(true);
    slide.set(0);
    ctx!.currentTime = 0.1;
    engine.update();
    expect(slide.active).toBe(true);
    ctx!.currentTime = 0.1 + engine.config.playback.loopIdleStop + 0.05;
    engine.update();
    expect(slide.active).toBe(false);
    // 不同的狀態切換（滑鏟 → 跳 → 滑鏟）在閒置時間內不會重建音源
    slide.set(1);
    engine.update();
    const n = ctx!.created.source!;
    slide.set(0);
    ctx!.currentTime += 0.2;
    engine.update();
    slide.set(1);
    engine.update();
    expect(ctx!.created.source).toBe(n);
  });

  it('未知音效不丟例外；註冊新音效（M3 敵人）與重新渲染', () => {
    const { engine } = makeEngine();
    engine.unlock();
    const warn = console.warn;
    console.warn = quiet;
    expect(engine.play('nope')).toBe(false);
    console.warn = warn;
    engine.register('enemy.test', { ...SOUND_DEFS['enemy.fire']!, recipe: SOUND_DEFS['enemy.fire']!.recipe });
    expect(engine.play('enemy.test', { position: { x: 1, y: 0, z: 0 } })).toBe(true);
    expect(engine.rebuild('hit')).toBe(true);
    expect(engine.rebuildWeaponFire('rifle')).toBeGreaterThanOrEqual(0);
    const key = engine.weaponSound({ fire: 'rifle', params: { pitch: 1.3 } });
    expect(engine.play(key)).toBe(true);
  });
});

// ── 事件綁定 ─────────────────────────────────────────────

class FakeSink implements AudioSink {
  plays: { id: string; opts: PlayOptions; time: number }[] = [];
  loops = new Map<string, LoopHandle & { gain: number; rate: number; pan: number; pos: number[] }>();
  paused: boolean[] = [];
  hidden: boolean[] = [];
  time = 0;
  play(id: string, opts: PlayOptions = {}): boolean {
    this.plays.push({ id, opts: { ...opts }, time: this.time });
    return true;
  }
  loop(id: string): LoopHandle {
    const key = this.loops.has(id) ? `${id}#${this.loops.size}` : id;
    const h = {
      id,
      gain: 0,
      rate: 1,
      pan: 0,
      pos: [0, 0, 0],
      active: false,
      target: 0,
      set(g: number, r?: number) {
        this.gain = g;
        this.target = g;
        if (r !== undefined) this.rate = r;
      },
      setPan(p: number) {
        this.pan = p;
      },
      setPosition(x: number, y: number, z: number) {
        this.pos = [x, y, z];
      },
      stop() {
        this.gain = 0;
        this.target = 0;
      },
    };
    this.loops.set(key, h);
    return h;
  }
  weaponSound(audio: { fire: string; params: Readonly<Record<string, number>> }): string {
    return weaponSoundKey(audio.fire, audio.params);
  }
  setPaused(p: boolean): void {
    this.paused.push(p);
  }
  setHidden(h: boolean): void {
    this.hidden.push(h);
  }
  ids(): string[] {
    return this.plays.map((p) => p.id);
  }
}

function makeBinder() {
  const bus = new EventBus<GameEvents>();
  const sink = new FakeSink();
  const weapons: Record<string, AudioWeaponView> = {};
  for (const d of ARCHETYPES) weapons[d.id] = d;
  let mode: GameMode = 'playing';
  const player = {
    state: 'ground',
    speed: 0,
    velocity: { x: 0, y: 0, z: 0 },
    wallRunSide: null as 'left' | 'right' | null,
    abilities: { jet: { active: false }, grapple: { phase: 'idle' } },
  };
  const health = { healthFraction: 1, alive: true };
  const projectiles = new Map<number, { x: number; y: number; z: number }>();
  const binder = new AudioEventBinder({
    bus,
    sink,
    config: defaultAudioConfig().events,
    getWeaponDef: (id) => weapons[id],
    getPlayer: () => player as AudioPlayerView,
    getHealth: () => health,
    getMode: () => mode,
    getProjectilePosition: (id, out) => {
      const p = projectiles.get(id);
      if (!p) return false;
      Object.assign(out, p);
      return true;
    },
    emitters: 2,
  });
  const step = (seconds: number, hz = 120): void => {
    const n = Math.round(seconds * hz);
    for (let i = 0; i < n; i++) {
      binder.fixedUpdate(1 / hz);
      sink.time = binder.clock;
    }
  };
  return { bus, sink, binder, weapons, player, health, projectiles, step, setMode: (m: GameMode) => (mode = m) };
}

const v0 = { x: 0, y: 0, z: 0 };

describe('事件 → 音效（AudioEventBinder）', () => {
  it('開火依武器播放各自的音色；霰彈開火後依泵動影格排兩聲', () => {
    const { bus, sink, weapons, step } = makeBinder();
    const fire = (weaponId: string) =>
      bus.emit('weapon:fire', {
        weaponId, slot: 0, shotId: 1, time: 0, origin: v0, dir: v0, pellets: 1, ammo: 5, mag: 8, spread: 0, ads: 0, mode: 'auto', firstShot: true, recoilPitch: 0, recoilYaw: 0,
      });
    for (const id of ARCHETYPE_IDS) fire(id);
    const fires = sink.ids();
    expect(new Set(fires).size).toBe(5);
    for (const id of ARCHETYPE_IDS) expect(fires).toContain(weaponSoundKey(weapons[id]!.audio.fire, weapons[id]!.audio.params));
    sink.plays = [];
    fire('scatter_shotgun');
    const interval = 60 / weapons.scatter_shotgun!.fire.rpm;
    step(interval);
    const back = sink.plays.find((p) => p.id === 'reload.pumpBack')!;
    const fwd = sink.plays.find((p) => p.id === 'reload.pumpForward')!;
    expect(back.time).toBeCloseTo(interval * DEFAULT_RELOAD_KEYS.pumpStart, 1);
    expect(fwd.time).toBeCloseTo(interval * DEFAULT_RELOAD_KEYS.pumpMid, 1);
  });

  it('換彈：彈匣出／入、空倉上膛依關鍵影格排程；取消換彈或切槍時清掉', () => {
    const { bus, sink, binder, step } = makeBinder();
    bus.emit('weapon:reloadStart', { weaponId: 'assault_rifle', slot: 0, kind: 'empty', duration: 2, ammo: 0, time: 0 });
    step(2.1);
    const at = (id: string) => sink.plays.find((p) => p.id === id)?.time;
    expect(at('reload.magOut')).toBeCloseTo(2 * DEFAULT_RELOAD_KEYS.reloadMagOut, 1);
    expect(at('reload.magIn')).toBeCloseTo(2 * DEFAULT_RELOAD_KEYS.reloadMagSeat, 1);
    expect(at('reload.rack')).toBeCloseTo(2 * DEFAULT_RELOAD_KEYS.reloadChargeStart, 1);
    sink.plays = [];
    bus.emit('weapon:reloadStart', { weaponId: 'assault_rifle', slot: 0, kind: 'tactical', duration: 2, ammo: 3, time: 0 });
    step(0.7);
    bus.emit('weapon:reloadEnd', { weaponId: 'assault_rifle', slot: 0, completed: false, refilled: false, reason: 'sprint', ammo: 3, time: 0 });
    step(2);
    expect(sink.ids()).toEqual(['reload.magOut']);
    expect(binder.pendingCues).toBe(0);
    // 手炮用轉輪、電漿用能量匣
    sink.plays = [];
    bus.emit('weapon:reloadStart', { weaponId: 'hand_cannon', slot: 2, kind: 'empty', duration: 1, ammo: 0, time: 0 });
    bus.emit('weapon:swap', { phase: 'out', fromId: 'hand_cannon', toId: 'plasma_launcher', fromSlot: 2, toSlot: 4, duration: 0.5 });
    step(1.2);
    expect(sink.ids()).toEqual(['swap.out']);
  });

  it('武器其他事件：空倉、逐發裝填、切槍、開鏡、近戰、爆炸與命中牆面（世界位置）', () => {
    const { bus, sink } = makeBinder();
    bus.emit('weapon:dryFire', { weaponId: 'assault_rifle', slot: 0 });
    bus.emit('weapon:reloadShell', { weaponId: 'shotgun', slot: 1, ammo: 3, time: 0 });
    bus.emit('weapon:swap', { phase: 'in', fromId: 'a', toId: 'b', fromSlot: 0, toSlot: 1, duration: 0.5 });
    bus.emit('weapon:ads', { weaponId: 'a', active: true, forced: false });
    bus.emit('weapon:ads', { weaponId: 'a', active: false, forced: true });
    bus.emit('weapon:melee', { phase: 'start', lunge: false, damage: 0 });
    bus.emit('weapon:melee', { phase: 'hit', lunge: false, damage: 50 });
    bus.emit('weapon:explosion', { shotId: 1, weaponId: 'plasma_launcher', point: { x: 3, y: 0, z: 4 }, normal: v0, radius: 4, targets: 0, selfKnockback: 0 });
    bus.emit('weapon:hitscan', { shotId: 1, weaponId: 'a', pellet: 0, origin: v0, end: { x: 9, y: 1, z: 0 }, normal: v0, hitWorld: true, surface: 'glass', targets: 0 });
    bus.emit('weapon:hitscan', { shotId: 1, weaponId: 'a', pellet: 1, origin: v0, end: v0, normal: v0, hitWorld: false, surface: null, targets: 1 });
    expect(sink.ids()).toEqual(['dryFire', 'reload.shell', 'swap.in', 'ads.in', 'melee.swing', 'melee.hit', 'explosion', 'impact']);
    expect(sink.plays[6]!.opts.position).toEqual({ x: 3, y: 0, z: 4 });
    expect(sink.plays[7]!.opts.rate).toBeGreaterThan(1);
  });

  it('移動事件：腳步依表面與速度、跳、二段跳、落地輕重、滑鏟、蹬牆跳、攀爬、Dash、抓鉤', () => {
    const { bus, sink } = makeBinder();
    bus.emit('player:footstep', { surface: 'grate', speed: 9 });
    bus.emit('player:footstep', { surface: 'glass', speed: 3 });
    bus.emit('player:jump', { fromState: 'ground', coyote: false });
    bus.emit('player:doubleJump', { speed: 7, remaining: 0 });
    bus.emit('player:land', { impactSpeed: 1, surface: 'metal' });
    bus.emit('player:land', { impactSpeed: 6, surface: 'metal' });
    bus.emit('player:land', { impactSpeed: 20, surface: 'grate' });
    bus.emit('player:slideStart', { speed: 10, boosted: true });
    bus.emit('player:wallJump', { normal: v0, speed: 10, grace: false });
    bus.emit('player:mantle', { height: 1, duration: 0.3, fromState: 'air' });
    bus.emit('player:dash', { dir: v0, fromState: 'ground', charges: 1 });
    bus.emit('player:grappleFire', { origin: v0, dir: v0 });
    bus.emit('player:grappleAttach', { point: v0, normal: v0, distance: 10 });
    bus.emit('player:grappleRelease', { reason: 'close', duration: 1 });
    bus.emit('player:abilityReady', { ability: 'dash', charges: 1 });
    bus.emit('player:abilityReady', { ability: 'jet', charges: 0 });
    expect(sink.ids()).toEqual([
      'step.grate', 'step.glass', 'jump', 'doubleJump', 'land.light', 'step.metal', 'land.heavy', 'step.grate', 'slide.start',
      'wallJump', 'mantle', 'dash', 'grapple.fire', 'grapple.attach', 'grapple.release', 'abilityReady',
    ]);
    expect(sink.plays[0]!.opts.gainDb!).toBeGreaterThan(sink.plays[1]!.opts.gainDb!);
  });

  it('戰鬥回饋：命中／爆頭／擊殺、受擊（護盾、生命、護盾破裂、無敵）、死亡、重生、敵人開火與能量球', () => {
    const { bus, sink } = makeBinder();
    const hit = (kind: 'hit' | 'crit' | 'kill') => bus.emit('combat:hit', { kind, hits: 1, crits: 0, kills: 0, amount: 10, weaponId: 'a' });
    hit('hit');
    hit('crit');
    hit('kill');
    const dmg = (p: Partial<GameEvents['player:damaged']>) =>
      bus.emit('player:damaged', {
        amount: 15, shieldDamage: 0, healthDamage: 0, shield: 0, health: 100, shieldBroken: false, blocked: false, dir: v0, sourcePos: v0, source: 'drone', weaponId: 'bolt', ...p,
      });
    dmg({ shieldDamage: 15 });
    dmg({ shieldDamage: 10, healthDamage: 5, shieldBroken: true });
    dmg({ blocked: true });
    bus.emit('player:shield', { phase: 'recharge', shield: 0 });
    bus.emit('player:died', { source: 'x', weaponId: 'y', deaths: 1 });
    bus.emit('player:revived', { deaths: 1 });
    bus.emit('target:killed', { id: 'd1', kind: 'drone', point: { x: 1, y: 2, z: 3 }, weaponId: 'a', isCrit: false });
    bus.emit('target:killed', { id: 't1', kind: 'dummy', point: v0, weaponId: 'a', isCrit: false });
    bus.emit('enemy:fire', { source: 'd1', position: { x: 5, y: 5, z: 5 }, dir: v0, speed: 18 });
    bus.emit('enemy:projectile', { phase: 'impact', id: 1, source: 'd1', position: v0, normal: v0 });
    bus.emit('enemy:projectile', { phase: 'expire', id: 2, source: 'd1', position: v0, normal: v0 });
    expect(sink.ids()).toEqual([
      'hit', 'hit.crit', 'hit.kill', 'hurt.shield', 'shieldBreak', 'hurt.health', 'hurt.shield', 'shieldRecharge', 'death', 'revive',
      'explosion.small', 'enemy.fire', 'enemy.impact',
    ]);
    expect(sink.plays.find((p) => p.id === 'enemy.fire')!.opts.position).toEqual({ x: 5, y: 5, z: 5 });
  });

  it('介面：開始／繼續播確認音、玩家暫停播返回音；暫停時壓低音效、分頁隱藏通知引擎', () => {
    const { bus, sink } = makeBinder();
    bus.emit('game:mode', { from: 'title', to: 'playing' });
    bus.emit('game:mode', { from: 'playing', to: 'paused', reason: 'user' });
    bus.emit('game:mode', { from: 'paused', to: 'playing' });
    bus.emit('game:mode', { from: 'playing', to: 'paused', reason: 'hidden' });
    bus.emit('lifecycle:visibility', { hidden: true });
    expect(sink.ids()).toEqual(['ui.confirm', 'ui.back', 'ui.confirm']);
    expect(sink.paused).toEqual([false, true, false, true]);
    expect(sink.hidden).toEqual([true]);
  });

  it('循環音依狀態開關：噴射、滑鏟（依速度）、跑牆（聲像）、收線、風聲；非遊玩時全部關閉', () => {
    const { sink, binder, player, setMode } = makeBinder();
    const L = (id: string) => sink.loops.get(id)!;
    player.abilities.jet.active = true;
    binder.update(1 / 60);
    expect(L('jet').gain).toBe(1);
    player.abilities.jet.active = false;
    player.state = 'slide';
    player.speed = 6;
    binder.update(1 / 60);
    const slow = L('slide').gain;
    player.speed = 16;
    binder.update(1 / 60);
    expect(L('jet').gain).toBe(0);
    expect(L('slide').gain).toBeGreaterThan(slow);
    player.state = 'wallRun';
    player.wallRunSide = 'left';
    binder.update(1 / 60);
    expect(L('slide').gain).toBe(0);
    expect(L('wallRun').gain).toBe(1);
    expect(L('wallRun').pan).toBeLessThan(0);
    player.state = 'grapple';
    player.abilities.grapple.phase = 'attached';
    player.velocity.x = 25;
    binder.update(1 / 60);
    expect(L('grapple.reel').gain).toBe(1);
    expect(L('wind').gain).toBeGreaterThan(0.3);
    setMode('paused');
    binder.update(0);
    for (const id of ['jet', 'slide', 'wallRun', 'grapple.reel', 'wind']) expect(L(id).gain, id).toBe(0);
  });

  it('電漿球飛行聲：生成時開啟並跟隨投射物位置，命中時停止；超過音源數搶占最舊的', () => {
    const { bus, sink, binder, projectiles } = makeBinder();
    const proj = (phase: 'spawn' | 'impact', id: number) =>
      bus.emit('weapon:projectile', { phase, id, shotId: id, weaponId: 'plasma_launcher', position: { x: id, y: 0, z: 0 }, velocity: v0 });
    projectiles.set(1, { x: 1, y: 0, z: 0 });
    proj('spawn', 1);
    const em = [...sink.loops.values()].filter((l) => l.id === 'plasma.flight');
    expect(em).toHaveLength(2);
    expect(em.some((l) => l.gain === 1)).toBe(true);
    projectiles.set(1, { x: 10, y: 2, z: 0 });
    binder.update(1 / 60);
    expect(em.find((l) => l.gain === 1)!.pos).toEqual([10, 2, 0]);
    proj('impact', 1);
    expect(em.every((l) => l.gain === 0)).toBe(true);
    for (const id of [2, 3, 4]) {
      projectiles.set(id, { x: id, y: 0, z: 0 });
      proj('spawn', id);
      binder.fixedUpdate(0.01);
    }
    expect(binder.emitters.map((e) => e.projectile).sort()).toEqual([3, 4]);
  });

  it('低生命心跳：低於門檻開始、生命越低越快；死亡或暫停時停止', () => {
    const { sink, binder, health, setMode } = makeBinder();
    health.healthFraction = 0.3;
    for (let i = 0; i < 600; i++) binder.update(1 / 120);
    const slowBeats = sink.ids().filter((x) => x === 'heartbeat').length;
    sink.plays = [];
    health.healthFraction = 0.02;
    for (let i = 0; i < 600; i++) binder.update(1 / 120);
    const fastBeats = sink.ids().filter((x) => x === 'heartbeat').length;
    expect(slowBeats).toBeGreaterThanOrEqual(5);
    expect(fastBeats).toBeGreaterThan(slowBeats);
    sink.plays = [];
    setMode('paused');
    for (let i = 0; i < 600; i++) binder.update(0);
    health.alive = false;
    setMode('playing');
    for (let i = 0; i < 600; i++) binder.update(1 / 120);
    expect(sink.ids()).not.toContain('heartbeat');
  });

  it('綁定播放的每個 id 都是已定義的音效', () => {
    const { bus, sink, binder } = makeBinder();
    // 送出每一種事件各一次（同上面的測試），收集 id
    bus.emit('weapon:reloadStart', { weaponId: 'plasma_launcher', slot: 4, kind: 'empty', duration: 1, ammo: 0, time: 0 });
    bus.emit('weapon:reloadStart', { weaponId: 'hand_cannon', slot: 2, kind: 'empty', duration: 1, ammo: 0, time: 0 });
    for (let i = 0; i < 240; i++) binder.fixedUpdate(1 / 120);
    bus.emit('player:grappleMiss', { reason: 'range', point: v0 });
    for (const p of sink.plays) {
      if (p.id.startsWith('fire.')) continue;
      expect(SOUND_DEFS, p.id).toHaveProperty([p.id]);
    }
    for (const l of sink.loops.values()) expect(SOUND_DEFS).toHaveProperty([l.id]);
    binder.dispose();
    expect(bus.listenerCount('weapon:fire')).toBe(0);
  });
});

// ── 面板與設定 ───────────────────────────────────────────

describe('面板與設定', () => {
  it('每個配方的每個數值欄位都有面板規格，面板涵蓋所有設定資料', () => {
    for (const [id, def] of allDefs()) {
      for (const path of recipeNumericPaths(def.recipe)) expect(fieldSpecFor(path), `${id}.${path}`).toBeDefined();
      const fields = recipePanelFields(def.recipe);
      expect(fields.length).toBeGreaterThan(recipeNumericPaths(def.recipe).length);
    }
    expect(editableSoundIds(SOUND_DEFS)).toContain('fire.railgun');
    const c = defaultAudioConfig();
    for (const k of Object.keys(c.mix)) expect(AUDIO_MIX_PANEL).toHaveProperty(k);
    for (const k of Object.keys(c.dynamics)) expect(AUDIO_DYNAMICS_PANEL).toHaveProperty(k);
    for (const k of Object.keys(c.playback)) expect(AUDIO_PLAYBACK_PANEL).toHaveProperty(k);
    for (const k of Object.keys(c.spatial)) expect(AUDIO_SPATIAL_PANEL).toHaveProperty(k);
    for (const k of Object.keys(c.events)) expect(AUDIO_EVENT_PANEL).toHaveProperty(k);
    for (const k of Object.keys(c.synth)) expect(AUDIO_SYNTH_PANEL).toHaveProperty(k);
    for (const k of Object.keys(c.voices).filter((x) => x !== 'categories')) expect(AUDIO_VOICE_PANEL).toHaveProperty(k);
    // 每個音效類別都有上限設定
    for (const [id, def] of allDefs()) expect(c.voices.categories, id).toHaveProperty([def.category]);
  });

  it('設定：新增音樂音量（預設 0.7），舊存檔缺少時補預設值、其他音量保留', () => {
    expect(defaultSettings().musicVolume).toBe(0.7);
    const old = parseSettings({ version: 1, values: { masterVolume: 0.3, sfxVolume: 0.5, uiVolume: 0.2 } });
    expect(old.settings.musicVolume).toBe(0.7);
    expect(old.settings.masterVolume).toBe(0.3);
    expect(old.settings.sfxVolume).toBe(0.5);
    expect(old.settings.uiVolume).toBe(0.2);
    expect(old.dirty).toBe(true);
    expect(parseSettings({ version: 1, values: { musicVolume: 5 } }).settings.musicVolume).toBe(1);
  });
});
