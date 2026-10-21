import { NavGrid } from '../bots/nav';
import type { Rng } from '../core/rng';
import { overlaps } from '../physics/aabb';
import { Bvh } from '../physics/bvh';
import { LOS_LIMITS, analyseLayout } from './los-check';
import { type BoxDef, COVER_SLOTS, type MapData, buildMeridianYard } from './map-def';

/**
 * Seeded cover layouts (Tier 2). Each candidate jitters/toggles the authored
 * cover slots, then must pass automatic validation:
 *  - every spawn can still walk to the relay,
 *  - no spawn-to-spawn line of sight,
 *  - covers don't overlap anything and stay in their zone,
 *  - the site keeps at least 3 head-high-or-crouch covers,
 *  - sight lines: few "death spots" on the site, no map-spanning lanes.
 * Falls back to the authored layout if no candidate passes.
 */
export function generateCoverLayout(rng: Rng, attempts = 24): BoxDef[] {
  for (let k = 0; k < attempts; k++) {
    const cand: BoxDef[] = [];
    for (const s of COVER_SLOTS) {
      if (s.optional && rng.float() < 0.3) continue;
      const jx = s.jitter > 0 ? Math.round(rng.range(-s.jitter, s.jitter) * 2) / 2 : 0;
      const jz = s.jitter > 0 ? Math.round(rng.range(-s.jitter, s.jitter) * 2) / 2 : 0;
      cand.push({ ...s, x: s.x + jx, z: s.z + jz });
    }
    const map = buildMeridianYard(cand);
    if (!validateLayout(map, cand)) continue;
    // sight-line check (~0.2 s) only for candidates that passed the cheap checks
    const los = analyseLayout(map);
    if (los.deathSpotFraction <= LOS_LIMITS.maxDeathSpotFraction && los.longestSightline <= LOS_LIMITS.maxSightline && !los.spawnsVisible) return cand;
  }
  return COVER_SLOTS.map((s) => ({ ...s }));
}

export interface LayoutReport {
  ok: boolean;
  problems: string[];
}

export function validateLayout(map: MapData, cover: readonly BoxDef[]): boolean {
  return checkLayout(map, cover).ok;
}

export function checkLayout(map: MapData, cover: readonly BoxDef[]): LayoutReport {
  const problems: string[] = [];
  const bvh = new Bvh(map.colliders);
  const coverIds = new Set<number>();
  const n = map.colliders.length;
  for (let i = n - cover.length; i < n; i++) coverIds.add(map.colliders[i].id);

  // overlap + zone containment
  for (const id of coverIds) {
    const c = map.colliders[id];
    for (const o of map.colliders) {
      if (o.id === id || o.material === 'floor') continue;
      if (overlaps(c, o, 0.01)) {
        problems.push(`cover ${id} overlaps ${o.id}`);
        break;
      }
    }
  }
  for (let i = 0; i < cover.length; i++) {
    const zoneName = (cover[i] as BoxDef & { zone?: string }).zone;
    if (!zoneName) continue;
    const z = map.zones.find((zz) => zz.name === zoneName);
    const c = map.colliders[n - cover.length + i];
    if (z && (c.minX < z.minX || c.maxX > z.maxX || c.minZ < z.minZ || c.maxZ > z.maxZ)) problems.push(`cover ${c.id} leaves ${zoneName}`);
  }

  // reachability
  const nav = new NavGrid(map, bvh);
  const relay = { x: map.relay.x + 3.5, y: 0.3, z: map.relay.z };
  for (const sp of [...map.spawns.attackers.slice(0, 3), ...map.spawns.defenders.slice(0, 3)]) {
    const path = nav.findPath(sp, relay);
    const end = path?.[path.length - 1];
    if (!end || Math.abs(end.x - relay.x) > 1.5 || Math.abs(end.z - relay.z) > 1.5) problems.push(`spawn (${sp.x},${sp.z}) cannot reach the relay`);
  }

  // spawn to spawn sight lines
  for (const a of map.spawns.attackers) {
    for (const d of map.spawns.defenders) {
      const dx = d.x - a.x;
      const dz = d.z - a.z;
      const len = Math.sqrt(dx * dx + dz * dz);
      if (!bvh.raycast(a.x, 1.6, a.z, dx / len, 0, dz / len, len)) problems.push('spawns can see each other');
    }
  }

  // site cover count
  const site = map.siteZone;
  let siteCover = 0;
  for (const id of coverIds) {
    const c = map.colliders[id];
    const cx = (c.minX + c.maxX) / 2;
    const cz = (c.minZ + c.maxZ) / 2;
    if (c.maxY >= 1.05 && c.material !== 'glass' && cx > site.minX - 8 && cx < site.maxX + 8 && cz > site.minZ - 6 && cz < site.maxZ + 6) siteCover++;
  }
  if (siteCover < 3) problems.push(`only ${siteCover} covers around the site`);
  return { ok: problems.length === 0, problems };
}
