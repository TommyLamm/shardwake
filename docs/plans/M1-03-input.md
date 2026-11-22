# M1-03 輸入系統

- 里程碑：M1 手感原型
- 前置：M1-02
- 狀態：完成

## 目標

做到零額外延遲的滑鼠視角，以及可重新綁定、可錄製、步與步之間不漏按的按鍵輸入。

## 範圍

- 包含：Pointer Lock、滑鼠視角、動作與綁定、每步 `InputFrame`、輸入緩衝工具、最小的「點擊開始」覆蓋層。
- 不含：完整的設定與按鍵配置介面（M1-14）、手把（M5-07）。

## 任務

- [x] `input/PointerLock.ts`：點擊遊戲畫面時 `requestPointerLock({ unadjustedMovement: true })` 取得原始輸入；不支援時退回一般鎖定，並丟棄單一事件位移異常大的跳動；監聽 `pointerlockchange`／`pointerlockerror`；失去鎖定時通知 `Game` 暫停。Esc 解鎖由瀏覽器控制，Chrome 解鎖後約 1 秒內無法重新鎖定，UI 要顯示「點擊繼續」。
- [x] `input/Mouse.ts`：累計 `movementX/Y`，在**每個渲染畫面**開頭套用到 yaw／pitch（pitch 夾在 ±89°），不平滑、不加速。靈敏度採 Source／Apex 尺度（每 count 0.022° × 靈敏度），另提供 DPI 欄位換算 cm/360；Y 軸反轉選項。
- [x] `input/Actions.ts`：動作清單——`moveForward/Back/Left/Right`、`jump`、`crouch`、`dash`、`grapple`、`fire`、`ads`、`reload`、`melee`、`interact`、`weapon1`～`weapon5`、`weaponNext/Prev`、`weaponLast`、`pause`、`debugPanel`、`recordToggle`、`replayToggle`、`restartCourse`，以及只在手動衝刺模式使用的 `sprint`。
- [x] `input/Bindings.ts`：預設綁定依 `docs/design.md` 的操作表；用 `KeyboardEvent.code` 綁定（不受輸入法與鍵盤配置影響）；支援滑鼠按鍵與滾輪；每個動作最多 2 組綁定；衝突偵測；拒絕瀏覽器保留鍵（F1、F3、F5、F6、F7、F10、F11、F12）；綁定 Ctrl 時提示「Ctrl+W 會關閉分頁」；存在設定中。遊戲不呼叫 `navigator.keyboard.lock()`。
- [x] `input/InputFrame.ts`：每個 fixed step 產生一份 `InputFrame`：`move {x, y}`（正規化）、`yaw`、`pitch`、`held`、`pressed`（自上一步以來曾按下，兩步之間快速點按也不遺失）、`released` 位元。按住／切換模式（蹲、開鏡、抓鉤）在這一層轉換，下游只看結果。
- [x] `input/InputBuffer.ts`：通用輸入緩衝（按下後保留到被消耗或逾時），給跳躍緩衝等使用。
- [x] 遊玩中對遊戲用到的按鍵 `preventDefault`（避免空白鍵捲動、Tab 換焦點）；失焦或暫停時清空按住狀態，避免卡鍵。
- [x] 最小的「點擊開始」覆蓋層：點擊後鎖定滑鼠；完整選單在 M1-14。

## 交付（給後續計畫）

- `InputFrame`（含 `pressed / held / released`）與 `InputBuffer`。
- 每畫面更新的 `yaw / pitch`，以及給後座力疊加用的視角偏移介面。
- `Bindings`：可存讀，也能查詢動作對應的按鍵名稱（給 HUD 提示用）。
- 實際 API 摘要（見實作紀錄）：`InputSystem`（`input.frame`、`input.view`、`input.onAction()`、`input.mouse.scale`）、`isHeld／wasPressed／wasReleased`、`ACTION_BIT`、`InputBuffer.updateFrom(dt, frame, action)`、`ViewAngles.addOffset／setOffset／commitOffset`、`Bindings.labelFor()／bind()`、`PointerLock`、`LockFlow`、`GameSystem.beginFrame()`。

## 驗收

- [x] 測試：兩步之間按下又放開的鍵，在下一步的 `pressed` 中恰好出現一次；按住／切換模式正確；緩衝逾時後失效。
- [x] 平台模擬頁（跨來源 sandbox iframe）中：點擊可鎖定滑鼠，Esc 解鎖後進入暫停，再點擊可恢復。（headless Chrome／Edge + CDP 合成輸入驗證；有頭實機未驗證）
- [ ] 開著中文輸入法時 WASD 仍能操作（記錄實測結果）。（未驗證：headless 無法開輸入法；實作以 `KeyboardEvent.code` 綁定，見實作紀錄）
- [ ] 快速甩動滑鼠時，視角沒有跳動或延遲感。（未驗證：需實體滑鼠與有頭瀏覽器；headless 只確認合成的快速移動後視角為有限值、無異常）

## 實作紀錄

完成日期：2026-11-22。

### 新增／修改檔案

- `src/input/`：`Actions.ts`（27 個動作、位元、中文名稱、即時／可切換標記）、`Bindings.ts`、`InputFrame.ts`（`InputFrame` 與 `InputFrameBuilder`）、`InputBuffer.ts`、`Mouse.ts`（`MouseLook`、`ViewAngles`、`SpikeFilter`、cm/360 換算）、`PointerLock.ts`、`LockFlow.ts`（鎖定與遊戲模式接線）、`Input.ts`（`InputSystem`，Game 系統 order 100）、`config.ts`（`INPUT_CONFIG`）、`index.ts`。
- `src/ui/StartOverlay.ts`：「點擊開始」覆蓋層（文字由純函式 `overlayContent()` 決定）；`style.css` 加覆蓋層樣式。
- `src/core/Game.ts`：新增系統生命週期 `beginFrame()`（每畫面最先呼叫、任何模式、在固定步之前）。`src/core/events.ts`：`input:pointerlock`、`input:bindings`。`src/core/Settings.ts`：新增欄位。
- `src/main.ts`：移除 M1-02 的暫時接線（`.sw-hint` 模式提示、pointerdown 直接開始、Esc keydown），改用 `InputSystem` + `PointerLock` + `LockFlow` + `StartOverlay`；暫時的鏡頭系統每畫面直接套用 `view`（M1-05／M1-08 取代）。
- 測試：`tests/input-frame.test.ts`、`tests/input-bindings-mouse.test.ts`、`tests/input-system.test.ts`（共 71 個新測試；全專案 12 檔、179 測試）。

### 偏離計畫之處與設計決定

- **滑鼠套用時機**：Game 原本每畫面是「固定步 → update → render」，沒有能在固定步之前執行的掛點，所以在 `Game` 加了 `beginFrame()`。滑鼠累計量在這裡一次套用，同一畫面的所有固定步與渲染都看到最新的 yaw／pitch；鏡頭在 render 直接讀 `view`，不插值、不平滑。
- **InputFrame 的 yaw／pitch 是玩家視角，不含後座力偏移**：偏移是模擬狀態（M1-10 在固定步中依開火產生），若寫進 InputFrame，M1-15 重播時會重複套用。最終視角為 `view.viewYaw／viewPitch`（玩家視角＋偏移，pitch 仍夾 ±89°）；偏移介面 `addOffset／setOffset／commitOffset`。
- **角度慣例**：弧度；yaw 0 面向 -Z、正值向左轉；pitch 正值抬頭；yaw 包在 [-π, π)。相機用 `rotation.set(viewPitch, viewYaw, 0, 'YXZ')`。
- **位元遮罩**：`held／pressed／released` 為 32 位元整數，每個動作一個位元（`ACTION_BIT`），動作清單只能在尾端新增。超過 32 個動作時需改成兩個字（M5 前不會發生）。
- **按住／切換**：切換模式下每次實體按下翻轉一次，變成開時 `pressed`、變成關時 `released`，實體放開不產生位元；`builder.setToggle()` 讓下游強制關閉（例如衝刺取消開鏡）。按住期間改模式時補上對應邊緣。兩步之間按下又放開：`pressed` 與 `released` 同步出現一次、`held` 為 0。相反方向鍵同時按住互相抵銷（`move` 為 0）。
- **非遊玩模式**：builder 停用，只記錄實體按住、不產生邊緣也不翻轉切換；恢復遊玩時按住的鍵直接以「按住」接續（不補 `pressed`）。暫停、失焦（blur）、綁定變更時放開所有按鍵；解除滑鼠鎖定時放開滑鼠按鍵。切換狀態在暫停後保留。
- **即時動作**：`pause`、`debugPanel`、`recordToggle`、`replayToggle` 在按下當下由 `input.onAction()` 派送（任何模式），同時仍出現在 InputFrame 位元中。` 鍵改由 `debugPanel` 動作切換（`DebugPanel` 以 `listenKey: false` 建立）。錄製／重播的處理留給 M1-15。
- **綁定存檔**：計畫寫「存在設定中」；設定欄位規格只支援數字／布林／列舉，所以綁定另存 `shardwake:bindings:v1`（格式比照設定 `{ version, values }`，不認識的動作保留並寫回；存檔缺少的新動作補預設值，但跳過已被玩家綁走的鍵；重複代碼依動作清單順序先到先得）。滑鼠按鍵代碼 `Mouse0～Mouse4`、滾輪 `WheelUp／WheelDown`（瞬間輸入）。
- **綁定規則補充**：除 F1、F3、F5、F6、F7、F10、F11、F12 外，`Escape` 只能綁「暫停」（Pointer Lock 解鎖由瀏覽器控制）；綁 Windows 鍵也會回傳警告。衝突時預設拒絕並回報衝突的綁定，`replace: true` 時從原動作搶過來。`sprint` 預設沒有綁定（設計表沒有指定按鍵；手動衝刺模式要由 M1-14 的按鍵設定頁綁定）。
- **新增設定欄位**（`shardwake:settings:v1`，版本不變，舊存檔自動補預設值）：`mouseDpi` 800（100–32000，只用來換算 cm/360）、`invertY` 關、`crouchMode／adsMode／grappleMode` 按住、`autoSprint` 開（給 M1-05）。開鏡靈敏度倍率的設定欄位留給 M1-14，目前提供 `input.mouse.scale` 掛點。
- **Pointer Lock**：優先 `requestPointerLock({ unadjustedMovement: true })`；`NotSupportedError`／`TypeError` 時退回一般鎖定並啟用跳動過濾；不回傳 Promise 的舊版 API 等 `pointerlockchange`。新版 API 的錯誤只由 Promise 回報（Chrome reject 後還會發 `pointerlockerror`，避免重複）。鎖定成功才開始／恢復遊戲；鎖定被拒時維持原模式並顯示「無法鎖定滑鼠，請再點擊一次」。
- **跳動過濾**：一般鎖定時，單一事件位移超過 `spikeThreshold`（400 count）且前一事件小於門檻的 25% 才丟棄，連續快速甩動不受影響；原始輸入預設不過濾。
- **調參面板與鎖定**：開面板時解除鎖定但**不暫停**（可邊看邊調、用鍵盤操作），畫面下方顯示「點擊畫面恢復滑鼠視角」；點擊畫面重新鎖定（面板仍顯示），用 ` 關閉面板時嘗試重新鎖定。
- **preventDefault**：遊玩中攔下綁定鍵與 Tab、Space、方向鍵、Alt、'、/（Firefox 快速搜尋）、Backspace、選單鍵；不攔 Esc 與瀏覽器保留的 F 鍵。滑鼠鎖定中攔下 mousedown／mouseup（側鍵不觸發上一頁）、滾輪（不會串到平台頁捲動）、右鍵選單。輸入框內的按鍵不當成遊戲輸入。
- **滾輪**：累積到 `wheelNotchPx`（50 px）才算一格，超過 250 ms 沒事件或換方向時清空；行／頁模式換算 40 px／800 px。
- **開發旗標 `#nolock`**：不鎖定滑鼠，點擊直接開始／恢復（沒有滑鼠視角），給開發者工具除錯與自動化測試用。`#debug` 時 `window.__shardwake` 另加 `input`、`bindings`、`pointerLock`、`lockFlow`。
- 調參面板新增「輸入」資料夾：滑鼠（每 count 角度、pitch 上限、原始輸入、跳動門檻與比例）、滾輪與鎖定，以及監看（已鎖定、原始輸入、yaw／pitch、cm/360、移動、按住的動作、丟棄的跳動數）。玩家設定欄位會自動出現在「設定」資料夾。
- `<html>` 新增 `data-sw-locked`、`data-sw-overlay`（full／hint／hidden）供自動化測試。

### 調整過的數值

- `INPUT_CONFIG`：每 count 0.022°、pitch ±89°、跳動門檻 400 count／連續比例 0.25、滾輪一格 50 px／行 40 px／頁 800 px／重設 250 ms、重新鎖定冷卻提示 1100 ms。
- 預設靈敏度維持 M1-02 的 2（800 DPI 約 26 cm/360）。

### 實際驗證

- `npm run typecheck`、`npm test`（12 檔、179 測試）、`npm run build`、`npm run check:dist`（9 個檔案、5.11 MiB）全部通過。
- headless Chrome 與 Edge（SwiftShader）以 CDP 連 `npm run sim` 的平台頁，18 項檢查兩個瀏覽器都通過：跨來源 OOPIF；標題覆蓋層顯示「點擊開始」與目前綁定的操作說明；合成點擊後**取得滑鼠鎖定且為原始輸入**（`rawInput = true`）並進入 playing、覆蓋層隱藏；鎖定中合成滑鼠右移 → yaw 減少；按住 W → `move = (0, 1)`、放開歸零；空白鍵 `defaultPrevented`；` 開面板 → 解鎖、維持 playing、顯示恢復提示；再按 ` → 重新鎖定；Esc → 瀏覽器解鎖、以 `pointerlock` 原因暫停並顯示「點擊繼續」；解鎖後立刻點擊被 Chrome 拒絕（`SecurityError: Pointer lock cannot be acquired immediately after the user has exited the lock.`），覆蓋層顯示「請再點擊一次」，1.5 秒後再點擊恢復遊玩；40 次來回大幅移動後視角仍正常；合成 blur → 暫停並放開按住的鍵。截圖確認標題覆蓋層與面板開啟時的提示。
- 主控台只有預期的冷卻警告（`滑鼠鎖定失敗：SecurityError…`）與 Rapier 初始化訊息，無錯誤或例外。

### 未驗證

- 開著中文（注音／拼音）輸入法時 WASD 是否可操作：headless 無法開輸入法。實作以 `KeyboardEvent.code` 綁定，畫面上沒有可編輯元素，預期不受影響，需實機確認。
- 實體滑鼠快速甩動的跳動與延遲感、原始輸入與系統滑鼠加速的差異、高 DPI／高回報率滑鼠、Windows 顯示縮放對一般鎖定 `movementX` 的影響。
- 平台原生全螢幕（頂層 Keyboard Lock 鎖定 Escape）時短按 Esc 的行為：預期鎖定中由瀏覽器解鎖→暫停、未鎖定時 Esc 送到遊戲→暫停，但 headless 無法進入原生全螢幕。
- Firefox／Safari（`unadjustedMovement` 不支援時的退回路徑只有單元測試）、滑鼠側鍵不觸發上一頁、Windows 相黏鍵（連按 Shift 5 次）提示。
