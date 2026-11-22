# M1-09 視覺風格與後處理

- 里程碑：M1 手感原型
- 前置：M1-04（M1-05 之後任何時間都可以做）
- 狀態：未開始

## 目標

把灰盒訓練場變成有未來科技感的霓虹場景，同時守住 GTX 1650 的效能預算，並消除第一次出現時的著色器卡頓。

## 範圍

- 包含：渲染設定、程序貼圖、材質庫、燈光、天空與霧、後處理、全息看板、畫質預設、著色器預熱。
- 不含：武器與特效材質（M1-11），但預熱清單要能讓它們加入。

## 任務

- [ ] 渲染設定：`outputColorSpace` = sRGB、AgX 色調映射、`powerPreference: 'high-performance'`；關閉 renderer 內建 antialias（改用 SMAA）。
- [ ] `world/Textures.ts`：Canvas 程序貼圖——金屬面板接縫、格線（保留速度感）、危險條紋、六角網格、發光線條遮罩；生成 mipmap、最大 anisotropy；快取，避免重複生成。
- [ ] `world/Materials.ts`：材質庫（地板、牆、金屬、發光青／洋紅／橘、全息看板、玻璃）；`RoomEnvironment` + PMREM 作為環境反射；發光材質強度 > 1，讓 Bloom 只抓發光處。
- [ ] 燈光：1 盞方向光（陰影跟隨玩家、貼圖 2048、依 texel 對齊避免閃爍）＋半球光。**燈光數量固定**，避免著色器重編譯。
- [ ] `world/Sky.ts`：漸層天空球（深藍→紫）、星點、遠景巨構剪影（破碎晶格結構與發光窗格）、指數霧。
- [ ] `fx/PostFX.ts`（pmndrs `postprocessing`）：RenderPass → Bloom（mipmap blur、亮度閾值約 0.8）→ SMAA → Vignette → ChromaticAberration（預設 0，受擊或 Dash 時脈衝）；HalfFloat buffer；為 M1-11 的 viewmodel 第二個 RenderPass 預留位置。
- [ ] 全息看板：Canvas 繪製中文文字（系統字型 `"Microsoft JhengHei", "PingFang TC", "Noto Sans TC", sans-serif`）→ 發光貼圖，加上輕微閃爍 shader。
- [ ] 畫質預設（低／中／高）：陰影開關與解析度、Bloom 開關、渲染比例 0.5–1.0、SMAA 開關；存入設定。
- [ ] 著色器預熱：載入完成時呼叫 `renderer.compileAsync(scene, camera)`；提供 `registerWarmup(material | object)`，之後 M1-11 的 viewmodel 與特效材質也要加入。
- [ ] 訓練場套用正式材質：各分區不同主色、邊緣發光條、中文看板標示。

## 交付（給後續計畫）

- `Materials`／`Textures` 材質庫與程序貼圖工具。
- `PostFX` 管線，含 viewmodel pass 的插入點與色差脈衝介面。
- `registerWarmup()` 與畫質預設。

## 驗收

- [ ] 高畫質、1080p、GTX 1650：訓練場（無戰鬥）≥ 120 FPS，draw call < 120。
- [ ] 低畫質在內顯上 ≥ 60 FPS（記錄顯示卡型號）。
- [ ] 第一次進場、第一次看到發光物都不會卡頓（用 frame time 圖確認）。
- [ ] 截圖存入 `docs/screenshots/M1-09-*.png`。

## 實作紀錄

（完成後填寫）
