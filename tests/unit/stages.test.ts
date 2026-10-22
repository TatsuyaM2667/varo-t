import { describe, expect, it } from 'vitest';
import { NavGrid } from '../../src/sim/bots/nav';
import { LOS_LIMITS, analyseLayout } from '../../src/sim/map/los-check';
import { MAP_IDS, STAGES, buildMap } from '../../src/sim/map/registry';
import { bodyOverlaps } from '../../src/sim/physics/body';
import { Bvh } from '../../src/sim/physics/bvh';

const reach = (nav: NavGrid, from: { x: number; y: number; z: number }, to: { x: number; z: number }, tol = 1.8): boolean => {
  const p = nav.findPath(from, { x: to.x, y: 0, z: to.z });
  const end = p?.[p.length - 1];
  return !!end && Math.hypot(end.x - to.x, end.z - to.z) <= tol;
};

describe.each(STAGES.map((s) => s.map))('stage map %s', (id) => {
  const map = buildMap(id);
  const bvh = new Bvh(map.colliders);
  const nav = new NavGrid(map, bvh);

  it('has enough spawns for a full team and none inside geometry', () => {
    expect(map.spawns.attackers.length).toBeGreaterThanOrEqual(5);
    expect(map.spawns.defenders.length).toBeGreaterThanOrEqual(8);
    for (const sp of [...map.spawns.attackers, ...map.spawns.defenders]) {
      expect(bodyOverlaps(bvh, { x: sp.x, y: sp.y + 0.01, z: sp.z, radius: 0.3, height: 1.8 }), `${sp.x},${sp.z}`).toBe(false);
    }
  });

  it('every spawn can walk to the relay', () => {
    const goal = { x: map.relay.x + 2.5, z: map.relay.z - 2 };
    for (const sp of [...map.spawns.attackers.slice(0, 5), ...map.spawns.defenders.slice(0, 5)]) {
      expect(reach(nav, sp, goal), `spawn ${sp.x},${sp.z}`).toBe(true);
    }
  });

  it('defender posts are reachable from the defender spawn', () => {
    expect(map.tactics.posts.filter((p) => !p.forward).length).toBeGreaterThanOrEqual(5);
    expect(map.tactics.posts.filter((p) => p.forward).length).toBeGreaterThanOrEqual(2);
    const sp = map.spawns.defenders[0];
    for (const p of map.tactics.posts) expect(reach(nav, sp, p, 1.5), `post ${p.x},${p.z}`).toBe(true);
  });

  it('attack routes are walkable from the attacker spawn', () => {
    expect(map.tactics.routes.length).toBe(3);
    const sp = map.spawns.attackers[0];
    for (const r of map.tactics.routes) for (const w of r.waypoints) expect(reach(nav, sp, w, 2), `waypoint ${w.x},${w.z}`).toBe(true);
  });

  it('passes sight-line validation', () => {
    const r = analyseLayout(map);
    expect(r.spawnsVisible).toBe(false);
    expect(r.deathSpotFraction).toBeLessThanOrEqual(LOS_LIMITS.maxDeathSpotFraction);
  });
});

it('registry builds every map', () => {
  for (const id of MAP_IDS) expect(buildMap(id).colliders.length).toBeGreaterThan(10);
});
