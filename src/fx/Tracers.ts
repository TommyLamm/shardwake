// 曳光（M1-11）：從槍口到命中點的拉長發光四邊形（面向相機），一個 draw call。
// speed > 0 時是一段往前飛的光束（長度 length），speed = 0 時整條立即出現（磁軌狙擊）；都在 life 內快速淡出。
import * as THREE from 'three';
import { GLSL_BILLBOARD_SIDE, GLSL_CULL, InstancedAttributes, createQuadGeometry, writeColor } from '@/fx/instanced';
import { RingAllocator } from '@/fx/ring';
import type { Vec3Like } from '@/physics/Physics';

const vertexShader = /* glsl */ `
attribute vec3 aStart;
attribute vec3 aEnd;
attribute vec4 aParams; // 出生時間、存在時間、寬度、速度
attribute vec4 aColor;  // rgb、拖尾長度（0 = 從起點畫到頭）
uniform float uTime;
varying vec2 vUv;
varying vec3 vColor;
${GLSL_BILLBOARD_SIDE}
void main() {
  float age = uTime - aParams.x;
  float life = aParams.y;
  if (age < 0.0 || age >= life) { ${GLSL_CULL} }
  vec3 d = aEnd - aStart;
  float dist = length(d);
  vec3 axis = dist > 1e-4 ? d / dist : vec3(0.0, 0.0, -1.0);
  float speed = aParams.w;
  float head = speed > 0.0 ? min(dist, age * speed) : dist;
  float tail = aColor.w > 0.0 ? clamp(age * max(speed, 0.0) - aColor.w, 0.0, dist) : 0.0;
  if (speed <= 0.0) tail = 0.0;
  if (head - tail < 1e-4) { ${GLSL_CULL} }
  float s = mix(tail, head, position.x);
  vec3 p = aStart + axis * s;
  vec3 side = billboardSide(axis, p);
  vec3 world = p + side * (position.y * aParams.z * 0.5);
  float t = age / life;
  vUv = position.xy;
  vColor = aColor.rgb * (1.0 - t * t);
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}
`;

const fragmentShader = /* glsl */ `
varying vec2 vUv;
varying vec3 vColor;
void main() {
  float across = 1.0 - smoothstep(0.0, 1.0, abs(vUv.y));
  float along = mix(0.25, 1.0, vUv.x);
  float a = across * across * along;
  gl_FragColor = vec4(vColor * a, a);
}
`;

const _c = new THREE.Color();

export interface TracerSpawn {
  color: THREE.ColorRepresentation;
  intensity: number;
  width: number;
  life: number;
  /** m/s；0 = 整條立即出現。 */
  speed: number;
  /** 拖尾長度（m；0 = 從起點畫到頭）。 */
  length: number;
}

/** 曳光的實際存在時間：飛行的光束至少要飛完全程（上限 0.6 s）。 */
export function tracerLife(distance: number, s: Readonly<Pick<TracerSpawn, 'life' | 'speed' | 'length'>>): number {
  if (!(s.speed > 0)) return s.life;
  return Math.min(0.6, Math.max(s.life, (distance + s.length) / s.speed));
}

export class Tracers {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;
  readonly ring: RingAllocator;
  readonly attrs: InstancedAttributes;
  private aliveUntil = -Infinity;

  constructor(capacity: number) {
    const geometry = createQuadGeometry(true);
    this.attrs = new InstancedAttributes(geometry, capacity, { aStart: 3, aEnd: 3, aParams: 4, aColor: 4 });
    this.ring = new RingAllocator(capacity);
    this.material = new THREE.ShaderMaterial({
      name: 'fx:tracers',
      vertexShader,
      fragmentShader,
      uniforms: { uTime: { value: 0 } },
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.name = 'fx:tracers';
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.renderOrder = 6;
  }

  spawn(time: number, from: Readonly<Vec3Like>, to: Readonly<Vec3Like>, s: Readonly<TracerSpawn>): number {
    const i = this.ring.next();
    const st = this.attrs.array('aStart');
    const en = this.attrs.array('aEnd');
    const par = this.attrs.array('aParams');
    const col = this.attrs.array('aColor');
    st[i * 3] = from.x;
    st[i * 3 + 1] = from.y;
    st[i * 3 + 2] = from.z;
    en[i * 3] = to.x;
    en[i * 3 + 1] = to.y;
    en[i * 3 + 2] = to.z;
    const dist = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z);
    const life = tracerLife(dist, s);
    par[i * 4] = time;
    par[i * 4 + 1] = life;
    par[i * 4 + 2] = s.width;
    par[i * 4 + 3] = s.speed;
    _c.set(s.color);
    writeColor(col, i * 4, _c, s.intensity);
    col[i * 4 + 3] = s.length;
    this.attrs.touch(i);
    if (time + life > this.aliveUntil) this.aliveUntil = time + life;
    return i;
  }

  update(time: number): void {
    this.attrs.flush();
    this.material.uniforms.uTime!.value = time;
    (this.mesh.geometry as THREE.InstancedBufferGeometry).instanceCount = this.ring.filled;
    this.mesh.visible = time < this.aliveUntil && this.ring.filled > 0;
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
