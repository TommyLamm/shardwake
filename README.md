# 碎晶航跡 SHARDWAKE

> 在崩解的軌道巨構碎片間高速穿梭、奪取原型武器的單人第一人稱科幻刷寶射擊遊戲。

- 狀態：M1-02 核心執行框架完成（固定 120 Hz 主迴圈、事件、儲存、設定、調參面板；開機畫面仍為發光方塊）。下一步：[M1-03 輸入系統](docs/plans/M1-03-input.md)、[M1-04 物理與訓練場](docs/plans/M1-04-physics-level.md)。
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
- 本機儲存的 key 一律以 `shardwake:` 開頭並帶版本（設定為 `shardwake:settings:v1`）；儲存不可用時改用記憶體，遊戲照常運作。
- 目前的「點擊畫面開始／繼續」與 Esc 暫停是暫時接線，M1-03（輸入）與 M1-14（選單）會取代。
