# M1-02 核心執行框架

- 里程碑：M1 手感原型
- 前置：M1-01
- 狀態：未開始

## 目標

建立主迴圈與共用基礎設施，之後所有系統都掛在上面：固定步長模擬、事件、物件池、數學工具、儲存、設定、視窗尺寸處理、調參面板外殼。

## 範圍

- 包含：`src/core/`、`src/debug/` 的基礎模組與測試。
- 不含：輸入（M1-03）、物理（M1-04）、選單介面（M1-14）。

## 任務

- [ ] `core/Game.ts`：模式狀態機 `boot → title → playing ⇄ paused`；系統以 `init / fixedUpdate(dt) / update(dt) / render(alpha) / dispose` 生命週期註冊，執行順序固定並寫在程式碼註解。
- [ ] `core/FixedLoop.ts`：預設 120 Hz（可設定）、累加器與插值 `alpha`；單一畫面 dt 上限 0.1 s（切分頁回來不爆衝）；每畫面最多 8 步（防死亡螺旋）；`timeScale`（慢動作）。純邏輯、可單元測試，由 `renderer.setAnimationLoop` 驅動。
- [ ] `core/events.ts` + `core/EventBus.ts`：型別安全的事件表（`emit / on / off / once`），發出時同步派送；事件型別集中在一個檔案，之後每份計畫往裡面加。
- [ ] `core/Pool.ts`：泛型物件池（`acquire / release`、上限、用盡時的策略：回收最舊或拒絕）。
- [ ] `core/math.ts`：`damp`（與 dt 無關的指數平滑）、臨界阻尼彈簧 `SpringScalar`／`SpringVec3`（以 dt 穩定積分，大 dt 不發散）、`lerpAngle`、1D／2D 值雜訊（震動用）。
- [ ] `core/Rng.ts`：可重現的亂數（mulberry32 或 xoshiro128**），支援 `int / float / range / pick / weighted`。
- [ ] `core/tmp.ts`：暫存向量與四元數，讓熱迴圈不配置記憶體。
- [ ] `core/Storage.ts`：包裝 `localStorage`，key 一律加 `shardwake:` 前綴；讀寫丟例外或 JSON 解析失敗時退回記憶體儲存，並提供 `isPersistent` 給 UI 顯示「目前無法存檔」。
- [ ] `core/Settings.ts`：設定的型別、預設值、版本遷移、存讀（`shardwake:settings:v1`）、變更事件。先放基本欄位（靈敏度、FOV、音量、畫質、顯示 FPS），其他計畫再擴充。
- [ ] `core/Viewport.ts`：用 `ResizeObserver` 追蹤遊戲容器（iframe 內）的尺寸，更新 renderer 與相機比例；`devicePixelRatio` 上限預設 1，渲染比例由畫質設定決定。平台切換顯示模式不會重載 iframe，必須正確處理尺寸變化。
- [ ] `core/Lifecycle.ts`：`visibilitychange`／`blur` 時自動暫停；偵測是否嵌入 iframe（`window.self !== window.top`，不讀取 top 的任何屬性），供 UI 決定要不要顯示自己的全螢幕按鈕。
- [ ] `debug/DebugPanel.ts`：Tweakpane 外殼，按 `` ` `` 或網址 `#debug` 開啟；FPS 圖與 `renderer.info`（draw call、三角形、幾何、貼圖數）；提供 `bindConfig(folderName, obj, schema)`，讓之後的系統註冊可調參數（範圍、步進、說明）。
- [ ] `debug/Stats.ts`：畫面角落的 FPS／frame time，由設定開關。

## 交付（給後續計畫）

- `Game` 系統註冊與生命週期、`FixedLoop`（`alpha`、`timeScale`）。
- `EventBus` 與 `core/events.ts`。
- `SpringScalar`／`SpringVec3`、`damp`、雜訊、`Rng`、`Pool`、暫存向量。
- `Storage`（前綴與退回機制）、`Settings`（可擴充）。
- `DebugPanel.bindConfig()`。

## 驗收

- [ ] 測試：模擬 60／144／240 Hz 的畫面時間序列，相同總時間得到相同步數與相同狀態；dt 上限與每畫面步數上限有效。
- [ ] 測試：彈簧在 dt = 1/30 與 1/240 下收斂結果一致且不發散；`Rng` 相同種子序列一致；`localStorage` 丟例外時 `Storage` 仍可讀寫（記憶體）。
- [ ] 平台模擬頁中切換 iframe 尺寸與顯示模式，畫面比例正確、不拉伸、不重載。
- [ ] 切分頁 30 秒再回來，不會瞬移或卡死。

## 實作紀錄

（完成後填寫）
