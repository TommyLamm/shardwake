# M1-08 鏡頭手感

- 里程碑：M1 手感原型
- 前置：M1-05（可與 M1-06、M1-07 並行）
- 狀態：完成

## 目標

讓速度、衝擊與姿態看得出來、感覺得到，但不會暈；每個效果都能個別關閉。

## 範圍

- 包含：CameraRig、FOV、傾斜、落地彈簧、頭部晃動、創傷式震動、速度線，以及對應設定。
- 不含：viewmodel 動畫（M1-11）、後座力（M1-10）。

## 任務

- [x] `camera/CameraRig.ts`：每個渲染畫面以插值後的位置加上眼高彈簧（蹲、滑鏟、攀爬時平滑）定位相機；所有效果疊加成偏移，與遊戲邏輯分離，不改變命中判定用的視線方向（後座力除外）。
- [x] FOV：設定值是水平 FOV（預設 103°，範圍 80–120），依畫面比例換算成垂直 FOV。動態 FOV = 基礎值 ＋ 速度對應（10→22 m/s 對應 +0→+8°）＋ Dash 衝擊（+10°，0.3 s 回落）＋ 抓鉤中 +4°；以 `damp` 平滑；設定可關閉動態 FOV。
- [x] 傾斜（roll）：跑牆 12°（朝牆外）、滑鏟 3°、側移 1°、側向 Dash 2°，用彈簧平滑；設定可調強度。
- [x] 落地：依 `land.impactSpeed` 產生下沉衝量（最大 0.12 m）並輕微往下點頭，彈簧回彈（頻率 8 Hz、阻尼 0.7）。
- [x] 頭部晃動：依移動速度與腳步節奏的小幅垂直／水平擺動（衝刺時 ±0.015 m），空中停止；設定可關閉。
- [x] 創傷式震動：`addTrauma(amount)`，位移與旋轉 = trauma² × 雜訊，每秒衰減；設定可調強度 0–100%。來源：開火、爆炸（依距離）、重落地、受擊。
- [x] 速度線（`fx/SpeedLines.ts`）：水平速度 > 14 m/s 時淡入的螢幕空間速度線（後處理 Effect 或全螢幕四邊形）；設定可關閉。
- [x] 調參面板「鏡頭」資料夾。

## 交付（給後續計畫）

- `CameraRig.addTrauma()`、`addFovKick()`、`addRollImpulse()`，給武器、爆炸、受擊使用。
- 目前的水平／垂直 FOV（準星大小與開鏡靈敏度換算會用到）。

## 驗收

- [x] 測試：水平↔垂直 FOV 換算正確（16:9、21:9、4:3）；彈簧在 30–240 Hz 畫面下行為一致。
- [x] 所有效果關閉時，鏡頭完全穩定（給容易暈的玩家）。（無頭測試 600 畫面＋headless Chrome／Edge 實測：位置、旋轉、FOV 偏差皆為 0）
- [ ] 實機：跑牆傾斜、Dash 衝擊、落地下沉都明顯但不暈；記錄最終預設值。（未驗證：沒有有頭瀏覽器與實體滑鼠可實際遊玩，「明顯但不暈」需要真人主觀判斷。預設值已記錄在實作紀錄，目前即計畫數值）

## 實作紀錄

完成日期：2026-11-23。

### 新增／修改檔案

- 新增 `src/camera/CameraConfig.ts`（`CAMERA_CONFIG`、`CAMERA_PANEL`）、`src/camera/cameraMath.ts`（純函式：`resolveFov`、`speedFovBonus`、`kickEnvelope`／`FovKicks`、`springPeakPerVelocity`／`springImpulseForPeak`、`landingDipAmount`、`heavyLandingTrauma`、`rollTarget`、`dashRollImpulse`、`headBob`、`Trauma`、`traumaFalloff`、`speedLinesTarget`）、`src/camera/CameraRig.ts`、`src/camera/CameraPanel.ts`（調參面板「鏡頭」）、`src/fx/SpeedLines.ts`。
- 修改：`src/core/Settings.ts`（6 個新設定欄位）、`src/main.ts`（移除暫時的 `cameraSystem` 與 `applyFov`，改用 `CameraRig` 與 `SpeedLines`；玩家控制器不再直接移動相機；`#debug` 時 `__shardwake` 多 `cameraRig`、`speedLines`）、`src/camera/index.ts`、`src/fx/index.ts`、`src/camera/FreeCamera.ts`／`src/player/PlayerController.ts`（註解）。
- 測試：新增 `tests/camera.test.ts`（34 項，含驗收的兩項測試與一個 Rapier 整合測試）。全專案 21 檔、377 測試。

### 實際 API 摘要（給後續計畫）

- `new CameraRig({ camera, view, getSettings, getPlayer, bus?, config? })`：Game 系統（order = camera，`render` 以 `frame.dt` 推進；無頭測試呼叫 `advance(dt, alpha)`）。`getPlayer()` 回傳 `PlayerState`（除錯飛行時回傳 null：只套用視角與基礎 FOV，位置交給自由相機）。
- 給武器、爆炸、受擊（M1-10、M1-12、M3、M5-02）：`addTrauma(amount)`（0..1，總量上限 1）、`addTraumaAt(origin, amount, radius)`（依距離 (1 - d/r)² 衰減，回傳實際加入量）、`addFovKick(amountDeg, duration, attack?)`（水平度，可為負；動態 FOV 關閉時忽略）、`addRollImpulse(amountDeg)`（峰值約等於指定角度，正值 = 鏡頭上方往左傾）、`snap()`。
- 目前的 FOV（準星大小、開鏡靈敏度換算）：`rig.horizontalFov`／`rig.verticalFov`（含動態 FOV），`rig.state.baseHorizontalFov`／`baseVerticalFov`（只有設定值）。`rig.state` 另有 `rollDeg`、`dip`、`trauma`、`bob`、`eyeOffset`。開鏡縮放（M1-10／M1-11）建議以新增「FOV 倍率」欄位的方式加在 CameraRig，不要直接寫 `camera.fov`（每畫面會被覆寫）。
- 鏡頭訂閱的事件：`player:land`（下沉、重落地震動）、`player:dash`（FOV 衝擊、側向傾斜衝量）、`player:respawn`（直接到位）；其餘讀 `PlayerState`（`state`、`speed`、`velocity`、`wallNormal`、`eyeHeight`、插值用的 previous 欄位）。不改動任何移動邏輯（整合測試確認有無鏡頭時玩家軌跡完全相同）。
- 視線：命中判定仍用 `input.view` 的 `viewYaw／viewPitch`（含 M1-10 後座力偏移）。鏡頭效果（傾斜、點頭、震動、晃動）只影響畫面；點頭與震動會讓畫面中心與命中方向有不到 2° 的差，屬計畫要求的「不改變命中判定用的視線方向」。

### 偏離計畫之處與設計決定

- **新增玩家設定**（`shardwake:settings:v1`，版本不變，舊存檔自動補預設值）：`dynamicFov` 開、`cameraTilt` 1（0–1）、`landingDip` 開、`headBob` 開、`screenShake` 1（0–1，即 0–100%）、`speedLines` 開。計畫只列出 FOV、震動、晃動、傾斜的設定；為了「每個效果都能個別關閉」與「全部關閉時完全穩定」，落地下沉與速度線也各加一個開關。眼高彈簧與攀爬跟隨是平滑（不是晃動效果），沒有開關。
- **傾斜強度與震動強度乘在輸出上**：設定為 0 時輸出恰好為 0；彈簧與 trauma 照常累積，調回來時立即接續。
- **Dash 中凍結速度 FOV**：Dash 的位移速度 46.7 m/s 會讓速度 FOV 也衝到 +8°，與 +10° 衝擊疊成約 +18°（headless 實測 116°）。改為 Dash 狀態中速度 FOV 的目標維持進入前的值，只有衝擊表現 Dash（實測峰值 113°）。
- **速度 FOV 與速度線都用水平速度**（`PlayerState.speed`）；直直往下掉不會放大 FOV。動態 FOV 加在水平 FOV 上再換算成垂直。
- **FOV 衝擊包絡**：`fovKickAttack` 0.05 s 內 smoothstep 升起，之後在 duration（Dash 0.3 s）內 smoothstep 回落；衝擊不經過 damp（否則 +10° 會被平滑掉一半），速度與抓鉤的部分才用 damp（lambda 6）。最多同時 8 個衝擊（固定容量、不配置記憶體）。
- **垂直 FOV 上限 120°**（M1-02 未驗證項目）：直向或很窄的畫面時夾住，避免水平 103° 換算出約 131° 的魚眼；水平 FOV 回報夾住後的實際值。動態 FOV 的水平上限 150°。
- **傾斜方向**：跑牆依「牆面法線在視線右方的分量」計算（牆在右 → 鏡頭上方往左、往牆外傾），正對或背對牆時較小，視線沿牆時為滿值 12°（整合測試中視線偏 30°，約 10.4°）。側移與側向 Dash 往移動方向傾（Quake 慣例）。滑鏟固定往左傾 3°（`slideRollSide`，可在面板改成往右）。只有地面、空中狀態有側移傾斜；Dash、抓鉤、攀爬中狀態傾斜為 0（衝量照常）。
- **傾斜衝量**：`addRollImpulse` 用臨界阻尼 4 Hz 彈簧，依解析解換算初速，峰值約等於指定角度（約 0.04 s 到峰值）。落地下沉同樣以「峰值 = 下沉量」換算 8 Hz、阻尼 0.7 彈簧的初速；欠阻尼會回彈約 2 cm 以內。
- **落地數值**：落地速度 3 → 20 m/s 對應 0 → 0.12 m（普通 1.3 m 跳約 7.9 m/s → 3.5 cm；4 m 高約 13.9 m/s → 7.7 cm）；點頭 = 下沉 / 0.12 × 2°。重落地（≥ 15 m/s）加 trauma 0.15 → 0.45（25 m/s）。8 Hz、阻尼 0.7 的峰值在落地後約 22 ms，之後約 0.25 s 回彈完畢。
- **頭部晃動**：相位每 `bobStride` 2.4 m（與 M1-05 腳步間距相同）前進一步；垂直 −A·cos(2π·相位)（每步最低點），水平 H·sin(π·相位)（兩步一個週期，±0.008 m）；幅度與水平速度成正比（10.5 m/s 時 ±0.015 m，上限 1.2 倍）。只在 ground 狀態且著地時，離地或滑鏟時以 lambda 10 淡出。晃動與腳步事件沒有精確對齊（只共用步距）。
- **震動**：trauma 每秒衰減 1.2，震動量 = trauma²；最大 yaw／pitch 1.5°、roll 2.5°、位移 0.04 m（前後 0.02 m），18 Hz 的 2 層 fbm 值雜訊。開火、受擊的 trauma 量留給 M1-10／M1-12 決定（目前只有 API）；爆炸用 `addTraumaAt`。
- **眼高彈簧**：9 Hz 臨界阻尼，疊在 M1-05 的 0.12 s 線性蹲起之上（約多 30 ms 平滑）。**攀爬跟隨**：攀爬中腳底的垂直位移先記成落後量，再以 8 Hz 臨界阻尼彈簧追回（1.5 m 攀爬時鏡頭最多落後約 0.3 m，結束後約 0.3 s 追上）。單一畫面位移超過 6 m 視為傳送，所有彈簧直接到位；`player:respawn` 也會。
- **最終 pitch 夾在 ±89.5°**：視角 ±89° 加上點頭與震動不會翻轉。
- **效果在 render 以 `frame.dt` 推進**：暫停時凍結、慢動作時變慢。事件在固定步中加入衝量，整個畫面的 dt 都算在衝量之後，最多有一個畫面的時間誤差（60 Hz 時 16.7 ms）。
- **速度線**：全螢幕四邊形（頂點著色器直接輸出裁切座標，與相機無關），加法混合、不做深度測試、最後繪製；強度為 0 時隱藏（不多 draw call）。水平速度 14 → 22 m/s 以 smoothstep 淡入（lambda 6），最大不透明度 0.35；放射狀線條從中心半徑 0.55 外往外流動。M1-09 建立後處理管線後可改寫成 Effect。
- 事件與系統名稱：系統名稱 `cameraRig`、`speedLines`、`cameraMonitor`；沒有新增事件。

### 調整過的數值

- 計畫指定的數值都照用：水平 FOV 預設 103°（80–120）、速度 10 → 22 m/s 對應 +0 → +8°、Dash +10°／0.3 s、抓鉤 +4°、跑牆 12°、滑鏟 3°、側移 1°、側向 Dash 2°、落地最大 0.12 m、8 Hz、阻尼 0.7、衝刺晃動 ±0.015 m、速度線 14 m/s、震動強度 0–100%。
- 新增參數（計畫未指定）：FOV 平滑 lambda 6、衝擊升起 0.05 s、水平上限 150°、垂直上限 120°；側移滿值 7.5 m/s、Dash 側向門檻 0.3、傾斜彈簧 2.5 Hz（臨界）、衝量彈簧 4 Hz；下沉起點 3 m/s、滿值 20 m/s、點頭 2°、重落地 15 → 25 m/s 對應 trauma 0.15 → 0.45；水平晃動 ±0.008 m、參考速度 10.5 m/s、上限 1.2 倍、步距 2.4 m、淡入淡出 10；trauma 衰減 1.2/s、指數 2、yaw／pitch 1.5°、roll 2.5°、位移 0.04 m、18 Hz；眼高彈簧 9 Hz、攀爬跟隨 8 Hz、傳送判定 6 m、pitch 上限 89.5°；速度線滿值 22 m/s、不透明度 0.35、淡入 6、96 槽、出現比例 0.45、線寬 0.18、中心半徑 0.55、中心淡入 0.6、線段長度 0.45、流動 2.2、顏色 #c8f6ff。
- 「最終預設值」即上列數值；尚未經實機試玩調整。

### 實際驗證

- `npm run typecheck`、`npm test`（21 檔、377 測試）、`npm run build`、`npm run check:dist`（9 個檔案、5.27 MiB）全部通過。
- 無頭驗收（Vitest）：水平 ↔ 垂直 FOV 換算在 16:9（70.53°）、21:9（56.62°）、4:3（86.63°）正確，CameraRig 依相機比例設定垂直 FOV、改變比例後下一畫面更新，直向畫面夾在 120°；落地、傾斜、FOV 衝擊、震動、晃動以 30／60／144／240 Hz 推進，在 0.5／1／2 s 的相機位置、旋轉與 FOV 一致（誤差 < 1e-6），跑牆傾斜的過渡曲線一致；衝量換算的峰值在臨界、欠阻尼、過阻尼下都等於指定值；跑牆 ±12°、滑鏟 3°、側移 −1°、強度 0.5 時 6°；側向 Dash 峰值 −2° 後回正；落地 30 m/s 下沉 0.12 m、回彈 < 3 cm、點頭 −2°；重落地 trauma；晃動 ±0.015 m、空中與滑鏟停止；trauma 上限、衰減、強度縮放、爆炸衰減；蹲下眼高不過衝、攀爬落後再追上、傳送與重生直接到位、除錯飛行不動位置、pitch 夾住；**全部關閉時**600 個畫面內位置、旋轉、FOV 與「插值後眼睛＋視角＋設定 FOV」完全一致；暫停時凍結；速度線淡入、關閉與沒有玩家時隱藏；設定預設值；面板欄位齊全且預設值在範圍內。Rapier 整合：真實玩家跑右牆時鏡頭往左傾約 10.4°，離牆落地時下沉，有無鏡頭的玩家軌跡完全相同。
- headless Chrome 與 Edge（SwiftShader）以 CDP 開 `npm run sim` 的遊戲網址（`#debug&nolock`），16 項檢查兩個瀏覽器都通過：啟動並進入 playing；基礎 FOV 水平 103° 依畫面比例換成垂直；靜止時鏡頭在眼睛位置；按住 W 衝刺時晃動 ±0.015 m；左 Shift Dash 時 FOV 峰值 113°、1.2 s 後回到 103°；從 8 m 高落下（19.6 m/s）以 0.05 倍慢動作逐畫面取樣，最深下沉 0.117 m；空中 26 m/s 時速度線強度 0.98 且顯示、FOV 約 111°；`addTrauma(1)` 有震動；設定全部關閉後落地、震動、高速、速度線都無任何偏差；設定寫入 `shardwake:settings:v1`；調參面板有「鏡頭」9 個資料夾與設定項目；主控台只有 Rapier 初始化訊息。截圖確認速度線為畫面四周的放射狀線條、中心清空。

### 未驗證

- **實機手感**（驗收「實機」項目）：跑牆傾斜、Dash 衝擊、落地下沉是否「明顯但不暈」需要真人在有頭瀏覽器、實體滑鼠下試玩；數值沒有依試玩調整。
- 震動、傾斜、晃動的實際觀感與暈眩感：headless 只有數值與靜態截圖；幀率很低（約 12–24 FPS），看不到動態。
- 落地下沉的峰值在落地後約 22 ms，低幀率時畫面幾乎看不到下沉（headless 正常速度下最深只取樣到約 1–4 cm）；60 FPS 以上應可看到，未實機確認。若覺得太快，可在面板降低「鏡頭/落地/彈簧 Hz」。
- 速度線在高解析度與實體 GPU 上的觀感與效能；與 M1-09 後處理（Bloom）的搭配。
- 平台模擬頁的跨來源 iframe 內本次沒有重跑（只測直接開遊戲網址）；鏡頭不涉及嵌入、尺寸或輸入處理，視窗比例變化有單元測試。
- 開火、爆炸、受擊的震動來源要等 M1-10、M1-12 接上（目前只有 API 與重落地）。
