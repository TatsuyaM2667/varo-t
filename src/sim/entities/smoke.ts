import { ABILITIES } from '../../config/abilities';
import { MOVEMENT } from '../../config/movement';
import { TAU, cos, sin } from '../core/fmath';
import type { Rng } from '../core/rng';
import { bodyOverlaps } from '../physics/body';
import type { Bvh } from '../physics/bvh';

const DT = 1 / MOVEMENT.tickRate;
const CFG = ABILITIES.smoke;

/**
 * A smoke cloud is a small set of spherical puffs forming a density field.
 * Puffs spread outward and settle around geometry (pushed out of walls), so
 * the shape hugs corridors like a fluid would. The same field drives the
 * renderer and bot line-of-sight, so what you see is what blocks bots.
 */
export interface Puff {
  x: number;
  y: number;
  z: number;
  /** current radius */
  r: number;
  /** target offset from the centre */
  tx: number;
  ty: number;
  tz: number;
}

export interface Smoke {
  id: number;
  owner: number;
  x: number;
  y: number;
  z: number;
  /** seconds since deploy */
  age: number;
  puffs: Puff[];
}

export interface SmokeProjectile {
  id: number;
  owner: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  age: number;
}

/** 0..1 overall opacity envelope (expand, hold, fade). */
export function smokeStrength(s: Smoke): number {
  const fadeIn = Math.min(1, s.age / CFG.expandTime);
  const left = CFG.duration - s.age;
  const fadeOut = Math.min(1, left / 1.2);
  return Math.max(0, Math.min(fadeIn, fadeOut));
}

export function deploySmoke(id: number, owner: number, x: number, y: number, z: number, rng: Rng, world: Bvh): Smoke {
  const puffs: Puff[] = [];
  const n = CFG.puffs;
  const R = CFG.radius;
  const probe = { x: 0, y: 0, z: 0, radius: 0.5, height: 1 };
  for (let i = 0; i < n; i++) {
    let tx = 0;
    let ty = R * 0.35;
    let tz = 0;
    if (i > 0) {
      const a = (i / (n - 1)) * TAU + rng.range(-0.4, 0.4);
      const d = R * rng.range(0.38, 0.55);
      tx = sin(a) * d;
      tz = cos(a) * d;
      ty = R * rng.range(0.2, 0.55);
      // pull the puff back toward the centre while it would sit inside a wall
      for (let k = 0; k < 6; k++) {
        probe.x = x + tx;
        probe.y = Math.max(0, y + ty - 0.5);
        probe.z = z + tz;
        if (!bodyOverlaps(world, probe)) break;
        tx *= 0.7;
        tz *= 0.7;
      }
    }
    puffs.push({ x, y: y + 0.3, z, r: 0.3, tx, ty, tz });
  }
  return { id, owner, x, y, z, age: 0, puffs };
}

/** Advance puff expansion. Returns false when the smoke has expired. */
export function stepSmoke(s: Smoke): boolean {
  s.age += DT;
  if (s.age >= CFG.duration) return false;
  const grow = Math.min(1, s.age / CFG.expandTime);
  const ease = 1 - (1 - grow) * (1 - grow);
  const R = CFG.radius;
  for (let i = 0; i < s.puffs.length; i++) {
    const p = s.puffs[i];
    p.x = s.x + p.tx * ease;
    p.y = s.y + 0.3 + (p.ty - 0.3) * ease;
    p.z = s.z + p.tz * ease;
    p.r = (i === 0 ? R * 0.75 : R * 0.62) * (0.15 + 0.85 * ease);
  }
  return true;
}

/**
 * Integral of smoke density along the segment a→b, in "metres of full
 * density". Density inside a puff falls off quadratically from its centre.
 */
export function smokeOpticalDepth(smokes: readonly Smoke[], ax: number, ay: number, az: number, bx: number, by: number, bz: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  const len2 = dx * dx + dy * dy + dz * dz;
  if (len2 < 1e-9) return 0;
  const len = Math.sqrt(len2);
  let total = 0;
  for (const s of smokes) {
    const k = smokeStrength(s);
    if (k <= 0) continue;
    for (const p of s.puffs) {
      // closest approach of the segment to the puff centre
      const t = Math.max(0, Math.min(1, ((p.x - ax) * dx + (p.y - ay) * dy + (p.z - az) * dz) / len2));
      const cx = ax + dx * t - p.x;
      const cy = ay + dy * t - p.y;
      const cz = az + dz * t - p.z;
      const d2 = cx * cx + cy * cy + cz * cz;
      const r2 = p.r * p.r;
      if (d2 >= r2) continue;
      // chord half-length through the sphere, clipped to the segment length
      const half = Math.sqrt(r2 - d2);
      const chord = Math.min(2 * half, len);
      // average of (1 - (d/r)^2) density across the chord ≈ (1 - d2/r2) * 2/3
      total += chord * (1 - d2 / r2) * 0.6667 * k * 1.6;
    }
  }
  return total;
}

export function smokeBlocks(smokes: readonly Smoke[], ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
  return smokes.length > 0 && smokeOpticalDepth(smokes, ax, ay, az, bx, by, bz) >= CFG.blockThreshold;
}

/** Step a thrown smoke canister. Returns true when it should deploy. */
export function stepSmokeProjectile(p: SmokeProjectile, world: Bvh): boolean {
  p.age += DT;
  p.vy -= CFG.gravity * DT;
  const dx = p.vx * DT;
  const dy = p.vy * DT;
  const dz = p.vz * DT;
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (len > 1e-9) {
    const hit = world.raycast(p.x, p.y, p.z, dx / len, dy / len, dz / len, len + 0.08);
    if (hit) {
      const t = Math.max(0, hit.t - 0.08);
      p.x += (dx / len) * t;
      p.y += (dy / len) * t;
      p.z += (dz / len) * t;
      // reflect the velocity on the face we hit
      const c = hit.collider;
      const ex = Math.min(Math.abs(p.x - c.minX), Math.abs(p.x - c.maxX));
      const ey = Math.min(Math.abs(p.y - c.minY), Math.abs(p.y - c.maxY));
      const ez = Math.min(Math.abs(p.z - c.minZ), Math.abs(p.z - c.maxZ));
      if (ey <= ex && ey <= ez) {
        p.vy = -p.vy * CFG.bounce;
        p.vx *= 0.6;
        p.vz *= 0.6;
      } else if (ex <= ez) {
        p.vx = -p.vx * CFG.bounce;
      } else {
        p.vz = -p.vz * CFG.bounce;
      }
      const speed = Math.sqrt(p.vx * p.vx + p.vy * p.vy + p.vz * p.vz);
      if (ey <= ex && ey <= ez && speed < 2.5) return true;
    } else {
      p.x += dx;
      p.y += dy;
      p.z += dz;
    }
  }
  return p.age >= CFG.fuse || p.y < -5;
}
