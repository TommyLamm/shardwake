// GPU 實例化特效的共用工具（M1-11）：基底四邊形、實例屬性與「只上傳改過的範圍」。
// 火花、曳光、彈孔、爆炸、電漿投射物都是「一個網格 + InstancedBufferGeometry + ShaderMaterial」：一個 draw call，
// 動畫（位置、淡出）在頂點著色器依 uTime 與每個實例的出生時間計算，CPU 只在生成時寫入一個槽位。
import * as THREE from 'three';

/** 四邊形：x、y ∈ [-1, 1]（along = false）或 x ∈ [0, 1]、y ∈ [-1, 1]（along = true，沿線段的特效）。 */
export function createQuadGeometry(along = false): THREE.InstancedBufferGeometry {
  const g = new THREE.InstancedBufferGeometry();
  const x0 = along ? 0 : -1;
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([x0, -1, 0, 1, -1, 0, 1, 1, 0, x0, 1, 0]), 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  g.instanceCount = 0;
  return g;
}

/** 實例屬性群組：以槽位寫入，記錄改過的範圍，flush() 時只上傳那一段（環狀繞回時上傳整段）。 */
export class InstancedAttributes {
  readonly attributes: Record<string, THREE.InstancedBufferAttribute> = {};
  private lo = Infinity;
  private hi = -1;

  constructor(
    readonly geometry: THREE.InstancedBufferGeometry,
    readonly capacity: number,
    layout: Record<string, number>,
  ) {
    for (const [name, size] of Object.entries(layout)) {
      const attr = new THREE.InstancedBufferAttribute(new Float32Array(capacity * size), size);
      attr.setUsage(THREE.DynamicDrawUsage);
      geometry.setAttribute(name, attr);
      this.attributes[name] = attr;
    }
  }

  array(name: string): Float32Array {
    return this.attributes[name]!.array as Float32Array;
  }

  /** 標記槽位 i 已改寫。 */
  touch(i: number): void {
    if (i < this.lo) this.lo = i;
    if (i > this.hi) this.hi = i;
  }

  get dirty(): boolean {
    return this.hi >= this.lo;
  }

  /** 上傳改過的範圍。 */
  flush(): void {
    if (this.hi < this.lo) return;
    for (const attr of Object.values(this.attributes)) {
      attr.clearUpdateRanges();
      attr.addUpdateRange(this.lo * attr.itemSize, (this.hi - this.lo + 1) * attr.itemSize);
      attr.needsUpdate = true;
    }
    this.lo = Infinity;
    this.hi = -1;
  }
}

/** 線性 HDR 顏色（sRGB hex × 強度）寫入陣列。 */
export function writeColor(arr: Float32Array, offset: number, color: THREE.Color, intensity: number): void {
  arr[offset] = color.r * intensity;
  arr[offset + 1] = color.g * intensity;
  arr[offset + 2] = color.b * intensity;
}

/** 畫在畫面外的退化頂點（實例過期時）。 */
export const GLSL_CULL = 'gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return;';

/** 以 axis 為軸、面向相機的側向單位向量。 */
export const GLSL_BILLBOARD_SIDE = /* glsl */ `
vec3 billboardSide(vec3 axis, vec3 p) {
  vec3 toCam = normalize(cameraPosition - p);
  vec3 side = cross(axis, toCam);
  float l = length(side);
  return l > 1e-5 ? side / l : vec3(1.0, 0.0, 0.0);
}
`;
