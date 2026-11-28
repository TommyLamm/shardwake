# M1-12 靶標、玩家受擊與戰鬥回饋

- 里程碑：M1 手感原型
- 前置：M1-10（建議先完成 M1-11）
- 狀態：完成

## 目標

讓每一次命中、爆頭、擊殺、受擊都有清楚的回饋，並提供會反擊的靶標來測試閃避手感。

## 範圍

- 包含：傷害介面與命中區、三種靶標、DPS 計、玩家護盾與生命、命中標記、傷害數字、受擊方向指示。
- 不含：真正的敵人 AI（M3）、元素與防禦層（M2-02）。

## 任務

- [x] `combat/Damage.ts`：`Damageable` 介面（`applyDamage(info)`）；命中區 `hitZone: 'body' | 'crit'` 由 collider 標記；傷害計算管線（基礎 → 距離衰減 → 爆頭倍率 → 之後 M2-02 加入詞綴與元素）。（`Damageable`、`registerHitbox` 在 M1-10 已建立；本計畫抽出 `computeDamage` 管線，Ballistics 的 hitscan、投射物直擊與範圍傷害都改經過它）
- [x] 靶標（`combat/targets/`）：
  - 靜態假人：身體加頭部弱點；1000 HP，2.5 s 未受傷就回滿；被「擊殺」時倒下，1.5 s 後重置；命中時閃白。
  - 移動靶：在軌道上左右移動（3–8 m/s，隨機變向）。
  - 訓練無人機：在戰區內以 12–25 m 半徑繞著玩家飛，偶爾換高度；每 1.5 s 發射慢速能量球（18 m/s、拖尾明顯，可用 Dash 閃避）；150 HP、核心是弱點；擊毀時爆炸，5 s 後重生；進入戰區才啟動，可在選單與調參面板關閉。（「選單」為設定「訓練無人機」；設定頁 UI 在 M1-14）
- [x] DPS 計：靶場看板顯示最近 5 s 的滾動 DPS、總傷害、爆頭率。
- [x] 玩家生命：護盾 100（3 s 未受傷後以每秒 40 回復）、生命 100（原型中慢速回復）；死亡 → 0.8 s 淡出 → 在出生點重生；事件 `playerDamaged { amount, dir, shieldBroken }`、`playerDied`。（實際名稱 `player:damaged`、`player:died`，另有 `player:revived`、`player:shield`）
- [x] 命中回饋（`ui/`）：
  - 命中標記：一般（白色 X）、爆頭（黃色、較大）、擊殺（紅色、短暫放大並輕微震動）。
  - 浮動傷害數字：DOM 物件池（上限 48），從命中點投影到螢幕後往上飄散；爆頭是黃色並放大；同一目標短時間內的數字可以合併累加（設定可切換）。
  - 受擊方向指示：螢幕邊緣依攻擊來源方向出現紅色弧形；護盾破裂時出現藍色碎裂邊框；低生命時出現紅色暗角。（弧形畫在畫面中心周圍半徑 20% 短邊處，見實作紀錄）
- [x] 調參面板：設定靶標血量、無人機開關與數量、無敵模式。

## 交付（給後續計畫）

- `Damageable`、命中區標記方式、傷害計算管線（M2-02 擴充，M3 的敵人實作）。
- 玩家 `Health`（護盾／生命）與受擊事件。（實際類別 `PlayerHealth`）
- 傷害數字與命中標記元件（M2-02 會加入元素與防禦層的顏色）。
- 實際 API 摘要見實作紀錄。

## 驗收

- [x] 測試：爆頭倍率、距離衰減、範圍傷害計算正確；DPS 計的數值與注入的傷害序列一致。（`tests/combat.test.ts`：`computeDamage` 純函式；Rapier 假人的步槍爆頭 18 × 1.8、45 m 衰減、手炮 75 m 爆頭 60 × 0.7 × 2、電漿範圍衰減；DPS 計對 10 發/s × 18 的序列在 t = 2 s 為 189、t = 6 s 為 180，閒置重設、爆頭率；無頭 WeaponSim × 假人的實測 DPS 與預估誤差 < 3%）
- [ ] 實機：靶場上每把武器的實測 DPS 與預估值相近（記錄表格）；無人機的能量球可以用 Dash、滑鏟、跑牆閃避。（部分驗證：DPS 表格以無頭模擬記錄（見實作紀錄），沒有真人實機量測；閃避以單元測試（10 m/s 側移即可閃過）與 headless 瀏覽器的能量球命中事件驗證，沒有真人以 Dash、滑鏟、跑牆實際閃避）
- [x] 受擊方向指示正確：從左邊被打時，指示出現在左邊。（單元測試：多個視角下「視角左方」的攻擊者都是 −90°；headless Chrome：「從左邊受擊」後弧形 `rotate(-1.5708rad)`、「從右邊受擊」`rotate(1.5708rad)`，截圖 `M1-12-shield.png`）

## 實作紀錄

完成日期：2026-11-28。

### 新增／修改檔案

- 新增 `src/combat/`：`PlayerHealth.ts`（玩家護盾／生命、死亡與重生、`PLAYER_HEALTH_CONFIG`／面板）、`DpsMeter.ts`（DPS 計與 `estimateWeaponDps`）、`HitConfirm.ts`（每步彙總命中 → `combat:hit`）、`HostileBolts.ts`（敵方能量球池）、`sweep.ts`（球對膠囊的掃掠判定純函式）、`CombatPanel.ts`（調參面板「戰鬥」）、`targets/TargetConfig.ts`（數值、面板規格、訓練場擺放 `TRAINING_TARGET_LAYOUT`）、`targets/targetMath.ts`（`TargetLife`、`RailMotion`、`DroneMotion` 純邏輯）、`targets/Targets.ts`（`DummyTarget`、`DroneTarget`）、`targets/TargetVisuals.ts`（程序幾何與材質）、`targets/DpsBoard.ts`（DPS 看板）、`targets/TargetManager.ts`（Game 系統）。
- 新增 `src/ui/`：`FeedbackConfig.ts`（`FEEDBACK_CONFIG` 與面板規格）、`feedbackMath.ts`（命中標記樣式、傷害數字池、受擊方向、暗角的純邏輯）、`HitMarker.ts`、`DamageNumbers.ts`、`DamageOverlay.ts`。
- 修改：`src/combat/Damage.ts`（`computeDamage`、`DamageCalcInput`、`DamageBreakdown`、`splashMultiplier`、`damageSourcePosition`）、`src/weapons/Ballistics.ts`（傷害改經 `computeDamage`，結果逐位元相同）、`src/core/events.ts`（`combat:hit`、`player:damaged／died／revived／shield`、`target:killed／reset`、`enemy:fire／projectile`）、`src/core/Settings.ts`（4 個新設定）、`src/main.ts`（建立與接線、受擊鏡頭、擊殺與能量球特效、面板、`__shardwake`）、`src/style.css`、`src/combat/index.ts`、`src/ui/index.ts`。
- 測試：新增 `tests/combat.test.ts`（41 項）。全專案 25 檔、516 測試。
- 截圖：`docs/screenshots/M1-12-{hits,kill,shield,drones}.png`（960 × 540、每通道 16 階，104–220 KB）。
- `README.md`、`PLAN.md`（M1-12 → 完成）。沒有新增套件。

### 實際 API 摘要（給後續計畫）

- **傷害管線（M2-02 擴充、M3 使用）**：`computeDamage(input, out?) → DamageBreakdown { base, falloff, crit, zone, isCrit, amount }`；`input = { base, distance, falloffStart, falloffEnd, minMult, critMult, zone, zoneMultiplier?, splash?: { radius, minMult } }`。順序：基礎 × 距離衰減（範圍傷害改用 `splashMultiplier`，且不算弱點）× 弱點倍率 × 部位倍率；M2-02 在弱點之後加入詞綴、元素與防禦層（在 `DamageBreakdown` 加欄位），perk 的 `modifyDamage` 仍在 `Ballistics.deal`。`damageSourcePosition(info, out)` 由命中點、方向與距離倒推攻擊者位置。
- **命中區標記**：碰撞體放 `COLLISION_PRESETS.enemy`，`registerHitbox(physics, collider, target, 'body' | 'crit', { multiplier, surface })`。弱點碰撞體要突出本體（hitscan 依距離取第一個部位）：假人頭部球、無人機核心球在本體球前方 0.4 m。範圍傷害同目標取身體。
- **玩家生命 `PlayerHealth`**（main 的 `health`，Game 系統 order combat）：實作 `Damageable`（id `'player'`；`Ballistics` 的 `getSelfTarget`、`HostileBolts` 的目標）。`state { shield, health, maxShield, maxHealth, alive, dying, sinceDamage, shieldRecharging, fade, deaths, time }`、`healthFraction`、`shieldFraction`、`applyDamage(info)`、`kill()`、`refill()`、`reset()`、`step(dt)`；`config`（`PLAYER_HEALTH_CONFIG`：`maxShield`、`maxHealth`、`shieldRegenDelay`、`shieldRegenRate`、`healthRegenDelay`、`healthRegenRate`、`deathFadeTime`、`reviveFadeTime`、`respawnAt`、`invulnerable`）。選項 `onRespawn`（main：傳送到出生點或最近檢查點、清掉投射物與受擊指示）。死亡中 `WeaponManager.getPlayer` 回傳 null（不能射擊）。
- **事件**（payload 重複使用）：
  - `player:damaged { amount, shieldDamage, healthDamage, shield, health, shieldBroken, blocked, dir, sourcePos, source, weaponId }`（`blocked` = 無敵模式；`dir` 為攻擊者 → 玩家）——M1-13 受擊／護盾破裂音效、M1-14 護盾與生命條。
  - `player:died { source, weaponId, deaths }`、`player:revived { deaths }`、`player:shield { phase: 'recharge' | 'full', shield }`（M1-13 護盾回充音效）。
  - `combat:hit { kind: 'hit' | 'crit' | 'kill', hits, crits, kills, amount, weaponId }`：玩家這一步造成的命中彙總，每步最多一次（M1-13 命中／爆頭／擊殺音效用這個，不要用每顆彈丸的 `combat:damage`）。
  - `combat:damage` 現在也包含打在玩家身上的傷害（`target` 為 `PlayerHealth`、`source` 為攻擊者 id）；只要玩家造成的傷害用 `isPlayerHit(info, self)`。
  - `target:killed { id, kind: 'dummy' | 'mover' | 'drone', point, weaponId, isCrit }`、`target:reset { id, kind }`。
  - `enemy:fire { source, position, dir, speed }`、`enemy:projectile { phase: 'impact' | 'hitPlayer' | 'expire', id, source, position, normal }`（M1-13 能量球發射與命中音效；M3 的敵人沿用）。
- **靶標 `TargetManager`**（main 的 `targets`，Game 系統 `targets`、order ai）：`build()`（關卡載入後；`level:unloaded` 自動 `destroy()`）、`applyConfig()`（血量上限、部位倍率、無人機數量）、`resetAll()`、`clearBolts()`、`dpsSnapshot()`、`step(dt)`（無頭）、`dummies`（`DummyTarget`：`life`、`position`、`rail`、`fall`、`flash`）、`drones`（`DroneTarget`：`motion`、`facing`、`active`、`engaged`、`corePosition()`）、`bolts`（`HostileBolts`）、`dps`（`DpsMeter`）、`engaged`、`config`（`TARGET_CONFIG`）、`layout`（`TRAINING_TARGET_LAYOUT`）、`visuals`。選項：`getPlayer() → { feet, height, radius, center, eye } | null`、`getPlayerTarget`、`getZoneId`、`dronesEnabled`、`weaponName`。
- **敵方投射物 `HostileBolts`（M3）**：`spawn(source, origin, dir, speed, damage, radius, lifetime, weaponId?)`、`step(dt)`、`clear()`、`pool`、`stats`；選項 `getPlayerCapsule() → { a, b, radius }`、`getPlayerTarget()`。外觀用 `PlasmaBolts`（`TargetManager.render` 示範）。
- **回饋 UI（M1-14 組合進 HUD）**：`HitMarker`（`root`、`trigger(kind)`、`counts`）、`DamageNumbers`（`root`、`model`、`clear()`；M2-02 的元素顏色加在 `FEEDBACK_CONFIG.numbers` 與 `damageNumberStyle`）、`DamageOverlay`（`root`、`model`、`clear()`；方向指示、護盾破裂、受擊閃光、低生命暗角、死亡淡出）。純函式：`hitMarkerStyle`、`DamageNumberModel`、`damageNumberStyle`、`damageIndicatorAngle(yaw, px, pz, sx, sz)`（0 = 前、正值 = 右）、`DamageIndicatorModel`、`lowHealthIntensity`、`hitTrauma`。
- **DPS**：`DpsMeter`（`record(time, amount, isCrit, weaponId)`、`dps(now)`、`snapshot(now)`、`reset()`）、`estimateWeaponDps(def, { distance, critFraction, splashMult }) → { perShot, shotsPerSec, burst, sustained, cycle }`。

### 偏離計畫之處與設計決定

- **傷害管線**：M1-10 已經在 `Damage.ts` 有 `Damageable`／`Hitbox`／`registerHitbox`，傷害算式寫在 `Ballistics` 三處。本計畫抽成 `computeDamage`（乘法順序不變，既有 475 項測試全部照過），沒有另外做「命中區 hitZone 欄位」——命中區仍由 `registerHitbox` 的 zone 標記在 collider 上。
- **時間與步長**：靶標、無人機、能量球、玩家生命都在固定步推進；回滿、重置、護盾回復都從到期的那一刻起算，移動靶的變向在步中間到期時分段推進（60 與 240 Hz 軌跡一致）；能量球對玩家膠囊用解析掃掠（凸函數二分），命中位置與步長無關。
- **靶標碰撞體**：不掛剛體的碰撞體，移動靶與無人機每步 `setTranslation`（系統 order ai 在 physics 之前，下一步的射線就看到新位置）；死亡或停用的無人機關閉碰撞體（狀態改變時才 `markDirty`）。假人死亡時碰撞體仍在（`alive = false`，子彈與範圍傷害略過），玩家仍會撞到。
- **假人**：倒下方向 = 擊殺那一發的水平方向（往遠離射手倒），0.35 s 倒下、站起 0.3 s；閃白用每個靶標自己的材質複本改 `emissiveIntensity`（不重新編譯）。頭部弱點以橘色環與面罩標示。「2.5 s 未受傷就回滿」為一次回滿（不是逐漸回復）。
- **移動靶**用同一個假人模型放在滑台上（也有頭部弱點、1000 HP、倒下與重置）；靶場兩條軌道在 18 m、40 m（x −77 ～ −53），沒有放在 10／25／50／75 m 標線上，避免擋住標線上的假人。
- **無人機**：一律預先建立 6 架（數量上限），依設定與數量啟用，避免執行中建立網格與材質；預設 3 架。繞行用「玩家位置 + 半徑 × 角度」的目標點，目標點夾在戰區範圍（x 23–77、y 1–20、z −31–21）並與其他無人機保持 5 m，以最大速度 11 m/s、加速度 14 m/s² 追隨（不是瞬間就位）；高度範圍 6–11 m（計畫未指定，高於戰區最高 5 m 的柱子）；每 2.5–5.5 s 重新挑半徑與高度，35% 機率反轉繞行方向。開火從核心朝玩家中心（+0.1 m）直射、不預判，對玩家沒有視線（世界 raycast）時 0.25 s 後重試；啟動後第一發延遲 0.6–1.6 s。玩家離開戰區、死亡或除錯飛行時飛回北側待命點、不開火。擊毀時發 `target:killed`，main 以 `WeaponFx.spawnExplosion`（不留焦痕）與 `addTraumaAt` 表現。
- **能量球**：每顆 15 傷害、碰撞半徑 0.3 m、存在 4 s；對世界用 raycast（掩體擋得住），對玩家膠囊用解析掃掠，先碰到哪個算哪個。外觀沿用 M1-11 的 `PlasmaBolts`（同一個著色器，發光半徑 0.42 m、拖尾 3.2 m、橘色）。打到世界或玩家時以 `WeaponFx.spawnImpact`（energy 表面、橘色、不留彈孔）表現。
- **玩家生命**：受傷先扣護盾、溢出扣生命；生命回復「慢速」定為 5 s 後每秒 6。死亡中不受傷、不能射擊（移動不鎖），淡出 0.8 s 後在出生點重生（面板可改「最近檢查點」）並淡入 0.45 s；重生時清掉玩家與無人機的投射物、受擊指示。武器彈藥不補（避免打斷換彈狀態）。
- **無敵模式**：照常發 `player:damaged`（`blocked: true`），受擊方向（灰色）與鏡頭震動仍會出現，不扣血、不出現護盾破裂與色差。
- **受擊鏡頭（M1-08 留給本計畫決定）**：trauma = 0.12 + 傷害 × 0.004（上限 0.45），護盾破裂另加 0.15；往遠離攻擊的方向傾斜 2.5° × sin(方向角)；生命受傷時色差 0.2 + 傷害 × 0.006（0.2 s），護盾破裂色差 0.6（0.35 s）；無人機爆炸 `addTraumaAt(點, 0.35, 半徑 × 6)`。開火 trauma 沿用 M1-10 每把武器的 `feel.trauma`，沒有改。
- **命中確認**：計畫沒有寫彙總；為了霰彈 10 顆彈丸只觸發一次命中標記（與 M1-13 只播一次命中音效），新增 `HitConfirmSystem`（order combat）每步彙總並發 `combat:hit`。自傷不算命中。
- **受擊方向指示**：弧形在畫面中心周圍（半徑 = 畫面短邊 × 0.2，弧長 64°，兩端淡出），而不是貼在螢幕邊緣——邊緣在寬螢幕上離準心太遠、左右與上下的距離也不同；弧形指向攻擊者的世界位置，轉頭時跟著轉；同方向 25° 內合併、最多 6 個、1.3 s 淡出。
- **傷害數字**：DOM 池 48 個（滿了回收最舊的），合併鍵 = 目標 + 是否爆頭（爆頭與身體分開顯示）；合併時間 0.35 s 內的傷害累加並跳動，一個數字最多累加約 3.5 s 後換新的；距離 15 m 以外依距離縮小（最小 0.7）；擊殺的數字紅色放大。只顯示玩家打在其他目標上的傷害。
- **護盾破裂邊框**：Canvas 程序生成的分岔裂紋 + 邊緣藍色光暈，只在畫面尺寸或顏色改變時重畫；另加護盾受擊的淡藍與生命受擊的淡紅邊緣閃光。
- **DPS 計**：只計入玩家打在假人與移動靶上的傷害（`DamageInfo.amount`，在血量上限之前）；滾動 DPS = 最近 5 s 的傷害 ÷ min(5, max(1, 交戰經過時間))，交戰剛開始時不會被 5 s 稀釋；停火超過 5 s 後的下一筆傷害開始新的交戰。看板沿用 M1-09 的全息看板著色器（Canvas 每秒最多重畫 5 次、內容沒變就不重畫），位在射擊線前方 14 m 上空（y 7.6 m），不擋射線。
- **新設定**（`shardwake:settings:v1` 版本不變，舊存檔補預設值）：`hitMarkers`、`damageNumbers`、`damageNumberMerge`、`trainingDrones`（全部預設開）。計畫的「無人機可在選單關閉」以設定欄位實作，設定頁 UI 在 M1-14；調參面板「戰鬥/靶標/無人機/啟用」與設定同步。
- **預熱**：靶標、能量球、DPS 看板在載入預熱前建立並加入場景；著色器程式從 M1-11 的 26 增為 28（靶標本體的 MeshStandardMaterial 沒有貼圖，是新的組合），之後命中、擊殺、無人機開火與爆炸都不再增加。

### 調整過的數值

- 計畫指定的數值都照用（假人 1000 HP／2.5 s／1.5 s、移動靶 3–8 m/s、無人機 12–25 m／1.5 s／18 m/s／150 HP／5 s、護盾 100／3 s／40、生命 100、0.8 s 淡出、傷害數字池 48）。
- 計畫未指定、由本計畫決定（都在設定資料，可在面板調）：假人倒下 0.35 s／84°、站起 0.3 s、閃白強度 1.6／0.12 s；移動靶變向間隔 0.8–2.2 s、反向機率 0.5；無人機高度 6–11 m、切線速度 5 m/s、換位 2.5–5.5 s、反轉 0.35、最大速度 11、加速度 14、追隨增益 1.6、間距 5 m、首發 0.6–1.6 s、能量球傷害 15／半徑 0.3 m／4 s、爆炸半徑 2.2 m；生命回復 5 s 後 6/s、重生淡入 0.45 s；命中標記臂長 9／12／14 px、時間 0.16／0.24／0.42 s、放大 1.25／1.7、擊殺震動 2.5 px 38 Hz；傷害數字 17 px、存在 0.75 s、上飄 46 px、散開 26 px、爆頭 ×1.35、擊殺 ×1.2、合併 0.35 s；受擊方向 1.3 s、半徑 0.2、7 px、64°、合併 25°；護盾破裂 0.65 s、受擊閃光 0.18／0.25 s、低生命門檻 40%、暗角 0.8、脈動 1.3 Hz；受擊鏡頭見上。

### 實測 DPS 與預估（無頭模擬）

`estimateWeaponDps`：爆發 = 每發傷害 × 每秒發數；持續 = 一個「打空 → 空倉換彈」循環的平均。實測 = `WeaponSim`（真實 `WeaponManager` 與 `Ballistics`、Rapier 假人）對準 10 m／25 m 假人軀幹中心、全自動按住、半自動以最高射速點擊、換彈中不按（補彈點後按開火會取消剩下的換彈，見 M1-10），量測 3 個循環。**不壓槍**（沒有真人往下拉），所以後座大的武器命中率低。

| 武器 | 距離 | 方式 | 預估爆發 | 預估持續 | 實測 | 實測／預估 |
| --- | --- | --- | --- | --- | --- | --- |
| 突擊步槍「斷流」 | 10 m | 散布與後座關閉 | 180 | 110.8 | 110.8 | 100% |
| 突擊步槍「斷流」 | 10 m | 腰射／開鏡（不壓槍） | 180 | 110.8 | 33.3／46.0 | 30%／41% |
| 散射霰彈槍「碎浪」 | 10 m | 腰射 | 139 | 86.7 | 33.2 | 38%（10 顆彈丸的圖案大於假人） |
| 重型手炮「裂錨」 | 10 m | 腰射／開鏡 | 160 | 100.0 | 100.1／100.1 | 100% |
| 重型手炮「裂錨」 | 25 m | 腰射／開鏡 | 160 | 100.0 | 70.9／100.1 | 71%／100% |
| 磁軌狙擊槍「垂線」 | 25 m | 腰射／開鏡 | 128 | 82.8 | 6.9／82.8 | 8%／100% |
| 電漿發射器「曙核」 | 10／25 m | 腰射（直擊 90 + 範圍） | 181 | 110.0 | 109.3／109.2 | 99% |

`tests/combat.test.ts` 以散布與後座關閉的步槍、手炮、狙擊驗證實測與預估誤差 < 3%（實際 0–0.1%）。

### 實際驗證

- `npm run typecheck`、`npm test`（25 檔、516 測試）、`npm run build`、`npm run check:dist`（9 個檔案、5.66 MiB）全部通過。
- 單元測試（`tests/combat.test.ts` 41 項）：`computeDamage` 的爆頭、部位倍率、衰減、範圍衰減與 `falloffMultiplier` 一致；Rapier 假人的爆頭、衰減、範圍傷害；擊殺、死亡不擋子彈、倒下、1.5 s 重置、2.4 s 未回滿／2.5 s 回滿（60／120／240 Hz）；面板改血量與頭部倍率立即生效；移動靶留在軌道、速度範圍、會變向、60／240 Hz 一致；無人機繞行 12–25 m、高度、彼此距離、夾在戰區內；幾何與碰撞體尺寸一致；掃掠判定與暴力取樣一致（200 組）；能量球打中靜止玩家（扣護盾 15、命中位置與步長無關、`damageSourcePosition` 倒推出發射點）、被掩體擋下、10 m/s 側移可閃開；無人機依數量與設定啟用、不在戰區不開火、在戰區 10.5 s 內每架 6–7 發、核心弱點（手炮 120）、擊毀後碰撞體關閉、5 s 重生；被打到死亡後 0.8 s 重生回滿、死亡中不開火；護盾與生命回復（三種步長）、無敵模式、kill／refill／reset；DPS 計的注入序列、閒置重設、容量擴充、實測與預估；命中確認（霰彈只發一次、優先順序、自傷不算）；命中標記樣式、傷害數字合併／不合併／池滿回收／樣式、受擊方向（左 −90°、右 +90°、前 0、後 180°，轉頭後）、指示合併與淡出、低生命暗角、受擊震動；新設定預設值與舊存檔補值；面板涵蓋所有數值欄位；訓練場擺放。
- headless Chrome 158（ANGLE D3D11）以 CDP 開 `vite preview` 的 `#debug&nolock`，31 項檢查全部通過：啟動並進入 playing；5 假人 + 2 移動靶 + 6 架無人機（3 架啟用）與 DPS 看板；手炮開鏡打 25 m 假人頭部（弱點、含衰減的傷害正確）、`combat:hit` 為 crit、命中標記觸發；**第一次命中後著色器程式數不變（28 → 28）**；DPS 計的總傷害與命中數等於傷害事件、爆頭率 1/5；血量改成 150 後擊殺（`target:killed`、命中確認 kill、紅色命中標記）、倒下進度 1、1.5 s 後重置回滿；移動靶在移動；「從左邊受擊」→ 弧形 −90°、「從右邊受擊」→ +90°；60 傷害打破護盾並顯示碎裂邊框；低生命暗角；死亡淡出後在出生點重生、回滿；進入戰區後 3 架無人機開火、能量球打到玩家；無人機與能量球出現後、擊毀無人機後著色器程式數仍為 28；狙擊槍擊毀無人機；無敵模式受擊回報 blocked 但不扣護盾；設定關閉訓練無人機後全部停用並寫入 `shardwake:settings:v1`；主控台沒有錯誤或例外（只有 Rapier 初始化與預熱訊息）。draw call 約 53–89（視角內的靶標數而定）。截圖：`M1-12-hits.png`（步槍連射：命中標記、黃色爆頭與白色傷害數字、DPS 看板）、`M1-12-kill.png`（手炮爆頭擊殺：紅色 120、假人倒下）、`M1-12-shield.png`（左右受擊的弧形與護盾破裂邊框）、`M1-12-drones.png`（戰區的無人機與能量球）。
- 結束後確認自己啟動的 vite preview 與 headless Chrome 都已關閉、暫存設定檔已刪除。

### 未驗證

- **打擊感與回饋強度**：沒有真人以有頭瀏覽器、實體滑鼠試玩；命中標記大小與時間、傷害數字的飄動與合併、受擊震動與傾斜、色差、護盾破裂邊框、低生命暗角是否清楚又不干擾，只看過靜態截圖與數值，留給 M1-16 依試玩調整。沒有音效（M1-13），命中與受擊回饋目前只有畫面。
- **閃避手感**（驗收「實機」）：能量球 18 m/s 是否「用 Dash、滑鏟、跑牆閃得掉但需要注意」只以單元測試（10 m/s 側移可閃過）推論；無人機的繞行路線、同時 3 架的壓力、傷害 15 是否合適沒有實際試玩。
- **實測 DPS 表**是無頭模擬（不壓槍、固定瞄準軀幹中心），不是真人在靶場上的量測。
- **實機效能**：GTX 1650 實體 GPU 上的 FPS 未量測（headless 約 52 FPS 受限於 headless 本身）；每個靶標 2 個網格（本體會投影），6 架無人機全開時多約 12 個 draw call；DOM 傷害數字每畫面最多更新 48 個元素的 transform。
- 平台模擬頁（跨來源 sandbox iframe）內沒有重跑；Edge 沒有重跑（只用 Chrome）。
- 無人機在玩家站在戰區邊緣時會被夾在戰區內，可能比 12 m 更近；無人機之間、無人機與高處掩體的碰撞沒有處理（飛行高度高於所有掩體）。
