/**
 * Movement feel. All values are SI units (m, s). Tweak freely.
 * ★ 撃ち心地/移動感の調整はここ。
 */
export const MOVEMENT = {
  tickRate: 60,

  runSpeed: 6.2,
  walkSpeed: 2.9, // Shift
  crouchSpeed: 2.3,
  /** Speed while ADS (multiplied with the above). */
  adsSpeedMul: 0.78,

  groundAccel: 70, // m/s² toward the wished velocity
  groundDecel: 55, // m/s² when no key is held (snappy counter-strafe)
  airAccel: 9,
  airMaxSpeed: 6.2,

  gravity: 21,
  jumpHeight: 1.05, // apex in metres; jump velocity is derived from this
  /** Seconds after walking off a ledge during which a jump is still accepted. */
  coyoteTime: 0.08,

  standHeight: 1.8,
  crouchHeight: 1.25,
  eyeOffsetFromTop: 0.16,
  bodyRadius: 0.3,
  /** Crouch transition speed in "fraction of full crouch per second". */
  crouchRate: 7.5,

  stepHeight: 0.42,
  /** How far below the feet we snap down to stay glued to stairs. */
  groundSnap: 0.45,

  /** Ability: Slip (dash). Kept here because it is a movement primitive. */
  dash: {
    distance: 4.2,
    duration: 0.18,
  },
} as const;

export type MovementConfig = typeof MOVEMENT;
