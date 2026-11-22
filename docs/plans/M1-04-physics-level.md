# M1-04 物理、關卡建構器與灰盒訓練場

- 里程碑：M1 手感原型
- 前置：M1-02
- 狀態：完成

## 目標

建立 Rapier 物理世界，以及「同一份資料同時生成網格與碰撞體」的關卡建構器，搭出能巡視全區的灰盒訓練場。

## 範圍

- 包含：物理世界與查詢工具、表面標記、關卡資料格式、LevelBuilder、Level／LevelManager、訓練場灰盒、除錯顯示、暫用自由相機。
- 不含：玩家控制器（M1-05）、正式美術（M1-09）。

## 任務

- [x] `physics/Physics.ts`：`await RAPIER.init()`，只用單執行緒版本；玩家使用自訂重力，世界重力給動態物件；每個 fixed step 呼叫 `world.step()`。
- [x] 碰撞群組常數 `WORLD`、`PLAYER`、`ENEMY`、`PROJECTILE`、`TRIGGER`、`DEBRIS`、`LOOT`，以及產生 interaction groups 的工具函式。
- [x] 查詢包裝（重用暫存物件，不配置記憶體）：`raycast(origin, dir, maxDist, mask)` → `{ point, normal, collider, distance }`、`shapeCast(shape, from, dir, maxDist, mask)`、`overlap(shape, pos, mask)`。
- [x] `physics/SurfaceRegistry.ts`：collider handle → `{ wallRunnable, grappleable, surface: 'metal' | 'grate' | 'glass' | …, owner }`，給跑牆、抓鉤、腳步聲與命中判定查詢。
- [x] `world/LevelData.ts`：關卡資料格式——基本體 `{ type: 'box' | 'ramp' | 'cylinder' | 'trimesh', pos, size, rot, material, flags }`，另含 `spawnPoints`、`checkpoints`、`killVolumes`、`zones`（名稱、範圍、觸發事件）、`labels`（看板文字）。之後 M4 的房間模組沿用這個格式。
- [x] `world/LevelBuilder.ts`：資料 → Rapier 靜態碰撞體（box 用 cuboid、ramp 用旋轉 cuboid、cylinder，必要時 trimesh）＋網格；網格依材質用 `mergeGeometries` 合併，壓低 draw call。
- [x] `world/Level.ts`：`Level` 介面（`build(ctx)`、`dispose()`、`getSpawn()`、`update(dt)`）；`LevelManager` 負責載入、卸載並重建物理世界，為 M4 的基地↔任務切換做準備。
- [x] 灰盒材質：程序格線貼圖（1 m 細線、5 m 粗線，最大 anisotropy），讓速度感清楚；各區用不同底色。
- [x] `world/levels/TrainingGround.ts`（約 160 × 160 m）：
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
- [x] 除錯：調參面板可切換碰撞體線框、顯示區域名稱、傳送到各區。
- [x] 暫用自由飛行相機（WASD＋滑鼠、Shift 加速），在玩家控制器完成前巡視場地。

## 交付（給後續計畫）

- `Physics` 查詢 API、碰撞群組、`SurfaceRegistry`。
- `LevelData` 格式、`LevelBuilder`、`Level`／`LevelManager`。
- 訓練場各分區座標（`zones`），供傳送、計時賽、無人機戰區使用。
- 實際 API 摘要（見實作紀錄）：`Physics.init()`／`new Physics({ bus })`、`raycast／shapeCast／overlap`（結果物件重複使用）、`physics.surfaces`、`physics.generation`／`resetWorld()`、`PhysicsSystem`；`CollisionGroup`／`COLLISION_PRESETS`／`QueryMask`／`interactionGroups()`；`buildLevel()`、`DataLevel`（`checkRespawn()`、`nearestCheckpoint()`、`zoneAt()`、`trackZone()`）、`LevelManager`（`load()`、`setFocus()`）；`TRAINING_ZONES`、`TRAINING_CHECKPOINTS`（含 `parkour` 路線）；`FreeCamera`；事件 `physics:reset`、`level:loaded／unloaded／zone／respawn`。

## 驗收

- [x] 測試：LevelBuilder 對同一份資料產生的碰撞體與網格包圍盒一致；raycast 命中正確的 collider 並查得到表面旗標。
- [x] 訓練場 draw call < 80（靜態幾何已合併）。（headless 實測最多 41；實體 GPU 未驗證）
- [x] 自由相機可巡視所有分區，碰撞線框與網格吻合。（headless Chrome + SwiftShader 截圖確認；有頭實機未驗證）

## 實作紀錄

完成日期：2026-11-23。

### 新增／修改檔案

- `src/physics/`：`Physics.ts`（`Physics`、`PhysicsSystem`）、`groups.ts`（碰撞群組、interaction groups 工具、預設組合、查詢遮罩）、`SurfaceRegistry.ts`、`config.ts`（`PHYSICS_CONFIG`）、`index.ts`。
- `src/world/`：`LevelData.ts`（格式、驗證、區域／killVolume／檢查點查詢）、`LevelBuilder.ts`、`Level.ts`（`Level`、`DataLevel`、`LevelManager`）、`LevelShapes.ts`（半管 trimesh）、`Greybox.ts`（格線貼圖、灰盒材質表、`GreyboxVisuals`、`PlainVisuals`、看板文字、燈光與霧）、`LevelDebug.ts`、`levels/TrainingGround.ts`、`index.ts`。
- `src/camera/FreeCamera.ts`（暫用自由飛行相機）。
- 修改：`src/main.ts`（換成物理＋訓練場＋自由相機，調參面板新增「物理」「自由相機」「關卡」資料夾）、`src/core/events.ts`（新增 `physics:reset`、`level:*` 事件）、`src/debug/DebugPanel.ts`（新增 `bindButtons()`，`PaneFolder.addButton` 為選填）。
- 刪除：`src/world/BootScene.ts`、`src/bootConfig.ts`（M1-01 的佔位場景，依 M1-02 紀錄在本計畫移除）。
- 測試：`tests/physics.test.ts`、`tests/level-builder.test.ts`、`tests/training-ground.test.ts`、`tests/helpers/colliderBounds.ts`，`tests/debug.test.ts` 加 `bindButtons` 測試（全專案 15 檔、227 測試）。

### 偏離計畫之處與設計決定

- **查詢不配置記憶體的範圍**：包裝重用自己的 `Ray`、輸入向量與結果物件（每種查詢一個結果物件，下一次同種查詢會覆寫，要保存須自行複製）；`overlap` 的結果放在重複使用的 `physics.overlapResults`。Rapier JS 綁定本身每次查詢仍會建立少量小物件，無法避免。
- **查詢簽名擴充**：`raycast(origin, dir, maxDist, mask = QueryMask.world, exclude?, filterFlags = EXCLUDE_SENSORS)`、`shapeCast(shape, from, dir, maxDist, mask, rot?, exclude?, stopAtPenetration = true, …)`、`overlap(shape, pos, mask, rot?, exclude?, limit?, filterFlags = 0)` 回傳數量。dir 內部正規化；結果另帶 `surface`（已查好的表面資訊）。查詢 groups 的 membership 設為全部，只用 mask 決定命中對象（碰撞體自己的 filter 不會擋查詢）。
- **查詢同步**：Rapier 新增碰撞體後要等 broad phase 更新才查得到。`Physics` 追蹤「有變動」旗標，下次查詢前自動以 timestep 0 執行一次 `world.step()`（`syncQueries()`，不移動物件）。
- **世界代數**：`resetWorld()` 會讓 `generation` 加一；`removeCollider(c, generation)` 遇到舊代直接忽略，避免舊 handle 誤刪新世界裡同號的碰撞體（Rapier 新世界的 handle 會從 0 重新編號）。`LevelManager.load()` 每次都 `resetWorld()`。
- **killVolume 與區域用點包含判定，不建立 sensor 碰撞體**：`DataLevel.checkRespawn(pos)`／`trackZone(pos)` 以軸對齊盒判定，結果與步長無關、可無頭測試；M1-05 若需要接觸事件再加 sensor。
- **Checkpoint 新增 `respawn` 欄位**（預設 true）：跑酷路線的環形檢查點設 false，最近檢查點只找重生點，避免掉進深坑後被送到坑的另一端跳過關卡。另有 `radius`、`course`、`order`。
- **資料格式細節**：角度一律用度，`rot` 以 Euler 'YXZ' 套用；ramp 的 `pos` 是坡底腳印中心、`size = [寬, 上升高度, 水平長度]`、坡往 local -Z 上升、預設厚 0.5 m；cylinder 的 `size = [直徑, 高, 直徑]`；flags 另有 `surface`（覆寫表面）、`noCollide`、`noRender`。材質決定表面類型與預設旗標（例如跑牆區、外牆、高塔預設 `wallRunnable`；高塔、抓鉤點、外牆預設 `grappleable`），flags 可覆寫。
- **格線 UV**：網格先轉到世界座標，依 local 法線主軸挑兩條切線、轉到世界後與世界座標內積，單位為公尺／`tileMeters`。未旋轉的面與世界格線對齊（相鄰地板的線接得起來），斜坡沿坡面量測不拉伸。貼圖用 `DataTexture`（純函式 `makeGridPixels()` 產生像素，可無頭測試），不需 Canvas。
- **trimesh**：半管以 `ExtrudeGeometry` 產生三角形資料寫進 LevelData（vertices／indices），碰撞體用 `TriMeshFlags.FIX_INTERNAL_EDGES`（含合併重複頂點）；網格以每三角形獨立頂點做平面著色。
- **看板**：每塊看板是一個 Canvas 文字貼圖平面（未合併，27 塊）；材質與貼圖歸關卡所有，卸載時釋放。M1-09 換成全息看板。
- **外觀與物理分離**：`buildLevel(data, { physics?, visuals?, materials? })`；無頭測試用 `PlainVisuals`（MeshBasicMaterial、無看板），遊戲用 `GreyboxVisuals`。灰盒燈光固定為半球光＋1 盞方向光（無陰影），線性霧 90–320 m。
- **除錯**：調參面板「關卡/除錯顯示」切換碰撞體線框（Rapier `debugRender`）與區域／檢查點／跑酷路線顯示（區域名稱以不受遮擋的 sprite 顯示）；「關卡/傳送」每區一個按鈕；「關卡/監看」顯示目前區域、位置與關卡統計。為此 `DebugPanel` 新增 `bindButtons()`。
- **自由相機**：固定步讀 InputFrame，沿視線方向飛行；Space 上升、C 下降、Shift（`dash` 動作）加速；速度指數平滑（放開就停），渲染插值。穿牆、不碰撞，但落入 killVolume 會回到最近檢查點（示範 M1-05 的重生流程）。區域追蹤的對象是自由相機的「腳底」位置（眼高 1.65 m 以下），M1-05 改成玩家。
- **訓練場佈局**（-Z 為北，地面頂面 y = 0，外牆高 12 m）：靶場 x[-80,-46]（射擊線 z = 40，北端擋牆）；跑牆長廊兩牆 x = -37／-31（內距 6 m）、z[-10,30]；深坑 x[-46,-22] z[-70,-18] 無底，上方 5 片 Z 字牆板（左右交錯、各偏 20°）；滑鏟坡 x = -8、寬 12 m，坡頂平台高約 10.35 m；半管 x = 9、z[-45,-5]、半徑 5 m；攀爬牆在 z = 62、x = 30～70；浮台頂面 y = 3，由斜坡上起點台；無人機戰區 x[20,80] z[-34,24]（8 個低掩體、4 根柱、2 面高牆）；高塔 6 × 6 m，塔頂有抓鉤柱，塔間另有 3 個懸空抓鉤點。12 個區域（含「中央廣場」與「塔頂抓鉤區」）、11 個重生檢查點、11 個跑酷路線檢查點（路線順序為暫定，M1-15 調整）。
- 高塔頂端目前只能靠抓鉤（M1-07）或自由相機上去；沒有樓梯。

### 調整過的數值

- `PHYSICS_CONFIG`：世界重力 -9.81 m/s²（只影響動態物件）、求解迭代 4。
- `GREYBOX_CONFIG`：每張貼圖 5 m、512 px、細線 3 px、粗線 7 px、亮度 底 0.5／細線 0.72／粗線 0.95、anisotropy 用顯示卡最大值、粗糙度 0.85、金屬度 0.05、半球光 1.6、方向光 1.8、霧 90–320 m。材質底色見 `GREYBOX_MATERIALS`（可在面板「關卡/灰盒顏色」調整）。
- `FREE_CAMERA_CONFIG`：速度 14 m/s、Shift 倍率 4、跟手程度 10 /s、眼高 1.65 m。
- 相機遠裁切面 200 → 600 m（場地對角線約 226 m）。

### 實際驗證

- `npm run typecheck`、`npm test`（15 檔、227 測試）、`npm run build`、`npm run check:dist`（9 個檔案、5.18 MiB）全部通過。
- 無頭測試（Vitest + Rapier）：碰撞體（Rapier `debugRender` 線框）與網格包圍盒逐一比對一致（box、旋轉／傾斜 box、ramp、cylinder、trimesh，訓練場全部 68 個碰撞體）；raycast 命中正確 collider 並取得表面旗標（材質預設與 flags 覆寫、noCollide／noRender）；訓練場尺寸（160 × 160 m）、長廊 40 × 6 m、坡度 15°、攀爬牆高度、浮台間距、塔高、靶場標線距離、深坑無底、killVolume 重生、每區傳送點落地；LevelManager 重新載入會重建世界、區域事件；自由相機移動、加速、停止、插值與重生。
- headless Chrome（SwiftShader）以 CDP 連 `npm run sim` 的平台頁，15 項檢查全部通過：跨來源 OOPIF 內啟動、載入訓練場（75 個基本體、68 個碰撞體、14 個合併網格、27 塊看板、1796 個三角形）、`crossOriginIsolated = false`；調參面板出現每區的傳送按鈕；點擊後鎖定滑鼠進入 playing；按住 W 前進、Shift + W 明顯更快；傳送到 12 個區域，區域追蹤都回報正確區域；draw call 出生點 26、各區最多 34、俯瞰全場 41（< 80）；開啟碰撞線框後截圖確認線框與網格重疊（跑牆長廊、Z 字牆板、半管、全場）；落入深坑回到坑口檢查點；Esc 暫停。主控台只有 Rapier 初始化訊息，無錯誤或例外。
- 煙霧測試要開 CDP `Emulation.setFocusEmulationEnabled` 才能取得滑鼠鎖定（否則 headless 回報 `WrongDocumentError`，用 HEAD 版本建置比對也一樣，屬測試環境問題，不是本計畫造成）。
- headless Edge：啟動、載入訓練場、draw call、碰撞線框、傳送按鈕都正常；但 CDP 合成的點擊與按鍵沒有送進 iframe（`#nolock` 也一樣），所以 Edge 上的輸入相關項目未驗證。

### 未驗證

- 有實體 GPU 的有頭瀏覽器：實際 draw call、FPS、格線在高速移動時的速度感與 anisotropy 效果、看板文字清晰度。
- 自由相機的實際操作手感（滑鼠視角＋WASD）；headless 只用合成輸入。
- 各區尺寸是否適合實際移動手感（例如長廊內距 6 m、浮台間距、Z 字牆板角度）要等 M1-05～M1-07 的玩家控制器實測；可能需要微調資料。
- 半管 trimesh 與 `KinematicCharacterController` 的實際互動（內部邊緣、接縫）留給 M1-05 確認。
