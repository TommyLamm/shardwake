// 重新產生內建示範錄影 src/debug/demo-clip.json（M1-15）：以 tests/helpers/demoBot.ts 的腳本在無頭模擬中錄製。
// 預設參數或訓練場改動導致 `npm test` 的示範檢查失敗時執行：npm run demo:record
import { spawnSync } from 'node:child_process';

const r = spawnSync('npx', ['vitest', 'run', 'tests/demo-clip.test.ts'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: { ...process.env, SHARDWAKE_RECORD_DEMO: '1' },
});
process.exit(r.status ?? 1);
