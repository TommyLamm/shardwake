// 浮動傷害數字（M1-12；M2-02 加入元素與防禦層的顏色）：DOM 物件池（上限 FEEDBACK_CONFIG.numbers.capacity = 48，滿了回收最舊的），
// 從命中點投影到螢幕後往上飄散；爆頭黃色放大、擊殺紅色。設定「合併傷害數字」開啟時，同一目標短時間內的傷害累加到同一個數字。
// 只顯示玩家打在其他目標身上的傷害。每畫面只改使用中的元素（transform／opacity），文字只在數值改變時寫入。
import * as THREE from 'three';
import type { Damageable } from '@/combat/Damage';
import { isPlayerHit } from '@/combat/HitConfirm';
import type { EventBus } from '@/core/EventBus';
import type { GameEvents } from '@/core/events';
import { SystemOrder, type FrameInfo, type GameSystem } from '@/core/Game';
import { FEEDBACK_CONFIG, type DamageNumberConfig } from '@/ui/FeedbackConfig';
import { DamageNumberModel, damageNumberStyle, formatDamage, type DamageNumberStyle } from '@/ui/feedbackMath';

export interface DamageNumbersOptions {
  container: HTMLElement;
  bus: EventBus<GameEvents>;
  camera: THREE.Camera;
  getSize: () => { width: number; height: number };
  config?: DamageNumberConfig;
  /** 玩家自己（自傷不顯示）。 */
  getSelf?: () => Damageable | null;
  isEnabled?: () => boolean;
  isMerge?: () => boolean;
}

interface Slot {
  el: HTMLElement;
  text: string;
  shown: boolean;
  color: string;
}

const _v = new THREE.Vector3();

export class DamageNumbers implements GameSystem {
  readonly name = 'damageNumbers';
  readonly order = SystemOrder.ui;
  readonly root: HTMLElement;
  readonly config: DamageNumberConfig;
  readonly model: DamageNumberModel;
  time = 0;
  private fontSize = -1;
  private readonly slots: Slot[] = [];
  private readonly style: DamageNumberStyle = { dx: 0, dy: 0, scale: 1, opacity: 0, color: '' };
  private readonly off: () => void;

  constructor(private readonly options: DamageNumbersOptions) {
    this.config = options.config ?? FEEDBACK_CONFIG.numbers;
    this.model = new DamageNumberModel(this.config.capacity);
    const root = document.createElement('div');
    root.className = 'sw-dmgnums';
    root.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < this.model.items.length; i++) {
      const el = document.createElement('span');
      el.className = 'sw-dmgnum';
      el.style.opacity = '0';
      root.appendChild(el);
      this.slots.push({ el, text: '', shown: false, color: '' });
    }
    options.container.appendChild(root);
    this.root = root;
    this.off = options.bus.on('combat:damage', (info) => {
      if (options.isEnabled && !options.isEnabled()) return;
      if (!isPlayerHit(info, options.getSelf?.() ?? null)) return;
      this.model.add(
        this.config,
        this.time,
        info.target,
        info.amount,
        info.isCrit,
        info.isKill,
        info.point.x,
        info.point.y,
        info.point.z,
        options.isMerge?.() ?? true,
      );
    });
  }

  render(_alpha: number, frame: Readonly<FrameInfo>): void {
    this.time += frame.dt;
    const cfg = this.config;
    this.model.update(cfg, this.time, frame.dt);
    const { width, height } = this.options.getSize();
    const cam = this.options.camera;
    // CameraRig 在這一畫面已移動相機（order camera）；先更新矩陣，數字不落後一個畫面。
    cam.updateMatrixWorld();
    const camPos = cam.position;
    if (cfg.fontSize !== this.fontSize) {
      this.root.style.setProperty('--sw-dmg-size', `${cfg.fontSize}px`);
      this.fontSize = cfg.fontSize;
    }
    const items = this.model.items;
    for (let i = 0; i < items.length; i++) {
      const n = items[i]!;
      const slot = this.slots[i]!;
      if (!n.active) {
        if (slot.shown) {
          slot.el.style.opacity = '0';
          slot.shown = false;
        }
        continue;
      }
      _v.set(n.x, n.y, n.z).project(cam);
      if (_v.z > 1 || _v.z < -1) {
        if (slot.shown) {
          slot.el.style.opacity = '0';
          slot.shown = false;
        }
        continue;
      }
      const dist = Math.hypot(n.x - camPos.x, n.y - camPos.y, n.z - camPos.z);
      const st = damageNumberStyle(cfg, n, this.time, dist, this.style);
      const x = (_v.x * 0.5 + 0.5) * width + st.dx;
      const y = (-_v.y * 0.5 + 0.5) * height + st.dy;
      const text = formatDamage(n.amount);
      if (text !== slot.text) {
        slot.el.textContent = text;
        slot.text = text;
      }
      if (st.color !== slot.color) {
        slot.el.style.color = st.color;
        slot.color = st.color;
      }
      const s = slot.el.style;
      s.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -50%) scale(${st.scale.toFixed(3)})`;
      s.opacity = st.opacity.toFixed(3);
      slot.shown = true;
    }
  }

  clear(): void {
    this.model.clear();
  }

  dispose(): void {
    this.off();
    this.root.remove();
  }
}
