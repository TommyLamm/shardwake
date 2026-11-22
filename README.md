# 碎晶航跡 SHARDWAKE

> 在崩解的軌道巨構碎片間高速穿梭、奪取原型武器的單人第一人稱科幻刷寶射擊遊戲。

- 狀態：M1-05 移動 I 完成（★ 檢查點：可以在灰盒訓練場試玩跑、跳、蹲、滑鏟與連跳；玩家控制器以 Rapier KinematicCharacterController 實作，手感數值都在調參面板「移動」）。下一步：[M1-06 移動 II](docs/plans/M1-06-movement-wall.md)。
- 平台：Playroom（桌面瀏覽器），遊戲 ID `shardwake`。
- 技術：TypeScript、Vite、Three.js、Rapier；幾何、貼圖與音效全部程序生成，不使用外部素材。

## 文件

- [總計畫與進度](PLAN.md)
- [設計總覽](docs/design.md)
- [詳細計畫](docs/plans/)
- [開發規範（AGENTS.md）](AGENTS.md)

## 開發指令

需要 Node 22.12 以上（開發使用 Node 24）。套件全部固定版本，請用 `npm ci` 安裝。

```sh
npm ci              # 安裝固定版本的套件
npm run dev         # 開發伺服器
npm run typecheck   # TypeScript 型別檢查
npm test            # 單元測試（含 Rapier 無頭模擬）；npm run test:watch 為監看模式
npm run build       # 型別檢查後建置成平台成品到 dist/
npm run check:dist  # 快速檢查成品格式（正式驗證用平台 game:validate）
npm run preview     # 以 Vite 預覽 dist/
npm run sim         # 平台模擬頁：http://localhost:4173/ 以跨來源 sandbox iframe 載入 dist/
npm run cover       # 重新產生佔位封面 public/cover.png
```

平台模擬頁的遊戲來源是 `http://127.0.0.1:4174/games/shardwake/<version>/`，可切換一般／填滿視窗（沉浸）／原生全螢幕、調整 iframe 尺寸與改用 `/preview/...` 入口。埠號被占用時可設定 `SIM_PLATFORM_PORT`、`SIM_GAME_PORT`。

## 目前可試玩的操作

點擊畫面開始（鎖定滑鼠），在灰盒訓練場中：

| 操作 | 按鍵 |
| --- | --- |
| 移動（往前 ±50° 內自動衝刺；開火或開鏡時降回跑速） | W A S D |
| 視角 | 滑鼠 |
| 跳躍（落地前 0.15 s 內按也會起跳；走出平台 0.12 s 內仍可起跳） | Space |
| 蹲下；衝刺中（≥ 7 m/s）按下為滑鏟，空中按住蹲落地直接接滑鏟 | C |
| 暫停 | Esc |

- 滑鏟有推進（+3.5 m/s，冷卻 1.2 s）；滑鏟中跳躍保留水平動量，可以滑鏟跳、連跳。下坡滑鏟會越滑越快（試試「滑鏟長坡」）。
- 設定「自動衝刺」關閉時改用手動衝刺鍵（預設未綁定，按鍵設定頁在 M1-14）；設定「蹲下」可選按住或切換。
- 掉進深坑會回到最近的檢查點。跑牆、攀爬、二段跳、Dash、抓鉤在 M1-06／M1-07。

## 開發用功能

- 調參面板：遊戲中按 `` ` `` 或在網址加上 `#debug` 開啟（Tweakpane，第一次開啟時才載入）。`#debug` 也會把核心物件掛到 `window.__shardwake` 方便在主控台檢查。
- 畫面角落的 FPS／frame time 由設定「顯示 FPS」開關（目前預設開啟）。
- 本機儲存的 key 一律以 `shardwake:` 開頭並帶版本（設定為 `shardwake:settings:v1`、按鍵綁定為 `shardwake:bindings:v1`）；儲存不可用時改用記憶體，遊戲照常運作。
- 點擊畫面會鎖定滑鼠並開始／繼續；Esc 解除鎖定並暫停（Chrome 解鎖後約 1 秒內無法重新鎖定，點擊沒反應時稍候再點）。完整選單在 M1-14。
- 調參面板開啟時會解除滑鼠鎖定但不暫停（可用鍵盤操作、邊看邊調），點擊畫面恢復滑鼠視角。
- 調參面板「移動」資料夾：所有移動參數（地面、跳躍、空中、蹲與滑鏟、膠囊與碰撞），以及監看（水平速度曲線、狀態、是否著地、地面法線、滑鏟推進冷卻等），改了立即生效。
- 除錯飛行：調參面板「自由相機/啟用（穿牆飛行）」切換成自由飛行相機（WASD 沿視線飛行、Space 上升、C 下降、按住 Shift 加速；穿牆，但掉到 y < -30 會回到最近檢查點），關閉後玩家從目前位置接續。
- 調參面板「關卡」資料夾：切換碰撞體線框、顯示區域與檢查點、傳送到各區（傳送玩家；飛行除錯時傳送自由相機），以及灰盒格線與各區顏色；「物理」「自由相機」資料夾可調對應數值。
- 網址加上 `#nolock` 時不鎖定滑鼠（點擊直接開始，沒有滑鼠視角），方便在開發者工具中除錯。
- 按鍵綁定存在 `shardwake:bindings:v1`（以 `KeyboardEvent.code` 綁定，不受輸入法影響）；按鍵設定介面在 M1-14。
