# 碎晶航跡 SHARDWAKE

> 在崩解的軌道巨構碎片間高速穿梭、奪取原型武器的單人第一人稱科幻刷寶射擊遊戲。

- 狀態：M1-04 物理與灰盒訓練場完成（Rapier 物理與查詢、關卡資料格式與建構器、約 160 × 160 m 的灰盒訓練場、碰撞線框與傳送等除錯工具；目前以暫用自由飛行相機巡視）。下一步：[M1-05 移動 I](docs/plans/M1-05-movement-core.md)。
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

## 開發用功能

- 調參面板：遊戲中按 `` ` `` 或在網址加上 `#debug` 開啟（Tweakpane，第一次開啟時才載入）。`#debug` 也會把核心物件掛到 `window.__shardwake` 方便在主控台檢查。
- 畫面角落的 FPS／frame time 由設定「顯示 FPS」開關（目前預設開啟）。
- 本機儲存的 key 一律以 `shardwake:` 開頭並帶版本（設定為 `shardwake:settings:v1`、按鍵綁定為 `shardwake:bindings:v1`）；儲存不可用時改用記憶體，遊戲照常運作。
- 點擊畫面會鎖定滑鼠並開始／繼續；Esc 解除鎖定並暫停（Chrome 解鎖後約 1 秒內無法重新鎖定，點擊沒反應時稍候再點）。完整選單在 M1-14。
- 調參面板開啟時會解除滑鼠鎖定但不暫停（可用鍵盤操作、邊看邊調），點擊畫面恢復滑鼠視角。
- 暫用自由飛行相機（M1-05 玩家控制器完成前）：WASD 沿視線飛行、Space 上升、C 下降、按住 Shift 加速；穿牆，但掉到 y < -30 會回到最近檢查點。
- 調參面板「關卡」資料夾：切換碰撞體線框、顯示區域與檢查點、傳送到各區，以及灰盒格線與各區顏色；「物理」「自由相機」資料夾可調對應數值。
- 網址加上 `#nolock` 時不鎖定滑鼠（點擊直接開始，沒有滑鼠視角），方便在開發者工具中除錯。
- 按鍵綁定存在 `shardwake:bindings:v1`（以 `KeyboardEvent.code` 綁定，不受輸入法影響）；按鍵設定介面在 M1-14。
