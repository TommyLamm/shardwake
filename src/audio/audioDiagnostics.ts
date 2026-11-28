// 音效離線診斷（M1-13）：用 OfflineAudioContext 經過與遊戲相同的壓縮器／限幅器渲染一段情境
// （長時間連射、大量命中同時播放），回報峰值與是否超過 0 dBFS。節流與發聲數上限用與 AudioEngine 相同的規則。
// 只在瀏覽器（調參面板「音效/測試」、headless 煙霧測試）使用；不支援 OfflineAudioContext 時回傳 null。
import type { AudioEngine } from '@/audio/AudioEngine';
import { dbToGain, gainToDb, Throttle, VoiceAllocator } from '@/audio/audioMath';

export interface StressEvent {
  id: string;
  /** 開始時間（s）。 */
  time: number;
  gainDb?: number;
}

export interface StressReport {
  /** 經過壓縮與限幅後的峰值（dBFS）。 */
  peakDb: number;
  /** 不經動態處理的峰值（dBFS；> 0 表示沒有限幅器會爆音）。 */
  rawPeakDb: number;
  /** 超過 0 dBFS（|x| ≥ 1）的樣本數。 */
  clipped: number;
  rmsDb: number;
  played: number;
  dropped: number;
  throttled: number;
  ms: number;
}

/** 情境：rpm 連射 seconds 秒（每發 id），另外每隔 hitEvery 秒疊 hitBurst 個命中音。 */
export function buildStressScenario(opts: {
  fireId: string;
  rpm: number;
  seconds: number;
  hitBurst?: number;
  hitEvery?: number;
  extra?: readonly StressEvent[];
}): StressEvent[] {
  const out: StressEvent[] = [];
  const interval = 60 / Math.max(1, opts.rpm);
  for (let t = 0; t < opts.seconds; t += interval) out.push({ id: opts.fireId, time: t });
  if (opts.hitBurst && opts.hitEvery) {
    for (let t = 0.01; t < opts.seconds; t += opts.hitEvery) {
      for (let i = 0; i < opts.hitBurst; i++) out.push({ id: i % 3 === 0 ? 'hit.crit' : 'hit', time: t + i * 0.0005 });
    }
  }
  if (opts.extra) out.push(...opts.extra);
  return out.sort((a, b) => a.time - b.time);
}

function peakAndRms(buf: AudioBuffer): { peak: number; rms: number; clipped: number } {
  let peak = 0;
  let sum = 0;
  let clipped = 0;
  let n = 0;
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < d.length; i++) {
      const a = Math.abs(d[i]!);
      if (a > peak) peak = a;
      if (a >= 1) clipped++;
      sum += d[i]! * d[i]!;
      n++;
    }
  }
  return { peak, rms: n > 0 ? Math.sqrt(sum / n) : 0, clipped };
}

/** 離線渲染情境。master／sfx 以 100% 音量（最壞情況）。 */
export async function renderStress(engine: AudioEngine, events: readonly StressEvent[], seconds: number): Promise<StressReport | null> {
  const g = globalThis as unknown as { OfflineAudioContext?: typeof OfflineAudioContext };
  if (!g.OfflineAudioContext) return null;
  const t0 = performance.now();
  const sr = engine.config.synth.sampleRate;
  const length = Math.ceil(seconds * sr);
  const render = async (dynamics: boolean): Promise<{ buf: AudioBuffer; played: number; dropped: number; throttled: number }> => {
    const ctx = new g.OfflineAudioContext!(2, length, sr);
    const master = ctx.createGain();
    master.gain.value = dbToGain(engine.config.mix.masterDb + engine.config.mix.sfxDb);
    if (dynamics) {
      const d = engine.config.dynamics;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = d.compThreshold;
      comp.knee.value = d.compKnee;
      comp.ratio.value = d.compRatio;
      comp.attack.value = d.compAttack;
      comp.release.value = d.compRelease;
      const lim = ctx.createDynamicsCompressor();
      lim.threshold.value = d.limiterThreshold;
      lim.knee.value = 0;
      lim.ratio.value = d.limiterRatio;
      lim.attack.value = d.limiterAttack;
      lim.release.value = d.limiterRelease;
      master.connect(comp);
      comp.connect(lim);
      lim.connect(ctx.destination);
    } else master.connect(ctx.destination);
    const alloc = new VoiceAllocator(Math.max(1, Math.round(engine.config.voices.pool2d)));
    const throttle = new Throttle();
    const sources: (AudioBufferSourceNode | null)[] = alloc.slots.map(() => null);
    let played = 0;
    let dropped = 0;
    for (const ev of events) {
      if (ev.time >= seconds) continue;
      const def = engine.sounds.get(ev.id)?.def;
      const variants = engine.variants(ev.id);
      if (!def || variants.length === 0) continue;
      if (!throttle.allow(ev.id, ev.time, def.minInterval)) continue;
      const v = variants[played % variants.length]!;
      let buffer: AudioBuffer;
      if (v instanceof Float32Array) {
        buffer = ctx.createBuffer(1, v.length, sr);
        buffer.copyToChannel(v as Float32Array<ArrayBuffer>, 0);
      } else buffer = v;
      const a = alloc.allocate(
        {
          soundId: ev.id,
          category: def.category,
          priority: def.priority,
          duration: buffer.duration,
          maxInstances: def.maxInstances,
          categoryMax: engine.config.voices.categories[def.category] ?? 0,
        },
        ev.time,
      );
      if (!a) {
        dropped++;
        continue;
      }
      const old = sources[a.slot.index];
      if (a.stolen && old) old.stop(ev.time + engine.config.playback.stealFade);
      const gain = ctx.createGain();
      gain.gain.value = dbToGain(def.gainDb + (ev.gainDb ?? 0));
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(gain);
      gain.connect(master);
      src.start(ev.time + (a.stolen ? engine.config.playback.stealFade : 0));
      sources[a.slot.index] = src;
      played++;
    }
    const buf = await ctx.startRendering();
    return { buf, played, dropped, throttled: throttle.blocked };
  };
  const wet = await render(true);
  const dry = await render(false);
  const w = peakAndRms(wet.buf);
  const r = peakAndRms(dry.buf);
  return {
    peakDb: gainToDb(w.peak),
    rawPeakDb: gainToDb(r.peak),
    clipped: w.clipped,
    rmsDb: gainToDb(w.rms),
    played: wet.played,
    dropped: wet.dropped,
    throttled: wet.throttled,
    ms: performance.now() - t0,
  };
}
