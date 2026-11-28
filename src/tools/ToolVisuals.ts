// 調校工具的 3D 顯示（M1-15）：計時賽的環形檢查點、錄影重播的鬼影路徑與鬼影標記。
// 材質不受色調映射影響（發光主色、Bloom 可見），建構時加入著色器預熱清單（main.ts 註冊）。
import * as THREE from 'three';
import { SystemOrder, type GameSystem } from '@/core/Game';
import type { ReplaySystem } from '@/tools/Replay';
import type { CourseDef, TimeTrialSystem } from '@/tools/TimeTrial';

export const TOOL_VISUAL_STYLE = {
  /** 環：起點、終點、下一個、其他、已通過。 */
  startColor: 0x5cffb0,
  finishColor: 0xffd24a,
  nextColor: 0x3ff6ff,
  idleColor: 0x2f7fa0,
  passedColor: 0x405060,
  ringTube: 0.12,
  /** 發光倍率（> 1 會被 Bloom 抓到）。 */
  glow: 2.2,
  ghostColor: 0x3ff6ff,
  newPathColor: 0xff9a3c,
  pathOpacity: 0.85,
  ghostRadius: 0.35,
};

/** 環的朝向：法線沿前一個 → 這一個（起點用起點 → 下一個）的水平方向。 */
export function ringYaw(course: Readonly<CourseDef>, index: number): number {
  const g = course.gates;
  const a = g[Math.max(0, index - 1)]!.center;
  const b = g[index === 0 ? Math.min(1, g.length - 1) : index]!.center;
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  return Math.atan2(dx, dz);
}

export class CourseRings implements GameSystem {
  readonly name = 'courseRings';
  readonly order = SystemOrder.fx;
  readonly root = new THREE.Group();
  readonly materials: Record<'start' | 'finish' | 'next' | 'idle' | 'passed', THREE.MeshBasicMaterial>;
  private meshes: THREE.Mesh[] = [];
  private builtFor: CourseDef | null = null;
  private geometryCache = new Map<number, THREE.TorusGeometry>();
  private lastKey = '';

  constructor(
    scene: THREE.Object3D,
    private readonly trial: TimeTrialSystem,
  ) {
    const s = TOOL_VISUAL_STYLE;
    const mat = (color: number, opacity: number): THREE.MeshBasicMaterial => {
      const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(s.glow), transparent: true, opacity, toneMapped: false, depthWrite: false });
      m.side = THREE.DoubleSide;
      return m;
    };
    this.materials = {
      start: mat(s.startColor, 0.95),
      finish: mat(s.finishColor, 0.95),
      next: mat(s.nextColor, 0.95),
      idle: mat(s.idleColor, 0.55),
      passed: mat(s.passedColor, 0.3),
    };
    this.root.name = 'courseRings';
    scene.add(this.root);
  }

  render(): void {
    const course = this.trial.course;
    if (course !== this.builtFor) this.rebuild(course);
    const run = this.trial.run;
    if (!course || !run) return;
    const key = `${run.phase}:${run.next}`;
    if (key === this.lastKey) return;
    this.lastKey = key;
    const last = course.gates.length - 1;
    this.meshes.forEach((m, i) => {
      let mat = this.materials.idle;
      if (run.phase === 'running') {
        if (i < run.next) mat = this.materials.passed;
        else if (i === run.next) mat = i === last ? this.materials.finish : this.materials.next;
        else if (i === last) mat = this.materials.finish;
      } else {
        mat = i === 0 ? this.materials.start : i === last ? this.materials.finish : this.materials.idle;
      }
      m.material = mat;
    });
  }

  dispose(): void {
    this.rebuild(null);
    for (const g of this.geometryCache.values()) g.dispose();
    this.geometryCache.clear();
    for (const m of Object.values(this.materials)) m.dispose();
    this.root.removeFromParent();
  }

  private rebuild(course: CourseDef | null): void {
    for (const m of this.meshes) m.removeFromParent();
    this.meshes = [];
    this.builtFor = course;
    this.lastKey = '';
    if (!course) return;
    course.gates.forEach((g, i) => {
      const r = Math.round(g.radius * 100) / 100;
      let geo = this.geometryCache.get(r);
      if (!geo) {
        geo = new THREE.TorusGeometry(r, TOOL_VISUAL_STYLE.ringTube, 10, 64);
        this.geometryCache.set(r, geo);
      }
      const mesh = new THREE.Mesh(geo, this.materials.idle);
      mesh.position.set(g.center.x, g.center.y, g.center.z);
      // TorusGeometry 在 XY 平面（法線 +Z）；轉到行進方向。
      mesh.rotation.set(0, ringYaw(course, i), 0);
      mesh.name = `ring:${g.id}`;
      this.root.add(mesh);
      this.meshes.push(mesh);
    });
  }
}

/** 鬼影：原始路徑（青）、新路徑（橘）、原始路徑上對應目前步數的標記球。 */
export class GhostPaths implements GameSystem {
  readonly name = 'ghostPaths';
  readonly order = SystemOrder.fx;
  readonly root = new THREE.Group();
  readonly originalMaterial: THREE.LineBasicMaterial;
  readonly newMaterial: THREE.LineBasicMaterial;
  readonly markerMaterial: THREE.MeshBasicMaterial;
  private readonly original: THREE.Line;
  private readonly fresh: THREE.Line;
  private readonly marker: THREE.Mesh;
  private revision = -1;
  private originalCount = -1;
  private originalSource: number[] | null = null;

  constructor(
    scene: THREE.Object3D,
    private readonly replay: ReplaySystem,
  ) {
    const s = TOOL_VISUAL_STYLE;
    const lineMat = (color: number): THREE.LineBasicMaterial =>
      new THREE.LineBasicMaterial({ color: new THREE.Color(color).multiplyScalar(s.glow), transparent: true, opacity: s.pathOpacity, toneMapped: false, depthWrite: false });
    this.originalMaterial = lineMat(s.ghostColor);
    this.newMaterial = lineMat(s.newPathColor);
    this.markerMaterial = new THREE.MeshBasicMaterial({ color: new THREE.Color(s.ghostColor).multiplyScalar(s.glow), transparent: true, opacity: 0.6, toneMapped: false, depthWrite: false });
    this.original = new THREE.Line(new THREE.BufferGeometry(), this.originalMaterial);
    this.fresh = new THREE.Line(new THREE.BufferGeometry(), this.newMaterial);
    this.marker = new THREE.Mesh(new THREE.SphereGeometry(s.ghostRadius, 16, 12), this.markerMaterial);
    // 先放一個（全為 0 的）位置屬性：空的幾何在預熱或剔除時算出 NaN 的包圍球。
    setLine(this.original, [], 0);
    setLine(this.fresh, [], 0);
    for (const o of [this.original, this.fresh, this.marker]) {
      o.frustumCulled = false;
      o.renderOrder = 10;
      this.root.add(o);
    }
    this.root.name = 'ghostPaths';
    this.root.visible = false;
    scene.add(this.root);
  }

  render(): void {
    const r = this.replay;
    const clip = r.clip;
    const visible = r.ghostVisible && clip !== null;
    this.root.visible = visible;
    if (!visible || !clip) return;
    if (clip.path.points !== this.originalSource || clip.path.points.length !== this.originalCount) {
      this.originalSource = clip.path.points;
      this.originalCount = clip.path.points.length;
      setLine(this.original, clip.path.points, clip.path.points.length);
    }
    if (r.revision !== this.revision) {
      this.revision = r.revision;
      setLine(this.fresh, r.newPath, r.newPath.length);
    }
    const i = r.ghostIndex * 3;
    const pts = clip.path.points;
    if (i + 2 < pts.length) this.marker.position.set(pts[i]!, pts[i + 1]! + 0.9, pts[i + 2]!);
    this.marker.visible = r.replaying;
  }

  dispose(): void {
    this.original.geometry.dispose();
    this.fresh.geometry.dispose();
    this.marker.geometry.dispose();
    this.originalMaterial.dispose();
    this.newMaterial.dispose();
    this.markerMaterial.dispose();
    this.root.removeFromParent();
  }
}

/** 把腳底路徑寫成線段（抬高 0.1 m，不被地面遮住）；容量不足時換新的屬性。 */
function setLine(line: THREE.Line, points: readonly number[], length: number): void {
  const geo = line.geometry;
  let attr = geo.getAttribute('position') as THREE.BufferAttribute | undefined;
  if (!attr || attr.array.length < length) {
    // 容量必須是 3 的倍數：three 的 count = array.length / itemSize 不取整，否則包圍球讀到陣列外（NaN）。
    const cap = Math.ceil(Math.max(256, length * 1.5) / 3) * 3;
    attr = new THREE.BufferAttribute(new Float32Array(cap), 3);
    attr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', attr);
  }
  const arr = attr.array as Float32Array;
  for (let i = 0; i < length; i += 3) {
    arr[i] = points[i]!;
    arr[i + 1] = points[i + 1]! + 0.1;
    arr[i + 2] = points[i + 2]!;
  }
  attr.needsUpdate = true;
  geo.setDrawRange(0, length / 3);
}
