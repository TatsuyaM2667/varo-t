import { describe, expect, it } from 'vitest';
import { solveTwoBone } from '../../src/render/ik';

const len = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

describe('two-bone IK', () => {
  it('preserves bone lengths and reaches reachable targets', () => {
    const hip = { x: 0, y: 1, z: 0 };
    for (const foot of [{ x: 0.2, y: 0.2, z: 0.1 }, { x: -0.3, y: 0.4, z: 0.2 }, { x: 0, y: 0.5, z: 0 }]) {
      const r = solveTwoBone(hip, foot, 0.45, 0.45, { x: 0, y: 1, z: 1 });
      expect(len(hip, r.knee)).toBeCloseTo(0.45, 6);
      expect(len(r.knee, r.foot)).toBeCloseTo(0.45, 6);
      expect(len(r.foot, foot)).toBeLessThan(1e-6);
    }
  });

  it('bends toward the pole', () => {
    const r = solveTwoBone({ x: 0, y: 1, z: 0 }, { x: 0, y: 0.3, z: 0 }, 0.45, 0.45, { x: 0, y: 0.6, z: 5 });
    expect(r.knee.z).toBeGreaterThan(0.1);
  });

  it('straightens when out of reach', () => {
    const hip = { x: 0, y: 1, z: 0 };
    const r = solveTwoBone(hip, { x: 0, y: -2, z: 0 }, 0.45, 0.45, { x: 0, y: 0, z: 1 });
    expect(r.foot.y).toBeCloseTo(1 - 0.9, 3);
    expect(Math.abs(r.knee.z)).toBeLessThan(0.01);
  });
});
