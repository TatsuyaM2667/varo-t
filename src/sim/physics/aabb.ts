export interface AABB {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

/** Surface tag used by gameplay (footstep sound, penetration) and rendering. */
export type MaterialTag = 'floor' | 'wall' | 'crate' | 'metal' | 'concrete' | 'site' | 'glass' | 'wood';

export interface Collider extends AABB {
  id: number;
  material: MaterialTag;
  /** hit points when destructible (Tier 2), undefined = indestructible */
  breakHp?: number;
}

export function aabb(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): AABB {
  return { minX, minY, minZ, maxX, maxY, maxZ };
}

export function overlaps(a: AABB, b: AABB, eps = 0): boolean {
  return (
    a.maxX > b.minX + eps &&
    a.minX < b.maxX - eps &&
    a.maxY > b.minY + eps &&
    a.minY < b.maxY - eps &&
    a.maxZ > b.minZ + eps &&
    a.minZ < b.maxZ - eps
  );
}

export function containsPoint(a: AABB, x: number, y: number, z: number): boolean {
  return x > a.minX && x < a.maxX && y > a.minY && y < a.maxY && z > a.minZ && z < a.maxZ;
}

/**
 * Slab test. Returns entry distance t in [0, maxT] or -1 on miss. A ray that
 * starts inside the box reports t = 0.
 */
export function rayAABB(
  ox: number,
  oy: number,
  oz: number,
  idx: number,
  idy: number,
  idz: number,
  b: AABB,
  maxT: number,
): number {
  let t1 = (b.minX - ox) * idx;
  let t2 = (b.maxX - ox) * idx;
  let tmin = Math.min(t1, t2);
  let tmax = Math.max(t1, t2);
  t1 = (b.minY - oy) * idy;
  t2 = (b.maxY - oy) * idy;
  tmin = Math.max(tmin, Math.min(t1, t2));
  tmax = Math.min(tmax, Math.max(t1, t2));
  t1 = (b.minZ - oz) * idz;
  t2 = (b.maxZ - oz) * idz;
  tmin = Math.max(tmin, Math.min(t1, t2));
  tmax = Math.min(tmax, Math.max(t1, t2));
  if (tmax < Math.max(tmin, 0) || tmin > maxT) return -1;
  return tmin < 0 ? 0 : tmin;
}

/** 1/d that stays finite-signed for axis-parallel rays (avoids NaN from 0 * Infinity). */
export function safeInv(d: number): number {
  if (d === 0) return 1e30;
  return 1 / d;
}
