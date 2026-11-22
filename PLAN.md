# 碎晶航跡 SHARDWAKE — 總計畫與進度

> 單人第一人稱科幻刷寶射擊遊戲，遊戲 ID `shardwake`。設計見 [docs/design.md](docs/design.md)，開發規範見 [AGENTS.md](AGENTS.md)。
> 遊戲規模大，拆成 5 個里程碑、39 份計畫。每份計畫大約是一個工作階段的工作量，依序執行。

## 里程碑

| 里程碑 | 目標 | 發布版本 | 計畫 |
| --- | --- | --- | --- |
| M1 手感原型 | 全部移動技、5 把原型武器、訓練場、調參工具；先把手感調到滿意 | v0.1.0 | M1-01～M1-17 |
| M2 刷寶核心 | 程序生成武器、詞綴與元素、掉落與拾取、存檔、背包、裝備模組 | v0.2.0 | M2-01～M2-06 |
| M3 敵人與 AI | AI 與導航、7 種敵人、遭遇戰與精英、首個 Boss | v0.3.0 | M3-01～M3-04 |
| M4 基地與程序任務 | 錨點站、房間模組與第一個生態區、任務生成器、任務流程與結算 | v0.4.0 | M4-01～M4-04 |
| M5 成長、終局與上架 | 技能樹、手雷與超載、難度與製作、內容擴充、Playroom SDK、音樂、手把與無障礙 | v0.5.0 → v1.0.0 | M5-01～M5-08 |

## 計畫清單與進度

狀態：未開始／進行中／完成。★ 表示完成後有可試玩的檢查點，建議先試玩回饋再往下做。

| 計畫 | 內容 | 前置 | 狀態 |
| --- | --- | --- | --- |
| [M1-01](docs/plans/M1-01-scaffold.md) | 專案骨架與平台成品格式 | — | 完成 |
| [M1-02](docs/plans/M1-02-core-runtime.md) | 核心執行框架：主迴圈、事件、儲存、設定、調參面板外殼 | M1-01 | 完成 |
| [M1-03](docs/plans/M1-03-input.md) | 輸入系統：滑鼠鎖定、按鍵綁定、每步輸入 | M1-02 | 未開始 |
| [M1-04](docs/plans/M1-04-physics-level.md) | 物理、關卡建構器與灰盒訓練場 | M1-02 | 未開始 |
| [M1-05](docs/plans/M1-05-movement-core.md) | 移動 I：地面、空中、跳躍、蹲、滑鏟 ★ | M1-03、M1-04 | 未開始 |
| [M1-06](docs/plans/M1-06-movement-wall.md) | 移動 II：跑牆、蹬牆跳、攀爬 | M1-05 | 未開始 |
| [M1-07](docs/plans/M1-07-movement-abilities.md) | 移動 III：二段跳、噴射、Dash、抓鉤 ★ | M1-06 | 未開始 |
| [M1-08](docs/plans/M1-08-camera-feel.md) | 鏡頭手感 | M1-05 | 未開始 |
| [M1-09](docs/plans/M1-09-visual-style.md) | 視覺風格與後處理 | M1-04 | 未開始 |
| [M1-10](docs/plans/M1-10-weapon-core.md) | 武器核心邏輯 | M1-05 | 未開始 |
| [M1-11](docs/plans/M1-11-weapon-presentation.md) | 武器表現：Viewmodel、特效、準星 ★ | M1-09、M1-10 | 未開始 |
| [M1-12](docs/plans/M1-12-targets-feedback.md) | 靶標、玩家受擊與戰鬥回饋 | M1-10 | 未開始 |
| [M1-13](docs/plans/M1-13-audio.md) | 程序合成音效 | M1-02 | 未開始 |
| [M1-14](docs/plans/M1-14-hud-menus.md) | HUD、選單與設定 | M1-07、M1-12 | 未開始 |
| [M1-15](docs/plans/M1-15-tuning-tools.md) | 調校工具：預設組合、錄製重播、示範、計時賽 | M1-07、M1-14 | 未開始 |
| [M1-16](docs/plans/M1-16-polish-perf.md) | 效能、手感總調校、說明文件與封面 ★ | M1-01～M1-15 | 未開始 |
| [M1-17](docs/plans/M1-17-release-v0.1.md) | 發布流程與 v0.1.0（需授權） | M1-16 | 未開始 |
| [M2-01](docs/plans/M2-01-item-generator.md) | 物品模型與武器生成器 | M1 | 未開始 |
| [M2-02](docs/plans/M2-02-affixes-elements.md) | 詞綴、元素與狀態效果 | M2-01 | 未開始 |
| [M2-03](docs/plans/M2-03-drops-pickup.md) | 掉落、拾取與彈藥 | M2-01 | 未開始 |
| [M2-04](docs/plans/M2-04-save-system.md) | 本機存檔系統 | M2-01 | 未開始 |
| [M2-05](docs/plans/M2-05-inventory-ui.md) | 背包與物品介面 ★ | M2-02、M2-03、M2-04 | 未開始 |
| [M2-06](docs/plans/M2-06-gear-mods.md) | 裝備模組與 v0.2.0 | M2-05 | 未開始 |
| [M3-01](docs/plans/M3-01-ai-framework.md) | AI 框架與導航 | M1（建議先完成 M2-02） | 未開始 |
| [M3-02](docs/plans/M3-02-enemy-roster.md) | 敵人陣容（7 種）★ | M3-01 | 未開始 |
| [M3-03](docs/plans/M3-03-encounters-elites.md) | 遭遇戰導演與精英 | M3-02 | 未開始 |
| [M3-04](docs/plans/M3-04-first-boss.md) | 首個 Boss 與 v0.3.0 ★ | M3-03 | 未開始 |
| [M4-01](docs/plans/M4-01-hub-station.md) | 錨點站（基地） | M2 | 未開始 |
| [M4-02](docs/plans/M4-02-room-kits-biome1.md) | 房間模組與第一個生態區 | M4-01（建議先完成 M3-03） | 未開始 |
| [M4-03](docs/plans/M4-03-mission-generator.md) | 任務地圖生成器 | M4-02 | 未開始 |
| [M4-04](docs/plans/M4-04-mission-flow.md) | 任務流程、目標、結算與 v0.4.0 ★ | M4-03、M3-04 | 未開始 |
| [M5-01](docs/plans/M5-01-progression-skills.md) | 等級與技能樹 | M4 | 未開始 |
| [M5-02](docs/plans/M5-02-grenades-overdrive.md) | 手雷與超載技能 | M5-01 | 未開始 |
| [M5-03](docs/plans/M5-03-difficulty-endgame.md) | 難度階級、終局深潛與製作 | M5-01 | 未開始 |
| [M5-04](docs/plans/M5-04-content-expansion.md) | 內容擴充：新生態區與 Boss | M4 | 未開始 |
| [M5-05](docs/plans/M5-05-playroom-sdk.md) | Playroom SDK：排行榜與雲端存檔 | M2-04、M5-03 | 未開始 |
| [M5-06](docs/plans/M5-06-music-audio.md) | 音樂與混音 | M3-03 | 未開始 |
| [M5-07](docs/plans/M5-07-gamepad-accessibility.md) | 手把與無障礙 | M1 | 未開始 |
| [M5-08](docs/plans/M5-08-release-v1.md) | v1.0.0 驗收與上架 | M5 其餘計畫 | 未開始 |

## 可並行的工作

- M1-08（鏡頭）可與 M1-06／M1-07 並行；M1-09（視覺）在 M1-04 之後隨時可做；M1-13（音效）在 M1-02 之後隨時可做，事件整合等 M1-07、M1-10 完成。
- M2-03 與 M2-04 都只依賴 M2-01，可並行。
- M5-04、M5-06、M5-07 彼此獨立。
- 並行時每個工作階段只改自己計畫範圍內的檔案。

## 完成定義（每份計畫）

1. 計畫內的任務與驗收項目全部完成，或在「實作紀錄」寫明未完成的原因。
2. `npm run typecheck`、`npm test`、`npm run build`、`npm run check:dist` 全部通過。
3. 需要實機確認的項目（手感、畫面、效能）已實測並記錄；無法驗證的項目明確標示。
4. 計畫檔的狀態與本表都已更新。

## 發布流程（每個里程碑結束時）

1. 提高 `public/game.json` 與 `package.json` 的 `version`。版本只增不減，已匯入的版本不可覆寫。
2. 本機建置，並用平台工具完整驗證 ZIP（步驟見 M1-17）。
3. **取得使用者明確授權後**才推送 `v<version>` tag。GitHub Actions 驗證通過後會建立 Release，並附上唯一的 `game.zip`。
4. 平台匯入預覽，依平台規格「驗收與上架」實際遊玩驗收，人工確認後才上架。
5. 回報遊戲 ID、版本、成品位置、已完成的階段（ZIP 驗證／GitHub Release／平台上架）與未驗證項目。

## 平台限制（影響所有計畫）

- 交付靜態成品：Vite `base: './'`，所有自有資源用相對路徑；需要路由時用 hash。開發用旗標也用 hash，例如 `#debug`、`#demo`、`#cover`。
- 遊戲放在平台子目錄（`/games/shardwake/<version>/` 或 `/preview/...`）的跨來源 sandbox iframe 內，開始、遊玩、結束、重新開始都要能完成；切換顯示模式不會重載 iframe，要正確處理尺寸變化。
- iframe 允許 scripts、same-origin、pointer lock、fullscreen、autoplay、gamepad。音效與全螢幕必須由玩家操作觸發；不跳出 iframe、不開 popup、不提交表單。
- 遊戲不自行鎖定頂層鍵盤（不呼叫 Keyboard Lock）。平台全螢幕下短按 Esc 會送到遊戲；Pointer Lock 的退出由瀏覽器控制。
- 不能使用需要 cross-origin isolation 或 SharedArrayBuffer 的建置。
- 訪客、SDK 或儲存不可用時仍須可玩；`localStorage` key 以 `shardwake:` 開頭。
- 成品限制：ZIP ≤ 512 MiB、解壓後 ≤ 2 GiB、≤ 50,000 個檔案；封面 ≤ 5 MiB，建議 800 × 500。
- `devices` 必須如實宣告；本作只標 `desktop`。
