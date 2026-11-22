# M1-05 移動 I：地面、空中、跳躍、蹲、滑鏟 ★

- 里程碑：M1 手感原型
- 前置：M1-03、M1-04
- 狀態：完成
- 檢查點：★ 完成後可以在灰盒場地試玩基本移動

## 目標

建立玩家控制器骨架與基礎移動。手感要做到：放開就停、起步即達速、跳躍俐落、滑鏟有爆發力。

## 範圍

- 包含：MovementConfig、PlayerController 與狀態機、地面／空中／跳躍／蹲／滑鏟、重生、調參面板綁定、無頭測試。
- 不含：跑牆與攀爬（M1-06）、二段跳／噴射／Dash／抓鉤（M1-07）、鏡頭效果（M1-08）。

## 任務

- [x] `player/MovementConfig.ts`：所有移動參數、預設值與說明文字（給調參面板，`MOVEMENT_PANEL`）；之後的計畫在同一個檔案擴充。
- [x] `player/PlayerController.ts`：
  - 膠囊體：站姿高 1.8 m、蹲姿 1.0 m、半徑 0.35 m；眼高 1.65／0.95 m。
  - Rapier `KinematicCharacterController`：offset 0.01、autostep 0.35 m、最大爬坡 50°、最小下滑坡 55°；貼地 0.3 m 改由控制器自己做（Rapier 內建 snapToGround 在平地會抖動並偶爾卡住一步，見實作紀錄）。
  - 速度自己維護：每步算期望位移 → `computeColliderMovement` → 依實際碰撞法線把速度投影（撞牆不累積速度、沿牆滑行；法線以射線修正、只投影真的被擋住的分量）。
  - 地面探測：向下 shape cast，取得地面法線與表面材質（坡度加速與腳步聲用）。
  - 狀態機：`Ground`、`Air`、`Slide`（後續計畫再加 `WallRun`、`Mantle`、`Dash`、`Grapple`）；每個狀態有 `enter / step / exit`，轉換規則集中管理；**切換狀態永不硬性歸零速度**。
  - 輸出 `PlayerState`（位置、上一步位置〔插值用〕、速度、狀態、是否著地、眼高），以及事件 `jump`、`land { impactSpeed }`、`slideStart`、`slideEnd`、`crouch`、`footstep { surface }`、`respawn`。
- [x] 地面移動（Source 式 `accelerate(wishDir, wishSpeed, accel)` ＋ `friction(stopSpeed, friction)`）：
  - 跑 7.5 m/s；**自動衝刺**：輸入方向在正前方 ±50° 內時 10.5 m/s，開火或開鏡時降回跑速；設定可關閉，改用手動衝刺鍵。
  - 蹲走 3.5 m/s；加速 12、摩擦 6、stopSpeed 4（原訂 2，放開後停不到 0.35 s，見實作紀錄）。
  - 落地後 1 步內不套摩擦，保留連跳動量（可調）。
- [x] 跳躍：高度 1.3 m（由高度與重力反推初速）、重力 24 m/s²；土狼時間 0.12 s；跳躍緩衝 0.15 s（用 M1-03 的 `InputBuffer`）；在斜坡上沿地面法線與正上方混合的方向起跳（比例可調）。
- [x] 空中：Quake 式 air strafe（空中加速 2.5、wishSpeed 上限 1.2 m/s）＋ air control（每秒把水平速度往輸入方向旋轉若干度，不增速）；水平速度超過 22 m/s 時，對超出部分施加 2 /s 阻力。
- [x] 蹲下：按住或切換（設定）；膠囊高度 0.12 s 平滑過渡；起身前用 `overlap` 檢查頭頂空間，不夠就維持蹲姿。
- [x] 滑鏟：
  - 進入：在地面、速度 ≥ 7 m/s 時按蹲；空中按住蹲、落地時速度足夠也直接接滑鏟。
  - 推進 +3.5 m/s（推進後最多 15 m/s），推進冷卻 1.2 s（冷卻中只滑不加速）；摩擦 0.8（順坡下滑時 × 0.25）；坡度加速 = 重力沿坡面分量 × 1.0；轉向速率 90°/s。
  - 結束：速度 < 4.5 m/s，或在按住模式下放開蹲；滑鏟中跳躍保留水平動量。
- [x] 重生：碰到 `killVolume` 回到最近檢查點，速度歸零並發出 `respawn`。
- [x] 相機暫時直接放在插值後的眼高位置，加上 M1-03 的 yaw／pitch；正式鏡頭效果在 M1-08。
- [x] 調參面板「移動」資料夾：綁定所有參數；監看速度曲線圖、目前狀態、是否著地、地面法線。

## 交付（給後續計畫）

- `PlayerController` 與可擴充的狀態機（新增狀態只需註冊狀態與轉換規則）。
- `MovementConfig`、`PlayerState`、移動事件。
- `tests/helpers/` 的無頭測試工具：建立 Rapier 世界、放置幾何、以腳本輸入逐步模擬。

## 驗收

`tests/movement.test.ts`（Rapier 無頭世界＋腳本輸入）：

- [x] 平地起步 0.15 s 內達到跑速的 95% 以上；放開後 0.35 s 內停止。
- [x] 跳躍最高點約 1.3 m（±3%）；離開平台 0.1 s 內按跳可以起跳，0.2 s 後不行；落地前 0.12 s 按跳，會在落地瞬間起跳。
- [x] 滑鏟進入時有推進，冷卻中的第二次滑鏟沒有推進；15° 下坡滑鏟會加速。
- [x] 在矮洞下放開蹲，不會起身卡進天花板。
- [x] 斜向撞牆會沿牆滑行，不黏牆、不抖動。（離牆距離因角色控制器的間隙修正有 ≤ 2–3 cm 變動，速度不會被彈離牆面）

實機：

- [ ] 在訓練場跑、跳、滑鏟、連跳都流暢；在「實作紀錄」寫下主觀手感與調整過的數值。（未驗證：沒有可實際遊玩的有頭瀏覽器與實體滑鼠；headless Chrome 只做了合成輸入的煙霧測試，主觀手感留待實機試玩）

## 實作紀錄

完成日期：2026-11-23。

### 新增／修改檔案

- `src/player/`：`MovementConfig.ts`（`MOVEMENT_CONFIG`、`defaultMovementConfig()`、面板分組 `MOVEMENT_PANEL`）、`movementMath.ts`（Source 加速／摩擦、Quake 空中加速、水平旋轉、超速阻力、速度投影、坡面重力等純函式）、`StateMachine.ts`（可擴充狀態機）、`states.ts`（`GroundState`／`AirState`／`SlideState` 與集中註冊的轉換規則 `registerCoreMovement()`）、`PlayerController.ts`（膠囊＋角色控制器、`PlayerState`、事件）、`MovementPanel.ts`（調參面板「移動」）、`index.ts`。
- 修改：`src/main.ts`（玩家控制器取代自由相機成為主要操作；相機放在插值後的眼睛位置；區域追蹤、除錯傳送改用玩家）、`src/core/events.ts`（`player:*` 事件）、`src/physics/Physics.ts`（公開 `ensureQueries()`）、`src/camera/FreeCamera.ts`（停用時不移動相機，保留為除錯飛行）。
- 測試：`tests/helpers/movementSim.ts`（無頭測試工具 `MovementSim`、`ScriptedInput`、`floorBox`／`boxMinMax`）、`tests/movement.test.ts`（30 項，含全部驗收）、`tests/player-core.test.ts`（純函式、狀態機、設定與面板規格）、`tests/player-training.test.ts`（在 M1-04 訓練場實測出生平台、滑鏟長坡、半管 trimesh、深坑重生）。全專案 18 檔、274 測試。

### 實際 API 摘要（給後續計畫）

- `new PlayerController({ physics, getFrame, bus?, config?, getSettings?, checkRespawn?, setView?, object? })`：Game 系統（order = player）。`step(dt)`（無頭測試直接呼叫）、`teleport(feet, yaw?, pitch?)`、`respawn(target)`、`eyePosition(alpha, out)`、`enabled`、`hasHeadroom()`、`capsule`、`height`、`eyeHeight`。
- `PlayerState`（`player.state`，同一個物件每步更新）：`position`（腳底）、`previousPosition`、`velocity`、`state`、`grounded`、`eyeHeight`、`previousEyeHeight`、`crouchAmount`、`crouched`、`groundNormal`、`surface`、`speed`（水平）。
- 狀態機 `player.machine`：`addState({ id, enter?, step, exit? })`、`addTransition({ from, to, phase: 'pre' | 'post', priority?, name?, when })`、`set(id, force?)`、`evaluate(phase)`、`currentId`、`timeInState`。新增狀態只需註冊狀態與規則；狀態讀寫 `ctx.velocity`、`ctx.wish`、`ctx.input`、`ctx.grounded`、`ctx.groundNormal`，並可呼叫 `ctx.tryJump()`、`ctx.applyGravity(dt)`。目前優先序：pre「地面按蹲 → 滑鏟」10；post「滑鏟離地 → 空中」10、「按住蹲落地 → 滑鏟」10、其餘 0。
- 事件（payload 物件重複使用）：`player:state { from, to }`、`player:jump { fromState, coyote }`、`player:land { impactSpeed, surface }`、`player:slideStart { speed, boosted }`、`player:slideEnd { speed }`、`player:crouch { crouched }`、`player:footstep { surface, speed }`、`player:respawn { pos }`。
- 無頭測試：`new MovementSim({ primitives, hz?, config?, settings?, spawn?, checkpoints?, killVolumes? })`，`input.down()/up()/tap()/setMove()/setYaw()`，`step()/run(s)/runUntil(pred)/settle()`，`eventsNamed()`。

### 偏離計畫之處與設計決定

- **stopSpeed 2 → 4**：計畫數值（摩擦 6、stopSpeed 2）放開後從跑速停下要 0.383 s、從衝刺要 0.442 s，達不到驗收的 0.35 s。改成 4 後為 0.275／0.325 s，起步達 95% 跑速仍只要約 0.12 s；蹲走起步變成約 0.17 s。
- **貼地不用 Rapier 內建 snapToGround**：實測內建貼地在平地上會讓膠囊上下抖動 1–4 cm、偶爾陷進地面 1.2 cm，貼牆斜跑時每 2000 步約卡住 4 步（該步位移為 0）。改成：在地面／滑鏟狀態移動後，往下 shape cast（0.3 m 內有可站立的面）再用角色控制器往下移過去。平地高度完全穩定、貼牆不再卡住；下坡、下台階不騰空（測試涵蓋）。
- **碰撞法線修正**：角色控制器貼著間隙移動時回報的法線會偏好幾度（平面牆回報 (0.24, 0, 0.97)），直接投影會把速度彈離牆面造成抖動。改從膠囊軸線朝碰撞方向打射線取表面的真實法線（方向差太多或沒打到時沿用原值）。
- **速度投影條件**：只在「期望位移比實際位移更深入法線方向」時才投影（真的被擋住）；地面狀態中忽略可站立的面（否則上坡會被減速），也忽略腳邊 autostep 高度內的接觸（Rapier 的 autostep 要好幾步才跨上台階，第一步就把速度投影掉會讓 autostep 失效）。
- **地面加速後限速**：加速後的水平速率不超過「加速前速率」與目標速度的較大者。否則 Source 式加速在斜向貼牆跑時沿牆可達約 14 m/s（超過衝刺 10.5）。連跳保留的動量不受影響（加速不會削減速度）。
- **起跳那一步就套重力**：否則起跳步多走 v₀·dt，跳躍高度高出約 5%。現在 60／120／240 Hz 的最高點都在 1.3 m ±3% 內。
- **滑鏟下坡摩擦**：照計畫（摩擦 0.8 與速度成正比、坡度加速 = g sinθ）在 15° 坡的平衡速度只有約 7.8 m/s，滑鏟推進後（10.5 m/s 以上）反而會減速，與驗收「15° 下坡滑鏟會加速」矛盾。新增 `slideDownhillFrictionScale` 0.25（順坡往下滑時摩擦乘上此倍率，坡度 0→10° 之間線性過渡），15° 坡現在一路加速（headless 實測訓練場長坡上 1.5 s 內從 14.4 加速到 17.9 m/s）。地面速度維持水平，所以坡度加速用重力沿坡面分量的水平部分（G sinθ cosθ）。
- **新增參數**：`slideBoostMaxSpeed` 15（已經比這快時不推進，避免連續滑鏟無限加速）、`maxFallSpeed` 60、`footstepStride` 2.4 m、`groundProbeDistance` 0.08 m、`autostepMinWidth` 0.15 m、`jumpNormalBlend` 0.25、`slideDownhillFullDeg` 10°。超速阻力（> 22 m/s）也套用在滑鏟。
- **計畫未指定的數值**：空中控制 45°/s（只在輸入方向與速度夾角 ≤ 90° 時旋轉，按後退不會讓速度掉頭）；斜坡起跳法線比例 0.25。
- **地面探測**：半徑 0.9 × 膠囊半徑的球，從腳底上方 0.05 m 往下掃；坡度 ≤ 50° 且 0.08 m 內有面、而且沒有在上升（> 0.5 m/s 或本步剛起跳）才算著地。探測球完全沒打到但角色控制器回報著地時（站在邊緣只有膠囊外緣接觸）以控制器為準。
- **蹲下**：腳底固定（空中蹲也是頭頂往下縮）；起身前以內縮 2 cm、抬高 2 cm 的站姿膠囊做 overlap；頭頂受阻時維持蹲姿與蹲走速度，即使已放開蹲鍵，離開矮處後自動起身。
- **跳躍緩衝**：落地那一步偵測到著地，下一個地面步立刻起跳（在地面只停留 1 步、不套摩擦）。土狼時間只在走出平台（含滑鏟離地）時給，起跳後不給。
- **重生**：沿用 M1-04 的 `DataLevel.checkRespawn()`（點包含判定，不建 sensor）；重生後速度歸零、狀態設為空中、視角面向檢查點。
- **事件**：名稱加上 `player:` 前綴並多一個 `player:state`；`crouch` 帶 `{ crouched }`，`land` 另帶表面材質，`slideStart` 帶是否有推進。
- **自由相機**：保留為除錯飛行（調參面板「自由相機/啟用（穿牆飛行）」，預設關閉），切換時從目前位置與視角接續。
- 訓練場沒有矮洞，「矮洞放開蹲」只在無頭測試驗證；訓練場資料未修改。

### 調整過的數值

- `MOVEMENT_CONFIG`：stopSpeed 4（原 2）；其餘依計畫：站／蹲 1.8／1.0 m、半徑 0.35、眼高 1.65／0.95、蹲起 0.12 s、offset 0.01、autostep 0.35、貼地 0.3、爬坡 50°、下滑 55°、跑 7.5、衝刺 10.5（±50°）、蹲走 3.5、加速 12、摩擦 6、落地免摩擦 1 步、跳躍 1.3 m、重力 24、土狼 0.12 s、緩衝 0.15 s、空中加速 2.5、wishSpeed 上限 1.2、軟上限 22、超速阻力 2、滑鏟門檻 7、推進 3.5、冷卻 1.2 s、滑鏟摩擦 0.8、坡度倍率 1.0、轉向 90°/s、結束 4.5。新增參數見上。

### 實際驗證

- `npm run typecheck`、`npm test`（18 檔、274 測試）、`npm run build`、`npm run check:dist`（9 個檔案、5.21 MiB）全部通過。
- 無頭驗收（Vitest + Rapier）：起步 0.12 s 達 95% 跑速、衝刺同；放開後跑速 0.275 s、衝刺 0.325 s 停止；跳躍最高點 60／120／240 Hz 都在 1.3 m ±3%；離開平台 0.1 s 按跳可起跳、0.2 s 不行；落地前 0.12 s 按跳在落地後下一步起跳、0.2 s 前按不會；滑鏟推進、冷卻中無推進、冷卻後恢復；15° 下坡滑鏟加速、平地減速；矮洞下放開蹲維持蹲姿、頭頂低於天花板，走出後起身；斜向撞牆沿牆滑行（x 單調前進、速度 ≥ 衝刺 90% 且不超過衝刺、速度從不朝牆外、離牆距離變動 < 3 cm）；另有天花板、autostep（0.3 m 走得上去、0.5 m 擋住）、15° 坡上下、air strafe、air control、超速阻力、連跳保留動量、更新率無關（60／120／240 Hz 軌跡差 < 0.15 m）、物理世界重建、訓練場整合。
- headless Chrome（SwiftShader）以 CDP 連 `npm run sim`，15 項檢查全部通過：直接開遊戲（`#debug&nolock`）時站在出生平台；點擊進入 playing；按住 W 衝刺到 10.5 m/s；Space 起跳進入空中並落地；衝刺中按 C 進入滑鏟（12.7 m/s）；放開後停下並起身；調參面板有「移動」各資料夾與監看（水平速度曲線、狀態、著地、地面法線）；傳送到滑鏟坡頂衝下滑鏟，速度 14.4 → 17.9 m/s；走進深坑後重生回坑口；draw call 10；平台模擬頁的跨來源 iframe 內正常啟動（title 模式、embedded）。截圖確認畫面正常。主控台只有 Rapier 初始化訊息、SwiftShader 的 `GPU stall due to ReadPixels`、平台頁 sandbox 提示，以及直接開遊戲網址時瀏覽器自動請求 `/favicon.ico` 的 404（非遊戲資源）。

### 未驗證

- **實機手感**（驗收「實機」項目）：沒有有頭瀏覽器與實體滑鼠可實際遊玩，跑、跳、滑鏟、連跳的主觀流暢度與手感沒有試玩，也沒有依試玩調整數值。headless 只用合成輸入確認功能正確。
- 角色控制器的間隙修正讓貼牆移動時離牆距離偶爾有 1–2 cm 的跳動（測試 < 3 cm）；在畫面上是否看得出來未確認（M1-08 的鏡頭平滑可能可以吸收）。
- 進入半管時爬過管緣會短暫減速（測試中 < 40 步低於半速），實際手感未確認。
- 切換模式蹲下（設定「蹲下：切換」）在瀏覽器中的實際操作（控制器只讀 InputFrame 的按住狀態，切換由 M1-03 的輸入層處理並有單元測試）。
- headless Edge 未執行（M1-04 已記錄 Edge 的 CDP 合成輸入送不進 iframe）。
- 實體 GPU 上的效能（每步數次查詢與射線的成本；headless 的 CPU 每畫面約 2 ms）。
