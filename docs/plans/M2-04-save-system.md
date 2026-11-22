# M2-04 本機存檔系統

- 里程碑：M2 刷寶核心
- 前置：M2-01
- 狀態：未開始

## 目標

讓拿到的裝備在重新整理後還在；存檔可以安全升級格式，而且儲存不可用時遊戲照樣可以玩。

## 開始前讀

- 平台規格「執行環境」中的 `localStorage` 規則。
- [存檔相容規格]：現在就照它設計格式版本，M5-05 接雲端存檔時才不用重做。

## 設計

- key：`shardwake:save:v1`（設定仍在 `shardwake:settings:v1`）。
- 內容：`{ format: 1, profile: { createdAt, playTime }, inventory, equipped, currencies, unlocks, progression（預留）, stats }`。
- 寫入：拾取、裝備變更、離開任務、暫停時節流寫入；保留上一份備份 `shardwake:save:v1:backup`；寫入失敗（容量不足或不可用）時提示，但不中斷遊戲。
- 讀取：驗證結構與版本、保留未知欄位；損毀時改用備份；兩者都失敗時以新存檔開始，並保留損毀資料供匯出。
- 遷移：`migrations[format]` 逐版升級，每次改格式都加測試。
- 手動備份：匯出／匯入存檔字串。
- 預覽版與已發布版共用遊戲來源，可能共用存檔，所以新版本必須讀得懂舊格式。
- `format` 整數之後對應 manifest 的 `cloudSave.readableFormats`／`writeFormat`。

## 任務

- [ ] `save/SaveSystem.ts`、`save/schema.ts`、`save/migrations.ts`。
- [ ] 設定頁新增「存檔」：匯出、匯入、刪除存檔（二次確認）、顯示「目前無法存檔」狀態。
- [ ] 背包、裝備、貨幣接上存檔。

## 交付（給後續計畫）

- `SaveSystem.load / save / subscribe()` 與遷移框架（M4、M5 擴充存檔內容時沿用）。

## 驗收

- [ ] 測試：存讀往返一致；損毀資料會改用備份；舊格式可以遷移；儲存不可用時遊戲可玩。
- [ ] 實機：重新整理後，背包與裝備完全一致。

## 實作紀錄

（完成後填寫）

[存檔相容規格]: https://raw.githubusercontent.com/TommyLamm/playroom-platform/main/docs/game-dev/save-compatibility.md
