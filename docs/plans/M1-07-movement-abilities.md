# M1-07 移動 III：二段跳、噴射、Dash、抓鉤 ★

- 里程碑：M1 手感原型
- 前置：M1-06
- 狀態：完成
- 檢查點：★ 完成後可以試玩全部移動技與連招

## 目標

加入四種進階移動能力，並確保「滑鏟 → 跳 → 跑牆 → 蹬牆跳 → 二段跳 → Dash → 抓鉤」全程動量連貫。

## 範圍

- 包含：能力計時器、二段跳、噴射推進、Dash、抓鉤（含繩索視覺）、狀態優先序、測試。
- 不含：能力的 HUD 顯示（M1-14）；本計畫提供唯讀狀態與事件。

## 任務

- [x] `player/Abilities.ts`：充能、燃料、冷卻的通用計時器，提供 HUD 用的唯讀狀態與事件。
- [x] 二段跳：空中按跳（不在土狼時間內）→ 垂直速度設為 max(vy, 7.3 m/s)，約 1.1 m 高；水平速度往輸入方向重新導向一部分（`redirect` 0.5，不增加總速）；1 次，著地、跑牆、抓鉤時重置；事件 `doubleJump`。
- [x] 噴射推進：二段跳用完後長按跳 → 向上推力 34 m/s²（扣掉重力後淨上升），推力造成的垂直速度上限 5 m/s，可帶少量水平推力；燃料 1.0 s；著地 0.3 s 後以每秒 0.8 回充，跑牆中也回充；事件 `jetStart`／`jetStop`。
- [x] Dash（Shift）：
  - 2 次充能，每次 1.8 s，依序回充。
  - 方向 = 輸入方向（相對視角的水平方向），沒有輸入則向前。
  - 0.15 s 內位移 7 m；期間無重力、垂直速度歸零。
  - 結束時水平速度 = max(原本沿該方向的速度, 12 m/s)。
  - 地面、空中、跑牆、滑鏟中都能用（會中斷該狀態）；地面 Dash 結束時按住蹲 → 接滑鏟。
  - 事件 `dash { dir }`。
- [x] 抓鉤（F）：
  - 發射：從相機沿視線射出鉤爪投射物，速度 150 m/s、射程 45 m。命中 `grappleable` 的靜態表面就附著；落空就收回，冷卻 0.8 s。
  - 附著：朝錨點加速 50 m/s²，加上 12 m/s² 的輸入轉向；速度上限 26 m/s；重力 × 0.4；與錨點的距離只能縮短（繩長約束），可以擺盪。
  - 脫鉤：距離 < 2.5 m；已越過錨點（速度與錨點方向的點積 < −0.2）；再按 F（切換模式）或放開（按住模式）；按跳（額外 +5 m/s 上拋並重置二段跳）；附著超過 2.5 s。脫鉤後冷卻 4 s。
  - 準星輔助：每畫面對視線做 raycast，射程內且可勾時通知 HUD 顯示「可勾取」。
  - 繩索視覺（`fx/GrappleRope.ts`）：發射時沿線的正弦波逐漸拉直，附著後有輕微彈性抖動。
  - 事件：`grappleFire`、`grappleAttach`、`grappleRelease`、`grappleMiss`。
- [x] 狀態優先序：Mantle > Grapple > Dash > WallRun > Slide > Air／Ground，寫在 `PlayerController` 的註解與本計畫的「實作紀錄」。
- [x] 調參面板加入所有能力參數，並可個別開關能力，方便比較手感。

## 交付（給後續計畫）

- `Abilities` 唯讀狀態（Dash 充能、燃料、抓鉤冷卻）與事件，給 HUD、音效、鏡頭使用。
- 能力修正介面：M2-06 的裝備模組與 M5-01 的技能透過它修改數值，不直接改 config 物件。

## 驗收

測試：

- [x] 4.0 m 牆：二段跳後可以攀上。
- [x] 平地 Dash 位移約 7 m（±5%）；連續兩次 Dash 後第三次無效，1.8 s 後恢復一次。
- [x] 抓鉤：30 m 外的牆可以附著，被拉到 2.5 m 內自動脫鉤；50 m 外落空並進入 0.8 s 冷卻。
- [x] 噴射燃料耗盡後沒有推力，著地後依規則回充。

實機：

- [ ] 連招「滑鏟 → 跳 → 跑牆 → 蹬牆跳 → 二段跳 → Dash → 抓鉤」全程動量連貫；附上速度曲線截圖。（未驗證：沒有有頭瀏覽器與實體滑鼠可實際遊玩，也沒有實機速度曲線截圖。無頭測試以腳本輸入跑完同一套連招並檢查每一步的水平速度，數據見實作紀錄；主觀手感與截圖留待實機試玩）

## 實作紀錄

完成日期：2026-11-23。

### 新增／修改檔案

- 新增 `src/player/Abilities.ts`（通用計時器 `ChargeTimer`／`FuelTank`／`Cooldown`、能力修正 `AbilityModifiers`／`ABILITY_STATS`、能力容器 `Abilities` 與唯讀狀態 `AbilityState`）、`src/player/Grapple.ts`（鉤爪 `GrappleHook`：發射、逐步 raycast 飛行、附著、落空收回、準星輔助；`viewDirection()`）、`src/player/abilityStates.ts`（`DashState`、`GrappleState`、`registerAbilityMovement()`、二段跳 `tryDoubleJump()`、噴射 `applyJet()`、每步更新 `abilitiesPreStep()`／`abilitiesPostStep()`、`updateGrappleAim()`）、`src/fx/GrappleRope.ts`（繩索視覺）。
- 修改：`PlayerController.ts`（能力接線、輸入欄位、`look`、`eyeNow()`、`groundWithin()`、`applyVerticalAcceleration()`、`emit()`、`releaseGrappleToggle()`、選項 `setToggle`／`getAim`、`PlayerState.abilities`、狀態優先序註解、傳送時先離開目前狀態再歸零速度）、`states.ts`（`AirState` 呼叫二段跳與噴射）、`wallStates.ts`（跑牆結束原因加 `dash`／`grapple`）、`MovementConfig.ts`（4 個能力開關、29 個能力參數、面板資料夾「能力開關／二段跳／噴射／Dash／抓鉤」）、`MovementPanel.ts`（監看：二段跳、噴射燃料曲線、Dash 充能、抓鉤）、`core/events.ts`、`main.ts`（`setToggle`、`getAim`、`GrappleRope`）、`fx/index.ts`、`player/index.ts`。
- 測試：新增 `tests/movement-abilities.test.ts`（41 項，含全部「測試」驗收）；`tests/player-training.test.ts` 加訓練場 4.0 m 攀爬牆二段跳攀上、抓鉤上 20 m 高塔；`tests/helpers/movementSim.ts`（記錄新事件、`setPitch()`）；`tests/movement.test.ts`、`tests/player-core.test.ts` 依新行為調整（見下）。全專案 20 檔、343 測試。

### 實際 API 摘要（給後續計畫）

- 唯讀狀態：`player.abilities.state`（也在 `player.state.abilities`）：`doubleJump { enabled, remaining, max }`、`jet { enabled, fuel, capacity, fraction, active, recharging }`、`dash { enabled, charges, maxCharges, rechargeProgress, active }`、`grapple { enabled, phase: idle／flying／attached／retracting, cooldown, cooldownTotal, ready, aimAvailable, aimDistance }`。每個固定步結束時更新；`aimAvailable` 另在每個渲染畫面更新（`PlayerController.render`）。HUD（M1-14）、音效（M1-13）、鏡頭（M1-08）讀這裡。
- 事件（payload 重複使用）：`player:doubleJump { speed, remaining }`、`player:jetStart { fuel }`、`player:jetStop { fuel, reason }`、`player:dash { dir, fromState, charges }`、`player:grappleFire { origin, dir }`、`player:grappleAttach { point, normal, distance }`、`player:grappleRelease { reason, duration }`（close／passed／input／jump／timeout／disabled／mantle／other）、`player:grappleMiss { reason, point }`（range／surface／cancel）、`player:grappleAim { available, distance }`（改變時）、`player:abilityReady { ability: dash／grapple／jet, charges }`。`player:state` 也會報 `dash`、`grapple`；`player:wallRunEnd` 多 `dash`、`grapple` 原因。
- 能力修正介面（M2-06 裝備模組、M5-01 技能）：`player.abilities.modifiers.add({ stat, add?, mul?, source? })` 回傳移除函式；`removeSource(source)`、`clear()`。實際值 `player.abilities.stat(key)` = (基礎值 + Σadd) × Πmul，次數類（`dashCharges`、`doubleJumpCount`）取整數、不小於 0。可修正的欄位見 `ABILITY_STATS`。`MovementConfig` 仍是基礎值（調參面板調整），不要直接改它來做裝備效果。
- 其他：`player.abilities.hook`（鉤爪位置、錨點、階段，繩索視覺讀取）、`player.abilities.dashRun`、`player.updateGrappleAim(origin?, yaw?, pitch?)`、`AbilityStateId`（`dash`、`grapple`）。重生（`teleport`）會補滿燃料與 Dash 充能、清除抓鉤冷卻、收回鉤爪。

### 狀態優先序

Mantle 50 > Grapple 45 > Dash 40 > WallRun 30 > Slide 10 > Air／Ground 0（`MovePriority`；寫在 `PlayerController.ts` 開頭與 `abilityStates.ts` 註解）。高優先的狀態不會被低優先的狀態打斷：Dash 可從地面、空中、跑牆、滑鏟進入（中斷該狀態）；抓鉤附著可打斷 Dash，Dash 不能打斷抓鉤；攀爬中不能 Dash、不能發射抓鉤（攀爬前已發射的鉤爪附著後，等攀爬結束才進入抓鉤）；Dash、抓鉤中正面有可攀邊緣 → 攀爬。同一步同時符合時：攀爬 > 抓鉤 > Dash。

### 偏離計畫之處與設計決定

- **二段跳的落地保護**（新參數 `doubleJumpLandingGuard` 0.15 s）：下落中、預估 0.15 s 內會著地時，空中按跳不用二段跳，保留給落地起跳（M1-05 的跳躍緩衝）。否則「落地前 0.12 s 按跳 → 落地起跳」會變成浪費二段跳。M1-05 的兩項測試（土狼時間 0.2 s 後按跳、落地前 0.2 s 按跳）原意是「不會起跳」，開啟二段跳時這一下會變成二段跳，所以這兩項改成關閉二段跳再測；二段跳的行為另在 M1-07 測試。
- **二段跳**：土狼起跳與蹬牆跳寬限先處理（`AirState` 順序：土狼 → 蹬牆跳寬限 → 二段跳）。水平導向只在有輸入時做，方向 = normalize(原方向 × 0.5 + 輸入方向 × 0.5)，速率不變；輸入正好與速度相反時不轉。二段跳不發 `player:jump`。抓鉤「附著」時就重置二段跳（`resetAirAbilities('grapple')`），按跳脫鉤時不再重複重置（抓鉤中本來就不能用二段跳，結果相同）。
- **噴射**：要「在空中按下」的跳繼續按住才會噴射（`jetArmed`；二段跳那一下也算），地面起跳後一直按住不會噴射；關閉二段跳時空中長按直接噴射。新參數 `jetHoldDelay` 0.12 s（按下後要按住這麼久才啟動，二段跳後不會立刻接噴射）。推力在重力之後套用，只把垂直速度推到 5 m/s；水平推力新參數 `jetHorizontalAccel` 6 m/s²、`jetHorizontalMaxSpeed` 8 m/s（「少量水平推力」）。只有實際推進的步才消耗燃料（垂直速度已超過上限且沒有水平推力時不消耗）。燃料單位為秒，回充「每秒 0.8」解讀為每秒回充 0.8 秒燃料；跑牆中直接回充（不等 0.3 s）。噴射推力也計入梯形積分的本步加速度（`applyVerticalAcceleration`）。
- **Dash**：位移速度 = 距離 / 時間（46.7 m/s），最後一步只走剩下的時間，60／120／144／240 Hz 位移都在 7 m ±5%。結束時速度 = Dash 方向 × max(原本沿該方向的速度, 12)、垂直 0；原本垂直於 Dash 方向的水平速度不保留（依計畫字面）。從地面開始且仍貼地的 Dash 視為地面移動（可自動上 0.35 m 台階、貼地）。Dash 不做輸入緩衝（只認按下那一步）。Dash 被抓鉤或攀爬打斷時也先套用結束速度；攀爬保留速度以 Dash 結束速度計算（不用 46.7 m/s 的位移速度）。
- **抓鉤發射與飛行**：鉤爪從發射時的相機位置沿視線直線飛行（不跟著玩家移動），每步對飛過的那一段 raycast（只查靜態世界）。打到不可勾的表面也算落空（`surface`）。按住模式下飛行中放開 F（切換模式下再按 F）會取消（`cancel`），套用 0.8 s 落空冷卻。落空冷卻從鉤爪停下（落空判定）那一步起算；收回只是視覺（160 m/s 飛回），冷卻結束就能再發射。
- **抓鉤附著**：距離、越過錨點的判定都以眼睛位置為準。速度上限 = max(26, 這一步開始時的速率)：拉力與轉向不會讓速率超過 26，但進入時已更快（例如從高處落下）則保留，不硬性減速。輸入轉向只用水平輸入方向。
- **繩長約束只在「開始接近錨點」之前有效**：若整段都套用「距離只能縮短」，飛越錨點時繩子會把速度轉成切線，玩家繞著錨點轉圈直到逾時，計畫的「越過錨點（點積 < −0.2）脫鉤」永遠不會成立。改為：速度方向與錨點方向的內積曾經 > 0.5（`approached`）之後不再約束（由 50 m/s² 拉力帶向錨點），越過錨點的判定也只在 `approached` 之後、速率 > 2 m/s 時才做。擺盪（例如附著時正在離開錨點、或拉力很小）仍由繩長約束處理，測試確認距離不會變長。
- **按跳脫鉤**：垂直速度 = max(vy, 0) + 5（下墜中脫鉤也會往上拋）。
- **切換模式**：脫鉤或落空後呼叫 `input.builder.setToggle('grapple', false)` 關掉切換狀態，下次按 F 才會重新發射（新增 `PlayerControllerOptions.setToggle`）。
- **準星輔助**：每個渲染畫面從插值後的眼睛、以 `input.view` 的視角（`getAim`）做一次 raycast；可勾取的狀態改變時發 `player:grappleAim`。不論冷卻都回報「射程內有可勾的表面」，HUD 自己再結合 `ready`。
- **重生**：傳送時（`respawn` 原因的空中能力重置）補滿燃料與 Dash 充能、清除抓鉤冷卻、收回鉤爪。傳送改成先離開目前狀態（Dash 的 exit 會改寫速度）再歸零速度。
- **能力開關**是 `MovementConfig` 的布林欄位（`doubleJumpEnabled` 等），面板測試改成布林欄位只檢查標籤。
- **繩索視覺**：`THREE.Line`（WebGL 線寬固定 1 px）加一個小八面體鉤爪頭；手部位置在相機座標右 0.22、下 0.26、前 0.35 m。發射時正弦波（振幅 0.45 m、3.5 個波）在 0.22 s 內以平方曲線拉直，附著後單弧駐波抖動（0.15 m、8 Hz、衰減 6 /s），收回時鬆弛波形。參數在面板「移動/抓鉤繩索（視覺）」。
- 事件名稱加 `player:` 前綴；另外新增 `player:grappleAim`、`player:abilityReady`。

### 調整過的數值

- 計畫指定的數值都照用：二段跳 7.3 m/s、redirect 0.5、1 次；噴射 34 m/s²、上限 5 m/s、燃料 1.0 s、著地 0.3 s 後每秒 0.8；Dash 2 次、1.8 s、7 m／0.15 s、結束 12 m/s；抓鉤 150 m/s、45 m、落空 0.8 s、拉力 50、轉向 12、上限 26、重力 × 0.4、2.5 m、點積 −0.2、跳躍 +5、2.5 s、冷卻 4 s。
- 新增參數（計畫未指定）：`doubleJumpLandingGuard` 0.15 s、`jetHoldDelay` 0.12 s、`jetHorizontalAccel` 6 m/s²、`jetHorizontalMaxSpeed` 8 m/s。程式內常數：越過錨點判定的最低速率 2 m/s、接近判定內積 0.5、繩長位置修正上限 5 m/s、鉤爪收回 160 m/s。

### 實際驗證

- `npm run typecheck`、`npm test`（20 檔、343 測試）、`npm run build`、`npm run check:dist`（9 個檔案、5.25 MiB）全部通過。
- 無頭驗收（Vitest + Rapier）：二段跳從最高點再升 1.05–1.16 m（7.3²／48 ≈ 1.11）、只有 1 次、著地／跑牆／抓鉤附著重置、水平導向 45° 且速率不變、土狼時間內是土狼起跳、落地保護（落地前 0.12 s 按跳是落地起跳、0.3 s 前是二段跳）；4.0 m 牆起跳後二段跳攀上（無頭與訓練場攀爬測試牆）。噴射：二段跳後 0.12 s 啟動、垂直速度最高 5 m/s、推進中每秒耗 1 s 燃料、約 1.0 s 後 `empty` 停止、耗盡後純重力；著地 0.3 s 內不回充、之後每秒 0.8、回滿時間符合；跑牆中直接回充；地面起跳按住不噴射；水平推力。Dash：60／120／144／240 Hz 平地位移 7 m ±5%、0.15 s 內完成、結束 12 m/s；兩次後第三次無效、1.8 s 後恢復一次；輸入方向／無輸入向前；空中 Dash 高度不變、垂直速度 0；結束速度 max(原速度, 12)；跑牆、滑鏟中可 Dash，地面 Dash 結束按住蹲接滑鏟；撞牆不穿牆；關閉與能力修正（+1 充能、× 1.5 距離）。抓鉤：30 m 牆約 0.2 s 附著、被拉到 2.5 m 內 `close` 脫鉤、最高 26 m/s、脫鉤保留速度、冷卻 4 s；50 m 牆在 0.3 s 時 `range` 落空、0.8 s 冷卻（冷卻結束前按不出、結束後可以）；不可勾表面 `surface`、飛行中放開 `cancel`；放開 F `input`；按跳脫鉤 +5 m/s 並可再二段跳；2.5 s `timeout`、重力 × 0.4；繩長約束下距離不變長且有擺盪；飛越細柱 `passed` 並保留速度；關閉抓鉤、攀爬中不能發射；抓鉤打斷 Dash、Dash 不能打斷抓鉤；Dash 衝向邊緣轉攀爬；重生補滿。訓練場：從塔前 20 m 抓鉤 20 m 高塔，最後站上塔頂。
- 連招（無頭腳本，`tests/movement-abilities.test.ts` 最後一項）：衝刺 → 滑鏟 → 滑鏟跳 → 右牆跑牆 → 蹬牆跳 → 二段跳 → Dash → 抓鉤，途中不落地，每一步水平速度都不低於前一步的 75%（Dash 結束與 Dash 前比較），進入跑牆後一直 ≥ 8 m/s。各段進入時的水平速度：滑鏟 13.9 → 空中 12.3 → 跑牆 11.2 → 空中（蹬牆跳）12.3 → Dash 46.7（位移速度）→ 空中 12.3 → 抓鉤 12.7 → 0.4 s 後 26.0 m/s。
- headless Chrome（SwiftShader）以 CDP 連 `npm run sim`，11 項檢查全部通過：遊戲直接開啟（`#debug&nolock`）並進入 playing；調參面板有「能力開關／二段跳／噴射／Dash／抓鉤／抓鉤繩索（視覺）」；左 Shift Dash；Space 起跳後空中再按為二段跳、按住噴射（燃料由 1.0 降到 0.58）；在高塔前對準塔頂時「可勾取」為 true；按住 F 發射並附著（繩索顯示）、`close` 脫鉤、最後站上 20 m 塔頂；平台模擬頁的跨來源 iframe 正常載入。截圖確認繩索從畫面右下連到錨點。主控台只有 Rapier 初始化訊息。

### 未驗證

- **實機手感與速度曲線截圖**（驗收「實機」項目）：沒有有頭瀏覽器與實體滑鼠可實際遊玩，連招只以腳本輸入在無頭測試與 headless Chrome 確認功能與速度數據，主觀流暢度與手感沒有試玩，數值也沒有依試玩調整；調參面板的速度曲線沒有實機截圖。
- 繩索視覺的實際觀感：headless 截圖只看到附著後與發射 0.25 s（已接近拉直）的畫面，發射波形與彈性抖動的動態效果、1 px 線寬在高解析度下是否太細，都沒有實際看過。
- 抓鉤手感疑慮（需實機確認後調整）：拉向斜上方的錨點時以 26 m/s 脫鉤，會沖過頭（訓練場 20 m 塔約沖高到 29 m 才落回塔頂）；錨點仰角很低（約 11° 以下）時，拉力的垂直分量與 0.4 倍重力相近，玩家會擦地被拖行。
- 抓鉤「切換模式」（`setToggle` 關閉切換狀態）沒有在瀏覽器或測試中實際操作過（ScriptedInput 只模擬按住模式）。
- headless Edge 未執行（M1-04 已記錄 Edge 的 CDP 合成輸入送不進 iframe）；實體 GPU 上的效能（每畫面多 1 次準星 raycast，鉤爪飛行中每步 1 次 raycast）。
