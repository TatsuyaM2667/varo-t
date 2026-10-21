/**
 * One tick of input for one agent (human or bot). This is the only thing the
 * outside world feeds into the simulation, and the only thing a replay needs
 * to store besides the seed.
 */
export const Btn = {
  Forward: 1 << 0,
  Back: 1 << 1,
  Left: 1 << 2,
  Right: 1 << 3,
  Walk: 1 << 4,
  Jump: 1 << 5,
  Crouch: 1 << 6,
  Fire: 1 << 7,
  Ads: 1 << 8,
  Reload: 1 << 9,
  Weapon1: 1 << 10,
  Weapon2: 1 << 11,
  Weapon3: 1 << 12,
  Ability1: 1 << 13,
  Ability2: 1 << 14,
} as const;

export interface InputFrame {
  buttons: number;
  /** Absolute yaw in angle units [0, 65536). */
  yaw: number;
  /** Absolute pitch in angle units, positive = up, clamped by the sim. */
  pitch: number;
}

export function emptyInput(yaw = 0, pitch = 0): InputFrame {
  return { buttons: 0, yaw, pitch };
}

export function has(f: InputFrame, b: number): boolean {
  return (f.buttons & b) !== 0;
}
