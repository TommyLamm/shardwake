// 命中火花（M1-11）：GPU 粒子，一個 draw call。每顆火花在生成時寫入位置、初速、出生時間、存在時間、大小與顏色，
// 之後由頂點著色器依 uTime 算拋物線（重力）與淡出，並沿速度方向拉長成條狀（面向相機）。容量固定，滿了覆蓋最舊的。
import * as THREE from 'three';
import { GLSL_BILLBOARD_SIDE, GLSL_CULL, InstancedAttributes, createQuadGeometry, writeColor } from '@/fx/instanced';
import { RingAllocator } from '@/fx/ring';
import type { Vec3Like } from '@/physics/Physics';

const vertexShader = /* glsl */ `
attribute vec3 aPos;
attribute vec3 aVel;
attribute vec4 aParams; // 出生時間、存在時間、大小、重力倍率
attribute vec3 aColor;
uniform float uTime;
uniform float uGravity;
uniform float uStretch;
varying vec2 vUv;
varying vec3 vColor;
${GLSL_BILLBOARD_SIDE}
void main() {
  float age = uTime - aParams.x;
  float life = aParams.y;
  if (age < 0.0 || age >= life) { ${GLSL_CULL} }
  float t = age / life;
  vec3 g = vec3(0.0, -9.81 * uGravity * aParams.w, 0.0);
  // 空氣阻力：速度以 exp(-3t) 衰減（位置用積分後的解析式）。
  float k = 3.0;
  float drag = (1.0 - exp(-k * age)) / k;
  vec3 p = aPos + aVel * drag + 0.5 * g * age * age;
  vec3 v = aVel * exp(-k * age) + g * age;
  float speed = length(v);
  vec3 axis = speed > 1e-4 ? v / speed : vec3(0.0, 1.0, 0.0);
  vec3 side = billboardSide(axis, p);
  float size = aParams.z * (1.0 - 0.5 * t);
  float len = size + speed * uStretch;
  vec3 world = p + axis * (position.x * len) + side * (position.y * size);
  vUv = position.xy;
  vColor = aColor * (1.0 - t) * (1.0 - t);
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}
`;

const fragmentShader = /* glsl */ `
varying vec2 vUv;
varying vec3 vColor;
void main() {
  float a = (1.0 - smoothstep(0.2, 1.0, abs(vUv.y))) * (1.0 - smoothstep(0.4, 1.0, abs(vUv.x)));
  gl_FragColor = vec4(vColor * a, a);
}
`;

const _c = new THREE.Color();

export interface SparkSpawn {
  count: number;
  /** 初速（m/s）與隨機比例（0..1）。 */
  speed: number;
  speedJitter?: number;
  /** 方向錐的散開程度（0 = 沿法線，1 = 半球）。 */
  spread?: number;
  size: number;
  life: number;
  color: THREE.ColorRepresentation;
  intensity: number;
  gravity?: number;
}

export class Sparks {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;
  readonly ring: RingAllocator;
  readonly attrs: InstancedAttributes;
  private aliveUntil = -Infinity;
  private readonly rand: () => number;

  constructor(capacity: number, rand: () => number = Math.random) {
    this.rand = rand;
    const geometry = createQuadGeometry(false);
    this.attrs = new InstancedAttributes(geometry, capacity, { aPos: 3, aVel: 3, aParams: 4, aColor: 3 });
    // 初始為「已過期」。
    const params = this.attrs.array('aParams');
    for (let i = 0; i < capacity; i++) params[i * 4 + 1] = 0;
    this.ring = new RingAllocator(capacity);
    this.material = new THREE.ShaderMaterial({
      name: 'fx:sparks',
      vertexShader,
      fragmentShader,
      uniforms: { uTime: { value: 0 }, uGravity: { value: 1 }, uStretch: { value: 0.012 } },
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.name = 'fx:sparks';
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.renderOrder = 5;
  }

  /** 在 point 沿 normal 噴出火花。 */
  spawn(time: number, point: Readonly<Vec3Like>, normal: Readonly<Vec3Like>, s: Readonly<SparkSpawn>): number {
    const n = Math.max(0, Math.floor(s.count));
    if (n === 0) return 0;
    _c.set(s.color);
    const pos = this.attrs.array('aPos');
    const vel = this.attrs.array('aVel');
    const par = this.attrs.array('aParams');
    const col = this.attrs.array('aColor');
    const spread = s.spread ?? 0.75;
    const jitter = s.speedJitter ?? 0.6;
    for (let k = 0; k < n; k++) {
      const i = this.ring.next();
      // 隨機單位向量（球面均勻）× spread + 法線。
      const u = this.rand() * 2 - 1;
      const a = this.rand() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      let dx = normal.x + r * Math.cos(a) * spread;
      let dy = normal.y + u * spread;
      let dz = normal.z + r * Math.sin(a) * spread;
      const l = Math.hypot(dx, dy, dz) || 1;
      const sp = s.speed * (1 - jitter * this.rand());
      dx = (dx / l) * sp;
      dy = (dy / l) * sp;
      dz = (dz / l) * sp;
      pos[i * 3] = point.x + normal.x * 0.01;
      pos[i * 3 + 1] = point.y + normal.y * 0.01;
      pos[i * 3 + 2] = point.z + normal.z * 0.01;
      vel[i * 3] = dx;
      vel[i * 3 + 1] = dy;
      vel[i * 3 + 2] = dz;
      const life = s.life * (0.6 + 0.4 * this.rand());
      par[i * 4] = time;
      par[i * 4 + 1] = life;
      par[i * 4 + 2] = s.size * (0.7 + 0.6 * this.rand());
      par[i * 4 + 3] = s.gravity ?? 1;
      writeColor(col, i * 3, _c, s.intensity);
      this.attrs.touch(i);
      if (time + life > this.aliveUntil) this.aliveUntil = time + life;
    }
    return n;
  }

  /** 每畫面：上傳改過的槽位、設定時間；全部過期時隱藏（不佔 draw call）。 */
  update(time: number, gravity: number, stretch: number): void {
    this.attrs.flush();
    const u = this.material.uniforms;
    u.uTime!.value = time;
    u.uGravity!.value = gravity;
    u.uStretch!.value = stretch;
    (this.mesh.geometry as THREE.InstancedBufferGeometry).instanceCount = this.ring.filled;
    this.mesh.visible = time < this.aliveUntil && this.ring.filled > 0;
  }

  /** 使用中的火花數（估計：仍在存在時間內的槽位）。 */
  activeCount(time: number): number {
    const par = this.attrs.array('aParams');
    let n = 0;
    for (let i = 0; i < this.ring.filled; i++) if (time - par[i * 4]! < par[i * 4 + 1]!) n++;
    return n;
  }

  clear(): void {
    this.aliveUntil = -Infinity;
    this.ring.reset();
    this.mesh.visible = false;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
