import type { AABB, Collider } from './aabb';
import type { Bvh } from './bvh';

/**
 * Kinematic axis-aligned box body (feet at `y`). Movement is swept one axis at
 * a time against the static world, so it can never tunnel through geometry
 * regardless of speed, and is fully deterministic.
 */
export interface Body {
  x: number;
  y: number;
  z: number;
  /** Half width on X and Z. */
  radius: number;
  height: number;
}

export interface MoveResult {
  hitX: boolean;
  hitY: boolean;
  hitZ: boolean;
  /** Collided while moving down (standing on something). */
  landed: boolean;
}

const EPS = 1e-7;
const scratch: Collider[] = [];
const q: AABB = { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 };

function bodyBox(b: Body, out: AABB): AABB {
  out.minX = b.x - b.radius;
  out.maxX = b.x + b.radius;
  out.minY = b.y;
  out.maxY = b.y + b.height;
  out.minZ = b.z - b.radius;
  out.maxZ = b.z + b.radius;
  return out;
}

/** Sweep along a single axis; returns the distance actually travelled. */
export function sweepAxis(world: Bvh, b: Body, axis: 0 | 1 | 2, d: number): number {
  if (d === 0) return 0;
  bodyBox(b, q);
  // Expand query by the sweep
  if (axis === 0) {
    if (d > 0) q.maxX += d;
    else q.minX += d;
  } else if (axis === 1) {
    if (d > 0) q.maxY += d;
    else q.minY += d;
  } else if (d > 0) q.maxZ += d;
  else q.minZ += d;
  world.query(q, scratch);

  const minX = b.x - b.radius;
  const maxX = b.x + b.radius;
  const minY = b.y;
  const maxY = b.y + b.height;
  const minZ = b.z - b.radius;
  const maxZ = b.z + b.radius;
  let allowed = d;
  for (let i = 0; i < scratch.length; i++) {
    const c = scratch[i];
    if (axis === 0) {
      if (!(c.maxY > minY + EPS && c.minY < maxY - EPS && c.maxZ > minZ + EPS && c.minZ < maxZ - EPS)) continue;
      if (d > 0 && c.minX >= maxX - EPS) allowed = Math.min(allowed, c.minX - maxX);
      else if (d < 0 && c.maxX <= minX + EPS) allowed = Math.max(allowed, c.maxX - minX);
    } else if (axis === 1) {
      if (!(c.maxX > minX + EPS && c.minX < maxX - EPS && c.maxZ > minZ + EPS && c.minZ < maxZ - EPS)) continue;
      if (d > 0 && c.minY >= maxY - EPS) allowed = Math.min(allowed, c.minY - maxY);
      else if (d < 0 && c.maxY <= minY + EPS) allowed = Math.max(allowed, c.maxY - minY);
    } else {
      if (!(c.maxX > minX + EPS && c.minX < maxX - EPS && c.maxY > minY + EPS && c.minY < maxY - EPS)) continue;
      if (d > 0 && c.minZ >= maxZ - EPS) allowed = Math.min(allowed, c.minZ - maxZ);
      else if (d < 0 && c.maxZ <= minZ + EPS) allowed = Math.max(allowed, c.maxZ - minZ);
    }
  }
  // Never move backwards because of float noise on touching faces.
  if (d > 0) allowed = Math.max(0, allowed);
  else allowed = Math.min(0, allowed);
  if (axis === 0) b.x += allowed;
  else if (axis === 1) b.y += allowed;
  else b.z += allowed;
  return allowed;
}

/**
 * Move with collision, stepping up ledges of at most `stepHeight` when
 * `grounded`. Horizontal motion is resolved X then Z.
 */
export function moveBody(world: Bvh, b: Body, dx: number, dy: number, dz: number, grounded: boolean, stepHeight: number): MoveResult {
  const res: MoveResult = { hitX: false, hitY: false, hitZ: false, landed: false };
  const sx = b.x;
  const sy = b.y;
  const sz = b.z;

  const mx = sweepAxis(world, b, 0, dx);
  const mz = sweepAxis(world, b, 2, dz);
  const blockedX = Math.abs(mx - dx) > 1e-9;
  const blockedZ = Math.abs(mz - dz) > 1e-9;

  if (grounded && stepHeight > 0 && (blockedX || blockedZ)) {
    // Try the step-up path from the start position, keep it if it went further.
    const flat = { x: b.x, y: b.y, z: b.z };
    b.x = sx;
    b.y = sy;
    b.z = sz;
    const up = sweepAxis(world, b, 1, stepHeight);
    const sx2 = sweepAxis(world, b, 0, dx);
    const sz2 = sweepAxis(world, b, 2, dz);
    const down = sweepAxis(world, b, 1, -up);
    const flatDist = (flat.x - sx) ** 2 + (flat.z - sz) ** 2;
    const stepDist = sx2 * sx2 + sz2 * sz2;
    // Only accept if we ended on top of something (down sweep was blocked).
    if (stepDist > flatDist + 1e-9 && Math.abs(down + up) > 1e-9) {
      res.hitX = Math.abs(sx2 - dx) > 1e-9;
      res.hitZ = Math.abs(sz2 - dz) > 1e-9;
    } else {
      b.x = flat.x;
      b.y = flat.y;
      b.z = flat.z;
      res.hitX = blockedX;
      res.hitZ = blockedZ;
    }
  } else {
    res.hitX = blockedX;
    res.hitZ = blockedZ;
  }

  const my = sweepAxis(world, b, 1, dy);
  if (Math.abs(my - dy) > 1e-9) {
    res.hitY = true;
    if (dy < 0) res.landed = true;
  }
  return res;
}

/** True if the body overlaps any collider (e.g. to test whether standing up fits). */
export function bodyOverlaps(world: Bvh, b: Body): boolean {
  bodyBox(b, q);
  world.query(q, scratch);
  for (let i = 0; i < scratch.length; i++) {
    const c = scratch[i];
    if (
      c.maxX > q.minX + EPS &&
      c.minX < q.maxX - EPS &&
      c.maxY > q.minY + EPS &&
      c.minY < q.maxY - EPS &&
      c.maxZ > q.minZ + EPS &&
      c.minZ < q.maxZ - EPS
    ) {
      return true;
    }
  }
  return false;
}
