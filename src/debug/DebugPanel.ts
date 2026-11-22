// 調參面板（Tweakpane 外殼）：按 ` 鍵或網址 #debug 開啟。
// - 「效能」資料夾：FPS 圖、renderer.info（draw call、三角形、幾何、貼圖數）、每畫面模擬步數。
// - bindConfig(folderPath, obj, schema)：之後的系統把可調參數（範圍、步進、說明）註冊進來；
//   面板直接改寫 obj 的欄位，系統下次讀取就生效。folderPath 用「/」分層，例如「移動/地面」。
// Tweakpane 只在第一次開啟時才動態載入（不影響啟動時間）；開啟前註冊的參數會先記下來。
import { DEBUG_CONFIG, type DebugConfig } from '@/core/config';
import type { EventBus } from '@/core/EventBus';
import type { GameEvents } from '@/core/events';
import type { FrameInfo, GameSystem } from '@/core/Game';
import { SystemOrder } from '@/core/Game';

// ── 可調參數規格 ─────────────────────────────────────────

export interface ParamSpec {
  label?: string;
  /** 說明文字（滑鼠停留時顯示）。 */
  description?: string;
  min?: number;
  max?: number;
  step?: number;
  /** 下拉選項：{ 顯示名稱: 值 }。 */
  options?: Record<string, unknown>;
  /** 唯讀監看（定時更新）。 */
  readonly?: boolean;
  /** 直接傳給 Tweakpane 的其他參數（例如 color、point2d 的 x／y 範圍）。 */
  params?: Record<string, unknown>;
}

/** obj 中要出現在面板的欄位與規格；未列出的欄位不顯示。 */
export type ConfigSchema<T> = { [K in keyof T]?: ParamSpec };

export interface BindConfigOptions<T> {
  /** 任一欄位被面板修改後呼叫。 */
  onChange?: (key: keyof T, value: T[keyof T]) => void;
  /** 資料夾預設展開（預設 false）。 */
  expanded?: boolean;
}

export interface ConfigBinding {
  /** 物件被程式改寫後，更新面板上顯示的值。 */
  refresh(): void;
  /** 從面板移除這組參數。 */
  dispose(): void;
}

/** 把 ParamSpec 轉成 Tweakpane addBinding 的參數（純函式）。 */
export function toBindingParams(key: string, spec: ParamSpec, config: DebugConfig = DEBUG_CONFIG): Record<string, unknown> {
  const out: Record<string, unknown> = { label: spec.label ?? key, ...spec.params };
  if (spec.min !== undefined) out.min = spec.min;
  if (spec.max !== undefined) out.max = spec.max;
  if (spec.step !== undefined) out.step = spec.step;
  if (spec.options !== undefined) out.options = spec.options;
  if (spec.readonly) {
    out.readonly = true;
    out.interval = config.monitorIntervalMs;
  }
  return out;
}

/** 把「a/b/c」切成資料夾路徑；忽略空段與前後空白。 */
export function parseFolderPath(path: string): string[] {
  return path
    .split('/')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** 網址 hash 是否含有旗標，例如 #debug、#debug&demo、#demo,debug。 */
export function hasHashFlag(hash: string, flag: string): boolean {
  return hash
    .replace(/^#/, '')
    .split(/[&,;]/)
    .map((s) => s.split('=')[0]!.trim().toLowerCase())
    .includes(flag.toLowerCase());
}

// ── Tweakpane 的最小介面（測試可注入假的實作）────────────

export interface PaneBinding {
  on(event: 'change', handler: (ev: { value: unknown }) => void): unknown;
  refresh(): void;
  dispose(): void;
  readonly element?: HTMLElement;
}

export interface PaneButton {
  on(event: 'click', handler: () => void): unknown;
  dispose(): void;
}

export interface PaneFolder {
  addFolder(params: { title: string; expanded?: boolean }): PaneFolder;
  addBinding(obj: object, key: string, params?: Record<string, unknown>): PaneBinding;
  addBlade(params: Record<string, unknown>): unknown;
  /** 按鈕（Tweakpane addButton）；替身可省略。 */
  addButton?(params: { title: string; label?: string }): PaneButton;
  refresh(): void;
  dispose(): void;
}

export interface PaneRoot extends PaneFolder {
  hidden: boolean;
}

export interface FpsGraphLike {
  begin(): void;
  end(): void;
}

export type PaneLoader = (container: HTMLElement) => Promise<PaneRoot>;

/** 預設載入器：動態載入 Tweakpane 與 essentials 外掛（FPS 圖）。 */
export const loadTweakpane: PaneLoader = async (container) => {
  const [{ Pane }, essentials] = await Promise.all([import('tweakpane'), import('@tweakpane/plugin-essentials')]);
  const pane = new Pane({ container, title: '調參面板（`）' });
  pane.registerPlugin(essentials);
  return pane as unknown as PaneRoot;
};

/** renderer.info 的必要欄位（WebGLRenderer.info 符合）。 */
export interface RenderInfoLike {
  render: { calls: number; triangles: number };
  memory: { geometries: number; textures: number };
}

export interface DebugPanelOptions {
  container: HTMLElement;
  bus?: EventBus<GameEvents>;
  getRenderInfo?: () => RenderInfoLike | null;
  loader?: PaneLoader;
  /** 監聽 ` 鍵切換（預設 true；M1-03 之後可改由輸入系統的 debugPanel 動作呼叫 toggle）。 */
  listenKey?: boolean;
  /** 監聽網址 hash（#debug）。預設 true。 */
  listenHash?: boolean;
  win?: Window | null;
  config?: DebugConfig;
}

/** 調參面板按鈕（bindButtons）。 */
export interface ButtonSpec {
  title: string;
  /** 按鈕左側的標籤（選填）。 */
  label?: string;
  onClick: () => void;
}

interface Registration {
  path: string[];
  obj: object;
  schema: Record<string, ParamSpec | undefined>;
  options: BindConfigOptions<object>;
  built: { refresh?(): void; dispose(): void }[];
  buttons?: readonly ButtonSpec[];
}

export class DebugPanel implements GameSystem {
  readonly name = 'debugPanel';
  readonly order = SystemOrder.debug;

  /** 「效能」資料夾監看的值（每畫面更新，面板定時讀取）。 */
  readonly perf = { drawCalls: 0, triangles: 0, geometries: 0, textures: 0, steps: 0, mode: 'boot' };

  private readonly root: HTMLDivElement;
  private readonly bus: EventBus<GameEvents> | undefined;
  private readonly getRenderInfo: () => RenderInfoLike | null;
  private readonly loader: PaneLoader;
  private readonly win: Window | null;
  private readonly config: DebugConfig;
  private readonly registrations: Registration[] = [];
  private readonly folders = new Map<string, PaneFolder>();
  private pane: PaneRoot | null = null;
  private loading: Promise<PaneRoot | null> | null = null;
  private fpsGraph: FpsGraphLike | null = null;
  private _open = false;
  private loadError: unknown = null;

  constructor(options: DebugPanelOptions) {
    this.bus = options.bus;
    this.getRenderInfo = options.getRenderInfo ?? (() => null);
    this.loader = options.loader ?? loadTweakpane;
    this.config = options.config ?? DEBUG_CONFIG;
    this.win = options.win !== undefined ? options.win : typeof window !== 'undefined' ? window : null;
    this.root = document.createElement('div');
    this.root.className = 'sw-debug';
    this.root.hidden = true;
    options.container.appendChild(this.root);
    if (options.listenKey ?? true) this.win?.addEventListener('keydown', this.handleKey);
    if (options.listenHash ?? true) {
      this.win?.addEventListener('hashchange', this.handleHash);
      this.handleHash();
    }
  }

  get isOpen(): boolean {
    return this._open;
  }

  /** 面板是否已建立（Tweakpane 已載入）。 */
  get isReady(): boolean {
    return this.pane !== null;
  }

  /** 開啟面板（第一次開啟時載入 Tweakpane）。回傳面板就緒的 Promise。 */
  open(): Promise<void> {
    if (!this._open) {
      this._open = true;
      this.root.hidden = false;
      this.bus?.emit('debug:panel', { open: true });
    }
    return this.ensurePane().then(() => undefined);
  }

  close(): void {
    if (!this._open) return;
    this._open = false;
    this.root.hidden = true;
    this.bus?.emit('debug:panel', { open: false });
  }

  toggle(): void {
    if (this._open) this.close();
    else void this.open();
  }

  /**
   * 註冊一組可調參數。schema 只列要顯示的欄位，例如：
   *   panel.bindConfig('移動/地面', MOVEMENT_CONFIG, { maxSpeed: { min: 0, max: 20, step: 0.1, description: '…' } });
   */
  bindConfig<T extends object>(
    folderPath: string,
    obj: T,
    schema: ConfigSchema<T>,
    options: BindConfigOptions<T> = {},
  ): ConfigBinding {
    const reg: Registration = {
      path: parseFolderPath(folderPath),
      obj,
      schema: schema as Record<string, ParamSpec | undefined>,
      options: options as unknown as BindConfigOptions<object>,
      built: [],
    };
    if (reg.path.length === 0) throw new Error('bindConfig 需要資料夾名稱');
    this.registrations.push(reg);
    if (this.pane) this.build(reg);
    return {
      refresh: () => {
        for (const b of reg.built) b.refresh?.();
      },
      dispose: () => {
        const idx = this.registrations.indexOf(reg);
        if (idx >= 0) this.registrations.splice(idx, 1);
        for (const b of reg.built) b.dispose();
        reg.built = [];
      },
    };
  }

  /**
   * 註冊一組按鈕（例如「傳送到各區」）。回傳的 dispose() 移除按鈕（換關卡時重建）。
   */
  bindButtons(folderPath: string, buttons: readonly ButtonSpec[], options: { expanded?: boolean } = {}): ConfigBinding {
    const reg: Registration = {
      path: parseFolderPath(folderPath),
      obj: {},
      schema: {},
      options: { expanded: options.expanded ?? false },
      built: [],
      buttons,
    };
    if (reg.path.length === 0) throw new Error('bindButtons 需要資料夾名稱');
    this.registrations.push(reg);
    if (this.pane) this.build(reg);
    return {
      refresh: () => {},
      dispose: () => {
        const idx = this.registrations.indexOf(reg);
        if (idx >= 0) this.registrations.splice(idx, 1);
        for (const b of reg.built) b.dispose();
        reg.built = [];
      },
    };
  }

  /** 目前註冊的資料夾路徑（測試、除錯用）。 */
  get registeredFolders(): string[] {
    return this.registrations.map((r) => r.path.join('/'));
  }

  /** 由主迴圈在每個畫面開始時呼叫（FPS 圖計時）。 */
  beginFrame(): void {
    if (this._open) this.fpsGraph?.begin();
  }

  render(_alpha: number, frame: Readonly<FrameInfo>): void {
    if (!this._open || !this.pane) return;
    const info = this.getRenderInfo();
    const p = this.perf;
    if (info) {
      p.drawCalls = info.render.calls;
      p.triangles = info.render.triangles;
      p.geometries = info.memory.geometries;
      p.textures = info.memory.textures;
    }
    p.steps = frame.steps;
    p.mode = frame.mode;
    this.fpsGraph?.end();
  }

  dispose(): void {
    this.win?.removeEventListener('keydown', this.handleKey);
    this.win?.removeEventListener('hashchange', this.handleHash);
    this.pane?.dispose();
    this.pane = null;
    this.folders.clear();
    this.root.remove();
  }

  private ensurePane(): Promise<PaneRoot | null> {
    if (this.pane) return Promise.resolve(this.pane);
    if (this.loadError) return Promise.resolve(null);
    this.loading ??= this.loader(this.root).then(
      (pane) => {
        this.pane = pane;
        this.buildPerfFolder(pane);
        for (const reg of this.registrations) this.build(reg);
        return pane;
      },
      (err: unknown) => {
        this.loadError = err;
        console.error('[shardwake] 調參面板載入失敗', err);
        this.root.textContent = '調參面板載入失敗';
        return null;
      },
    );
    return this.loading;
  }

  private buildPerfFolder(pane: PaneRoot): void {
    const folder = pane.addFolder({ title: '效能', expanded: true });
    this.folders.set('效能', folder);
    try {
      const graph = folder.addBlade({ view: 'fpsgraph', label: 'FPS', rows: this.config.fpsGraphRows });
      if (graph && typeof (graph as FpsGraphLike).begin === 'function') this.fpsGraph = graph as FpsGraphLike;
    } catch (err) {
      console.warn('[shardwake] FPS 圖不可用', err);
    }
    const ro = (label: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
      label,
      readonly: true,
      interval: this.config.monitorIntervalMs,
      ...extra,
    });
    folder.addBinding(this.perf, 'drawCalls', ro('draw calls', { format: (v: number) => v.toFixed(0) }));
    folder.addBinding(this.perf, 'triangles', ro('三角形', { format: (v: number) => v.toFixed(0) }));
    folder.addBinding(this.perf, 'geometries', ro('幾何', { format: (v: number) => v.toFixed(0) }));
    folder.addBinding(this.perf, 'textures', ro('貼圖', { format: (v: number) => v.toFixed(0) }));
    folder.addBinding(this.perf, 'steps', ro('步數／畫面', { format: (v: number) => v.toFixed(0) }));
    folder.addBinding(this.perf, 'mode', ro('模式'));
  }

  private folderFor(path: readonly string[], expanded: boolean): PaneFolder {
    let parent: PaneFolder = this.pane!;
    let key = '';
    for (const name of path) {
      key = key ? `${key}/${name}` : name;
      let folder = this.folders.get(key);
      if (!folder) {
        folder = parent.addFolder({ title: name, expanded });
        this.folders.set(key, folder);
      }
      parent = folder;
    }
    return parent;
  }

  private build(reg: Registration): void {
    const folder = this.folderFor(reg.path, reg.options.expanded ?? false);
    if (reg.buttons) {
      for (const spec of reg.buttons) {
        if (!folder.addButton) continue;
        const params: { title: string; label?: string } = { title: spec.title };
        if (spec.label !== undefined) params.label = spec.label;
        const button = folder.addButton(params);
        button.on('click', () => spec.onClick());
        reg.built.push(button);
      }
      return;
    }
    const target = reg.obj as Record<string, unknown>;
    for (const [key, spec] of Object.entries(reg.schema)) {
      if (!spec) continue;
      if (!(key in target)) {
        console.warn(`[shardwake] bindConfig「${reg.path.join('/')}」沒有欄位 ${key}`);
        continue;
      }
      const binding = folder.addBinding(reg.obj, key, toBindingParams(key, spec, this.config));
      if (spec.description && binding.element) binding.element.title = spec.description;
      if (!spec.readonly && reg.options.onChange) {
        const onChange = reg.options.onChange;
        binding.on('change', () => onChange(key as never, target[key] as never));
      }
      reg.built.push(binding);
    }
  }

  private readonly handleKey = (e: KeyboardEvent): void => {
    if (e.code !== 'Backquote' || e.repeat || e.ctrlKey || e.altKey || e.metaKey) return;
    const t = e.target as { tagName?: string; isContentEditable?: boolean } | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    e.preventDefault();
    this.toggle();
  };

  private readonly handleHash = (): void => {
    if (this.win && hasHashFlag(this.win.location.hash, 'debug')) void this.open();
  };
}
