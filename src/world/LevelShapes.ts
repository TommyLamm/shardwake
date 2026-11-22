// 產生 trimesh 基本體的形狀（輸出 LevelData 可直接使用的 vertices／indices）。
import * as THREE from 'three';

export interface TrimeshData {
  vertices: number[];
  indices: number[];
}

/** 由 ExtrudeGeometry（非索引）取出三角形資料。 */
function extrudeToTrimesh(shape: THREE.Shape, depth: number, curveSegments: number): TrimeshData {
  const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments, steps: 1 });
  geo.translate(0, 0, -depth / 2);
  const pos = geo.getAttribute('position');
  const vertices: number[] = [];
  for (let i = 0; i < pos.count; i++) {
    vertices.push(round(pos.getX(i)), round(pos.getY(i)), round(pos.getZ(i)));
  }
  const indices: number[] = [];
  if (geo.index) for (let i = 0; i < geo.index.count; i++) indices.push(geo.index.getX(i));
  else for (let i = 0; i < pos.count; i++) indices.push(i);
  geo.dispose();
  return { vertices, indices };
}

function round(v: number): number {
  return Math.round(v * 1e4) / 1e4;
}

export interface HalfPipeOptions {
  /** 內弧半徑（公尺）。 */
  radius: number;
  /** 沿 local Z 的長度。 */
  length: number;
  /** 兩側頂端平台寬（公尺）。 */
  lip: number;
  /** 頂端平台比弧頂高多少（公尺）。 */
  lipHeight: number;
  /** 埋進地面的深度（弧底在 y = 0）。 */
  sink: number;
  /** 弧的分段數。 */
  segments: number;
}

export const HALF_PIPE_DEFAULTS: HalfPipeOptions = {
  radius: 5,
  length: 40,
  lip: 1.5,
  lipHeight: 0.5,
  sink: 0.5,
  segments: 16,
};

/**
 * 半管（沿 local Z 延伸）：截面是實心外框挖掉半圓，弧底在 y = 0（與地板齊平），
 * 兩側上緣是寬 lip 的平台。回傳 local 座標的三角形資料。
 */
export function halfPipe(options: Partial<HalfPipeOptions> = {}): TrimeshData {
  const o = { ...HALF_PIPE_DEFAULTS, ...options };
  const r = o.radius;
  const outer = r + o.lip;
  const top = r + o.lipHeight;
  const shape = new THREE.Shape();
  shape.moveTo(-outer, -o.sink);
  shape.lineTo(outer, -o.sink);
  shape.lineTo(outer, top);
  shape.lineTo(r, top);
  shape.lineTo(r, r);
  // 圓心 (0, r)：從右側 (r, r) 順時針經過底部 (0, 0) 到左側 (-r, r)。
  shape.absarc(0, r, r, 0, -Math.PI, true);
  shape.lineTo(-r, top);
  shape.lineTo(-outer, top);
  shape.closePath();
  return extrudeToTrimesh(shape, o.length, o.segments);
}
