# M1-16 效能、手感總調校、說明文件與封面 ★

- 里程碑：M1 手感原型
- 前置：M1-01～M1-15
- 狀態：完成（真人實機試玩、GTX 1650 有頭瀏覽器實測與手感定案未驗證，見實作紀錄）
- 檢查點：★ 完成後就是可以交付的手感原型

## 目標

把原型打磨到可以交付：效能達標、手感預設值定案、錯誤處理完整、說明文件與封面就緒。

## 任務

- [x] 效能剖析：用 Chrome Performance 錄 30 s 的激烈戰鬥加高速移動，找出長任務、GC 與過多的 draw call。目標：高畫質 1080p、GTX 1650 ≥ 120 FPS，frame time 第 99 百分位 < 12 ms；熱迴圈零配置（Memory 面板看不到鋸齒狀 GC）。（以 `npm run perf` 在 headless Chrome／Edge 透過 CDP 做同等量測：Tracing 錄 30 s、取樣式記憶體配置剖析、同步吞吐量；有頭瀏覽器的實際 FPS 未驗證。）
- [x] 最佳化：合併與 instancing、特效數量上限、HUD 更新節流、陰影相機範圍、各畫質的預設渲染比例。（依數據：修正每畫面重查著色器程式、熱迴圈配置、關閉面板後的監看計時器、HUD 60 Hz 節流；特效上限、陰影範圍、渲染比例經拆解量測後維持現值。）
- [ ] 手感總調校：依實機試玩調整 MovementConfig、鏡頭參數與 5 把武器的預設值；把定案值寫回原始碼的預設，並在「實作紀錄」留下調校紀錄（改了什麼、為什麼）。（未驗證：沒有真人實機試玩。只做了數據可證明的一致性檢查與修正；定案值 = 目前值，待真人試玩調整，參數清單見實作紀錄。）
- [x] 錯誤處理：WebGL 不可用或 context lost 時，顯示中文錯誤畫面與重試按鈕；Rapier 初始化失敗時有提示；任何 `await` 失敗都不會變成白畫面。
- [x] `#cover` 封面模式：固定在訓練場最好看的角度、隱藏 HUD、以 800 × 500 渲染，並提供「下載封面」按鈕（只在 `#cover` 出現）；產生正式的 `public/cover.png`（≤ 5 MiB）。
- [x] `public/game.json`：完善 `description`、`instructions`（操作說明）、`tags`（≤ 8 個，每個 ≤ 24 字元）。
- [x] `README.md`：遊戲簡介、操作表、開發指令、調參面板與錄製重播的用法、試玩清單（各移動技、各武器、無人機閃避、調整並匯出預設）、已知問題。
- [x] 全面驗證：`npm run typecheck && npm test && npm run build && npm run check:dist`；在 Chrome、Edge 與平台模擬頁實測。（headless Chrome 158／Edge 158，`npm run check:browser`。）

## 交付（給後續計畫）

- 定案的手感預設值與調校紀錄。（目前值即定案值，未經真人試玩；試玩時優先調整的參數見實作紀錄「手感總調校」。）
- 正式封面與完整的 `game.json`。
- `npm run check:browser`（瀏覽器煙霧與錯誤路徑測試）、`npm run perf`（效能探針）、`npm run cover`（以遊戲畫面產生封面），M1-17 的本機驗證與之後每個版本都可重複使用。

## 驗收

- [ ] 效能目標達成，附 Performance 截圖或數據。（**未驗證**：headless 數據見實作紀錄——同一張 GTX 1650 的同步吞吐量高畫質 1080p 平均 4.1 ms、p99 4.7 ms（約 244 FPS），遠低於 8.3 ms／12 ms；但沒有有頭瀏覽器的實際遊玩 FPS 與 p99。）
- [ ] 試玩清單逐項通過並記錄結果。（**未驗證**：沒有真人實機試玩；清單在 README「試玩清單」，自動化能涵蓋的部分（#demo 連招、計時賽邏輯、錯誤畫面、iframe）已通過。）
- [x] 封面 800 × 500、`game.json` 內容完整，`check:dist` 通過。

## 實作紀錄

完成日期：2026-11-28。

### 新增／修改檔案

- 新增 `src/core/errors.ts`（`FatalError`、`classifyError()`、`guessKind()`、`runStage()`、`probeWebGL2()`、`FrameGuard`）、`src/ui/ErrorScreen.ts`（`ErrorScreen`、`BootScreen`、`errorText()`）、`src/tools/cover.ts`（`COVER_CONFIG`、`CoverMode`、`sanitizeCoverConfig()`、`coverView()`、`coverTitleLayout()`）。
- 新增 `scripts/lib/browser.mjs`（找本機 Chrome／Edge、獨立暫存使用者資料夾啟動 headless、CDP flatten session、極簡靜態伺服器）、`scripts/perf-probe.mjs`（`npm run perf`）、`scripts/browser-check.mjs`（`npm run check:browser`）；`scripts/make-cover.mjs`（`npm run cover`）改寫為以 `#cover` 擷取遊戲畫面（M1-01 的純 Node 佔位封面不再使用）。
- 新增測試 `tests/polish.test.ts`（18 項）、`tests/tuning-defaults.test.ts`（7 項）；`tests/debug.test.ts` 加 2 項。
- 修改：`src/main.ts`（啟動各階段 `runStage`、WebGL 偵測、載入畫面階段文字、音效預渲染與預熱失敗不致命、`FrameGuard` 包住遊戲迴圈、context lost／restored、`#cover`、`__shardwake` 加 `errorScreen`／`frameGuard`、面板「介面/HUD 版面/HUD 更新 Hz」）、`index.html`（靜態載入畫面、`<noscript>`、載入看門狗）、`src/style.css`（錯誤畫面、封面模式）、`src/i18n/zh-TW.ts`（`boot.*`、`error.*`、`cover.download`、`hud.msg.contextRestored`）、`src/physics/Physics.ts`（初始化失敗後可重試）、`src/tools/ToolVisuals.ts`、`src/tools/TuningTools.ts`、`src/debug/DebugPanel.ts`、`src/weapons/Viewmodel.ts`、`src/combat/targets/Targets.ts`、`src/fx/instanced.ts`、`src/ui/Hud.ts`、`src/ui/HudConfig.ts`、`src/ui/hudMath.ts`（`UpdateThrottle`）、`src/weapons/WeaponPanel.ts`（衰減距離滑桿上限）、`public/game.json`、`public/cover.png`、`package.json`（`perf`、`check:browser` 指令；沒有新增套件）、`README.md`、`PLAN.md`。
- 截圖：`docs/screenshots/M1-16-error-webgl.png`、`M1-16-error-context-lost.png`、`M1-16-context-restored.png`；封面 `public/cover.png`。

### 規格核對

- 已讀線上 [Manifest Schema](https://raw.githubusercontent.com/TommyLamm/playroom-platform/main/templates/game.schema.json) 與《開發與發布標準》的「最小成品」「執行環境」兩章。`game.json` 只用 schema 1 的必填欄位（沒有 `leaderboard`、`cloudSave`），`description` 與 `instructions` ≤ 2000 字元、7 個標籤各 ≤ 24 字元、`devices: ["desktop"]`、`id` 與 `version`（0.1.0）不變；封面 PNG 800 × 500、483 KiB。
- 錯誤畫面的「重試」只重新載入 iframe 內的頁面（`location.reload()`），不做 top navigation、不開 popup；封面下載用 `<a download>` + data URL。

### 效能數據

量測環境：本機 GTX 1650（ANGLE D3D11，headless Chrome 158 與 Edge 158，`--disable-gpu-vsync --disable-frame-rate-limit`），1920 × 1080、像素比 1、高畫質；腳本在無人機戰區連射、前後與橫移、每 1.3 s 跳、每 2.7 s Dash、週期性滑鏟、每 5 s 輪流切 5 把槍並換彈，3 架無人機開啟、玩家無敵。調參面板關閉（玩家實際情況）。「前」= M1-15 提交（c64b97d）的建置，「後」= 本計畫。原始數據在 `artifacts/perf-*.json`（不提交）。

| 項目 | 前 | 後 |
| --- | --- | --- |
| 同步吞吐量（每畫面 1 個 120 Hz 步、1 px readPixels 等 GPU、強制版面）高畫質 mean／p99／max | 3.96／4.8／8.3 ms（≈ 252 FPS） | 4.11／4.7／8.8 ms（≈ 244 FPS） |
| 同上，中畫質 | 3.22／4.0 ms（≈ 311 FPS） | 2.99／3.6 ms（≈ 334 FPS） |
| 同上，低畫質 | 1.31／2.1 ms（≈ 765 FPS） | 1.24／1.8 ms（≈ 806 FPS） |
| Edge 高／中／低 mean（p99） | — | 4.58（6.0）／3.07（3.7）／1.17（1.7）ms |
| 熱迴圈配置（取樣式剖析，含已回收物件） | 28.5 KB／畫面 | 20.4 KB／畫面（Edge 22.0） |
| 　其中 three.js／遊戲程式／Rapier／瀏覽器內建／Tweakpane | 14.6／6.2／2.6／2.9／2.3 KB | 9.9／6.1／2.7／1.3／0.4 KB |
| 調參面板開啟時（開發情境） | 133.7 KB／畫面 | 36.2 KB／畫面 |
| 30 s 戰鬥 GC（Tracing） | minor 6 次、共 3.2 ms、最長 0.59 ms；major 0 | minor 4 次、共 3.0 ms、最長 1.1 ms；major 0（Edge：minor 1 次） |
| draw call／三角形（戰鬥中最大值，含陰影與後處理 pass） | 101／4.5 萬 | 95／3.8 萬 |
| 著色器程式數（高） | 32 | 32（戰鬥 30 s 後不增加） |

- **成本拆解**（後，高畫質同步 mean）：全開 4.2 ms；關陰影 3.7 ms；關 Bloom 3.5 ms；渲染比例 0.85 → 3.3 ms、0.75 → 2.8 ms。GPU 是主要成本，CPU 每畫面（含 1 個模擬步與 draw call 提交）在保留幀率限制時 p50 2.7 ms、p99 5.6 ms（`--vsync`，headless 約 51 Hz、每畫面 2–3 步）。
- **長任務**：不限幀率時 rAF 每秒 300 張，GPU 指令佇列滿了之後主執行緒在 WebGL 呼叫中等待，出現 50–300 ms 的長畫面（前後都有，`steps = 0` 的畫面也會），屬於壓力測試方式的人為結果；保留幀率限制（`--vsync`）時 30 s 內遊戲畫面 CPU 最長 16.4 ms，沒有 GC 造成的鋸齒。Tracing 結束時另有一次約 290 ms 的長任務（Tracing 自身的資料回收）。
- **draw call**：特效（火花、曳光、彈孔、電漿球、爆炸）本來就是 instancing，每種 1 個 draw call；全息看板與發光條已合併（M1-09）。戰鬥中最多 95 個（含陰影 pass 與後處理），低於 M1-09 定的 120 預算，沒有再合併。

### 最佳化（有數據根據的修改）

- **計時賽環每畫面重查著色器程式**：透明＋雙面材質在 three 預設分兩次畫（背面、正面），每次都改 `side` 讓 `material.version` 變動，three 每畫面對每個環重跑 `getParameters()`／`getProgramCacheKey()`（以 `customProgramCacheKey` 計數診斷：每畫面 14 次）。改 `forceSinglePass = true`（環很細，前後排序看不出差別）。three 的配置每畫面少約 4.7 KB，也少了 CPU 時間與重複的 draw call。
- **調參面板關閉後監看仍在跑**：Tweakpane 的唯讀監看每 200 ms 更新，關閉面板（`hidden`）不會停。改為關閉時 `pane.disabled = true`（監看計時器綁在 globalDisabled 上，停用時不 tick），開啟時恢復；只影響開過面板的情境（`#debug` 或按 `` ` ``），玩家正常遊玩不會載入 Tweakpane。
- **面板開啟時每畫面複製全部調參值**：「工具/計時賽」的調參指紋監看每畫面 `captureTuning()`＋`stableStringify()`（約 60 KB），節流到每 0.5 s 一次。
- **熱迴圈配置**：Viewmodel 每畫面建立的陣列（擺動彈簧、5 組姿勢權重）改成直接呼叫；無人機 `step()` 的回傳物件與碰撞體 `setTranslation()` 的位置物件改為重複使用；`InstancedAttributes.flush()` 不再每次 `Object.values()`。
- **HUD 更新節流**：`HUD_CONFIG.updateHz = 60`（調參面板「介面/HUD 版面/HUD 更新 Hz」，0 = 每畫面）。高 FPS 時 HUD 元件以 60 Hz 寫 DOM，元件收到累計的 dt（延遲條、訊息倒數速度不變）；重新顯示或重設時立即更新。準星與命中標記仍每畫面更新（散布與命中回饋要即時）。
- **維持現值（量測後決定不改）**：特效池上限（火花 768、曳光 96、彈孔 96、爆炸 8、電漿 32，各 1 個 draw call；低畫質火花與曳光 × 0.5）；陰影範圍 ±45 m、2048（高）／1024（中），關陰影只省約 0.5 ms；各畫質渲染比例 高 1.0／中 0.85／低 0.67。高畫質 1080p 的吞吐量約為 120 FPS 目標的兩倍，沒有理由降低預設畫質。
- **仍有的配置**：three.js 的 uniform 上傳與排序（約 10 KB／畫面）、Rapier JS 綁定（每步建立小物件，約 2.7 KB）、Viewmodel 每 0.25 s 以 JSON 比對槍模描述（開發中即時改槍模用），以及開火、命中時的 Web Audio 節點。都是短命物件，30 s 激烈戰鬥只有 4 次 minor GC（最長 1.1 ms）。不是嚴格的「零配置」，記入 README 已知問題。

### 手感總調校

- **沒有真人實機試玩**：沒有有頭瀏覽器、實體滑鼠與真人試玩者，無法依試玩調整。**定案值 = 目前值（M1-05～M1-15 的設計值），待真人試玩調整**；調參面板與預設組合（F8／F9 錄製重播比較）已就緒。
- **以數據檢查的一致性**（`tests/tuning-defaults.test.ts`）：
  - 每個調參面板欄位的預設值都在滑桿範圍內（移動、鏡頭、viewmodel、武器系統、5 把武器的所有欄位、特效、回饋、靶標、生命、準星、HUD、速度線、後處理、燈光、天空、看板、音效）。發現並修正 1 處：電漿發射器的 `damage.falloffStart`／`falloffEnd` = 1000 m（表示不衰減），但武器面板滑桿上限是 500，一碰滑桿就會被夾成 500、匯出的預設也會跟著改值 → 滑桿上限改為 1000（武器數值不變）。
  - 移動數值的關係：蹲 < 跑 < 衝刺；滑鏟門檻 ≤ 跑速（跑步也能滑鏟）、結束速度 < 門檻；跑牆門檻 ≤ 衝刺速度、結束速度 < 門檻；可爬坡度 ≤ 滑落坡度；跳 1.3 m＋二段跳約 1.1 m＋攀爬 2.0 m > 4 m 牆；Dash 速度（46.7 m/s）> 衝刺、結束速度 < Dash 速度；抓鉤最高速 > 衝刺；噴射上升 < 二段跳速度。全部成立。
  - 5 把武器通過 `validateWeaponDef`；`#demo` 連招在 60／144 FPS 與瀏覽器中終點差 0.000 mm；計時賽路線各段在 M1-15 的無頭模擬中可達。沒有發現「移動技無法完成路線」的問題。
- **最值得試玩時調整的參數**（依前面各計畫的「未驗證」與疑慮排序）：
  1. 抓鉤：`grappleMaxSpeed` 26、`grapplePullAccel` 50、`grappleGravityScale` 0.4、`grappleReleaseDistance` 2.5（斜上方錨點沖過頭約 9 m；低仰角擦地拖行）。
  2. 跑牆與蹬牆跳：`wallRunGravity` 8、`wallRunGravityRampTime` 1.2、`wallRunMaxTime` 1.8、`wallJumpNormalSpeed` 7、`wallJumpUpSpeed` 7.5、`wallJumpLookInfluence` 0.5（連續跑牆需要看向對面牆起跳是否自然）。
  3. 空中與滑鏟：`airControlDegPerSec` 45、`airAccel` 2.5、`slideBoost` 3.5、`slideFriction` 0.8、`slideBoostCooldown` 1.2。
  4. 鏡頭：動態視野（10 → 22 m/s 加到 +8°）、Dash FOV 衝擊 +10°、跑牆傾斜 12°、落地下沉最多 0.12 m、開火與受擊震動（「鏡頭」與各武器 `feel.trauma`／`feel.fovKick`）。
  5. 武器：突擊步槍後座上跳與回正、衝刺轉射擊延遲（0.12–0.25 s）、霰彈散布、手炮後座、狙擊開鏡速度、電漿火箭跳的自推力、開鏡靈敏度倍率。
  6. 無人機：能量球 18 m/s、傷害 15、每架 1.5 s 一發、繞行 12–25 m（「用 Dash、滑鏟、跑牆閃得掉但需要注意」）。
  7. 回饋與 HUD：命中標記大小與時間、傷害數字合併、受擊色差、低生命暗角、HUD 字級。

### 錯誤處理

- **啟動**：`index.html` 內建靜態載入畫面（JS 載入前就顯示，不是白畫面）；主程式一開始設定 `data-sw-boot="loading"`，各階段顯示「初始化物理引擎…」「建立訓練場…」「合成音效…」「預熱著色器…」，完成後移除。每個 `await` 階段經 `runStage()` 轉成帶階段與分類的 `FatalError`，`boot().catch` 顯示錯誤畫面（`data-sw-boot="error"`、`data-sw-error=<分類>`）。音效預渲染與著色器預熱失敗不致命（警告後以靜音／首次繪製時編譯繼續）。
- **WebGL**：建立 renderer 前以 `probeWebGL2()` 偵測（three r187 只支援 WebGL 2；偵測用的 context 立即以 `WEBGL_lose_context` 釋放）；`new WebGLRenderer` 丟例外也歸類為 WebGL。
- **context lost**：暫停遊戲、解除滑鼠鎖定、顯示「3D 繪圖中斷」（等待恢復，也可重試）；遊戲迴圈在中斷期間不執行。瀏覽器恢復時重建環境反射（PMREM 是 GPU 產生的貼圖，內容會遺失）、重新預熱、自動關閉錯誤畫面並提示「畫面已恢復」，回到暫停選單。
- **Rapier**：WebAssembly 初始化失敗顯示「物理引擎載入失敗」；`Physics.init()` 失敗後清掉快取的 Promise，可以重試。
- **遊戲迴圈**：three 的 `setAnimationLoop` 在回呼丟例外時不會排下一個畫面（畫面凍結）。`FrameGuard` 吃掉偶發例外並記錄（每串連續錯誤只記第一個）；連續 3 個畫面出錯才停止迴圈並顯示「遊戲執行時發生錯誤」。
- **檔案載入失敗**：主程式模組或 chunk 下載失敗時主程式根本不會執行，由 `index.html` 的行內看門狗（capture 階段的 `error` 事件）立即顯示「遊戲檔案載入失敗」與重試；30 s 還沒開始執行時提示「載入時間比預期久」。看門狗的文字直接寫在 `index.html`（與字串表的 `boot.loading`、`error.retry` 一致，單元測試檢查）。

### 封面

- `#cover`：容器固定為 800 × 500、渲染倍率 2（以 1600 × 1000 渲染再縮小）、高畫質（直接套用預設，不改玩家設定）、隱藏 HUD／選單／FPS／受擊畫面／調參面板、不鎖定滑鼠、玩家無敵；放到取景位置後以固定步長同步模擬 12 s（`Game.tick`，與畫面更新率無關，新開頁面每次結果相同），讓無人機飛進畫面，再凍結（`timeScale = 0`）。右下角「下載封面」（只在 `#cover`），左下角疊上「碎晶航跡 SHARDWAKE」。
- 取景：無人機戰區南側（腳底 [50, 0, 22]、yaw −40°、pitch 16°、突擊步槍），畫面有 3 架無人機、高塔、全息看板、發光外牆與槍模。比較過出生平台（入口看板與起點環）、跑牆長廊、戰區正面與其他角度後選定（候選截圖未提交）。
- 正式封面 `public/cover.png`：800 × 500、483 KiB，由 `npm run cover`（headless Chrome，實體 GPU）產生；兩次產生的畫面相同（全息看板閃爍有極小差異）。

### 偏離計畫之處與設計決定

- **「Chrome Performance 錄 30 s」改用 CDP 自動化**：沒有有頭瀏覽器可以操作 DevTools，改寫 `npm run perf`：同樣的 Tracing（`devtools.timeline`、`v8.gc`）錄 30 s，加上 Memory 面板等價的取樣式配置剖析（含已回收物件），可重複執行、輸出 JSON。驗收要的「Performance 截圖」以數據表取代。
- **手感總調校沒有依實機試玩**（見上）；只修正數據可證明的問題，任務不勾選。
- **HUD 節流放在 Hud 框架**而不是個別元件：所有 HUD 元件共用，數值在 `HUD_CONFIG.updateHz`（設定資料，面板可調）。
- **錯誤畫面的重試 = 重新載入**：Rapier、WebGL 與大量 GPU 資源都在啟動時建立，原地重建容易留下半初始化的狀態；重新載入 iframe 最可靠，設定與成績都在 localStorage。context lost 是例外：瀏覽器恢復時原地復原（不需要使用者操作）。
- **新增三個開發腳本**（`check:browser`、`perf`、`cover`）只用 Node 內建模組（Node 24 的全域 `WebSocket` 與 `fetch`）與本機瀏覽器，沒有新增套件、沒有下載瀏覽器。
- 計畫沒有要求但順手修正：`Physics.init()` 失敗後無法重試；載入期間是黑畫面（新增靜態載入畫面）。
- `showFps` 預設維持開啟（原型階段方便試玩者回報 FPS）。

### 實際驗證

- 四項檢查：`npm run typecheck` 通過；`npm test` 32 個檔案、661 通過、1 略過（只在 `SHARDWAKE_RECORD_DEMO=1` 時執行的錄製；M1-15 為 30 個檔案、634 通過，本計畫新增 27 項）；`npm run build` 通過；`npm run check:dist` 通過（9 個檔案、6.21 MiB、版本 0.1.0）。
- 單元測試：錯誤分類與 cause 鏈、啟動階段包裝（同步丟出、非同步拒絕、已分類錯誤原樣傳遞、boot 階段的 WebGL 錯誤歸類）、每種分類都有中文標題與說明、`index.html` 字串與字串表一致、WebGL 2 偵測（null、丟例外、成功時釋放 context）、`FrameGuard`（偶發錯誤繼續、連續 3 次致命、致命後不再執行）、HUD 節流（240 FPS 時 60 次更新且 dt 總和不變、hz = 0、dt ≤ 0、flush／reset）、封面設定（800 × 500、夾值、視角換算、疊字版面）、效能回歸（環 `forceSinglePass`、無人機 step 回傳物件重用、instanced flush 範圍）、`game.json`（必填欄位、ID、版本、devices、tags 與長度、操作說明與預設按鍵一致）、調參預設值在面板範圍內、移動數值關係、武器驗證；調參面板關閉時停用監看。
- `npm run check:browser`（headless，實體 GTX 1650）在 **Chrome 158 與 Edge 158 都 10／10 通過**：boot（開始遊玩、HUD、draw call 87、主控台無錯誤、非 `#cover` 沒有下載按鈕）、cover（下載按鈕、HUD 隱藏、800 × 500）、demo（連招完成、終點差 0.000 mm）、iframe（平台模擬頁跨來源 sandbox iframe：`embedded=true`、`crossOriginIsolated=false`、`#demo` 完成、iframe 主控台無錯誤）、nostorage（`localStorage` 丟 SecurityError 時退回記憶體、可遊玩、設定照常套用）、contextlost（「3D 繪圖中斷」並暫停 → 恢復後錯誤畫面消失、繼續繪製、環境反射正常，見截圖）、runtime（連續例外 → 「遊戲執行時發生錯誤」與詳細資訊）、nowebgl（`--disable-3d-apis --disable-webgl` → 「無法使用 3D 繪圖（WebGL 2）」與重試，見截圖）、nowasm（WebAssembly 被封鎖 → 「物理引擎載入失敗」與階段）、loadfail（rapier chunk 下載失敗 → 看門狗「遊戲檔案載入失敗」與重試）。
- `npm run perf` 在 Chrome 與 Edge 各跑 30 s（數據見上）；`npm run cover` 產生正式封面並目視確認。
- 本次啟動的 headless 瀏覽器、靜態伺服器與平台模擬頁都由腳本自行結束，結束後確認沒有殘留的 chrome／msedge／node 程序。

### 未驗證

- **GTX 1650 實際 FPS 與 p99 frame time**：只有 headless 的同步吞吐量（高畫質 1080p 約 244 FPS、p99 4.7 ms）與保留幀率限制時的 CPU 時間（p99 5.6 ms）。有頭瀏覽器的實際遊玩（合成器、vsync、輸入延遲、長時間遊玩、背景程式）沒有量測；Chrome Performance 面板的截圖沒有。內顯低畫質 ≥ 60 FPS 沒有機器可測。
- **真人試玩清單**（README「試玩清單」）：沒有真人以實體滑鼠、有頭瀏覽器試玩，全部未驗證；自動化只覆蓋 #demo 連招、計時賽邏輯、錯誤路徑與 iframe 載入。
- **手感定案**：定案值 = 目前值，沒有依試玩調整（參數清單見上）。
- 錯誤畫面在有頭瀏覽器的觀感、真實驅動程式重設造成的 context lost（自動化以 `WEBGL_lose_context` 模擬）、真實網路中斷（以 CDP Fetch 模擬）、Firefox／Safari。
- 封面在平台列表中的實際呈現（縮圖裁切、與平台標題的搭配）。
- 「下載封面」在實際 Playroom iframe 內是否允許下載（headless 只驗證擷取，沒有觸發下載）。
