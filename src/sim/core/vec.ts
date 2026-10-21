import { cos, sin } from './fmath';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export function v3(x = 0, y = 0, z = 0): Vec3 {
  return { x, y, z };
}

export function copy(out: Vec3, a: Vec3): Vec3 {
  out.x = a.x;
  out.y = a.y;
  out.z = a.z;
  return out;
}

export function set(out: Vec3, x: number, y: number, z: number): Vec3 {
  out.x = x;
  out.y = y;
  out.z = z;
  return out;
}

export function add(out: Vec3, a: Vec3, b: Vec3): Vec3 {
  return set(out, a.x + b.x, a.y + b.y, a.z + b.z);
}

export function sub(out: Vec3, a: Vec3, b: Vec3): Vec3 {
  return set(out, a.x - b.x, a.y - b.y, a.z - b.z);
}

export function scale(out: Vec3, a: Vec3, s: number): Vec3 {
  return set(out, a.x * s, a.y * s, a.z * s);
}

export function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function length(a: Vec3): number {
  return Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
}

export function dist(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export function normalize(out: Vec3, a: Vec3): Vec3 {
  const l = length(a);
  return l > 1e-12 ? scale(out, a, 1 / l) : set(out, 0, 0, 0);
}

/**
 * Direction for yaw/pitch in radians. Convention (matches Babylon's
 * left-handed frame): +Y up, yaw 0 looks toward +Z, positive yaw turns
 * toward +X, positive pitch looks up.
 */
export function dirFromAngles(out: Vec3, yaw: number, pitch: number): Vec3 {
  const cp = cos(pitch);
  return set(out, sin(yaw) * cp, sin(pitch), cos(yaw) * cp);
}
