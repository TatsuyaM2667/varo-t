import { describe, expect, it } from 'vitest';
import * as F from '../../src/sim/core/fmath';

describe('fmath', () => {
  it('sin/cos match Math within 1e-12 over a wide range', () => {
    for (let x = -50; x <= 50; x += 0.0137) {
      expect(Math.abs(F.sin(x) - Math.sin(x))).toBeLessThan(1e-12);
      expect(Math.abs(F.cos(x) - Math.cos(x))).toBeLessThan(1e-12);
    }
  });

  it('atan2 matches Math within 1e-9', () => {
    for (let i = 0; i < 2000; i++) {
      const a = (i / 2000) * Math.PI * 2;
      const r = 0.1 + (i % 17);
      const y = Math.sin(a) * r;
      const x = Math.cos(a) * r;
      expect(Math.abs(F.atan2(y, x) - Math.atan2(y, x))).toBeLessThan(1e-9);
    }
    expect(F.atan2(0, -1)).toBeCloseTo(Math.PI, 12);
    expect(F.atan2(1, 0)).toBeCloseTo(Math.PI / 2, 12);
  });

  it('angle helpers wrap correctly', () => {
    expect(F.wrapYaw(-1)).toBe(65535);
    expect(F.wrapYaw(65536 + 5)).toBe(5);
    expect(F.angleDiffUnits(65000, 100)).toBe(636);
    expect(F.angleDiffUnits(100, 65000)).toBe(-636);
    expect(F.angleDiffRad(3, -3)).toBeCloseTo(2 * Math.PI - 6, 12);
  });
});
