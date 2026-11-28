# M1-15 調校工具：預設組合、錄製重播、示範、計時賽

- 里程碑：M1 手感原型
- 前置：M1-07、M1-14
- 狀態：完成

## 目標

讓調手感變成可比較、可重現的工作：同一段操作改參數後重播比較，還能用計時賽量化流暢度。

## 範圍

- 包含：調參預設組合、輸入錄製與重播、鬼影路徑、`#demo` 示範、跑酷計時賽、傳送與慢動作。
- 不含：排行榜（M5-05）。

## 任務

- [x] 調參預設組合：把 MovementConfig、鏡頭參數、各武器 `WeaponDef` 的目前值存成具名預設（`shardwake:presets:v1`）；可以載入、刪除、匯出 JSON（複製到剪貼簿或下載檔案）、匯入 JSON（貼上文字）；內建「標準」「高速」「穩重」三組供比較。
- [x] 輸入錄製／重播（F8／F9）：錄下每個 fixed step 的 `InputFrame`，以及起始狀態（位置、速度、移動狀態、能力計時、亂數種子）；重播時從起始狀態重跑，結果必須確定一致；重播前可以改參數比較；錄影可以存成具名片段（localStorage 或匯出）。
- [x] 鬼影對照：重播時同時畫出原始路徑與新路徑，並標示時間差。
- [x] `#demo` 示範：用預設參數重播內建錄影（`src/debug/demo-clip.json`），自動展示「滑鏟 → 跑牆 → 蹬牆跳 → 二段跳 → Dash → 抓鉤」連招，供自動化驗證與截圖；預設參數改動導致路線失準時，重新錄製即可。
- [x] 跑酷計時賽：起點門、依序通過的環形檢查點、終點；HUD 顯示計時與分段時間；最佳時間存在 `shardwake:besttimes:v1`；`restartCourse` 快捷鍵（預設 T）立即重來。
- [x] 調參面板：傳送到各分區起點、慢動作 0.1×–1×。

## 交付（給後續計畫）

- 輸入錄製格式與確定性重播（之後的回歸測試與 bug 重現可以使用）。
- 計時賽成績（M5-05 可以接排行榜）。

## 驗收

- [x] 測試：同一段錄影重播 3 次，最終位置誤差 < 1 mm。
- [x] `#demo` 在平台模擬頁中自動完成連招，主控台無錯誤。
- [x] 匯出的預設 JSON 再匯入後，數值完全一致。

## 實作紀錄

完成日期：2026-11-28。

### 檔案

- 新增 `src/tools/`：`ToolsConfig.ts`（數值與面板 schema）、`tuning.ts`（調參擷取／差異／套用／指紋）、`Presets.ts`（預設組合存檔與匯出入）、`clip.ts`（錄影格式）、`Replay.ts`（錄製與重播系統）、`replayHost.ts`（遊戲端起始狀態套用）、`ClipStore.ts`（具名片段存檔）、`TimeTrial.ts`（計時賽與最佳成績）、`ToolVisuals.ts`（環與鬼影路徑）、`demo.ts`（示範驗證）、`ToolsDialog.ts`（管理對話框）、`TuningTools.ts`（組裝、按鍵、HUD、面板）、`index.ts`。
- 新增 `src/debug/demo-clip.json`（462 步、約 4 KB）、`scripts/record-demo.mjs`（`npm run demo:record`）、`tests/replay.test.ts`、`tests/tools.test.ts`、`tests/demo-clip.test.ts`、`tests/helpers/toolSim.ts`、`tests/helpers/demoBot.ts`。
- 修改：`PlayerController`（快照）、`Weapon`／`WeaponManager`／`TargetManager`（重播狀態）、`Input`（外部 frame 來源）、`Storage`（`trySetString`）、`DebugPanel`（`refreshAll`）、`CameraConfig`、`events`（`course:*`）、`TrainingGround`（計時賽路線）、`zh-TW`、`menuStatus`、`screens`（暫停選單「跑酷計時賽」）、`hud.css`、`style.css`、`main.ts`、`package.json`（script）。

### 給後續計畫的介面（M1-16、M5-05）

- 計時賽成績：`course:finish` 事件帶 `TimeTrialResult`：`{ version: 1, courseId, levelId, time（s）, splits（各環累計 s，含終點）, hz, tuning（調參指紋）, standard（是否標準參數）, replay（是否由重播產生）, isBest, previousBest, date（ISO）, gameVersion? }`。M5-05 只上傳 `standard && !replay` 的成績，時間建議取整到毫秒。另有 `course:start`、`course:split {courseId, index, gateId, time, delta}`、`course:reset`。
- 本機最佳：`shardwake:besttimes:v1` = `{ version: 1, courses: { [courseId]: { time, splits, date, gameVersion?, tuning, standard } } }`；未知欄位保留。`BestTimes.submit()` 寫入失敗不擲錯，回傳 `persistent: false` 並由 HUD 提示。
- 調參指紋：`tuningFingerprint(currentTuningDiff(targets))`（與預設值的差異經 `stableStringify` 後做 FNV-1a），`STANDARD_FINGERPRINT` 為標準參數；`isStandardTuning()`。
- 錄影格式：`InputClip`（`format: 'shardwake-replay'`、`version: 1`、`hz`、`steps`、`start`（關卡、位置、速度、移動狀態、能力計時、視角、武器與靶標亂數狀態、彈藥、設定）、`frames`（各欄 RLE；-0 存成字串 `"-0"`）、`path`（每 `stride` 步的腳底位置，取到 0.1 mm）、`final.pos`、`marks`（移動事件與步數）、`tuning`（錄製時與預設值的差異））。`validateClip()` 拒絕較新版本與格式錯誤；`ReplaySystem.load(json)`、`startRecording/stopRecording/startReplay/stop`、`lastResult {completed, steps, finalError, timeDelta, peakTimeDelta, marks}`，可直接拿來做回歸測試或重現 bug（`tests/helpers/toolSim.ts` 是無頭整合範例）。
- 其他：`PlayerController.captureSnapshot()/restoreSnapshot()`、`WeaponManager/TargetManager.captureReplayState()/restoreReplayState()`、`InputSystem.setFrameSource()`、`GameStorage.trySetString()`（配額失敗不降級成記憶體）、`DebugPanel.refreshAll()`、`window.__shardwake.tools`（`#debug` 時）。

### 偏離計畫之處

- 錄製開始時「正規化」：先擷取起始狀態，立刻套用回去（重設靶標、武器狀態、彈藥、生命、計時賽），使錄製與重播從完全相同的狀態起跑；因此按 F8 時靶標與生命會重設。
- 計時賽路線：原構想的「滑鏟長坡頂／底」兩環移除（坡頂只能從坡下跑上去，路線會繞回頭）；最後路線為起點門 → 跑牆長廊入口／出口 → Z 字牆板出口 → 20 m 塔頂（移到 `[30.5, 22, -50]`，避開抓鉤點柱子）→ 半管入口／出口 → 浮台群起點／終點 → 終點，共 10 個門。重來位置 `[0, 0.3, 60]`。
- 重播產生的計時賽成績不更新最佳（`trial.recordBestInReplay = false`），事件仍送出並標記 `replay: true`。
- 不需要新增設定或按鍵欄位：F8（錄製）、F9（重播）、T（`restartCourse`）的綁定在 M1-06／M1-14 已存在，只接上行為；舊的 `shardwake:bindings:v1` 不受影響。
- 具名錄影每段一個 key（`shardwake:replay:v1:<名稱>`）加索引 `shardwake:replays:v1`，避免單一大 key 撞到配額時整批失敗；最多 12 段（`replay.maxSavedClips`）。
- `defaultCameraConfig()` 改回傳凍結的預設值常數（原本與執行中的設定共用物件，差異比對會失準）。
- 傳送與慢動作放在新的「工具/傳送」「工具/慢動作」（「關卡」與「效能」已有類似功能，保留不動）。
- 剪貼簿：沙箱 iframe 沒有 `clipboard-write` 權限時不呼叫剪貼簿（否則主控台出錯），改成文字框全選加 Blob 下載連結。

### 數值

- `TOOLS_CONFIG`：`replay.maxSeconds 120`、`pathStride 4`、`matchWindowSteps 600`、`maxSavedClips 12`；`trial.radiusScale 1`、`finishHoldSeconds 6`；`demo.tolerance 0.05 m`、`startDelay 0.5 s`；慢動作 0.1–1×（步長 0.05）。
- 內建預設：「標準」= 全預設；「高速」（跑速 8.5、衝刺 12、滑鏟推進 4.5、Dash 8.5 m、抓鉤 30 m/s、動態視野範圍 11–26 m/s 等 17 項）；「穩重」（跑速 6.8、衝刺 9.5、重力 27、空中控制 30°/s 等）。
- 鬼影時間差只在取樣步更新，比對 ±600 步內最近的原始路徑點，同距離時取步數最近者；相同軌跡時剛好為 0。正值表示比原始錄影慢。

### M1-10 後座吸收與重播

錄影的每步 yaw／pitch 已包含當時的後座吸收結果；重播時視角直接取自錄影，後座狀態從相同的起始狀態與相同輸入重新計算，所以吸收量完全相同（測試 `recoil absorption`：連射並往下壓槍，重播後視角與吸收量差 0）。如果重播前改了後座參數，視角仍跟著錄影走（玩家的滑鼠輸入不變），彈道會因後座不同而改變，這是預期行為。

### 驗證

- 四項檢查通過：`npm run typecheck`、`npm test`（30 個檔案、634 通過、1 略過＝只在 `SHARDWAKE_RECORD_DEMO=1` 時執行的錄製）、`npm run build`、`npm run check:dist`。
- 單元測試：格式與 RLE（含 -0）、驗證與版本相容、同一錄影重播 3 次差 0（< 1 mm）、60／144／240 FPS 與慢動作結果相同、144 Hz 錄製、後座吸收、跨模擬實例重播、改參數後出現路徑與時間差、重播中忽略玩家輸入且 F8／F9 不錄進錄影、60 Hz 錄影在 120 Hz 遊戲重播、片段存檔配額失敗；預設組合的序列化、驗證、未知欄位保留與舊格式；計時賽的依序通過、漏環不算、步內插值計時與步長無關、路線 10 個門（半徑 3 m）不在幾何內、T 重來、重播成績不更新最佳、最佳成績存檔與配額失敗；內建示範在 60／144 FPS 重播完成連招、誤差 < 1 mm。
- headless Chrome（CDP）在平台模擬頁的跨來源 sandbox iframe 中：`#demo` 自動完成連招（滑鏟、跑牆、蹬牆跳、二段跳、Dash、抓鉤），終點差 0.000 mm；真實 F8／F9 按鍵錄製與重播 3 次差 0；慢動作 0.5× 結果相同；套用「高速」後重播出現新路徑與時間差；對話框匯出的預設 JSON 再匯入數值完全一致；`presets:v1`、`replay:v1:*`、`besttimes:v1` 都有寫入；T 重來、穿過起點門開始計時、依序通過所有環完成；主控台沒有錯誤（修正了鬼影線段緩衝不是 3 的倍數造成的 NaN 包圍球）。截圖：`docs/screenshots/M1-15-*.png`。

### 未驗證

- 實機手感與 FPS（測試環境是 SwiftShader 軟體繪圖，只有 4–6 FPS）。
- 示範在一般畫面上是否好看（自動化只驗證連招完成與終點誤差）。
- 真實玩家能否順暢跑完整條計時賽路線（自動化以傳送穿環驗證計時邏輯；路線各段的可達性只以無頭模擬的片段驗證）。
- Edge、實際 Playroom 平台的 iframe 中剪貼簿與 Blob 下載是否被允許（模擬頁中剪貼簿被權限政策擋下，已改走文字框與下載連結；下載未實際觸發）。
