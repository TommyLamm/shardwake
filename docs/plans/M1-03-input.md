# M1-03 輸入系統

- 里程碑：M1 手感原型
- 前置：M1-02
- 狀態：未開始

## 目標

做到零額外延遲的滑鼠視角，以及可重新綁定、可錄製、步與步之間不漏按的按鍵輸入。

## 範圍

- 包含：Pointer Lock、滑鼠視角、動作與綁定、每步 `InputFrame`、輸入緩衝工具、最小的「點擊開始」覆蓋層。
- 不含：完整的設定與按鍵配置介面（M1-14）、手把（M5-07）。

## 任務

- [ ] `input/PointerLock.ts`：點擊遊戲畫面時 `requestPointerLock({ unadjustedMovement: true })` 取得原始輸入；不支援時退回一般鎖定，並丟棄單一事件位移異常大的跳動；監聽 `pointerlockchange`／`pointerlockerror`；失去鎖定時通知 `Game` 暫停。Esc 解鎖由瀏覽器控制，Chrome 解鎖後約 1 秒內無法重新鎖定，UI 要顯示「點擊繼續」。
- [ ] `input/Mouse.ts`：累計 `movementX/Y`，在**每個渲染畫面**開頭套用到 yaw／pitch（pitch 夾在 ±89°），不平滑、不加速。靈敏度採 Source／Apex 尺度（每 count 0.022° × 靈敏度），另提供 DPI 欄位換算 cm/360；Y 軸反轉選項。
- [ ] `input/Actions.ts`：動作清單——`moveForward/Back/Left/Right`、`jump`、`crouch`、`dash`、`grapple`、`fire`、`ads`、`reload`、`melee`、`interact`、`weapon1`～`weapon5`、`weaponNext/Prev`、`weaponLast`、`pause`、`debugPanel`、`recordToggle`、`replayToggle`、`restartCourse`，以及只在手動衝刺模式使用的 `sprint`。
- [ ] `input/Bindings.ts`：預設綁定依 `docs/design.md` 的操作表；用 `KeyboardEvent.code` 綁定（不受輸入法與鍵盤配置影響）；支援滑鼠按鍵與滾輪；每個動作最多 2 組綁定；衝突偵測；拒絕瀏覽器保留鍵（F1、F3、F5、F6、F7、F10、F11、F12）；綁定 Ctrl 時提示「Ctrl+W 會關閉分頁」；存在設定中。遊戲不呼叫 `navigator.keyboard.lock()`。
- [ ] `input/InputFrame.ts`：每個 fixed step 產生一份 `InputFrame`：`move {x, y}`（正規化）、`yaw`、`pitch`、`held`、`pressed`（自上一步以來曾按下，兩步之間快速點按也不遺失）、`released` 位元。按住／切換模式（蹲、開鏡、抓鉤）在這一層轉換，下游只看結果。
- [ ] `input/InputBuffer.ts`：通用輸入緩衝（按下後保留到被消耗或逾時），給跳躍緩衝等使用。
- [ ] 遊玩中對遊戲用到的按鍵 `preventDefault`（避免空白鍵捲動、Tab 換焦點）；失焦或暫停時清空按住狀態，避免卡鍵。
- [ ] 最小的「點擊開始」覆蓋層：點擊後鎖定滑鼠；完整選單在 M1-14。

## 交付（給後續計畫）

- `InputFrame`（含 `pressed / held / released`）與 `InputBuffer`。
- 每畫面更新的 `yaw / pitch`，以及給後座力疊加用的視角偏移介面。
- `Bindings`：可存讀，也能查詢動作對應的按鍵名稱（給 HUD 提示用）。

## 驗收

- [ ] 測試：兩步之間按下又放開的鍵，在下一步的 `pressed` 中恰好出現一次；按住／切換模式正確；緩衝逾時後失效。
- [ ] 平台模擬頁（跨來源 sandbox iframe）中：點擊可鎖定滑鼠，Esc 解鎖後進入暫停，再點擊可恢復。
- [ ] 開著中文輸入法時 WASD 仍能操作（記錄實測結果）。
- [ ] 快速甩動滑鼠時，視角沒有跳動或延遲感。

## 實作紀錄

（完成後填寫）
