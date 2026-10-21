import { describe, expect, it } from 'vitest';
import { buildMeridianYard, zoneAt } from '../../src/sim/map/map-def';
import { Bvh } from '../../src/sim/physics/bvh';
import { bodyOverlaps } from '../../src/sim/physics/body';

describe('Meridian Yard', () => {
  const map = buildMeridianYard();
  const bvh = new Bvh(map.colliders);

  it('has well-formed colliders with unique ids', () => {
    const ids = new Set<number>();
    for (const c of map.colliders) {
      expect(c.maxX).toBeGreaterThan(c.minX);
      expect(c.maxY).toBeGreaterThan(c.minY);
      expect(c.maxZ).toBeGreaterThan(c.minZ);
      ids.add(c.id);
    }
    expect(ids.size).toBe(map.colliders.length);
    expect(map.colliders.length).toBeLessThan(150);
  });

  it('spawns are inside the map and not inside geometry', () => {
    for (const sp of [...map.spawns.attackers, ...map.spawns.defenders]) {
      expect(bodyOverlaps(bvh, { x: sp.x, y: sp.y, z: sp.z, radius: 0.3, height: 1.8 })).toBe(false);
    }
  });

  it('relay sits inside the site zone', () => {
    expect(zoneAt(map, map.relay.x, map.relay.z)).toBe('A Site');
    const s = map.siteZone;
    expect(map.relay.x).toBeGreaterThan(s.minX);
    expect(map.relay.x).toBeLessThan(s.maxX);
  });

  it('callouts resolve for key locations', () => {
    expect(zoneAt(map, 0, -42)).toBe('Attacker Spawn');
    expect(zoneAt(map, -27, 0)).toBe('Long');
    expect(zoneAt(map, 0, -10)).toBe('Mid');
    expect(zoneAt(map, 26, 0)).toBe('Short');
    expect(zoneAt(map, 0, 42)).toBe('Defender Spawn');
  });
});
