// 表面標記：collider handle → 表面資訊。
// 給跑牆（wallRunnable）、抓鉤（grappleable）、腳步聲與命中特效（surface）、命中判定（owner）查詢。
// handle 只在同一個 Rapier 世界內有效；Physics.resetWorld() 會一併清空。

export const SURFACE_TYPES = ['metal', 'grate', 'glass', 'concrete', 'energy', 'hazard'] as const;
export type SurfaceType = (typeof SURFACE_TYPES)[number];

export interface SurfaceInfo {
  /** 可以跑牆（M1-06）。 */
  wallRunnable: boolean;
  /** 可以抓鉤附著（M1-07）。 */
  grappleable: boolean;
  /** 表面材質：腳步聲、命中特效（M1-11、M1-13）。 */
  surface: SurfaceType;
  /** 擁有者：關卡基本體的 id、敵人物件等；命中判定用。 */
  owner: unknown;
}

export const DEFAULT_SURFACE: Readonly<SurfaceInfo> = Object.freeze({
  wallRunnable: false,
  grappleable: false,
  surface: 'metal',
  owner: null,
});

export function isSurfaceType(value: unknown): value is SurfaceType {
  return typeof value === 'string' && (SURFACE_TYPES as readonly string[]).includes(value);
}

export class SurfaceRegistry {
  private readonly map = new Map<number, SurfaceInfo>();

  get size(): number {
    return this.map.size;
  }

  /** 登記（或覆寫）一個 collider 的表面資訊；未給的欄位用預設值。 */
  register(handle: number, info: Partial<SurfaceInfo>): SurfaceInfo {
    const full: SurfaceInfo = {
      wallRunnable: info.wallRunnable ?? DEFAULT_SURFACE.wallRunnable,
      grappleable: info.grappleable ?? DEFAULT_SURFACE.grappleable,
      surface: info.surface ?? DEFAULT_SURFACE.surface,
      owner: info.owner ?? DEFAULT_SURFACE.owner,
    };
    this.map.set(handle, full);
    return full;
  }

  /** 查詢；沒有登記時回傳 undefined。 */
  get(handle: number): SurfaceInfo | undefined {
    return this.map.get(handle);
  }

  /** 查詢；沒有登記時回傳預設表面（不可修改）。 */
  getOrDefault(handle: number): Readonly<SurfaceInfo> {
    return this.map.get(handle) ?? DEFAULT_SURFACE;
  }

  isWallRunnable(handle: number): boolean {
    return this.map.get(handle)?.wallRunnable ?? false;
  }

  isGrappleable(handle: number): boolean {
    return this.map.get(handle)?.grappleable ?? false;
  }

  remove(handle: number): boolean {
    return this.map.delete(handle);
  }

  clear(): void {
    this.map.clear();
  }
}
