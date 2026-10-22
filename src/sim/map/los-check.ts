import { cos, sin } from '../core/fmath';
import { NavGrid } from '../bots/nav';
import { Bvh } from '../physics/bvh';
import type { MapData } from './map-def';

/**
 * Sight-line analysis of a layout (used by tests and tools/validate-map.ts):
 *  - exposure: for each walkable point on/around the site, from how many
 *    distinct threat positions (defender posts) it can be seen;
 *  - cover: every cover box has at least one walkable point behind it that
 *    is hidden from its zone's main threat;
 *  - longest sightline across the walkable area;
 *  - spawn-to-spawn visibility.
 */
export interface LosReport {
  sitePoints: number;
  /**
   * fraction of site points where no walkable spot within 3 m hides you from
   * at least half of the defender posts (i.e. no usable cover nearby)
   */
  deathSpotFraction: number;
  maxExposure: number;
  coversWithoutSafeSpot: number[];
  longestSightline: number;
  spawnsVisible: boolean;
}

const EYE = 1.64;

function dist2d(x: number, z: number): number {
  return Math.sqrt(x * x + z * z);
}

function visible(bvh: Bvh, ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (d < 1e-6) return true;
  return !bvh.raycast(ax, ay, az, dx / d, dy / d, dz / d, d, (c) => c.material !== 'glass');
}

export function analyseLayout(map: MapData): LosReport {
  const bvh = new Bvh(map.colliders);
  const nav = new NavGrid(map, bvh);
  const posts = map.tactics.posts.filter((p) => !p.forward);
  const site = map.siteZone;

  // exposure on (and around) the site, where attackers fight to capture
  const exposure = new Map<number, number>();
  const exposureAt = (i: number): number => {
    let e = exposure.get(i);
    if (e !== undefined) return e;
    const c = nav.centre(i);
    e = 0;
    for (const p of posts) {
      const pi = nav.nearestWalkable(p.x, p.z);
      const py = pi >= 0 ? nav.height[pi] : 0;
      // crouched attacker (chest at 0.9 m) can use low cover
      if (visible(bvh, p.x, py + EYE, p.z, c.x, c.y + 0.9, c.z)) e++;
    }
    exposure.set(i, e);
    return e;
  };
  let sitePoints = 0;
  let death = 0;
  let maxExposure = 0;
  const half = Math.ceil(posts.length / 2);
  for (let z = site.minZ + 0.5; z < site.maxZ; z += 1) {
    for (let x = site.minX + 0.5; x < site.maxX; x += 1) {
      const i = nav.index(x, z);
      if (!nav.walkable(i)) continue;
      sitePoints++;
      maxExposure = Math.max(maxExposure, exposureAt(i));
      let safest = Infinity;
      for (let dz = -3; dz <= 3; dz++) {
        for (let dx = -3; dx <= 3; dx++) {
          if (dx * dx + dz * dz > 9) continue;
          const j = nav.index(x + dx, z + dz);
          if (!nav.walkable(j)) continue;
          safest = Math.min(safest, exposureAt(j));
        }
      }
      if (safest > half) death++;
    }
  }

  // cover: a hidden walkable point within 1.5 m behind each cover box
  const coversWithoutSafeSpot: number[] = [];
  for (const c of map.colliders) {
    if (c.material !== 'crate' && c.material !== 'wood') continue;
    const cx = (c.minX + c.maxX) / 2;
    const cz = (c.minZ + c.maxZ) / 2;
    // threat = nearest defender post (on site) or the route waypoint ahead (lanes)
    let tx = 0;
    let tz = 0;
    let best = Infinity;
    for (const p of posts) {
      const d = dist2d(p.x - cx, p.z - cz);
      if (d < best && d > 3) {
        best = d;
        tx = p.x;
        tz = p.z;
      }
    }
    for (const r of map.tactics.routes) {
      for (const w of r.waypoints) {
        const d = dist2d(w.x - cx, w.z - cz);
        if (d < best && d > 3) {
          best = d;
          tx = w.x;
          tz = w.z;
        }
      }
    }
    let safe = false;
    for (let dz = -2.5; dz <= 2.5 && !safe; dz += 0.5) {
      for (let dx = -2.5; dx <= 2.5 && !safe; dx += 0.5) {
        const x = cx + dx;
        const z = cz + dz;
        const i = nav.index(x, z);
        if (!nav.walkable(i)) continue;
        const y = nav.height[i];
        const h = c.maxY - c.minY >= 1.5 ? 1.5 : 0.9; // crouch behind low cover
        if (!visible(bvh, tx, EYE, tz, x, y + h, z)) safe = true;
      }
    }
    if (!safe) coversWithoutSafeSpot.push(c.id);
  }

  // longest sightline: sample walkable points on a coarse grid, cast 16 rays each
  let longest = 0;
  for (let i = 0; i < nav.height.length; i += 7) {
    if (!nav.walkable(i)) continue;
    const p = nav.centre(i);
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      const hit = bvh.raycast(p.x, p.y + EYE, p.z, sin(a), 0, cos(a), 200);
      if (hit) longest = Math.max(longest, hit.t);
    }
  }

  let spawnsVisible = false;
  for (const a of map.spawns.attackers) for (const d of map.spawns.defenders) if (visible(bvh, a.x, EYE, a.z, d.x, EYE, d.z)) spawnsVisible = true;

  return {
    sitePoints,
    deathSpotFraction: sitePoints ? death / sitePoints : 0,
    maxExposure,
    coversWithoutSafeSpot,
    longestSightline: longest,
    spawnsVisible,
  };
}

/** Acceptance thresholds for a layout. */
export const LOS_LIMITS = {
  maxDeathSpotFraction: 0.35,
  /** the sniper's longest lane (Long) is intentional; cap it so it never spans the whole map */
  maxSightline: 85,
};
