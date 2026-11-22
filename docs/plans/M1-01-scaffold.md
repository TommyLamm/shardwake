# M1-01 專案骨架與平台成品格式

- 里程碑：M1 手感原型
- 前置：無
- 狀態：完成

## 目標

建立 Vite + TypeScript 專案。`npm run build` 要直接產生符合 Playroom 最小成品格式的 `dist/`，另外要有一個模擬平台 iframe 的本機測試頁。畫面上能看到一個發光方塊與 FPS。

## 範圍

- 包含：專案設定、固定版本的套件、資料夾骨架、`game.json`、佔位封面、成品自檢腳本、平台模擬頁、測試框架。
- 不含：任何遊戲邏輯（從 M1-02 開始）。

## 任務

- [x] 安裝套件並固定版本（`npm install --save-exact`）：`three`、`@dimforge/rapier3d-compat`、`postprocessing`、`tweakpane`、`@tweakpane/plugin-essentials`；開發用：`typescript`、`vite`、`vitest`、`@types/three`、`@types/node`（`vite.config.ts` 用到 `node:url`）。提交 `package-lock.json`。安裝前確認 `postprocessing` 支援所選的 `three` 版本。
- [x] `tsconfig.json`：`strict`、`noUncheckedIndexedAccess`、`moduleResolution: "bundler"`、`target: "ES2022"`，路徑別名 `@/` → `src/`。
- [x] `vite.config.ts`：`base: './'`、`build.target: 'es2022'`、輸出到 `dist/`；`public/` 放 `game.json` 與 `cover.png`，原樣複製到成品根目錄。
- [x] `index.html`：`lang="zh-Hant"`、viewport、`<div id="app">`；不載入外部 CDN 或網路字型。
- [x] `public/game.json`（schemaVersion 1，不加 `$schema` 或未知欄位；`author` 可依使用者意願修改）：

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

- [x] `scripts/make-cover.mjs`（`npm run cover`）：只用 Node 內建 `zlib` 寫出 800 × 500 的佔位 `public/cover.png`（深色漸層加青色線條）；M1-16 換成遊戲實際畫面。
- [x] `scripts/check-dist.mjs`（`npm run check:dist`）快速自檢：
  - `dist/` 根目錄有 `game.json`、`index.html`、`cover.png`，沒有多包一層目錄。
  - `game.json`：必填欄位齊全、沒有未知欄位、`id`／`version` 格式、各欄位長度、標籤數（≤ 8，每個 ≤ 24 字元）、`devices` 值合法、`entry`／`cover` 檔案存在。
  - `index.html` 與 JS／CSS 沒有 `/assets/...` 這類根目錄絕對路徑。
  - 所有路徑符合平台規則：無 `..`、`\`、`:`、`?`、`#`、`%`、控制字元、Windows 保留檔名、結尾空白或句點，也沒有只差大小寫的重複檔名。
  - 封面是 PNG、≤ 5 MiB，讀 IHDR 確認 800 × 500；總大小與檔案數在平台上限內。
  - 正式驗證在 M1-17 用平台 CLI 做，這裡只是開發中的快速檢查。
- [x] `scripts/platform-sim.mjs`（`npm run sim`）：只用 Node 內建 `http` 起兩個伺服器模擬跨來源——`http://localhost:4173/` 是平台頁，`http://127.0.0.1:4174/games/shardwake/<version>/` 提供 `dist/`。平台頁用和平台相同權限的 iframe 載入遊戲（`sandbox="allow-scripts allow-same-origin allow-pointer-lock"`、`allow="fullscreen; autoplay; gamepad"`），並提供按鈕切換「一般／填滿視窗（沉浸）／原生全螢幕」與調整 iframe 尺寸。
- [x] 資料夾骨架（先放空的 `index.ts`）：`src/{core,input,physics,player,camera,weapons,combat,fx,audio,world,ui,i18n,debug}`、`tests/`、`scripts/`。
- [x] `src/main.ts`：建立 renderer 與一個發光方塊、顯示 FPS；`await RAPIER.init()` 後建立空世界並在主控台印出版本，確認 build 後的 WASM 能載入。
- [x] npm scripts：`dev`、`build`（`tsc --noEmit && vite build`）、`preview`、`test`（`vitest run`）、`test:watch`、`typecheck`、`check:dist`、`sim`、`cover`。

## 交付（給後續計畫）

- 指令：`npm run dev / build / test / typecheck / check:dist / sim / cover`。
- 平台模擬頁，之後每份計畫都用它驗證 iframe 內的行為。
- `src/` 資料夾結構與路徑別名 `@/`。

## 驗收

- [x] `npm ci && npm run build && npm run check:dist` 全部通過，`dist/` 根目錄是 `game.json`、`index.html`、`cover.png`、`assets/…`。
- [x] `npm run sim` 後，在平台模擬頁的子目錄路徑內正常顯示方塊與 FPS，主控台無錯誤。（以 headless Chrome／Edge + SwiftShader 驗證，見實作紀錄；有實體 GPU 的有頭瀏覽器未驗證）
- [x] `npm test` 可執行，至少一個測試確認 Rapier 能在 Node 初始化。
- [x] 確認不需要 SharedArrayBuffer：`crossOriginIsolated` 為 false 時也能正常執行。

## 實作紀錄

完成日期：2026-11-22。

### 固定版本

- 執行期：`three` 0.187.0、`@dimforge/rapier3d-compat` 0.21.0、`postprocessing` 6.39.6（peer：`three >= 0.168.0 < 0.188.0`，相容）、`tweakpane` 4.0.5、`@tweakpane/plugin-essentials` 0.2.1。
- 開發：`typescript` 7.0.2、`vite` 8.3.8（Rolldown）、`vitest` 5.1.1、`@types/three` 0.187.0、`@types/node` 24.19.2。本機 Node 24.19.0／npm 12.0.2。
- `package.json` 全部為精確版本，`package-lock.json` 已產生；`engines.node` 設為 `>=22.12.0`（Vite 8 的下限）。

### 偏離計畫之處

- 多裝 `@types/node`（開發用）：`vite.config.ts` 以 `node:url` 設定 `@/` 別名，typecheck 需要 Node 型別。
- 沒有獨立的 `vitest.config.ts`：測試設定寫在 `vite.config.ts` 的 `test` 欄位（改用 `vitest/config` 的 `defineConfig`）；測試只收 `tests/**/*.test.ts`，環境為 Node。
- `tsconfig.json` 另開 `allowJs`（`checkJs: false`）、`verbatimModuleSyntax`、`noImplicitOverride` 等，讓測試能直接匯入 `scripts/check-dist.mjs` 的規則函式；`tests/` 與 `vite.config.ts` 也納入 typecheck。
- 建置拆 chunk：Rapier compat 版把 WASM 以 base64 內嵌在 JS，單一 chunk 約 4.9 MB。改以 Rolldown `codeSplitting` 拆出 `rapier-*.js`（約 4.3 MB，gzip 1.67 MB）與 `three-*.js`（約 535 KB），遊戲程式本體約 3 KB；`chunkSizeWarningLimit` 設 5120 KB。成品共 7 個檔案、4.78 MiB。
- 開機場景數值放在 `src/bootConfig.ts`（`BOOT_SCENE_CONFIG`：顏色、發光強度、光暈、FOV、旋轉速度、像素比上限 1、FPS 取樣 500 ms）。發光以 emissive 材質 + 加法混色背面光暈殼呈現，正式 Bloom 留給 M1-09。iframe 尺寸以 `ResizeObserver` 追蹤 `#app`（M1-02 的 `Viewport` 會取代）。啟動完成時在 `<html>` 設 `data-sw-boot="ready"`（失敗為 `error`），供自動化煙霧測試判斷。
- `check:dist` 額外檢查：`id` 必須固定為 `shardwake`、`game.json` 與 `package.json` 版本一致、`index.html` 不載入外部網路資源、`index.html` 引用的本地檔案存在、不含符號連結、`cloudSave` 需 schemaVersion 2。規則函式可匯出，由 `tests/check-dist.test.ts` 單元測試。
- `platform-sim` 額外功能：除 `/games/shardwake/<version>/` 外也掛 `/preview/shardwake/<version>-sim/`（可在頁面切換）；子目錄以外的請求一律 404 並在終端機警告（抓根目錄絕對路徑），不提供 SPA fallback；不送 COOP/COEP；原生全螢幕成功時比照平台以 Keyboard Lock 鎖 `Escape`，失敗時改用沉浸模式；沉浸／全螢幕右上角有「退出」鈕；尺寸預設含 400 × 700 直向與「填滿內容區」；埠號可用 `SIM_PLATFORM_PORT`／`SIM_GAME_PORT` 覆寫，成品目錄可用 `SIM_DIST`。兩個伺服器都只綁 `127.0.0.1`，平台頁以 `localhost` 開啟，與遊戲（`127.0.0.1`）不同來源、不同 site。
- 封面 `scripts/make-cover.mjs` 自行計算 CRC32（不依賴 `zlib.crc32`），輸出 RGB 8-bit PNG 約 135 KiB；可傳參數指定輸出路徑。

### 實際驗證

- `npm ci`、`npm run typecheck`、`npm test`（2 個檔案、31 個測試，含 Rapier 在 Node 初始化並模擬自由落體）、`npm run build`、`npm run check:dist` 全部通過；`dist/` 根目錄為 `game.json`、`index.html`、`cover.png`、`assets/`。
- 反向測試：把成品 `index.html` 改成 `/assets/...` 並放入不合法的 `game.json`，`check:dist` 列出 21 項錯誤並以結束碼 1 失敗。
- `npm run dev`：開發伺服器能提供 `index.html` 與 `src/*.ts`。
- 平台模擬：用本機 headless Chrome 與 Edge（SwiftShader WebGL）透過 CDP 連上 `npm run sim` 的平台頁，確認跨來源 iframe（OOPIF）內 `data-sw-boot="ready"`、方塊與 FPS 有畫出（截圖確認）、主控台印出 `Rapier 0.21.0 已初始化；crossOriginIsolated=false；SharedArrayBuffer 不可用`，沒有遊戲程式的錯誤或例外；切換 1280 × 720、沉浸模式（1376 × 908）後 canvas 跟著 iframe 改變尺寸，不重載；`/preview/...` 入口同樣正常。
- 主控台只有環境造成的警告：平台頁的「sandbox 同時含 allow-scripts 與 allow-same-origin」提示（與平台權限相同，屬預期）、SwiftShader 的 `GPU stall due to ReadPixels` 與 `glBlitFramebuffer feedback loop`（headless 截圖／軟體繪製造成）、headless 無使用者手勢導致原生全螢幕失敗並退回沉浸模式（退回邏輯因此得到驗證）。

### 未驗證

- 在有實體 GPU 的有頭瀏覽器實際開啟平台模擬頁（畫面、真實 FPS、主控台）。
- 原生全螢幕模式與 Keyboard Lock（headless 無法由使用者手勢觸發）。
- 只差大小寫的重複檔名在實際成品目錄中的偵測：Windows 檔案系統不分大小寫，無法建立此情境，只有單元測試覆蓋。
- 正式 ZIP 驗證（平台 `game:pack`／`game:validate`）依計畫留給 M1-17。
- 開機場景的地面格線在 SwiftShader 截圖中只看得到橫向線，縱向線未顯示；屬佔位場景，未深究，M1-04 會換成灰盒訓練場。
