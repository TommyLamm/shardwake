# M1-04 物理、關卡建構器與灰盒訓練場

- 里程碑：M1 手感原型
- 前置：M1-02
- 狀態：未開始

## 目標

建立 Rapier 物理世界，以及「同一份資料同時生成網格與碰撞體」的關卡建構器，搭出能巡視全區的灰盒訓練場。

## 範圍

- 包含：物理世界與查詢工具、表面標記、關卡資料格式、LevelBuilder、Level／LevelManager、訓練場灰盒、除錯顯示、暫用自由相機。
- 不含：玩家控制器（M1-05）、正式美術（M1-09）。

## 任務

- [ ] `physics/Physics.ts`：`await RAPIER.init()`，只用單執行緒版本；玩家使用自訂重力，世界重力給動態物件；每個 fixed step 呼叫 `world.step()`。
- [ ] 碰撞群組常數 `WORLD`、`PLAYER`、`ENEMY`、`PROJECTILE`、`TRIGGER`、`DEBRIS`、`LOOT`，以及產生 interaction groups 的工具函式。
- [ ] 查詢包裝（重用暫存物件，不配置記憶體）：`raycast(origin, dir, maxDist, mask)` → `{ point, normal, collider, distance }`、`shapeCast(shape, from, dir, maxDist, mask)`、`overlap(shape, pos, mask)`。
- [ ] `physics/SurfaceRegistry.ts`：collider handle → `{ wallRunnable, grappleable, surface: 'metal' | 'grate' | 'glass' | …, owner }`，給跑牆、抓鉤、腳步聲與命中判定查詢。
- [ ] `world/LevelData.ts`：關卡資料格式——基本體 `{ type: 'box' | 'ramp' | 'cylinder' | 'trimesh', pos, size, rot, material, flags }`，另含 `spawnPoints`、`checkpoints`、`killVolumes`、`zones`（名稱、範圍、觸發事件）、`labels`（看板文字）。之後 M4 的房間模組沿用這個格式。
- [ ] `world/LevelBuilder.ts`：資料 → Rapier 靜態碰撞體（box 用 cuboid、ramp 用旋轉 cuboid、cylinder，必要時 trimesh）＋網格；網格依材質用 `mergeGeometries` 合併，壓低 draw call。
- [ ] `world/Level.ts`：`Level` 介面（`build(ctx)`、`dispose()`、`getSpawn()`、`update(dt)`）；`LevelManager` 負責載入、卸載並重建物理世界，為 M4 的基地↔任務切換做準備。
- [ ] 灰盒材質：程序格線貼圖（1 m 細線、5 m 粗線，最大 anisotropy），讓速度感清楚；各區用不同底色。
- [ ] `world/levels/TrainingGround.ts`（約 160 × 160 m）：
  - 出生平台與看板
  - 靶場：10／25／50／75 m 標線
  - 跑牆長廊（兩面平行牆，長 40 m、高 6 m）與 Z 字牆板（下方深坑）
  - 滑鏟長坡（15°、長 40 m）與半管
  - 攀爬測試牆：0.8／1.2／2.0／3.0／4.0 m
  - 浮台群：間距 4／7／10／14 m（需要二段跳或 Dash）
  - 高塔：20／30／40 m，頂端是抓鉤練習區
  - 跑酷路線的檢查點位置（M1-15 使用）
  - 無人機戰區：開放空間加掩體（M1-12 使用）
  - `killVolume`：y < −30 時回到最近檢查點
- [ ] 除錯：調參面板可切換碰撞體線框、顯示區域名稱、傳送到各區。
- [ ] 暫用自由飛行相機（WASD＋滑鼠、Shift 加速），在玩家控制器完成前巡視場地。

## 交付（給後續計畫）

- `Physics` 查詢 API、碰撞群組、`SurfaceRegistry`。
- `LevelData` 格式、`LevelBuilder`、`Level`／`LevelManager`。
- 訓練場各分區座標（`zones`），供傳送、計時賽、無人機戰區使用。

## 驗收

- [ ] 測試：LevelBuilder 對同一份資料產生的碰撞體與網格包圍盒一致；raycast 命中正確的 collider 並查得到表面旗標。
- [ ] 訓練場 draw call < 80（靜態幾何已合併）。
- [ ] 自由相機可巡視所有分區，碰撞線框與網格吻合。

## 實作紀錄

（完成後填寫）
