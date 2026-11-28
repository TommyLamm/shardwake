// #cover 封面模式（M1-16）：固定在訓練場的取景角度、隱藏 HUD 與選單、以 800 × 500（內部 2 倍超取樣）渲染，
// 畫面右下角提供「下載封面」按鈕（只在 #cover 出現）。`npm run cover` 以 headless 瀏覽器開 #cover 並呼叫
// window.__shardwakeCover.capture() 產生正式的 public/cover.png。
// 取景數值集中在 COVER_CONFIG（調參面板「工具/封面」可調，按「重新取景」套用）。
// 封面模式不寫入玩家設定：畫質直接套用高畫質預設，不改 shardwake:settings:v1。
import { DEG2RAD } from '@/core/math';

export interface CoverConfig {
  /** 輸出尺寸（px）：平台建議 800 × 500。 */
  width: number;
  height: number;
  /** 內部渲染倍率（2 = 以 1600 × 1000 渲染再縮小，邊緣更乾淨）；1–2。 */
  supersample: number;
  /** 玩家腳底位置（m）與視角（度；yaw 0 = 朝 −z，pitch 正值往上看）。 */
  feet: [number, number, number];
  yawDeg: number;
  pitchDeg: number;
  /** 手持武器（0–4，依武器欄位順序）；showWeapon = false 時不畫槍模。 */
  weaponSlot: number;
  showWeapon: boolean;
  /** 放到取景位置後模擬多久再凍結（s；讓玩家落地、切槍動畫結束）。 */
  settleSeconds: number;
  /** 開啟訓練無人機（玩家在戰區內時會飛到畫面中；不扣血）。 */
  drones: boolean;
  /** 左下角疊上遊戲名稱。 */
  title: boolean;
}

export const COVER_CONFIG: CoverConfig = {
  width: 800,
  height: 500,
  supersample: 2,
  feet: [50, 0, 22],
  yawDeg: -40,
  pitchDeg: 16,
  weaponSlot: 0,
  showWeapon: true,
  settleSeconds: 12,
  drones: true,
  title: true,
};

export const COVER_PANEL = {
  yawDeg: { label: 'yaw°', min: -180, max: 180, step: 1 },
  pitchDeg: { label: 'pitch°', min: -60, max: 60, step: 0.5 },
  weaponSlot: { label: '武器欄位', min: 0, max: 4, step: 1 },
  showWeapon: { label: '顯示槍模' },
  settleSeconds: { label: '凍結前模擬 s', min: 0, max: 5, step: 0.1 },
  drones: { label: '無人機' },
  title: { label: '疊上遊戲名稱' },
  supersample: { label: '超取樣倍率', min: 1, max: 2, step: 0.25 },
} as const;

/** 視角（弧度）：遊戲的 yaw 以 −z 為 0、往左為正（與 input.view 相同）。 */
export function coverView(cfg: Readonly<CoverConfig>): { yaw: number; pitch: number } {
  return { yaw: cfg.yawDeg * DEG2RAD, pitch: cfg.pitchDeg * DEG2RAD };
}

/** 夾住封面設定（尺寸至少 16 px、超取樣 1–2、武器欄位 0–4）。 */
export function sanitizeCoverConfig(cfg: Readonly<CoverConfig>): CoverConfig {
  const clampInt = (v: number, lo: number, hi: number): number => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : lo);
  return {
    ...cfg,
    feet: [cfg.feet[0], cfg.feet[1], cfg.feet[2]],
    width: clampInt(cfg.width, 16, 4096),
    height: clampInt(cfg.height, 16, 4096),
    supersample: Number.isFinite(cfg.supersample) ? Math.min(2, Math.max(1, cfg.supersample)) : 1,
    weaponSlot: clampInt(cfg.weaponSlot, 0, 4),
    settleSeconds: Number.isFinite(cfg.settleSeconds) ? Math.max(0, cfg.settleSeconds) : 0,
  };
}

/** 名稱疊字的版面（相對輸出尺寸，給 2D canvas）。 */
export function coverTitleLayout(width: number, height: number): { x: number; titleY: number; titleSize: number; latinY: number; latinSize: number; shadeHeight: number } {
  const s = Math.min(width / 800, height / 500);
  return { x: Math.round(36 * s), titleY: Math.round(height - 70 * s), titleSize: Math.round(54 * s), latinY: Math.round(height - 34 * s), latinSize: Math.round(20 * s), shadeHeight: Math.round(190 * s) };
}

export interface CoverDeps {
  /** 遊戲容器（#app）：封面模式時固定成輸出尺寸。 */
  container: HTMLElement;
  /** 畫一個畫面並回傳 WebGL canvas（同一個工作內讀取，preserveDrawingBuffer 不需要開啟）。 */
  renderNow: () => HTMLCanvasElement;
  /** 放到取景位置（腳底、視角、武器欄位、無人機開關）。 */
  place: (cfg: Readonly<CoverConfig>) => void;
  /** 凍結／恢復模擬（timeScale）。 */
  freeze: (frozen: boolean) => void;
  /** 以固定步長同步模擬 seconds 秒（Game.tick）。 */
  settle: (seconds: number) => void;
  /** 套用渲染倍率（Viewport.setRenderScale）。 */
  setRenderScale: (scale: number) => void;
  /** 遊戲名稱（疊字）。 */
  title: { main: string; latin: string };
  /** 「下載封面」按鈕文字。 */
  downloadLabel: string;
}

/** 封面模式控制器（DOM）。 */
export class CoverMode {
  readonly config: CoverConfig;
  private button: HTMLButtonElement | null = null;
  private ready: Promise<void> = Promise.resolve();

  constructor(
    private readonly deps: CoverDeps,
    config: CoverConfig = COVER_CONFIG,
  ) {
    this.config = config;
  }

  /** 進入封面模式：固定容器尺寸、取景、凍結，建立下載按鈕。 */
  start(): Promise<void> {
    const doc = this.deps.container.ownerDocument;
    doc.documentElement.dataset.swCover = 'pending';
    doc.documentElement.classList.add('sw-cover-mode');
    this.applySize();
    const btn = doc.createElement('button');
    btn.type = 'button';
    btn.className = 'sw-cover-download';
    btn.textContent = this.deps.downloadLabel;
    btn.addEventListener('click', () => void this.download());
    doc.body.appendChild(btn);
    this.button = btn;
    return this.reframe();
  }

  /**
   * 依目前設定重新取景（調參面板改完數值後呼叫）：放到取景位置，以固定步長同步模擬 settleSeconds（與畫面更新率無關，
   * 同一個新開的頁面每次結果相同），再放一次視角後凍結。
   */
  reframe(): Promise<void> {
    const cfg = sanitizeCoverConfig(this.config);
    const doc = this.deps.container.ownerDocument;
    doc.documentElement.dataset.swCover = 'pending';
    this.applySize();
    this.deps.freeze(false);
    this.deps.place(cfg);
    this.deps.settle(cfg.settleSeconds);
    this.deps.place({ ...cfg, settleSeconds: 0 });
    this.deps.freeze(true);
    doc.documentElement.dataset.swCover = 'ready';
    this.ready = Promise.resolve();
    return this.ready;
  }

  /** 擷取封面（PNG data URL，輸出尺寸）。 */
  async capture(): Promise<string> {
    await this.ready;
    const cfg = sanitizeCoverConfig(this.config);
    const src = this.deps.renderNow();
    const doc = this.deps.container.ownerDocument;
    const out = doc.createElement('canvas');
    out.width = cfg.width;
    out.height = cfg.height;
    const ctx = out.getContext('2d');
    if (!ctx) throw new Error('無法建立 2D canvas');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, 0, 0, src.width, src.height, 0, 0, cfg.width, cfg.height);
    if (cfg.title) drawTitle(ctx, cfg.width, cfg.height, this.deps.title);
    return out.toDataURL('image/png');
  }

  /** 下載封面（Blob 連結；沙箱 iframe 內允許下載，不開新視窗）。 */
  async download(): Promise<void> {
    const url = await this.capture();
    const a = this.deps.container.ownerDocument.createElement('a');
    a.href = url;
    a.download = 'cover.png';
    a.click();
  }

  dispose(): void {
    this.button?.remove();
    this.button = null;
  }

  private applySize(): void {
    const cfg = sanitizeCoverConfig(this.config);
    const s = this.deps.container.style;
    s.width = `${cfg.width}px`;
    s.height = `${cfg.height}px`;
    this.deps.setRenderScale(cfg.supersample);
  }
}

function drawTitle(ctx: CanvasRenderingContext2D, width: number, height: number, title: { main: string; latin: string }): void {
  const l = coverTitleLayout(width, height);
  const shade = ctx.createLinearGradient(0, height - l.shadeHeight, 0, height);
  shade.addColorStop(0, 'rgba(3, 5, 12, 0)');
  shade.addColorStop(1, 'rgba(3, 5, 12, 0.78)');
  ctx.fillStyle = shade;
  ctx.fillRect(0, height - l.shadeHeight, width, l.shadeHeight);
  const font = "system-ui, 'Microsoft JhengHei', 'PingFang TC', 'Noto Sans TC', sans-serif";
  ctx.textBaseline = 'alphabetic';
  ctx.shadowColor = 'rgba(57, 230, 255, 0.65)';
  ctx.shadowBlur = Math.round(l.titleSize * 0.35);
  ctx.fillStyle = '#e8fbff';
  ctx.font = `700 ${l.titleSize}px ${font}`;
  ctx.fillText(title.main, l.x, l.titleY);
  ctx.shadowBlur = Math.round(l.latinSize * 0.5);
  ctx.fillStyle = '#39e6ff';
  ctx.font = `600 ${l.latinSize}px ui-monospace, 'Cascadia Mono', Consolas, monospace`;
  const letter = l.latinSize * 0.55;
  let x = l.x + 2;
  for (const ch of title.latin) {
    ctx.fillText(ch, x, l.latinY);
    x += ctx.measureText(ch).width + letter;
  }
  ctx.shadowBlur = 0;
}
