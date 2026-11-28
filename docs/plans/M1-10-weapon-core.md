# M1-10 武器核心邏輯

- 里程碑：M1 手感原型
- 前置：M1-05（使用 M1-03 的輸入）
- 狀態：完成

## 目標

建立純資料驅動、與畫面更新率無關的武器邏輯。之後的刷寶生成器只要產生 `WeaponDef` 就能用。

## 範圍

- 包含：`WeaponDef` 資料結構與驗證、5 把原型的數值、射擊狀態機、換彈、散布、後座、開鏡、彈道（hitscan 與投射物）、近戰、武器管理、傷害事件、測試。
- 不含：槍模、動畫、特效、準星（M1-11）；靶標與受擊回饋（M1-12）；音效（M1-13）。

## 任務

- [x] `weapons/WeaponDef.ts`（型別與驗證函式）：
  - `id`、`name`、`archetype`
  - `fire`：`{ mode: 'auto' | 'semi' | 'burst' | 'pump', rpm, burstCount?, burstRpm?, pellets, triggerBuffer }`
  - `damage`：`{ base, critMult, falloffStart, falloffEnd, minMult, penetration }`
  - `projectile?`：`{ speed, gravity, radius, lifetime, splashRadius, splashDamage, splashMinMult, selfKnockback, selfDamageMult }`（實作新增 `lifetime`、`splashMinMult`）
  - `ammo`：`{ type: 'mag', mag, reloadTactical, reloadEmpty, reloadPerShell?, reloadAmmoPoint, reserve: 'infinite' | number }`（M2-01 會加入 `type: 'heat'`）
  - `spread`（角度）：`{ hip, ads, perShot, max, recoveryPerSec, recoveryDelay, moveMult, airMult, pelletPattern? }`（實作新增 `recoveryDelay`）
  - `recoil`：`{ pitchPerShot: [min, max], yawPerShot: [min, max], yawBias, firstShotMult, recoveryPerSec, recoveryDelay, adsMult, maxClimb }`
  - `handling`：`{ swapIn, swapOut, adsTime, adsZoom, sprintToFire, adsMoveSpeedMult }`
  - `feel`：`{ trauma, viewKick: { pos, rot }, kickSpring, fovKick }`（給 M1-11；實作新增 `fovKick`）
  - `audio`：合成配方 id 與參數（給 M1-13）
  - `model`：槍模部件描述（給 M1-11 的 WeaponModelFactory）
  - `perks`：先是空陣列，保留 hook 介面給 M2-02
- [x] `weapons/archetypes.ts`：5 把原型的初始數值。

  | 武器 | 模式 | RPM | 傷害／爆頭倍率 | 彈匣 | 換彈（戰術／空倉） | 備註 |
  | --- | --- | --- | --- | --- | --- | --- |
  | 突擊步槍 | 全自動 | 600 | 18／×1.8 | 32 | 1.6／2.0 s | 30→60 m 衰減到 60% |
  | 散射霰彈槍 | 泵動 | 80 | 12 × 10 彈丸／×1.5 | 6 | 逐發 0.45 s | 固定彈丸圖案；8→20 m 衰減到 20% |
  | 重型手炮 | 半自動 | 160 | 60／×2.0 | 8 | 1.8 s | 強烈上跳、快速回正 |
  | 磁軌狙擊槍 | 半自動 | 55 | 140／×2.5 | 4 | 2.4 s | 穿透 3 個目標；開鏡 4×；腰射散布 3° |
  | 電漿發射器 | 半自動投射物 | 70 | 直擊 90＋範圍 70（半徑 4 m） | 4 | 2.2 s | 投射物 45 m/s；自身擊退 12 m/s；原型無自傷 |

- [x] `weapons/Weapon.ts` 執行期狀態機：`idle / firing / reloading / swapping / meleeing`。射擊用「下一發時間」累加（`nextShotTime += 60 / rpm`），同一步可以補多發，保證 RPM 與步長無關；半自動扳機緩衝 0.08 s（略早按下，等到可以射擊時仍會發射）；連發；泵動。（切槍與近戰狀態由 `WeaponManager` 管理，狀態值在 `weapons.state.phase`）
- [x] 換彈：戰術與空倉時間不同；在 `reloadAmmoPoint`（例如 0.7）之前切槍或衝刺 → 取消且不補彈，之後 → 已補彈；霰彈逐發裝填可被開火中斷；空倉時自動換彈。（衝刺取消只在手動衝刺模式按下衝刺鍵時，見實作紀錄）
- [x] 散布：依開鏡進度在腰射與開鏡之間內插；每發擴散與回復；移動／空中倍率偏寬鬆，鼓勵移動中射擊；霰彈使用固定彈丸圖案加上整體散布。
- [x] 後座：每發加上 pitch／yaw 增量（隨機範圍＋偏向），累積成「後座偏移」直接加到視角；停火 `recoveryDelay` 後以 `recoveryPerSec` 回正，只回正後座造成的部分，不抵銷玩家自己的壓槍；開鏡時套用倍率。
- [x] 開鏡：開鏡進度 0→1（`adsTime`）；FOV 依 `adsZoom` 縮放；開鏡靈敏度預設依焦距換算 `tan(adsFov / 2) / tan(hipFov / 2)`，再乘上使用者倍率；衝刺、Dash、攀爬時強制退出開鏡。
- [x] `weapons/Ballistics.ts`：
  - Hitscan：從相機位置沿「視線＋散布」射出射線；在 `penetration` 次數內穿透敵人（不穿牆）；套用距離衰減；回傳命中清單。
  - 投射物：物件池化，每步用線段 raycast 前進（不穿過薄牆）；碰撞時造成直擊與範圍傷害（依距離衰減，並檢查視線遮擋）；範圍內的玩家受到擊退（加到玩家速度，可以火箭跳）。
- [x] 近戰（V）：前方錐形 `overlap`，範圍 3.5 m；有目標時短距離突進吸附；傷害 55、冷卻 0.6 s。
- [x] `weapons/WeaponManager.ts`：5 個欄位（1–5）、滾輪循環、Q 切回上一把；切槍時間 = 舊槍 `swapOut` ＋ 新槍 `swapIn`；自動衝刺時按開火，會先在 `sprintToFire` 內退出衝刺。
- [x] 傷害事件：`DamageInfo { amount, isCrit, point, normal, dir, source, weaponId, isKill }` 經 EventBus 發出（M1-12 使用）。（另加 `target`、`zone`、`kind`、`shotId`、`distance`；定義在 `combat/Damage.ts`）
- [x] 調參面板「武器」資料夾：綁定目前手持武器的所有欄位，修改即時生效；可匯出單把武器的 JSON。

## 交付（給後續計畫）

- `WeaponDef` 型別與驗證（M2-01 生成器的輸出格式）。
- `Weapon` 狀態與事件：`weaponFire`、`reloadStart`、`reloadEnd`、`swap`、`adsChange`、`melee`。（實際名稱：`weapon:fire`、`weapon:reloadStart`、`weapon:reloadEnd`、`weapon:swap`、`weapon:ads`、`weapon:melee`，另有 `weapon:hitscan`、`weapon:dryFire`、`weapon:reloadShell`、`weapon:projectile`、`weapon:explosion`）
- `Ballistics` 的命中結果與 `DamageInfo`（`combat:damage` 事件）。
- 實際 API 摘要見實作紀錄。

## 驗收

`tests/weapons.test.ts`：

- [x] 600 RPM 在 1/60、1/120、1/240 步長下按住 10 s，都是 100 ± 1 發。（三種步長都是 100 發，開火時間、方向、後座與散布擴散逐發一致，誤差 < 1e-9）
- [x] 換彈在 ammoPoint 之前取消不補彈、之後取消已補彈；霰彈逐發裝填可被開火中斷。（三種步長）
- [x] 停火後散布回到基礎值；後座回正量不超過累積量。（三種步長；另驗證回正後視角回到原點、回正中畫面不再上跳、壓槍吸收）
- [x] 投射物不會穿過 0.2 m 的薄牆；範圍傷害被牆擋住時不生效。（30／60／120／240 Hz × 45／300 m/s × 半徑 0.15／0）

## 實作紀錄

完成日期：2026-11-28。

### 新增／修改檔案

- 新增 `src/weapons/`：`WeaponDef.ts`（型別、`validateWeaponDef`／`assertWeaponDef`、`cloneWeaponDef`、`shotInterval`、`zoomedFov`、`adsSensitivityRatio`）、`archetypes.ts`（5 把原型、`ARCHETYPES`、`createArchetype`、`defaultLoadout`、`ringPattern`）、`WeaponConfig.ts`（`WEAPON_SYSTEM_CONFIG`：近戰與共用規則）、`perks.ts`（perk hook 介面與註冊）、`weaponMath.ts`（散布、瞄準方向、`RecoilState`）、`Weapon.ts`、`Ballistics.ts`、`WeaponManager.ts`、`WeaponPanel.ts`；`index.ts` 匯出全部。
- 新增 `src/combat/Damage.ts`（`DamageInfo`、`Damageable`、`Hitbox`、`registerHitbox`、`hitboxOf`、`falloffMultiplier`）；`combat/index.ts` 匯出。
- 修改：`src/core/events.ts`（`weapon:*`、`combat:damage`）、`src/core/Settings.ts`（新設定 `adsSensitivity`）、`src/physics/Physics.ts`（`raycastAll()`／`rayAllResults`）、`src/camera/CameraRig.ts`（`fovZoom` 開鏡縮放）、`src/player/PlayerController.ts`（`addImpulse()`、選項 `getMoveSpeedScale`）、`src/main.ts`（建立 `Ballistics`／`WeaponManager`，開火 trauma／FOV 衝擊、爆炸震動與色差，「武器」面板，`__shardwake` 加 `weapons`、`ballistics`、`weaponPanel`、`combat`）。
- 測試：新增 `tests/weapons.test.ts`（50 項，含全部驗收）、`tests/helpers/weaponSim.ts`（`WeaponSim`、`FakePlayer`、`TestTarget`、`addWall`、`addTargetBall`）。全專案 23 檔、451 測試。
- `README.md`（狀態、武器操作、「武器」面板）、`PLAN.md`（M1-10 → 完成）。沒有新增套件。

### 實際 API 摘要（給後續計畫）

- **WeaponDef（M2-01 生成器輸出）**：欄位見 `WeaponDef.ts` 開頭註解。`validateWeaponDef(x)` → `{ ok, errors }`（任意輸入、不丟例外）、`assertWeaponDef`、`cloneWeaponDef`。單位：秒、度、公尺。`spread` 是錐形半角；`recoil.yawPerShot` 往右為正；`damage.penetration` = 可穿過的目標數（狙擊 2 = 最多命中 3 個）；`ammo.reserve` 'infinite' 或整數；`reloadPerShell` 有值 = 逐發裝填（`reloadTactical`／`reloadEmpty` 變成裝第一發前的準備時間）；`handling.adsZoom` = tan(FOV/2) 的除數。`perks: { id, params? }[]`，實作以 `registerPerk(id, factory)` 註冊（hook：`onFire`、`modifyDamage`、`onHit`、`onReload`；未註冊的 id 略過並警告一次）。
- **WeaponManager**（main.ts 的 `weapons`，Game 系統 name `weapons`、order weapons）：`new WeaponManager({ getFrame, view, getPlayer, ballistics?, bus?, config?, loadout?, rng?, getSettings?, setToggle?, mouse?, camera? })`；`step(dt)`（無頭測試）、`render(alpha)`。查詢：`active`（`Weapon`）、`activeSlot`、`slots`、`state`（HUD：`slot`、`weaponId`、`name`、`phase` idle／firing／reloading／swapping／meleeing、`ammo`、`mag`、`reserve`、`reloadKind`、`reloadProgress`、`ads`、`spread`、`swapProgress`、`swapTo`、`meleeCooldown`、`recoilPitch`、`recoilYaw`、`nextShotIn`、`shotsFired`）、`ads`／`previousAds`／`renderAds`（畫面插值後的開鏡進度，M1-11 viewmodel 用）、`currentSpread()`（準星大小，度）、`moveSpeedScale`、`recoil`（`RecoilState`）、`ballistics`、`swap`、`melee`。裝備：`equip(slot, def | null)`、`selectSlot(slot)`、`cycleFrom(slot, ±1)`。
- **Weapon**：`def`（可整個換掉）、`ammo`、`reserve`、`reloading`、`reload`（`kind`、`start`、`end`、`ammoPointTime`…）、`reloadProgress(t)`、`spreadAt(t, base)`、`nextShotTime`、`shotsFired`、`refill()`、`startReload(t)`、`cancelReload(t, reason)`。
- **Ballistics**（main.ts 的 `ballistics`）：`hitscan(origin, dir, shot, pellet)` → `HitscanResult { origin, dir, end, hitWorld, normal, surface, distance, targets[], targetCount }`（重複使用）；`spawnProjectile(origin, dir, shot, advance)`、`step(dt)`、`projectiles`（`Pool<Projectile>`：`position`、`previousPosition`、`velocity`、`origin`、`age`、`weaponId`；M1-11 畫電漿球用 `forEachActive`）；`explode(...)`、`lineOfSight(a, b, d)`、`findMeleeTarget(...)`、`deal(hitbox, amount, kind, point, normal, dir, distance, shot)`、`clear()`。
- **受擊目標（M1-12 靶標、M3 敵人）**：實作 `Damageable { id, alive, getCenter(out), applyDamage(info) → { dealt, killed } }`，碰撞體設 `COLLISION_PRESETS.enemy`，再 `registerHitbox(physics, collider, target, 'body' | 'crit', { multiplier?, surface? })`（存在 SurfaceRegistry 的 owner，換關卡自動清空）。同一目標可有多個 hitbox；只在 ENEMY 群組、沒有登記 hitbox 的碰撞體（例如移動用膠囊）子彈會穿過。玩家自傷：`Ballistics` 選項 `getSelfTarget`（`selfDamageMult > 0` 時）。
- **事件**（payload 重複使用，要保存請複製；同一步可能發多次）：
  - `weapon:fire { weaponId, slot, shotId, time, origin, dir, pellets, ammo, mag, spread, ads, mode, firstShot, recoilPitch, recoilYaw }`：每發一次（霰彈一發算一次）；origin = 眼睛，dir = 中心方向。M1-11 槍口閃光／viewmodel 後座、M1-13 開火音效。
  - `weapon:hitscan { shotId, weaponId, pellet, origin, end, normal, hitWorld, surface, targets }`：每顆彈丸（曳光從槍口畫到 end；hitWorld 時在 end 放彈孔與表面特效）。
  - `weapon:dryFire { weaponId, slot }`、`weapon:reloadStart { weaponId, slot, kind, duration, ammo }`、`weapon:reloadShell { weaponId, slot, ammo }`、`weapon:reloadEnd { weaponId, slot, completed, refilled, reason, ammo }`（reason：done／swap／sprint／fire／melee／other）。
  - `weapon:swap { phase: 'out' | 'in' | 'done', fromId, toId, fromSlot, toSlot, duration }`（out 的 duration = 收槍＋掏槍總時間；in 的 duration = 掏槍時間）。
  - `weapon:ads { weaponId, active, forced }`、`weapon:melee { phase: 'start' | 'hit' | 'miss', lunge, damage }`。
  - `weapon:projectile { phase: 'spawn' | 'impact' | 'expire', id, shotId, weaponId, position, velocity }`、`weapon:explosion { shotId, weaponId, point, normal, radius, targets, selfKnockback }`。
  - `combat:damage`：`DamageInfo { amount, isCrit, point, normal, dir, source, weaponId, isKill, target, zone, kind（hitscan／projectile／splash／melee）, shotId, distance }`。每顆彈丸、每次範圍、每次近戰各一筆；同一發用 `shotId` 合併（近戰 shotId 為負值、weaponId 'melee'）。
- **鏡頭與輸入的接點**：`CameraRig.fovZoom`（武器每畫面寫入；最終 FOV = 2·atan(tan(FOV/2)/fovZoom)）；`input.mouse.scale`（武器每畫面寫入：焦距換算 × 設定「開鏡靈敏度倍率」）；後座偏移寫入 `input.view.setOffset()`，命中判定與鏡頭都用 `viewYaw／viewPitch`；`PlayerController.addImpulse(dv)`（爆炸擊退）、`getMoveSpeedScale`（開鏡減速）。開火 trauma 與 `feel.fovKick` 目前在 main.ts 由 `weapon:fire` 接到 CameraRig（M1-11 可移到 viewmodel 系統）；爆炸 `addTraumaAt(point, 0.5, radius × 3)`，自身被擊退時 `pulseAberration(0.35, 0.2)`。
- **無頭測試**：`new WeaponSim({ hz?, loadout?, config?, ballistics?, bus?, settings?, player?, seed? })`，`input`（`ScriptedInput`）、`view`、`step()/run()/runUntil()`、`eventsNamed()`、`damage`；`TestTarget`、`addWall`、`addTargetBall`。

### 偏離計畫之處與設計決定

- **時間戳模型**：所有武器事件（開火、換彈補彈點與結束、逐發入膛、切槍、近戰命中）都有精確的模擬時間戳，同一步內依序處理；換彈或切槍在步中間結束後，剩下的時間可以接著射擊；投射物生成後在同一步內推進剩下的時間。結果與步長無關（測試比對 60／120／240 Hz 的逐發時間、方向、後座、散布，以及投射物爆炸點）。步邊界留 1e-7 s 容差：剛好落在步結束的事件交給下一步（否則模擬時間累加的浮點誤差會讓「第 101 發剛好在 10.000 s」在某些步長被算進來）。
- **全自動的單點**：全自動也有扳機緩衝（按下又在同一步放開也會打一發）。
- **散布新增 `spread.recoveryDelay`**（步槍 0.15、霰彈 0.2、手炮 0.1、狙擊 0.2、電漿 0.2 s）：原計畫的「每發擴散、持續回復」在步槍上（每秒 +1.8° vs 回復 8°/s）擴散永遠累積不起來，改成停火後才回復（與後座相同的模型，可任意切分）。
- **後座「不抵銷玩家壓槍」的做法（壓槍吸收）**：玩家視角朝後座偏移的反方向轉動時，先抵掉偏移、再把同樣的量轉進玩家視角（`view.set`，最終視角不變），回正只回正剩下的偏移；所以完全壓住後座的玩家停火後不會被拉到目標下方。系統參數 `recoilCompensation` 可關閉（關閉時回正會把整個偏移拉回）。後座偏移不寫進 `InputFrame`（M1-03 規則）；吸收會改寫玩家視角，M1-15 錄製的是之後的 InputFrame 視角，重播時同一個吸收量會再算一次、結果一致（未實測，留給 M1-15 確認）。
- **第一發**：距上一發超過 max(recoil.recoveryDelay, 1.5 × 射擊間隔) 才算第一發（套用 `firstShotMult`）。後座 yaw 資料以「往右為正」，偏移是視角慣例（往左為正）。
- **衝刺**：玩家「開火或開鏡時不衝刺」仍由 M1-05 依按鍵判斷；武器記錄最後一次衝刺步的結束時間，按開火後 `sprintToFire` 才能射擊。自動衝刺時按住開鏡本來就不會衝刺，所以「衝刺強制退出開鏡」只在手動衝刺模式按衝刺鍵時關掉切換模式的開鏡。**衝刺取消換彈只在手動衝刺模式按下衝刺鍵時**：自動衝刺（往前就衝刺）若也取消換彈，往前跑就永遠換不完彈，違反「速度就是力量」；系統參數 `sprintCancelsReload` 可關閉。
- **補彈點後按開火取消換彈**（系統參數 `fireCancelsReloadAfterAmmoPoint`，預設開）：計畫只要求霰彈可被開火中斷；彈匣式在補彈點之後按開火也會取消剩下的動作直接射擊（補彈點前按開火不取消、不射擊）。
- **強制退出開鏡**：Dash、攀爬、切槍、近戰中開鏡目標為 0；切換模式的開鏡會被關掉（`input.builder.setToggle('ads', false)`）；按住模式在動作結束後若仍按住會重新開鏡。攀爬中武器放低、不能射擊。換彈中可以開鏡。
- **開鏡縮放**：依 M1-08 建議在 CameraRig 新增 `fovZoom`（套在動態 FOV 之後，兩軸 tan 除以倍率，畫面比例不變），不直接寫 `camera.fov`；縮放與靈敏度用 smoothstep 曲線（系統參數 `adsZoomEase`），散布與後座的內插用線性進度。靈敏度依「設定的水平 FOV」換算（不含動態 FOV），結果恰為 1/zoom。新增設定「開鏡靈敏度倍率」`adsSensitivity`（0.2–3，預設 1；`shardwake:settings:v1` 版本不變，舊存檔補預設值）。
- **開鏡移動減速**：`PlayerController` 新增選項 `getMoveSpeedScale`（乘在地面目標速度上，依開鏡進度內插 `adsMoveSpeedMult`）。
- **穿透**：`Physics` 新增 `raycastAll()`（Rapier `intersectionsWithRay`，依距離排序、結果重複使用）。死亡的目標不擋子彈；同一目標的多個 hitbox 只算一次（先碰到哪個部位算哪個）。
- **投射物**：半徑 > 0 時每步用球形 shape cast（半徑 0 時 raycast）掃過這一步的位移線段（含重力的二次位移）。新增 `projectile.lifetime`（電漿 4 s，逾時消失不爆炸）與 `splashMinMult`（範圍邊緣倍率 0.25；傷害與擊退都從中心 1 線性衰減到此值）。距離以「爆炸點（沿表面法線抬起 0.05 m）→ 目標中心」計算，視線用世界 raycast 檢查；範圍傷害不算弱點。**直擊目標另外也受範圍傷害**（計畫的「直擊 90＋範圍 70」解讀為兩者相加，直擊時約 90 + 63）。投射物池 32 個，滿了回收最舊的。電漿重力 0（直線）。
- **自身擊退**：`PlayerController.addImpulse(dv)` 在下一步的狀態 step 之後加到速度；有向上分量（> 0.5 m/s）時這一步不算著地（地面狀態不會把垂直速度歸零），可以火箭跳。在 Dash／攀爬中衝量會被該狀態改寫（不處理）。自身中心 = 腳底 + 身高／2。headless 實測朝腳下開火擊退 10.4 m/s、上升約 2.26 m。
- **近戰**：出手後 0.12 s 判定命中、動作 0.4 s（期間不能射擊、開鏡、切槍；這段時間按的切槍會在動作結束時執行）、冷卻 0.6 s（從出手算）。目標 = 眼睛周圍 3.5 m 球形 overlap（敵人群組）中、與視線夾角 ≤ 35°、視線未被擋住、中心距離 ≤ 3.5 + 0.5 m 的目標，以「距離 ×（1 + 夾角／35°）」挑最小。距離 > 1.4 m 時突進：命中判定前每步把玩家水平速度設為朝目標 14 m/s，到 1.1 m 內停止。命中時重新找一次目標（突進後位置改變）。近戰傷害不算弱點。
- **切槍**：收槍中改按其他欄位只改掏槍目標（收槍時間不變）；掏槍中再切，只需要收回已掏出的比例。Q 切回「最近一次切槍前」的欄位。切槍會取消換彈（依補彈點決定是否已補彈）。切槍中按開火有扳機緩衝。
- **開火鏡頭效果**：每發 `feel.trauma` 加到 CameraRig（M1-08 的 trauma 每秒衰減 1.2、震動 = trauma²，所以小口徑的震動很輕）；新增 `feel.fovKick`（每發 FOV 衝擊，0.18 s）。viewmodel 後座（`viewKick`、`kickSpring`）留給 M1-11。
- **傷害事件**：`DamageInfo` 另加 `target`、`zone`、`kind`、`shotId`、`distance`；`source` 為攻擊者（'player'）。`isKill` 由目標的 `applyDamage` 回傳決定。`combat` 模組只有資料與介面，靶標在 M1-12。
- **調參面板**：面板綁定的是「代理物件」，每個欄位的 getter／setter 讀寫 `weapons.active.def` 的路徑，所以切槍後顯示新武器的數值（`weapon:swap` 時 refresh）。備彈以 -1 表示無限；`reloadPerShell` 設 0 = 改回彈匣式；投射物欄位在沒有投射物的武器上忽略。彈丸圖案、perk 清單與音效參數表不在面板上（匯出 JSON 中有）。修改後重新驗證，不合法時監看與主控台顯示錯誤。匯出 JSON 印在主控台並嘗試寫入剪貼簿（跨來源 iframe 可能不允許，失敗時忽略），最後一次匯出在 `weaponPanel.lastExport`。面板修改不存檔。
- **隨機數**：散布與後座用固定種子的 `Rng`（`'shardwake:weapons'`），結果可重現（錄製重播需要）。

### 調整過的數值

- 計畫表內的數值全部照用。計畫未指定、由本計畫決定的數值（都在 `archetypes.ts`，可在面板調）：
  - 散布（腰射／開鏡／每發／上限 °、回復 °/s、回復延遲 s、移動／空中倍率）：步槍 1.6／0.25／0.18／4、6、0.15、1.25／1.5；霰彈 1.0／0.5／0.6／2.4、4、0.2、1.15／1.3（彈丸圖案：中心 1、內圈 3 顆 1.7°、外圈 6 顆 3.4°）；手炮 0.9／0.12／0.9／3、3、0.1、1.2／1.4；狙擊 3／0／0／3、3、0.2、1.1／1.3；電漿 0.6／0.2／0.4／2、3、0.2、1.15／1.3。
  - 後座（pitch／yaw 每發 °、偏向、第一發倍率、回正 °/s、延遲 s、開鏡倍率、最大上跳 °）：步槍 0.35–0.55／−0.22–0.26、0.04、0.6、18、0.12、0.7、8；霰彈 2.6–3.2／±0.6、0、1、22、0.15、0.85、6；手炮 2.6–3.2／±0.5、0、1、30、0.06、0.8、10；狙擊 3.5–4.5／±0.4、0、1、12、0.25、0.6、8；電漿 2.0–2.6／±0.3、0、1、15、0.15、0.85、6。
  - 操作（掏／收槍 s、開鏡 s、開鏡倍率、衝刺轉射擊 s、開鏡移速）：步槍 0.4／0.25、0.2、1.3、0.15、0.75；霰彈 0.45／0.25、0.22、1.1、0.18、0.8；手炮 0.3／0.2、0.18、1.2、0.12、0.85；狙擊 0.55／0.3、0.32、4、0.25、0.55；電漿 0.5／0.3、0.25、1.2、0.2、0.7。
  - 其他：扳機緩衝 步槍／手炮 0.08、霰彈 0.12、狙擊／電漿 0.1 s；霰彈逐發的準備時間 0；手炮補彈點 0.65，其餘 0.7；狙擊衰減 300 m（等於不衰減）、電漿無衰減、電漿直擊不算弱點（critMult 1）；電漿半徑 0.15 m、存在 4 s；trauma 步槍 0.1（原本 0.035 時被 1.2/s 的衰減吃掉，測不到）、霰彈 0.22、手炮 0.16、狙擊 0.28、電漿 0.18；FOV 衝擊 霰彈 1.5°、手炮 0.8°、狙擊 2°、電漿 1°。
- 系統參數 `WEAPON_SYSTEM_CONFIG`：近戰傷害 55、範圍 3.5 m、錐形半角 35°、冷卻 0.6 s、命中 0.12 s、動作 0.4 s、突進門檻 1.4 m、突進 14 m/s、停止 1.1 m、命中容差 0.5 m；hitscan 射程 500 m；散布移動參考速度 7.5 m/s；投射物池 32；爆炸點抬起 0.05 m；空倉自動換彈、補彈後開火取消、手動衝刺取消換彈、壓槍吸收都開；開鏡縮放平滑 1。
- 爆炸鏡頭：trauma 0.5（半徑 × 3 內依距離衰減）；自身擊退時色差 0.35／0.2 s。

### 實際驗證

- `npm run typecheck`、`npm test`（23 檔、451 測試）、`npm run build`、`npm run check:dist`（9 個檔案、5.54 MiB）全部通過。
- 無頭驗收（Vitest，`tests/weapons.test.ts` 50 項）：600 RPM 按住 10 s 在 60／120／240 Hz 都是 100 發，逐發時間（間隔正好 0.1 s）、方向、後座、散布擴散一致；打空 32 發後在 3.2 s 開始空倉換彈、5.2 s 完成並在同一時刻接著射擊（三種步長都是 6 s 內 40 發）；半自動按住只發一發、緩衝內提早按會在可射擊時發射、超過緩衝不發；連發每輪 3 發、輪間依 rpm；霰彈 10 顆彈丸、0.75 s 間隔、彈丸相對角度固定；衝刺轉射擊延遲 0.15 s；換彈在補彈點前／後切槍取消（不補彈／已補彈）、補彈點前按開火不取消、補彈點後按開火取消並射擊、逐發裝填入膛時間與被開火中斷、裝滿 6 × 0.45 s、手動衝刺鍵取消／自動衝刺不取消、有限備彈與空倉點擊；散布停火後回到基礎、移動／空中倍率、跑牆不算空中；後座回正後視角回到原點、回正中不再上跳、回正量 ≤ 累積量、壓槍吸收（有吸收回到原瞄準點，沒有吸收停在 −3°）、開鏡後座 × 0.7；開鏡進度、FOV 縮放 1.3、靈敏度 (1/1.3) × 使用者倍率、狙擊 4× 時靈敏度 0.25、Dash 強制退出開鏡並關掉切換、攀爬中不能射擊；切槍時間 0.25 + 0.45 s、緩衝內的開火在切槍完成時發射、Q 與滾輪循環、收槍中改目標、近戰中按切槍延後執行。Rapier：hitscan 命中、弱點 × 1.8、距離衰減、不穿牆（終點在牆面、表面 concrete）、狙擊穿透 3 個目標、死亡目標不擋子彈、`isKill`；經 WeaponManager 開火第一發打在準心；投射物在 30／60／120／240 Hz × 45／300 m/s × 半徑 0.15／0 都不穿過 0.2 m 薄牆、牆後目標不受範圍傷害；側邊開闊目標依距離衰減受範圍傷害；直擊 90 + 範圍；不同步長的爆炸點一致（含重力）；逾時消失不爆炸；MovementSim 真實玩家朝腳下開火被往上推超過 1.5 m 後落地；近戰突進 14 m/s、命中 55、冷卻、錐形外與牆後打不到、近戰取消換彈並中斷開鏡；資料表與計畫一致、驗證能指出錯誤欄位、面板涵蓋每把原型的每個欄位、改 RPM 下一步生效、匯出 JSON 可讀回、舊設定存檔補上 `adsSensitivity`。
- headless Chrome（ANGLE D3D11）以 CDP 開 `vite preview` 的 `#debug&nolock`，最終建置上 21 項檢查全部通過（之前兩次的失敗是腳本本身：trauma 的讀取時機、浮點比較；修正腳本後通過）：啟動並進入 playing；初始為突擊步槍 32 發；面板有 13 個「武器」資料夾；按住開火射擊、扣彈、狀態 firing、後座偏移加到 viewPitch、hitscan 事件、開火 trauma 0.1；停火後後座與散布回到基礎；R 戰術換彈、完成後 32 發；開鏡進度 1、`fovZoom` 1.3、`mouse.scale` 1/1.3、`camera.fov` 小於基礎 FOV；按 2 切到霰彈槍、一發 10 顆彈丸；按 4 狙擊槍開鏡 4×、靈敏度 0.25（截圖確認畫面放大）；按 5 電漿朝腳下開火爆炸、擊退 10.4 m/s、上升 2.26 m；V 近戰 start → miss；Q 切回狙擊槍；面板「匯出目前武器 JSON」按鈕；設定「開鏡靈敏度倍率」預設 1、修改後寫入 `shardwake:settings:v1`；主控台沒有錯誤或例外（只有 Rapier 初始化與預熱訊息）。滑鼠按鍵在 `#nolock` 下不計入，所以開火與開鏡以 `input.builder.down('Mouse0'／'Mouse2')` 模擬；鍵盤（R、V、Q、1–5）用 CDP 按鍵事件。
- headless Edge：同一腳本一次 21/21 通過；另外兩次有 2–4 項依時間的檢查失敗（headless Edge 約 19 FPS、單畫面最長 180 ms，dt 上限讓模擬時間落後實際時間，腳本以實際時間等待；其中一次 V／Q 的按鍵沒有進到遊戲），不是武器邏輯造成。發現「近戰動作中按切槍被忽略」後改成延後執行並補測試。
- 結束後確認自己啟動的 vite preview 與 headless 瀏覽器都已關閉、暫存設定檔已刪除。

### 未驗證

- **射擊手感**：沒有有頭瀏覽器、實體滑鼠與槍模／特效／音效（M1-11、M1-13），後座上跳與回正的觀感、壓槍吸收是否自然、開火震動強度、開鏡縮放速度與曲線、衝刺轉射擊延遲、霰彈圖案大小、電漿火箭跳的高度與可控性、近戰突進的吸附感都沒有實際試玩；數值是依計畫與常見射擊遊戲的範圍設定，留給 M1-16 依試玩調整。
- 命中判定與傷害只在無頭測試中以測試靶驗證；訓練場還沒有靶（M1-12），瀏覽器中只確認 hitscan 打到牆／天空的事件。
- 平台模擬頁（跨來源 sandbox iframe）內的射擊沒有重跑（M1-09 已記錄 headless 下 iframe 內滑鼠鎖定回報 `WrongDocumentError`）；滑鼠按鍵實際開火、滾輪切槍沒有在瀏覽器中以真實滑鼠事件測試（單元測試與 `builder` 模擬）。
- 壓槍吸收與 M1-15 錄製重播的相容性（吸收會改寫玩家視角）。
- 實體 GPU 上的效能影響（每發 1 次穿透射線，霰彈每發 10 次；每個投射物每步 1 次 shape cast）。
