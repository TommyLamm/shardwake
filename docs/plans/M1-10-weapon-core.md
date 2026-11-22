# M1-10 武器核心邏輯

- 里程碑：M1 手感原型
- 前置：M1-05（使用 M1-03 的輸入）
- 狀態：未開始

## 目標

建立純資料驅動、與畫面更新率無關的武器邏輯。之後的刷寶生成器只要產生 `WeaponDef` 就能用。

## 範圍

- 包含：`WeaponDef` 資料結構與驗證、5 把原型的數值、射擊狀態機、換彈、散布、後座、開鏡、彈道（hitscan 與投射物）、近戰、武器管理、傷害事件、測試。
- 不含：槍模、動畫、特效、準星（M1-11）；靶標與受擊回饋（M1-12）；音效（M1-13）。

## 任務

- [ ] `weapons/WeaponDef.ts`（型別與驗證函式）：
  - `id`、`name`、`archetype`
  - `fire`：`{ mode: 'auto' | 'semi' | 'burst' | 'pump', rpm, burstCount?, burstRpm?, pellets, triggerBuffer }`
  - `damage`：`{ base, critMult, falloffStart, falloffEnd, minMult, penetration }`
  - `projectile?`：`{ speed, gravity, radius, splashRadius, splashDamage, selfKnockback, selfDamageMult }`
  - `ammo`：`{ type: 'mag', mag, reloadTactical, reloadEmpty, reloadPerShell?, reloadAmmoPoint, reserve: 'infinite' | number }`（M2-01 會加入 `type: 'heat'`）
  - `spread`（角度）：`{ hip, ads, perShot, max, recoveryPerSec, moveMult, airMult, pelletPattern? }`
  - `recoil`：`{ pitchPerShot: [min, max], yawPerShot: [min, max], yawBias, firstShotMult, recoveryPerSec, recoveryDelay, adsMult, maxClimb }`
  - `handling`：`{ swapIn, swapOut, adsTime, adsZoom, sprintToFire, adsMoveSpeedMult }`
  - `feel`：`{ trauma, viewKick: { pos, rot }, kickSpring }`（給 M1-11）
  - `audio`：合成配方 id 與參數（給 M1-13）
  - `model`：槍模部件描述（給 M1-11 的 WeaponModelFactory）
  - `perks`：先是空陣列，保留 hook 介面給 M2-02
- [ ] `weapons/archetypes.ts`：5 把原型的初始數值。

  | 武器 | 模式 | RPM | 傷害／爆頭倍率 | 彈匣 | 換彈（戰術／空倉） | 備註 |
  | --- | --- | --- | --- | --- | --- | --- |
  | 突擊步槍 | 全自動 | 600 | 18／×1.8 | 32 | 1.6／2.0 s | 30→60 m 衰減到 60% |
  | 散射霰彈槍 | 泵動 | 80 | 12 × 10 彈丸／×1.5 | 6 | 逐發 0.45 s | 固定彈丸圖案；8→20 m 衰減到 20% |
  | 重型手炮 | 半自動 | 160 | 60／×2.0 | 8 | 1.8 s | 強烈上跳、快速回正 |
  | 磁軌狙擊槍 | 半自動 | 55 | 140／×2.5 | 4 | 2.4 s | 穿透 3 個目標；開鏡 4×；腰射散布 3° |
  | 電漿發射器 | 半自動投射物 | 70 | 直擊 90＋範圍 70（半徑 4 m） | 4 | 2.2 s | 投射物 45 m/s；自身擊退 12 m/s；原型無自傷 |

- [ ] `weapons/Weapon.ts` 執行期狀態機：`idle / firing / reloading / swapping / meleeing`。射擊用「下一發時間」累加（`nextShotTime += 60 / rpm`），同一步可以補多發，保證 RPM 與步長無關；半自動扳機緩衝 0.08 s（略早按下，等到可以射擊時仍會發射）；連發；泵動。
- [ ] 換彈：戰術與空倉時間不同；在 `reloadAmmoPoint`（例如 0.7）之前切槍或衝刺 → 取消且不補彈，之後 → 已補彈；霰彈逐發裝填可被開火中斷；空倉時自動換彈。
- [ ] 散布：依開鏡進度在腰射與開鏡之間內插；每發擴散與回復；移動／空中倍率偏寬鬆，鼓勵移動中射擊；霰彈使用固定彈丸圖案加上整體散布。
- [ ] 後座：每發加上 pitch／yaw 增量（隨機範圍＋偏向），累積成「後座偏移」直接加到視角；停火 `recoveryDelay` 後以 `recoveryPerSec` 回正，只回正後座造成的部分，不抵銷玩家自己的壓槍；開鏡時套用倍率。
- [ ] 開鏡：開鏡進度 0→1（`adsTime`）；FOV 依 `adsZoom` 縮放；開鏡靈敏度預設依焦距換算 `tan(adsFov / 2) / tan(hipFov / 2)`，再乘上使用者倍率；衝刺、Dash、攀爬時強制退出開鏡。
- [ ] `weapons/Ballistics.ts`：
  - Hitscan：從相機位置沿「視線＋散布」射出射線；在 `penetration` 次數內穿透敵人（不穿牆）；套用距離衰減；回傳命中清單。
  - 投射物：物件池化，每步用線段 raycast 前進（不穿過薄牆）；碰撞時造成直擊與範圍傷害（依距離衰減，並檢查視線遮擋）；範圍內的玩家受到擊退（加到玩家速度，可以火箭跳）。
- [ ] 近戰（V）：前方錐形 `overlap`，範圍 3.5 m；有目標時短距離突進吸附；傷害 55、冷卻 0.6 s。
- [ ] `weapons/WeaponManager.ts`：5 個欄位（1–5）、滾輪循環、Q 切回上一把；切槍時間 = 舊槍 `swapOut` ＋ 新槍 `swapIn`；自動衝刺時按開火，會先在 `sprintToFire` 內退出衝刺。
- [ ] 傷害事件：`DamageInfo { amount, isCrit, point, normal, dir, source, weaponId, isKill }` 經 EventBus 發出（M1-12 使用）。
- [ ] 調參面板「武器」資料夾：綁定目前手持武器的所有欄位，修改即時生效；可匯出單把武器的 JSON。

## 交付（給後續計畫）

- `WeaponDef` 型別與驗證（M2-01 生成器的輸出格式）。
- `Weapon` 狀態與事件：`weaponFire`、`reloadStart`、`reloadEnd`、`swap`、`adsChange`、`melee`。
- `Ballistics` 的命中結果與 `DamageInfo`。

## 驗收

`tests/weapons.test.ts`：

- [ ] 600 RPM 在 1/60、1/120、1/240 步長下按住 10 s，都是 100 ± 1 發。
- [ ] 換彈在 ammoPoint 之前取消不補彈、之後取消已補彈；霰彈逐發裝填可被開火中斷。
- [ ] 停火後散布回到基礎值；後座回正量不超過累積量。
- [ ] 投射物不會穿過 0.2 m 的薄牆；範圍傷害被牆擋住時不生效。

## 實作紀錄

（完成後填寫）
