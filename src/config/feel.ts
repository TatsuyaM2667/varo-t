/**
 * Visual "feel" of the first-person weapon (does not affect gameplay).
 * ★ 武器の見た目の揺れ・反動アニメーションはここ。
 */
export const VIEWMODEL = {
  /** overall size of the first-person weapon */
  scale: 0.5,
  /** hip-fire position relative to the camera (right, up, forward) */
  hipOffset: [0.16, -0.155, 0.36] as [number, number, number],
  /** ADS position (sight centred under the eye) */
  adsOffset: [0, -0.057, 0.2] as [number, number, number],
  /** spring stiffness / damping for the recoil spring */
  spring: { stiffness: 260, damping: 22 },
  /** per-shot impulse: kick back (m/s), muzzle climb (rad/s) */
  kick: { rifle: [1.4, 9], sidearm: [1.1, 12], sniper: [2.6, 16] } as Record<string, [number, number]>,
  /** mouse sway: radians of lag per radian/s of look speed */
  sway: 0.035,
  swayMax: 0.08,
  /** walk bob amplitude (m) and frequency multiplier */
  bob: { amplitude: 0.012, frequency: 1.0 },
  /** camera shake per shot (radians) */
  cameraKick: 0.004,
};

export const CAMERA_FEEL = {
  /** extra camera bob while running (m) */
  headBob: 0.018,
  /** landing dip (m per m/s of fall speed) */
  landDip: 0.012,
  /** FOV punch on dash (degrees) */
  dashFovKick: 6,
};
