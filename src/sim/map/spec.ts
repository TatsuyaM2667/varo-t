import type { Entrance, Post, Route, Tactics } from '../bots/tactics';
import type { Collider, MaterialTag } from '../physics/aabb';
import { type CellRect, type FloorKind, type MapData, type MapProp, type SpawnPoint, type Zone, mergeSolidCells } from './map-def';

/**
 * Stage maps are authored as ASCII grids (one character = one 2 m cell,
 * row 0 = north / defender side). Legend:
 *
 *  geometry  #  wall            H  tall building wall     ' ' void (solid)
 *            .  floor           ,  street floor (cobble)  :  tiled floor
 *            0-9 floor at that level (0.4 m per level; ±1 is a walkable step).
 *               Plain floor takes its zone's `level`, so terraces are zones.
 *            ^  archway (floor with a lintel overhead)     r  roofed floor (indoors)
 *  cover     c  crate 1.2 m     C  crate 2.4 m            w  wooden crate (breakable)
 *            b  low wall (x)    B  low wall (z)           p  pillar
 *            t  planter + tree  o  barrels                 m  market stall
 *            g  glass pane (x)  G  glass pane (z)
 *  markers   A  attacker spawn  D  defender spawn         S  site (capture area)
 *            R  relay (on site) P  site post              F  forward post
 *            E  site entrance   x y z  attack route waypoints (south → north)
 *
 * Markers and cover inherit the floor height of their neighbours, so a post
 * or crate can sit on a balcony.
 */
export interface ZoneSpec {
  name: string;
  c0: number;
  c1: number;
  r0: number;
  r1: number;
  /** wall tint for walls nearest to this zone */
  wall: string;
  floor: string;
  floorKind?: FloorKind;
  /** floor level (×0.4 m) of plain floor cells in this zone */
  level?: number;
}

export interface MapSpec {
  id: string;
  name: string;
  theme: string;
  wallHeight: number;
  buildingHeight: number;
  roundTime: number;
  rows: string[];
  zones: ZoneSpec[];
  defaultWall: string;
  defaultFloor: string;
}

const CELL = 2;
const LEVEL = 0.4;
const LINTEL_Y = 3.4;
const ROOF_Y = 3.8;

const WALKABLE_MARKERS = 'ADSRPFExyz';
const COVER = 'cCwbBptomgG';

export function buildFromSpec(spec: MapSpec): MapData {
  const H = spec.rows.length;
  const W = Math.max(...spec.rows.map((r) => r.length));
  const grid = spec.rows.map((r) => r.padEnd(W, ' '));
  const minX = -(W * CELL) / 2;
  const maxZ = (H * CELL) / 2;
  const cx = (c: number): number => minX + (c + 0.5) * CELL;
  const cz = (r: number): number => maxZ - (r + 0.5) * CELL;
  const ch = (c: number, r: number): string => (r < 0 || r >= H || c < 0 || c >= W ? ' ' : grid[r][c]);
  const isSolid = (k: string): boolean => k === '#' || k === 'H' || k === ' ';
  const levelOf = (k: string): number => (k >= '0' && k <= '9' ? k.charCodeAt(0) - 48 : -1);

  // nearest zone for every cell (multi-source BFS), used for tints, levels and callouts
  const zoneIdx: number[][] = grid.map((row) => [...row].map(() => -1));
  const queue: [number, number][] = [];
  spec.zones.forEach((z, i) => {
    for (let r = z.r0; r <= z.r1; r++)
      for (let c = z.c0; c <= z.c1; c++) {
        if (r < 0 || r >= H || c < 0 || c >= W || zoneIdx[r][c] >= 0) continue;
        zoneIdx[r][c] = i;
        queue.push([c, r]);
      }
  });
  for (let q = 0; q < queue.length; q++) {
    const [c, r] = queue[q];
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nc = c + dc;
      const nr = r + dr;
      if (nr < 0 || nr >= H || nc < 0 || nc >= W || zoneIdx[nr][nc] >= 0) continue;
      zoneIdx[nr][nc] = zoneIdx[r][c];
      queue.push([nc, nr]);
    }
  }
  const wallTint = (c: number, r: number): string => (zoneIdx[r][c] >= 0 ? spec.zones[zoneIdx[r][c]].wall : spec.defaultWall);
  const floorTint = (c: number, r: number): string => (zoneIdx[r][c] >= 0 ? spec.zones[zoneIdx[r][c]].floor : spec.defaultFloor);
  const zoneLevel = (c: number, r: number): number => (zoneIdx[r][c] >= 0 ? (spec.zones[zoneIdx[r][c]].level ?? 0) : 0);

  // floor level per cell: explicit digit > (markers/cover: neighbouring digits) > zone level
  const level: number[][] = grid.map((row, r) => [...row].map((k, c) => (isSolid(k) ? 0 : levelOf(k) >= 0 ? levelOf(k) : zoneLevel(c, r))));
  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      const k = grid[r][c];
      if (!WALKABLE_MARKERS.includes(k) && !COVER.includes(k) && k !== '^') continue;
      const counts = new Map<number, number>();
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const l = levelOf(ch(c + dc, r + dr));
        if (l >= 0) counts.set(l, (counts.get(l) ?? 0) + 1);
      }
      let best = -1;
      let bestN = 0;
      for (const [l, n] of counts) if (n > bestN || (n === bestN && l > best)) [best, bestN] = [l, n];
      if (best >= 0) level[r][c] = best;
    }
  }

  const colliders: Collider[] = [];
  let id = 0;
  const push = (b: Omit<Collider, 'id'>): Collider => {
    const col = { ...b, id: id++ } as Collider;
    colliders.push(col);
    return col;
  };
  const rectBox = (rc: CellRect): { minX: number; maxX: number; minZ: number; maxZ: number } => ({
    minX: minX + rc.c0 * CELL,
    maxX: minX + (rc.c1 + 1) * CELL,
    minZ: maxZ - (rc.r1 + 1) * CELL,
    maxZ: maxZ - rc.r0 * CELL,
  });
  const bounds = { minX, maxX: -minX, minZ: -maxZ, maxZ };
  push({ material: 'floor', minX: bounds.minX, maxX: bounds.maxX, minY: -1, maxY: 0, minZ: bounds.minZ, maxZ: bounds.maxZ, tint: spec.defaultFloor });

  // walls, merged per (height class, zone) so each keeps its zone tint
  const keys = new Set<string>();
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) if (isSolid(grid[r][c])) keys.add(`${grid[r][c] === 'H' ? 'H' : '#'}|${zoneIdx[r][c]}`);
  for (const key of keys) {
    const [kind, zi] = key.split('|');
    const mask = grid.map((row, r) => [...row].map((k, c) => isSolid(k) && (k === 'H' ? 'H' : '#') === kind && String(zoneIdx[r][c]) === zi));
    for (const rc of mergeSolidCells(mask)) {
      const b = rectBox(rc);
      const tall = kind === 'H';
      push({
        material: 'wall',
        ...b,
        minY: 0,
        maxY: tall ? spec.buildingHeight : spec.wallHeight,
        tint: wallTint(rc.c0, rc.r0),
        style: tall ? 'building' : undefined,
      });
    }
  }

  // raised floors: one merged layer per level (each box from the ground up)
  const maxLevel = Math.max(0, ...level.flat());
  for (let l = 1; l <= maxLevel; l++) {
    const mask = level.map((row, r) => row.map((v, c) => v >= l && !isSolid(grid[r][c])));
    // only the cells whose level is exactly l start a slab at that height: build cumulative slabs
    for (const rc of mergeSolidCells(mask)) {
      const b = rectBox(rc);
      push({ material: 'floor', ...b, minY: (l - 1) * LEVEL, maxY: l * LEVEL, tint: floorTint(rc.c0, rc.r0), style: 'platform' });
    }
  }

  // lintels over archways and roof slabs over indoor cells
  // (heights are relative to each cell's floor level, so terraces keep full headroom)
  const lintelLevels = new Set<number>();
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) if (grid[r][c] === '^') lintelLevels.add(level[r][c]);
  for (const l of lintelLevels) {
    const lintelMask = grid.map((row, r) => [...row].map((k, c) => k === '^' && level[r][c] === l));
    for (const rc of mergeSolidCells(lintelMask)) {
      const y0 = l * LEVEL + LINTEL_Y;
      push({ material: 'wall', ...rectBox(rc), minY: y0, maxY: Math.max(spec.wallHeight, y0 + 0.8), tint: wallTint(rc.c0, rc.r0), style: 'lintel' });
    }
  }
  // cover/markers inside an indoor area keep the roof over them
  const roofMask = grid.map((row, r) =>
    [...row].map((k, c) => {
      if (k === 'r') return true;
      if (isSolid(k)) return false;
      let n = 0;
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (ch(c + dc, r + dr) === 'r') n++;
      return n >= 2 && (COVER.includes(k) || WALKABLE_MARKERS.includes(k));
    }),
  );
  const roofLevels = new Set<number>();
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) if (roofMask[r][c]) roofLevels.add(level[r][c]);
  for (const l of roofLevels) {
    const mask = roofMask.map((row, r) => row.map((v, c) => v && level[r][c] === l));
    for (const rc of mergeSolidCells(mask)) {
      const y0 = l * LEVEL + ROOF_Y;
      push({ material: 'concrete', ...rectBox(rc), minY: y0, maxY: y0 + 0.4, tint: wallTint(rc.c0, rc.r0), style: 'roof' });
    }
  }

  // cover props
  const props: MapProp[] = [];
  const box = (x: number, z: number, w: number, d: number, h: number, y0: number, material: MaterialTag, extra: Partial<Collider> = {}): void => {
    push({ material, minX: x - w / 2, maxX: x + w / 2, minY: y0, maxY: y0 + h, minZ: z - d / 2, maxZ: z + d / 2, style: 'prop', ...extra });
  };
  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      const k = grid[r][c];
      const x = cx(c);
      const z = cz(r);
      const y0 = level[r][c] * LEVEL;
      switch (k) {
        case 'c':
          box(x, z, 1.8, 1.8, 1.2, y0, 'crate');
          break;
        case 'C':
          box(x, z, 1.8, 1.8, 2.4, y0, 'crate');
          break;
        case 'w':
          box(x, z, 1.7, 1.7, 1.2, y0, 'wood', { breakHp: 160 });
          break;
        case 'b':
          box(x, z, 2, 0.6, 1.1, y0, 'concrete');
          break;
        case 'B':
          box(x, z, 0.6, 2, 1.1, y0, 'concrete');
          break;
        case 'p':
          box(x, z, 1, 1, spec.wallHeight - y0, y0, 'concrete', { style: 'pillar', tint: wallTint(c, r) });
          props.push({ kind: 'lamp', x, y: spec.wallHeight - 0.8, z, rot: 0 });
          break;
        case 't':
          box(x, z, 1.6, 1.6, 0.8, y0, 'concrete', { tint: spec.zones[zoneIdx[r][c]]?.wall });
          props.push({ kind: 'tree', x, y: y0 + 0.8, z, rot: (c * 7 + r * 13) % 6 });
          break;
        case 'o':
          box(x, z, 1.4, 1.4, 1.2, y0, 'metal');
          props.push({ kind: 'barrels', x, y: y0, z, rot: (c + r) % 4 });
          break;
        case 'm':
          box(x, z, 1.8, 1.0, 1.1, y0, 'wood');
          props.push({ kind: 'stall', x, y: y0, z, rot: 0, tint: spec.zones[zoneIdx[r][c]]?.wall });
          break;
        case 'g':
          box(x, z, 2, 0.12, 2.4, y0, 'glass', { breakHp: 1 });
          break;
        case 'G':
          box(x, z, 0.12, 2, 2.4, y0, 'glass', { breakHp: 1 });
          break;
      }
    }
  }

  // markers
  const cellsOf = (k: string): [number, number][] => {
    const out: [number, number][] = [];
    for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) if (grid[r][c] === k) out.push([c, r]);
    return out;
  };
  const clusters = (k: string): [number, number][][] => {
    const cells = cellsOf(k);
    const seen = new Set<string>();
    const out: [number, number][][] = [];
    for (const start of cells) {
      if (seen.has(start.join())) continue;
      const group: [number, number][] = [];
      const stack = [start];
      seen.add(start.join());
      while (stack.length) {
        const [c, r] = stack.pop()!;
        group.push([c, r]);
        for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const n: [number, number] = [c + dc, r + dr];
          if (ch(n[0], n[1]) === k && !seen.has(n.join())) {
            seen.add(n.join());
            stack.push(n);
          }
        }
      }
      out.push(group);
    }
    return out;
  };
  const centroid = (g: [number, number][]): { x: number; z: number } => ({
    x: g.reduce((s, [c]) => s + cx(c), 0) / g.length,
    z: g.reduce((s, [, r]) => s + cz(r), 0) / g.length,
  });

  const siteCells = [...cellsOf('S'), ...cellsOf('R')];
  if (!siteCells.length) throw new Error(`${spec.id}: map has no site (S)`);
  const siteRect: CellRect = {
    c0: Math.min(...siteCells.map(([c]) => c)),
    c1: Math.max(...siteCells.map(([c]) => c)),
    r0: Math.min(...siteCells.map(([, r]) => r)),
    r1: Math.max(...siteCells.map(([, r]) => r)),
  };
  const sb = rectBox(siteRect);
  const siteZone: Zone = { name: 'Site', ...sb };
  const relayCell = cellsOf('R')[0] ?? siteCells[0];
  const relay = { x: cx(relayCell[0]), y: level[relayCell[1]][relayCell[0]] * LEVEL + 0.3, z: cz(relayCell[1]) };
  box(relay.x, relay.z, 4, 4, 0.3, relay.y - 0.3, 'site');
  box(relay.x, relay.z, 0.8, 0.8, 1.6, relay.y, 'metal', { style: 'pillar' });

  const spawnsFrom = (k: string, yaw: number): SpawnPoint[] => {
    // the 10 cells closest to the middle of the spawn area (never against a wall)
    const cells = cellsOf(k);
    const mx = cells.reduce((a, [c]) => a + c, 0) / cells.length;
    const my = cells.reduce((a, [, r]) => a + r, 0) / cells.length;
    const chosen = cells
      .map(([c, r]) => ({ c, r, d: (c - mx) ** 2 + (r - my) ** 2 + (r % 2) * 0.01 }))
      .sort((a, b) => a.d - b.d || a.r - b.r || a.c - b.c)
      .slice(0, 10);
    return chosen.map(({ c, r }) => ({ x: cx(c), y: level[r][c] * LEVEL, z: cz(r), yaw }));
  };

  const entrances: Entrance[] = clusters('E').map((g, i) => {
    const p = centroid(g);
    return { id: `e${i}`, x: p.x, z: p.z, smoke: p };
  });
  if (!entrances.length) entrances.push({ id: 'e0', x: (sb.minX + sb.maxX) / 2, z: sb.minZ, smoke: { x: (sb.minX + sb.maxX) / 2, z: sb.minZ - 2 } });
  const nearestEnt = (x: number, z: number): Entrance =>
    entrances.reduce((a, b) => ((a.x - x) ** 2 + (a.z - z) ** 2 <= (b.x - x) ** 2 + (b.z - z) ** 2 ? a : b));

  const routeVias = ['x', 'y', 'z'].map((k) => clusters(k).map(centroid).sort((a, b) => a.z - b.z)).filter((v) => v.length);
  const posts: Post[] = [];
  for (const [c, r] of cellsOf('P')) {
    const x = cx(c);
    const z = cz(r);
    const e = nearestEnt(x, z);
    posts.push({ x, z, lookX: e.x, lookZ: e.z, entrance: e.id });
  }
  for (const [c, r] of cellsOf('F')) {
    const x = cx(c);
    const z = cz(r);
    // watch the nearest attack waypoint south of the post
    let look = { x, z: z - 20 };
    let best = Infinity;
    for (const vias of routeVias)
      for (const v of vias) {
        if (v.z >= z - 4) continue;
        const d = (v.x - x) ** 2 + (v.z - z) ** 2;
        if (d < best) {
          best = d;
          look = v;
        }
      }
    posts.push({ x, z, lookX: look.x, lookZ: look.z, entrance: nearestEnt(x, z).id, forward: true });
  }
  const sitePosts = posts.filter((p) => !p.forward);
  const routes: Route[] = routeVias.map((vias) => {
    const last = vias[vias.length - 1];
    const e = nearestEnt(last.x, last.z);
    const target = sitePosts.length
      ? sitePosts.reduce((a, b) => ((a.x - e.x) ** 2 + (a.z - e.z) ** 2 <= (b.x - e.x) ** 2 + (b.z - e.z) ** 2 ? a : b))
      : { x: relay.x, z: relay.z + 4 };
    return {
      entrance: e.id,
      waypoints: [...vias, { x: e.x, z: e.z }, { x: relay.x + (e.x < relay.x ? -2.5 : 2.5), z: relay.z - 2 }],
      smokeAt: vias.length,
      smokeTarget: { x: target.x, z: target.z },
    };
  });
  const tactics: Tactics = { entrances, posts, routes };

  const zones: Zone[] = spec.zones.map((z) => ({ name: z.name, ...rectBox(z) }));
  const floors = spec.zones.map((z) => ({ ...rectBox(z), color: z.floor, kind: z.floorKind ?? ('plain' as FloorKind) }));
  floors.push({ ...sb, color: '#2f7f7a', kind: 'site' });

  return {
    id: spec.id,
    name: spec.name,
    key: spec.id,
    colliders,
    bounds,
    wallHeight: spec.wallHeight,
    zones,
    siteZone,
    relay,
    spawns: { attackers: spawnsFrom('A', 0), defenders: spawnsFrom('D', 32768) },
    tactics,
    roundTime: spec.roundTime,
    visual: { theme: spec.theme, floors, props },
  };
}
