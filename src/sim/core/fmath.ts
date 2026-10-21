/**
 * Deterministic math for the simulation.
 *
 * Math.sin/cos/atan2 are not required by the spec to be correctly rounded and
 * may differ between engines/versions. These versions use only + - * / and
 * Math.round/floor/sqrt/abs (all exactly specified by IEEE 754), so results
 * are bit-identical everywhere.
 */

export const PI = 3.141592653589793;
export const TAU = 6.283185307179586;
export const HALF_PI = 1.5707963267948966;

/** Angles in input frames are integers: one full turn = 65536 units. */
export const ANGLE_UNITS = 65536;
export const RAD_PER_UNIT = TAU / ANGLE_UNITS;

// Cody-Waite split of pi/2 for accurate range reduction
const PIO2_HI = 1.5707963267341256;
const PIO2_LO = 6.077100506506192e-11;

// Taylor coefficients in x²; |x| <= pi/4 after reduction, error < 1e-16.
const SIN_C = [1, -1 / 6, 1 / 120, -1 / 5040, 1 / 362880, -1 / 39916800, 1 / 6227020800];
const COS_C = [1, -1 / 2, 1 / 24, -1 / 720, 1 / 40320, -1 / 3628800, 1 / 479001600, -1 / 87178291200];

function horner(c: readonly number[], x2: number): number {
  let s = 0;
  for (let i = c.length - 1; i >= 0; i--) s = s * x2 + c[i];
  return s;
}

function sinPoly(x: number): number {
  return x * horner(SIN_C, x * x);
}

function cosPoly(x: number): number {
  return horner(COS_C, x * x);
}

export function sin(x: number): number {
  const k = Math.round(x / HALF_PI);
  const r = x - k * PIO2_HI - k * PIO2_LO;
  switch (((k % 4) + 4) % 4) {
    case 0:
      return sinPoly(r);
    case 1:
      return cosPoly(r);
    case 2:
      return -sinPoly(r);
    default:
      return -cosPoly(r);
  }
}

export function cos(x: number): number {
  const k = Math.round(x / HALF_PI);
  const r = x - k * PIO2_HI - k * PIO2_LO;
  switch (((k % 4) + 4) % 4) {
    case 0:
      return cosPoly(r);
    case 1:
      return -sinPoly(r);
    case 2:
      return -cosPoly(r);
    default:
      return sinPoly(r);
  }
}

const TAN_PI_8 = 0.41421356237309503;
const PI_4 = 0.7853981633974483;

function atanSmall(x: number): number {
  // |x| <= tan(pi/8); series to x^25, error < 1e-11
  const x2 = x * x;
  let s = 0;
  for (let n = 12; n >= 0; n--) {
    s = s * x2 + (n % 2 === 0 ? 1 : -1) / (2 * n + 1);
  }
  return x * s;
}

export function atan(x: number): number {
  const neg = x < 0;
  let a = neg ? -x : x;
  let r: number;
  if (a > 1) {
    a = 1 / a;
    r = HALF_PI - atanReduced(a);
  } else {
    r = atanReduced(a);
  }
  return neg ? -r : r;
}

function atanReduced(a: number): number {
  // a in [0, 1]
  if (a > TAN_PI_8) return PI_4 + atanSmall((a - 1) / (a + 1));
  return atanSmall(a);
}

export function atan2(y: number, x: number): number {
  if (x > 0) return atan(y / x);
  if (x < 0) return y >= 0 ? atan(y / x) + PI : atan(y / x) - PI;
  if (y > 0) return HALF_PI;
  if (y < 0) return -HALF_PI;
  return 0;
}

export function asin(x: number): number {
  const c = Math.max(-1, Math.min(1, x));
  return atan2(c, Math.sqrt(1 - c * c));
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Move `current` toward `target` by at most `maxDelta`. */
export function approach(current: number, target: number, maxDelta: number): number {
  if (current < target) return Math.min(current + maxDelta, target);
  return Math.max(current - maxDelta, target);
}

export function unitsToRad(units: number): number {
  return units * RAD_PER_UNIT;
}

export function radToUnits(rad: number): number {
  return Math.round(rad / RAD_PER_UNIT);
}

/** Wrap integer yaw to [0, 65536). */
export function wrapYaw(units: number): number {
  return ((units % ANGLE_UNITS) + ANGLE_UNITS) % ANGLE_UNITS;
}

/** Signed shortest difference b - a for integer angles, in [-32768, 32768). */
export function angleDiffUnits(a: number, b: number): number {
  return ((((b - a) % ANGLE_UNITS) + ANGLE_UNITS + 32768) % ANGLE_UNITS) - 32768;
}

/** Signed shortest difference b - a in radians, in [-pi, pi). */
export function angleDiffRad(a: number, b: number): number {
  let d = (b - a) % TAU;
  if (d < -PI) d += TAU;
  else if (d >= PI) d -= TAU;
  return d;
}
