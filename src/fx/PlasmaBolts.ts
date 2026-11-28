// 電漿投射物（M1-11）：發光球 + 拖尾（沿速度方向拉長、面向相機的四邊形，片段著色器畫出亮核、光暈與漸細的尾巴），一個 draw call。
// 每畫面依 Ballistics 的投射物池（插值後的位置）重寫實例屬性；投射物最多 32 個（與 Ballistics 的池相同）。
import * as THREE from 'three';
import { GLSL_BILLBOARD_SIDE, InstancedAttributes, createQuadGeometry, writeColor } from '@/fx/instanced';
import type { Vec3Like } from '@/physics/Physics';

const vertexShader = /* glsl */ `
attribute vec3 aHead;
attribute vec3 aTail;
attribute vec4 aParams; // 發光半徑、-、-、-
attribute vec3 aColor;
varying vec2 vSeg; // 沿線（m，0 = 尾端）、橫向（m）
varying float vLen;
varying float vR;
varying vec3 vColor;
${GLSL_BILLBOARD_SIDE}
void main() {
  vec3 d = aHead - aTail;
  float len = length(d);
  vec3 axis = len > 1e-4 ? d / len : vec3(0.0, 0.0, -1.0);
  float r = aParams.x;
  float s = mix(-r, len + r, position.x);
  vec3 p = aTail + axis * s;
  vec3 side = billboardSide(axis, p);
  vec3 world = p + side * (position.y * r);
  vSeg = vec2(s, position.y * r);
  vLen = len;
  vR = r;
  vColor = aColor;
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}
`;

const fragmentShader = /* glsl */ `
varying vec2 vSeg;
varying float vLen;
varying float vR;
varying vec3 vColor;
void main() {
  float r = max(vR, 1e-4);
  vec2 h = vec2(vSeg.x - vLen, vSeg.y) / r;
  float dh = dot(h, h);
  float core = exp(-dh * 9.0) * 2.5;
  float halo = exp(-dh * 2.2) * 0.9;
  float along = clamp(vSeg.x / max(vLen, 1e-4), 0.0, 1.0);
  float width = mix(0.15, 0.45, along);
  float trail = vSeg.x > 0.0 && vSeg.x < vLen ? exp(-pow(vSeg.y / (r * width), 2.0)) * along * along * 0.8 : 0.0;
  float k = core + halo + trail;
  gl_FragColor = vec4(vColor * k, min(1.0, k));
}
`;

const _c = new THREE.Color();

export interface BoltSource {
  readonly position: Readonly<Vec3Like>;
  readonly previousPosition: Readonly<Vec3Like>;
  readonly velocity: Readonly<Vec3Like>;
  readonly origin: Readonly<Vec3Like>;
}

export class PlasmaBolts {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;
  readonly attrs: InstancedAttributes;
  count = 0;

  constructor(readonly capacity: number) {
    const geometry = createQuadGeometry(true);
    this.attrs = new InstancedAttributes(geometry, capacity, { aHead: 3, aTail: 3, aParams: 4, aColor: 3 });
    this.material = new THREE.ShaderMaterial({
      name: 'fx:bolts',
      vertexShader,
      fragmentShader,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.name = 'fx:bolts';
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.renderOrder = 6;
  }

  /** 開始一個畫面的寫入。 */
  begin(): void {
    this.count = 0;
  }

  /**
   * 加入一顆投射物（插值係數 alpha）；回傳是否寫入（滿了忽略）。
   * shift × shiftWeight 是畫面上的位移（投射物從眼睛射出，剛發射時把外觀往槍口偏，飛遠後歸零）。
   */
  add(
    src: BoltSource,
    alpha: number,
    radius: number,
    trail: number,
    color: THREE.ColorRepresentation,
    intensity: number,
    shift: Readonly<Vec3Like> | null = null,
    shiftWeight = 0,
  ): boolean {
    if (this.count >= this.capacity) return false;
    const i = this.count++;
    const head = this.attrs.array('aHead');
    const tail = this.attrs.array('aTail');
    const par = this.attrs.array('aParams');
    const col = this.attrs.array('aColor');
    const p = src.position;
    const q = src.previousPosition;
    const sw = shift ? shiftWeight : 0;
    const hx = q.x + (p.x - q.x) * alpha + (shift ? shift.x * sw : 0);
    const hy = q.y + (p.y - q.y) * alpha + (shift ? shift.y * sw : 0);
    const hz = q.z + (p.z - q.z) * alpha + (shift ? shift.z * sw : 0);
    const v = src.velocity;
    const sp = Math.hypot(v.x, v.y, v.z) || 1;
    const o = src.origin;
    const traveled = Math.hypot(q.x + (p.x - q.x) * alpha - o.x, q.y + (p.y - q.y) * alpha - o.y, q.z + (p.z - q.z) * alpha - o.z);
    const len = Math.min(trail, traveled);
    head[i * 3] = hx;
    head[i * 3 + 1] = hy;
    head[i * 3 + 2] = hz;
    tail[i * 3] = hx - (v.x / sp) * len;
    tail[i * 3 + 1] = hy - (v.y / sp) * len;
    tail[i * 3 + 2] = hz - (v.z / sp) * len;
    par[i * 4] = radius;
    _c.set(color);
    writeColor(col, i * 3, _c, intensity);
    this.attrs.touch(i);
    return true;
  }

  end(): void {
    this.attrs.flush();
    (this.mesh.geometry as THREE.InstancedBufferGeometry).instanceCount = this.count;
    this.mesh.visible = this.count > 0;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
