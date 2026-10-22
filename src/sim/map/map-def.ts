import { type Tactics, YARD_TACTICS } from '../bots/tactics';
import type { Collider, MaterialTag } from '../physics/aabb';

/**
 * Meridian Yard — single-site map.
 *
 * Authored as a solid 2 m grid with walkable rectangles carved out, plus
 * free-placed boxes (cover, platforms, stairs). Solid cells are greedily merged
 * into few large wall boxes. Units are metres; +Z is north (defender side).
 *
 *   north  ┌──── defender spawn ────┐
 *          │   A site (Relay)       │
 *   Long ──┤        │mid choke      ├── Short
 *          │      Mid               │
 *   south  └──── attacker spawn ────┘
 */

export interface CellRect {
  /** inclusive column range */
  c0: number;
  c1: number;
  /** inclusive row range; row 0 is the north edge */
  r0: number;
  r1: number;
  name?: string;
}

export interface BoxDef {
  /** centre x/z, size w (x) d (z) h (y), base height y0 */
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
  y0?: number;
  material: MaterialTag;
  tag?: string;
  breakHp?: number;
}

export interface Zone {
  name: string;
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

export interface SpawnPoint {
  x: number;
  y: number;
  z: number;
  /** yaw in angle units (65536 per turn) */
  yaw: number;
}

/** Render-only decoration that has no (or only a simple) collider. */
export type PropKind = 'tree' | 'stall' | 'barrels' | 'lamp' | 'banner';

export interface MapProp {
  kind: PropKind;
  x: number;
  y: number;
  z: number;
  /** yaw in radians */
  rot: number;
  tint?: string;
}

export type FloorKind = 'plain' | 'cobble' | 'tile' | 'metal' | 'grass' | 'site';

/** Visual description consumed by the renderer (the sim ignores it). */
export interface MapVisual {
  theme: string;
  floors: { minX: number; minZ: number; maxX: number; maxZ: number; color: string; kind: FloorKind }[];
  props: MapProp[];
}

export interface MapData {
  /** registry id (see map/registry.ts) */
  id: string;
  name: string;
  /** identity of the layout (renderers rebuild meshes only when it changes) */
  key: string;
  colliders: Collider[];
  bounds: { minX: number; minZ: number; maxX: number; maxZ: number };
  wallHeight: number;
  zones: Zone[];
  siteZone: Zone;
  relay: { x: number; y: number; z: number };
  spawns: { attackers: SpawnPoint[]; defenders: SpawnPoint[] };
  tactics: Tactics;
  /** seconds per round on this map (defaults to RULES.roundTime) */
  roundTime?: number;
  visual?: MapVisual;
}

const CELL = 2;
const COLS = 36;
const ROWS = 48;
const ORIGIN_X = -36;
const ORIGIN_Z = 48; // z of the north edge
const WALL_H = 5;

const CARVE: CellRect[] = [
  { c0: 12, c1: 29, r0: 1, r1: 4, name: 'Defender Spawn' },
  { c0: 14, c1: 15, r0: 5, r1: 5 }, // spawn → site west door
  { c0: 26, c1: 27, r0: 5, r1: 5 }, // spawn → site east door
  { c0: 12, c1: 31, r0: 6, r1: 16, name: 'A Site' },
  { c0: 7, c1: 11, r0: 8, r1: 12, name: 'Long Link' },
  { c0: 2, c1: 6, r0: 8, r1: 44, name: 'Long' },
  { c0: 17, c1: 18, r0: 17, r1: 19, name: 'Mid Choke' },
  { c0: 15, c1: 20, r0: 20, r1: 38, name: 'Mid' },
  { c0: 28, c1: 33, r0: 17, r1: 40, name: 'Short' },
  { c0: 7, c1: 14, r0: 26, r1: 28, name: 'Mid Long Connector' },
  { c0: 21, c1: 27, r0: 30, r1: 32, name: 'Mid Short Connector' },
  { c0: 15, c1: 20, r0: 39, r1: 39 },
  { c0: 8, c1: 27, r0: 40, r1: 46, name: 'Attacker Spawn' },
  { c0: 2, c1: 7, r0: 41, r1: 44 },
  { c0: 28, c1: 33, r0: 41, r1: 44 },
];

/** Fixed structure: platforms, stairs, the relay, spawn barriers. */
const STRUCTURE: BoxDef[] = [
  { x: -6, z: 33, w: 12, d: 6, h: 1.4, material: 'concrete', tag: 'heaven' },
  // stairs up to heaven: step i spans z ∈ [25 + i, 30]
  ...[1, 2, 3, 4].map((i): BoxDef => ({ x: -2, z: (25 + i + 30) / 2, w: 4, d: 5 - i, h: 0.35 * i, material: 'concrete', tag: 'stairs' })),
  { x: 8, z: 25, w: 6, d: 6, h: 0.3, material: 'site', tag: 'relay-pad' },
  { x: 8, z: 25, w: 0.8, d: 0.8, h: 1.6, y0: 0.3, material: 'metal', tag: 'relay' },
  { x: 8, z: 33, w: 5, d: 0.6, h: 2.2, material: 'concrete' },
  { x: -6, z: -38, w: 3, d: 1, h: 1.2, material: 'concrete' },
  { x: 6, z: -38, w: 3, d: 1, h: 1.2, material: 'concrete' },
];

/**
 * Cover slots. `jitter` (m) and `optional` let the seeded generator (Tier 2)
 * vary the layout per round; the default layout uses them as authored.
 */
export interface CoverSlot extends BoxDef {
  jitter: number;
  optional: boolean;
  /** region the jittered box must stay within */
  zone: string;
}

export const COVER_SLOTS: CoverSlot[] = [
  // --- A site ---
  { x: 0, z: 19, w: 2, d: 2, h: 2.4, material: 'crate', jitter: 1.5, optional: false, zone: 'A Site' },
  { x: 2.1, z: 19, w: 2.2, d: 2, h: 1.1, material: 'crate', jitter: 0, optional: true, zone: 'A Site' },
  { x: 16, z: 28, w: 2, d: 2, h: 1.2, material: 'wood', breakHp: 160, jitter: 2, optional: false, zone: 'A Site' },
  { x: 21, z: 19, w: 2, d: 2, h: 2.4, material: 'crate', jitter: 2, optional: false, zone: 'A Site' },
  { x: 24, z: 31, w: 2, d: 2, h: 1.6, material: 'crate', jitter: 1.5, optional: true, zone: 'A Site' },
  { x: -8, z: 22, w: 2, d: 2, h: 1.2, material: 'wood', breakHp: 160, jitter: 1.5, optional: true, zone: 'A Site' },
  { x: 14.5, z: 22, w: 0.12, d: 3, h: 2.4, material: 'glass', breakHp: 1, jitter: 0, optional: true, zone: 'A Site' },
  // capture-zone cover around the relay pad (added after LOS validation found the plaza fully exposed)
  { x: 8, z: 20.2, w: 3, d: 0.6, h: 1.1, material: 'concrete', jitter: 0.5, optional: false, zone: 'A Site' },
  { x: 3, z: 26.5, w: 2, d: 2, h: 1.2, material: 'wood', breakHp: 160, jitter: 0.5, optional: false, zone: 'A Site' },
  { x: 13.2, z: 26, w: 2, d: 2, h: 2.4, material: 'crate', jitter: 0.5, optional: false, zone: 'A Site' },
  // --- Long ---
  { x: -27, z: 6, w: 2, d: 2, h: 1.2, material: 'wood', breakHp: 160, jitter: 2, optional: false, zone: 'Long' },
  { x: -24.5, z: -14, w: 2, d: 2, h: 2.4, material: 'crate', jitter: 2, optional: false, zone: 'Long' },
  { x: -30, z: 20, w: 2, d: 2, h: 1.6, material: 'crate', jitter: 1, optional: true, zone: 'Long' },
  // --- Mid ---
  { x: -3, z: -6, w: 2, d: 2, h: 2.4, material: 'crate', jitter: 1.5, optional: false, zone: 'Mid' },
  { x: 3.5, z: 2, w: 2, d: 2, h: 1.2, material: 'wood', breakHp: 160, jitter: 1, optional: true, zone: 'Mid' },
  { x: 2, z: -22, w: 2, d: 2, h: 1.2, material: 'crate', jitter: 2, optional: true, zone: 'Mid' },
  // --- Short ---
  { x: 29, z: -6, w: 2, d: 2, h: 1.2, material: 'crate', jitter: 2, optional: false, zone: 'Short' },
  { x: 23, z: 6, w: 2, d: 2, h: 2.4, material: 'crate', jitter: 1.5, optional: true, zone: 'Short' },
];

function cellToWorld(c: number, r: number): { x0: number; x1: number; z0: number; z1: number } {
  return {
    x0: ORIGIN_X + c * CELL,
    x1: ORIGIN_X + (c + 1) * CELL,
    z0: ORIGIN_Z - (r + 1) * CELL,
    z1: ORIGIN_Z - r * CELL,
  };
}

function rectToZone(r: CellRect): Zone {
  const a = cellToWorld(r.c0, r.r1);
  const b = cellToWorld(r.c1, r.r0);
  return { name: r.name ?? '', minX: a.x0, minZ: a.z0, maxX: b.x1, maxZ: b.z1 };
}

/** Greedy-merge solid cells into as few boxes as possible. */
export function mergeSolidCells(solid: boolean[][]): CellRect[] {
  const rows = solid.length;
  const cols = solid[0].length;
  const used = solid.map((row) => row.map(() => false));
  const out: CellRect[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!solid[r][c] || used[r][c]) continue;
      let c1 = c;
      while (c1 + 1 < cols && solid[r][c1 + 1] && !used[r][c1 + 1]) c1++;
      let r1 = r;
      outer: while (r1 + 1 < rows) {
        for (let k = c; k <= c1; k++) if (!solid[r1 + 1][k] || used[r1 + 1][k]) break outer;
        r1++;
      }
      for (let rr = r; rr <= r1; rr++) for (let k = c; k <= c1; k++) used[rr][k] = true;
      out.push({ c0: c, c1, r0: r, r1 });
    }
  }
  return out;
}

/** Build the map. `cover` overrides the cover layout (seeded maps); default is the authored one. */
export function buildMeridianYard(cover: readonly BoxDef[] = COVER_SLOTS, key = 'default'): MapData {
  const solid: boolean[][] = [];
  for (let r = 0; r < ROWS; r++) solid.push(new Array<boolean>(COLS).fill(true));
  for (const rect of CARVE) {
    for (let r = rect.r0; r <= rect.r1; r++) for (let c = rect.c0; c <= rect.c1; c++) solid[r][c] = false;
  }

  const colliders: Collider[] = [];
  let id = 0;
  const minX = ORIGIN_X;
  const maxX = ORIGIN_X + COLS * CELL;
  const minZ = ORIGIN_Z - ROWS * CELL;
  const maxZ = ORIGIN_Z;

  colliders.push({ id: id++, material: 'floor', minX, maxX, minY: -1, maxY: 0, minZ, maxZ });
  for (const rect of mergeSolidCells(solid)) {
    const z = rectToZone(rect);
    colliders.push({ id: id++, material: 'wall', minX: z.minX, maxX: z.maxX, minY: 0, maxY: WALL_H, minZ: z.minZ, maxZ: z.maxZ });
  }
  for (const b of [...STRUCTURE, ...cover]) {
    const y0 = b.y0 ?? 0;
    colliders.push({
      id: id++,
      material: b.material,
      breakHp: b.breakHp,
      minX: b.x - b.w / 2,
      maxX: b.x + b.w / 2,
      minY: y0,
      maxY: y0 + b.h,
      minZ: b.z - b.d / 2,
      maxZ: b.z + b.d / 2,
    });
  }

  const zones = CARVE.filter((r) => r.name).map(rectToZone);
  zones.push({ name: 'Heaven', minX: -12, minZ: 30, maxX: 0, maxZ: 36 });

  const yawNorth = 0;
  const yawSouth = 32768;
  return {
    id: 'yard',
    name: 'Meridian Yard',
    key,
    tactics: YARD_TACTICS,
    colliders,
    bounds: { minX, minZ, maxX, maxZ },
    wallHeight: WALL_H,
    zones,
    siteZone: { name: 'A Site', minX: 2, minZ: 19, maxX: 14, maxZ: 31 },
    relay: { x: 8, y: 0.3, z: 25 },
    spawns: {
      attackers: [
        { x: 0, y: 0, z: -42, yaw: yawNorth },
        { x: -4, y: 0, z: -42, yaw: yawNorth },
        { x: 4, y: 0, z: -42, yaw: yawNorth },
        { x: -8, y: 0, z: -44, yaw: yawNorth },
        { x: 8, y: 0, z: -44, yaw: yawNorth },
      ],
      defenders: [
        { x: 0, y: 0, z: 42, yaw: yawSouth },
        { x: 6, y: 0, z: 42, yaw: yawSouth },
        { x: 12, y: 0, z: 42, yaw: yawSouth },
        { x: -6, y: 0, z: 42, yaw: yawSouth },
        { x: 18, y: 0, z: 42, yaw: yawSouth },
      ],
    },
  };
}

/** Name of the most specific zone containing (x, z), for HUD callouts. */
export function zoneAt(map: MapData, x: number, z: number): string {
  let best = '';
  let bestArea = Infinity;
  for (const zn of map.zones) {
    if (x >= zn.minX && x <= zn.maxX && z >= zn.minZ && z <= zn.maxZ) {
      const area = (zn.maxX - zn.minX) * (zn.maxZ - zn.minZ);
      if (area < bestArea) {
        bestArea = area;
        best = zn.name;
      }
    }
  }
  return best;
}
