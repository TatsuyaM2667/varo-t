/**
 * Tactical knowledge of a map, used by bots: entrances to the site (with a
 * defensive smoke spot each), defender posts (several per entrance so they
 * form crossfires; `forward` posts hold the approach before the site) and
 * attacker routes. Meridian Yard's is hand-authored below; stage maps
 * derive theirs from markers in the ASCII layout (see map/spec.ts).
 */
export interface Entrance {
  id: string;
  x: number;
  z: number;
  /** where defenders throw smoke to stall a push through this entrance */
  smoke: { x: number; z: number };
}

export interface Post {
  x: number;
  z: number;
  /** point the holder watches (at head height) */
  lookX: number;
  lookZ: number;
  entrance: string;
  /** holds the approach in front of the site rather than the site itself */
  forward?: boolean;
}

export interface Route {
  entrance: string;
  waypoints: { x: number; z: number }[];
  /** index of the waypoint at which attackers throw their smoke */
  smokeAt: number;
  smokeTarget: { x: number; z: number };
}

export interface Tactics {
  entrances: Entrance[];
  posts: Post[];
  routes: Route[];
}

/** Entrance closest to a world position (used to interpret sounds/sightings). */
export function nearestEntrance(t: Tactics, x: number, z: number): Entrance | null {
  let best: Entrance | null = null;
  let bestD = Infinity;
  for (const e of t.entrances) {
    const d = (e.x - x) * (e.x - x) + (e.z - z) * (e.z - z);
    if (d < bestD) {
      bestD = d;
      best = e;
    }
  }
  return best;
}

/** Meridian Yard: two posts per entrance watching it from different angles. */
export const YARD_TACTICS: Tactics = {
  entrances: [
    { id: 'long', x: -13, z: 27, smoke: { x: -15, z: 27 } },
    { id: 'mid', x: 0, z: 12, smoke: { x: 0, z: 11 } },
    { id: 'short', x: 25, z: 14, smoke: { x: 25, z: 13 } },
  ],
  posts: [
    { x: -6, z: 34, lookX: -14, lookZ: 27, entrance: 'long' },
    { x: 4.5, z: 30, lookX: -12, lookZ: 25, entrance: 'long' },
    { x: 2.5, z: 21.5, lookX: 0, lookZ: 11, entrance: 'mid' },
    { x: 10, z: 29.5, lookX: 0, lookZ: 13, entrance: 'mid' },
    { x: 24.5, z: 27.5, lookX: 25, lookZ: 12, entrance: 'short' },
    { x: 15.5, z: 25.5, lookX: 26, lookZ: 14, entrance: 'short' },
  ],
  routes: [
    {
      entrance: 'long',
      waypoints: [
        { x: -27, z: -30 },
        { x: -27, z: 14 },
        { x: -17, z: 27 },
        { x: -2, z: 24 },
        { x: 7, z: 22 },
      ],
      smokeAt: 2,
      smokeTarget: { x: -4, z: 31 },
    },
    {
      entrance: 'mid',
      waypoints: [
        { x: 0, z: -26 },
        { x: 0, z: 4 },
        { x: 0, z: 12 },
        { x: 5, z: 21 },
        { x: 8, z: 22 },
      ],
      smokeAt: 1,
      smokeTarget: { x: 7, z: 27 },
    },
    {
      entrance: 'short',
      waypoints: [
        { x: 26, z: -26 },
        { x: 26, z: 8 },
        { x: 25, z: 17 },
        { x: 15, z: 21 },
        { x: 9, z: 22 },
      ],
      smokeAt: 1,
      smokeTarget: { x: 20, z: 27 },
    },
  ],
};
