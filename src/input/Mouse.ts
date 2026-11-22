// 滑鼠視角：累計 movementX／Y，在每個渲染畫面開頭（Game 的 beginFrame）一次套用到 yaw／pitch。
// 不平滑、不加速；靈敏度採 Source／Apex 尺度（每 count 0.022° × 靈敏度），另可由 DPI 換算 cm/360。
//
// 角度慣例（弧度）：yaw 0 面向 -Z（three.js 相機預設前方），正值向左轉（繞 +Y 逆時針）；
// pitch 正值抬頭。滑鼠往右（movementX > 0）→ yaw 減少；往上（movementY < 0）→ pitch 增加。
// 相機套用方式：camera.rotation.set(viewPitch, viewYaw, 0, 'YXZ')。
import { INPUT_CONFIG, type InputConfig } from '@/input/config';

const DEG2RAD = Math.PI / 180;
const TAU = Math.PI * 2;

/** 把角度包回 [-π, π)。 */
export function wrapAngle(rad: number): number {
  if (rad >= -Math.PI && rad < Math.PI) return rad;
  return rad - TAU * Math.floor((rad + Math.PI) / TAU);
}

/** 轉一圈需要的滑鼠移動距離（公分）。 */
export function cmPer360(sensitivity: number, dpi: number, degreesPerCount = INPUT_CONFIG.degreesPerCount): number {
  const countsPer360 = 360 / (degreesPerCount * sensitivity);
  return (countsPer360 / dpi) * 2.54;
}

/** 由想要的 cm/360 與 DPI 反推靈敏度。 */
export function sensitivityForCmPer360(cm: number, dpi: number, degreesPerCount = INPUT_CONFIG.degreesPerCount): number {
  const countsPer360 = (cm / 2.54) * dpi;
  return 360 / (degreesPerCount * countsPer360);
}

/**
 * 視角：玩家輸入的 yaw／pitch（進入 InputFrame、錄影重播的就是這兩個值），
 * 加上給後座力疊加用的偏移 offsetYaw／offsetPitch（由武器在模擬中設定，不寫進 InputFrame）。
 * 最終視角 viewYaw／viewPitch = 玩家視角 + 偏移，pitch 夾在 ±pitchLimit。
 */
export class ViewAngles {
  yaw = 0;
  pitch = 0;
  offsetYaw = 0;
  offsetPitch = 0;

  constructor(private readonly config: Pick<InputConfig, 'pitchLimitDeg'> = INPUT_CONFIG) {}

  get pitchLimit(): number {
    return this.config.pitchLimitDeg * DEG2RAD;
  }

  /** 最終 yaw（含偏移，包在 [-π, π)）。 */
  get viewYaw(): number {
    return wrapAngle(this.yaw + this.offsetYaw);
  }

  /** 最終 pitch（含偏移，夾在 ±pitchLimit）。 */
  get viewPitch(): number {
    const lim = this.pitchLimit;
    return Math.min(lim, Math.max(-lim, this.pitch + this.offsetPitch));
  }

  /** 設定玩家視角（例如重生、傳送、重播起點）。 */
  set(yaw: number, pitch: number): void {
    this.yaw = wrapAngle(yaw);
    const lim = this.pitchLimit;
    this.pitch = Math.min(lim, Math.max(-lim, pitch));
  }

  /** 加上玩家輸入的轉動量（弧度）。 */
  rotate(dYaw: number, dPitch: number): void {
    this.set(this.yaw + dYaw, this.pitch + dPitch);
  }

  /** 後座力偏移：加上增量（弧度）。 */
  addOffset(dYaw: number, dPitch: number): void {
    this.offsetYaw += dYaw;
    this.offsetPitch += dPitch;
  }

  /** 後座力偏移：直接設定（弧度）。 */
  setOffset(yaw: number, pitch: number): void {
    this.offsetYaw = yaw;
    this.offsetPitch = pitch;
  }

  /** 把偏移併入玩家視角並歸零（例如切換武器時保留目前瞄準方向）。 */
  commitOffset(): void {
    const y = this.viewYaw;
    const p = this.viewPitch;
    this.offsetYaw = 0;
    this.offsetPitch = 0;
    this.set(y, p);
  }
}

/** 套用到滑鼠轉動時需要的玩家設定。 */
export interface MouseLookSettings {
  sensitivity: number;
  invertY: boolean;
}

/**
 * 跳動過濾（一般鎖定時 Chrome 偶爾送出單一位移極大的事件）：
 * 單一事件 |dx| 或 |dy| 超過門檻，而且前一個事件不大（不是連續快速甩動）時丟棄。
 */
export class SpikeFilter {
  private prevMag = 0;
  /** 被丟棄的事件數（除錯監看）。 */
  dropped = 0;

  constructor(private readonly config: Pick<InputConfig, 'spikeThreshold' | 'spikeNeighborRatio'> = INPUT_CONFIG) {}

  /** 回傳 true 代表接受這個事件。 */
  accept(dx: number, dy: number): boolean {
    const mag = Math.max(Math.abs(dx), Math.abs(dy));
    const threshold = this.config.spikeThreshold;
    if (threshold > 0 && mag > threshold && this.prevMag < threshold * this.config.spikeNeighborRatio) {
      this.dropped++;
      // 不更新 prevMag：跳動之後的正常事件照常比較。
      return false;
    }
    this.prevMag = mag;
    return true;
  }

  reset(): void {
    this.prevMag = 0;
  }
}

export class MouseLook {
  /** 本畫面尚未套用的累計 count。 */
  private accX = 0;
  private accY = 0;
  /** 額外的靈敏度倍率（例如開鏡時由武器系統設定；M1-14 加入設定欄位）。 */
  scale = 1;
  readonly spikeFilter: SpikeFilter;
  /** 最近一次 applyFrame 套用的 count（除錯監看）。 */
  lastCounts = { x: 0, y: 0 };

  constructor(private readonly config: InputConfig = INPUT_CONFIG) {
    this.spikeFilter = new SpikeFilter(config);
  }

  /** mousemove 事件：累計位移。raw 為目前是否為原始輸入（未知時傳 false）。回傳是否被接受。 */
  accumulate(dx: number, dy: number, raw: boolean): boolean {
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return false;
    if (!raw || this.config.spikeFilterRaw) {
      if (!this.spikeFilter.accept(dx, dy)) return false;
    }
    this.accX += dx;
    this.accY += dy;
    return true;
  }

  /** 尚未套用的累計量。 */
  get pending(): { x: number; y: number } {
    return { x: this.accX, y: this.accY };
  }

  /** 每個渲染畫面開頭呼叫一次：把累計量套用到視角並清空。 */
  applyFrame(view: ViewAngles, settings: MouseLookSettings): void {
    const dx = this.accX;
    const dy = this.accY;
    this.accX = 0;
    this.accY = 0;
    this.lastCounts.x = dx;
    this.lastCounts.y = dy;
    if (dx === 0 && dy === 0) return;
    const radPerCount = this.config.degreesPerCount * settings.sensitivity * this.scale * DEG2RAD;
    const ySign = settings.invertY ? -1 : 1;
    view.rotate(-dx * radPerCount, -dy * radPerCount * ySign);
  }

  /** 丟棄累計量（未鎖定、暫停時）。 */
  discard(): void {
    this.accX = 0;
    this.accY = 0;
    this.spikeFilter.reset();
  }
}
