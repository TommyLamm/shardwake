// 調參面板「音效」（M1-13）：混音、壓縮與限幅、播放變化、空間、發聲上限、事件對應、預渲染、每種音效的音量，
// 音色編輯（選一種音效，逐欄調整合成配方與播放規則，改了立即重新渲染並試聽）、監看與測試按鈕。
// 面板的修改不存檔（玩家音量在「設定」資料夾）；「匯出 JSON」把目前的配方印到主控台並嘗試複製到剪貼簿。
import {
  AUDIO_DYNAMICS_PANEL,
  AUDIO_EVENT_PANEL,
  AUDIO_MIX_PANEL,
  AUDIO_PLAYBACK_PANEL,
  AUDIO_SPATIAL_PANEL,
  AUDIO_SYNTH_PANEL,
  AUDIO_VOICE_PANEL,
} from '@/audio/AudioConfig';
import type { AudioEngine, LoopHandle } from '@/audio/AudioEngine';
import { buildStressScenario, renderStress, type StressReport } from '@/audio/audioDiagnostics';
import {
  fieldSpecFor,
  getPath,
  recipeNumericPaths,
  setPath,
  SYNTH_ENUMS,
  validateRecipe,
  WEAPON_FIRE_DEF,
  WEAPON_FIRE_RECIPES,
  type SoundDef,
  type SynthRecipe,
} from '@/audio/SynthRecipes';
import { SystemOrder, type GameSystem } from '@/core/Game';
import type { ConfigBinding, ConfigSchema, DebugPanel, ParamSpec } from '@/debug/DebugPanel';

export interface AudioPanelOptions {
  panel: DebugPanel;
  engine: AudioEngine;
  /** 目前各槽武器的音效參數（試聽武器開火用）。 */
  weaponAudios: () => readonly { fire: string; params: Readonly<Record<string, number>> }[];
}

/** 音色編輯可選的音效：武器開火基礎配方（fire.*）+ SOUND_DEFS。 */
export function editableSoundIds(defs: Readonly<Record<string, SoundDef>>): string[] {
  return [...Object.keys(WEAPON_FIRE_RECIPES).map((k) => `fire.${k}`), ...Object.keys(defs)];
}

/** 一個配方的面板欄位（每個數值欄位 + 列舉欄位）；找不到規格的欄位不出現（validateRecipe 會報錯）。 */
export function recipePanelFields(recipe: SynthRecipe): { path: string; spec: ParamSpec }[] {
  const out: { path: string; spec: ParamSpec }[] = [];
  for (const path of recipeNumericPaths(recipe)) {
    const spec = fieldSpecFor(path);
    if (spec) out.push({ path, spec: { ...spec, label: `${path.replace(/^layers\./, 'L')} ${spec.label ?? ''}`.trim() } });
  }
  recipe.layers.forEach((L, i) => {
    const opt = (values: readonly string[]): Record<string, string> => Object.fromEntries(values.map((v) => [v, v]));
    if (L.kind === 'noise') out.push({ path: `layers.${i}.color`, spec: { label: `L${i} 雜訊`, options: opt(SYNTH_ENUMS.color) } });
    else out.push({ path: `layers.${i}.wave`, spec: { label: `L${i} 波形`, options: opt(SYNTH_ENUMS.wave) } });
    if (L.filter) out.push({ path: `layers.${i}.filter.type`, spec: { label: `L${i} 濾波`, options: opt(SYNTH_ENUMS.type) } });
  });
  return out;
}

const DEF_FIELDS: ConfigSchema<Pick<SoundDef, 'gainDb' | 'minInterval' | 'maxInstances' | 'priority' | 'variants'>> = {
  gainDb: { label: '音量 dB', min: -60, max: 12, step: 0.5 },
  minInterval: { label: '節流 s', min: 0, max: 2, step: 0.005 },
  maxInstances: { label: '同音效上限', min: 0, max: 16, step: 1, description: '0 = 只受類別上限' },
  priority: { label: '優先序', min: 0, max: 100, step: 1 },
  variants: { label: '變體數', min: 1, max: 8, step: 1, description: '單次音效 3–5' },
};

export function bindAudioPanel(opts: AudioPanelOptions): GameSystem {
  const { panel, engine } = opts;
  const cfg = engine.config;
  panel.bindConfig('音效/混音', cfg.mix, AUDIO_MIX_PANEL, { onChange: () => engine.applyMix() });
  panel.bindConfig('音效/壓縮與限幅', cfg.dynamics, AUDIO_DYNAMICS_PANEL, { onChange: () => engine.applyMix() });
  panel.bindConfig('音效/播放', cfg.playback, AUDIO_PLAYBACK_PANEL);
  panel.bindConfig('音效/空間', cfg.spatial, AUDIO_SPATIAL_PANEL, { onChange: () => engine.applySpatial() });
  panel.bindConfig('音效/發聲上限', cfg.voices, AUDIO_VOICE_PANEL);
  const catSchema: Record<string, ParamSpec> = {};
  for (const k of Object.keys(cfg.voices.categories)) catSchema[k] = { label: `類別 ${k}`, min: 0, max: 32, step: 1, description: '0 = 不限' };
  panel.bindConfig('音效/發聲上限', cfg.voices.categories, catSchema);
  panel.bindConfig('音效/事件', cfg.events, AUDIO_EVENT_PANEL);
  panel.bindConfig('音效/預渲染', cfg.synth, AUDIO_SYNTH_PANEL);
  panel.bindButtons('音效/預渲染', [
    {
      title: '重新預渲染全部',
      onClick: () => {
        const r = engine.rebuildAll();
        console.info(`[shardwake] 重新預渲染：${r.variants} 個變體、${r.ms.toFixed(0)} ms`);
      },
    },
  ]);

  // ── 每種音效的音量 ──
  const volumes: Record<string, number> = {};
  const volSchema: Record<string, ParamSpec> = {};
  const volKey = (id: string): string => id.replace(/\./g, '_');
  Object.defineProperty(volumes, 'fire', {
    enumerable: true,
    get: () => WEAPON_FIRE_DEF.gainDb,
    set: (v: number) => {
      WEAPON_FIRE_DEF.gainDb = v;
      for (const e of engine.sounds.values()) if (e.id.startsWith('fire.')) e.def.gainDb = v;
    },
  });
  volSchema.fire = { label: '武器開火（共用）', min: -40, max: 12, step: 0.5 };
  for (const [id, def] of Object.entries(engine.defs)) {
    Object.defineProperty(volumes, volKey(id), { enumerable: true, get: () => def.gainDb, set: (v: number) => (def.gainDb = v) });
    volSchema[volKey(id)] = { label: id, min: -40, max: 12, step: 0.5 };
  }
  panel.bindConfig('音效/每種音效音量 dB', volumes, volSchema);

  // ── 音色編輯 ──
  const ids = editableSoundIds(engine.defs);
  const selection = { sound: ids[0] ?? '' };
  let editor: ConfigBinding | null = null;
  const previewLoops = new Map<string, LoopHandle>();
  let previewTimer: ReturnType<typeof setTimeout> | null = null;
  const target = (id: string): { recipe: SynthRecipe; def: Pick<SoundDef, 'gainDb' | 'minInterval' | 'maxInstances' | 'priority' | 'variants'>; fire: string | null } | null => {
    if (id.startsWith('fire.')) {
      const fire = id.slice(5);
      const recipe = WEAPON_FIRE_RECIPES[fire];
      return recipe ? { recipe, def: WEAPON_FIRE_DEF, fire } : null;
    }
    const def = engine.defs[id];
    return def ? { recipe: def.recipe, def, fire: null } : null;
  };
  const preview = (): void => {
    const id = selection.sound;
    const t = target(id);
    if (!t) return;
    engine.unlock();
    if (t.fire) {
      const audio = opts.weaponAudios().find((a) => a.fire === t.fire) ?? { fire: t.fire, params: {} };
      engine.play(engine.weaponSound(audio), { noVariation: true });
    } else if (t.recipe.loop) {
      for (const l of previewLoops.values()) l.stop();
      let h = previewLoops.get(id);
      if (!h) {
        h = engine.loop(id);
        previewLoops.set(id, h);
      }
      h.set(1);
      if (previewTimer) clearTimeout(previewTimer);
      previewTimer = setTimeout(() => h?.stop(), 1500);
    } else engine.play(id, { noVariation: true });
  };
  const rebuild = (): void => {
    const t = target(selection.sound);
    if (!t) return;
    const errors = validateRecipe(t.recipe, selection.sound);
    if (errors.length > 0) {
      console.warn(`[shardwake] 配方不合法：\n${errors.join('\n')}`);
      return;
    }
    if (t.fire) {
      for (const e of engine.sounds.values()) if (e.id.startsWith('fire.')) Object.assign(e.def, { ...WEAPON_FIRE_DEF, recipe: e.def.recipe });
      engine.rebuildWeaponFire(t.fire);
    } else engine.rebuild(selection.sound);
  };
  const buildEditor = (): void => {
    editor?.dispose();
    const t = target(selection.sound);
    if (!t) return;
    const proxy: Record<string, unknown> = {};
    const schema: Record<string, ParamSpec> = {};
    for (const [k, spec] of Object.entries(DEF_FIELDS)) {
      Object.defineProperty(proxy, `def.${k}`, {
        enumerable: true,
        get: () => (t.def as unknown as Record<string, number>)[k],
        set: (v: number) => ((t.def as unknown as Record<string, number>)[k] = v),
      });
      schema[`def.${k}`] = spec!;
    }
    for (const f of recipePanelFields(t.recipe)) {
      Object.defineProperty(proxy, f.path, {
        enumerable: true,
        get: () => getPath(t.recipe, f.path),
        set: (v: unknown) => setPath(t.recipe, f.path, v),
      });
      schema[f.path] = f.spec;
    }
    editor = panel.bindConfig('音效/音色編輯/配方', proxy, schema, {
      onChange: () => {
        rebuild();
        preview();
      },
    });
  };
  const options: Record<string, string> = {};
  for (const id of ids) options[id] = id;
  panel.bindConfig('音效/音色編輯', selection, { sound: { label: '音效', options } }, { onChange: () => buildEditor() });
  panel.bindButtons('音效/音色編輯', [
    { title: '試聽', onClick: preview },
    {
      title: '匯出 JSON',
      onClick: () => {
        const t = target(selection.sound);
        if (!t) return;
        const json = JSON.stringify({ id: selection.sound, ...t.def, recipe: t.recipe }, null, 2);
        console.info(`[shardwake] 音效配方 ${selection.sound}：\n${json}`);
        void navigator.clipboard?.writeText(json).catch(() => {});
      },
    },
  ]);
  buildEditor();

  // ── 監看 ──
  const mon = {
    status: '',
    contextRate: 0,
    latencyMs: 0,
    voices: '',
    peak: 0,
    plays: 0,
    silent: 0,
    throttled: 0,
    stolen: 0,
    dropped: 0,
    loops: 0,
    prerenderMs: 0,
    variants: 0,
    memory: '',
    last: '',
    stress: '（未執行）',
  };
  panel.bindConfig('音效/監看', mon, {
    status: { label: '狀態', readonly: true },
    contextRate: { label: '輸出取樣率', readonly: true },
    latencyMs: { label: '輸出延遲 ms', readonly: true },
    voices: { label: '發聲 2D/3D/UI/循環', readonly: true },
    peak: { label: '最多同時（2D）', readonly: true },
    plays: { label: '播放數', readonly: true },
    silent: { label: '未解鎖丟棄', readonly: true },
    throttled: { label: '節流', readonly: true },
    stolen: { label: '搶占', readonly: true },
    dropped: { label: '超過上限丟棄', readonly: true },
    loops: { label: '循環啟動', readonly: true },
    prerenderMs: { label: '預渲染 ms', readonly: true },
    variants: { label: '變體數', readonly: true },
    memory: { label: '樣本 MiB / 秒', readonly: true },
    last: { label: '最後播放', readonly: true },
    stress: { label: '離線壓力測試', readonly: true },
  });

  // ── 測試 ──
  let stressRunning = false;
  const runStress = async (): Promise<StressReport | null> => {
    if (stressRunning) return null;
    stressRunning = true;
    try {
      const audio = opts.weaponAudios()[0] ?? { fire: 'rifle', params: {} };
      const fireId = engine.weaponSound(audio);
      const events = buildStressScenario({ fireId, rpm: 600, seconds: 6, hitBurst: 40, hitEvery: 0.5, extra: [{ id: 'explosion', time: 2 }, { id: 'explosion', time: 2.05 }] });
      const r = await renderStress(engine, events, 6.5);
      mon.stress = r ? `峰值 ${r.peakDb.toFixed(2)} dBFS（未處理 ${r.rawPeakDb.toFixed(1)}）、爆音樣本 ${r.clipped}` : '不支援 OfflineAudioContext';
      console.info('[shardwake] 音效離線壓力測試', r);
      return r;
    } finally {
      stressRunning = false;
    }
  };
  let burst: ReturnType<typeof setInterval> | null = null;
  panel.bindButtons('音效/測試', [
    { title: '解鎖／恢復 AudioContext', onClick: () => engine.unlock() },
    {
      title: '連射 100 發（步槍）',
      onClick: () => {
        if (burst) clearInterval(burst);
        const audio = opts.weaponAudios()[0] ?? { fire: 'rifle', params: {} };
        const id = engine.weaponSound(audio);
        let n = 0;
        burst = setInterval(() => {
          engine.play(id);
          if (++n >= 100 && burst) {
            clearInterval(burst);
            burst = null;
          }
        }, 100);
      },
    },
    {
      title: '同時 40 個命中音',
      onClick: () => {
        for (let i = 0; i < 40; i++) engine.play(i % 2 ? 'hit' : 'hit.crit');
      },
    },
    { title: '離線壓力測試（6 s）', onClick: () => void runStress() },
  ]);

  return {
    name: 'audioPanel',
    order: SystemOrder.debug,
    update() {
      if (!panel.isOpen) return;
      const s = engine.stats;
      const v = engine.activeVoices();
      const ctx = engine.context;
      mon.status = `${engine.status}${ctx ? `（${ctx.state}）` : ''}`;
      mon.contextRate = ctx?.sampleRate ?? 0;
      mon.latencyMs = ctx ? ((ctx.baseLatency ?? 0) + ((ctx as { outputLatency?: number }).outputLatency ?? 0)) * 1000 : 0;
      mon.voices = `${v.p2d} / ${v.p3d} / ${v.ui} / ${v.loops}`;
      mon.peak = engine.allocators?.p2d.stats.peak ?? 0;
      mon.plays = s.plays;
      mon.silent = s.silent;
      mon.throttled = s.throttled;
      mon.stolen = s.stolen;
      mon.dropped = s.dropped;
      mon.loops = s.loopStarts;
      mon.prerenderMs = Math.round(engine.report?.ms ?? 0);
      mon.variants = engine.report?.variants ?? 0;
      mon.memory = engine.report ? `${(engine.report.bytes / 1048576).toFixed(1)} / ${engine.report.seconds.toFixed(1)}` : '';
      mon.last = s.lastPlayed;
    },
    dispose() {
      if (burst) clearInterval(burst);
      if (previewTimer) clearTimeout(previewTimer);
      editor?.dispose();
    },
  };
}
