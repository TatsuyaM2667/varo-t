import { HITBOX } from '../../config/weapons';
import { type AABB, type Collider, rayAABB, safeInv } from '../physics/aabb';
import type { Bvh } from '../physics/bvh';
import type { HitZone } from '../events';
import type { Agent } from './agent';

export interface Hitboxes {
  head: AABB;
  body: AABB;
  legs: AABB;
}

/** Axis-aligned hitboxes derived from the agent's current height (crouch shrinks them). */
export function hitboxesOf(a: Agent, out?: Hitboxes): Hitboxes {
  const h = a.height;
  const legsTop = a.y + h * HITBOX.legsTop;
  const headBottom = a.y + h - HITBOX.headSize;
  const o = out ?? { head: box(), body: box(), legs: box() };
  setBox(o.head, a.x, a.z, HITBOX.headHalfWidth, headBottom, a.y + h);
  setBox(o.body, a.x, a.z, HITBOX.bodyHalfWidth, legsTop, headBottom);
  setBox(o.legs, a.x, a.z, HITBOX.legsHalfWidth, a.y, legsTop);
  return o;
}

function box(): AABB {
  return { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 };
}

function setBox(b: AABB, x: number, z: number, hw: number, y0: number, y1: number): void {
  b.minX = x - hw;
  b.maxX = x + hw;
  b.minZ = z - hw;
  b.maxZ = z + hw;
  b.minY = y0;
  b.maxY = y1;
}

export interface RayHit {
  t: number;
  agent: Agent | null;
  zone: HitZone | null;
  collider: Collider | null;
}

const scratchBoxes: Hitboxes = { head: box(), body: box(), legs: box() };

/**
 * Nearest hit along a ray among world geometry and agent hitboxes (skipping
 * `ignore`). `dir` must be normalised; `t` is in metres.
 */
export function traceShot(
  bvh: Bvh,
  agents: readonly Agent[],
  ignore: Agent,
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  maxDist: number,
): RayHit {
  const wh = bvh.raycast(ox, oy, oz, dx, dy, dz, maxDist);
  let best: RayHit = { t: wh ? wh.t : maxDist, agent: null, zone: null, collider: wh ? wh.collider : null };
  const idx = safeInv(dx);
  const idy = safeInv(dy);
  const idz = safeInv(dz);
  for (const a of agents) {
    if (a === ignore || !a.alive) continue;
    const hb = hitboxesOf(a, scratchBoxes);
    // head first so a shot grazing both counts as the head at equal t
    for (const zone of ['head', 'body', 'legs'] as const) {
      const t = rayAABB(ox, oy, oz, idx, idy, idz, hb[zone], best.t);
      if (t >= 0 && t < best.t) best = { t, agent: a, zone, collider: null };
    }
  }
  return best;
}

/** Outward normal of the box face nearest to a point on its surface. */
export function faceNormal(c: AABB, x: number, y: number, z: number): [number, number, number] {
  const d = [x - c.minX, c.maxX - x, y - c.minY, c.maxY - y, z - c.minZ, c.maxZ - z];
  let k = 0;
  for (let i = 1; i < 6; i++) if (d[i] < d[k]) k = i;
  return [
    [-1, 0, 0],
    [1, 0, 0],
    [0, -1, 0],
    [0, 1, 0],
    [0, 0, -1],
    [0, 0, 1],
  ][k] as [number, number, number];
}
