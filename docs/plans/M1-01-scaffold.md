# M1-01 專案骨架與平台成品格式

- 里程碑：M1 手感原型
- 前置：無
- 狀態：未開始

## 目標

建立 Vite + TypeScript 專案。`npm run build` 要直接產生符合 Playroom 最小成品格式的 `dist/`，另外要有一個模擬平台 iframe 的本機測試頁。畫面上能看到一個發光方塊與 FPS。

## 範圍

- 包含：專案設定、固定版本的套件、資料夾骨架、`game.json`、佔位封面、成品自檢腳本、平台模擬頁、測試框架。
- 不含：任何遊戲邏輯（從 M1-02 開始）。

## 任務

- [ ] 安裝套件並固定版本（`npm install --save-exact`）：`three`、`@dimforge/rapier3d-compat`、`postprocessing`、`tweakpane`、`@tweakpane/plugin-essentials`；開發用：`typescript`、`vite`、`vitest`、`@types/three`。提交 `package-lock.json`。安裝前確認 `postprocessing` 支援所選的 `three` 版本。
- [ ] `tsconfig.json`：`strict`、`noUncheckedIndexedAccess`、`moduleResolution: "bundler"`、`target: "ES2022"`，路徑別名 `@/` → `src/`。
- [ ] `vite.config.ts`：`base: './'`、`build.target: 'es2022'`、輸出到 `dist/`；`public/` 放 `game.json` 與 `cover.png`，原樣複製到成品根目錄。
- [ ] `index.html`：`lang="zh-Hant"`、viewport、`<div id="app">`；不載入外部 CDN 或網路字型。
- [ ] `public/game.json`（schemaVersion 1，不加 `$schema` 或未知欄位；`author` 可依使用者意願修改）：

  ```json
  {
    "schemaVersion": 1,
    "id": "shardwake",
    "name": "碎晶航跡 SHARDWAKE",
    "version": "0.1.0",
    "description": "在崩解的軌道巨構碎片間高速穿梭、奪取原型武器的單人第一人稱科幻刷寶射擊遊戲。",
    "author": "SHARDWAKE 開發團隊",
    "entry": "index.html",
    "cover": "cover.png",
    "tags": ["射擊", "第一人稱", "科幻", "刷寶"],
    "instructions": "點擊畫面開始並鎖定滑鼠。WASD 移動、滑鼠瞄準、左鍵射擊、Space 跳躍、Shift Dash、C 滑鏟、F 抓鉤、Esc 暫停。",
    "devices": ["desktop"]
  }
  ```

- [ ] `scripts/make-cover.mjs`（`npm run cover`）：只用 Node 內建 `zlib` 寫出 800 × 500 的佔位 `public/cover.png`（深色漸層加青色線條）；M1-16 換成遊戲實際畫面。
- [ ] `scripts/check-dist.mjs`（`npm run check:dist`）快速自檢：
  - `dist/` 根目錄有 `game.json`、`index.html`、`cover.png`，沒有多包一層目錄。
  - `game.json`：必填欄位齊全、沒有未知欄位、`id`／`version` 格式、各欄位長度、標籤數（≤ 8，每個 ≤ 24 字元）、`devices` 值合法、`entry`／`cover` 檔案存在。
  - `index.html` 與 JS／CSS 沒有 `/assets/...` 這類根目錄絕對路徑。
  - 所有路徑符合平台規則：無 `..`、`\`、`:`、`?`、`#`、`%`、控制字元、Windows 保留檔名、結尾空白或句點，也沒有只差大小寫的重複檔名。
  - 封面是 PNG、≤ 5 MiB，讀 IHDR 確認 800 × 500；總大小與檔案數在平台上限內。
  - 正式驗證在 M1-17 用平台 CLI 做，這裡只是開發中的快速檢查。
- [ ] `scripts/platform-sim.mjs`（`npm run sim`）：只用 Node 內建 `http` 起兩個伺服器模擬跨來源——`http://localhost:4173/` 是平台頁，`http://127.0.0.1:4174/games/shardwake/<version>/` 提供 `dist/`。平台頁用和平台相同權限的 iframe 載入遊戲（`sandbox="allow-scripts allow-same-origin allow-pointer-lock"`、`allow="fullscreen; autoplay; gamepad"`），並提供按鈕切換「一般／填滿視窗（沉浸）／原生全螢幕」與調整 iframe 尺寸。
- [ ] 資料夾骨架（先放空的 `index.ts`）：`src/{core,input,physics,player,camera,weapons,combat,fx,audio,world,ui,i18n,debug}`、`tests/`、`scripts/`。
- [ ] `src/main.ts`：建立 renderer 與一個發光方塊、顯示 FPS；`await RAPIER.init()` 後建立空世界並在主控台印出版本，確認 build 後的 WASM 能載入。
- [ ] npm scripts：`dev`、`build`（`tsc --noEmit && vite build`）、`preview`、`test`（`vitest run`）、`test:watch`、`typecheck`、`check:dist`、`sim`、`cover`。

## 交付（給後續計畫）

- 指令：`npm run dev / build / test / typecheck / check:dist / sim / cover`。
- 平台模擬頁，之後每份計畫都用它驗證 iframe 內的行為。
- `src/` 資料夾結構與路徑別名 `@/`。

## 驗收

- [ ] `npm ci && npm run build && npm run check:dist` 全部通過，`dist/` 根目錄是 `game.json`、`index.html`、`cover.png`、`assets/…`。
- [ ] `npm run sim` 後，在平台模擬頁的子目錄路徑內正常顯示方塊與 FPS，主控台無錯誤。
- [ ] `npm test` 可執行，至少一個測試確認 Rapier 能在 Node 初始化。
- [ ] 確認不需要 SharedArrayBuffer：`crossOriginIsolated` 為 false 時也能正常執行。

## 實作紀錄

（完成後填寫）
