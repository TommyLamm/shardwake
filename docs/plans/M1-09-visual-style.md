# M1-09 視覺風格與後處理

- 里程碑：M1 手感原型
- 前置：M1-04（M1-05 之後任何時間都可以做）
- 狀態：完成

## 目標

把灰盒訓練場變成有未來科技感的霓虹場景，同時守住 GTX 1650 的效能預算，並消除第一次出現時的著色器卡頓。

## 範圍

- 包含：渲染設定、程序貼圖、材質庫、燈光、天空與霧、後處理、全息看板、畫質預設、著色器預熱。
- 不含：武器與特效材質（M1-11），但預熱清單要能讓它們加入。

## 任務

- [x] 渲染設定：`outputColorSpace` = sRGB、AgX 色調映射、`powerPreference: 'high-performance'`；關閉 renderer 內建 antialias（改用 SMAA）。
- [x] `world/Textures.ts`：Canvas 程序貼圖——金屬面板接縫、格線（保留速度感）、危險條紋、六角網格、發光線條遮罩；生成 mipmap、最大 anisotropy；快取，避免重複生成。（實作改為純函式產生像素 + DataTexture，可無頭測試；見實作紀錄）
- [x] `world/Materials.ts`：材質庫（地板、牆、金屬、發光青／洋紅／橘、全息看板、玻璃）；`RoomEnvironment` + PMREM 作為環境反射；發光材質強度 > 1，讓 Bloom 只抓發光處。
- [x] 燈光：1 盞方向光（陰影跟隨玩家、貼圖 2048、依 texel 對齊避免閃爍）＋半球光。**燈光數量固定**，避免著色器重編譯。
- [x] `world/Sky.ts`：漸層天空球（深藍→紫）、星點、遠景巨構剪影（破碎晶格結構與發光窗格）、指數霧。
- [x] `fx/PostFX.ts`（pmndrs `postprocessing`）：RenderPass → Bloom（mipmap blur、亮度閾值約 0.8）→ SMAA → Vignette → ChromaticAberration（預設 0，受擊或 Dash 時脈衝）；HalfFloat buffer；為 M1-11 的 viewmodel 第二個 RenderPass 預留位置。（實際順序：RenderPass →〔viewmodel〕→ 色差＋Bloom＋AgX＋暗角 → SMAA；見實作紀錄）
- [x] 全息看板：Canvas 繪製中文文字（系統字型 `"Microsoft JhengHei", "PingFang TC", "Noto Sans TC", sans-serif`）→ 發光貼圖，加上輕微閃爍 shader。
- [x] 畫質預設（低／中／高）：陰影開關與解析度、Bloom 開關、渲染比例 0.5–1.0、SMAA 開關；存入設定。
- [x] 著色器預熱：載入完成時呼叫 `renderer.compileAsync(scene, camera)`；提供 `registerWarmup(material | object)`，之後 M1-11 的 viewmodel 與特效材質也要加入。
- [x] 訓練場套用正式材質：各分區不同主色、邊緣發光條、中文看板標示。

## 交付（給後續計畫）

- `Materials`／`Textures` 材質庫與程序貼圖工具。
- `PostFX` 管線，含 viewmodel pass 的插入點與色差脈衝介面。
- `registerWarmup()` 與畫質預設。

## 驗收

- [ ] 高畫質、1080p、GTX 1650：訓練場（無戰鬥）≥ 120 FPS，draw call < 120。（部分驗證：draw call 已驗證，各區 37–51，最多 51。FPS 未驗證：只能在 headless Chrome／Edge（ANGLE D3D11，實體 GTX 1650）以「同步連跑 150 個畫面後 readPixels」量吞吐量，完整畫面（輸入＋模擬＋鏡頭＋渲染）3.5–4.1 ms，約 242–282 FPS；只算渲染 2.2–3.7 ms。headless 的 rAF 固定在約 52 Hz，有頭瀏覽器實際遊玩的 FPS（螢幕更新率、合成器、輸入）沒有量到）
- [ ] 低畫質在內顯上 ≥ 60 FPS（記錄顯示卡型號）。（未驗證：本機只有 NVIDIA GeForce GTX 1650，沒有內顯可測。同一張卡上低畫質 1286 × 723、23 draw call，渲染吞吐量 1.6–2.2 ms，僅供參考）
- [ ] 第一次進場、第一次看到發光物都不會卡頓（用 frame time 圖確認）。（部分驗證：載入時預熱後有 18 個著色器程式；第一次巡視全部 12 區、俯瞰與遠景、觸發 Dash 色差之後仍是 18 個，沒有新的著色器編譯。headless 下點擊進場後 2 秒的畫面間隔最大 21.2 ms，第一次巡視最大 21.5–29.6 ms（中位數約 19 ms，是 headless 的 rAF 節奏）。有頭瀏覽器的 frame time 圖與實機觀感未驗證）
- [x] 截圖存入 `docs/screenshots/M1-09-*.png`。（spawn、wallrun、towers、overview、low、aberration；960 × 540、256 色，每張約 100 KB）

## 實作紀錄

完成日期：2026-11-28。

### 新增／修改檔案

- 新增 `src/core/quality.ts`（`QUALITY_PRESETS`、`resolveQualityPreset()`、`postPassesChanged()`、`nearestPowerOfTwo()`；`Settings.ts` 轉出）。
- 新增 `src/world/Textures.ts`（純函式 `generatePattern()`：panel／hex／hazard／lines／grid 五種圖樣，輸出 albedo、surface、normal、glow 四層；`heightToNormal()`、`hexCell()`、`patternKey()`；`TextureCache`）、`src/world/MaterialDefs.ts`（材質表 `LEVEL_MATERIALS`／`LEVEL_MATERIAL_TABLE`、圖樣表 `PATTERNS`、`materialShadowFlags()`）、`src/world/Materials.ts`（`MaterialLibrary`、`setupEnvironment()`、`ENVIRONMENT_CONFIG`）、`src/world/HoloBoards.ts`（全息看板：Canvas 文字圖集、`packShelves()`、閃爍／掃描線著色器）、`src/world/Lighting.ts`（`SceneLighting`、`sunDirection()`、`snapToShadowTexels()`）、`src/world/Sky.ts`（`Sky`、`generateStars()`、`generateMegastructure()`、`buildMegastructureGeometry()`）。
- 新增 `src/fx/PostFX.ts`（`PostFX`、`PulseEnvelope`、`describePasses()`）、`src/fx/Warmup.ts`（`registerWarmup()`、`runWarmup()`、`WarmupRegistry`、代理物件與貼圖收集）、`src/fx/VisualPanel.ts`（調參面板「視覺」）。
- 修改：`src/main.ts`（renderer 設定、PostFX 取代 `renderer.render`、環境反射、燈光、天空、材質庫、畫質切換、Dash 色差、載入時預熱、遠裁切 600 → 900 m；`#debug` 時 `__shardwake` 多 `postfx`、`lighting`、`sky`、`library`、`warmup`、`getWarmupReport`）、`src/core/Settings.ts`（新設定 `chromaticAberration`；`qualityPreset` 改回傳 `resolveQualityPreset()`）、`src/world/Greybox.ts`（移除 `GreyboxVisuals`、`createGreyboxEnvironment`、`GREYBOX_MATERIALS`，保留格線、`PlainVisuals`、`makeTextTexture`；`LevelVisuals` 加 `labels()`、`shadowFlags()`）、`src/world/LevelBuilder.ts`（陰影旗標、看板批次、`userData.dispose`、預設材質表改 `LEVEL_MATERIAL_TABLE`）、`src/world/levels/TrainingGround.ts`（邊緣發光條、方向看板）、`src/world/Level.ts`、`src/world/LevelData.ts`（型別與註解）、`src/fx/SpeedLines.ts`（註解）、`src/world/index.ts`、`src/fx/index.ts`。
- 測試：新增 `tests/visual.test.ts`（24 項）；`tests/level-builder.test.ts`、`tests/training-ground.test.ts` 改用 `LEVEL_MATERIAL_TABLE`。全專案 22 檔、401 測試。
- 截圖：`docs/screenshots/M1-09-{spawn,wallrun,towers,overview,low,aberration}.png`。

### 實際 API 摘要（給後續計畫）

- **材質與貼圖（M1-11）**：`MaterialLibrary`（main.ts 的 `library`）實作 `LevelVisuals`。`library.material(id)`（`LEVEL_MATERIALS` 的 id，同 id 同物件）；`library.glowMaterial(color, intensity)`（共用、不受光、顏色 × 強度 > 1 → Bloom，可給武器發光條、槍口閃光核心）；`library.textures.get(PATTERNS.xxx 或自訂 PatternSpec)` 回傳 `{ map, surface, normal, glow }`（surface：G = 粗糙度、B = 金屬度倍率，可同時當 `roughnessMap`／`metalnessMap`）；`library.refresh()`、`library.update(dt)`。程序貼圖純函式 `generatePattern(spec, size, tileMeters)`。材質表欄位：`kind`（standard／glow／glass）、`pattern`、`color`、`emissive`、`emissiveIntensity`、`roughness`、`metalness`、`normalScale`、`envIntensity`、`opacity`、`castShadow`／`receiveShadow`，以及表面旗標。
- **發光規則**：Bloom 亮度閾值 0.8（線性 HDR）。要發光的東西把顏色 × 強度做到 > 1（`MeshBasicMaterial` 用 `color.multiplyScalar()`，standard 用 `emissiveIntensity`）；一般受光表面保持在閾值以下。
- **PostFX**：`postfx.addViewmodelPass(scene, camera)` → `{ clear, pass, dispose() }`，在主場景之後、效果之前插入「清深度 + RenderPass」（viewmodel 不被世界遮住、仍經過 Bloom／AgX／SMAA；`ignoreBackground`、`skipShadowMapUpdate`）。色差脈衝 `postfx.pulseAberration(strength 0–1, durationSec)`（設定「畫面色差」關閉時忽略；Dash 已接 `player:dash`，M1-12 受擊時呼叫）。其他：`postfx.inputBuffer`（場景 buffer）、`applyQuality(q)`、`applyConfig()`、`rebuild()`、`passNames`、`config`（`POSTFX_CONFIG`）。PostFX 是 Game 系統（name `render`、order render），`render()` 以 `frame.dt` 推進色差並畫一個畫面。`renderer.info.autoReset = false`，PostFX 每畫面重設，`renderer.info.render.calls` 包含所有 pass。
- **預熱**：`registerWarmup(material | object)`（`@/fx/Warmup`）回傳取消函式；下一次 `runWarmup()`（載入完成、切換畫質、面板「重新預熱」）時，以主場景的燈光、霧、環境貼圖，並以 `postfx.inputBuffer` 為 render target 編譯（物件以 `clone(false)` 代理，保留 InstancedMesh／Points 等類型，不改原本的父子關係）。M1-11 的 viewmodel 場景與特效池材質要在 main.ts 的 `await warmup('載入')` 之前建立並註冊；之後才註冊的要再呼叫 main.ts 的 `warmup(reason)`（`#debug` 時為 `__shardwake.warmup`）。場景內的物件（含隱藏的）不用註冊。
- **畫質**：`resolveQualityPreset(level)` → `{ renderScale, shadows, shadowMapSize, bloom, smaa, smaaQuality }`；`settings.qualityPreset`。切換時 main.ts 的 `applyQuality()` 依序更新渲染比例、陰影、後處理並重新預熱。
- **燈光／天空**：`SceneLighting`（`hemi`、`sun`、`apply()`、`applyQuality()`、`texelSize`、`shadowCenter`；order fx，每畫面依相機更新陰影中心）；`Sky`（`apply()`、`stats`、`materials()`）。燈光數量固定為半球光 + 1 盞方向光，之後不要加燈（會讓全部材質重新編譯）；局部光感用發光材質 + Bloom。

### 偏離計畫之處與設計決定

- **後處理順序**：計畫寫 Bloom → SMAA → Vignette → ChromaticAberration。實作為「RenderPass →（viewmodel）→ 主合成 EffectPass（色差 → Bloom → AgX 色調映射 → 暗角）→ SMAA」。原因：SMAA 的邊緣偵測讀原始像素值，放在色調映射後的 LDR 畫面才準；色差與 SMAA 都是卷積效果，不能放同一個 pass；色差放主合成 pass 的第一個（postprocessing 會把卷積效果排最前），偏移為 0 時著色器跳過額外取樣，不需要開關 pass（開關最後一個 pass 會改變 renderToScreen，觸發重新編譯）。共 2 個全螢幕合成 pass（低畫質 1 個）＋ Bloom 的 mipmap 鏈。
- **色調映射**：renderer 設 `NoToneMapping`，AgX 由 `ToneMappingEffect` 執行（renderer 的色調映射只在直接畫到畫面時生效，經後處理時要由效果處理）。曝光沿用 `renderer.toneMappingExposure`（`POSTFX_CONFIG.exposure`）。
- **預熱的 render target**：three 的著色器參數含輸出色彩空間與色調映射，由「目前的 render target」決定；只呼叫 `compileAsync(scene, camera)` 會編出直接畫到畫面的版本，實際渲染時仍會重新編譯。`runWarmup()` 先 `setRenderTarget(postfx.inputBuffer)`、上傳所有貼圖（`initTexture`，含 mipmap 生成），再 `compileAsync`；之後畫一個畫面（陰影深度材質與後處理材質在第一次 render 才編譯）。載入流程在預熱完成後才進入標題。
- **畫質切換會重新編譯**：陰影開關改變燈光狀態（受光材質換著色器變體），Bloom／SMAA 開關重建效果 pass。切換後立即重新預熱（`KHR_parallel_shader_compile` 下非同步），只有切換畫質的那一刻可能短暫卡頓；切回用過的畫質不會再編譯（實測維持 28 個程式）。陰影以 `sun.castShadow` 切換，`renderer.shadowMap.enabled` 固定開啟。
- **畫質預設存入設定**：玩家設定只存等級（沿用 `quality` 欄位，`shardwake:settings:v1`）；各等級內容是設定資料，可在面板「視覺/畫質預設」調整（不存檔）。低 = 渲染比例 0.67、無陰影、無 Bloom、無 SMAA；中 = 0.85、陰影 1024、Bloom、SMAA 中；高 = 1.0、陰影 2048、Bloom、SMAA 高。`resolveQualityPreset()` 把渲染比例夾在 0.5–1、陰影尺寸取 2 的次方（512–4096），未知等級視為高。
- **新增設定「畫面色差」**（`chromaticAberration`，預設開，舊存檔自動補預設值）：色差脈衝對部分玩家不舒服，比照 M1-08 的舒適選項可個別關閉。
- **程序貼圖改用純函式 + DataTexture，不用 Canvas**：計畫寫 Canvas；像素用純函式計算可以無頭測試、結果可重現，也不受字型與瀏覽器差異影響。只有需要字型的全息看板用 Canvas。圖樣以 5 m 一張與世界 UV 對齊（相鄰面的接縫接得起來），面板尺寸取能整除 5 m 的值；六角格在 5 m 內取 7 × 4 個週期（垂直方向約 1% 拉伸）。每個圖樣四層貼圖：albedo、粗糙度／金屬度、法線（高度圖中央差分）、發光遮罩；地板保留 1.25 m 細格線與 5 m 發光線（速度感）。512 px、6 組圖樣在載入時共生成約 240 ms。
- **材質表取代灰盒材質表**：`GREYBOX_MATERIALS`／`GreyboxVisuals` 移除，表面類型與預設旗標搬到 `LEVEL_MATERIALS`（id 不變，另加 `glowCyan`／`glowMagenta`／`glowOrange`），M1-04～M1-08 的物理與移動行為不變。分區發光主色：出生區、滑鏟、高塔、外牆 = 青；跑牆、浮台 = 洋紅；靶場、攀爬、戰區、掩體 = 橘；抓鉤點與標線為不受光的發光材質。
- **全息看板合併成一個網格**：看板各自一個材質會多約 30 個 draw call。改為整個關卡的看板畫進同一張 2048 寬的 Canvas 圖集（貨架式裝箱，放不下時字級 × 0.8 重試），合併成一個網格、一個材質、一個 draw call；每塊看板有自己的閃爍相位（頂點屬性）。`LevelVisuals.labels()` 是新的批次介面，`LevelBuilder` 優先使用；`stats.labels` 仍回報看板數（30，含中央廣場 3 塊新的方向看板）。看板只有正面（與 M1-04 相同）。
- **邊緣發光條是關卡資料**（`buildGlowStrips()`，58 個無碰撞基本體，不影響移動與抓鉤判定）：外牆頂緣與牆腳、跑牆長廊、Z 字牆板頂緣、滑鏟坡兩側與坡頂、半管唇緣、攀爬牆頂緣（橘色 = 可攀的邊緣）、浮台前後緣、高塔四角、出生平台外緣、戰區掩體頂緣。同色合併成一個網格。
- **天空**：天空球與星點跟著相機，頂點輸出 z = w（畫在遠裁切面），在不透明物件之後畫，被遮住的像素由深度測試略過。巨構剪影固定在世界中（380–520 m，12 組破碎立方晶格，約 500 段梁、440 個窗格，各合併成一個網格），不受霧影響，以頂點色做「越低越接近地平線霧色」的大氣透視。因此相機遠裁切由 600 m 改為 900 m（近裁切 0.05 m 不變，深度精度主要由近裁切決定）。霧改為指數霧（FogExp2，密度 0.0042：100 m 約 16%、200 m 約 51%）。
- **陰影**：方向光陰影跟著相機（往視線水平方向前移 14 m），範圍 ±45 m、光源距離 140 m；中心投影到光空間後兩軸各取 texel 的整數倍（`snapToShadowTexels()`，軸向與陰影相機的 lookAt 一致），相機移動時陰影邊緣不閃爍。PCF 陰影。standard 材質投射與接收，發光條、看板不投射。
- **速度線沒有改寫成 Effect**：Effect 的開關會讓合成著色器重新編譯；維持場景中的全螢幕四邊形（強度 0 時隱藏，不佔 draw call）。速度線畫進 HDR buffer，經色調映射，不透明度低於 Bloom 閾值。
- **renderer**：`antialias: false`（改用 SMAA）、`powerPreference: 'high-performance'`、`stencil: false`、`outputColorSpace = SRGB`、`shadowMap` 開啟（PCFShadowMap）。後處理 buffer 為 HalfFloat；顯示卡不支援 `EXT_color_buffer_half_float`／`EXT_color_buffer_float` 時退回 8 位元（Bloom 會變弱）。
- **調參面板**：原「關卡/灰盒」「關卡/灰盒顏色」改為「視覺」：畫質預設（低／中／高）、後處理、燈光、環境反射、天空與霧、全息看板、材質（底色、發光色、強度、粗糙度、金屬度）、圖樣（4 種面板圖樣的主要參數，改了會重新生成貼圖）、測試（色差脈衝、重新預熱）、監看（畫質、後處理組成、陰影 texel、著色器程式數、預熱結果、程序貼圖、天空統計、buffer 類型）。
- 沒有新增套件（`postprocessing` 6.39.6 原本就在 dependencies）。

### 調整過的數值

- 後處理：曝光 1；Bloom 強度 1.1、閾值 0.8、平滑 0.12、半徑 0.7、7 層（ADD 混合）；暗角 0.32／0.55；色差最大偏移 0.006（中心 0.18 內不受影響）；Dash 色差 0.55／0.28 s（包絡 (1 − t/T)²）。
- 燈光：半球光 #8a96d8／#22183a × 1.1；方向光 #dce6ff × 2.4、方位 215°、仰角 52°；陰影 bias −0.0004、normalBias 0.04；環境反射（RoomEnvironment PMREM）強度 0.35。
- 天空：天頂 #050a1e、地平線 #3a1f5c、霧光帶 #8a3a9a × 0.35、1600 顆星、霧 #1a1430／0.0042、巨構窗格強度 3。
- 全息看板：強度 2.4、背景不透明度 0.55、閃爍 0.12（9/s）、掃描線 0.22（14 條/m、0.35 m/s）。
- 發光條強度 3.2（原先 4 時跑牆長廊的光條過曝）；抓鉤點 4、標線 3.5；地板發光線 0.8–1.4（出生區由 1.6 降為 1.2）。巨構第一版太小、太近（9 組、330–400 m），改為 12 組、380–520 m、格距 24–40 m。

### 實際驗證

- `npm run typecheck`、`npm test`（22 檔、401 測試）、`npm run build`、`npm run check:dist`（9 個檔案、5.48 MiB）全部通過。
- 單元測試（`tests/visual.test.ts`）：畫質預設的內容、夾值、未知等級、pass 組成；舊設定存檔補上「畫面色差」並保留其他值；程序貼圖可重現、tile 邊界發光、接縫較暗、兩側邊緣都是接縫、六角格距離、危險條紋兩色、法線換算；貼圖快取（欄位順序不影響 key、只生成一次、anisotropy 取較小值、invalidate、dispose）；材質表（圖樣存在、發光條強度 > 1、訓練場材質都有定義、陰影旗標）；材質庫（同 id 同物件、standard 有貼圖與發光遮罩、共用貼圖、glow 線性顏色 > 1、玻璃、refresh、沒有 document 時看板為 null）；看板裝箱不重疊；星點與巨構可重現且在遠裁切內；光線方向；陰影 texel 對齊；色差包絡；預熱清單與代理物件；LevelBuilder 陰影旗標與看板批次；訓練場發光條全部無碰撞。
- headless Chrome 與 Edge（ANGLE D3D11，實體 NVIDIA GeForce GTX 1650）透過 CDP 開 `vite preview` 的 `#debug&nolock`，1920 × 1080：啟動並進入 playing；主控台只有 Rapier 初始化與預熱訊息（另有瀏覽器自動要求 `/favicon.ico` 的 404，與遊戲無關）；後處理 buffer 為 HalfFloat；預熱 25 個材質、25 張貼圖、18 個著色器程式，約 450–600 ms；高畫質 draw call 出生點 49、各區 41–51、俯瞰 44、遠景 37（< 120），三角形約 1.3–1.5 萬；第一次巡視 12 區、俯瞰、遠景、Dash 色差後著色器程式仍是 18；Dash 事件觸發色差；切換低／中／高：渲染尺寸 1286 × 723／1632 × 918／1920 × 1080，低畫質 23 draw call，pass 組成與陰影開關正確，切回高畫質後再巡視不增加著色器程式（28）；`shardwake:settings:v1` 寫入 `chromaticAberration`。吞吐量（同步連跑 150 畫面）：高畫質完整畫面 3.5–4.1 ms、只渲染 2.2–3.7 ms；中 2.9–3.7 ms；低 1.6–2.2 ms。
- 平台模擬頁（`npm run sim`，跨來源 sandbox iframe，headless Chrome）：iframe 內啟動完成、預熱訊息正常、`embedded = true`、`crossOriginIsolated = false`。
- 截圖檢查：各分區底色與發光主色不同、邊緣發光條、中文全息看板與方向看板、星空與遠景巨構、低畫質（無陰影、無 Bloom）、色差脈衝。

### 未驗證

- **GTX 1650 實際 FPS**：只量到 headless 的同步吞吐量（估計 240–280 FPS）；有頭瀏覽器實際遊玩（vsync、合成器、輸入、長時間）的 FPS 沒有量。
- **內顯低畫質 ≥ 60 FPS**：本機沒有內顯（只有 GTX 1650），未驗證。
- **卡頓**：著色器程式數證實沒有額外編譯，但有頭瀏覽器的 frame time 圖、第一次 Dash、第一次抓鉤的實機觀感未驗證；切換畫質當下的短暫卡頓沒有量測。
- **平台模擬頁內點擊開始**：headless 下 iframe 內的滑鼠鎖定回報 `WrongDocumentError`；以 M1-08 的提交（HEAD）建置比對結果相同，屬測試環境限制。跨來源 iframe 內的遊玩流程沒有重跑。
- **觀感**：Bloom 強度、發光條亮度、地板發光線密度、霧與天空色調、看板閃爍是否干擾、色差是否令人不適，都只看過靜態截圖，沒有真人試玩調整。
- 顯示卡不支援半浮點 render target 時退回 8 位元的路徑沒有實際跑過。
