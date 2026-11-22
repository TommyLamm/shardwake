# 碎晶航跡 SHARDWAKE

> 在崩解的軌道巨構碎片間高速穿梭、奪取原型武器的單人第一人稱科幻刷寶射擊遊戲。

- 狀態：規劃完成，尚未開始實作。下一步：[M1-01 專案骨架與平台成品格式](docs/plans/M1-01-scaffold.md)。
- 平台：Playroom（桌面瀏覽器），遊戲 ID `shardwake`。
- 技術：TypeScript、Vite、Three.js、Rapier；幾何、貼圖與音效全部程序生成，不使用外部素材。

## 文件

- [總計畫與進度](PLAN.md)
- [設計總覽](docs/design.md)
- [詳細計畫](docs/plans/)
- [開發規範（AGENTS.md）](AGENTS.md)

## 開發指令（M1-01 完成後可用）

```sh
npm ci              # 安裝固定版本的套件
npm run dev         # 開發伺服器
npm test            # 單元測試（含 Rapier 無頭模擬）
npm run build       # 建置成平台成品到 dist/
npm run check:dist  # 檢查成品格式
```
