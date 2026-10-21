/**
 * Hand-authored tactical knowledge for Meridian Yard: defender posts grouped
 * into crossfire pairs per entrance, attacker routes, and smoke targets.
 */
export type Entrance = 'long' | 'mid' | 'short';

export interface Post {
  x: number;
  z: number;
  /** point the holder watches (at head height) */
  lookX: number;
  lookZ: number;
  entrance: Entrance;
}

export const ENTRANCES: Entrance[] = ['long', 'mid', 'short'];

/** Two posts per entrance watching it from different angles = crossfire. */
export const POSTS: Record<Entrance, [Post, Post]> = {
  long: [
    { x: -6, z: 34, lookX: -14, lookZ: 27, entrance: 'long' },
    { x: 4.5, z: 30, lookX: -12, lookZ: 25, entrance: 'long' },
  ],
  mid: [
    { x: 2.5, z: 21.5, lookX: 0, lookZ: 11, entrance: 'mid' },
    { x: 10, z: 29.5, lookX: 0, lookZ: 13, entrance: 'mid' },
  ],
  short: [
    { x: 24.5, z: 27.5, lookX: 25, lookZ: 12, entrance: 'short' },
    { x: 15.5, z: 25.5, lookX: 26, lookZ: 14, entrance: 'short' },
  ],
};

export interface Route {
  entrance: Entrance;
  waypoints: { x: number; z: number }[];
  /** index of the waypoint at which attackers throw their smoke */
  smokeAt: number;
  smokeTarget: { x: number; z: number };
}

export const ROUTES: Route[] = [
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
];

/** Where defenders throw smoke to stall a push through an entrance. */
export const DEFENSIVE_SMOKES: Record<Entrance, { x: number; z: number }> = {
  long: { x: -15, z: 27 },
  mid: { x: 0, z: 11 },
  short: { x: 25, z: 13 },
};

/** Entrance closest to a world position (used to interpret sounds/sightings). */
export function nearestEntrance(x: number, z: number): Entrance {
  if (x < -8) return 'long';
  if (x > 14 || (x > 8 && z < 14)) return 'short';
  return 'mid';
}
