# M1-14 HUD、選單與設定

- 里程碑：M1 手感原型
- 前置：M1-07、M1-12
- 狀態：完成

## 目標

完成繁體中文的 HUD、開始畫面、暫停選單、設定與按鍵配置；開始、遊玩、結束、重新開始都能在平台 iframe 內完成。

## 範圍

- 包含：i18n、HUD 版面、開始畫面、暫停選單、設定頁、按鍵配置、全螢幕按鈕規則、iframe 顯示模式驗證。
- 不含：背包介面（M2-05）、任務介面（M4）。

## 任務

- [x] `i18n/zh-TW.ts`：所有介面字串集中管理，提供 `t(key, params)`；之後可以加其他語系。
- [x] HUD（DOM + CSS，`ui/HUD.ts`）：
  - 中央：準星、命中標記、「可勾取」提示。
  - 左下：護盾／生命條（含受擊延遲條）、Dash 充能格、噴射燃料條、抓鉤冷卻環。
  - 右下：武器名、彈匣／備彈、射擊模式。
  - 上方：計時器（跑酷用）、提示訊息佇列。
  - HUD 只讀取狀態與事件，不持有遊戲邏輯；依 iframe 短邊縮放，1280 × 720 到 3440 × 1440 都清楚；只在數值改變時更新 DOM。
- [x] 開始畫面：遊戲名稱、「點擊開始」（同時鎖定滑鼠並啟用音效）、設定、操作說明。
- [x] 暫停選單（Esc 或失去滑鼠鎖定時）：繼續、設定、按鍵配置、重置位置、重新開始訓練、返回標題。平台全螢幕下短按 Esc 會送到遊戲；Pointer Lock 的退出由瀏覽器處理。兩種情況都要正確進入暫停，而且不會重複切換。
- [x] 設定頁籤：
  - 控制：靈敏度（Source 尺度，附 DPI 欄位與 cm/360 顯示）、開鏡靈敏度倍率、Y 軸反轉、自動衝刺、蹲／開鏡／抓鉤用按住或切換。
  - 畫面：FOV（水平）、畫質預設、渲染比例、陰影、Bloom、顯示 FPS。
  - 鏡頭：震動強度、頭部晃動、動態 FOV、速度線、鏡頭傾斜強度。
  - 音效：主音量、音效、介面（音樂在 M5-06 加入）。
  - 「恢復預設」；設定即時套用並存檔；儲存不可用時顯示提示，但照常運作。
- [x] 按鍵配置頁：每個動作兩欄綁定、點擊後按下新的鍵或滑鼠鍵、衝突提示、拒絕保留鍵、Ctrl 警告、恢復預設。
- [x] 全螢幕按鈕：只在沒有嵌入 iframe 時顯示，由玩家點擊觸發；嵌入平台時交給平台的全螢幕。
- [x] 視覺：未來科技風格（細線框、斜角、青色主色、等寬數字）；動畫只用 CSS transform／opacity，避免版面重排。

## 交付（給後續計畫）

- HUD 元件框架（新增元件只需訂閱狀態），以及選單與頁籤框架（M2-05 背包、M4 的終端介面沿用）。
- `t()` 與字串表。

## 驗收

- [x] 平台模擬頁中切換一般、原生全螢幕、沉浸（填滿視窗）三種模式：HUD 與選單位置正確、遊戲狀態保留、不重載。（headless Chrome 以 CDP 驗證：暫停中切換三種模式與 iframe 尺寸，選單面板與 HUD 元件都在 iframe 內、模式維持 paused、`window` 上的標記保留（沒有重載）、縮放變數隨尺寸更新；有頭瀏覽器的實際觀感未驗證）
- [x] 「開始 → 遊玩 → 暫停 → 返回標題 → 重新開始」全流程可以在 iframe 內完成。（headless Chrome 跨來源 OOPIF，含真實滑鼠鎖定）
- [x] 所有設定在重新整理後保留；模擬 `localStorage` 不可用時仍可遊玩。
- [x] 1280 × 720 與 2560 × 1440 的截圖存入 `docs/screenshots/`。（`M1-14-hud-1280x720.png`、`M1-14-hud-2560x1440.png`（縮成一半存檔）、`M1-14-title.png`、`M1-14-settings.png`、`M1-14-controls.png`；可讀性未經真人確認）

## 實作紀錄

完成日期：2026-11-28。

### 新增／修改檔案

- 新增 `src/i18n/zh-TW.ts`（字串表 `ZH_TW`、`StringKey`）；`src/i18n/index.ts` 改為 `t(key, params)`、`tDynamic(key, fallback?)`、`formatString`、`hasKey`、`registerLocale`、`setLocale`、`getLocale`。
- 新增 HUD：`src/ui/Hud.ts`（框架）、`src/ui/HudConfig.ts`（`HUD_CONFIG` 與面板規格）、`src/ui/hudMath.ts`（純邏輯）、`src/ui/dom.ts`（`h()`、`svg()`、只在值改變時寫入的 `TextSlot`／`VisibleSlot`／`ClassSlot`／`DataSlot`／`StyleSlot`／`scaleXSlot`）、`src/ui/hud/VitalsWidget.ts`、`AbilitiesWidget.ts`、`WeaponWidget.ts`、`InfoWidgets.ts`（`GrappleHintWidget`、`TimerWidget`、`MessagesWidget`、`TextWidget`）、`src/ui/hud.css`。
- 新增選單：`src/ui/menu/Menu.ts`（框架）、`MenuNav.ts`（導覽狀態機）、`parts.ts`（按鈕、標頭、提示、頁籤）、`screens.ts`（`TitleScreen`、`PauseScreen`、`HelpScreen`、`MenuActions`）、`SettingsScreen.ts`、`settingsPages.ts`、`ControlsScreen.ts`、`rebind.ts`（`RebindSession`）、`menuStatus.ts`（取代 `StartOverlay.overlayContent`）、`src/ui/fullscreen.ts`、`src/ui/menu.css`。
- 刪除 `src/ui/StartOverlay.ts`（`style.css` 的 `.sw-overlay*` 樣式一併移除）。
- 修改：`src/main.ts`（HUD、選單、訓練場重設、暫停鍵接線、畫質覆寫、調參面板「介面」）、`src/core/Settings.ts`（新欄位 `renderScale`／`shadows`／`bloom`、`QUALITY_SETTING_KEYS`、`qualityPreset` 套用覆寫、`persistent`）、`src/core/quality.ts`（`effectiveQuality`、`RENDER_SCALE_OPTIONS`、`QUALITY_TOGGLES`）、`src/ui/index.ts`、`src/style.css`、`index.html`（`<link rel="icon" href="data:,">`，避免 favicon 404 出現在主控台）。
- 測試：新增 `tests/hud-menus.test.ts`（39 項）；`tests/input-system.test.ts` 的覆蓋層測試改測 `menuStatus`／`controlsRows`。全專案 27 檔、602 測試。沒有新增套件。

### 實際 API 摘要（給後續計畫）

- **i18n**：`t('hud.grappleReady', { key: 'F' })`；新字串加在 `ZH_TW`（key 為「區域.名稱」）。設定項目 `setting.<key>`／`settingHint.<key>`、動作 `action.<Action>`、選項 `option.<value>` 由測試檢查齊全。其他語系 `registerLocale('en', partial)` + `setLocale('en')`，缺的 key 回退繁中；切語系後選單需重建（目前只有繁中）。按鍵名稱（`keyName`）與 `Bindings.labelFor` 的「未綁定」仍在 `input/Bindings.ts`。
- **HUD（M1-15、M2、M3、M4 加元件）**：`hud = new Hud({ container, config })`（Game 系統 `hud`，order ui）。`hud.add(widget)`；`HudWidget { id, anchor, root, order?, update(frame), reset?, layout?, dispose? }`，錨點 `top | topLeft | topRight | bottomLeft | bottomCenter | bottomRight | center`（topLeft 目前被 FPS 顯示佔用）。`frame = { realDt, dt, mode, scale }`。元件只讀 getter 傳入的狀態，用 `ui/dom.ts` 的 Slot 只在值改變時寫 DOM。快速加一行文字：`hud.add(new TextWidget({ id, anchor, read: () => string | null }))`。`hud.setHidden(reason, bool)`（M1-16 的 `#cover` 用 `hud.setHidden('cover', true)`）、`hud.reset()`（重新開始時清延遲條與訊息）、`hud.layout(w, h)`、`hud.root`（全畫面層，準星與命中標記掛在這裡）、`hud.get(id)`。
- **計時器（M1-15 計時賽）**：`hudTimer.state`（`TimerState { visible, time, running, best, splits: { label, time, delta }[] }`）直接寫入即可，HUD 每畫面讀取；格式化 `formatTimer`、`formatDelta`。`restartCourse` 動作（T）由 M1-15 接。
- **提示訊息**：`hudMessages.push(text, { key?, duration?, tone?: 'info' | 'good' | 'warn' })`，同 key 合併。
- **選單（M2-05 背包、M4 終端、M5-07）**：`menu.register(screen)`，`MenuScreen { id, build(menu), onShow?, onHide?, update?(realDt), handleKey?(e) → boolean, backdropAction?, dispose? }`；`menu.open(id)`（push 子畫面）、`menu.back()`、`menu.nav`（`MenuNav`：`syncMode(mode)`、`push`、`back`、`backToRoot`、`current`、`atRoot`、`onChange`）、`menu.sound('ui.click' …)`、`menu.status`。根畫面目前由遊戲模式決定（title／paused）；背包若要在遊玩中開啟，需在 `MenuNav` 加一個「覆蓋根畫面」（例如 `openOverlay('inventory')`，同時暫停並解除鎖定），M2-05 擴充。共用元件 `button(label, onClick, { variant, sound, autofocus })`、`screenHeader(title, onBack)`、`NotesView`、`Tabs`。鍵盤：選單開啟時 Menu 在 window capture 階段先處理 keydown（`handleKey` → Esc 返回），被處理的鍵不會送到輸入系統。M5-07 的手把焦點導覽可接在 `handleKey` 與按鈕焦點上。
- **設定頁**：頁籤與項目資料在 `SETTINGS_PAGES`（`{ id, labelKey, items: { key, format?, control?, extra? }[] }`），新設定加進其中一頁（或 `HIDDEN_SETTINGS`）；`settingsScreen.showPage(id)`。純函式 `formatSettingValue`、`inputText`、`parseSettingInput`、`snapToStep`、`controlKind`、`optionLabel`。M5-06 加音樂時把 `musicVolume` 從 `HIDDEN_SETTINGS` 移到音效頁。
- **按鍵配置**：`RebindSession`（`start(action, slot)`、`input(code)`、`confirmReplace()`、`cancel()`、`phase`、`feedback`），UI 在 `ControlsScreen`（`controlsScreen.session`）。
- **全螢幕**：`FullscreenControl({ embedded })`：`available`、`active`、`toggle()`、`onChange`；`fullscreenButtonVisible(embedded, enabled, hasApi)`。
- **訓練場重設**（main.ts）：`menuActions.start／resume／resetPosition／restartTraining／toTitle`；`#debug` 時 `window.__shardwake` 另有 `hud`、`hudTimer`、`hudMessages`、`menu`、`menuActions`、`settingsScreen`、`controlsScreen`、`fullscreen`。`<html data-sw-menu>` 為目前畫面 id（或 none），`data-sw-overlay` 為 full／hint／hidden。

### 偏離計畫之處與設計決定

- **計畫的「渲染比例、陰影、Bloom」**：原本只有畫質預設（`quality`）。新增三個設定欄位作為覆寫：`renderScale`（`auto`／`0.5`／`0.67`／`0.75`／`0.85`／`1`）、`shadows`、`bloom`（`auto`／`off`／`on`），預設 `auto` = 跟隨畫質；`effectiveQuality()` 合成，`settings.qualityPreset` 與 main 的套用改用它。`shardwake:settings:v1` 版本不變，舊存檔補 `auto`（測試涵蓋）。
- **設定頁籤**：計畫的控制／畫面／鏡頭／音效之外，多一個「回饋」頁放 M1-12 的命中標記、傷害數字、合併傷害數字、訓練無人機。「鏡頭」頁另含落地下沉與畫面色差。音樂音量不顯示（M5-06）。「恢復預設」只重設目前頁籤。數字設定是滑桿 + 輸入框（可輸入 80%、103°、全形數字、逗號小數點），DPI 只有輸入框；靈敏度旁顯示 cm/360。
- **暫停選單與 Esc**：Esc 由瀏覽器解除鎖定 → 暫停（原因 pointerlock）；Esc 送到遊戲時由暫停鍵暫停並解除鎖定（`expectingUnlock` 不會再暫停一次）。選單開啟後 Esc 只做「返回上一層」，在根畫面不動作，所以不會重複切換；也因為 Esc 不算使用者手勢、無法重新鎖定滑鼠，Esc 不會從暫停直接繼續。改綁的暫停鍵在選單中也是返回。
- **繼續／開始**：點擊「繼續」「點擊開始」按鈕，或點擊根畫面的背景（面板以外）。標題與暫停都在點擊事件中請求滑鼠鎖定（取代 M1-03「點擊畫面任何地方」的行為；遊玩中開過調參面板時，點擊畫面重新鎖定的行為保留）。
- **重置位置** = 傳送到離目前位置最近的檢查點（沒有時出生點）後繼續；**重新開始訓練** = 出生點、護盾生命回滿、靶標與無人機重設、DPS 計歸零、彈匣補滿並切回 1 號武器、清特效與 HUD 暫存後繼續；**返回標題**後自動做同樣的重設，所以再開始是新的一局。沒有確認對話框（M1 沒有進度會遺失）。
- **介面音效**：滑過按鈕 `ui.hover`、點擊 `ui.click`、返回 `ui.back`、綁定成功 `ui.confirm`；開始與繼續不另外出聲，沿用 M1-13 綁定在 `game:mode` 的 `ui.confirm`（沒有移除，避免重複）。
- **按鍵配置**：Esc 取消等待（所以不能用這個流程把 Esc 綁給其他動作——本來就只能給暫停），Backspace 清除該欄（Backspace 因此不能綁定）。衝突時顯示原動作，「取代」或再按一次同一個鍵搶過來；按其他鍵重新判斷。滑鼠左鍵綁定後吞掉緊接的 click，右鍵綁定後擋下右鍵選單。列出全部 27 個動作（含開發用）。
- **HUD 縮放**：短邊 / 1080，範圍 0.72–1.8（720p 為 0.72 而非 0.67，小畫面字太小）；超寬螢幕的安全區寬度 ≤ 高度 × 2.1，3440 × 1440 時左右元件各往內收約 250 px。選單縮放範圍 0.8–1.6。
- **自動聚焦**：只在玩家剛操作過時（`navigator.userActivation.isActive`）聚焦選單的第一個按鈕；跨來源 iframe 內沒有使用者操作時呼叫 `focus()` 會在主控台出現 Permissions policy 錯誤（平台模擬頁實測發現）。選單關閉時移除焦點，避免遊玩中 Space 觸發隱藏的按鈕。
- **顯示 FPS** 預設仍為開（M1 調校階段，正式預設留給 M1-16）。
- **i18n 範圍**：選單、HUD、設定、按鍵配置的字串都在字串表；`SETTINGS_SCHEMA` 的 `label`／`optionLabels` 與 `ACTION_INFO.label` 保留給調參面板，測試確認動作名稱與字串表一致。

### 調整過的數值

- 計畫未指定、由本計畫決定（都在 `HUD_CONFIG`，調參面板「介面」可調，不存檔）：參考短邊 1080、HUD 縮放 0.72–1.8、安全區最大寬高比 2.1、邊距 32 px；受擊延遲條等待 0.45 s、追上速度每秒 0.9 條；低生命警示 40%（與 M1-12 暗角相同）；低彈藥 25%；燃料滿 1.5 s 後淡出燃料條；抓鉤環半徑 15 px；提示訊息 2.4 s、淡出 0.35 s、最多 3 則；開始後「按 Esc 暫停」提示 4 s。

### 實際驗證

- `npm run typecheck`、`npm test`（27 檔、602 測試）、`npm run build`、`npm run check:dist`（9 個檔案、5.79 MiB）全部通過。
- 單元測試：i18n（參數、回退、語系切換、字串表齊全）；HUD 縮放（720p／1080p／1440p／3440 × 1440／直立／不合法尺寸）、格式化（彈藥、∞、計時器、分段差、距離）、彈藥警示、冷卻環、Dash 充能格、受擊延遲條（等待、追上、連續受擊、回復、暫停）、訊息佇列；選單導覽（根畫面與堆疊、Esc 在根畫面不重複切換、模式往返）；按鍵重新綁定（綁定並存檔、重新讀取、次要欄、滑鼠鍵與滾輪、衝突與取代、取消、保留鍵、清除、Ctrl／Windows 警告、恢復預設、舊存檔）；設定頁（每個欄位都有頁籤、控制項種類、格式與解析、選項文字、存檔後重新讀取、恢復預設只重設該頁、儲存不可用）；畫質覆寫（舊存檔補值、合成結果）；全螢幕按鈕（嵌入時隱藏、切換、失敗）。
- headless Chrome 158 以 CDP 開 `vite preview` 的 `#debug&nolock`，43 項檢查全部通過：標題畫面、HUD 在標題隱藏、全螢幕按鈕（未嵌入）；開始後 6 個 HUD 元件、武器名／32／∞／全自動、暫停提示；受擊 130 → 護盾 0、生命 70、延遲條停留；Dash 後充能格 1/2；彈匣打空顯示紅色 0 與換彈；Esc 暫停、再按 Esc 不切換；設定改 FOV 110、陰影關、渲染比例 85% 即時存進 `shardwake:settings:v1` 並套用到 Viewport；靈敏度滑桿與 cm/360；恢復預設只重設音效頁；按鍵配置：F5 被拒絕、W 衝突提示「前進」、Esc 取消、J 綁定並存進 `shardwake:bindings:v1`、滑鼠右鍵衝突後「取代」、Ctrl 警告、全部恢復預設；操作說明顯示新綁定；繼續後按 J 會跳；重新開始訓練回出生點並回滿；返回標題、點背景再開始；1280 × 720 → 2560 × 1440 HUD 縮放 0.72 → 1.33 且元件都在畫面內；3440 × 1440 安全區收窄；重新整理後設定與綁定保留；不加 `#nolock` 時點擊開始可進入遊玩；`localStorage` 丟例外時顯示「無法存檔」、仍可遊玩、設定照常套用；主控台沒有錯誤（只有預期的 localStorage 警告）。
- 平台模擬頁（`npm run sim`，跨來源 sandbox iframe、OOPIF）17 項中 16 項通過：iframe 內標題、不顯示自己的全螢幕按鈕、點擊開始並真的鎖定滑鼠、HUD 顯示、解除鎖定 → 暫停、暫停 → 設定 → Esc 返回；暫停中切換沉浸（960 × 540 → 1600 × 1000）、原生全螢幕、回到一般：選單面板都在 iframe 內、模式保持 paused、沒有重載、縮放變數更新；繼續、HUD 元件在 iframe 內、再次暫停、返回標題、重新開始；iframe 主控台沒有錯誤。唯一未過的是測試本身的假設：960 × 540 與 1280 × 720 的 HUD 縮放都夾在下限 0.72，所以數值相同（尺寸本身有正確更新）。
- 截圖：`docs/screenshots/M1-14-{title,hud-1280x720,hud-2560x1440,settings,controls}.png`（每通道 16 階，139–289 KB；2560 × 1440 縮成一半存檔）。
- 結束後確認自己啟動的 vite preview、平台模擬伺服器與 headless Chrome 都已關閉、暫存設定檔已刪除。

### 未驗證

- **可讀性與觀感**：沒有真人在實體螢幕看過 1280 × 720 到 3440 × 1440 的 HUD 與選單；字級、對比、斜角線框在亮背景上的清楚程度只看過 headless 截圖。
- **實機操作感**：沒有真人用實體滑鼠與鍵盤操作選單、重新綁定、滑桿；Esc 在有頭瀏覽器（一般、平台全螢幕）下解除鎖定與暫停的實際行為只在 headless 以 `exitPointerLock()` 與合成按鍵模擬；Chrome 解鎖後約 1 秒的重新鎖定冷卻在實機的提示是否清楚未確認。
- **原生全螢幕**：headless 下平台頁的 `requestFullscreen` 結果無法目視確認（iframe 尺寸與選單位置有檢查）；遊戲自己的全螢幕按鈕（未嵌入時）只有單元測試與按鈕顯示檢查，沒有實際進入全螢幕。
- **Edge、Firefox** 與 `<select>` 下拉、範圍滑桿的外觀未測。
- **效能**：HUD 每畫面只在值改變時寫 DOM，但沒有在實體 GPU 上量測 HUD 與選單開啟時的 frame time（留給 M1-16）。