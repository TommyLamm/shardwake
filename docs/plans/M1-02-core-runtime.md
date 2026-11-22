# M1-02 核心執行框架

- 里程碑：M1 手感原型
- 前置：M1-01
- 狀態：完成

## 目標

建立主迴圈與共用基礎設施，之後所有系統都掛在上面：固定步長模擬、事件、物件池、數學工具、儲存、設定、視窗尺寸處理、調參面板外殼。

## 範圍

- 包含：`src/core/`、`src/debug/` 的基礎模組與測試。
- 不含：輸入（M1-03）、物理（M1-04）、選單介面（M1-14）。

## 任務

- [x] `core/Game.ts`：模式狀態機 `boot → title → playing ⇄ paused`；系統以 `init / fixedUpdate(dt) / update(dt) / render(alpha) / dispose` 生命週期註冊，執行順序固定並寫在程式碼註解。
- [x] `core/FixedLoop.ts`：預設 120 Hz（可設定）、累加器與插值 `alpha`；單一畫面 dt 上限 0.1 s（切分頁回來不爆衝）；每畫面最多 8 步（防死亡螺旋）；`timeScale`（慢動作）。純邏輯、可單元測試，由 `renderer.setAnimationLoop` 驅動。
- [x] `core/events.ts` + `core/EventBus.ts`：型別安全的事件表（`emit / on / off / once`），發出時同步派送；事件型別集中在一個檔案，之後每份計畫往裡面加。
- [x] `core/Pool.ts`：泛型物件池（`acquire / release`、上限、用盡時的策略：回收最舊或拒絕）。
- [x] `core/math.ts`：`damp`（與 dt 無關的指數平滑）、臨界阻尼彈簧 `SpringScalar`／`SpringVec3`（以 dt 穩定積分，大 dt 不發散）、`lerpAngle`、1D／2D 值雜訊（震動用）。
- [x] `core/Rng.ts`：可重現的亂數（mulberry32 或 xoshiro128**），支援 `int / float / range / pick / weighted`。
- [x] `core/tmp.ts`：暫存向量與四元數，讓熱迴圈不配置記憶體。
- [x] `core/Storage.ts`：包裝 `localStorage`，key 一律加 `shardwake:` 前綴；讀寫丟例外或 JSON 解析失敗時退回記憶體儲存，並提供 `isPersistent` 給 UI 顯示「目前無法存檔」。
- [x] `core/Settings.ts`：設定的型別、預設值、版本遷移、存讀（`shardwake:settings:v1`）、變更事件。先放基本欄位（靈敏度、FOV、音量、畫質、顯示 FPS），其他計畫再擴充。
- [x] `core/Viewport.ts`：用 `ResizeObserver` 追蹤遊戲容器（iframe 內）的尺寸，更新 renderer 與相機比例；`devicePixelRatio` 上限預設 1，渲染比例由畫質設定決定。平台切換顯示模式不會重載 iframe，必須正確處理尺寸變化。
- [x] `core/Lifecycle.ts`：`visibilitychange`／`blur` 時自動暫停；偵測是否嵌入 iframe（`window.self !== window.top`，不讀取 top 的任何屬性），供 UI 決定要不要顯示自己的全螢幕按鈕。
- [x] `debug/DebugPanel.ts`：Tweakpane 外殼，按 `` ` `` 或網址 `#debug` 開啟；FPS 圖與 `renderer.info`（draw call、三角形、幾何、貼圖數）；提供 `bindConfig(folderName, obj, schema)`，讓之後的系統註冊可調參數（範圍、步進、說明）。
- [x] `debug/Stats.ts`：畫面角落的 FPS／frame time，由設定開關。

## 交付（給後續計畫）

- `Game` 系統註冊與生命週期、`FixedLoop`（`alpha`、`timeScale`）。
- `EventBus` 與 `core/events.ts`。
- `SpringScalar`／`SpringVec3`、`damp`、雜訊、`Rng`、`Pool`、暫存向量。
- `Storage`（前綴與退回機制）、`Settings`（可擴充）。
- `DebugPanel.bindConfig()`。
- 實際 API 摘要（見實作紀錄）：`Game.addSystem()`／`SystemOrder`／`FrameInfo`、`game.pause(reason)`／`resume()`／`start()`、`GameStorage`、`SettingsStore`（`SETTINGS_SCHEMA`、`QUALITY_PRESETS`）、`Viewport.addCamera()`／`setRenderScale()`、`Lifecycle.embedded`、`horizontalToVerticalFov()`、`hasHashFlag()`；可調數值在 `core/config.ts`。

## 驗收

- [x] 測試：模擬 60／144／240 Hz 的畫面時間序列，相同總時間得到相同步數與相同狀態；dt 上限與每畫面步數上限有效。
- [x] 測試：彈簧在 dt = 1/30 與 1/240 下收斂結果一致且不發散；`Rng` 相同種子序列一致；`localStorage` 丟例外時 `Storage` 仍可讀寫（記憶體）。
- [x] 平台模擬頁中切換 iframe 尺寸與顯示模式，畫面比例正確、不拉伸、不重載。（headless Chrome + SwiftShader 驗證；headless 的原生全螢幕不等同實機，有頭實機未驗證）
- [x] 切分頁 30 秒再回來，不會瞬移或卡死。（headless 模擬：合成 `visibilitychange` 事件，另以 Debugger 暫停 iframe 的 JS 30 秒；實際在有頭瀏覽器切分頁未驗證）

## 實作紀錄

完成日期：2026-11-22。

### 新增檔案

- `src/core/`：`config.ts`、`events.ts`、`EventBus.ts`、`FixedLoop.ts`、`Game.ts`、`Pool.ts`、`math.ts`、`Rng.ts`、`tmp.ts`、`Storage.ts`、`Settings.ts`、`Viewport.ts`、`Lifecycle.ts`；`index.ts` 改為匯出全部。
- `src/debug/`：`DebugPanel.ts`、`Stats.ts`；`index.ts` 匯出全部。
- `src/world/BootScene.ts`：M1-01 的發光方塊場景改寫成 Game 系統（旋轉在固定步積分、渲染時以 alpha 插值），M1-04 換成訓練場後移除。
- 測試：`tests/fixed-loop.test.ts`、`game.test.ts`、`event-bus-pool.test.ts`、`math-rng.test.ts`、`storage-settings.test.ts`、`viewport-lifecycle.test.ts`、`debug.test.ts`（共 9 個測試檔、108 個測試，含 M1-01 的 31 個）。

### 偏離計畫之處與設計決定

- 新增開發套件 `@tweakpane/core` 2.0.5（固定版本）：`tweakpane` 4 的型別宣告從它匯入，沒有它 typecheck 無法取得 `Pane` 的方法。執行期不使用。
- 新增 `core/config.ts`，集中 `LOOP_CONFIG`（120 Hz、dt 上限 0.1 s、每畫面 8 步）、`VIEWPORT_CONFIG`（像素比上限 1）、`STATS_CONFIG`（取樣 500 ms）、`DEBUG_CONFIG`；都已註冊到調參面板「核心」資料夾。`bootConfig.ts` 改成可變物件並移除 `fov`、`maxPixelRatio`、`fpsSampleMs`（改由設定與 `core/config.ts` 管理）。
- `Game`：模式切換另允許 `playing → title`（返回標題，M1-14 需要）；不合法切換回傳 false、不丟例外。`fixedUpdate` 只在 playing 執行；`update(dt, frame)` 的 dt 是模擬時間（非 playing 時為 0），`frame.realDt` 為真實時間；`render(alpha, frame)`。系統以 `SystemOrder` 排序（input 100 → player → weapons → ai → physics 500 → combat → world → camera → fx → audio → ui → render 1200 → debug 1300），順序寫在 `Game.ts` 開頭註解。畫面進行中新增／移除系統會延到畫面結束後生效。暫停後恢復保留累加器（插值無縫），從標題開始才清空。另提供 `tick(realDt)` 給無頭測試與之後的錄影重播。
- `FixedLoop`：累加判斷加 1e-9 容差，避免 60 × (1/60) 的浮點誤差少算一步；達到步數上限時只保留不足一步的餘數，捨棄時間記在 `droppedTime`。
- 彈簧：除臨界阻尼外也支援阻尼比（M1-08 落地彈簧需要 8 Hz、阻尼 0.7），三種阻尼情況都用解析解，任何 dt 都不發散、結果與畫面更新率無關。參數為 `frequency`（Hz）與 `dampingRatio`（預設 1）。另加 `horizontalToVerticalFov` 等 FOV 換算（設定的 FOV 是水平值，現在就需要）。
- `Rng` 用 mulberry32，另有 `chance`、`sign`、`shuffle`、`fork`、`getState／setState`，字串種子以 FNV-1a 雜湊。
- `Storage`：key 必須不含前綴且含版本段（`settings:v1`、`replay:v1:名稱`），否則丟例外（程式錯誤）。啟動時實際寫入探測 key 確認可用；讀寫丟例外時退回記憶體並通知（`storage:status` 事件）；之後寫入成功且沒有只存在記憶體的資料時恢復持久。JSON 解析失敗回傳預設值且不覆寫原始資料。
- `Settings`：存檔格式 `{ version, values }`。欄位規格 `SETTINGS_SCHEMA` 同時用於驗證、調參面板（之後也給 M1-14 設定頁）。預設值：靈敏度 2、水平 FOV 103（80–120，依 M1-08）、主音量 0.8、音效 1、介面 0.8、畫質高、顯示 FPS 開。畫質預設的渲染比例：低 0.67、中 0.85、高 1（`QUALITY_PRESETS`，M1-09 擴充）。不認識的欄位與較新的版本號在寫回時保留（預覽版與正式版共用儲存）。
- 顯示 FPS 預設開啟：M1 為調校階段；正式預設值留給 M1-14／M1-16 決定。
- `DebugPanel`：Tweakpane 與 essentials 外掛在第一次開啟時才動態載入（成品中為獨立 chunk，約 145 KB + 145 KB，不影響啟動）；開啟前的 `bindConfig` 先記下，載入後建立。`bindConfig(folderPath, obj, schema, { onChange, expanded })`，`folderPath` 以「/」分層，規格含 `min/max/step/label/description/options/readonly/params`，`description` 以滑鼠停留提示顯示。開關：`` ` `` 鍵（`KeyboardEvent.code === 'Backquote'`，輸入框內不觸發）或網址 `#debug`（支援 `#debug&demo` 這類多旗標）；M1-03 可改由 `debugPanel` 動作呼叫 `toggle()`。開啟面板不會自動暫停（滑鼠鎖定與面板互動的處理留給 M1-03）。
- `Stats`：顯示 FPS、平均 frame time、取樣視窗內最長畫面間隔與每畫面 CPU 時間。
- `Lifecycle`：`visibilitychange`（hidden）、`blur`、`pagehide` 都會暫停；回來不自動恢復（需要玩家點擊）。回到分頁時 `main.ts` 重設時脈與 FPS 取樣。
- `main.ts` 暫時接線（M1-03／M1-14 取代）：啟動後進入 title；點擊畫面開始或繼續、Esc 暫停；畫面下方的 `.sw-hint` 提示「點擊畫面開始／已暫停」，儲存不可用時加註「目前無法存檔」。`<html>` 上有 `data-sw-mode`、`data-sw-embedded` 供自動化測試；網址含 `#debug` 時把核心物件掛到 `window.__shardwake`。
- 方塊旋轉現在只在 playing 時前進（標題畫面是靜止的方塊），用來目視確認暫停。

### 實際驗證

- `npm run typecheck`、`npm test`（9 檔、108 測試）、`npm run build`、`npm run check:dist`（9 個檔案、5.08 MiB）全部通過。
- headless Chrome（SwiftShader）透過 CDP 連 `npm run sim` 的平台頁，20 項檢查全部通過：跨來源 iframe 內啟動、title 模式、`embedded = true`、`crossOriginIsolated = false`；點擊進入 playing；`#debug` 延遲載入 Tweakpane，面板讀到 renderer.info（4 draw calls、24 三角形）；切換 1280 × 720、400 × 700、沉浸、原生全螢幕按鈕（headless 下 iframe 變成整個 1400 × 1000 視窗）、回到 960 × 540，每次 canvas 緩衝區與 CSS 尺寸都等於 iframe 尺寸、相機比例 = 寬 / 高、頁面標記保留（未重載）；合成 `visibilitychange` 後以 `hidden` 原因暫停，回來維持暫停，點擊恢復；以 Debugger 暫停 iframe 的 JS 30 秒後恢復，單畫面最多 8 步、dt 0.1 s、模擬時間只前進約 1 秒，畫面持續更新；`shardwake:settings:v1` 寫入 localStorage，重新載入 iframe 後保留。截圖確認標題提示、FPS 角落顯示、調參面板與直向畫面未拉伸。
- 主控台只有平台頁 sandbox 提示與 SwiftShader 的 `GPU stall due to ReadPixels`（截圖造成），無遊戲錯誤或例外。

### 未驗證

- 有實體 GPU 的有頭瀏覽器：實際切分頁 30 秒、原生全螢幕、真實 FPS 與調參面板的操作手感。
- 隱私模式／停用儲存的實際瀏覽器（只有單元測試以丟例外的假 localStorage 驗證退回記憶體）。
- 瀏覽器縮放或跨螢幕造成的 devicePixelRatio 變化（只有單元測試）。
- 直向畫面時水平 FOV 103° 換算出的垂直 FOV 很大（約 131°）；本作只支援桌面，是否夾住垂直 FOV 留給 M1-08。
