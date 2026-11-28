// 靶場 DPS 計看板（M1-12）：一塊全息看板（沿用 M1-09 的 holo 著色器與共用 uniform，不多編譯著色器），
// Canvas 每秒最多重畫 updateHz 次、內容沒變就不重畫。沒有 document（無頭測試）時不建立。
import * as THREE from 'three';
import type { DpsSnapshot } from '@/combat/DpsMeter';
import { HOLO_CONFIG, HOLO_FONT, createHoloMaterial, type HoloConfig, type HoloUniforms } from '@/world/HoloBoards';

export interface DpsBoardOptions {
  holoUniforms: HoloUniforms;
  holo?: HoloConfig;
  pos: readonly [number, number, number];
  /** 面向（度；0 = 面向 +Z）。 */
  yaw: number;
  width: number;
  height: number;
  /** 武器 id → 顯示名稱。 */
  weaponName?: (id: string) => string;
  updateHz?: number;
}

/** 看板文字（純函式，測試用）。 */
export function dpsBoardLines(s: Readonly<DpsSnapshot>, weaponName = ''): string[] {
  return [
    `滾動 DPS（5 s）  ${s.dps.toFixed(1)}`,
    `總傷害  ${Math.round(s.total).toLocaleString('en-US')}`,
    `爆頭率  ${(s.critRate * 100).toFixed(0)}%（${s.crits}／${s.hits}）`,
    `時間  ${s.duration.toFixed(1)} s${weaponName ? `・${weaponName}` : ''}`,
  ];
}

export class DpsBoard {
  readonly mesh: THREE.Mesh;
  readonly texture: THREE.CanvasTexture;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private last = '';
  private accum = Infinity;
  private readonly cfg: HoloConfig;

  static create(options: DpsBoardOptions): DpsBoard | null {
    if (typeof document === 'undefined') return null;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    return new DpsBoard(options, canvas, ctx);
  }

  private constructor(
    private readonly options: DpsBoardOptions,
    canvas: HTMLCanvasElement,
    ctx: CanvasRenderingContext2D,
  ) {
    this.cfg = options.holo ?? HOLO_CONFIG;
    this.canvas = canvas;
    this.ctx = ctx;
    canvas.width = 1024;
    canvas.height = Math.round((1024 * options.height) / options.width / 4) * 4;
    this.texture = new THREE.CanvasTexture(canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.generateMipmaps = true;
    this.texture.minFilter = THREE.LinearMipmapLinearFilter;
    this.texture.name = 'holo:dps';
    const geo = new THREE.PlaneGeometry(options.width, options.height);
    geo.setAttribute('aSeed', new THREE.BufferAttribute(new Float32Array(4).fill(0.37), 1));
    const material = createHoloMaterial(this.texture, options.holoUniforms);
    material.name = 'holo';
    this.mesh = new THREE.Mesh(geo, material);
    this.mesh.name = 'target:dpsBoard';
    this.mesh.renderOrder = 10;
    this.mesh.position.set(options.pos[0], options.pos[1], options.pos[2]);
    this.mesh.rotation.y = (options.yaw * Math.PI) / 180;
    this.draw(['等待命中…', '對假人或移動靶開火', '', '']);
  }

  /** 每畫面呼叫；dt 為真實時間（s）。 */
  update(dt: number, snapshot: Readonly<DpsSnapshot>): void {
    this.accum += dt;
    if (this.accum < 1 / (this.options.updateHz ?? 5)) return;
    this.accum = 0;
    if (snapshot.hits === 0) return;
    const lines = dpsBoardLines(snapshot, snapshot.weaponId ? (this.options.weaponName?.(snapshot.weaponId) ?? '') : '');
    this.draw(lines);
  }

  private draw(lines: readonly string[]): void {
    const key = lines.join('\n');
    if (key === this.last) return;
    this.last = key;
    const { ctx, canvas } = this;
    const cfg = this.cfg;
    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = cfg.background;
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = cfg.border;
    ctx.lineWidth = 6;
    ctx.strokeRect(3, 3, W - 6, H - 6);
    ctx.fillStyle = '#ffc080';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.font = `bold ${Math.round(H * 0.15)}px ${HOLO_FONT}`;
    ctx.fillText('DPS 計', W * 0.05, H * 0.15);
    ctx.fillStyle = '#e8fbff';
    ctx.font = `${Math.round(H * 0.12)}px ${HOLO_FONT}`;
    lines.forEach((line, i) => ctx.fillText(line, W * 0.05, H * (0.36 + i * 0.17)));
    this.texture.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.texture.dispose();
  }
}
