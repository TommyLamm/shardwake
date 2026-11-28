// M1-15：內建示範錄影（src/debug/demo-clip.json）。
// - 一般測試：用預設參數重播，必須依序做出「滑鏟 → 跑牆 → 蹬牆跳 → 二段跳 → Dash → 抓鉤」，終點與錄影一致（< 1 mm）。
//   失敗代表預設參數或關卡改了、路線失準：執行 `npm run demo:record` 重新產生。
// - SHARDWAKE_RECORD_DEMO=1（npm run demo:record）：以 tests/helpers/demoBot.ts 的腳本重新錄製並寫回檔案。
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Physics } from '@/physics/Physics';
import { serializeClip, validateClip, type InputClip } from '@/tools/clip';
import { missingSequence } from '@/tools/Replay';
import { DEMO_COMBO } from '@/tools/demo';
import { DEMO_SEQUENCE, recordDemo } from './helpers/demoBot';
import { ToolSim } from './helpers/toolSim';

const CLIP_PATH = fileURLToPath(new URL('../src/debug/demo-clip.json', import.meta.url));
const RECORD = process.env.SHARDWAKE_RECORD_DEMO === '1';

beforeAll(async () => {
  await Physics.init();
});

const sims: ToolSim[] = [];
afterEach(() => {
  for (const s of sims.splice(0)) s.dispose();
});
async function sim(): Promise<ToolSim> {
  const s = await ToolSim.create();
  sims.push(s);
  return s;
}

describe('示範錄影', () => {
  it.runIf(RECORD)('重新產生 src/debug/demo-clip.json', async () => {
    const s = await sim();
    const { clip, log } = recordDemo(s);
    expect(clip, log.join('\n')).not.toBeNull();
    expect(missingSequence(clip!.marks, DEMO_SEQUENCE), log.join('\n')).toBeNull();
    const out: InputClip = { ...clip!, gameVersion: undefined as unknown as string, createdAt: undefined as unknown as string };
    delete (out as Partial<InputClip>).gameVersion;
    delete (out as Partial<InputClip>).createdAt;
    writeFileSync(CLIP_PATH, `${serializeClip(out)}\n`);
  });

  it('預設參數下依序完成連招，60／144 Hz 終點誤差 < 1 mm', async () => {
    const v = validateClip(readFileSync(CLIP_PATH, 'utf8'));
    expect(v.errors).toEqual([]);
    const clip = v.clip!;
    expect(clip.tuning).toEqual({});
    expect(DEMO_COMBO).toEqual(DEMO_SEQUENCE);
    expect(missingSequence(clip.marks, DEMO_COMBO)).toBeNull();
    for (const fps of [60, 144]) {
      const s = await sim();
      expect(s.replay.load(clip).ok).toBe(true);
      expect(s.replay.startReplay().ok).toBe(true);
      while (s.replay.replaying) s.frame(1 / fps);
      const r = s.replay.lastResult!;
      expect(r.completed).toBe(true);
      expect(r.finalError!).toBeLessThan(0.001);
      expect(missingSequence(r.marks, DEMO_COMBO)).toBeNull();
      expect(r.marks).toEqual(clip.marks);
    }
  });
});
