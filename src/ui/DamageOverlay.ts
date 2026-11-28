// 受擊畫面回饋（M1-12；M1-14 組合進 HUD）：
// - 受擊方向指示：畫面中心周圍的紅色弧形，指向攻擊來源（世界位置；轉頭時跟著轉）。從左邊被打時出現在左邊。
// - 護盾破裂：藍色碎裂邊框（Canvas 程序生成的裂紋，只在尺寸改變時重畫）短暫出現。
// - 受擊閃光：護盾受擊時邊緣淡藍、生命受擊時邊緣淡紅。
// - 低生命暗角：生命比例低於門檻時紅色暗角，越低越濃並脈動。
// - 死亡淡出與重生淡入：PlayerHealth.state.fade（黑色覆蓋）。
// 由 `player:damaged` 觸發；每畫面只改 opacity／transform。
import type { PlayerHealth } from '@/combat/PlayerHealth';
import { clamp } from '@/core/math';
import type { EventBus } from '@/core/EventBus';
import type { GameEvents } from '@/core/events';
import { SystemOrder, type FrameInfo, type GameSystem } from '@/core/Game';
import type { Vec3Like } from '@/physics/Physics';
import { FEEDBACK_CONFIG, type DamageIndicatorConfig, type ScreenDamageConfig } from '@/ui/FeedbackConfig';
import { DamageIndicatorModel, damageIndicatorAngle, lowHealthIntensity } from '@/ui/feedbackMath';

export interface DamageOverlayOptions {
  container: HTMLElement;
  bus: EventBus<GameEvents>;
  health: PlayerHealth;
  /** 玩家目前視角 yaw（弧度）。 */
  getYaw: () => number;
  /** 玩家位置（水平；方向指示的中心）。 */
  getPlayerPos: () => Readonly<Vec3Like> | null;
  getSize: () => { width: number; height: number };
  indicator?: DamageIndicatorConfig;
  screen?: ScreenDamageConfig;
}

/** 程序生成的碎裂邊框：從四邊往內的分岔裂紋 + 邊緣藍色光暈。 */
export function drawShieldCracks(ctx: CanvasRenderingContext2D, w: number, h: number, color: string, seed = 7): void {
  let s = seed >>> 0 || 1;
  const rnd = (): number => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 0xffffffff;
  };
  ctx.clearRect(0, 0, w, h);
  const edge = Math.min(w, h) * 0.16;
  const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.32, w / 2, h / 2, Math.hypot(w, h) * 0.55);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, color);
  ctx.globalAlpha = 0.55;
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.globalAlpha = 1;
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  ctx.shadowColor = color;
  ctx.shadowBlur = 6;
  const crack = (x: number, y: number, angle: number, len: number, width: number, depth: number): void => {
    let cx = x;
    let cy = y;
    let a = angle;
    const segs = 4 + Math.floor(rnd() * 3);
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    for (let i = 0; i < segs; i++) {
      a += (rnd() - 0.5) * 0.9;
      const l = (len / segs) * (0.6 + rnd() * 0.8);
      cx += Math.cos(a) * l;
      cy += Math.sin(a) * l;
      ctx.lineTo(cx, cy);
      if (depth > 0 && rnd() < 0.35) {
        ctx.stroke();
        crack(cx, cy, a + (rnd() < 0.5 ? -1 : 1) * (0.5 + rnd() * 0.6), len * 0.45, width * 0.6, depth - 1);
        ctx.lineWidth = width;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
      }
    }
    ctx.stroke();
  };
  const n = 26;
  for (let i = 0; i < n; i++) {
    const t = (i + rnd() * 0.6) / n;
    const per = 2 * (w + h);
    let d = t * per;
    let x: number;
    let y: number;
    if (d < w) {
      x = d;
      y = 0;
    } else if ((d -= w) < h) {
      x = w;
      y = d;
    } else if ((d -= h) < w) {
      x = w - d;
      y = h;
    } else {
      d -= w;
      x = 0;
      y = h - d;
    }
    const toCenter = Math.atan2(h / 2 - y, w / 2 - x);
    crack(x, y, toCenter + (rnd() - 0.5) * 0.7, edge * (0.6 + rnd() * 0.9), 1.6 + rnd() * 1.6, 2);
  }
}

interface ArcEl {
  el: HTMLElement;
  o: number;
  a: number;
  color: string;
}

export class DamageOverlay implements GameSystem {
  readonly name = 'damageOverlay';
  readonly order = SystemOrder.ui;
  readonly root: HTMLElement;
  readonly indicator: DamageIndicatorConfig;
  readonly screen: ScreenDamageConfig;
  readonly model: DamageIndicatorModel;
  time = 0;
  /** 最近一次護盾破裂、護盾受擊、生命受擊的時間（s）。 */
  shieldBreakAt = -Infinity;
  shieldHitAt = -Infinity;
  healthHitAt = -Infinity;
  private readonly arcs: ArcEl[] = [];
  private readonly arcLayer: HTMLElement;
  private readonly shieldCanvas: HTMLCanvasElement;
  private readonly shieldFlash: HTMLElement;
  private readonly healthFlash: HTMLElement;
  private readonly lowHp: HTMLElement;
  private readonly fade: HTMLElement;
  private crackKey = '';
  private readonly written = { shield: -1, sflash: -1, hflash: -1, low: -1, fade: -1, radius: '', th: -1, arc: -1 };
  private readonly off: () => void;

  constructor(private readonly options: DamageOverlayOptions) {
    this.indicator = options.indicator ?? FEEDBACK_CONFIG.indicator;
    this.screen = options.screen ?? FEEDBACK_CONFIG.screen;
    this.model = new DamageIndicatorModel(this.indicator.slots);
    const root = document.createElement('div');
    root.className = 'sw-dmgfx';
    root.setAttribute('aria-hidden', 'true');
    const layer = (cls: string, tag = 'div'): HTMLElement => {
      const el = document.createElement(tag);
      el.className = cls;
      el.style.opacity = '0';
      root.appendChild(el);
      return el;
    };
    this.lowHp = layer('sw-lowhp');
    this.healthFlash = layer('sw-hitflash sw-hitflash-hp');
    this.shieldFlash = layer('sw-hitflash sw-hitflash-shield');
    this.shieldCanvas = layer('sw-shieldbreak', 'canvas') as HTMLCanvasElement;
    this.arcLayer = layer('sw-dmgdir');
    this.arcLayer.style.opacity = '1';
    for (let i = 0; i < this.model.slots.length; i++) {
      const el = document.createElement('i');
      el.style.opacity = '0';
      this.arcLayer.appendChild(el);
      this.arcs.push({ el, o: 0, a: NaN, color: '' });
    }
    this.fade = layer('sw-deathfade');
    options.container.appendChild(root);
    this.root = root;
    this.off = options.bus.on('player:damaged', (e) => this.onDamaged(e));
  }

  private onDamaged(e: Readonly<GameEvents['player:damaged']>): void {
    const p = this.options.getPlayerPos();
    if (p) {
      const weight = clamp(e.amount / 40, 0.2, 1);
      this.model.add(this.indicator, this.time, this.options.getYaw(), p.x, p.z, e.sourcePos.x, e.sourcePos.z, weight, e.blocked);
    }
    if (e.blocked) return;
    if (e.shieldBroken) this.shieldBreakAt = this.time;
    if (e.shieldDamage > 0) this.shieldHitAt = this.time;
    if (e.healthDamage > 0) this.healthHitAt = this.time;
  }

  render(_alpha: number, frame: Readonly<FrameInfo>): void {
    this.time += frame.realDt;
    const t = this.time;
    const ic = this.indicator;
    const sc = this.screen;
    const w = this.written;
    this.model.update(ic, t);
    // 方向指示。
    const p = this.options.getPlayerPos();
    const yaw = this.options.getYaw();
    const { width, height } = this.options.getSize();
    const r = Math.round(Math.min(width, height) * ic.radius);
    const radius = `${r}px`;
    if (radius !== w.radius || ic.thickness !== w.th || ic.arcDeg !== w.arc) {
      this.arcLayer.style.setProperty('--sw-dd-r', radius);
      this.arcLayer.style.setProperty('--sw-dd-th', `${ic.thickness}px`);
      this.arcLayer.style.setProperty('--sw-dd-arc', `${ic.arcDeg}deg`);
      w.radius = radius;
      w.th = ic.thickness;
      w.arc = ic.arcDeg;
    }
    this.model.slots.forEach((slot, i) => {
      const arc = this.arcs[i]!;
      const o = p ? this.model.opacity(ic, slot, t) : 0;
      if (Math.abs(o - arc.o) > 0.004) {
        arc.el.style.opacity = o.toFixed(3);
        arc.o = o;
      }
      if (o <= 0 || !p) return;
      const a = damageIndicatorAngle(yaw, p.x, p.z, slot.sx, slot.sz);
      if (!(Math.abs(a - arc.a) < 1e-3)) {
        arc.el.style.transform = `translate(-50%, -50%) rotate(${a.toFixed(4)}rad)`;
        arc.a = a;
      }
      const color = slot.blocked ? ic.blockedColor : ic.color;
      if (color !== arc.color) {
        arc.el.style.setProperty('--sw-dd-color', color);
        arc.color = color;
      }
    });
    // 護盾破裂（裂紋 Canvas 只在尺寸或顏色改變時重畫）。
    const sb = this.fadeOut(t - this.shieldBreakAt, sc.shieldBreakDuration);
    if (sb > 0) this.ensureCracks(width, height, sc.shieldColor);
    if (Math.abs(sb - w.shield) > 0.004) {
      this.shieldCanvas.style.opacity = sb.toFixed(3);
      this.shieldCanvas.style.transform = `scale(${(1 + 0.04 * (1 - sb)).toFixed(4)})`;
      w.shield = sb;
    }
    const sf = this.fadeOut(t - this.shieldHitAt, sc.shieldHitFlash) * 0.6;
    if (Math.abs(sf - w.sflash) > 0.004) {
      this.shieldFlash.style.opacity = sf.toFixed(3);
      this.shieldFlash.style.setProperty('--sw-flash-color', sc.shieldColor);
      w.sflash = sf;
    }
    const hf = this.fadeOut(t - this.healthHitAt, sc.healthHitFlash) * 0.7;
    if (Math.abs(hf - w.hflash) > 0.004) {
      this.healthFlash.style.opacity = hf.toFixed(3);
      w.hflash = hf;
    }
    // 低生命暗角（死亡淡出時不顯示）。
    const h = this.options.health;
    const low = h.alive ? lowHealthIntensity(h.healthFraction, sc.lowHealthThreshold) : 0;
    const pulse = sc.lowHealthPulseHz > 0 ? 0.82 + 0.18 * Math.sin(t * Math.PI * 2 * sc.lowHealthPulseHz) : 1;
    const lo = low * sc.lowHealthMaxOpacity * pulse;
    if (Math.abs(lo - w.low) > 0.004) {
      this.lowHp.style.opacity = lo.toFixed(3);
      w.low = lo;
    }
    const f = clamp(h.state.fade, 0, 1);
    if (Math.abs(f - w.fade) > 0.002) {
      this.fade.style.opacity = f.toFixed(3);
      w.fade = f;
    }
  }

  /** 出現後線性淡出的不透明度（0..1）。 */
  private fadeOut(age: number, duration: number): number {
    if (!(duration > 0) || !(age >= 0) || age >= duration) return 0;
    return 1 - age / duration;
  }

  private ensureCracks(width: number, height: number, color: string): void {
    const cw = Math.max(64, Math.round(Math.min(1280, width) / 2));
    const ch = Math.max(36, Math.round((cw * height) / Math.max(1, width)));
    const key = `${cw}x${ch}:${color}`;
    if (key === this.crackKey) return;
    this.crackKey = key;
    const c = this.shieldCanvas;
    c.width = cw;
    c.height = ch;
    const ctx = c.getContext('2d');
    if (ctx) drawShieldCracks(ctx, cw, ch, color);
  }

  clear(): void {
    this.model.clear();
    this.shieldBreakAt = this.shieldHitAt = this.healthHitAt = -Infinity;
  }

  dispose(): void {
    this.off();
    this.root.remove();
  }
}
