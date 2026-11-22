# M5-05 Playroom SDK：排行榜與雲端存檔

- 里程碑：M5 成長、終局與上架
- 前置：M2-04、M5-03
- 狀態：未開始

## 目標

接入平台的帳號成績與雲端進度：已登入的玩家有排行榜與跨裝置存檔；訪客或 SDK 不可用時，遊戲照樣完整可玩。

## 開始前讀

- 平台規格「帳號成績 SDK 與排行榜」、「帳號雲端進度存檔」；顯示玩家生涯資料時加讀「帳號設定與生涯隱私」；預覽時核對「管理預覽 SDK 診斷」。
- [版本與升級指引]（SDK 使用固定版本）、[存檔相容規格]。

## 設計

- SDK 是選填的：未登入或 SDK 不可用時，遊戲照常可玩；遊戲不取得平台憑證，也不呼叫帳號或管理 API。
- 排行榜：依 Manifest Schema，`leaderboard` 是單一物件（實作前以規格確認），所以要選一個指標：
  - 候選 A：深潛最深層數（`order: desc`，單位「層」）。
  - 候選 B：跑酷計時賽最佳時間（`order: asc`，單位「毫秒」）。
  - 建議 A（終局目標更明確），由使用者確認後決定。
  - 設定 `minScore`／`maxScore`，防止不合理的分數。
- 雲端存檔：manifest 改成 `schemaVersion: 2`，並宣告 `cloudSave.readableFormats`／`writeFormat`，對應 M2-04 存檔的 `format`；本機與雲端的衝突依規格處理；離線時以本機為準，恢復後依規則同步。

## 任務

- [ ] 依版本指引固定 SDK 版本並接入（照規格提供的方式，不自行呼叫 API）。
- [ ] 排行榜回報（指標決定後），以及規格允許範圍內的遊戲內排行顯示。
- [ ] 雲端存檔讀寫、衝突處理、狀態提示（已同步／未登入／同步失敗）。
- [ ] `game.json` 更新為 schemaVersion 2，並通過 `check:dist` 與平台驗證。

## 交付（給後續計畫）

- SDK 整合與雲端存檔（M5-08 的驗收項目）。

## 驗收

- [ ] 訪客、已登入、SDK 不可用三種情況都能完整遊玩。
- [ ] 分數上下限符合 manifest；存檔衝突情境依規格測試通過。
- [ ] 管理預覽的 SDK 診斷沒有錯誤。

## 實作紀錄

（完成後填寫）

[版本與升級指引]: https://raw.githubusercontent.com/TommyLamm/playroom-platform/main/docs/game-dev/sdk-versioning.md
[存檔相容規格]: https://raw.githubusercontent.com/TommyLamm/playroom-platform/main/docs/game-dev/save-compatibility.md
