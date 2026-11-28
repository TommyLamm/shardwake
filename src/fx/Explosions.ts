// 爆炸球殼（M1-11）：擴散的發光球殼（邊緣亮的 fresnel，開頭有實心閃光），一個 draw call、固定容量。
// 搭配火花、焦痕貼花、世界點光源與鏡頭震動（在 WeaponFx 組合）。
import * as THREE from 'three';
import { GLSL_CULL, InstancedAttributes, writeColor } from '@/fx/instanced';
import { RingAllocator } from '@/fx/ring';
import type { Vec3Like } from '@/physics/Physics';

const vertexShader = /* glsl */ `
attribute vec3 aCenter;
attribute vec4 aParams; // 出生時間、存在時間、半徑、-
attribute vec3 aColor;
uniform float uTime;
varying vec3 vNormal;
varying vec3 vView;
varying float vT;
varying vec3 vColor;
void main() {
  float age = uTime - aParams.x;
  float life = aParams.y;
  if (age < 0.0 || age >= life) { ${GLSL_CULL} }
  float t = age / life;
  float grow = 1.0 - pow(1.0 - t, 3.0);
  float scale = aParams.z * (0.2 + 0.8 * grow);
  vec3 world = aCenter + position * scale;
  vNormal = normal;
  vView = cameraPosition - world;
  vT = t;
  vColor = aColor;
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}
`;

const fragmentShader = /* glsl */ `
varying vec3 vNormal;
varying vec3 vView;
varying float vT;
varying vec3 vColor;
void main() {
  float facing = abs(dot(normalize(vNormal), normalize(vView)));
  float rim = pow(1.0 - facing, 1.6);
  float core = 1.0 - smoothstep(0.0, 0.22, vT);
  float fade = (1.0 - vT) * (1.0 - vT);
  float k = fade * (rim * 1.2 + core * 0.9 + 0.05);
  gl_FragColor = vec4(vColor * k, k);
}
`;

const _c = new THREE.Color();

/** 擴散曲線（與著色器相同）：t 0..1 → 半徑比例。 */
export function explosionScale(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return 0.2 + 0.8 * (1 - Math.pow(1 - x, 3));
}

export class Explosions {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;
  readonly ring: RingAllocator;
  readonly attrs: InstancedAttributes;
  private aliveUntil = -Infinity;

  constructor(capacity: number) {
    const sphere = new THREE.IcosahedronGeometry(1, 3);
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setAttribute('position', sphere.getAttribute('position'));
    geometry.setAttribute('normal', sphere.getAttribute('normal'));
    if (sphere.index) geometry.setIndex(sphere.index);
    geometry.instanceCount = 0;
    this.attrs = new InstancedAttributes(geometry, capacity, { aCenter: 3, aParams: 4, aColor: 3 });
    this.ring = new RingAllocator(capacity);
    this.material = new THREE.ShaderMaterial({
      name: 'fx:explosions',
      vertexShader,
      fragmentShader,
      uniforms: { uTime: { value: 0 } },
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.name = 'fx:explosions';
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.renderOrder = 7;
  }

  spawn(time: number, center: Readonly<Vec3Like>, radius: number, life: number, color: THREE.ColorRepresentation, intensity: number): number {
    const i = this.ring.next();
    const c = this.attrs.array('aCenter');
    const p = this.attrs.array('aParams');
    const col = this.attrs.array('aColor');
    c[i * 3] = center.x;
    c[i * 3 + 1] = center.y;
    c[i * 3 + 2] = center.z;
    p[i * 4] = time;
    p[i * 4 + 1] = life;
    p[i * 4 + 2] = radius;
    _c.set(color);
    writeColor(col, i * 3, _c, intensity);
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
