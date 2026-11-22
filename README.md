# 碎晶航跡 SHARDWAKE

> 在崩解的軌道巨構碎片間高速穿梭、奪取原型武器的單人第一人稱科幻刷寶射擊遊戲。

- 狀態：M1-01 專案骨架完成（開機畫面為發光方塊與 FPS）。下一步：[M1-02 核心執行框架](docs/plans/M1-02-core-runtime.md)。
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
