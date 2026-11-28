# M1-11 武器表現：Viewmodel、特效、準星 ★

- 里程碑：M1 手感原型
- 前置：M1-09、M1-10
- 狀態：完成
- 檢查點：★ 完成後可以試玩射擊手感

## 目標

讓 5 把武器看起來、動起來都有份量且各有特色，並讓準星精確反映實際散布。

## 範圍

- 包含：viewmodel 渲染、程序槍模、viewmodel 動畫、狙擊鏡、射擊特效、動態準星、預熱。
- 不含：命中標記與傷害數字（M1-12）、音效（M1-13）。

## 任務

- [x] Viewmodel 渲染：獨立的 `vmScene` 與 `vmCamera`（固定 FOV 60°）；在 PostFX 中，世界 RenderPass 之後加第二個 RenderPass，只清深度、不清顏色；viewmodel 也套用 Bloom，而且不會穿牆。
- [x] `weapons/WeaponModelFactory.ts`：依 `WeaponDef.model` 組裝程序槍模——機匣、槍管（長度／粗細）、護木、彈匣（可拆，換彈動畫用）、瞄具（機瞄／紅點／狙擊鏡）、槍托、發光條（顏色之後對應稀有度）；共用材質、合併靜態部件；預留 `manufacturer` 參數（M2-01 每家廠商一套部件風格）。
- [x] `weapons/Viewmodel.ts` 動畫（全部用彈簧，與畫面更新率無關）：
  - 擺動（滑鼠位移的反向延遲，有上限）、移動晃動（8 字形，隨速度變化）、衝刺姿勢（下壓並側轉）、滑鏟傾斜 15°、跑牆時往牆外偏、空中微抬、落地彈跳。
  - 開鏡：依開鏡進度，把瞄具對齊畫面中心（每把武器有自己的 `adsOffset`）。
  - 後座踢動：位置後推、槍口上仰；每把武器的彈簧參數不同。
  - 換彈：程序關鍵影格（槍身傾斜 → 彈匣拔出掉落 → 新彈匣插入 → 上膛），時間軸依 `reload*` 縮放；霰彈逐發插彈。
  - 切槍：下放／舉起；近戰：前刺。
- [x] 狙擊鏡：開鏡完成時顯示瞄準鏡遮罩與縮放後的世界 FOV，並隱藏 viewmodel。
- [x] 特效（全部物件池化，放在 `fx/`）：
  - 槍口火光：加法混合 sprite（隨機旋轉、縮放）＋**預先建立的固定點光源**，只調整亮度。
  - 曳光：從槍口到命中點的拉長發光四邊形，快速淡出；霰彈每顆彈丸一條（可降量）。
  - 命中火花：InstancedMesh 粒子，依表面法線噴出；打到發光材質時換顏色。
  - 彈孔貼花：貼在表面（polygonOffset），上限 96，循環覆蓋。
  - 電漿投射物：發光球加拖尾；爆炸：擴散球殼、閃光、震動。
  - （可選）彈殼拋出：拋物線加地面彈跳，上限 32。（未做：可選項目，見實作紀錄）
- [x] `ui/Crosshair.ts`：依武器類型使用不同樣式（十字／圓／點）；半徑 = `tan(spread) / tan(vFov / 2) × (畫面高度 / 2)`，精確反映實際散布；開鏡時縮小，狙擊開鏡時淡出。
- [x] 預熱：viewmodel 與所有特效材質加入 `registerWarmup()`。

## 交付（給後續計畫）

- `WeaponModelFactory`（之後依廠商與稀有度換部件與顏色）。
- 特效池 API：`spawnImpact`、`spawnTracer`、`spawnExplosion`（敵人與 M2 的元素特效沿用）。
- `Crosshair`（M1-14 組合進 HUD）。

## 驗收

- [x] 貼牆時槍不穿模；改世界 FOV 不影響槍模大小。（viewmodel pass 先清深度；headless 貼牆截圖 `M1-11-wall.png`；單元測試：世界 FOV 40→160° 變化時 viewmodel 相機 FOV 與姿勢完全相同）
- [x] 以 1/60 與 1/240 的畫面速度錄影比較，viewmodel 動畫一致。（以無頭測試取代錄影：同一段轉視角、移動、連射、換彈、切槍，60／240 FPS 在 8 個時間點的姿勢差 < 1e-6；有頭錄影未做）
- [ ] 第一次開火不卡頓（frame time 圖）。（部分驗證：headless 下載入預熱 26 個著色器程式，5 把武器開火、開鏡、狙擊鏡、換彈、爆炸之後仍是 26；第一次開火前後 1 秒的畫面間隔最大 87 ms／中位數 18 ms，與未開火的基準（最大 92 ms／中位數 19 ms）相同。有頭瀏覽器的 frame time 圖未驗證）
- [x] 準星大小與實際彈著吻合：對牆連射 30 發，至少 90% 的彈孔落在準星圈內。（Rapier 無頭測試：步槍腰射／開鏡／空中、手炮、霰彈（300 顆彈丸）、狙擊腰射全部 100% 在圈內，最遠彈孔為半徑的 0.999；後座關閉以固定畫面中心）
- [ ] 實機：5 把武器手感有明顯區別；附截圖。（未驗證：沒有真人以實體滑鼠試玩；截圖已附 `docs/screenshots/M1-11-*.png`）

## 實作紀錄

完成日期：2026-11-28。

### 新增／修改檔案

- 新增 `src/weapons/`：`WeaponModelFactory.ts`（`layoutWeaponModel()` 純函式部件排版、`WeaponModelFactory`、`MODEL_STYLES`／`modelStyle()`、`weaponModelKey()`、`lookRotation()`）、`Viewmodel.ts`（viewmodel 場景、相機、燈光、動畫、槍口閃光、`muzzleWorld()`）、`ViewmodelConfig.ts`（`VIEWMODEL_CONFIG`、`VIEWMODEL_PANEL`）、`viewmodelMath.ts`（動作曲線純函式）、`ViewmodelPanel.ts`（調參面板「武器表現」）。
- 新增 `src/fx/`：`WeaponFx.ts`（特效總管與生成 API）、`Sparks.ts`、`Tracers.ts`、`Decals.ts`、`Explosions.ts`、`PlasmaBolts.ts`、`instanced.ts`（GPU 實例化共用工具）、`ring.ts`（`RingAllocator`、`FractionalCounter`）、`FxConfig.ts`（`WEAPON_FX_STYLES`、`SURFACE_IMPACT`、`FX_CONFIG`）、`fxTextures.ts`（程序槍口閃光貼圖）。
- 新增 `src/ui/Crosshair.ts`（準星與換算純函式）、`src/ui/ScopeOverlay.ts`（狙擊鏡遮罩）。
- 修改：`src/main.ts`（建立 Viewmodel／WeaponFx／Crosshair／ScopeOverlay、viewmodel pass、預熱、面板、`__shardwake` 多 `viewmodel`、`weaponFx`、`crosshair`、`scopeOverlay`）、`src/fx/Warmup.ts`（可 `registerWarmup(scene)`：以該場景自己的燈光編譯）、`src/weapons/WeaponDef.ts`（`model.adsOffset?`、`model.manufacturer?` 與驗證）、`src/weapons/archetypes.ts`（5 把的 `adsOffset`）、`src/weapons/WeaponPanel.ts`（開鏡對位欄位）、`src/core/events.ts`＋`src/weapons/WeaponManager.ts`（`weapon:reloadStart`／`reloadShell`／`reloadEnd` 加 `time`）、`src/style.css`（準星、遮罩）。
- 測試：新增 `tests/weapon-presentation.test.ts`（24 項）。全專案 24 檔、475 測試。
- 截圖：`docs/screenshots/M1-11-{rifle,ads,reload,scope,explosion,wall}.png`（960 × 540、24 階色，78–192 KB）。沒有新增套件。

### 實際 API 摘要（給後續計畫）

- **WeaponModelFactory（M2-01）**：`factory.create(def.model, { manufacturer?, glowColor? })` → `WeaponModel { root, magazine, pump, layout, muzzle, sight, glowMaterial, key, setGlowColor(color), setGlowLevel(level), dispose() }`。廠商風格加在 `MODEL_STYLES[廠商]`（比例、握把角度、發光強度、材質、手臂）；`model.manufacturer` 或選項指定；稀有度色用 `glowColor` 或 `setGlowColor()`。共用材質在 `factory.materials`；新材質種類要確保在 viewmodel 場景內（預熱）。
- **Viewmodel**（main 的 `viewmodel`，Game 系統 order fx）：`scene`、`camera`（固定 FOV）、`gun`、`state`（`visible`、`ads`、`scope`、`reload`、`lowered`…）、`pose`、`enabled`、`model`、`muzzleWorld(out)`（曳光、投射物外觀的起點）、`snap()`、`advance(dt, alpha)`（無頭）。換裝（`weapons.equip`）後 0.25 s 內自動建立新槍模。
- **特效池 API（WeaponFx，main 的 `weaponFx`）**：`spawnImpact(point, normal, surface?, { scale?, color?, intensity?, decal?, style? })`、`spawnTracer(from, to, style?)`、`spawnExplosion(point, normal, radius, { color?, intensity?, sparks?, scorch?, light? })`、`spawnDecal(point, normal, size, heat?)`、`clear()`、`stats`。敵人與 M2-02 元素特效傳自己的顏色／強度即可；風格表 `WEAPON_FX_STYLES[archetype]`、表面表 `SURFACE_IMPACT`。
- **Crosshair（M1-14 組合進 HUD）**：`new Crosshair({ container, getInput, getHeight, config? })`，`root`（DOM）、`radius`、`opacity`、`style`；輸入 `CrosshairInput { visible, style, spreadDeg, vFovDeg, ads, scope }`。純函式 `crosshairRadiusPx()`、`screenRadiusPx()`、`effectiveSpreadDeg()`、`patternRadiusDeg()`、`crosshairStyleFor()`。M1-12 的命中標記可掛在 `crosshair.root` 旁。
- **預熱**：`registerWarmup(scene)` 現在接受另一個場景（以它自己的燈光編譯）。

### 偏離計畫之處與設計決定

- **FOV 60° 是垂直 FOV**（three 的慣例）；開鏡時 viewmodel FOV 內插到 `adsFov` 54°（槍略放大），可在面板設成 60 取消。世界的開鏡縮放沿用 M1-10 的 `CameraRig.fovZoom`；狙擊鏡在開鏡進度 0.86–0.94 間淡入遮罩，0.94 起隱藏槍模。
- **viewmodel 燈光**：viewmodel 場景有自己的半球光＋方向光（每畫面複製世界燈光的顏色、強度，方向換到相機空間）與槍口點光源；環境反射跟著世界場景的 `environment`／`environmentIntensity`（未跟隨時金屬槍身被 RoomEnvironment 照得發白）。
- **世界點光源**：依計畫「預先建立的固定點光源」，世界場景多 2 盞點光源（槍口、爆炸），載入前加入，數量固定、只調亮度；這讓所有受光材質多算 2 盞點光，但不會重新編譯。M1-09 的「不要加燈」改為「燈光數量固定」。
- **特效改用 GPU 實例化**：計畫寫「物件池」。火花、曳光、彈孔、爆炸、電漿球各是一個網格（InstancedBufferGeometry + ShaderMaterial），固定容量的環狀槽位，動畫在頂點著色器依時間計算；生成時只寫一個槽位、只上傳改過的範圍，不配置物件，每種最多 1 個 draw call、沒有特效時隱藏。彈孔用片段著色器程序生成（孔洞、碎裂邊緣、剛打上的高溫光，套用霧）。
- **火花顏色**：表面只有 `SurfaceType`，抓鉤點與標線原本是 `metal` 無法分辨發光表面，因此 `SURFACE_IMPACT.energy` 為青色火花、不留彈孔；**但沒有把關卡材質的 surface 改成 energy**（避免影響 M1-13 腳步聲），目前訓練場打到發光物仍是一般火花。要啟用時把 `MaterialDefs` 的 `grapple`／`marker` 改成 `surface: 'energy'`。
- **與畫面更新率無關的做法**：武器狀態以「渲染時間」= `weapons.time −（1 − alpha）× 固定步長` 取樣；後座踢動與槍口閃光依 `weapon:fire.time` 在該時間點加入（同一畫面內分段積分彈簧）；換彈姿勢依 `reloadStart`／`reloadEnd` 的時間戳計算（被打斷後以 exp 淡出）。為此三個換彈事件加了 `time` 欄位。落地彈跳仍在事件後的畫面才開始（`player:land` 沒有時間戳，誤差最多一個畫面）。
- **準星**：DOM（CSS 變數），不佔 draw call；霰彈的半徑 = 散布 + 彈丸圖案半徑。十字有 3 px 最小間隙（散布極小時仍看得清楚；只會比實際大）。樣式：步槍、手炮十字；霰彈、電漿圓；狙擊點＋淡色散布圈。開鏡時不透明度降到 0.45，狙擊鏡遮罩出現時淡出。
- **彈道起點仍是眼睛**（M1-10）：曳光從畫面上的槍口位置畫到命中點；電漿球外觀在前 8 m 內從槍口往真實位置收斂。
- **槍模描述鍵**取到 1e-6：調參面板綁定時會把數值依步進改寫（例如 0.39999999999999997），原本每次切到新武器都會重建一次槍模。
- **加了手套與前臂**（計畫沒寫，沒有手的槍看起來像浮在空中）；霰彈的左手跟著泵動護木。
- **未做**：彈殼拋出（計畫標為可選）；換彈時沒有獨立的手部動作（彈匣自己移動）；Dash 沒有專屬 viewmodel 姿勢。

### 調整過的數值

- 腰射位置（m）：步槍／狙擊 (0.17, −0.19, −0.34)、霰彈 (0.17, −0.19, −0.32)、手炮 (0.15, −0.17, −0.40)、發射器 (0.18, −0.20, −0.34)（第一版 −0.165 時槍太大）；眼距 機瞄／紅點 0.2、狙擊鏡 0.1。
- 擺動 0.012°/(°/s)、上限 4°、5 Hz／0.75；晃動 ±8 mm／±6 mm、roll 0.6°、步距 2.4 m、衝刺 ×1.6；呼吸 1.5 mm／0.3 Hz；姿勢彈簧 4 Hz；衝刺 (0.02, −0.045, 0.03) m、(−14°, 22°, 12°)；滑鏟 15°；跑牆外偏 0.035 m、6°；空中 +12 mm／2°；落地 1.6 mm/(m/s)、上限 35 mm、6 Hz／0.45；開鏡踢動 ×0.45、動作保留 0.18。
- 換彈影格（進度）：傾斜 0.15、拔出 0.28、掉落 0.42、新彈匣 0.48、插入 0.66、上膛 0.72–0.86、回正 0.84–1；roll −24°、pitch 10°；中斷淡出 10/s。泵動 0.06 m（射擊間隔 0.18–0.58）。切槍下移 0.28 m／−40°；近戰前推 0.2 m、峰值 0.3。
- 特效：槍口閃光 0.05 s、大小 0.16–0.26 m；曳光 步槍 700 m/s、9 m、0.07 s，霰彈機率 0.6，狙擊整條 0.45 s；火花 步槍 7、霰彈每顆 3、手炮 14、狙擊 20；彈孔上限 96、高溫 1.2 s；爆炸 0.45 s、48 顆火花、焦痕 ×0.45 半徑、高溫 0.25（0.6 時像橘色花）；點光源 槍口 8–12、爆炸 40；低畫質火花與霰彈曳光 ×0.5。

### 實際驗證

- `npm run typecheck`、`npm test`（24 檔、475 測試）、`npm run build`、`npm run check:dist`（9 個檔案、5.60 MiB）全部通過。
- 單元測試：槍模部件、合併網格（每把 ≤ 9 個網格）、共用材質、描述鍵；動作曲線（換彈頭尾為 0、彈匣隱藏區間、上膛、逐發、切槍、近戰、泵動、發光）；開鏡瞄具落在畫面中心；60／240 FPS 姿勢一致（< 1e-6）；世界 FOV 不影響槍模；槍口換算到世界後投影位置與槍模相同；環狀配置與降量；命中／爆炸／開火事件、彈孔上限 96 循環覆蓋、低畫質減量、電漿外觀偏移；準星換算與 30 發驗收。
- headless Chrome（ANGLE D3D11，GTX 1650）與 Edge 以 CDP 開 `vite preview` 的 `#debug&nolock`：啟動與進場正常，主控台沒有錯誤（只有 favicon 404）；pass 順序 `RenderPass → viewmodel:clearDepth → viewmodel → effects → smaa`；預熱 50 個材質、26 個著色器程式，5 把武器開火、開鏡、狙擊鏡、換彈、電漿爆炸後仍是 26（沒有新的編譯）；draw call 46–59（含 viewmodel 與特效）；貼牆截圖槍模完整、不穿牆；狙擊鏡遮罩與 4× 縮放；彈孔與火花出現；切槍不再重建槍模（槍模數維持 5）。自己啟動的 vite preview 與 headless 瀏覽器已關閉、暫存設定檔已刪除。

### 未驗證

- **射擊手感與 viewmodel 觀感**（驗收「實機」）：沒有真人以實體滑鼠、有頭瀏覽器試玩；擺動、晃動、後座踢動、換彈節奏、閃光與曳光亮度只看過靜態截圖與數值。5 把槍的槍模輪廓仍偏相似，留給 M1-16 依試玩調整。
- **有頭瀏覽器的 frame time 圖**：只有 headless 的畫面間隔（rAF 約 52 Hz、本身抖動大）與著色器程式數。
- **實機效能**：GTX 1650 實際 FPS、大量特效同時存在時的成本未量測（兩盞世界點光源讓每個受光像素多算 2 盞點光）。
- 60／240 FPS 一致性以無頭數值驗證，沒有錄影比較；落地彈跳有最多一個畫面的時間差。
- 平台模擬頁（跨來源 iframe）內沒有重跑；低畫質減量只有單元測試。
