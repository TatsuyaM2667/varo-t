/**
 * Weapon tuning. ★ 撃ち心地はすべてここ。角度は「度」、時間は「秒」、距離は「m」。
 *
 * Spread is the radius (degrees) of the random cone around the aim point.
 * Recoil pattern entries are the extra view kick per shot [pitchUp, yawRight]
 * in degrees; once the pattern runs out the last `loopFrom..` entries repeat.
 */
export type WeaponId = 'sidearm' | 'rifle' | 'sniper';

export interface WeaponDef {
  id: WeaponId;
  slot: 1 | 2 | 3;
  automatic: boolean;
  /**
   * Semi-autos: keep firing while the button is held, at this interval (s).
   * Casual players hold the button; without this they think the gun jammed.
   * 0 = strict one shot per click.
   */
  holdRepeat: number;
  /** seconds between shots */
  fireInterval: number;
  magSize: number;
  reserve: number;
  reloadTime: number;
  equipTime: number;

  damage: { head: number; body: number; legs: number };
  /** damage multiplier beyond each distance (applied in order) */
  falloff: { from: number; mul: number }[];

  spread: {
    /** first-shot accuracy when standing still */
    base: number;
    /** added per consecutive shot */
    perShot: number;
    max: number;
    /** degrees per second of bloom recovery when not firing */
    recovery: number;
    /** added in proportion to horizontal speed / run speed */
    moving: number;
    walking: number;
    air: number;
    crouchMul: number;
    adsMul: number;
  };

  recoil: {
    pattern: [number, number][];
    loopFrom: number;
    /** degrees per second the view returns to centre after firing stops */
    recovery: number;
    /** seconds after the last shot before recovery starts */
    recoveryDelay: number;
    /** fraction of the kick shown on the camera (rest only moves bullets) */
    viewFollow: number;
  };

  ads: {
    zoom: number;
    /** seconds to fully zoom */
    time: number;
    moveMul: number;
    /** scoped weapons show a full-screen scope overlay */
    scoped: boolean;
    /** extra spread when firing unscoped (snipers) */
    unscopedPenalty: number;
  };

  /** seconds after the shot during which you cannot fire (bolt action) */
  boltTime?: number;
  /** used by bots to decide engagement ranges */
  idealRange: [number, number];
  /** sound loudness radius in metres (bots hear it) */
  noiseRadius: number;
}

const RIFLE_PATTERN: [number, number][] = [
  [0.0, 0.0],
  [0.25, 0.0],
  [0.4, 0.02],
  [0.6, -0.04],
  [0.75, 0.05],
  [0.8, 0.1],
  [0.7, 0.18],
  [0.6, 0.26],
  [0.45, 0.32],
  [0.3, 0.28],
  [0.2, 0.1],
  [0.15, -0.25],
  [0.12, -0.4],
  [0.1, -0.45],
  [0.1, -0.35],
  [0.1, -0.1],
  [0.1, 0.25],
  [0.1, 0.4],
  [0.1, 0.45],
  [0.1, 0.3],
];

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  sidearm: {
    id: 'sidearm',
    slot: 2,
    automatic: false,
    holdRepeat: 0.24,
    fireInterval: 0.15,
    magSize: 12,
    reserve: 48,
    reloadTime: 1.5,
    equipTime: 0.5,
    damage: { head: 78, body: 26, legs: 22 },
    falloff: [{ from: 30, mul: 0.85 }],
    spread: { base: 0.3, perShot: 0.9, max: 4, recovery: 9, moving: 2.2, walking: 0.9, air: 6, crouchMul: 0.85, adsMul: 0.8 },
    recoil: { pattern: [[0.6, 0], [0.8, 0.1], [0.9, -0.1]], loopFrom: 1, recovery: 14, recoveryDelay: 0.12, viewFollow: 0.7 },
    ads: { zoom: 1.15, time: 0.12, moveMul: 0.85, scoped: false, unscopedPenalty: 0 },
    idealRange: [0, 18],
    noiseRadius: 35,
  },
  rifle: {
    id: 'rifle',
    slot: 1,
    automatic: true,
    holdRepeat: 0,
    fireInterval: 0.1,
    magSize: 25,
    reserve: 75,
    reloadTime: 2.4,
    equipTime: 1.0,
    damage: { head: 150, body: 39, legs: 33 },
    falloff: [],
    spread: { base: 0.22, perShot: 0.32, max: 3.2, recovery: 7, moving: 4.5, walking: 1.6, air: 9, crouchMul: 0.8, adsMul: 0.75 },
    recoil: { pattern: RIFLE_PATTERN, loopFrom: 10, recovery: 11, recoveryDelay: 0.14, viewFollow: 0.55 },
    ads: { zoom: 1.25, time: 0.18, moveMul: 0.76, scoped: false, unscopedPenalty: 0 },
    idealRange: [0, 40],
    noiseRadius: 45,
  },
  sniper: {
    id: 'sniper',
    slot: 3,
    automatic: false,
    holdRepeat: 1.5,
    fireInterval: 1.5,
    magSize: 5,
    reserve: 15,
    reloadTime: 3.2,
    equipTime: 1.2,
    damage: { head: 255, body: 150, legs: 120 },
    falloff: [],
    spread: { base: 0.0, perShot: 0, max: 10, recovery: 20, moving: 7, walking: 4, air: 12, crouchMul: 0.8, adsMul: 1 },
    recoil: { pattern: [[2.6, 0]], loopFrom: 0, recovery: 8, recoveryDelay: 0.25, viewFollow: 1 },
    ads: { zoom: 3.2, time: 0.25, moveMul: 0.55, scoped: true, unscopedPenalty: 5 },
    boltTime: 1.5,
    idealRange: [12, 120],
    noiseRadius: 60,
  },
};

export const WEAPON_BY_SLOT: Record<1 | 2 | 3, WeaponId> = { 1: 'rifle', 2: 'sidearm', 3: 'sniper' };

/** Hitbox proportions (fractions of the current body height, half-widths in metres). */
export const HITBOX = {
  headSize: 0.3,
  headHalfWidth: 0.15,
  bodyHalfWidth: 0.26,
  legsHalfWidth: 0.22,
  /** legs occupy [0, legsTop * height] */
  legsTop: 0.46,
} as const;

export const MAX_HP = 100;
