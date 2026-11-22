# M1-17 發布流程與 v0.1.0（需授權）

- 里程碑：M1 手感原型
- 前置：M1-16
- 狀態：未開始

## 目標

建立可重複使用的發布流程（GitHub Actions），並在使用者授權後，把第一個版本 v0.1.0 發布到 Playroom 預覽。

## 開始前讀

- 平台規格「建置與打包」與「驗收與上架」（[開發與發布標準]）。
- [Release workflow 範本]、[版本與升級指引]（工具使用固定版本）。

## 任務

- [ ] 確認 GitHub repository 已設為公開：平台要求 Release 來自公開 repository，而 `TommyLamm/shardwake` 建立時是 private。改成公開前先取得使用者同意。
- [ ] 把平台的 `templates/game-release.yml` 複製到 `.github/workflows/release.yml`：`GAME_DIR` 設為 `dist`；在版本檢查前加入 `npm ci` 與 `npm run build`；Node 版本依範本要求（24.22.1 以上）；不加入 `continue-on-error` 或 `always()`。
- [ ] 本機完整驗證：把平台 repository clone 到暫存目錄，執行 `npm run game:pack -- <本專案>/dist <暫存>/game.zip` 與 `npm run game:validate -- <暫存>/game.zip`；ZIP 輸出放在成品目錄之外。
- [ ] 版本：`public/game.json` 與 `package.json` 的 `version` 設為 `0.1.0`，或由使用者決定改用預發布版 `0.1.0-alpha.1`（平台需要手動選擇匯入）。
- [ ] **取得使用者明確授權後**才執行：推送 `v0.1.0` tag → 確認 workflow 成功，Release 附上唯一的 `game.zip` → 平台匯入預覽 → 依「驗收與上架」實際遊玩驗收 → 人工確認後上架。
- [ ] 回報：遊戲 ID `shardwake`、版本、成品位置（Release URL）、已完成的階段（ZIP 驗證／GitHub Release／平台上架）、未驗證項目。

## 交付（給後續計畫）

- `.github/workflows/release.yml` 與本機驗證步驟；之後每個里程碑都依 PLAN.md 的「發布流程」重複執行。

## 驗收

- [ ] 本機 pack／validate 通過。
- [ ] （授權後）Release 建立成功，平台預覽可以完整遊玩。

## 實作紀錄

（完成後填寫）

[開發與發布標準]: https://raw.githubusercontent.com/TommyLamm/playroom-platform/main/docs/game-dev/game-development.md
[Release workflow 範本]: https://raw.githubusercontent.com/TommyLamm/playroom-platform/main/templates/game-release.yml
[版本與升級指引]: https://raw.githubusercontent.com/TommyLamm/playroom-platform/main/docs/game-dev/sdk-versioning.md
