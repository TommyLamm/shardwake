# M1-06 移動 II：跑牆、蹬牆跳、攀爬

- 里程碑：M1 手感原型
- 前置：M1-05
- 狀態：完成

## 目標

加入跑牆、蹬牆跳與攀爬邊緣，讓垂直移動與地形銜接流暢。

## 範圍

- 包含：牆面偵測、`WallRun` 與 `Mantle` 狀態、與既有狀態的轉換、參數、測試。
- 不含：二段跳與噴射（M1-07）；本計畫先保留「跑牆時重置空中能力」的介面。

## 任務

- [x] 牆面偵測：在空中時，每步往左右（相對速度方向）做水平 shape cast，距離 = 半徑 + 0.35 m；牆面須 |n.y| < 0.15，且表面旗標為 `wallRunnable`。另外做給攀爬用的前方偵測。
- [x] `WallRun` 狀態：
  - 進入條件：在空中、水平速度 ≥ 6 m/s、按住前進、速度方向與牆面切線夾角 < 50°、離地 ≥ 0.6 m，而且不是 0.4 s 內剛離開的同一面牆（著地後重置）。
  - 進入時：速度投影到牆切線，至少 10.5 m/s；垂直速度最多保留 +3 m/s 的上升；重置二段跳、回充噴射燃料（M1-07 接上）。
  - 持續中：重力在 1.2 s 內依曲線從 0 增加到 8 m/s²；朝牆面施加貼附力；最長 1.8 s。
  - 脫離：放開前進、牆面結束（偵測不到）、速度 < 5 m/s、按蹲。
  - 蹬牆跳：速度 = 沿牆分量 × 0.9 ＋ 牆法線 × 7 ＋ 上方 × 7.5；視線離開牆面時，再往視線方向偏轉（權重可調）。
  - 事件：`wallRunStart { side, normal }`、`wallRunEnd`、`wallJump`。
- [x] `Mantle` 狀態：
  - 觸發：空中按住前進，或在地面面對牆按跳；前方 0.6 m 內有牆；從上方往下 raycast 找到邊緣頂面（坡度 < 30°）；邊緣高度在腳底上方 0.5–2.0 m；頂面放得下膠囊（`overlap` 檢查）；上升速度 < 4 m/s。
  - 動作：0.28 s 的兩段曲線（先上後前），期間不受重力；結束時保留進入前 60% 的水平速度，且向前至少 4 m/s；發出 `mantle` 事件（武器短暫放低用）。
  - 與跑牆的優先順序：正面牆且有可攀邊緣 → 攀爬；側面牆 → 跑牆。
- [x] 調參面板加入 WallRun／Mantle 參數；除錯模式繪製偵測射線與偵測結果。

## 交付（給後續計畫）

- `WallRun`、`Mantle` 狀態與事件（鏡頭傾斜、音效、viewmodel 姿勢會用到）。
- 「重置空中能力」的統一介面（跑牆、著地、抓鉤共用）。

## 驗收

測試：

- [x] 以 8 m/s 斜向跳向側牆會進入跑牆，最多持續 1.8 s，期間高度變化符合重力曲線。
- [x] 蹬牆跳的離牆方向正確（法線分量 > 0）；同一面牆 0.4 s 內不能重貼。
- [x] 1.2 m 箱：在地面按跳直接攀上；3.0 m 牆：起跳後在空中攀上；4.0 m 牆：單跳攀不上（M1-07 完成後補測二段跳可以）。

實機：

- [ ] 在跑牆長廊可以左右牆連續跑牆加蹬牆跳，越過深坑。（未驗證：沒有有頭瀏覽器與實體滑鼠可實際遊玩。無頭測試以腳本輸入完成同樣路線：長廊左→右→左連續跑牆、Z 字牆板 5 片連續跑牆＋蹬牆跳落在深坑對岸；headless Chrome 以合成按鍵確認長廊左牆跑牆 → 蹬牆跳 → 右牆跑牆。主觀手感留待實機試玩）

## 實作紀錄

完成日期：2026-11-23。

### 新增／修改檔案

- 新增 `src/player/WallSensor.ts`（側面牆偵測、跑牆追蹤、前方牆與邊緣偵測 `findLedge()`、除錯紀錄 `ProbeLog`）、`src/player/wallStates.ts`（`WallRunState`、`MantleState`、`registerWallMovement()`、`wallRunGravityAt()`、`mantleProgress()`、`angleToWallTangent()`）、`src/player/MovementDebug.ts`（偵測射線除錯顯示）。
- 修改：`PlayerController.ts`（移動前速度、牆面偵測、跑牆／蹬牆跳／攀爬方法、空中能力重置介面、`PlayerState` 新欄位）、`states.ts`（`MoveStateId.wallRun／mantle`、優先序常數 `MovePriority`、`AirState` 呼叫蹬牆跳寬限）、`MovementConfig.ts`（31 個新參數與面板「移動/跑牆」「移動/蹬牆跳」「移動/攀爬」）、`MovementPanel.ts`（監看：跑牆、側牆偵測、攀爬）、`core/events.ts`、`main.ts`（加入 `MovementDebug`，`#debug` 時掛在 `__shardwake.movementDebug`）、`world/levels/TrainingGround.ts`（Z 字牆板，見下）。
- 測試：新增 `tests/movement-wall.test.ts`（20 項，含全部驗收）；`tests/player-core.test.ts`（預設值、純函式、ProbeLog）、`tests/player-training.test.ts`（訓練場跑牆長廊、Z 字牆板越過深坑、攀爬測試牆 5 種高度）、`tests/helpers/movementSim.ts`（記錄新事件）。全專案 19 檔、300 測試。

### 實際 API 摘要（給後續計畫）

- 狀態 id：`wallRun`、`mantle`。優先序 `MovePriority`：mantle 50 > grapple 45 > dash 40 > wallRun 30 > wallRunLand 20 > slide／wallRunExit 10 > base 0（M1-07 的 Dash／Grapple 用 dash／grapple 層級）。
- `PlayerState` 新增 `wallRunSide`（'left'／'right'／null，相對進入時的行進方向）、`wallNormal`（水平、朝牆外；不在跑牆時為零向量）、`mantleProgress`（0..1）。鏡頭傾斜（M1-08）與 viewmodel（M1-11）讀這些欄位。
- 空中能力重置：`player.onAirReset((reason) => …)` 回傳取消函式；`player.resetAirAbilities(reason)`；事件 `player:airReset { reason }`。reason：`land`（著地）、`wallRun`（開始跑牆）、`respawn`（傳送／重生）、`grapple`（M1-07 抓鉤呼叫）。M1-07 的二段跳次數與噴射燃料在監聽者裡重置；「跑牆中也回充」請以 `player.state.state === 'wallRun'` 判斷。
- 事件：`player:wallRunStart { side, normal }`、`player:wallRunEnd { reason, duration }`（reason：jump／released／wallEnded／slow／crouch／timeout／landed／mantle／other）、`player:wallJump { normal, speed, grace }`、`player:mantle { height, duration, fromState }`。`player:state` 也會報 wallRun／mantle。
- 其他可用：`player.applyGravity(dt, g?)`（可傳自訂重力）、`player.standingCapsuleFits(x, feetY, z)`、`player.walls`（`left／right／tracked／front` 偵測結果、`log`）、`player.preMoveVelocity`、`player.forward`（視線水平方向）、`player.isRecentWall()`。
- `AirState.step` 先呼叫 `ctx.tryWallJumpGrace()`（離牆寬限內按跳＝蹬牆跳），M1-07 的二段跳要放在它之後，才不會吃掉寬限內的蹬牆跳。

### 偏離計畫之處與設計決定

- **Z 字牆板改版**（`ZIGZAG` 常數）：M1-04 的牆板各往外偏 20°、左右相距約 10 m。以本計畫的蹬牆跳數值（法線 7、上方 7.5、重力 24）計算，順著外偏的板子起跳時橫向只剩約 3.4 m/s，跨不到對面。改成內側牆面 x = -36.5／-31.5（內距 5 m）、遠端往中線內傾 5°，其餘（5 片、長 9 m、間隔 9.5 m、可跑牆）不變。內傾超過約 6.5° 時，蹬牆跳到對面的進入夾角會超過 50°。無頭腳本測試：從坑口助跑起跳，5 片連續跑牆＋蹬牆跳後落在對岸。
- **攀爬偵測的「前方 0.6 m」從膠囊表面算起**。正面牆的條件是視線與牆面夾角 ≤ `mantleMaxFacingDeg` 45°（新參數），超過時視為側面牆，交給跑牆。攀爬方向與結束時的前進方向都用開始攀爬時的視線水平方向。目標點沿視線越過牆面「半徑 + 0.12 m」，再對目標點往下 raycast 找頂面，並以站姿膠囊做 overlap。另外檢查往上、往前兩段路徑（縮小膠囊的 shape cast），避免半路被擋住。
- **攀爬路徑**：先上（ease-out，佔 `mantleUpFraction` 0.6）後前（線性），上升到頂面 + 4 cm 才往前。每步速度 = 到路徑點的位移 / dt，碰撞仍由角色控制器處理。被打斷（傳送、重生）時不改寫速度。攀爬結束站上邊緣時不發 `player:land`，但仍會重置空中能力（reason 為 land）。
- **「進入前的水平速度」**：每步移動前另存速度（`preMoveVelocity`）。跑牆的速度與夾角條件、進入時投影到切線、攀爬保留 60%，都用碰撞投影之前的速度，所以撞牆那一步損失的速度不算。
- **大角度撞牆不跑牆**：空中撞牆的角度 ≥ 50° 時，把那面牆記成「剛離開的牆」，套用 0.4 s 同牆冷卻。否則碰撞投影後剩下的沿牆速度只要 ≥ 6 m/s，下一步就會以 0° 進入跑牆，夾角條件形同無效。
- **進入跑牆的下落速度**：計畫只規定上升最多保留 3 m/s。新增 `wallRunMaxEntryFallSpeed`，預設 0（貼牆時止住下墜）；保留下落的話，蹬牆跳到對面時（約 -9 m/s）會直接滑到地面，無法連續跑牆。另外，速度方向朝牆外分量 > 0.17 時不貼牆（正在離開那面牆）。
- **貼附力**：朝牆面加速 20 m/s²，朝牆速度上限 2 m/s（新參數 `wallRunStickAccel`、`wallRunStickMaxSpeed`），並移除離牆分量。偵測距離內（≤ 0.35 m）尚未接觸的牆約 0.25 s 內貼上。跑牆中水平速度不加摩擦、不受輸入轉向；超速阻力照舊。
- **重力曲線**：g(t) = 8 × (t / 1.2)^`wallRunGravityCurve`，指數預設 2（先慢後快），以步長中點取值。無頭測試高度與解析解誤差 < 1 cm（60／120／240 Hz）。
- **牆面追蹤不會繞過牆端**：偵測球打到牆後，從膠囊中心沿 −法線打射線確認是牆「面」，並以射線的法線與距離為準。跑牆中法線每步最多轉 15°、整次最多轉 35°。沒有這些限制時，偵測球會擦過牆端邊角，法線逐步旋轉，玩家會繞到牆板背面繼續跑。
- **蹬牆跳寬限**（新參數 `wallJumpGraceTime` 0.15 s）：跑牆因放開前進、牆面結束、太慢或逾時而結束後，0.15 s 內按跳仍算蹬牆跳。按蹲離牆沒有寬限。跑到牆板盡頭時，可以在離牆後立刻起跳。
- **蹬牆跳的視線偏轉**：權重 = `wallJumpLookInfluence` 0.5 × max(0, 視線·法線)，水平速率不變。蹬牆跳的垂直速度直接設為 7.5（不疊加原本的垂直速度），也不發 `player:jump`。
- **連續跑牆的操作**：空中控制（45°/s，M1-05）會把速度轉向視線方向，所以要看向對面的牆（約 35–45°）起跳。看著長廊正前方起跳時，橫向速度會被轉掉而跨不過去。6 m 長廊每次橫越約掉 0.8–1.1 m（看 35–40°），5 m 的 Z 字牆板可以維持或增加高度。
- 事件名稱加 `player:` 前綴；`wallRunEnd` 帶結束原因與時間。另外新增 `player:airReset`。
- 除錯顯示：調參面板「移動/除錯顯示/偵測射線」。灰 = 沒打到、綠 = 符合、紅 = 不符合、黃 = 攀爬目標、青 = 跑牆中的牆面法線。只有開啟時才記錄偵測（每步最多 24 段）。

### 調整過的數值

- 計畫指定的數值都照用：偵測距離半徑 + 0.35、|n.y| < 0.15、進入 ≥ 6 m/s、夾角 < 50°、離地 ≥ 0.6 m、同牆 0.4 s、沿牆 ≥ 10.5 m/s、上升保留 3 m/s、重力 0 → 8 m/s²（1.2 s）、最長 1.8 s、結束 < 5 m/s、蹬牆跳 0.9／7／7.5、攀爬 0.6 m／0.5–2.0 m／30°／< 4 m/s／0.28 s／60%／4 m/s。
- 新增參數（計畫未指定）：`wallRunMaxEntryFallSpeed` 0、`wallRunGravityCurve` 2、`wallRunStickAccel` 20、`wallRunStickMaxSpeed` 2、`wallJumpLookInfluence` 0.5、`wallJumpGraceTime` 0.15、`mantleMaxFacingDeg` 45、`mantleUpFraction` 0.6。
- 程式內常數：側面偵測球半徑 0.6 × 膠囊半徑、離牆判定 0.17、同牆法線內積 > 0.9、追蹤轉角 15°／35°、攀爬目標內縮 0.12 m、上升餘隙 0.04 m、邊緣探測深度 0.2 m。

### 實際驗證

- `npm run typecheck`、`npm test`（19 檔、300 測試）、`npm run build`、`npm run check:dist`（9 個檔案、5.23 MiB）全部通過。
- 無頭驗收（Vitest + Rapier）：8 m/s 斜向起跳進入跑牆（右牆、沿牆 10.5 m/s、上升 3 m/s），1.8 s 時逾時結束，高度與重力曲線誤差 < 1 cm，0.3 s 後離牆間隙 < 3 cm。蹬牆跳法線分量 7、沿牆 × 0.9、向上 7.5；背向牆時往視線偏轉，速率不變。同牆冷卻：放開前進後 0.4 s 內不重貼，第 0.4 s 重貼；著地後清除。寬限蹬牆跳；太慢、沒按前進、按蹲、不可跑牆的表面、離地太低、角度太大都不進入；牆面結束、按蹲、太慢、著地四種結束；6 m 長廊左右連續 4 次以上跑牆。攀爬：1.2 m 地面按跳直接攀上（不發起跳事件、先上後前、0.28 s、結束 4 m/s）；衝刺攀爬保留 ≥ 60%；3.0 m 原地起跳與助跑起跳都在空中攀上；4.0 m 攀不上；0.4 m 邊緣正常起跳；頂面放不下膠囊、沒按前進、背對牆都不攀；同一面 2.5 m 可跑牆，正面是攀爬、側面是跑牆；跑牆中前方有邊緣轉攀爬。另有空中能力重置與取消監聽、`PlayerState` 新欄位、60／120／240 Hz 一致、除錯顯示。
- 訓練場整合：跑牆長廊左 → 右 → 左；Z 字牆板 5 片連續跑牆後落在對岸（不重生）；攀爬測試牆 0.8／1.2／2.0 m 在地面攀上、3.0 m 在空中攀上、4.0 m 攀不上。
- headless Chrome（SwiftShader）以 CDP 連 `npm run sim`，19 項檢查全部通過：遊戲直接開啟（`#debug&nolock`）並進入 playing；長廊助跑起跳後左牆跑牆，開啟偵測射線後畫出 3 段；看向右側按 Space 蹬牆跳（法線 +X），接著右牆跑牆；攀爬測試牆 1.2 m（地面）、3.0 m（空中）攀上，4.0 m 攀不上；調參面板有跑牆、蹬牆跳、攀爬、除錯顯示、偵測射線、側牆偵測；draw call 30；平台模擬頁的跨來源 iframe 內正常啟動（ready／title／embedded）。截圖確認畫面正常；主控台只有 Rapier 初始化訊息。

### 未驗證

- **實機手感**（驗收「實機」項目）：沒有有頭瀏覽器與實體滑鼠，跑牆、蹬牆跳、攀爬的主觀流暢度沒有試玩，數值也沒有依試玩調整。連續跑牆需要看向對面的牆起跳，這對真人是否自然也未確認。
- 偵測射線在畫面上的可讀性：headless 只確認了線段數量，截圖中射線在鏡頭下方、看不太到。
- headless Edge 未執行（M1-04 已記錄 Edge 的 CDP 合成輸入送不進 iframe）。
- 實體 GPU 上的效能（空中每步 2 次 shape cast＋最多 2 次射線；按住前進時另有攀爬偵測）。
- 二段跳攀上 4.0 m 牆（M1-07 補測）。
