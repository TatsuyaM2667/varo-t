/**
 * Input mapping and mouse feel.
 * ★ 感度の初期値・視野角はここ（プレイヤーは設定画面でも変更可能）。
 */
export const INPUT = {
  /** Degrees of rotation per mouse count at sensitivity 1.0. */
  degreesPerCount: 0.07,
  defaultSensitivity: 0.45,
  minSensitivity: 0.05,
  maxSensitivity: 3,
  /** Multiplier applied while aiming down sights (scoped weapons use their own). */
  adsSensitivityMul: 1.0,
  invertY: false,

  /** Horizontal field of view in degrees. */
  fovHorizontal: 103,

  /** Pitch limit in degrees. */
  pitchLimit: 88,

  keys: {
    forward: ['KeyW'],
    back: ['KeyS'],
    left: ['KeyA'],
    right: ['KeyD'],
    walk: ['ShiftLeft', 'ShiftRight'],
    jump: ['Space'],
    crouch: ['ControlLeft', 'KeyC'],
    reload: ['KeyR'],
    weapon1: ['Digit1'],
    weapon2: ['Digit2'],
    weapon3: ['Digit3'],
    ability1: ['KeyQ'],
    ability2: ['KeyE'],
    scoreboard: ['Tab'],
  },
} as const;
