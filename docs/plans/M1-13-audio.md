# M1-13 程序合成音效

- 里程碑：M1 手感原型
- 前置：M1-02（隨時可以做；事件整合要等 M1-07、M1-10 完成）
- 狀態：完成

## 目標

不使用任何音效檔，用 WebAudio 合成所有聲音；每把武器、每個移動動作都有清楚、有份量、聽不出重複的聲音。

## 範圍

- 包含：音訊引擎、匯流排與音量、合成配方與預渲染、播放與隨機變化、空間音效、事件綁定。
- 不含：音樂（M5-06）；音量設定介面（M1-14）。

## 任務

- [x] `audio/AudioEngine.ts`：`AudioContext` 在玩家第一次點擊時建立或 resume（平台要求音效由玩家操作觸發）；匯流排 master → sfx／ui／music，master 前加壓縮器與限幅器防止爆音；音量設定 0–100% 存入設定。（壓縮器與限幅器接在 master 之後；設定新增 `musicVolume`）
- [x] `audio/SynthRecipes.ts`：用參數描述音色（雜訊爆發＋帶通濾波、低頻正弦「砰」聲＋音高包絡、短殘響）；載入時預先渲染，每種音效 3–5 個變體。（改用純 JS DSP `audio/synth.ts` 渲染樣本，解鎖時轉成 `AudioBuffer`；`OfflineAudioContext` 用於離線診斷，見實作紀錄）
- [x] 音效清單：
  - 武器：5 種開火（各自音色）、空倉、換彈（彈匣出／入、上膛）、切槍、開鏡、近戰揮擊、電漿飛行與爆炸。
  - 移動：腳步（依表面：金屬／格柵／玻璃）、跳躍、二段跳推進、噴射循環、落地（輕／重）、滑鏟摩擦循環、跑牆摩擦循環、蹬牆跳、攀爬、Dash 呼嘯、抓鉤發射／附著／收線循環、依速度變化的風聲。
  - 回饋：命中、爆頭（高音）、擊殺、護盾破裂、受擊、低生命心跳。
  - UI：懸停、點擊、確認、返回。
- [x] 播放：每次音高 ±3%、音量 ±1 dB 隨機變化；同類音效有同時發聲上限；循環音依狀態事件開關，平滑淡入淡出。
- [x] 空間音效：世界音源用 `PannerNode`（HRTF），listener 跟隨相機，遠距衰減。
- [x] 事件綁定：訂閱 EventBus（`weapon:fire`、`player:jump`、`player:land`、`player:dash`、`player:grapple*`、`combat:hit` 等）後播放；各系統不直接呼叫音效。

## 交付（給後續計畫）

- `AudioEngine.play(id, opts)`、`loop(id)`、空間音源 API。
- 合成配方格式（M2 的元素、M3 的敵人音效沿用）。
- 實際 API 摘要見實作紀錄。

## 驗收

- [x] 音效預渲染總時間 < 1.5 s（記錄實測值），之後播放沒有延遲。（headless Chrome 158：62 種、226 個變體、117.5 s 音訊，運算 523–595 ms、牆鐘 825–1353 ms（分段讓出主執行緒；平台 iframe 內一次為 1353 ms）；Node 410 ms。播放時不再渲染，解鎖時一次轉成 AudioBuffer。實際的輸出延遲（headless 回報 baseLatency 10 ms + outputLatency 32 ms）沒有以實機耳聽確認）
- [x] 平台模擬頁中：點擊前不發聲，點擊後正常；切分頁回來後音效正常。（headless Chrome 透過 CDP 連 `npm run sim`：跨來源 iframe（OOPIF）內點擊前 `status = locked`、沒有 AudioContext、`play()` 丟棄；點擊 iframe 後 `running` 並能播放；合成 `visibilitychange` 後 `suspended`、回來 `running`。有頭瀏覽器實際切分頁未驗證）
- [ ] 長時間連射不爆音、不卡頓；大量命中音同時播放時不失真。（部分驗證：`OfflineAudioContext` 經同樣的壓縮器與限幅器渲染 6 s 600 RPM 連射 + 每 0.5 s 40 個命中音 + 兩個爆炸，峰值 -0.33 dBFS、0 個爆音樣本（未經動態處理時為 +3.92 dBFS）；62 種音效單獨渲染峰值 -31.9 ～ -1.9 dBFS、都不是靜音；連射時同時發聲數最多 4／上限 8。**沒有耳聽確認失真與混音平衡，也沒有在實機量測連射時的 frame time**，見「未驗證」）

## 實作紀錄

完成日期：2026-11-28。

### 新增／修改檔案

- 新增 `src/audio/`：
  - `AudioConfig.ts`：`AUDIO_CONFIG`（混音、壓縮與限幅、播放變化、發聲槽與類別上限、空間、事件對應、預渲染）與面板規格。
  - `audioMath.ts`：純邏輯——`dbToGain`／`gainToDb`、`volumeToGain`（感知曲線）、`busGain`、`randomVariation`、`pickVariant`、`Throttle`、`VoiceAllocator`（上限與搶占）、`footstepSoundId`、`landingSound`、`speedGainDb`、`windLevel`、`heartbeat`。
  - `SynthRecipes.ts`：合成配方格式（`SynthRecipe`、`NoiseLayer`、`ToneLayer`、`SoundDef`）、`SYNTH_FIELD_SPECS`（面板範圍 = 驗證範圍）、`validateRecipe`／`validateSoundDef`、`varyRecipe`、`weaponFireRecipe`（武器參數）、建構輔助 `noise()`／`tone()`、`WEAPON_FIRE_RECIPES`（5 種開火）與 `SOUND_DEFS`（57 種）。
  - `synth.ts`：純 JS DSP 渲染器（`renderRecipe`、`renderVariants`、`peakOf`、`rmsOf`、`loopSeam`、`envelopeAt`、`glideAt`）。
  - `AudioEngine.ts`：音訊引擎（解鎖、匯流排、發聲槽、循環音、空間、生命週期、預渲染）。
  - `AudioEvents.ts`：`AudioEventBinder`（Game 系統，order audio）：事件 → 音效、循環音狀態、換彈／泵動排程、電漿球空間音源、低生命心跳。
  - `AudioPanel.ts`：調參面板「音效」。
  - `audioDiagnostics.ts`：`OfflineAudioContext` 離線壓力測試（`renderStress`、`buildStressScenario`）。
  - `index.ts` 改為匯出全部。
- 修改：`src/main.ts`（建立引擎與綁定、聽者跟隨相機、設定音量、面板、載入時預渲染、`__shardwake.audio／audioEvents／audioTools`）、`src/core/Settings.ts`（新增 `musicVolume`，三個既有音量欄位的說明）。
- 測試：新增 `tests/audio.test.ts`（47 項）與 `tests/helpers/fakeAudio.ts`（最小假 AudioContext）。全專案 26 檔、563 測試。
- `README.md`、`PLAN.md`（M1-13 → 完成）。沒有新增套件。

### 實際 API 摘要（給後續計畫）

- **引擎 `AudioEngine`**（main 的 `audio`）：
  - `play(id, { gainDb?, rate?, position?, delay?, noVariation? }) → boolean`：單次音效；有 `position` 時走 3D 發聲槽（HRTF Panner）。未解鎖、分頁隱藏、被節流、超過上限或未知 id 時回傳 false（不丟例外）。
  - `loop(id, { spatial? }) → LoopHandle`、`createEmitter(id)`（= 空間循環音）：`LoopHandle { id, set(gain, rate?), setPan(p), setPosition(x, y, z), stop(), active, target }`。控制物件常駐，`set(0)` 淡出，閒置 `loopIdleStop` 秒後才停止音源（再 `set(>0)` 重建）；請在建構時取得一次，不要每畫面呼叫 `loop()`。
  - `setListener(position, quaternion)`（main 每畫面在 audio 階段以 camera 呼叫）、`listenerAxes(q, fwd, up)`。
  - `setVolumes({ master, sfx, ui, music })`（0..1，增益 = 音量^`mix.volumeCurve` × 匯流排修正 dB）、`setPaused(bool)`（只壓低 sfx 匯流排 `mix.pausedSfxDb`）、`setHidden(bool)`、`applyMix()`、`applySpatial()`。
  - `attachUnlock(target = window)`（pointerdown／keydown／touchend／click，capture）、`unlock()`、`status`（`'unavailable' | 'locked' | 'suspended' | 'running'`）、`running`、`context`、`bus('sfx' | 'ui' | 'music') → GainNode | null`（解鎖後才有）。
  - `prerender(weaponAudios) → PrerenderReport`、`register(id, SoundDef)`（立即渲染，M3 敵人／M2 元素）、`rebuild(id)`、`rebuildWeaponFire(fire)`、`rebuildAll()`、`weaponSound(def.audio) → id`（參數組合第一次出現時同步渲染、以 `weaponSoundKey` 快取）、`variants(id)`、`stats`、`activeVoices()`、`allocators`、`report`、`dispose()`。
- **合成配方格式**（`SynthRecipes.ts`，JSON 相容）：`SynthRecipe { duration, peakDb, layers: (NoiseLayer | ToneLayer)[], reverb?: { mix, decay, size, damp }, vary: { pitch, time, filter, gain }, loop? }`；圖層共有 `{ tag?, gain, delay, env: { attack, hold, decay }, drive, amFreq, amDepth, filter?: { type, freq, freqEnd, sweep, q, lfoFreq, lfoDepth } }`，雜訊加 `color`，振盪器加 `wave, freq, freqEnd, glide, fmRatio, fmDepth, partials[]`。用 `noise(color, init)`、`tone(wave, freq, init)` 建構（補齊預設值）。`SoundDef { recipe, variants, bus, category, gainDb, priority, minInterval, maxInstances, spatial? }`；新增前用 `validateSoundDef`。新類別要在 `AUDIO_CONFIG.voices.categories` 加上限。
- **武器音效（M2-01 生成武器）**：`WeaponDef.audio = { fire, reload, params }`；`fire` 選 `WEAPON_FIRE_RECIPES`（rifle／shotgun／handcannon／railgun／plasma，未知回退 rifle），`params` 的 `pitch`（音高與濾波倍率）、`body`／`crack`／`charge`（對應標籤圖層音量；`charge` 0 移除充能圖層）、`tail`（0.5 = 原殘響）由 `weaponFireRecipe` 套用；`reload` 選 `RELOAD_SOUNDS`（magazine／cell／cylinder；shell 用逐發裝填事件）。
- **事件綁定 `AudioEventBinder`**（main 的 `audioEvents`）：選項 `getWeaponDef`、`getPlayer`、`getHealth`、`getMode`、`getProjectilePosition`、`getReloadKeys`（`viewmodel.config` 的換彈與泵動關鍵影格）、`emitters`。`loops`（jet／slide／wallRun／reel／wind）、`emitters`、`schedule(delay, id, group)`／`cancel(group?)`、`clock`。已綁定 M3 會沿用的 `enemy:fire`、`enemy:projectile`（impact／hitPlayer）、`target:killed`（drone → `explosion.small`）。
- **M1-14（HUD 與設定頁）**：音量設定欄位 `masterVolume`、`sfxVolume`、`uiVolume`、`musicVolume`（`SETTINGS_SCHEMA` 有範圍與標籤，main 已監聽變更）；選單音效 `audio.play('ui.hover' | 'ui.click' | 'ui.confirm' | 'ui.back')`（ui 匯流排，暫停時不壓低）；`audio.status` 可用來顯示「音效未啟用／瀏覽器不支援」。開始／繼續目前播 `ui.confirm`、玩家暫停播 `ui.back`（在 binder 的 `game:mode`），M1-14 的選單接管時可移除。
- **M5-06（音樂與混音）**：音樂接到 `audio.bus('music')`（解鎖後才有；可在 `attachUnlock` 之後的第一次播放時建立）；`mix.musicDb`、設定 `musicVolume`；master 之後是壓縮器與限幅器（`AUDIO_CONFIG.dynamics`），sfx 匯流排暫停時壓低。

### 偏離計畫之處與設計決定

- **預渲染用純 JS DSP 而不是 `OfflineAudioContext`**：載入時還不能建立 AudioContext（平台要求由玩家操作觸發，Chrome 也會在主控台警告），而 `OfflineAudioContext` 在 Vitest 沒有、非同步且每次渲染有固定開銷。改成 `synth.ts` 以決定性的 JS DSP 渲染樣本（同配方同種子結果相同），測試可直接檢查每種音效的峰值、靜音與循環點；玩家第一次操作時一次轉成 `AudioBuffer`（之後釋放樣本，記憶體只留一份）。`OfflineAudioContext` 改用在 `audioDiagnostics.ts`：經過與遊戲相同的壓縮器與限幅器渲染壓力情境，驗證不爆音。預渲染分段（每段 12 ms）以 MessageChannel 讓出主執行緒（背景分頁不像 setTimeout 那樣被節流）。
- **DSP**：白／粉紅（Paul Kellet）／棕色雜訊；sine／triangle／saw／square（polyBLEP）＋FM＋正弦泛音；RBJ 雙二階濾波（每 16 樣本更新係數，支援掃頻與 LFO）；AM；tanh 飽和；Schroeder 殘響（4 梳狀 + 2 全通，RT60 換算回授）；包絡與滑音以乘法遞推。單次音效頭 1 ms、尾 min(30 ms, 10%) 淡化；循環音尾端 0.12 s 等功率交叉淡化回開頭（測試：回繞跳動不大於相鄰樣本的最大差）。全部正規化到 `peakDb`（預設 -1 dBFS），響度差異用 `SoundDef.gainDb` 決定。
- **發聲槽**：三個固定池（2D 28 槽、3D 20 槽（Gain → HRTF Panner）、介面 6 槽），每槽一個常駐 GainNode（與 Panner），每次播放只建立一個 `AudioBufferSourceNode`（規格上只能播一次，無法避免）。上限三層：同音效 `maxInstances` → 類別上限（weapon 8、footstep 2、movement 6、feedback 6、ambient 2、impact 6、enemy 8、explosion 4、ui 4）→ 池滿時搶占優先序最低的；搶占時舊聲音在 8 ms 內淡出、新聲音在淡出後開始。類別上限在各池分別計算。節流：每種音效的 `minInterval`（例如命中 30 ms、牆面命中 25 ms、腳步 70 ms、開火 20 ms），霰彈 10 顆彈丸打牆只出一聲。
- **變體**：每種單次音效 4 個（介面 3 個），循環音 1 個（從隨機位置開始播放）；變體 0 是原配方，其他以 `vary` 偏移（預設音高 ±4%、時間 ±10%、濾波 ±12%、各圖層音量 ±10%），雜訊種子不同；播放時再加 ±3% 音高、±1 dB，且不連續選到同一個變體。
- **循環音**：噴射、滑鏟、跑牆、抓鉤收線、風聲由 binder 每畫面依玩家狀態（`abilities.jet.active`、`state === 'slide' / 'wallRun'`、`abilities.grapple.phase === 'attached'`、速度）設定目標，不靠開始／結束事件，避免漏掉事件時卡住；以 `setTargetAtTime` 淡入 0.06 s／淡出 0.12 s，增益變化小於門檻不重新排程。滑鏟音量依速度（4 → 16 m/s：-8 → 0 dB），跑牆往牆那一側聲像 ±0.45，收線速率隨速度，風聲在三維速度 9 → 30 m/s 間淡入並提高速率。非遊玩模式、除錯飛行時全部歸零；分頁隱藏時硬停。
- **換彈與泵動排程**：依 M1-11 viewmodel 的關鍵影格（`reloadMagOut` 0.28、`reloadMagSeat` 0.66、`reloadChargeStart` 0.72 × 換彈時間；霰彈開火後 `pumpStart` 0.18、`pumpMid` 0.36 × 射擊間隔）排在 binder 的模擬時鐘上，暫停時一起停住；換彈被取消、切槍、死亡、回標題時清掉。只有空倉換彈播上膛；手炮（cylinder）沒有上膛；霰彈逐發裝填每發 `reload.shell`，裝填完成後泵動。
- **空間音效**：世界音源（爆炸、牆面命中、無人機開火與能量球、無人機擊毀）用 3D 發聲槽；電漿球飛行聲是 4 個常駐的空間循環音源，生成時取用（滿了搶占最舊的），每畫面跟著 `ballistics.projectiles` 的位置，命中或逾時停止。聽者每畫面取相機的位置與四元數（含鏡頭傾斜）。距離模型 inverse、參考距離 4 m、最大 150 m、衰減係數 1。玩家自己的聲音（開火、移動、回饋）是 2D。
- **生命週期**：`attachUnlock` 監聽 window 的 pointerdown／keydown／touchend／click（capture、passive），第一次建立 AudioContext，之後發現不是 running 就 resume（autoplay 被擋時等下一次操作）。分頁隱藏 → `suspend()`、循環音硬停；回來 → `resume()`（Chrome 允許已啟用過的 context 不經操作恢復）。context 不在 running 時 `play()` 丟棄，不會在恢復時補播。遊戲暫停（含失焦）時 sfx 匯流排壓低 12 dB、循環音歸零，介面音效照常。Web Audio 不存在或建立失敗 → `unavailable`，主控台一次警告，全部 API 照常可呼叫。
- **混音**：master 之後接壓縮器（-16 dB、膝 10、4:1、4 ms／200 ms）與限幅器（-1.5 dB、膝 0、20:1、1 ms／80 ms）。計畫寫「master 前」，實作放在 master 之後（主音量先套用，再經動態處理），效果相同且主音量為 0 時完全靜音。
- **音量**：設定 0–1（面板與 M1-14 顯示為 0–100%），增益 = 音量² × 匯流排修正（50% ≈ -12 dB，0 完全靜音）。新增設定 `musicVolume`（預設 0.7，給 M5-06），`shardwake:settings:v1` 版本不變，舊存檔補預設值。
- **事件對應**（計畫未寫細節，本計畫決定）：開鏡退出只在非強制時出聲；落地 < 2.5 m/s 不出聲、≥ 11 m/s 為重落地，落地另外加一聲腳底表面的腳步（-4 dB）；腳步音量依速度（2 → 10 m/s：-8 → 0 dB）；表面對應：concrete → 金屬、energy → 玻璃、hazard → 格柵；受擊：護盾破裂另播 `shieldBreak`，扣到生命播 `hurt.health`，只扣護盾播 `hurt.shield`，無敵模式 `hurt.shield` -8 dB；護盾開始回充播 `shieldRecharge`；另加死亡、重生、Dash／抓鉤恢復可用（可關）、牆面命中（依表面改音高）、無人機開火／能量球命中／擊毀爆炸。低生命心跳：生命 < 40% 開始，間隔 1.0 → 0.55 s、音量 -10 → 0 dB，用模擬時間（暫停時停）。開始／繼續播 `ui.confirm`，玩家按 Esc 暫停播 `ui.back`（其他暫停原因不出聲），讓介面音效在 M1-14 之前就可測。
- **調參面板「音效」**：混音、壓縮與限幅、播放、空間、發聲上限（池大小改了重新整理後生效）、事件、預渲染（取樣率；「重新預渲染全部」按鈕）、每種音效音量 dB、**音色編輯**（下拉選一種音效：播放規則與配方的每個數值欄位、波形／雜訊／濾波類型，改了立即驗證、重新渲染並試聽；「試聽」「匯出 JSON」按鈕；武器開火編輯的是基礎配方，所有參數組合一起重新渲染）、監看（狀態、輸出取樣率與延遲、各池發聲數、播放／未解鎖丟棄／節流／搶占／超過上限、預渲染時間與記憶體、最後播放）、測試（解鎖、連射 100 發、同時 40 個命中音、離線壓力測試）。面板的修改不存檔。
- **預渲染時機**：在 `main.ts` 的著色器預熱之前（載入畫面期間），讓第一次開火、第一次受擊都沒有渲染延遲；載入時間增加約 0.8 s（牆鐘）。

### 調整過的數值

- 計畫指定的照用：音高 ±3%、音量 ±1 dB、變體 3–5 個、預渲染 < 1.5 s。
- 計畫未指定、由本計畫決定（都在 `AUDIO_CONFIG` 或 `SOUND_DEFS`，可在面板調）：上面「設計決定」列出的混音、動態、發聲上限、空間、循環音與事件數值；預渲染取樣率 44100 Hz；每種音效的 `gainDb`（開火 -2 dB、爆炸 0、腳步 -11／-12、命中 -8、爆頭 -7、擊殺 -6、護盾破裂 -3、UI -12～-18 等）。依 30 ms 視窗 RMS 的實測，有效響度大致為：爆炸 -5、霰彈／手炮 -9、磁軌／電漿 -12、步槍 -13、受擊 -11～-19、移動動作 -12～-25、腳步 -24～-28、命中 -24、介面 -21～-33 dBFS。實測後調高命中（-10 → -8 dB）、爆頭（-9 → -7 dB）與抓鉤收線（-14 → -10 dB），原本被開火聲蓋住。

### 實際驗證

- `npm run typecheck`、`npm test`（26 檔、563 測試）、`npm run build`、`npm run check:dist`（9 個檔案、5.72 MiB）全部通過。
- 單元測試（`tests/audio.test.ts` 47 項）：dB 與音量曲線；隨機變化在 ±3%／±1 dB 內且涵蓋全範圍；變體不連續重複；節流；發聲槽的類別上限、優先序丟棄、同音效上限、全域搶占、空槽重用；表面、落地、速度音量、風聲、心跳對應；音效清單齊全、所有定義通過驗證、驗證能抓到各種錯誤；變體偏移範圍；武器參數；包絡與滑音；**每種音效每個變體**長度正確、不靜音、峰值 = peakDb、沒有 NaN、單次音效頭尾為 0、循環音回繞連續、決定性；各波形與濾波；預渲染時間（Node 410 ms）；假 AudioContext 的引擎：解鎖前不建立 context 且不發聲、操作後建立音訊圖、每次播放只建立一個音源節點、連射與大量命中不超過上限且搶占會淡出、分頁隱藏與恢復、autoplay 被擋、Web Audio 不可用／建立失敗時靜音降級、音量曲線與暫停壓低、HRTF 與聽者方向、循環音淡出與閒置停止、未知 id、註冊與重新渲染；事件綁定：5 把武器音色、泵動與換彈時間點、取消與切槍、其他武器事件、移動、戰鬥回饋、介面與暫停、循環音狀態、電漿球音源、心跳、所有播放的 id 都已定義；面板涵蓋；設定新欄位與舊存檔。
- headless Chrome 158（`--autoplay-policy=user-gesture-required --mute-audio`）以 CDP 開 `vite preview` 的 `#debug&nolock` 與 `npm run sim` 的平台頁，26 項檢查全部通過：
  - 點擊前 `status = locked`、沒有 AudioContext、`play()` 丟棄；預渲染運算 535 ms／牆鐘 825 ms；點擊後 AudioContext 44100 Hz running（baseLatency 10 ms、outputLatency 32 ms），進入 playing 並播放 `ui.confirm`。
  - 由 EventBus 觸發 27 種事件全部建立了對應的音源，5 把武器各自的開火音色；`AudioBufferSourceNode` 數 = 成功播放數（36 / 36）。
  - 真實輸入：按住開火 2 秒播放 23 發開火音（武器類別同時最多 4／上限 8、全部最多 6、搶占 27 次）；實際按 Shift Dash 播放 `dash`。循環音開啟有音源、關閉 1.2 s 後停止。同一畫面 40 個命中音只播 2 個。
  - 合成 `visibilitychange`：隱藏時 `suspended`、不發聲、遊戲暫停；回來 `running`，點擊繼續後音效正常。
  - `OfflineAudioContext`：連射 + 大量命中 + 爆炸峰值 -0.33 dBFS、0 個爆音樣本；62 種音效單獨渲染峰值 -31.9 ～ -1.9 dBFS。
  - 平台頁跨來源 iframe（OOPIF，`data-sw-embedded = true`）：點擊前 locked、不發聲；點擊 iframe 後 running 並能播放；隱藏 suspended、回來 running。
  - 刪掉 `AudioContext`／`OfflineAudioContext` 的頁面：啟動、點擊開始、射擊都正常，`status = unavailable`，沒有錯誤或例外。
  - 主控台沒有錯誤或警告（只有 Rapier、預熱與音效預渲染的 info）。
- 結束後確認自己啟動的 vite preview、平台模擬伺服器與 headless Chrome 都已關閉、暫存設定檔已刪除。

### 未驗證

- **聽感與混音平衡**：沒有真人戴耳機或接喇叭試聽。每種音效是否「清楚、有份量、聽不出重複」、武器之間的差異、腳步與移動動作相對開火的音量、命中音是否在連射中聽得到、循環音（噴射、滑鏟、跑牆、風聲）是否單調或有循環感、HRTF 的方向感，都只有數值（峰值、RMS、離線渲染）佐證。音色與音量都在面板「音效/音色編輯」「音效/每種音效音量 dB」可調，留給 M1-16 依試玩調整。
- **失真**：離線渲染確認沒有超過 0 dBFS 的樣本，但壓縮器與限幅器在大量聲音時的抽吸感（pumping）、飽和造成的刺耳感沒有耳聽確認。
- **延遲與卡頓**：實機輸出延遲（藍牙耳機等）未量測；連射與大量命中時的 frame time 沒有在實體 GPU 的有頭瀏覽器量測（headless 下沒有觀察到錯誤，但 headless 的 FPS 本身不穩定）。每次播放只配置一個節點，主執行緒負擔應該很小，但未量測 GC。
- **有頭瀏覽器**：實際切分頁、iframe autoplay 被平台擋下後再點擊恢復、Edge 與 Firefox（Firefox 的 HRTF 與 `outputLatency` 行為不同）沒有測試；只用 headless Chrome。
- 記憶體：AudioBuffer 約 20 MiB（44.1 kHz 單聲道、117.5 s）；低記憶體裝置未測。
