// 特效用的程序貼圖（M1-11）：純函式產生像素（可無頭測試、結果可重現），再包成 DataTexture。
import * as THREE from 'three';
import { Rng } from '@/core/Rng';

/**
 * 槍口閃光：中心亮核 + spikes 道放射狀尖刺（長度隨機），灰階寫在 RGB 與 A（加法混合時顏色由材質決定）。
 * 回傳 size × size × 4 的 RGBA。
 */
export function generateFlashPixels(size: number, spikes = 6, seed = 7): Uint8Array {
  const rng = new Rng(seed);
  const lengths: number[] = [];
  const widths: number[] = [];
  for (let i = 0; i < spikes; i++) {
    lengths.push(rng.range(0.55, 1));
    widths.push(rng.range(0.06, 0.12));
  }
  const out = new Uint8Array(size * size * 4);
  const half = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5 - half) / half;
      const dy = (y + 0.5 - half) / half;
      const r = Math.hypot(dx, dy);
      const a = Math.atan2(dy, dx);
      // 亮核：高斯。
      let v = Math.exp(-(r * r) / 0.035) + 0.45 * Math.exp(-(r * r) / 0.12);
      // 尖刺：角度接近某一道時，沿半徑線性衰減。
      for (let i = 0; i < spikes; i++) {
        const sa = (i / spikes) * Math.PI * 2;
        let d = Math.abs(a - sa);
        if (d > Math.PI) d = Math.PI * 2 - d;
        const len = lengths[i]!;
        const w = widths[i]! * (1 - Math.min(1, r / len));
        if (r < len && d < w) v += (1 - r / len) * (1 - d / w) * 0.9;
      }
      // 邊緣一定透明，避免看到方形。
      v *= 1 - smooth(0.85, 1, r);
      const c = Math.max(0, Math.min(255, Math.round(v * 255)));
      const i = (y * size + x) * 4;
      out[i] = c;
      out[i + 1] = c;
      out[i + 2] = c;
      out[i + 3] = c;
    }
  }
  return out;
}

function smooth(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

let flashTexture: THREE.DataTexture | null = null;

/** 共用的槍口閃光貼圖（128 px，線性）。 */
export function getFlashTexture(): THREE.DataTexture {
  if (flashTexture) return flashTexture;
  const size = 128;
  const t = new THREE.DataTexture(generateFlashPixels(size), size, size, THREE.RGBAFormat);
  t.name = 'fx:flash';
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  flashTexture = t;
  return t;
}
