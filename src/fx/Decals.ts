// 彈孔貼花（M1-11）：貼在命中表面的四邊形（沿法線抬起一點 + polygonOffset，不與牆面 z-fighting），一個 draw call。
// 上限固定（預設 96），滿了循環覆蓋最舊的。外觀在片段著色器程序生成（深色孔洞 + 不規則碎裂邊緣 + 剛打上時的高溫橘光，
// 依 uHeatTime 冷卻）；套用場景的霧，遠處不會變成黑點。爆炸焦痕也用它（較大、較淡）。
import * as THREE from 'three';
import { InstancedAttributes, createQuadGeometry } from '@/fx/instanced';
import { RingAllocator } from '@/fx/ring';
import type { Vec3Like } from '@/physics/Physics';

const vertexShader = /* glsl */ `
attribute vec3 aPos;
attribute vec3 aNormal;
attribute vec4 aParams; // 出生時間、大小、旋轉、高溫（0..1）
uniform float uTime;
uniform float uHeatTime;
uniform float uLift;
varying vec2 vUv;
varying float vHeat;
varying float vSeed;
#include <fog_pars_vertex>
void main() {
  vec3 n = normalize(aNormal);
  vec3 up = abs(n.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
  vec3 t = normalize(cross(up, n));
  vec3 b = cross(n, t);
  float c = cos(aParams.z);
  float s = sin(aParams.z);
  vec3 tt = t * c + b * s;
  vec3 bb = -t * s + b * c;
  vec3 p = aPos + n * uLift + (tt * position.x + bb * position.y) * (aParams.y * 0.5);
  vUv = position.xy;
  float age = max(0.0, uTime - aParams.x);
  vHeat = aParams.w * exp(-age / max(uHeatTime, 1e-3));
  vSeed = aParams.z;
  vec4 mvPosition = viewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const fragmentShader = /* glsl */ `
uniform vec3 uHeatColor;
varying vec2 vUv;
varying float vHeat;
varying float vSeed;
#include <fog_pars_fragment>
void main() {
  float a0 = atan(vUv.y, vUv.x);
  float jag = 0.12 * sin(a0 * 7.0 + vSeed * 3.0) + 0.08 * sin(a0 * 13.0 - vSeed * 5.0);
  float r = length(vUv) * (1.0 + jag);
  if (r > 1.0) discard;
  float hole = 1.0 - smoothstep(0.18, 0.34, r);
  float crater = 1.0 - smoothstep(0.34, 1.0, r);
  float alpha = max(hole * 0.95, crater * 0.6);
  vec3 col = mix(vec3(0.05, 0.05, 0.06), vec3(0.008), hole);
  float rim = smoothstep(0.15, 0.3, r) * (1.0 - smoothstep(0.3, 0.55, r));
  col += uHeatColor * vHeat * (rim * 1.4 + hole * 0.4);
  alpha = max(alpha, vHeat * rim);
  gl_FragColor = vec4(col, alpha);
  #include <fog_fragment>
}
`;

export class Decals {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;
  readonly ring: RingAllocator;
  readonly attrs: InstancedAttributes;

  constructor(
    capacity: number,
    private readonly rand: () => number = Math.random,
  ) {
    const geometry = createQuadGeometry(false);
    this.attrs = new InstancedAttributes(geometry, capacity, { aPos: 3, aNormal: 3, aParams: 4 });
    this.ring = new RingAllocator(capacity);
    this.material = new THREE.ShaderMaterial({
      name: 'fx:decals',
      vertexShader,
      fragmentShader,
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        {
          uTime: { value: 0 },
          uHeatTime: { value: 1.2 },
          uLift: { value: 0.004 },
          uHeatColor: { value: new THREE.Color(4, 1.3, 0.35) },
        },
      ]),
      fog: true,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -4,
    });
    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.name = 'fx:decals';
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.renderOrder = 1;
  }

  /** 貼一個彈孔（size 為直徑，m；heat 0..1 為剛打上時的高溫光）。回傳槽位。 */
  spawn(time: number, point: Readonly<Vec3Like>, normal: Readonly<Vec3Like>, size: number, heat = 1): number {
    const i = this.ring.next();
    const pos = this.attrs.array('aPos');
    const nor = this.attrs.array('aNormal');
    const par = this.attrs.array('aParams');
    pos[i * 3] = point.x;
    pos[i * 3 + 1] = point.y;
    pos[i * 3 + 2] = point.z;
    nor[i * 3] = normal.x;
    nor[i * 3 + 1] = normal.y;
    nor[i * 3 + 2] = normal.z;
    par[i * 4] = time;
    par[i * 4 + 1] = size * (0.85 + 0.3 * this.rand());
    par[i * 4 + 2] = this.rand() * Math.PI * 2;
    par[i * 4 + 3] = heat;
    this.attrs.touch(i);
    return i;
  }

  update(time: number, heatTime: number, lift: number): void {
    this.attrs.flush();
    const u = this.material.uniforms;
    u.uTime!.value = time;
    u.uHeatTime!.value = heatTime;
    u.uLift!.value = lift;
    (this.mesh.geometry as THREE.InstancedBufferGeometry).instanceCount = this.ring.filled;
    this.mesh.visible = this.ring.filled > 0;
  }

  /** 目前留在場上的彈孔數（≤ 上限）。 */
  get count(): number {
    return this.ring.filled;
  }

  clear(): void {
    this.ring.reset();
    this.mesh.visible = false;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
